import { plain, visit, width, type Affine, type Expr, type Fn, type Op } from './model.js';

export const cudaAbi = 1;
export const cudaProfile = 'nvcc -O3 -arch=sm_121';
const threads = 256;

const ops: Record<Op, string> = {
  '+': '__fadd_rn',
  '-': '__fsub_rn',
  '*': '__fmul_rn',
  '/': '__fdiv_rn',
  neg: 'neg',
  exp: 'expf',
  log: 'logf',
  sqrt: '__fsqrt_rn',
  tanh: 'tanhf',
  max: 'tix_max',
  min: 'tix_min',
};

// Unsigned arithmetic implements affine sums modulo 2^64 on the device, without signed overflow.
// On the calling domain the final indices and extents are nonnegative exact integers.
const u = (n: number) => (n < 0 ? `(-${-n}ULL)` : `${n}ULL`);
function affine(a: Affine, name: (n: string) => string) {
  const terms = a.terms.map(([n, k]) => (k === 1 ? name(n) : `${u(k)} * ${name(n)}`));
  if (a.constant || !terms.length) terms.unshift(u(a.constant));
  return `(${terms.join(' + ')})`;
}

export function emitCuda(fn: Fn): string {
  const tensors = [...fn.params, ...fn.statements];
  const slot = new Map(tensors.map((t, i) => [t.name, i]));
  const symbols = new Map<string, number>();
  for (const p of fn.params)
    for (const a of p.shape) {
      const s = plain(a);
      if (s !== undefined && !symbols.has(s)) symbols.set(s, symbols.size);
    }
  let rankSum = 0;
  const base = tensors.map(t => {
    const start = rankSum;
    rankSum += t.shape.length;
    return start;
  });
  const result = slot.get(fn.result)!;
  const shape = (n: string) => `m->s[${symbols.get(n)!}]`;
  const dim = (t: number, a: number) =>
    tensors[t].shape[a].terms.length ? `m->d[${base[t] + a}]` : u(tensors[t].shape[a].constant);
  const kernels: string[] = [],
    preload: string[] = [],
    launches: string[] = [];
  fn.statements.forEach((stmt, k) => {
    const t = slot.get(stmt.name)!;
    const reads = new Set<number>();
    visit(stmt.expr, e => {
      if (e.kind === 'load') reads.add(slot.get(e.name)!);
    });
    const args = [...reads];
    const out = [
      `__global__ void kernel${k}(const Meta *m, U count, float *out${args.map(i => `, const float *p${i}`).join('')}) {`,
      '  const U flat = U(blockIdx.x) * blockDim.x + threadIdx.x;',
      '  if (flat >= count) return;',
      '  U rem = flat;',
    ];
    let indent = '  ',
      next = 0;
    // One name per binder identity, not per spelling. Scope of reduction variables is their loop nest.
    const binding = new Map<string, string>();
    const variable = (id: string) => {
      const i = `i${next++}`;
      binding.set(id, i);
      return i;
    };
    const line = (s: string) => out.push(indent + s);
    for (let a = stmt.axes.length - 1; a >= 0; --a) {
      const i = variable(stmt.axes[a].id);
      // The first axis gets the remaining quotient; the guard ensures no divide by zero.
      line(`const U ${i} = ${a ? `rem % ${dim(t, a)}` : 'rem'};`);
      if (a) line(`rem /= ${dim(t, a)};`);
    }
    const scalar = (e: Expr): string => {
      const tmp = `v${next++}`;
      switch (e.kind) {
        case 'literal': {
          const bits = new Uint32Array(Float32Array.of(Math.fround(Number(e.text))).buffer)[0];
          line(`const float ${tmp} = __uint_as_float(0x${bits.toString(16)}u);`);
          break;
        }
        case 'shape':
          line(`const float ${tmp} = __ll2float_rn(static_cast<long long>(${shape(e.name)}));`);
          break;
        case 'load': {
          const src = slot.get(e.name)!;
          const ix = e.indices.map(a => affine(a, n => binding.get(n)!));
          const offset = ix.reduce((prev, i, a) => (a ? `(${prev} * ${dim(src, a)} + ${i})` : i));
          line(`const float ${tmp} = p${src}[${offset}];`);
          break;
        }
        case 'op': {
          const operands = e.args.map(scalar);
          line(
            `const float ${tmp} = ${e.op === 'neg' ? `-${operands[0]}` : `${ops[e.op]}(${operands.join(', ')})`};`,
          );
          break;
        }
        case 'reduce': {
          line(`float ${tmp} = ${e.op === 'sum' ? '0.0f' : '__uint_as_float(0xff800000u)'};`);
          for (const a of e.axes) {
            const { extent } = a;
            const d = affine(extent.dim, shape);
            const bound = `n${next++}`;
            const limit =
              extent.kind === 'dim'
                ? d
                : extent.kind === 'blocks'
                  ? `${d} / ${width}ULL${extent.rounding === 'ceil' ? ` + (${d} % ${width}ULL != 0)` : ''}`
                  : `tix_tail(${d}, ${binding.get(extent.block)!})`;
            const i = variable(a.id);
            line(`const U ${bound} = ${limit};`);
            line(`for (U ${i} = 0; ${i} < ${bound}; ++${i}) {`);
            indent += '  ';
          }
          const value = scalar(e.body);
          line(`${tmp} = ${e.op === 'sum' ? '__fadd_rn' : 'tix_max'}(${tmp}, ${value});`);
          for (const a of [...e.axes].reverse()) {
            binding.delete(a.id);
            indent = indent.slice(2);
            line('}');
          }
          break;
        }
      }
      return tmp;
    };
    const rhs = scalar(stmt.expr);
    line(`out[flat] = ${rhs};`);
    kernels.push([...out, '}'].join('\n'));
    preload.push(
      `  if (count[${t}]) {\n    cudaFuncAttributes attr;\n    CUDA(cudaFuncGetAttributes(&attr, kernel${k}));\n  }`,
    );
    launches.push(
      `    if (count[${t}]) kernel${k}<<<grid[${k}], threads>>>(deviceMeta, count[${t}], p[${t}]${args.map(i => `, p[${i}]`).join('')});`,
    );
  });

  const binds: string[] = [],
    checks: string[] = [];
  const bound = new Set<string>();
  // Host affine expressions use a wide multiply and checked summation in the IR's term order.
  const hostDim = (a: Affine) =>
    a.terms.reduce((value, [n, k]) => `add_dim(${value}, ${k}LL, ${shape(n)})`, `${a.constant}LL`);
  for (const [i, t] of tensors.entries())
    for (const [j, a] of t.shape.entries()) {
      const d = `m->d[${base[i] + j}]`;
      const expected = `dimension(${hostDim(a)})`;
      if (i >= fn.params.length) checks.push(`  ${d} = ${expected};`);
      else {
        const s = plain(a);
        if (s !== undefined && !bound.has(s)) {
          bound.add(s);
          binds.push(`  ${shape(s)} = ${d};`);
        } else checks.push(`  need(${d} == ${expected}, "inconsistent input dimensions");`);
      }
    }
  // All parameter shapes precede data so shape/domain checks precede allocation and transfer.
  return `#include <cuda_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <vector>

using U = unsigned long long;
using S = long long;
static_assert(sizeof(U) == 8 && sizeof(float) == 4 && sizeof(double) == 8);
static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__);
constexpr U safe = 9007199254740991ULL;
constexpr unsigned threads = ${threads};
constexpr uint32_t abi = ${cudaAbi};
constexpr unsigned tensors = ${tensors.length}, inputs = ${fn.params.length}, statements = ${fn.statements.length};
constexpr unsigned result = ${result};
constexpr unsigned axes[] = {${[...base, rankSum].join(', ')}};
struct Meta { U s[${Math.max(symbols.size, 1)}], d[${rankSum}]; };

__device__ float extreme(float a, float b, bool largest) {
  if (isnan(a)) return a;
  if (isnan(b)) return b;
  if (a == 0.0f && b == 0.0f) {
    const unsigned x = __float_as_uint(a), y = __float_as_uint(b);
    return __uint_as_float(largest ? x & y : x | y);
  }
  return largest ? (a > b ? a : b) : (a < b ? a : b);
}
__device__ float tix_max(float a, float b) { return extreme(a, b, true); }
__device__ float tix_min(float a, float b) { return extreme(a, b, false); }
__device__ U tix_tail(U d, U block) {
  const U rest = d - ${width}ULL * block;
  return rest < ${width}ULL ? rest : ${width}ULL;
}

${kernels.join('\n\n')}

static void need(bool ok, const char *message) {
  if (!ok) { std::fprintf(stderr, "Tix CUDA: %s\\n", message); std::exit(1); }
}
#define CUDA(call) do { \\
  cudaError_t rc = (call); \\
  if (rc != cudaSuccess) { std::fprintf(stderr, "%s: %s\\n", #call, cudaGetErrorString(rc)); std::exit(1); } \\
} while (0)
static void read(FILE *file, void *dst, size_t bytes) {
  if (bytes) need(std::fread(dst, 1, bytes, file) == bytes, "short input");
}
static void write(FILE *file, const void *src, size_t bytes) {
  if (bytes) need(std::fwrite(src, 1, bytes, file) == bytes, "short write");
}
static U dimension(S value) {
  need(value >= 0 && U(value) <= safe, "invalid affine dimension");
  return U(value);
}
static S add_dim(S prev, S coefficient, U value) {
  const __int128 product = __int128(coefficient) * value;
  const __int128 sum = prev + product;
  need(product >= -S(safe) && product <= safe && sum >= -S(safe) && sum <= safe, "affine dimension overflow");
  return S(sum);
}
static U elements(const Meta *m, unsigned t) {
  const U *begin = m->d + axes[t], *end = m->d + axes[t+1];
  if (std::find(begin, end, U(0)) != end) return 0;
  U count = 1;
  for (auto it = begin; it != end; ++it) {
    need(count <= safe / *it && count <= SIZE_MAX / sizeof(float) / *it, "tensor size overflow");
    count *= *it;
  }
  return count;
}
static void run_case(FILE *in, FILE *out, bool benchmark) {
  Meta meta{}, *m = &meta;
  float *p[tensors]{};
  U count[tensors]{};
  unsigned grid[statements + 1]{};
  read(in, m->d, axes[inputs] * sizeof(U));
  for (unsigned i = 0; i < axes[inputs]; ++i) need(m->d[i] <= safe, "input dimension too large");
${binds.join('\n')}
${checks.join('\n')}
  for (unsigned t = 0; t < tensors; ++t) count[t] = elements(m, t);
  const bool has_work = std::any_of(count + inputs, count + tensors, [](U n) { return n != 0; });
  Meta *deviceMeta = nullptr;
  if (has_work) {
    CUDA(cudaMalloc(&deviceMeta, sizeof(Meta)));
    CUDA(cudaMemcpy(deviceMeta, m, sizeof(Meta), cudaMemcpyHostToDevice));
    int device, max_grid;
    CUDA(cudaGetDevice(&device));
    CUDA(cudaDeviceGetAttribute(&max_grid, cudaDevAttrMaxGridDimX, device));
    for (unsigned k = 0; k < statements; ++k) {
      const U blocks = (count[inputs+k] + threads - 1) / threads;
      need(blocks <= U(max_grid), "grid too large");
      grid[k] = unsigned(blocks);
    }
  }
  std::vector<float> host;
  for (unsigned t = 0; t < tensors; ++t) {
    const size_t bytes = count[t] * sizeof(float);
    if (count[t] && has_work) CUDA(cudaMalloc(&p[t], bytes));
    if (t < inputs) {
      host.resize(count[t]);
      read(in, host.data(), bytes);
      need(std::all_of(host.begin(), host.end(), [](float f) { return std::isfinite(f); }), "nonfinite input");
      if (count[t] && has_work) CUDA(cudaMemcpy(p[t], host.data(), bytes, cudaMemcpyHostToDevice));
      if (t == result) write(out, m->d + axes[t], (axes[t+1] - axes[t]) * sizeof(U));
      if (!has_work && t == result) {
        const double zero = 0.0;
        write(out, &zero, sizeof(zero));
        write(out, host.data(), bytes);
      }
    }
  }
  if (!has_work && result < inputs) return;
${preload.join('\n')}
  auto launch = [&]() {
${launches.join('\n')}
  };
  double gpu_ms = 0;
  if (has_work) {
    cudaEvent_t start, stop;
    CUDA(cudaEventCreate(&start));
    CUDA(cudaEventCreate(&stop));
    if (benchmark) {
      launch();
      CUDA(cudaGetLastError());
      CUDA(cudaDeviceSynchronize());
      cudaDeviceProp prop;
      int device, driver, runtime;
      CUDA(cudaGetDevice(&device));
      CUDA(cudaGetDeviceProperties(&prop, device));
      CUDA(cudaDriverGetVersion(&driver));
      CUDA(cudaRuntimeGetVersion(&runtime));
      std::printf("%s sm_%d%d nvcc %d.%d.%d driver API %d runtime %d\\n", prop.name,
        prop.major, prop.minor, __CUDACC_VER_MAJOR__, __CUDACC_VER_MINOR__, __CUDACC_VER_BUILD__, driver, runtime);
    }
    float ms[5];
    const int repetitions = benchmark ? 5 : 1;
    for (int i = 0; i < repetitions; ++i) {
      CUDA(cudaEventRecord(start));
      launch();
      CUDA(cudaEventRecord(stop));
      CUDA(cudaGetLastError());
      CUDA(cudaEventSynchronize(stop));
      CUDA(cudaEventElapsedTime(&ms[i], start, stop));
      if (benchmark) std::printf("gpu_ms %.9g\\n", ms[i]);
    }
    std::sort(ms, ms + repetitions);
    gpu_ms = ms[repetitions / 2];
    CUDA(cudaEventDestroy(start));
    CUDA(cudaEventDestroy(stop));
  }
  const size_t bytes = count[result] * sizeof(float);
  host.resize(count[result]);
  if (bytes) CUDA(cudaMemcpy(host.data(), p[result], bytes, cudaMemcpyDeviceToHost));
  if (result >= inputs) write(out, m->d + axes[result], (axes[result+1] - axes[result]) * sizeof(U));
  write(out, &gpu_ms, sizeof(gpu_ms));
  write(out, host.data(), bytes);
  for (auto ptr : p) if (ptr) CUDA(cudaFree(ptr));
  if (deviceMeta) CUDA(cudaFree(deviceMeta));
}
int main(int argc, char **argv) {
  const bool benchmark = argc == 2 && std::strcmp(argv[1], "--benchmark") == 0;
  need(argc == 1 || benchmark, "expected no arguments or --benchmark");
  FILE *in = std::fopen("inputs/cases.bin", "rb"), *out = std::fopen("out/results.bin", "wb");
  need(in && out, "cannot open inputs/cases.bin or out/results.bin");
  uint32_t version, cases;
  read(in, &version, sizeof(version));
  read(in, &cases, sizeof(cases));
  need(version == abi && cases > 0, "invalid input frame");
  write(out, &version, sizeof(version));
  write(out, &cases, sizeof(cases));
  for (uint32_t i = 0; i < cases; ++i) run_case(in, out, benchmark);
  need(std::fgetc(in) == EOF && !std::ferror(in), "unexpected trailing input");
  need(std::fclose(in) == 0 && std::fclose(out) == 0, "close failed");
}
`;
}
