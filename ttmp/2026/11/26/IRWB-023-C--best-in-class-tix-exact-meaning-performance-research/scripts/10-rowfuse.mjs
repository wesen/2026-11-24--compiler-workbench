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

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function literal(text) {
  const v = new DataView(new ArrayBuffer(4));
  v.setFloat32(0, Number(text));
  return `__uint_as_float(0x${v.getUint32(0).toString(16)}u)`;
}

export function emitRowKernel(fn, kname) {
  const dims = new Map(), dimSource = [];
  fn.params.forEach((p, pi) =>
    p.shape.forEach((a, ax) => {
      const k = plain(a);
      if (k && !dims.has(k)) {
        dims.set(k, `d${dims.size}`);
        dimSource.push([pi, ax]);
      }
    }),
  );
  const affine = (a, nameOf) => {
    const terms = a.terms.map(([k, c]) => (c === 1 ? nameOf(k) : `${c}LL * ${nameOf(k)}`));
    if (a.constant || !terms.length) terms.unshift(`${a.constant}LL`);
    return `(${terms.join(' + ')})`;
  };
  const dim = a => affine(a, k => dims.get(k));
  const params = new Map(fn.params.map((p, i) => [p.name, i]));
  const stmts = new Map(fn.statements.map(s => [s.name, s]));
  const rowDim = fn.statements[0].axes[0].extent.dim;
  for (const s of fn.statements) {
    if (s.axes.length < 1 || s.axes.length > 2 || !same(s.axes[0].extent.dim, rowDim))
      throw Error(`${fn.name}: not row-local (${s.name})`);
    visit(s.expr, e => {
      if (e.kind === 'reduce' && e.axes.some(a => a.extent.kind !== 'dim')) throw Error('only origin extents');
      if (e.kind === 'load' && !params.has(e.name)) {
        const row = s.axes[0].id;
        if (!same(e.indices[0], { constant: 0, terms: [[row, 1]] })) throw Error(`${fn.name}: ${e.name} read off-row`);
      }
    });
  }
  const result = stmts.get(fn.result);
  if (!result) throw Error('result must be a statement');
  const rank2 = fn.statements.filter(s => s.axes.length === 2 && s.name !== fn.result);
  const rank1 = fn.statements.filter(s => s.axes.length === 1);

  const L = [];
  let indent = '  ', tmp = 0, loopVar = 0, redSlot = 0;
  const line = c => L.push(indent + c);
  const temp = c => {
    const n = `v${tmp++}`;
    line(`float ${n} = ${c};`);
    return n;
  };
  function scalar(e, env) {
    switch (e.kind) {
      case 'cvar':
        return e.code;
      case 'literal':
        return literal(e.text);
      case 'shape':
        return `__ll2float_rn(${dims.get(e.name)})`;
      case 'load': {
        const idx = e.indices.map(a => affine(a, k => env.get(k)));
        if (params.has(e.name)) {
          const shape = fn.params[params.get(e.name)].shape;
          const off = idx.reduce((acc, x, i) => (i ? `(${acc} * ${dim(shape[i])} + ${x})` : x), '');
          return `p${params.get(e.name)}[${off}]`;
        }
        const t = stmts.get(e.name);
        return t.axes.length === 2 ? `s_${e.name}[${idx[1]}]` : `sc_${e.name}`;
      }
      case 'op': {
        const [a, b] = e.args.map(x => scalar(x, env));
        const bin = { '+': '__fadd_rn', '-': '__fsub_rn', '*': '__fmul_rn', '/': '__fdiv_rn' }[e.op];
        if (bin) return temp(`${bin}(${a}, ${b})`);
        if (e.op === 'neg') return temp(`-(${a})`);
        if (e.op === 'sqrt') return temp(`__fsqrt_rn(${a})`);
        if (e.op === 'exp') return temp(`FAST ? fast_exp(${a}) : __double2float_rn(exp(static_cast<double>(${a})))`);
        if (e.op === 'tanh') return temp(`FAST ? fast_tanh(${a}) : __double2float_rn(tanh(static_cast<double>(${a})))`);
        if (e.op === 'log') return temp(`__double2float_rn(log(static_cast<double>(${a})))`);
        return temp(`rf_minmax(${a}, ${b}, ${e.op === 'max'})`);
      }
      case 'reduce': {
        // Sequential, in one thread, exactly as Stage 2 emits it.
        const acc = temp(e.op === 'sum' ? '0.0f' : '-INFINITY');
        const inner = new Map(env);
        for (const ax of e.axes) {
          const v = `k${loopVar++}`;
          inner.set(ax.id, v);
          line(`for (I ${v} = 0; ${v} < ${dim(ax.extent.dim)}; ++${v}) {`);
          indent += '  ';
        }
        const x = scalar(e.body, inner);
        line(`${acc} = ${e.op === 'sum' ? `__fadd_rn(${acc}, ${x})` : `rf_minmax(${acc}, ${x}, true)`};`);
        for (const _ of e.axes) {
          indent = indent.slice(2);
          line('}');
        }
        return acc;
      }
    }
  }
  const sig = [
    ...[...dims.values()].map(d => `I ${d}`),
    ...fn.params.map((_, i) => `const float* __restrict__ p${i}`),
    'float* __restrict__ out',
  ];
  L.push(`template <int FAST> __global__ void ${kname}(${sig.join(', ')}) {`);
  line('extern __shared__ float smem[];');
  line('__shared__ float red[32];');
  if (rank1.length) line(`__shared__ float ${rank1.map(s => 'sc_' + s.name).join(', ')};`);
  line('const I r = blockIdx.x;');
  line('float* cursor = smem;');
  const smemTerms = [];
  for (const s of rank2) {
    line(`float* s_${s.name} = cursor; cursor += ${dim(s.shape[1])};`);
    smemTerms.push(dim(s.shape[1]));
  }
  line('float* scratch = cursor;');
  const scratchTerms = ['1LL'];
  for (const s of fn.statements) {
    line(`// ${s.name}`);
    const rowEnv = new Map([[s.axes[0].id, 'r']]);
    if (s.axes.length === 2) {
      const n = dim(s.shape[1]);
      line(`for (I j = threadIdx.x; j < ${n}; j += blockDim.x) {`);
      indent += '  ';
      const v = scalar(s.expr, new Map([...rowEnv, [s.axes[1].id, 'j']]));
      line(s.name === fn.result ? `out[r * ${n} + j] = ${v};` : `s_${s.name}[j] = ${v};`);
      indent = indent.slice(2);
      line('}');
      line('__syncthreads();');
      continue;
    }
    // Per-row statement: parallel bodies of top-level reductions, then ordered folds or join trees.
    const replaced = [];
    const lift = e => {
      if (e.kind === 'reduce') {
        replaced.push(e);
        return { kind: 'cvar', code: `red[${redSlot++}]` };
      }
      if (e.kind === 'op') return { ...e, args: e.args.map(lift) };
      return e;
    };
    const expr = lift(s.expr);
    replaced.forEach((R, idx) => {
      const slot = `red[${redSlot - replaced.length + idx}]`;
      if (R.axes.length !== 1) {
        line('if (threadIdx.x == 0) {');
        indent += '  ';
        line(`${slot} = ${scalar(R, rowEnv)};`);
        indent = indent.slice(2);
        line('}');
        line('__syncthreads();');
        return;
      }
      const n = dim(R.axes[0].extent.dim);
      scratchTerms.push(n);
      line(`for (I j = threadIdx.x; j < ${n}; j += blockDim.x) {`);
      indent += '  ';
      line(`scratch[j] = ${scalar(R.body, new Map([...rowEnv, [R.axes[0].id, 'j']]))};`);
      indent = indent.slice(2);
      line('}');
      line('__syncthreads();');
      if (R.op === 'max') {
        line(`{ float m = -INFINITY; for (I j = threadIdx.x; j < ${n}; j += blockDim.x) m = rf_minmax(m, scratch[j], true);`);
        line(`  m = rf_block_max(m); if (threadIdx.x == 0) ${slot} = m; }`);
      } else {
        line(`if (threadIdx.x == 0) { float acc = 0.0f; for (I j = 0; j < ${n}; ++j) acc = __fadd_rn(acc, scratch[j]); ${slot} = acc; }`);
      }
      line('__syncthreads();');
    });
    line('if (threadIdx.x == 0) {');
    indent += '  ';
    const v = scalar(expr, rowEnv);
    line(s.name === fn.result ? `out[r] = ${v};` : `sc_${s.name} = ${v};`);
    indent = indent.slice(2);
    line('}');
    line('__syncthreads();');
  }
  L.push('}');
  if (redSlot > 32) throw Error('too many reductions');
  const dimArgs = [...dims.values()].map(d => `I ${d}`).join(', ');
  const host = [
    `static I ${kname}_rows(${dimArgs}) { return ${dim(rowDim)}; }`,
    `static I ${kname}_inner(${dimArgs}) { return ${result.axes.length === 2 ? dim(result.shape[1]) : '1LL'}; }`,
    `static I ${kname}_smem(${dimArgs}) { return ${[...smemTerms, `std::max<I>({${scratchTerms.join(', ')}})`].join(' + ')}; }`,
  ];
  return { code: L.join('\n') + '\n' + host.join('\n'), dims: [...dims.values()], dimSource, nParams: fn.params.length };
}

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
