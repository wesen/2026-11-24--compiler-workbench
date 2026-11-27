import { fusePlan, loadSites, stagedIndex, type PlanKernel } from './fusion.js';
import { plain, visit, width, type Affine, type Expr, type Extent, type Fn, type Tensor } from './model.js';

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
#include <string>
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

// Stage 2's block size for the flat mapping, unchanged.
const threads = 256;
// A fused kernel's reduction over the lane axis is one thread's serial fold, so how many rows can be folded at once
// is set by the number of resident blocks, 2048 threads per SM divided by the block size (probe 06 measured 128
// threads at 0.414 ms against 0.609 ms at 256 for softmax, and 0.158 against 0.181 for layernorm).
const rowThreads = 128;

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

/** Row-major offset of one element, as stage 2 computes it. */
function offset(shape: Affine[], values: string[], dim: (a: Affine) => string): string {
  return values.reduce((prior, value, i) => (i ? `(${prior} * ${dim(shape[i])} + ${value})` : value), '');
}

// One scalar-expression emitter for both lowerings: they must round at the same places, so there must not be two
// copies of this code. Only the address a load becomes and where the emitted lines go differ between them.
interface ScalarContext {
  line(code: string): void;
  indent(more: boolean): void;
  temporary(code: string): string;
  /** a shape value as f32 */
  shape(name: string): string;
  dim(a: Affine): string;
  /** the emitted name of a bound axis */
  index(id: string): string;
  /** the value of a load */
  load(name: string, indices: Affine[]): string;
  /** emit a name for a reduction binder and record it */
  bind(id: string, extent: Extent): string;
}

function scalarEmitter(c: ScalarContext): (e: Expr) => string {
  function scalar(e: Expr): string {
    switch (e.kind) {
      case 'literal':
        return literal(e.text);
      case 'shape':
        return c.shape(e.name);
      case 'load':
        return c.load(e.name, e.indices);
      case 'op': {
        const [a, b] = e.args.map(scalar);
        switch (e.op) {
          case '+':
            return c.temporary(`__fadd_rn(${a}, ${b})`);
          case '-':
            return c.temporary(`__fsub_rn(${a}, ${b})`);
          case '*':
            return c.temporary(`__fmul_rn(${a}, ${b})`);
          case '/':
            return c.temporary(`__fdiv_rn(${a}, ${b})`);
          case 'neg':
            return c.temporary(`-(${a})`);
          case 'sqrt':
            return c.temporary(`__fsqrt_rn(${a})`);
          case 'exp':
          case 'log':
          case 'tanh':
            return c.temporary(`__double2float_rn(${e.op}(static_cast<double>(${a})))`);
          case 'max':
          case 'min':
            return c.temporary(`minmax(${a}, ${b}, ${e.op === 'max'})`);
        }
      }
      case 'reduce': {
        // One fold step per iteration with a rounding after each, in increasing lexicographic order of the axes,
        // the first listed outermost. Whichever thread runs this loop, the sequence is the meaning's.
        const acc = c.temporary(e.op === 'sum' ? '0.0f' : '-INFINITY');
        for (const { id, extent } of e.axes) {
          const axis = c.bind(id, extent),
            n = c.dim(extent.dim);
          let bound = n;
          if (extent.kind === 'blocks') {
            const tail = extent.rounding === 'ceil' ? ` + (${n} % ${width} != 0)` : '';
            bound = `${n} / ${width}${tail}`;
          }
          if (extent.kind === 'tail') {
            const remaining = `(${n} - ${width}LL * ${c.index(extent.block)})`;
            bound = `(${remaining} < ${width}LL ? ${remaining} : ${width}LL)`;
          }
          c.line(`const I end_${axis} = ${bound};`);
          c.line(`for (I ${axis} = 0; ${axis} < end_${axis}; ++${axis}) {`);
          c.indent(true);
        }
        const value = scalar(e.body);
        c.line(
          `${acc} = ${e.op === 'sum' ? `__fadd_rn(${acc}, ${value})` : `minmax(${acc}, ${value}, true)`};`,
        );
        for (const _axis of e.axes) {
          c.indent(false);
          c.line('}');
        }
        return acc;
      }
    }
  }
  return scalar;
}

