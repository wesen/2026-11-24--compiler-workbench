import { planKernels, type KernelPlan } from './fusion.js';
import { plain, visit, width, type Affine, type Expr, type Fn, type Tensor } from './model.js';

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

interface Names {
  dims: ReadonlyMap<string, string>;
  tensors: ReadonlyMap<string, Tensor>;
  tensorName: (name: string) => string;
}

interface Emitted {
  code: string;
  /** Host declarations this kernel needs before the preload section (counts, rows). */
  decls: readonly string[];
  preload: string;
  hasWork: string;
  launch: string;
}

/**
 * Scalar expression walker for the fused kernels. A read is resolved by `resolve`: a group member
 * through its staged or local value (the fusion's legality rules guarantee the load lands there),
 * anything else through global memory at the affine offset. Reductions become sequential loop nests in
 * the IR's axis order with the meaning's initializer and one rounding per fold, exactly as the stage-2
 * per-statement kernels emit them.
 */
function scalar(
  e: Expr,
  env: {
    line: (code: string) => void;
    state: { indent: string; next: number };
    bind: (id: string) => string;
    index: (id: string) => string;
    dim: (a: Affine) => string;
    resolve: (name: string, indices: string[]) => string | undefined;
    dims: ReadonlyMap<string, string>;
    tensors: ReadonlyMap<string, Tensor>;
    tensorName: (name: string) => string;
  },
): string {
  const temporary = (code: string) => {
    const name = `v${env.state.next++}`;
    env.line(`float ${name} = ${code};`);
    return name;
  };
  switch (e.kind) {
    case 'literal':
      return literal(e.text);
    case 'shape':
      return `__ll2float_rn(${env.dims.get(e.name)!})`;
    case 'load': {
      const shape = env.tensors.get(e.name)!.shape;
      const indices = e.indices.map(a => affine(a, env.index));
      const fused = env.resolve(e.name, indices);
      if (fused !== undefined) return fused;
      const offset = indices.reduce(
        (prior, a, i) => (i ? `(${prior} * ${env.dim(shape[i])} + ${a})` : a),
        '',
      );
      return `${env.tensorName(e.name)}[${offset}]`;
    }
    case 'op': {
      const [a, b] = e.args.map(x => scalar(x, env));
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
        const axis = env.bind(id),
          n = env.dim(extent.dim);
        let bound = n;
        if (extent.kind === 'blocks') {
          const tail = extent.rounding === 'ceil' ? ` + (${n} % ${width} != 0)` : '';
          bound = `${n} / ${width}${tail}`;
        }
        if (extent.kind === 'tail') {
          const remaining = `(${n} - ${width}LL * ${env.index(extent.block)})`;
          bound = `(${remaining} < ${width}LL ? ${remaining} : ${width}LL)`;
        }
        env.line(`const I end_${axis} = ${bound};`);
        env.line(`for (I ${axis} = 0; ${axis} < end_${axis}; ++${axis}) {`);
        env.state.indent += '  ';
      }
      const value = scalar(e.body, env);
      env.line(
        `${acc} = ${e.op === 'sum' ? `__fadd_rn(${acc}, ${value})` : `minmax(${acc}, ${value}, true)`};`,
      );
      for (const _axis of e.axes) {
        env.state.indent = env.state.indent.slice(2);
        env.line('}');
      }
      return acc;
    }
  }
}

function readPointers(g: KernelPlan): Set<string> {
  const reads = new Set<string>();
  for (const m of g.members)
    visit(m.expr, e => {
      if (e.kind === 'load' && !g.roles.has(e.name)) reads.add(e.name);
    });
  return reads;
}

function kernelSignature(g: KernelPlan, reads: Set<string>, names: Names) {
  const { dims, tensorName } = names;
  const order = [...dims.values(), ...reads, ...g.writes];
  const params = [
    ...Array.from(dims.values(), d => `I ${d}`),
    ...Array.from(reads, t => `const float* ${tensorName(t)}`),
    ...g.writes.map(t => `float* ${tensorName(t)}`),
  ];
  return {
    params: params.join(', '),
    args: order.map((arg, i) => (i < dims.size ? arg : tensorName(arg) + '.ptr')).join(', '),
  };
}

