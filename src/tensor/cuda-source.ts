import {
  plain,
  substitute,
  variable,
  visit,
  width,
  type Affine,
  type Expr,
  type Fn,
  type Statement,
  type Tensor,
} from './model.js';
import { planFusion, type FlatKernel, type Kernel, type RowKernel } from './fusion.js';

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

/** A lowering's kernel, before it is printed: its text, its preload, its launch and what drives the launch count. */
interface Emitted {
  code: string;
  preload: string;
  hasWork: string;
  launch: string;
  /** Host-side declarations the launch needs (block and shared-memory counts), or ''. */
  declarations: string;
}

interface Context {
  readonly dims: ReadonlyMap<string, string>;
  readonly tensors: ReadonlyMap<string, Tensor>;
  readonly tensorName: (key: string) => string;
}

/** A nested scope: `rename` rebinds binder ids, `subs` substitutes a producer's free axes with a consumer's. */
interface Env {
  readonly rename: Map<string, string>;
  readonly subs?: Map<string, Affine>;
}

type Resolve = (load: { name: string; indices: Affine[] }, body: Body, env?: Env) => string;

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

/** Emits scalar expressions as temporaries, naming binders and reading tensors through `resolve`. */
class Body {
  readonly lines: string[] = [];
  indent = '  ';
  private next = 0;
  private bound = 0;
  readonly vars = new Map<string, string>();
  constructor(private readonly context: Context) {}
  line(code: string) {
    this.lines.push(this.indent + code);
  }
  open(code: string) {
    this.line(code);
    this.indent += '  ';
  }
  close(code = '}') {
    this.indent = this.indent.slice(2);
    this.line(code);
  }
  bind(id: string): string {
    const name = this.bindName();
    this.vars.set(id, name);
    return name;
  }
  bindName(): string {
    return `i${this.bound++}`;
  }
  varOf(id: string, env?: Env): string {
    return env?.rename.get(id) ?? this.vars.get(id)!;
  }
  /** A shape value or tensor extent, resolved against the flat shape bindings. */
  dim(a: Affine): string {
    return affine(a, key => this.context.dims.get(key)!);
  }
  index(a: Affine, env?: Env): string {
    return affine(a, key => this.varOf(key, env));
  }
  temporary(code: string): string {
    const name = `v${this.next++}`;
    this.line(`float ${name} = ${code};`);
    return name;
  }
  scalar(e: Expr, resolve: Resolve, env?: Env): string {
    switch (e.kind) {
      case 'literal':
        return literal(e.text);
      case 'shape':
        return `__ll2float_rn(${this.context.dims.get(e.name)!})`;
      case 'load':
        return resolve(e, this, env);
      case 'op': {
        const [a, b] = e.args.map(x => this.scalar(x, resolve, env));
        switch (e.op) {
          case '+':
            return this.temporary(`__fadd_rn(${a}, ${b})`);
          case '-':
            return this.temporary(`__fsub_rn(${a}, ${b})`);
          case '*':
            return this.temporary(`__fmul_rn(${a}, ${b})`);
          case '/':
            return this.temporary(`__fdiv_rn(${a}, ${b})`);
          case 'neg':
            return this.temporary(`-(${a})`);
          case 'sqrt':
            return this.temporary(`__fsqrt_rn(${a})`);
          case 'exp':
          case 'log':
          case 'tanh':
            return this.temporary(`__double2float_rn(${e.op}(static_cast<double>(${a})))`);
          case 'max':
          case 'min':
            return this.temporary(`minmax(${a}, ${b}, ${e.op === 'max'})`);
        }
      }
      case 'reduce': {
        const acc = this.temporary(e.op === 'sum' ? '0.0f' : '-INFINITY');
        for (const { id, extent } of e.axes) {
          let axis: string;
          if (env) {
            axis = env.rename.get(id) ?? this.bindName();
            env.rename.set(id, axis);
          } else axis = this.bind(id);
          const n = this.dim(extent.dim);
          let bound = n;
          if (extent.kind === 'blocks') {
            const tail = extent.rounding === 'ceil' ? ` + (${n} % ${width} != 0)` : '';
            bound = `${n} / ${width}${tail}`;
          }
          if (extent.kind === 'tail') {
            const remaining = `(${n} - ${width}LL * ${this.varOf(extent.block, env)})`;
            bound = `(${remaining} < ${width}LL ? ${remaining} : ${width}LL)`;
          }
          this.line(`const I end_${axis} = ${bound};`);
          this.line(`for (I ${axis} = 0; ${axis} < end_${axis}; ++${axis}) {`);
          this.indent += '  ';
        }
        const value = this.scalar(e.body, resolve, env);
        this.line(
          `${acc} = ${e.op === 'sum' ? `__fadd_rn(${acc}, ${value})` : `minmax(${acc}, ${value}, true)`};`,
        );
        for (const _axis of e.axes) {
          this.indent = this.indent.slice(2);
          this.line('}');
        }
        return acc;
      }
    }
  }
}