interface Emitted {
  code: string;
  /** run once per case before the timed interval, so lazy module loading stays out of the measurement */
  preload: string;
  /** counts the work the kernel has; a zero skips the launch */
  hasWork: string;
  launch: string;
}

type Statement = Fn['statements'][number];

/** Stage 2's kernel: one thread per output element. */
function flatKernel(
  statement: Statement,
  kernel: string,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
): Emitted {
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
    next = 0,
    bound = 0;
  const line = (code: string) => lines.push(indent + code);
  const dim = (a: Affine) => affine(a, n => dimensions.get(n)!);
  const indices = new Map<string, string>();
  line('const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
  line('if (thread >= count) return;');
  line('U coordinate = thread;');
  for (let i = statement.axes.length - 1; i >= 0; --i) {
    const axis = `i${bound++}`;
    indices.set(statement.axes[i].id, axis);
    line(`const I ${axis} = coordinate % ${dim(statement.shape[i])};`);
    if (i > 0) line(`coordinate /= ${dim(statement.shape[i])};`);
  }
  const scalar = scalarEmitter({
    line,
    indent: more => {
      indent = more ? indent + '  ' : indent.slice(2);
    },
    temporary: code => {
      const name = `v${next++}`;
      line(`float ${name} = ${code};`);
      return name;
    },
    shape: name => `__ll2float_rn(${dimensions.get(name)!})`,
    dim,
    index: id => indices.get(id)!,
    load: (name, loadIndices) =>
      `${tensorName(name)}[${offset(
        tensors.get(name)!.shape,
        loadIndices.map(a => affine(a, id => indices.get(id)!)),
        dim,
      )}]`,
    bind(id) {
      const axis = `i${bound++}`;
      indices.set(id, axis);
      return axis;
    },
  });
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

/**
 * A fused kernel: one block per row, one thread per lane. Statements run in definition order, a reduction over the
 * lane axis is one thread's serial fold, and a value that no other kernel reads is kept in shared memory.
 */
function rowKernel(
  kernel: PlanKernel,
  name: string,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
): Emitted {
  const dim = (a: Affine) => affine(a, n => dimensions.get(n)!);
  const staged = new Map<string, { pointer: string; lane: Affine | null }>();
  const prefetched = new Map<string, { pointer: string; extent: Affine }>();
  const pointers: string[] = [];
  let footprint = 'smem',
    floats: string[] = [];
  const slot = (pointer: string, extent: Affine | null) => {
    pointers.push(`  float* ${pointer} = ${footprint};`);
    const size = extent ? dim(extent) : '1';
    floats = [...floats, size];
    footprint = `${footprint} + ${size}`;
  };
  for (const p of kernel.statements) {
    if (p.storage !== 'shared') continue;
    const pointer = `p${staged.size}`;
    staged.set(p.statement.name, { pointer, lane: p.slots });
    slot(pointer, p.slots);
  }
  for (const p of kernel.prefetch) {
    const pointer = `q${prefetched.size}`;
    prefetched.set(p.tensor, { pointer, extent: p.extent });
    slot(pointer, p.extent);
  }
  const shared = floats.length ? `(${floats.join(' + ')}) * sizeof(float)` : '0';

  // A load reads the staged copy when that copy serves it; otherwise it goes to global memory, so the tensor has to
  // stay a kernel parameter.
  const redirect = (reader: Statement, tensor: string, scope: Map<string, Extent>, indices: Affine[]) => {
    const local = staged.get(tensor);
    if (local) return stagedIndex(reader, scope, indices, local.lane);
    const row = prefetched.get(tensor);
    return row ? stagedIndex(reader, scope, indices, row.extent) : false;
  };
  const reads = new Set<string>(),
    writes = new Set<string>();
  for (const p of kernel.statements) {
    for (const site of loadSites(p.statement))
      if (!redirect(p.statement, site.tensor, site.scope, site.indices)) reads.add(site.tensor);
    if (p.storage === 'global') writes.add(p.statement.name);
  }
  // The copy loops read the global rows they stage.
  for (const p of kernel.prefetch) reads.add(p.tensor);
  // A value the kernel both writes and reads (a permuted read of a global intermediate) is one parameter.
  const inputs = [...reads].filter(t => !writes.has(t));
  const params = [
    ...Array.from(dimensions.values(), d => `I ${d}`),
    ...inputs.map(t => `const float* ${tensorName(t)}`),
    ...Array.from(writes, t => `float* ${tensorName(t)}`),
  ];
  const args = [...dimensions.values(), ...[...inputs, ...writes].map(t => tensorName(t) + '.ptr')];
  const lines = [`__global__ void ${name}(${params.join(', ')}) {`];
  let indent = '  ',
    next = 0,
    bound = 0;
  const line = (code: string) => lines.push(indent + code);
  line('extern __shared__ float smem[];');
  line('const I b = static_cast<I>(blockIdx.x);');
  lines.push(...pointers);

  // The whole block copies a row in, so a fold that reads it issues coalesced loads and then works on chip.
  for (const p of kernel.prefetch) {
    const { pointer, extent } = prefetched.get(p.tensor)!;
    const lane = `m${next++}`;
    line(
      `for (I ${lane} = static_cast<I>(threadIdx.x); ${lane} < ${dim(extent)}; ${lane} += static_cast<I>(blockDim.x)) {`,
    );
    line(
      `  ${pointer}[${lane}] = ${tensorName(p.tensor)}[(b) * ${dim(tensors.get(p.tensor)!.shape[1])} + (${lane})];`,
    );
    line('}');
  }
  if (kernel.prefetch.length) line('__syncthreads();');

  for (const p of kernel.statements) {
    const statement = p.statement;
    const indices = new Map<string, string>();
    const scope = new Map<string, Extent>();
    indices.set(statement.axes[0].id, 'b');
    scope.set(statement.axes[0].id, statement.axes[0].extent);
    const scalar = scalarEmitter({
      line,
      indent: more => {
        indent = more ? indent + '  ' : indent.slice(2);
      },
      temporary: code => {
        const temporary = `v${next++}`;
        line(`float ${temporary} = ${code};`);
        return temporary;
      },
      shape: name => `__ll2float_rn(${dimensions.get(name)!})`,
      dim,
      index: id => indices.get(id)!,
      load: (tensor, loadIndices) => {
        const value = loadIndices.map(a => affine(a, id => indices.get(id)!));
        if (redirect(statement, tensor, scope, loadIndices)) {
          const pointer = (staged.get(tensor) ?? prefetched.get(tensor)!).pointer;
          return loadIndices.length === 1 ? `${pointer}[0]` : `${pointer}[${value[1]}]`;
        }
        return `${tensorName(tensor)}[${offset(tensors.get(tensor)!.shape, value, dim)}]`;
      },
      bind(id, extent) {
        const axis = `r${bound++}`;
        indices.set(id, axis);
        scope.set(id, extent);
        return axis;
      },
    });
    const lanes = statement.axes.length === 2 ? statement.axes[1] : undefined;
    const target = p.storage === 'shared' ? staged.get(statement.name)! : undefined;
    if (lanes) {
      const lane = `l${next++}`;
      indices.set(lanes.id, lane);
      scope.set(lanes.id, lanes.extent);
      line(
        `for (I ${lane} = static_cast<I>(threadIdx.x); ${lane} < ${dim(lanes.extent.dim)}; ${lane} += static_cast<I>(blockDim.x)) {`,
      );
      indent += '  ';
      const value = scalar(statement.expr);
      line(
        target
          ? `${target.pointer}[${lane}] = ${value};`
          : `${tensorName(statement.name)}[${offset(statement.shape, ['b', lane], dim)}] = ${value};`,
      );
      indent = indent.slice(2);
      line('}');
    } else {
      line('if (threadIdx.x == 0) {');
      indent += '  ';
      const value = scalar(statement.expr);
      line(
        target
          ? `${target.pointer}[0] = ${value};`
          : `${tensorName(statement.name)}[${offset(statement.shape, ['b'], dim)}] = ${value};`,
      );
      indent = indent.slice(2);
      line('}');
    }
    line('__syncthreads();');
  }
  lines.push('}');
  const rows = dim(kernel.rows!);
  return {
    code: lines.join('\n'),
    preload: `  if (${rows}) {
    // A fused kernel stages one row per block, so its footprint has to fit the device's shared memory. The limit is
    // asked for rather than assumed, and the error names what the lowering needs.
    int limit_${name} = 0;
    check(cudaDeviceGetAttribute(&limit_${name}, cudaDevAttrMaxSharedMemoryPerBlockOptin, 0));
    const U need_${name} = static_cast<U>(${shared});
    if (need_${name} > static_cast<U>(limit_${name}))
      throw std::runtime_error("${name} needs " + std::to_string(need_${name}) + " bytes of shared memory per block; the device allows " + std::to_string(limit_${name}));
    if (need_${name}) check(cudaFuncSetAttribute(${name}, cudaFuncAttributeMaxDynamicSharedMemorySize, static_cast<int>(need_${name})));
    check(cudaFuncGetAttributes(&attributes, ${name}));
  }`,
    hasWork: rows,
    launch: `    if (${rows}) {
      ${name}<<<${rows}, ${rowThreads}, ${shared}>>>(${args.join(', ')});
      check(cudaGetLastError());
    }`,
  };
}

export function emitCuda(fn: Fn, options?: { fuse?: boolean }): string {
  const plan = options?.fuse === false ? null : fusePlan(fn);
  const program = plan ? plan.fn : fn;
  const all = [...program.params, ...program.statements];
  const tensors = new Map(all.map(t => [t.name, t]));
  const names = new Map(all.map((t, i) => [t.name, `t${i}`]));
  const name = (key: string) => names.get(key)!;
  const dims = new Map<string, string>(),
    bindings: string[] = [];
  for (const p of program.params) {
    for (const [i, a] of p.shape.entries()) {
      const key = plain(a);
      if (key === undefined || dims.has(key)) continue;
      const d = `d${dims.size}`;
      dims.set(key, d);
      bindings.push(`  const I ${d} = shape_${name(p.name)}[${i}];`);
    }
  }
  const kernels = plan
    ? plan.kernels.map((kernel, i) =>
        kernel.mapping === 'row'
          ? rowKernel(kernel, `k${i}`, dims, tensors, name)
          : flatKernel(kernel.statements[0].statement, `k${i}`, dims, tensors, name),
      )
    : program.statements.map((s, i) => flatKernel(s, `k${i}`, dims, tensors, name));
  // A staged value is not a buffer: only global writes get one.
  const buffers = plan
    ? plan.kernels
        .flatMap(kernel => kernel.statements.filter(p => p.storage === 'global'))
        .map(p => p.statement)
    : program.statements;
  const host = ['static void run_case(FILE* input, FILE* output, bool benchmark) {'];
  for (const p of program.params) {
    const t = name(p.name);
    host.push(
      `  std::array<I, ${p.shape.length}> shape_${t};`,
      `  read(input, shape_${t}.data(), shape_${t}.size());`,
      `  std::vector<float> host_${t}(elements(shape_${t}));`,
      `  read(input, host_${t}.data(), host_${t}.size());`,
    );
  }
  const result = name(program.result);
  let buffer = `host_${result}`;
  host.push('  double gpu_ms = 0;');
  if (kernels.length) {
    host.push(...bindings);
    for (const p of program.params) {
      const t = name(p.name);
      host.push(`  DeviceBuffer ${t}(host_${t}.size());`, `  ${t}.upload(host_${t}.data());`);
    }
    for (const statement of buffers) {
      const t = name(statement.name);
      const dimsText = statement.shape.map(a => affine(a, key => dims.get(key)!)).join(', ');
      host.push(
        `  const std::array<I, ${statement.shape.length}> shape_${t}{${dimsText}};`,
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
    if (buffers.some(s => s.name === program.result)) {
      buffer = `host_${result}`;
      host.push(`  std::vector<float> ${buffer}(${result}.size);`, `  ${result}.download(${buffer}.data());`);
    }
  }
  host.push(
    `  write(output, shape_${result}.data(), shape_${result}.size());`,
    `  write(output, ${buffer}.data(), ${buffer}.size());`,
    `  write(output, &gpu_ms, 1);`,
    '}',
  );
  return [support, ...kernels.map(k => k.code), host.join('\n'), main].join('\n\n');
}
