import { plain, visit, width, type Affine, type Axis, type Fn, type Expr, type Op } from './model.js';

const threads = 128;
export const inputMagic = 0x31584954; // TIX1
export const resultMagic = 0x31524f54; // TOR1
const op: Record<Op, string> = {
  '+': '__fadd_rn',
  '-': '__fsub_rn',
  '*': '__fmul_rn',
  '/': '__fdiv_rn',
  neg: 'neg',
  exp: 'wide_exp',
  log: 'wide_log',
  sqrt: 'wide_sqrt',
  tanh: 'wide_tanh',
  max: 'js_max',
  min: 'js_min',
};
const helpers = String.raw`#include <cuda_runtime.h>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <vector>

using I = long long;
using U = uint32_t;
static_assert(sizeof(I) == 8 && sizeof(float) == 4);
static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__);

void require(bool ok, const char* message) {
  if (!ok) { fprintf(stderr, "%s\n", message); exit(1); }
}
void checked(cudaError_t status, const char* call) {
  if (status != cudaSuccess) { fprintf(stderr, "%s: %s\n", call, cudaGetErrorString(status)); exit(2); }
}
#define CUDA(call) checked((call), #call)

// Check concrete metadata before using it in 64-bit device arithmetic.
I safe(__int128 v) {
  require(v >= -9007199254740991LL && v <= 9007199254740991LL, "Unsafe extent arithmetic");
  return I(v);
}
I extent(I v) {
  require(v >= 0 && v <= 9007199254740991LL, "Invalid extent");
  return v;
}
template<class T> T read(FILE* f) {
  T v; require(fread(&v, sizeof(v), 1, f) == 1, "Truncated input"); return v;
}
template<class T> void write(FILE* f, T v) {
  require(fwrite(&v, sizeof(v), 1, f) == 1, "Cannot write result");
}

__device__ __forceinline__ float neg(float a) { return __uint_as_float(__float_as_uint(a) ^ 0x80000000u); }
__device__ __forceinline__ float wide_exp(float a) { return __double2float_rn(exp(double(a))); }
__device__ __forceinline__ float wide_log(float a) { return __double2float_rn(log(double(a))); }
__device__ __forceinline__ float wide_sqrt(float a) { return __double2float_rn(__dsqrt_rn(double(a))); }
__device__ __forceinline__ float wide_tanh(float a) { return __double2float_rn(tanh(double(a))); }
template<bool Maximum> __device__ __forceinline__ float js_minmax(float a, float b) {
  if (isnan(a) || isnan(b)) return __uint_as_float(0x7fc00000u);
  if (a == 0.0f && b == 0.0f) {
    U x = __float_as_uint(a), y = __float_as_uint(b);
    return __uint_as_float(Maximum ? (x & y) : (x | y));
  }
  return Maximum ? (a > b ? a : b) : (a < b ? a : b);
}
__device__ __forceinline__ float js_max(float a, float b) { return js_minmax<true>(a, b); }
__device__ __forceinline__ float js_min(float a, float b) { return js_minmax<false>(a, b); }
`;

function ll(n: number) {
  return `(${n}LL)`;
}
function address(a: Affine, index: Map<string, string>) {
  return `(${[ll(a.constant), ...a.terms.map(([id, k]) => `${ll(k)} * ${index.get(id)!}`)].join(' + ')})`;
}
function bits(text: string) {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, Math.fround(Number(text)), true);
  return `0x${b.getUint32(0, true).toString(16)}u`;
}