function makeBinders(pre: readonly [string, string][], state: { next: number }) {
  const map = new Map<string, string>(pre);
  return {
    bind: (id: string) => {
      let name = map.get(id);
      if (name === undefined) {
        name = `i${state.next++}`;
        map.set(id, name);
      }
      return name;
    },
    index: (id: string) => {
      const name = map.get(id);
      if (name === undefined) throw Error('Unbound binder ' + id);
      return name;
    },
  };
}

/** Elementwise chain or epilogue: one thread per element of the shared domain, one local per member. */
function emitFlatKernel(g: KernelPlan, kernel: string, names: Names): Emitted {
  const { dims, tensorName } = names;
  const reads = readPointers(g);
  const d = g.driver;
  const { params, args } = kernelSignature(g, reads, names);
  const lines = [`__global__ void ${kernel}(${params}, U count) {`];
  const state = { indent: '  ', next: 0 };
  const line = (code: string) => lines.push(state.indent + code);
  const dim = (a: Affine) => affine(a, n => dims.get(n)!);
  line('const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
  line('if (thread >= count) return;');
  line('U coordinate = thread;');
  const coordinate: string[] = [];
  for (let i = d.axes.length - 1; i >= 0; --i) {
    const axis = `i${state.next++}`;
    coordinate[i] = axis;
    line(`const I ${axis} = coordinate % ${dim(d.shape[i])};`);
    if (i > 0) line(`coordinate /= ${dim(d.shape[i])};`);
  }
  const pre: [string, string][] = g.members.flatMap(m =>
    m.axes.map((a, k) => [a.id, coordinate[k]] as [string, string]),
  );
  const bound = makeBinders(pre, state);
  const locals = new Map<string, string>();
  for (const m of g.members) {
    const value = scalar(m.expr, {
      line,
      state,
      bind: bound.bind,
      index: bound.index,
      dim,
      resolve: t => locals.get(t),
      dims,
      tensors: names.tensors,
      tensorName,
    });
    locals.set(m.name, value);
    if (g.writes.includes(m.name)) line(`${tensorName(m.name)}[thread] = ${value};`);
  }
  lines.push('}');
  const count = `count_${kernel}`;
  const shape = `shape_${tensorName(d.name)}`;
  return {
    code: lines.join('\n'),
    decls: [`  const U ${count} = elements(${shape});`],
    preload: `  if (${count}) check(cudaFuncGetAttributes(&attributes, ${kernel}));`,
    hasWork: count,
    launch: `    if (${count}) {
      ${kernel}<<<(${count} - 1) / 256 + 1, 256>>>(${args}, ${count});
      check(cudaGetLastError());
    }`,
  };
}

/**
 * Row fusion: one block per row of the driver's non-row axes. Row-element members are staged through
 * shared memory, so their loads and stores coalesce; row-scalar members are computed once per row by
 * thread 0, whose reductions fold sequentially in the meaning's order. No thread returns early: every
 * thread reaches every barrier.
 */
function emitRowKernel(g: KernelPlan, kernel: string, names: Names): Emitted {
  const { dims, tensorName } = names;
  const reads = readPointers(g);
  const d = g.driver;
  const rank = d.shape.length;
  const { params, args } = kernelSignature(g, reads, names);
  const lines = [`__global__ void ${kernel}(${params}, U rowLen) {`];
  const state = { indent: '  ', next: 0 };
  const line = (code: string) => lines.push(state.indent + code);
  const dim = (a: Affine) => affine(a, n => dims.get(n)!);
  line('extern __shared__ float sh[];');
  line('U coordinate = blockIdx.x;');
  const coordinate: string[] = [];
  for (let i = rank - 2; i >= 0; --i) {
    const axis = `i${state.next++}`;
    coordinate[i] = axis;
    line(`const I ${axis} = coordinate % ${dim(d.shape[i])};`);
    if (i > 0) line(`coordinate /= ${dim(d.shape[i])};`);
  }
  let flat = coordinate[0];
  for (let i = 1; i < rank - 1; i++) flat = `(${flat} * ${dim(d.shape[i])} + ${coordinate[i]})`;
  line(`const U rowFlat = static_cast<U>(${flat});`);
  line('const U rowBase = rowFlat * rowLen;');
  line('const U span = rowLen < 1 ? 1 : rowLen;');
  const arrays = new Map<string, string>();
  g.staged.forEach((t, k) => arrays.set(t, `s${k}`));
  arrays.forEach((s, t) => line(`float* ${s} = sh + ${kOffset(arrays, t)};`));
  const cells = new Map<string, string>();
  g.slots.forEach((t, k) => cells.set(t, `c${k}`));
  cells.forEach((c, t) => line(`float* ${c} = sh + ${g.staged.length} * span + ${cellsIndexOf(cells, t)};`));
  const pre: [string, string][] = g.members.flatMap(m =>
    m.axes.map((a, k) => [a.id, k < rank - 1 ? coordinate[k] : 'j'] as [string, string]),
  );
  const bound = makeBinders(pre, state);
  const resolve = (t: string, indices: string[]) =>
    arrays.get(t) !== undefined
      ? `${arrays.get(t)!}[${indices[rank - 1]}]`
      : cells.get(t) !== undefined
        ? `${cells.get(t)!}[0]`
        : undefined;
  for (const m of g.members) {
    if (g.roles.get(m.name) === 'element') {
      line('{');
      state.indent += '  ';
      line(
        'for (I j = static_cast<I>(threadIdx.x); j < static_cast<I>(rowLen); j += static_cast<I>(blockDim.x)) {',
      );
      state.indent += '  ';
      const value = scalar(m.expr, {
        line,
        state,
        bind: bound.bind,
        index: bound.index,
        dim,
        resolve,
        dims,
        tensors: names.tensors,
        tensorName,
      });
      if (arrays.has(m.name)) line(`${arrays.get(m.name)!}[j] = ${value};`);
      if (g.writes.includes(m.name)) line(`${tensorName(m.name)}[rowBase + j] = ${value};`);
      state.indent = state.indent.slice(2);
      line('}');
      state.indent = state.indent.slice(2);
      line('}');
    } else {
      line('__syncthreads();');
      line('if (threadIdx.x == 0) {');
      state.indent += '  ';
      const value = scalar(m.expr, {
        line,
        state,
        bind: bound.bind,
        index: bound.index,
        dim,
        resolve,
        dims,
        tensors: names.tensors,
        tensorName,
      });
      if (cells.has(m.name)) line(`${cells.get(m.name)!}[0] = ${value};`);
      if (g.writes.includes(m.name)) line(`${tensorName(m.name)}[rowFlat] = ${value};`);
      state.indent = state.indent.slice(2);
      line('}');
    }
    line('__syncthreads();');
  }
  lines.push('}');
  const shape = `shape_${tensorName(d.name)}`;
  const rows = `rows_${kernel}`;
  const prefix = Array.from({ length: rank - 1 }, (_, i) => `${shape}[${i}]`).join(' * ');
  return {
    code: lines.join('\n'),
    decls: [`  const U ${rows} = ${prefix};`],
    preload: `  check(cudaFuncSetAttribute(${kernel}, cudaFuncAttributeMaxDynamicSharedMemorySize, smemMax));
  if (${rows}) check(cudaFuncGetAttributes(&attributes, ${kernel}));`,
    hasWork: rows,
    launch: `    if (${rows}) {
      const U rowLenHost = static_cast<U>(${shape}[${rank - 1}]);
      const U shared = (${g.staged.length} * (rowLenHost < 1 ? 1 : rowLenHost) + ${g.slots.length}) * sizeof(float);
      if (shared > static_cast<U>(smemMax)) throw std::runtime_error("fused row exceeds shared memory");
      ${kernel}<<<static_cast<unsigned>(${rows}), 256, static_cast<unsigned>(shared)>>>(
          ${args}, rowLenHost);
      check(cudaGetLastError());
    }`,
  };
}

function kOffset(arrays: Map<string, string>, t: string): string {
  const k = [...arrays.keys()].indexOf(t);
  return k ? `${k} * span` : '0';
}

function cellsIndexOf(cells: Map<string, string>, t: string): number {
  return [...cells.keys()].indexOf(t);
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
    decls: [] as string[],
    preload: `  if (${count}) check(cudaFuncGetAttributes(&attributes, ${kernel}));`,
    hasWork: count,
    launch: `    if (${count}) {
      ${kernel}<<<(${count} - 1) / 256 + 1, 256>>>(${args.map((arg, i) => (i < dimensions.size ? arg : arg + '.ptr')).join(', ')}, ${count});
      check(cudaGetLastError());
    }`,
  };
}

