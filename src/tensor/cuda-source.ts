import { plain, visit, width, type Affine, type Expr, type Fn, type Tensor } from './model.js';
import { inline } from './passes.js';

const support = String.raw`
#include <cuda_runtime.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <vector>

using I = int64_t;
using U = uint64_t;

static void check(cudaError_t status) {
  if (status != cudaSuccess) throw std::runtime_error(cudaGetErrorString(status));
}

__device__ static float minmax(float a, float b, bool maximum) {
  if (isnan(a) || isnan(b)) return __uint_as_float(0x7fc00000);
  if (a == b) {
    unsigned x = __float_as_uint(a), y = __float_as_uint(b);
    return __uint_as_float(maximum ? x & y : x | y);
  }
  return (maximum ? a > b : a < b) ? a : b;
}

struct DeviceBuffer {
  float* ptr = nullptr;
  U size;
  explicit DeviceBuffer(U n) : size(n) {
    if (size) check(cudaMalloc(&ptr, size * sizeof(float)));
  }
  ~DeviceBuffer() { if (ptr) cudaFree(ptr); }
  DeviceBuffer(const DeviceBuffer&) = delete;
  void upload(const float* src) const {
    if (size) check(cudaMemcpy(ptr, src, size * sizeof(float), cudaMemcpyHostToDevice));
  }
  void download(float* dst) const {
    if (size) check(cudaMemcpy(dst, ptr, size * sizeof(float), cudaMemcpyDeviceToHost));
  }
};

template <size_t N> static U elements(const std::array<I, N>& shape) {
  U n = 1;
  for (I extent : shape) n *= static_cast<U>(extent);
  return n;
}

template <class T> static void read(FILE* file, T* ptr, size_t count) {
  if (count && fread(ptr, sizeof(T), count, file) != count) throw std::runtime_error("short CUDA request");
}

template <class T> static void write(FILE* file, const T* ptr, size_t count) {
  if (count && fwrite(ptr, sizeof(T), count, file) != count) throw std::runtime_error("short CUDA response");
}

struct Event {
  cudaEvent_t handle;
  Event() { check(cudaEventCreate(&handle)); }
  ~Event() { cudaEventDestroy(handle); }
};

template <class Launch> static double time_kernels(const Launch& launch, bool benchmark) {
  Event start, stop;
  if (benchmark) {
    launch();
    check(cudaDeviceSynchronize());
  }
  std::array<float, 3> ms{};
  const int repeats = benchmark ? ms.size() : 1;
  for (int i = 0; i < repeats; ++i) {
    check(cudaEventRecord(start.handle));
    launch();
    check(cudaEventRecord(stop.handle));
    check(cudaEventSynchronize(stop.handle));
    check(cudaEventElapsedTime(&ms[i], start.handle, stop.handle));
  }
  if (benchmark) std::sort(ms.begin(), ms.end());
  return ms[repeats / 2];
}
`;

const main = String.raw`
int main(int argc, char** argv) {
  try {
    using File = std::unique_ptr<FILE, decltype(&fclose)>;
    File input(fopen("inputs.bin", "rb"), fclose);
    File output(fopen("out/results.bin", "wb"), fclose);
    if (!input || !output) throw std::runtime_error("cannot open CUDA request or response");
    const char magic[] = "TIXCUDA1";
    char header[8];
    read(input.get(), header, sizeof(header));
    if (memcmp(header, magic, sizeof(header))) throw std::runtime_error("bad CUDA request header");
    U count;
    read(input.get(), &count, 1);
    write(output.get(), magic, sizeof(header));
    write(output.get(), &count, 1);
    const bool benchmark = argc == 2 && strcmp(argv[1], "--benchmark") == 0;
    for (U i = 0; i < count; ++i) run_case(input.get(), output.get(), benchmark);
    if (fgetc(input.get()) != EOF || ferror(input.get())) throw std::runtime_error("trailing CUDA request data");
    if (fclose(output.release())) throw std::runtime_error("cannot close CUDA response");
    return 0;
  } catch (const std::exception& error) {
    fprintf(stderr, "%s\n", error.what());
    return 1;
  }
}
`;

