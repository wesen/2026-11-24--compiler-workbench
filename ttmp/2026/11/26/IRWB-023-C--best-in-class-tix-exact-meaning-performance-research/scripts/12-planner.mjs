// IRWB-023-C experiment 12: a planner that splits Tix functions at contractions.
//
// Same harness as experiment 10, but the schedule comes from planFunction() in lib/tix-cuda-gen.mjs:
// contraction statements (t[i,j] = E(sum(k) X*Y)) get a tiled kernel that folds k in order per output;
// maximal runs of the other statements get one row-fused kernel each; tensors crossing kernels are
// materialized in global memory. This is the "split fusion groups at contractions" rule that
// experiment 10 showed is needed. Every result is compared word for word with the unmodified Stage 2
// translation unit on the same inputs.
// Usage (worktree root, after npm run build and 03-fused-exact.mjs): node <ticket>/scripts/12-planner.mjs [--timed]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const imp = p => import(pathToFileURL(join(root, 'dist', p)).href);
const { compileTix, cudaSource } = await imp('tensor/index.js');
const { plain, visit } = await imp('tensor/model.js');
const { makeGen } = await import(pathToFileURL(join(here, 'lib/tix-cuda-gen.mjs')).href);
const { planFunction } = makeGen({ plain, visit });

const programs = {
  matmul: { dims: { M: 512, K: 512, N: 512 }, range: [-1, 1] },
  softmax: { dims: { N: 4096, C: 1024 }, range: [-8, 8] },
  layernorm: { dims: { N: 4096, D: 1024 }, range: [-1, 1] },
  attention: { dims: { Q: 1024, K: 1024, D: 64, V: 64 }, range: [-1, 1] },
  mlp: { dims: { N: 1024, D: 256, H: 1024, O: 256 }, range: [-0.5, 0.5] },
  conv2d: { dims: {}, range: [-1, 1] },
};
const includes = new Set(), units = [], kernels = [], cases = [], refused = {}, plans = {};
for (const [name, spec] of Object.entries(programs)) {
  const program = compileTix(readFileSync(join(root, `corpus/tensor/${name}/main.tix`), 'utf8'));
  const fn = program.current.value.functions[0];
  let plan;
  try {
    plan = planFunction(fn);
  } catch (error) {
    refused[name] = error.message;
    continue;
  }
  plans[name] = plan.kernels.map(k => `${k.kind}:${k.out.name}`);
  const source = cudaSource(program, name);
  const body = source.slice(0, source.indexOf('int main('));
  units.push(`namespace s2_${name} {\n${body.split('\n').filter(l => (l.startsWith('#include') ? (includes.add(l), false) : true)).join('\n')}\n}\n`);
  kernels.push(...plan.kernels.map(k => k.code));
  const map = new Map(Object.entries(spec.dims));
  const ev = a => a.terms.reduce((v, [s, c]) => v + map.get(s) * c, a.constant);
  const make = fn.params
    .map(p => (p.name === 'eps' ? `Tensor{{1}, {1e-5f}}` : `make({${p.shape.map(ev).join(', ')}}, ${spec.range[0].toFixed(6)}f, ${spec.range[1].toFixed(6)}f)`))
    .join(', ');
  // Dimension variables d0, d1, ... in the order every kernel of this function binds them.
  const dimNames = [];
  fn.params.forEach(p => p.shape.forEach(a => { const n = plain(a); if (n && !dimNames.includes(n)) dimNames.push(n); }));
  const dimArgs = dimNames.map(n => `(I)${map.get(n)}`).join(', ');
  const tensors = [...fn.params, ...plan.materialized];
  const alloc = plan.materialized.map((t, q) => `    Dev m${q}(${t.shape.map(ev).reduce((x, y) => x * y, 1)});`).join('\n');
  const ptr = ti => (ti < fn.params.length ? `dev[${ti}]->p` : `m${ti - fn.params.length}.p`);
  const launches = plan.kernels
    .map(k => {
      const args = [dimArgs, ...Array.from({ length: k.nTensors }, (_, ti) => ptr(ti)), ptr(tensors.findIndex(t => t.name === k.out.name))].join(', ');
      if (k.kind === 'contraction') return `      { auto kern = FAST ? ${k.kname}<1> : ${k.kname}<0>; kern<<<${k.kname}_grid(${dimArgs}), 256>>>(${args}); }`;
      return `      { const size_t sm = ${k.kname}_smem(${dimArgs}) * 4; auto kern = FAST ? ${k.kname}<1> : ${k.kname}<0>;
        if (sm > 48 * 1024) CHECK(cudaFuncSetAttribute(kern, cudaFuncAttributeMaxDynamicSharedMemorySize, (int)sm));
        kern<<<${k.kname}_rows(${dimArgs}), 256, sm>>>(${args}); }`;
    })
    .join('\n');
  const result = tensors.findIndex(t => t.name === fn.result);
  if (result < fn.params.length) throw Error('a direct parameter return is not planned');
  const outN = fn.shape.map(ev).reduce((x, y) => x * y, 1);
  cases.push(`  {
    std::vector<Tensor> in{${make}};
    double s2ms;
    Tensor ref = stage2(s2_${name}::run_case, in, ${fn.shape.length}, &s2ms);
    std::vector<std::unique_ptr<Dev>> dev;
    for (auto& t : in) dev.emplace_back(new Dev(t.data));
${alloc}
    float t[2]; long long d[2];
    for (int FAST = 0; FAST < 2; ++FAST) {
      t[FAST] = median_ms([&] {
${launches}
      });
      d[FAST] = word_diffs(ref.data, download(m${result - fn.params.length}, ${outN}));
    }
    printf("{\\"program\\":\\"${name}\\",\\"plan\\":\\"${plans[name].join(' | ')}\\",\\"stage2Ms\\":%.4f,\\"plannedDoubleMs\\":%.4f,\\"plannedFastMs\\":%.4f,\\"speedupVsStage2\\":%.2f,\\"wordsDifferentFromStage2\\":{\\"double\\":%lld,\\"fast\\":%lld}}\\n",
           s2ms, t[0], t[1], s2ms / t[1], d[0], d[1]);
  }`);
}
const support = String.raw`
#include <cstdlib>
#include <memory>
#define CHECK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "%s:%d %s\n", __FILE__, __LINE__, cudaGetErrorString(e_)); exit(1); } } while (0)
`;
const helpers = String.raw`
using I = int64_t;
__device__ static float rf_minmax(float a, float b, bool maximum) {  // same definition as Stage 2's minmax
  if (isnan(a) || isnan(b)) return __uint_as_float(0x7fc00000);
  if (a == b) {
    unsigned x = __float_as_uint(a), y = __float_as_uint(b);
    return __uint_as_float(maximum ? x & y : x | y);
  }
  return (maximum ? a > b : a < b) ? a : b;
}
__device__ float rf_block_max(float v) {
  __shared__ float part[32];
  for (int o = 16; o; o >>= 1) v = rf_minmax(v, __shfl_xor_sync(0xffffffffu, v, o), true);
  const int warps = (blockDim.x + 31) / 32, lane = threadIdx.x & 31, warp = threadIdx.x >> 5;
  if (lane == 0) part[warp] = v;
  __syncthreads();
  if (warp == 0) {
    v = lane < warps ? part[lane] : -INFINITY;
    for (int o = 16; o; o >>= 1) v = rf_minmax(v, __shfl_xor_sync(0xffffffffu, v, o), true);
    if (lane == 0) part[0] = v;
  }
  __syncthreads();
  v = part[0];
  __syncthreads();
  return v;
}
struct Tensor { std::vector<int64_t> shape; std::vector<float> data; };
static uint64_t rng = 0x2545F4914F6CDD1Dull;
static Tensor make(std::vector<int64_t> shape, float lo, float hi) {
  Tensor t{shape, {}};
  int64_t n = 1;
  for (auto d : shape) n *= d;
  t.data.resize(n);
  for (auto& x : t.data) { rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17; x = lo + (hi - lo) * (float)((rng >> 40) / 16777216.0); }
  return t;
}
typedef void (*RunCase)(FILE*, FILE*, bool);
static Tensor stage2(RunCase run, const std::vector<Tensor>& params, int rank, double* ms) {
  std::vector<char> req;
  for (auto& p : params) {
    req.insert(req.end(), (const char*)p.shape.data(), (const char*)(p.shape.data() + p.shape.size()));
    req.insert(req.end(), (const char*)p.data.data(), (const char*)(p.data.data() + p.data.size()));
  }
  FILE* in = fmemopen(req.data(), req.size(), "rb");
  char* buf = nullptr; size_t len = 0;
  FILE* out = open_memstream(&buf, &len);
  run(in, out, true);
  fclose(in); fclose(out);
  Tensor t; t.shape.resize(rank);
  memcpy(t.shape.data(), buf, rank * 8);
  int64_t n = 1;
  for (auto d : t.shape) n *= d;
  t.data.resize(n);
  memcpy(t.data.data(), buf + rank * 8, n * 4);
  memcpy(ms, buf + rank * 8 + n * 4, 8);
  free(buf);
  return t;
}
struct Dev {
  float* p = nullptr;
  explicit Dev(const std::vector<float>& h) { CHECK(cudaMalloc(&p, h.size() * 4 + 4)); CHECK(cudaMemcpy(p, h.data(), h.size() * 4, cudaMemcpyHostToDevice)); }
  explicit Dev(size_t n) { CHECK(cudaMalloc(&p, n * 4 + 4)); }
  ~Dev() { cudaFree(p); }
};
template <class F> static float median_ms(F launch, int reps = 21) {
  cudaEvent_t s, e; CHECK(cudaEventCreate(&s)); CHECK(cudaEventCreate(&e));
  launch(); CHECK(cudaDeviceSynchronize()); CHECK(cudaGetLastError());
  std::vector<float> ms(reps);
  for (int r = 0; r < reps; ++r) { CHECK(cudaEventRecord(s)); launch(); CHECK(cudaEventRecord(e)); CHECK(cudaEventSynchronize(e)); CHECK(cudaEventElapsedTime(&ms[r], s, e)); }
  std::sort(ms.begin(), ms.end());
  return ms[reps / 2];
}
static long long word_diffs(const std::vector<float>& a, const std::vector<float>& b) {
  if (a.size() != b.size()) return -1;
  long long n = 0;
  for (size_t i = 0; i < a.size(); ++i) n += memcmp(&a[i], &b[i], 4) != 0;
  return n;
}
static std::vector<float> download(const Dev& d, size_t n) {
  std::vector<float> h(n);
  CHECK(cudaMemcpy(h.data(), d.p, n * 4, cudaMemcpyDeviceToHost));
  return h;
}
`;
const out = join(here, '12-planner');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'main.cu'),
  [
    '// Generated by 12-planner.mjs from Tix IR: ct_* are contraction kernels, rg_* are row-fused groups.',
    ...includes,
    support,
    ...units,
    readFileSync(join(here, '03-fused/fast_exp.cuh'), 'utf8'),
    readFileSync(join(here, '03-fused/fast_tanh.cuh'), 'utf8'),
    helpers,
    ...kernels,
    'int main() {',
    '  init_table();',
    '  init_tanh_table();',
    ...cases,
    '  return 0;',
    '}',
    '',
  ].join('\n'),
);
console.log(JSON.stringify({ refused, plans }));
const result = JSON.parse(
  execFileSync(process.execPath, [join(root, 'tools/cuda-remote.mjs'), out, ...process.argv.slice(2)], { encoding: 'utf8', maxBuffer: 1 << 26 }),
);
if (result.exit !== 0) {
  console.error(result.stderr.slice(0, 6000));
  process.exit(1);
}
process.stdout.write(result.stdout);