export interface CudaKernel {
  readonly form: 'single' | 'flat' | 'row';
  readonly statements: readonly string[];
}
export interface CudaUnit {
  readonly fn: string;
  readonly source: string;
  readonly kernels: readonly CudaKernel[];
}

export function lowerCuda(fn: Fn, fuse = true): CudaUnit {
  const plans = planKernels(fn, fuse);
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
  const names_: Names = { dims, tensors, tensorName: name };
  const emitted = plans.map((g, i) => {
    const kernel = `k${i}`;
    if (g.form === 'single') return emitKernel(g.driver, kernel, dims, tensors, name);
    if (g.form === 'flat') return emitFlatKernel(g, kernel, names_);
    return emitRowKernel(g, kernel, names_);
  });
  const declared = new Set<string>();
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
  if (emitted.length) {
    host.push(...bindings);
    for (const p of fn.params) {
      const t = name(p.name);
      host.push(`  DeviceBuffer ${t}(host_${t}.size());`, `  ${t}.upload(host_${t}.data());`);
    }
    const written = new Set<string>();
    plans.forEach((g, i) => {
      const t = name(g.driver.name);
      if (g.form !== 'single') {
        const dimsText = g.driver.shape.map(a => affine(a, key => dims.get(key)!)).join(', ');
        if (!declared.has(g.driver.name)) {
          declared.add(g.driver.name);
          host.push(`  const std::array<I, ${g.driver.shape.length}> shape_${t}{${dimsText}};`);
        }
        host.push(...emitted[i].decls);
      }
      for (const w of g.writes) {
        if (!declared.has(w)) {
          declared.add(w);
          const s = tensors.get(w)!;
          const dimsText = s.shape.map(a => affine(a, key => dims.get(key)!)).join(', ');
          host.push(`  const std::array<I, ${s.shape.length}> shape_${name(w)}{${dimsText}};`);
        }
        written.add(w);
        host.push(`  DeviceBuffer ${name(w)}(elements(shape_${name(w)}));`);
      }
    });
    host.push('  cudaFuncAttributes attributes;');
    if (plans.some(g => g.form === 'row'))
      host.push(
        '  int smemMax = 0;',
        '  check(cudaDeviceGetAttribute(&smemMax, cudaDevAttrMaxSharedMemoryPerBlockOptin, 0));',
      );
    host.push(
      ...emitted.map(k => k.preload),
      `  if (${emitted.map(k => k.hasWork).join(' || ')}) gpu_ms = time_kernels([&] {`,
      ...emitted.map(k => k.launch),
      '  }, benchmark);',
    );
    if (written.has(fn.result)) {
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
  return {
    fn: fn.name,
    source: [support, ...emitted.map(k => k.code), host.join('\n'), main].join('\n\n'),
    kernels: plans.map(g => ({ form: g.form, statements: g.members.map(m => m.name) })),
  };
}

export function emitCuda(fn: Fn, fuse = true): string {
  return lowerCuda(fn, fuse).source;
}