export function emitCuda(fn: Fn): string {
  const params = fn.params,
    tensors = [...params, ...fn.statements];
  const tensorIds = new Map(tensors.map((t, i) => [t.name, i]));
  const symbols = new Map<string, { slot: number; param: number; axis: number }>();
  params.forEach((p, param) =>
    p.shape.forEach((d, axis) => {
      const name = plain(d);
      if (name && !symbols.has(name)) symbols.set(name, { slot: symbols.size, param, axis });
    }),
  );
  const dims: Affine[] = [];
  const dimIds = new Map<string, number>();
  function dimSlot(a: Affine) {
    const key = JSON.stringify(a);
    if (!dimIds.has(key)) {
      dimIds.set(key, symbols.size + dims.length);
      dims.push(a);
    }
    return dimIds.get(key)!;
  }
  const dim = (a: Affine) => `dims[${dimSlot(a)}]`;
  const shapes = tensors.map(t => t.shape.map(dim));
  const result = tensorIds.get(fn.result)!;
  const kernels = fn.statements.map((s, j) => {
    const id = j + params.length;
    const indices = new Map<string, string>();
    const reads = new Set<number>();
    visit(s.expr, e => {
      if (e.kind === 'load') reads.add(tensorIds.get(e.name)!);
    });
    const lines: string[] = [];
    let depth = 1,
      next = 0;
    const line = (s: string) => lines.push(`${'  '.repeat(depth)}${s}`);
    const local = () => `v${next++}`;
    function reduceAxes(axes: Axis[], i: number, inner: () => void) {
      if (i === axes.length) {
        inner();
        return;
      }
      const { id, extent: e } = axes[i];
      const d = dim(e.dim);
      let bound = d;
      if (e.kind === 'blocks')
        bound = `${d} / ${width} + (${e.rounding === 'ceil' ? `${d} % ${width} != 0` : '0'})`;
      if (e.kind === 'tail') {
        const r = local();
        line(`const I ${r} = ${d} - ${width} * ${indices.get(e.block)!};`);
        bound = `(${r} < ${width} ? ${r} : ${width})`;
      }
      const ix = local();
      indices.set(id, ix);
      line(`for (I ${ix} = 0; ${ix} < ${bound}; ++${ix}) {`);
      depth++;
      reduceAxes(axes, i + 1, inner);
      depth--;
      line('}');
      indices.delete(id);
    }
    function scalar(e: Expr): string {
      if (e.kind === 'reduce') {
        const acc = local();
        line(`float ${acc} = ${e.op === 'sum' ? '0.0f' : '__uint_as_float(0xff800000u)'};`);
        reduceAxes(e.axes, 0, () => {
          const x = scalar(e.body);
          line(`${acc} = ${e.op === 'sum' ? '__fadd_rn' : 'js_max'}(${acc}, ${x});`);
        });
        return acc;
      }
      let rhs: string;
      switch (e.kind) {
        case 'literal':
          rhs = `__uint_as_float(${bits(e.text)})`;
          break;
        case 'shape':
          rhs = `__ll2float_rn(dims[${symbols.get(e.name)!.slot}])`;
          break;
        case 'load': {
          const t = tensorIds.get(e.name)!;
          const ix = e.indices.map(a => address(a, indices));
          const offset = ix.slice(1).reduce((acc, v, i) => `(${acc} * ${shapes[t][i + 1]} + ${v})`, ix[0]);
          rhs = `buf${t}[${offset}]`;
          break;
        }
        case 'op':
          rhs = `${op[e.op]}(${e.args.map(scalar).join(', ')})`;
          break;
      }
      const v = local();
      line(`const float ${v} = ${rhs};`);
      return v;
    }
    line('const I flat = I(blockIdx.x) * blockDim.x + threadIdx.x;');
    line('if (flat >= count) return;');
    for (const t of reads) line(`const float* buf${t} = buffers[${t}];`);
    if (s.axes.length > 1) line('I rest = flat;');
    for (let i = s.axes.length - 1; i >= 0; --i) {
      const v = local(),
        size = shapes[id][i];
      indices.set(s.axes[i].id, v);
      line(`const I ${v} = ${i ? `rest % ${size}` : s.axes.length === 1 ? 'flat' : 'rest'};`);
      if (i) line(`rest /= ${size};`);
    }
    const x = scalar(s.expr);
    line(`buffers[${id}][flat] = ${x};`);
    return `__global__ void kernel${j}(float* const* buffers, const I* dims, I count) {\n${lines.join('\n')}\n}`;
  });
  const statements = fn.statements.map((_, i) => i);
  const preloads = statements.map(i => `  CUDA(cudaFuncGetAttributes(&attributes, kernel${i}));`);
  const launches = statements.map(i => {
    const n = i + params.length;
    return `    if (grid[${i}]) {
      kernel${i}<<<grid[${i}], ${threads}>>>(device_buffers, device_dims, sizes[${n}]);
      CUDA(cudaGetLastError());
    }`;
  });
  const shapeBindings = [...symbols.values()].map(s => `  dims[${s.slot}] = shape${s.param}[${s.axis}];`);
  const evalDims = dims.map((a, i) => {
    const sum = a.terms.reduce(
      (acc, [name, k]) =>
        `safe(__int128(${acc}) + safe(__int128(dims[${symbols.get(name)!.slot}]) * ${ll(k)}))`,
      ll(a.constant),
    );
    return `  dims[${symbols.size + i}] = extent(${sum});`;
  });
  const shapeChecks = params.flatMap((p, i) =>
    p.shape.map(
      (_, axis) => `  require(shape${i}[${axis}] == ${shapes[i][axis]}, "Inconsistent input shape");`,
    ),
  );
  const nDims = symbols.size + dims.length;
  const nTensors = tensors.length;
  return `${helpers}
${kernels.join('\n\n')}

void run_case(FILE* in, FILE* out, int max_grid, bool benchmark) {
  float* buffers[${nTensors}] = {};
  ${params.map((p, i) => `I shape${i}[${p.shape.length}];`).join('\n  ')}
  ${params.map((_, i) => `for (I& d : shape${i}) d = extent(read<I>(in));`).join('\n  ')}
  I dims[${nDims}];
${[...shapeBindings, ...evalDims, ...shapeChecks].join('\n')}
  I sizes[${nTensors}] = {};
  auto elements = [](std::initializer_list<I> shape) {
    for (I d : shape) if (!d) return I(0);
    I n = 1;
    for (I d : shape) n = safe(__int128(n) * d);
    return n;
  };
${shapes.map((s, i) => `  sizes[${i}] = elements({${s.join(', ')}});`).join('\n')}
  for (int i = 0; i < ${nTensors}; ++i) {
    I n = sizes[i];
    if (!n) continue;
    CUDA(cudaMalloc(&buffers[i], n * sizeof(float)));
    if (i < ${params.length}) {
      std::vector<float> bytes(n);
      require(fread(bytes.data(), sizeof(float), n, in) == size_t(n), "Truncated input tensor");
      CUDA(cudaMemcpy(buffers[i], bytes.data(), n * sizeof(float), cudaMemcpyHostToDevice));
    }
  }
  unsigned grid[${Math.max(statements.length, 1)}] = {};
  bool work = false;
  for (int i = 0; i < ${statements.length}; ++i) {
    I blocks = (sizes[i + ${params.length}] + ${threads - 1}) / ${threads};
    require(blocks <= max_grid, "Output exceeds CUDA launch grid");
    grid[i] = unsigned(blocks);
    work |= blocks != 0;
  }
  float** device_buffers = nullptr;
  I* device_dims = nullptr;
  cudaEvent_t start, stop;
  if (work) {
    CUDA(cudaMalloc(&device_buffers, sizeof(buffers)));
    CUDA(cudaMalloc(&device_dims, sizeof(dims)));
    CUDA(cudaMemcpy(device_buffers, buffers, sizeof(buffers), cudaMemcpyHostToDevice));
    CUDA(cudaMemcpy(device_dims, dims, sizeof(dims), cudaMemcpyHostToDevice));
    CUDA(cudaEventCreate(&start));
    CUDA(cudaEventCreate(&stop));
  }
  auto launch = [&] {
${launches.join('\n')}
  };
  U repeats = benchmark ? 5 : 1;
  if (benchmark && work) { launch(); CUDA(cudaDeviceSynchronize()); }
  write<U>(out, ${fn.shape.length});
  ${shapes[result].map(d => `write<I>(out, ${d});`).join('\n  ')}
  write<U>(out, repeats);
  for (U r = 0; r < repeats; ++r) {
    float ms = 0.0f;
    if (work) {
      CUDA(cudaEventRecord(start));
      launch();
      CUDA(cudaEventRecord(stop));
      CUDA(cudaEventSynchronize(stop));
      CUDA(cudaEventElapsedTime(&ms, start, stop));
    }
    write<float>(out, ms);
  }
  I n = sizes[${result}];
  if (n) {
    std::vector<float> bytes(n);
    CUDA(cudaMemcpy(bytes.data(), buffers[${result}], n * sizeof(float), cudaMemcpyDeviceToHost));
    require(fwrite(bytes.data(), sizeof(float), n, out) == size_t(n), "Cannot write result tensor");
  }
  if (work) {
    CUDA(cudaEventDestroy(start));
    CUDA(cudaEventDestroy(stop));
    CUDA(cudaFree(device_buffers));
    CUDA(cudaFree(device_dims));
  }
  for (float* ptr : buffers) if (ptr) CUDA(cudaFree(ptr));
}

int main(int argc, char** argv) {
  bool benchmark = argc == 2 && strcmp(argv[1], "--benchmark") == 0;
  require(argc == 1 || benchmark, "Expected no args or --benchmark");
  FILE* in = fopen("inputs.bin", "rb");
  require(in != nullptr, "Cannot open inputs.bin");
  require(read<U>(in) == ${inputMagic}u, "Wrong input ABI");
  U count = read<U>(in);
  FILE* out = fopen("out/result.bin", "wb");
  require(out != nullptr, "Cannot create out/result.bin");
  write<U>(out, ${resultMagic}u);
  write<U>(out, count);
  cudaDeviceProp p;
  int device, runtime, driver;
  CUDA(cudaGetDevice(&device));
  CUDA(cudaGetDeviceProperties(&p, device));
  CUDA(cudaRuntimeGetVersion(&runtime));
  CUDA(cudaDriverGetVersion(&driver));
  printf("%s sm_%d%d nvcc %d.%d.%d runtime %d driver %d\\n", p.name, p.major, p.minor,
         __CUDACC_VER_MAJOR__, __CUDACC_VER_MINOR__, __CUDACC_VER_BUILD__, runtime, driver);
  ${preloads.length ? 'cudaFuncAttributes attributes;' : ''}
${preloads.join('\n')}
  for (U i = 0; i < count; ++i) run_case(in, out, p.maxGridSize[0], benchmark);
  require(fgetc(in) == EOF && !ferror(in), "Trailing or unreadable input");
  fclose(in);
  require(fclose(out) == 0, "Cannot finish result");
}
`;
}
