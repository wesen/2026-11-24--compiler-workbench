// IRWB-023-C experiment 10: can the *compiler* produce exact fused schedules from Tix IR?
//
// A prototype schedule generator for row-local Tix functions. In such a function every statement's first
// axis ranges over the same extent (the row) and every read of an intermediate tensor uses that row binder
// as its first index; parameters can be read anywhere. The generated kernel runs one block per row and
// keeps each intermediate row in shared memory. Per-element statements run in parallel over their inner
// axis. A per-row statement first evaluates each top-level reduction body in parallel into a scratch row,
// then folds it: `max` as a join tree (exact; see the design doc, law L3), `sum` in index order by one
// thread. Finally one thread evaluates the remaining scalar expression. Every scalar operation uses the
// Stage 2 intrinsics, and the result is compared word for word with the unmodified Stage 2 translation
// unit on the same inputs.
// Usage (worktree root, after npm run build and after running 03-fused-exact.mjs once, which writes
// the copied fast_exp.cuh and fast_tanh.cuh): node <ticket>/scripts/10-rowfuse.mjs [--timed]
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
const { emitRowKernel } = makeGen({ plain, visit });

const programs = {
  matmul: { dims: { M: 512, K: 512, N: 512 }, range: [-1, 1] },
  softmax: { dims: { N: 4096, C: 1024 }, range: [-8, 8] },
  layernorm: { dims: { N: 4096, D: 1024 }, range: [-1, 1] },
  attention: { dims: { Q: 1024, K: 1024, D: 64, V: 64 }, range: [-1, 1] },
  mlp: { dims: { N: 1024, D: 256, H: 1024, O: 256 }, range: [-0.5, 0.5] },
  conv2d: { dims: {}, range: [-1, 1] },
};
const includes = new Set(), units = [], kernels = [], cases = [], refused = {};
for (const [name, spec] of Object.entries(programs)) {
  const program = compileTix(readFileSync(join(root, `corpus/tensor/${name}/main.tix`), 'utf8'));
  const fn = program.current.value.functions[0];
  let k;
  try {
    k = emitRowKernel(fn, `row_${name}`);
  } catch (error) {
    refused[name] = error.message;
    continue;
  }
  const source = cudaSource(program, name);
  const body = source.slice(0, source.indexOf('int main('));
  units.push(
    `namespace s2_${name} {\n${body.split('\n').filter(l => (l.startsWith('#include') ? (includes.add(l), false) : true)).join('\n')}\n}\n`,
  );
  kernels.push(k.code);
  const map = new Map(Object.entries(spec.dims));
  const shapes = fn.params.map(p =>
    p.shape.map(a => a.terms.reduce((v, [s, c]) => v + map.get(s) * c, a.constant)),
  );
  const make = fn.params
    .map((p, i) =>
      p.name === 'eps'
        ? `Tensor{{1}, {1e-5f}}`
        : `make({${shapes[i].join(', ')}}, ${spec.range[0].toFixed(6)}f, ${spec.range[1].toFixed(6)}f)`,
    )
    .join(', ');
  const dimsFromInputs = k.dims.map((d, i) => `in[${k.dimSource[i][0]}].shape[${k.dimSource[i][1]}]`).join(', ');
  cases.push(`  {
    std::vector<Tensor> in{${make}};
    double s2ms;
    Tensor ref = stage2(s2_${name}::run_case, in, ${fn.shape.length}, &s2ms);
    std::vector<std::unique_ptr<Dev>> dev;
    for (auto& t : in) dev.emplace_back(new Dev(t.data));
    const I rows = row_${name}_rows(${dimsFromInputs}), inner = row_${name}_inner(${dimsFromInputs});
    const size_t smem = row_${name}_smem(${dimsFromInputs}) * 4;
    Dev out(rows * inner);
    float t[2]; long long d[2];
    for (int f = 0; f < 2; ++f) {
      auto kern = f ? row_${name}<1> : row_${name}<0>;
      if (smem > 48 * 1024) CHECK(cudaFuncSetAttribute(kern, cudaFuncAttributeMaxDynamicSharedMemorySize, (int)smem));
      t[f] = median_ms([&] { kern<<<rows, 256, smem>>>(${dimsFromInputs}, ${fn.params.map((_, i) => `dev[${i}]->p`).join(', ')}, out.p); });
      d[f] = word_diffs(ref.data, download(out, rows * inner));
    }
    printf("{\\"program\\":\\"${name}\\",\\"stage2Ms\\":%.4f,\\"generatedDoubleMs\\":%.4f,\\"generatedFastMs\\":%.4f,\\"speedupVsStage2\\":%.2f,\\"wordsDifferentFromStage2\\":{\\"double\\":%lld,\\"fast\\":%lld},\\"smemBytes\\":%zu}\\n",
           s2ms, t[0], t[1], s2ms / t[1], d[0], d[1], smem);
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
const out = join(here, '10-rowfuse');
mkdirSync(out, { recursive: true });
const fastExp = readFileSync(join(here, '03-fused/fast_exp.cuh'), 'utf8');
const fastTanh = readFileSync(join(here, '03-fused/fast_tanh.cuh'), 'utf8');
writeFileSync(
  join(out, 'main.cu'),
  [
    '// Generated by 10-rowfuse.mjs. Kernels row_* are produced from Tix IR by emitRowKernel().',
    ...includes,
    support,
    ...units,
    fastExp,
    fastTanh,
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
console.log(JSON.stringify({ refused }));
const result = JSON.parse(
  execFileSync(process.execPath, [join(root, 'tools/cuda-remote.mjs'), out, ...process.argv.slice(2)], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  }),
);
if (result.exit !== 0) {
  console.error(result.stderr.slice(0, 4000));
  process.exit(1);
}
process.stdout.write(result.stdout);
