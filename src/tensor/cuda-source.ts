import { expandStatements, unfusedPlan, type Kernel, type KernelPlan } from './kernels.js';
import {
  plain,
  visit,
  width,
  type Affine,
  type Expr,
  type Fn,
  type Statement,
  type Tensor,
} from './model.js';

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

const mainText = String.raw`
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
__SPILL__    for (U i = 0; i < count; ++i) run_case(input.get(), output.get(), benchmark);
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

// Row kernels only (IRWB-029-E). fold_max is minmax(a, b, true) written with selects: the same value for every
// input, without the branches that made a max fold cost ten sum folds (ticket probe 05). spill_all forces the
// staged rows into global scratch memory, so that the contract can check that path on small cases.
const rowSupport = String.raw`
__device__ static float fold_max(float a, float b) {
  const float tie = __uint_as_float(__float_as_uint(a) & __float_as_uint(b));
  const float pick = a == b ? tie : (a > b ? a : b);
  return (a != a || b != b) ? __uint_as_float(0x7fc00000) : pick;
}

static bool spill_all = false;
`;
const main = (rows: boolean) =>
  mainText.replace(
    '__SPILL__',
    rows ? '    spill_all = argc == 2 && strcmp(argv[1], "--spill") == 0;\n' : '',
  );
/**
 * Threads per block of a row kernel. Measured on the four fused corpus programs at 32, 64, 128, 256 and 512
 * (IRWB-029-E report): 64 is the fastest on softmax and attention and within 8% of the fastest on layernorm and
 * mlp; 128 is 8% slower on softmax, 256 is 60% slower.
 */
export const rowThreads = 64;
/** Staged bytes per row above this go to global scratch: the launch limit without opting in (ticket probe 03). */
const sharedLimit = 48 * 1024;

interface Context {
  dimensions: ReadonlyMap<string, string>;
  tensors: ReadonlyMap<string, Tensor>;
  tensorName: (name: string) => string;
  expanded: ReadonlyMap<string, Expr>;
  /** Share equal subtrees outside loops. On only when the plan inlines, so stage 2's text does not change. */
  share: boolean;
}
type Load = Extract<Expr, { kind: 'load' }>;
type Env = ReadonlyMap<string, string>;
interface Emitted {
  /** The tensors the kernel reads from and writes to global memory. */
  reads: string[];
  writes: string[];
  code: string;
  /** Host statements before the timed region. */
  setup: string[];
  preload: string;
  hasWork: string;
  launch: string;
}

/** Emits the scalar code of expressions into `lines`; `place` says where a load reads from. */
function scalarEmitter(ctx: Context, lines: string[], maxStep: string) {
  let indent = '  ',
    nextValue = 0,
    nextIndex = 0,
    shared = new Map<string, string>();
  const line = (code: string) => lines.push(indent + code);
  const dim = (a: Affine) => affine(a, n => ctx.dimensions.get(n)!);
  const temporary = (code: string) => {
    const name = `v${nextValue++}`;
    line(`float ${name} = ${code};`);
    return name;
  };
  const global = (e: Load, env: Env) => {
    const shape = ctx.tensors.get(e.name)!.shape;
    const index = (id: string) => env.get(id)!;
    const offset = e.indices.reduce(
      (prior, a, i) => (i ? `(${prior} * ${dim(shape[i])} + ${affine(a, index)})` : affine(a, index)),
      '',
    );
    return `${ctx.tensorName(e.name)}[${offset}]`;
  };
  function scalar(e: Expr, env: Env, place: (e: Load, env: Env) => string | undefined, depth = 0): string {
    const key = ctx.share && !depth && (e.kind === 'op' || e.kind === 'reduce') && JSON.stringify(e);
    if (key && shared.has(key)) return shared.get(key)!;
    const result = compute(e, env, place, depth);
    if (key) shared.set(key, result);
    return result;
  }
  function compute(
    e: Expr,
    env: Env,
    place: (e: Load, env: Env) => string | undefined,
    depth: number,
  ): string {
    switch (e.kind) {
      case 'literal':
        return literal(e.text);
      case 'shape':
        return `__ll2float_rn(${ctx.dimensions.get(e.name)!})`;
      case 'load':
        return place(e, env) ?? global(e, env);
      case 'op': {
        const [a, b] = e.args.map(x => scalar(x, env, place, depth));
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
        const inner = new Map(env);
        for (const { id, extent } of e.axes) {
          const axis = `i${nextIndex++}`,
            n = dim(extent.dim);
          let bound = n;
          if (extent.kind === 'blocks') {
            const tail = extent.rounding === 'ceil' ? ` + (${n} % ${width} != 0)` : '';
            bound = `${n} / ${width}${tail}`;
          }
          if (extent.kind === 'tail') {
            const remaining = `(${n} - ${width}LL * ${inner.get(extent.block)!})`;
            bound = `(${remaining} < ${width}LL ? ${remaining} : ${width}LL)`;
          }
          inner.set(id, axis);
          line(`const I end_${axis} = ${bound};`);
          line(`for (I ${axis} = 0; ${axis} < end_${axis}; ++${axis}) {`);
          indent += '  ';
        }
        const value = scalar(e.body, inner, place, depth + 1);
        line(
          `${acc} = ${e.op === 'sum' ? `__fadd_rn(${acc}, ${value})` : maxStep.replace('$', `${acc}, ${value}`)};`,
        );
        for (const _axis of e.axes) {
          indent = indent.slice(2);
          line('}');
        }
        return acc;
      }
    }
  }
  return {
    line,
    dim,
    scalar,
    index: () => `i${nextIndex++}`,
    block(open: string, body: () => void) {
      line(open);
      indent += '  ';
      shared = new Map();
      body();
      indent = indent.slice(2);
      line('}');
    },
  };
}

function globalReads(e: Expr, into: Set<string>, skip: (e: Load) => boolean = () => false) {
  visit(e, x => {
    if (x.kind === 'load' && !skip(x)) into.add(x.name);
  });
}

function emitElement(statement: Statement, kernel: string, ctx: Context): Emitted {
  const { dimensions, tensorName } = ctx,
    expr = ctx.expanded.get(statement.name)!;
  const reads = new Set<string>();
  globalReads(expr, reads);
  const args = [...dimensions.values(), ...Array.from(reads, tensorName), tensorName(statement.name)];
  const params = [
    ...Array.from(dimensions.values(), d => `I ${d}`),
    ...Array.from(reads, t => `const float* ${tensorName(t)}`),
    'float* result',
    'U count',
  ];
  const lines = [`__global__ void ${kernel}(${params.join(', ')}) {`];
  const { line, dim, scalar, index } = scalarEmitter(ctx, lines, 'minmax($, true)');
  const env = new Map<string, string>();
  // stage 2 named the axes from the last to the first; its text is kept
  for (const a of [...statement.axes].reverse()) env.set(a.id, index());
  line('const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
  line('if (thread >= count) return;');
  line('U coordinate = thread;');
  for (let i = statement.axes.length - 1; i >= 0; --i) {
    line(`const I ${env.get(statement.axes[i].id)!} = coordinate % ${dim(statement.shape[i])};`);
    if (i > 0) line(`coordinate /= ${dim(statement.shape[i])};`);
  }
  const result = scalar(expr, env, () => undefined);
  line(`result[thread] = ${result};`);
  lines.push('}');
  const count = `${tensorName(statement.name)}.size`;
  return {
    reads: [...reads],
    writes: [statement.name],
    code: lines.join('\n'),
    setup: [],
    preload: `  if (${count}) check(cudaFuncGetAttributes(&attributes, ${kernel}));`,
    hasWork: count,
    launch: `    if (${count}) {
      ${kernel}<<<(${count} - 1) / 256 + 1, 256>>>(${args.map((arg, i) => (i < dimensions.size ? arg : arg + '.ptr')).join(', ')}, ${count});
      check(cudaGetLastError());
    }`,
  };
}

/**
 * One block per row. A row vector is computed by all threads of the block (thread t takes elements t, t + B, ...);
 * a row scalar by thread 0. Values that later statements of the kernel read are kept in the staged area: shared
 * memory, or this row's part of a global scratch buffer when a row is too long. Reductions run in the evaluating
 * thread as in an element kernel. Storage decisions here do not affect legality (kernels.ts decides that).
 */
function emitRow(
  kernel: Extract<Kernel, { mapping: 'row' }>,
  name: string,
  ctx: Context,
  materialized: ReadonlySet<string>,
): Emitted {
  const { dimensions, tensorName, tensors } = ctx,
    r = kernel.outer;
  const group = kernel.statements.map(n => tensors.get(n) as Statement),
    inGroup = new Set(kernel.statements),
    exprs = group.map(s => ctx.expanded.get(s.name)!);
  const vector = (t: Tensor) => t.shape.length === r + 1;
  const ownRow = (e: Load, s: Statement) => e.indices.slice(0, r).every((a, k) => plain(a) === s.axes[k].id);
  const loadsOf = (k: number) => {
    const out: Load[] = [];
    visit(exprs[k], e => {
      if (e.kind === 'load') out.push(e);
    });
    return out;
  };
  // An outside tensor's row is staged when a row scalar reads it: thread 0 would otherwise walk global memory alone.
  const stagedOutside = new Set<string>();
  group.forEach((s, k) => {
    if (!vector(s))
      for (const e of loadsOf(k))
        if (!inGroup.has(e.name) && vector(tensors.get(e.name)!) && ownRow(e, s)) stagedOutside.add(e.name);
  });
  const fromStage = (e: Load, s: Statement) =>
    inGroup.has(e.name) || (stagedOutside.has(e.name) && ownRow(e, s));
  // Slots: a vector takes the slot of a value that is dead, or that dies at this step and is read only at the
  // element being written (so each thread overwrites what only it still needed).
  const lastUse = new Map<string, number>();
  group.forEach((s, k) => loadsOf(k).forEach(e => fromStage(e, s) && lastUse.set(e.name, k)));
  const slots: { length: string; holder: string }[] = [],
    slotOf = new Map<string, number>();
  const take = (t: Tensor, at: number, expr?: Expr) => {
    const length = affine(t.shape[r], n => dimensions.get(n)!);
    const s = at < 0 ? undefined : (tensors.get(t.name) as Statement);
    let found = slots.findIndex(({ length: l, holder }) => {
      const dies = lastUse.get(holder) ?? -1;
      if (l !== length || dies > at) return false;
      if (dies < at) return true;
      let aligned = true;
      visit(expr!, e => {
        if (e.kind === 'load' && e.name === holder && fromStage(e, s!))
          aligned &&= plain(e.indices[r]) === s!.axes[r].id;
      });
      return aligned;
    });
    if (found < 0) found = slots.push({ length, holder: t.name }) - 1;
    slots[found].holder = t.name;
    slotOf.set(t.name, found);
  };
  for (const n of stagedOutside) take(tensors.get(n)!, -1);
  const scalars = group.filter(s => !vector(s)).map(s => s.name);
  group.forEach((s, k) => vector(s) && lastUse.has(s.name) && take(s, k, exprs[k]));
  const per = `(${[...slots.map(s => s.length), `${scalars.length}LL`].join(' + ')})`;
  const offset = (slot: number) => (slot ? `o${slot}` : '0');
  const scalarAt = (n: string) => `staged[${offset(slots.length)} + ${scalars.indexOf(n)}]`;

  const reads = new Set<string>();
  for (const n of stagedOutside) reads.add(n);
  group.forEach((s, k) => globalReads(exprs[k], reads, e => fromStage(e, s)));
  const outputs = kernel.statements.filter(n => materialized.has(n));
  const params = [
    ...Array.from(dimensions.values(), d => `I ${d}`),
    ...Array.from(reads, t => `const float* ${tensorName(t)}`),
    ...outputs.map(t => `float* ${tensorName(t)}`),
    'float* spill',
  ];
  const lines = [`__global__ void ${name}(${params.join(', ')}) {`];
  const { line, dim, scalar, index, block } = scalarEmitter(ctx, lines, 'fold_max($)');
  const outer = group[0].shape.slice(0, r).map(() => index());
  line('extern __shared__ float shared[];');
  line('const I row = blockIdx.x;');
  line(`float* const staged = spill ? spill + row * ${per} : shared;`);
  line('I coordinate = row;');
  for (let i = r - 1; i >= 0; --i) {
    line(`const I ${outer[i]} = coordinate % ${dim(group[0].shape[i])};`);
    if (i > 0) line(`coordinate /= ${dim(group[0].shape[i])};`);
  }
  slots.forEach((s, i) => line(`const I o${i + 1} = ${offset(i)} + ${s.length};`));
  const strided = (t: Tensor, body: (x: string) => void) => {
    const x = index();
    block(`for (I ${x} = threadIdx.x; ${x} < ${dim(t.shape[r])}; ${x} += blockDim.x) {`, () => body(x));
  };
  const element = (t: Tensor, x?: string) =>
    `${tensorName(t.name)}[${[...outer, ...(x ? [x] : [])].reduce((prior, i, k) => `(${prior} * ${dim(t.shape[k])} + ${i})`)}]`;
  for (const n of stagedOutside) {
    const t = tensors.get(n)!;
    strided(t, x => line(`staged[${offset(slotOf.get(n)!)} + ${x}] = ${element(t, x)};`));
    line('__syncthreads();');
  }
  group.forEach((s, k) => {
    const env = new Map(s.axes.slice(0, r).map((a, i) => [a.id, outer[i]]));
    const place = (e: Load, at: Env) => {
      if (!fromStage(e, s)) return undefined;
      if (!vector(tensors.get(e.name)!)) return scalarAt(e.name);
      return `staged[${offset(slotOf.get(e.name)!)} + ${affine(e.indices[r], id => at.get(id)!)}]`;
    };
    const keep = lastUse.has(s.name);
    if (vector(s))
      strided(s, x => {
        const value = scalar(exprs[k], new Map(env).set(s.axes[r].id, x), place);
        if (keep) line(`staged[${offset(slotOf.get(s.name)!)} + ${x}] = ${value};`);
        if (materialized.has(s.name)) line(`${element(s, x)} = ${value};`);
      });
    else
      block('if (threadIdx.x == 0) {', () => {
        const value = scalar(exprs[k], env, place);
        if (keep) line(`${scalarAt(s.name)} = ${value};`);
        if (materialized.has(s.name)) line(`${element(s)} = ${value};`);
      });
    // Always, not only when this step stored a value: the next step may overwrite a slot this step still reads.
    if (k < group.length - 1) line('__syncthreads();');
  });
  lines.push('}');
  const work = `work_${name}`,
    bytes = `per_${name} * sizeof(float)`;
  const args = [...dimensions.values(), ...[...reads, ...outputs].map(t => tensorName(t) + '.ptr')];
  return {
    reads: [...reads],
    writes: outputs,
    code: lines.join('\n'),
    setup: [
      `  const bool ${work} = ${outputs.map(t => tensorName(t) + '.size').join(' || ') || 'false'};`,
      `  const U rows_${name} = elements(std::array<I, ${r}>{${group[0].shape.slice(0, r).map(dim).join(', ')}});`,
      `  const U per_${name} = static_cast<U>${per};`,
      `  const bool spill_${name} = spill_all || ${bytes} > ${sharedLimit};`,
      `  if (${work} && rows_${name} > 2147483647ULL) throw std::runtime_error("too many rows for one launch");`,
      `  DeviceBuffer scratch_${name}(${work} && spill_${name} ? rows_${name} * per_${name} : 0);`,
    ],
    preload: `  if (${work}) check(cudaFuncGetAttributes(&attributes, ${name}));`,
    hasWork: work,
    launch: `    if (${work}) {
      ${name}<<<static_cast<unsigned>(rows_${name}), ${rowThreads}, spill_${name} ? 0 : ${bytes}>>>(${args.join(', ')}, scratch_${name}.ptr);
      check(cudaGetLastError());
    }`,
  };
}

export function emitPlan(plan: KernelPlan): string {
  return lower(plan).source;
}
/** Per kernel, in order: the tensors it reads from and writes to global memory (the report counts their bytes). */
export function kernelTraffic(plan: KernelPlan): { reads: string[]; writes: string[] }[] {
  return lower(plan).kernels.map(({ reads, writes }) => ({ reads, writes }));
}
function lower(plan: KernelPlan) {
  const { fn } = plan;
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
  const expanded = expandStatements(fn, plan.inlined);
  const ctx: Context = {
    dimensions: dims,
    tensors,
    tensorName: name,
    expanded,
    share: plan.inlined.length > 0,
  };
  // A statement has no global buffer when it is inlined, or when only its own kernel reads it.
  const members = plan.kernels.map(k => (k.mapping === 'row' ? k.statements : [k.statement]));
  const outside = new Set([fn.result]),
    inside = new Set<string>();
  for (const own of members)
    for (const n of own) {
      globalReads(expanded.get(n)!, outside, e => own.includes(e.name));
      globalReads(expanded.get(n)!, inside, e => !own.includes(e.name));
    }
  const materialized = new Set(members.flat().filter(n => outside.has(n) || !inside.has(n)));
  const rows = plan.kernels.some(k => k.mapping === 'row');
  const kernels = plan.kernels.map((k, i) =>
    k.mapping === 'row'
      ? emitRow(k, `k${i}`, ctx, materialized)
      : emitElement(tensors.get(k.statement) as Statement, `k${i}`, ctx),
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
      if (!materialized.has(s.name)) continue;
      const t = name(s.name);
      const dimsText = s.shape.map(a => affine(a, key => dims.get(key)!)).join(', ');
      host.push(
        `  const std::array<I, ${s.shape.length}> shape_${t}{${dimsText}};`,
        `  DeviceBuffer ${t}(elements(shape_${t}));`,
      );
    }
    host.push(
      ...kernels.flatMap(k => k.setup),
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
  const source = [
    support + (rows ? rowSupport : ''),
    ...kernels.map(k => k.code),
    host.join('\n'),
    main(rows),
  ].join('\n\n');
  return { source, kernels };
}

/** Stage 2's lowering: one kernel per statement. */
export function emitCuda(fn: Fn): string {
  return emitPlan(unfusedPlan(fn));
}
