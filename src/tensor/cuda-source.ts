import { plain, visit, width, type Affine, type Axis, type Expr, type Fn, type Op } from './model.js';

export const cudaProtocol = 0x31584954; // TIX1, little endian
export const shapeSymbols = (fn: Fn) =>
  [...new Set(fn.params.flatMap(p => p.shape.map(plain).filter((n): n is string => n !== undefined)))].sort();

const ops: Record<Op, string> = {
  '+': '__fadd_rn',
  '-': '__fsub_rn',
  '*': '__fmul_rn',
  '/': '__fdiv_rn',
  neg: 'negate',
  exp: 'expf',
  log: 'logf',
  sqrt: '__fsqrt_rn',
  tanh: 'tanhf',
  max: 'tix_max',
  min: 'tix_min',
};

const harness = `#include <cuda_runtime.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <initializer_list>
#include <vector>

using I = long long;
static_assert(sizeof(I) == 8 && sizeof(float) == 4, "TIX1 word size");
constexpr uint32_t protocol = ${cudaProtocol};
constexpr unsigned threads = 128;

static void require(bool ok, const char* message) {
  if (!ok) { fprintf(stderr, "%s\\n", message); exit(1); }
}
#define CK(call) do { cudaError_t status = (call); require(status == cudaSuccess, cudaGetErrorString(status)); } while (0)

template<class T> static T read(FILE* f) {
  T value;
  require(fread(&value, sizeof(T), 1, f) == 1, "Truncated case bundle");
  return value;
}
template<class T> static void write(FILE* f, T value) {
  require(fwrite(&value, sizeof(T), 1, f) == 1, "Cannot write result bundle");
}
static I count(std::initializer_list<I> shape) {
  bool empty = false;
  for (I dim : shape) { require(dim >= 0, "Negative extent"); empty |= dim == 0; }
  if (empty) return 0;
  I n = 1;
  for (I dim : shape) { require(n <= INT64_MAX / dim, "Tensor size overflow"); n *= dim; }
  require(static_cast<uint64_t>(n) <= SIZE_MAX / sizeof(float), "Tensor byte size overflow");
  return n;
}
static unsigned blocks(I n, const cudaDeviceProp& device) {
  I grid = n / threads + (n % threads != 0);
  require(grid <= device.maxGridSize[0], "Tensor exceeds CUDA grid limit");
  return static_cast<unsigned>(grid);
}
struct DeviceBuffer {
  float* ptr = nullptr;
  explicit DeviceBuffer(I n) { if (n) CK(cudaMalloc(&ptr, size_t(n) * sizeof(float))); }
  ~DeviceBuffer() { if (ptr) cudaFree(ptr); }
  DeviceBuffer(const DeviceBuffer&) = delete;
};
static void upload(FILE* in, float* ptr, I n) {
  if (!n) return;
  std::vector<float> data(n);
  require(fread(data.data(), sizeof(float), n, in) == size_t(n), "Truncated tensor input");
  CK(cudaMemcpy(ptr, data.data(), size_t(n) * sizeof(float), cudaMemcpyHostToDevice));
}
static void download(FILE* out, const float* ptr, I n) {
  if (!n) return;
  std::vector<float> data(n);
  CK(cudaMemcpy(data.data(), ptr, size_t(n) * sizeof(float), cudaMemcpyDeviceToHost));
  require(fwrite(data.data(), sizeof(float), n, out) == size_t(n), "Cannot write tensor output");
}
static __device__ float negate(float x) { return __uint_as_float(__float_as_uint(x) ^ 0x80000000u); }
static __device__ float tix_max(float a, float b) {
  if (isnan(a)) return a;
  if (isnan(b)) return b;
  if (a == 0 && b == 0) return __uint_as_float(__float_as_uint(a) & __float_as_uint(b));
  return a > b ? a : b;
}
static __device__ float tix_min(float a, float b) {
  if (isnan(a)) return a;
  if (isnan(b)) return b;
  if (a == 0 && b == 0) return __uint_as_float(__float_as_uint(a) | __float_as_uint(b));
  return a < b ? a : b;
}
`;