function affine(a: Affine, name: (key: string) => string): string {
  const terms = a.terms.map(([key, coefficient]) =>
    coefficient === 1 ? name(key) : `${coefficient}LL * ${name(key)}`,
  );
  if (a.constant || !terms.length) terms.unshift(`${a.constant}LL`);
  return `(${terms.join(' + ')})`;
}

function literal(text: string): string {
  const bytes = new DataView(new ArrayBuffer(4));
  bytes.setFloat32(0, Number(text));
  return `__uint_as_float(0x${bytes.getUint32(0).toString(16)}u)`;
}

function emitKernel(
  statement: Fn['statements'][number],
  kernel: string,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
) {
  const reads = new Set<string>();
  visit(statement.expr, e => {
    if (e.kind === 'load') reads.add(e.name);
  });
  const args = [...dimensions.values(), ...Array.from(reads, tensorName), tensorName(statement.name)];
  const params = [
    ...Array.from(dimensions.values(), d => `I ${d}`),
    ...Array.from(reads, t => `const float* ${tensorName(t)}`),
    'float* result',
    'U count',
  ];
  const lines = [`__global__ void ${kernel}(${params.join(', ')}) {`];
  let indent = '  ',
    next = 0;
  const line = (code: string) => lines.push(indent + code);
  const dim = (a: Affine) => affine(a, n => dimensions.get(n)!);
  const indices = new Map<string, string>();
  const bind = (id: string) => {
    const name = `i${indices.size}`;
    indices.set(id, name);
    return name;
  };
  const index = (id: string) => indices.get(id)!;
  line('const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
  line('if (thread >= count) return;');
  line('U coordinate = thread;');
  for (let i = statement.axes.length - 1; i >= 0; --i) {
    const axis = bind(statement.axes[i].id);
    line(`const I ${axis} = coordinate % ${dim(statement.shape[i])};`);
    if (i > 0) line(`coordinate /= ${dim(statement.shape[i])};`);
  }

  const temporary = (code: string) => {
    const name = `v${next++}`;
    line(`float ${name} = ${code};`);
    return name;
  };

  function scalar(e: Expr): string {
    switch (e.kind) {
      case 'literal':
        return literal(e.text);
      case 'shape':
        return `__ll2float_rn(${dimensions.get(e.name)!})`;
      case 'load': {
        const shape = tensors.get(e.name)!.shape;
        const offset = e.indices.reduce(
          (prior, a, i) => (i ? `(${prior} * ${dim(shape[i])} + ${affine(a, index)})` : affine(a, index)),
          '',
        );
        return `${tensorName(e.name)}[${offset}]`;
      }
      case 'op': {
        const [a, b] = e.args.map(scalar);
        switch (e.op) {
          case '+':
            return temporary(`__fadd_rn(${a}, ${b})`);
          case '-':
            return temporary(`__fsub_rn(${a}, ${b})`);
          case '*':
            return temporary(`__fmul_rn(${a}, ${b})`);
          case '/':
            return temporary(`__fdiv_rn(${a}, ${b})`);
          case 'neg':
            return temporary(`-(${a})`);
          case 'sqrt':
            return temporary(`__fsqrt_rn(${a})`);
          case 'exp':
          case 'log':
          case 'tanh':
            return temporary(`__double2float_rn(${e.op}(static_cast<double>(${a})))`);
          case 'max':
          case 'min':
            return temporary(`minmax(${a}, ${b}, ${e.op === 'max'})`);
        }
      }
      case 'reduce': {
        const acc = temporary(e.op === 'sum' ? '0.0f' : '-INFINITY');
        for (const { id, extent } of e.axes) {
          const axis = bind(id),
            n = dim(extent.dim);
          let bound = n;
          if (extent.kind === 'blocks') {
            const tail = extent.rounding === 'ceil' ? ` + (${n} % ${width} != 0)` : '';
            bound = `${n} / ${width}${tail}`;
          }
          if (extent.kind === 'tail') {
            const remaining = `(${n} - ${width}LL * ${index(extent.block)})`;
            bound = `(${remaining} < ${width}LL ? ${remaining} : ${width}LL)`;
          }
          line(`const I end_${axis} = ${bound};`);
          line(`for (I ${axis} = 0; ${axis} < end_${axis}; ++${axis}) {`);
          indent += '  ';
        }
        const value = scalar(e.body);
        line(
          `${acc} = ${e.op === 'sum' ? `__fadd_rn(${acc}, ${value})` : `minmax(${acc}, ${value}, true)`};`,
        );
        for (const _axis of e.axes) {
          indent = indent.slice(2);
          line('}');
        }
        return acc;
      }
    }
  }
  const result = scalar(statement.expr);
  line(`result[thread] = ${result};`);
  lines.push('}');
  const count = `${tensorName(statement.name)}.size`;
  return {
    code: lines.join('\n'),
    preload: `  if (${count}) check(cudaFuncGetAttributes(&attributes, ${kernel}));`,
    hasWork: count,
    launch: `    if (${count}) {
      ${kernel}<<<(${count} - 1) / 256 + 1, 256>>>(${args.map((arg, i) => (i < dimensions.size ? arg : arg + '.ptr')).join(', ')}, ${count});
      check(cudaGetLastError());
    }`,
  };
}

export function emitCuda(fn: Fn, options?: { fuse?: boolean }): string {
  if (options?.fuse !== false) fn = inline(fn, true);
  const all = [...fn.params, ...fn.statements];
  const tensors = new Map(all.map(t => [t.name, t]));
  const names = new Map(all.map((t, i) => [t.name, `t${i}`]));
  const name = (key: string) => names.get(key)!;
  const dims = new Map<string, string>(),
    bindings: string[] = [];
  for (const p of fn.params) {
    for (const [i, a] of p.shape.entries()) {
      const key = plain(a);
      if (key === undefined || dims.has(key)) continue;
      const d = `d${dims.size}`;
      dims.set(key, d);
      bindings.push(`  const I ${d} = shape_${name(p.name)}[${i}];`);
    }
  }
  const kernels = fn.statements.map((s, i) => emitKernel(s, `k${i}`, dims, tensors, name));
  const host = ['static void run_case(FILE* input, FILE* output, bool benchmark) {'];
  for (const p of fn.params) {
    const t = name(p.name);
    host.push(
      `  std::array<I, ${p.shape.length}> shape_${t};`,
      `  read(input, shape_${t}.data(), shape_${t}.size());`,
      `  std::vector<float> host_${t}(elements(shape_${t}));`,
      `  read(input, host_${t}.data(), host_${t}.size());`,
    );
  }
  const result = name(fn.result);
  let buffer = `host_${result}`;
  host.push('  double gpu_ms = 0;');
  if (kernels.length) {
    host.push(...bindings);
    for (const p of fn.params) {
      const t = name(p.name);
      host.push(`  DeviceBuffer ${t}(host_${t}.size());`, `  ${t}.upload(host_${t}.data());`);
    }
    for (const s of fn.statements) {
      const t = name(s.name);
      const dimsText = s.shape.map(a => affine(a, key => dims.get(key)!)).join(', ');
      host.push(
        `  const std::array<I, ${s.shape.length}> shape_${t}{${dimsText}};`,
        `  DeviceBuffer ${t}(elements(shape_${t}));`,
      );
    }
    host.push(
      '  cudaFuncAttributes attributes;',
      ...kernels.map(k => k.preload),
      `  if (${kernels.map(k => k.hasWork).join(' || ')}) gpu_ms = time_kernels([&] {`,
      ...kernels.map(k => k.launch),
      '  }, benchmark);',
    );
    if (fn.statements.some(s => s.name === fn.result)) {
      buffer = `host_${result}`;
      host.push(`  std::vector<float> ${buffer}(${result}.size);`, `  ${result}.download(${buffer}.data());`);
    }
  }
  host.push(
    `  write(output, shape_${result}.data(), shape_${result}.size());`,
    `  write(output, ${buffer}.data(), ${buffer}.size());`,
    '  write(output, &gpu_ms, 1);',
    '}',
  );
  return [support, ...kernels.map(k => k.code), host.join('\n'), main].join('\n\n');
}