/** The row-major offset of a tensor address tuple, as stage 2 prints it. */
function offset(context: Context, name: string, indices: Affine[], index: (a: Affine) => string): string {
  const shape = context.tensors.get(name)!.shape;
  return indices.reduce(
    (prior, a, i) =>
      i ? `(${prior} * ${affine(shape[i], key => context.dims.get(key)!)} + ${index(a)})` : index(a),
    '',
  );
}
function dimOf(context: Context, a: Affine): string {
  return affine(a, key => context.dims.get(key)!);
}

/** Every tensor the flat kernel reads from global memory, following inlined producers. */
function collectReads(statement: Statement, inline: ReadonlyMap<string, Statement>, out: Set<string>) {
  visit(statement.expr, e => {
    if (e.kind !== 'load') return;
    const producer = inline.get(e.name);
    if (producer) collectReads(producer, inline, out);
    else out.add(e.name);
  });
}

/**
 * Stage 2's kernel for one statement, extended with inlined producers: a load of an inlined statement expands that
 * statement's tree here, with its free axes substituted by the load's address tuple. For a statement with nothing
 * inlined the text is exactly stage 2's.
 */
function emitFlat(kernel: FlatKernel, index: number, context: Context): Emitted {
  const statement = kernel.anchor;
  const inline = new Map(kernel.inline.map(s => [s.name, s]));
  const name = context.tensorName;
  const reads = new Set<string>();
  collectReads(statement, inline, reads);
  const args = [...context.dims.values(), ...Array.from(reads, name), name(statement.name)];
  const params = [
    ...Array.from(context.dims.values(), d => `I ${d}`),
    ...Array.from(reads, t => `const float* ${name(t)}`),
    'float* result',
    'U count',
  ];
  const body = new Body(context);
  body.lines.push(`__global__ void k${index}(${params.join(', ')}) {`);

  const resolve: Resolve = (load, scope, env) => {
    const indices = env?.subs ? load.indices.map(a => substitute(a, env.subs!)) : load.indices;
    const producer = inline.get(load.name);
    if (producer) {
      // a fresh scope per expansion: the same producer can be expanded at several sites
      const rename = new Map(env?.rename);
      const subs = new Map<string, Affine>();
      producer.axes.forEach((axis, k) => subs.set(axis.id, indices[k]));
      return scope.scalar(producer.expr, resolve, { rename, subs });
    }
    return `${name(load.name)}[${offset(context, load.name, indices, a => scope.index(a, env))}]`;
  };

  body.line('const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
  body.line('if (thread >= count) return;');
  body.line('U coordinate = thread;');
  for (let i = statement.axes.length - 1; i >= 0; --i) {
    const axis = body.bind(statement.axes[i].id);
    body.line(`const I ${axis} = coordinate % ${dimOf(context, statement.shape[i])};`);
    if (i > 0) body.line(`coordinate /= ${dimOf(context, statement.shape[i])};`);
  }
  const result = body.scalar(statement.expr, resolve);
  body.line(`result[thread] = ${result};`);
  body.lines.push('}');
  const count = `${name(statement.name)}.size`;
  return {
    code: body.lines.join('\n'),
    preload: `  if (${count}) check(cudaFuncGetAttributes(&attributes, k${index}));`,
    hasWork: count,
    launch: `    if (${count}) {
      k${index}<<<(${count} - 1) / 256 + 1, 256>>>(${args.map((arg, i) => (i < context.dims.size ? arg : arg + '.ptr')).join(', ')}, ${count});
      check(cudaGetLastError());
    }`,
    declarations: '',
  };
}

/**
 * A block per row. Rows are decoded from blockIdx, staged tensors are copied into shared memory, a member without an
 * extra axis is folded by thread 0 in the meaning's order, and a member with one is computed by the block's threads.
 */
function emitRow(kernel: RowKernel, index: number, context: Context): Emitted {
  const name = context.tensorName;
  const m = kernel.rows.length;
  const body = new Body(context);
  const reads = new Set<string>(),
    writes = new Set<string>();
  for (const phase of kernel.phases) {
    if (phase.kind === 'stage') {
      reads.add(phase.tensor);
      continue;
    }
    visit(phase.statement.expr, node => {
      if (node.kind === 'load' && !kernel.staged.has(node.name)) reads.add(node.name);
    });
    if (phase.dest.kind === 'global') writes.add(phase.statement.name);
  }
  const params = [
    ...Array.from(context.dims.values(), d => `I ${d}`),
    ...Array.from(reads, t => `const float* ${name(t)}`),
    ...Array.from(writes, t => `float* ${name(t)}`),
  ];
  body.lines.push(`__global__ void k${index}(${params.join(', ')}) {`);
  body.line('extern __shared__ float smem[];');
  kernel.slots.forEach((entry, slot) => {
    const base = slot === 0 ? '0' : `so${slot - 1} + ${dimOf(context, kernel.slots[slot - 1].dim)}`;
    body.line(`const I so${slot} = ${base};`);
  });
  body.line('U block = static_cast<U>(blockIdx.x);');
  kernel.rows.forEach((_, k) => {
    body.line(`const I r${k} = block % ${dimOf(context, kernel.rows[k].extent.dim)};`);
    if (k < m - 1) body.line(`block /= ${dimOf(context, kernel.rows[k].extent.dim)};`);
  });

  const rowIndex = (scope: Body, env: Env) => (a: Affine) => scope.index(a, env);
  for (const phase of kernel.phases) {
    if (phase.kind === 'stage') {
      const tensor = context.tensors.get(phase.tensor)!;
      const extra = `stage${phase.slot}`;
      const rename = new Map<string, string>();
      kernel.rows.forEach((axis, k) => rename.set(axis.id, `r${k}`));
      const env: Env = { rename };
      if (tensor.shape.length === m) {
        body.line('if (threadIdx.x == 0) {');
        body.indent += '  ';
        const tuple = kernel.rows.map(axis => variable(axis.id));
        body.line(
          `smem[so${phase.slot}] = ${name(phase.tensor)}[${offset(context, phase.tensor, tuple, rowIndex(body, env))}];`,
        );
        body.close();
      } else {
        rename.set(extra, extra);
        const tuple = [...kernel.rows.map(axis => variable(axis.id)), variable(extra)];
        body.open(
          `for (U lane = threadIdx.x; (I)lane < ${dimOf(context, tensor.shape[m])}; lane += blockDim.x) {`,
        );
        body.line(`const I ${extra} = (I)lane;`);
        body.line(
          `smem[so${phase.slot} + ${extra}] = ${name(phase.tensor)}[${offset(context, phase.tensor, tuple, rowIndex(body, env))}];`,
        );
        body.close();
      }
      body.line('__syncthreads();');
      continue;
    }
    const statement = phase.statement;
    const rename = new Map<string, string>();
    kernel.rows.forEach((axis, k) => rename.set(statement.axes[k].id, `r${k}`));
    const env: Env = { rename };
    const tuple = statement.axes.map(axis => variable(axis.id));
    const resolve: Resolve = (load, scope, inner) => {
      const indices = inner?.subs ? load.indices.map(a => substitute(a, inner.subs!)) : load.indices;
      const slot = kernel.staged.get(load.name);
      const tensor = context.tensors.get(load.name)!;
      if (slot !== undefined)
        return tensor.shape.length === m
          ? `smem[so${slot}]`
          : `smem[so${slot} + ${scope.index(indices[m], inner)}]`;
      return `${name(load.name)}[${offset(context, load.name, indices, a => scope.index(a, inner))}]`;
    };
    if (phase.kind === 'vector') {
      const extra = statement.axes[m];
      const variable_ = body.bindName();
      rename.set(extra.id, variable_);
      body.open(
        `for (U lane = threadIdx.x; (I)lane < ${dimOf(context, extra.extent.dim)}; lane += blockDim.x) {`,
      );
      body.line(`const I ${variable_} = (I)lane;`);
      const value = body.scalar(statement.expr, resolve, env);
      if (phase.dest.kind === 'global')
        body.line(
          `${name(statement.name)}[${offset(context, statement.name, tuple, rowIndex(body, env))}] = ${value};`,
        );
      else body.line(`smem[so${phase.dest.slot} + ${variable_}] = ${value};`);
      body.close();
    } else {
      body.line('if (threadIdx.x == 0) {');
      body.indent += '  ';
      const value = body.scalar(statement.expr, resolve, env);
      if (phase.dest.kind === 'global')
        body.line(
          `${name(statement.name)}[${offset(context, statement.name, tuple, rowIndex(body, env))}] = ${value};`,
        );
      else body.line(`smem[so${phase.dest.slot}] = ${value};`);
      body.close();
    }
    if (phase.dest.kind === 'shared') body.line('__syncthreads();');
  }
  body.lines.push('}');
  const blocks = kernel.rows.map(axis => dimOf(context, axis.extent.dim)).join(' * ');
  const args = [
    ...context.dims.values(),
    ...Array.from(reads, t => `${name(t)}.ptr`),
    ...Array.from(writes, t => `${name(t)}.ptr`),
  ];
  return {
    code: body.lines.join('\n'),
    preload: `  check(cudaFuncGetAttributes(&attributes, k${index}));`,
    hasWork: `blocks${index}`,
    launch: `    if (blocks${index}) {
      k${index}<<<blocks${index}, ${kernel.threads}, shared${index}>>>(${args.join(', ')});
      check(cudaGetLastError());
    }`,
    declarations: `  const U blocks${index} = ${blocks};
  const size_t shared${index} = static_cast<size_t>(${kernel.slots
    .map(entry => dimOf(context, entry.dim))
    .join(' + ')}) * sizeof(float);
  check(cudaFuncSetAttribute(k${index}, cudaFuncAttributeMaxDynamicSharedMemorySize, shared${index}));`,
  };
}

const unfused = (fn: Fn): Kernel[] =>
  fn.statements.map(statement => ({ kind: 'flat', anchor: statement, inline: [] }));

/** The complete translation unit for `fn`. `fuse` false is stage 2's one kernel per statement, unchanged. */
export function emitCuda(fn: Fn, fuse = true): string {
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
  const context: Context = { dims, tensors, tensorName: name };
  const kernels = (fuse ? planFusion(fn) : unfused(fn)).map((kernel, index) =>
    kernel.kind === 'flat' ? emitFlat(kernel, index, context) : emitRow(kernel, index, context),
  );
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
      ...kernels.map(k => k.declarations).filter(Boolean),
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