export function emitCuda(fn: Fn): string {
  const tensors = [...fn.params, ...fn.statements];
  const tensor = new Map(tensors.map((t, i) => [t.name, { ...t, id: i }]));
  const symbols = shapeSymbols(fn);
  const dims = new Map(symbols.map((s, i) => [s, `s${i}`]));
  const lines: string[] = [harness];
  let depth = 0;
  const line = (s: string) => lines.push('  '.repeat(depth) + s);
  const block = (s: string, body: () => void, end = '}') => {
    line(s + ' {');
    depth++;
    body();
    depth--;
    line(end);
  };
  const affine = (a: Affine, names = dims) =>
    `(${a.constant}LL${a.terms.map(([n, k]) => ` + (${k}LL)*${names.get(n)!}`).join('')})`;
  const shape = (ds: Affine[]) => ds.map(d => affine(d)).join(', ');
  const literal = new DataView(new ArrayBuffer(4));
  const kernels = fn.statements.map((s, i) => {
    const reads = new Set<number>();
    const shapeUses = new Set<string>();
    const useShape = (a: Affine) => a.terms.forEach(([n]) => shapeUses.add(n));
    s.shape.forEach(useShape);
    visit(s.expr, e => {
      if (e.kind === 'shape') shapeUses.add(e.name);
      if (e.kind === 'reduce') e.axes.forEach(a => useShape(a.extent.dim));
      if (e.kind === 'load') {
        const t = tensor.get(e.name)!;
        reads.add(t.id);
        t.shape.slice(1).forEach(useShape);
      }
    });
    const id = `kernel${i}`;
    const output = tensor.get(s.name)!.id;
    const names = new Map<string, string>();
    let next = 0;
    const fresh = () => `v${next++}`;
    const temp = (type: string, expr: string) => {
      const v = fresh();
      line(`${type} ${v} = ${expr};`);
      return v;
    };
    function fold(axes: Axis[], j: number, body: () => void) {
      if (j === axes.length) return body();
      const { id, extent } = axes[j];
      const d = affine(extent.dim);
      const w = `${width}LL`;
      const limit =
        extent.kind === 'dim'
          ? d
          : extent.kind === 'tail'
            ? `min(${w}, ${d} - ${w}*${names.get(extent.block)!})`
            : extent.rounding === 'floor'
              ? `${d}/${w}`
              : `${d}/${w} + (${d}%${w} != 0)`;
      const end = temp('I', limit);
      const index = fresh();
      names.set(id, index);
      block(`for (I ${index} = 0; ${index} < ${end}; ++${index})`, () => fold(axes, j + 1, body));
      names.delete(id);
    }
    function expr(e: Expr): string {
      switch (e.kind) {
        case 'literal':
          literal.setFloat32(0, Number(e.text));
          return temp('float', `__uint_as_float(0x${literal.getUint32(0).toString(16)}u)`);
        case 'shape':
          return temp('float', `__ll2float_rn(${dims.get(e.name)!})`);
        case 'load': {
          const t = tensor.get(e.name)!;
          const offset = e.indices
            .slice(1)
            .reduce(
              (a, ix, j) => `(${a} * ${affine(t.shape[j + 1])} + ${affine(ix, names)})`,
              affine(e.indices[0], names),
            );
          return temp('float', `p${t.id}[${offset}]`);
        }
        case 'op':
          return temp('float', `${ops[e.op]}(${e.args.map(expr).join(', ')})`);
        case 'reduce': {
          const acc = temp('float', e.op === 'sum' ? '0.0f' : '__uint_as_float(0xff800000u)');
          fold(e.axes, 0, () => {
            const x = expr(e.body);
            line(`${acc} = ${e.op === 'sum' ? '__fadd_rn' : 'tix_max'}(${acc}, ${x});`);
          });
          return acc;
        }
      }
    }
    const usedDims = symbols.filter(n => shapeUses.has(n)).map(n => dims.get(n)!);
    const params = [...reads]
      .map(i => `const float* p${i}`)
      .concat(`float* p${output}`, ...usedDims.map(n => `I ${n}`), 'I n');
    block(`__global__ void ${id}(${params.join(', ')})`, () => {
      line('I linear = I(blockIdx.x) * blockDim.x + threadIdx.x;');
      line('if (linear >= n) return;');
      const rest = temp('I', 'linear');
      for (let j = s.axes.length - 1; j >= 0; j--) {
        if (!j) {
          names.set(s.axes[j].id, rest);
        } else {
          const d = temp('I', affine(s.shape[j]));
          line(`if (!${d}) return;`);
          names.set(s.axes[j].id, temp('I', `${rest} % ${d}`));
          line(`${rest} /= ${d};`);
        }
      }
      const result = expr(s.expr);
      line(`p${output}[linear] = ${result};`);
    });
    return {
      id,
      output,
      args: [...reads, output]
        .map(i => `b${i}.ptr`)
        .concat(usedDims, `n${output}`)
        .join(', '),
    };
  });

  block('static void run_case(FILE* in, FILE* out, const cudaDeviceProp& device, bool benchmark)', () => {
    line('auto case_id = read<uint32_t>(in);');
    // All shapes precede all parameter data in the wire format, so even forward bindings work.
    const bound = new Set<string>();
    fn.params.forEach((p, i) =>
      p.shape.forEach((a, j) => {
        line(`I d${i}_${j} = read<I>(in);`);
        line(`require(d${i}_${j} >= 0, "Negative input extent");`);
        const n = plain(a);
        if (n !== undefined && !bound.has(n)) {
          bound.add(n);
          line(`I ${dims.get(n)!} = d${i}_${j};`);
        }
      }),
    );
    fn.params.forEach((p, i) =>
      p.shape.forEach((a, j) => line(`require(d${i}_${j} == ${affine(a)}, "Inconsistent input extent");`)),
    );
    tensors.forEach((t, i) => {
      line(`I n${i} = count({${shape(t.shape)}});`);
      line(`DeviceBuffer b${i}(n${i});`);
      if (i < fn.params.length) line(`upload(in, b${i}.ptr, n${i});`);
    });
    line('cudaFuncAttributes attributes{};');
    kernels.forEach(k => {
      line(`unsigned grid${k.output} = blocks(n${k.output}, device);`);
      line(`if (grid${k.output}) CK(cudaFuncGetAttributes(&attributes, ${k.id}));`);
    });
    line(`bool launched = ${kernels.map(k => `grid${k.output}`).join(' || ') || 'false'};`);
    block(
      'auto launch = [&]()',
      () => {
        kernels.forEach(k => line(`if (grid${k.output}) ${k.id}<<<grid${k.output}, threads>>>(${k.args});`));
      },
      '};',
    );
    line('uint32_t reps = benchmark ? 3 : 1;');
    line('float times[3] = {};');
    block('if (launched)', () => {
      line('if (benchmark) { launch(); CK(cudaGetLastError()); CK(cudaDeviceSynchronize()); }');
      line('cudaEvent_t start, stop;');
      line('CK(cudaEventCreate(&start)); CK(cudaEventCreate(&stop));');
      block('for (uint32_t i = 0; i < reps; ++i)', () => {
        line('CK(cudaEventRecord(start));');
        line('launch();');
        line('CK(cudaEventRecord(stop));');
        line('CK(cudaEventSynchronize(stop)); CK(cudaGetLastError());');
        line('CK(cudaEventElapsedTime(&times[i], start, stop));');
      });
      line('CK(cudaEventDestroy(start)); CK(cudaEventDestroy(stop));');
    });
    line('write(out, case_id);');
    line('write(out, reps);');
    line('for (uint32_t i = 0; i < reps; ++i) write(out, times[i]);');
    fn.shape.forEach(a => line(`write(out, I${affine(a)});`));
    const res = tensor.get(fn.result)!.id;
    line(`download(out, b${res}.ptr, n${res});`);
  });
  block('int main(int argc, char** argv)', () => {
    line('bool benchmark = argc == 2 && strcmp(argv[1], "--benchmark") == 0;');
    line('FILE* in = fopen("cases.bin", "rb");');
    line('FILE* out = fopen("out/results.bin", "wb");');
    line('require(in && out, "Cannot open input/output bundle");');
    line('require(read<uint32_t>(in) == protocol, "Wrong input protocol");');
    line('auto cases = read<uint32_t>(in);');
    line('cudaDeviceProp device{};');
    line('CK(cudaSetDevice(0)); CK(cudaGetDeviceProperties(&device, 0));');
    line('printf("%s sm_%d%d nvcc %d.%d.%d\\n", device.name, device.major, device.minor,');
    line('       __CUDACC_VER_MAJOR__, __CUDACC_VER_MINOR__, __CUDACC_VER_BUILD__);');
    line('write(out, protocol); write(out, cases);');
    line('for (uint32_t i = 0; i < cases; ++i) run_case(in, out, device, benchmark);');
    line('require(fgetc(in) == EOF && !ferror(in), "Unexpected trailing case bytes");');
    line('fclose(in); require(fclose(out) == 0, "Cannot close result bundle");');
    line('return 0;');
  });
  return lines.join('\n') + '\n';
}
