import { classifyLoad, fusionPlan, singleSegments, type LoadExpr, type Segment } from './fusion.js';
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

// The largest static per-block shared allocation CUDA guarantees without an opt-in attribute. Every corpus
// group fits (attention, the largest, needs 3,136 floats); a launch whose need exceeds the cap stages through
// the statements' own global buffers instead (IRWB-029-F design).
const stageFloats = 12288;

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

/**
 * The scalar expression walker shared by every kernel form: a temporary per scalar operation, sequential
 * reduction loops in the meaning's order, and the stage 2 rounding sites. Only load resolution differs between
 * the stage 2, row-group and chain kernels, so an output element's evaluation is always the same tree.
 */
class Scalar {
  readonly indices = new Map<string, string>();
  private indent = '  ';
  private next = 0;

  constructor(
    private readonly lines: string[],
    private readonly dimensions: ReadonlyMap<string, string>,
  ) {}

  line(code: string) {
    this.lines.push(this.indent + code);
  }
  open() {
    this.indent += '  ';
  }
  close() {
    this.indent = this.indent.slice(2);
  }
  bind(id: string) {
    const name = `i${this.indices.size}`;
    this.indices.set(id, name);
    return name;
  }
  index(id: string) {
    return this.indices.get(id)!;
  }
  dim(a: Affine) {
    return affine(a, n => this.dimensions.get(n)!);
  }
  temporary(code: string) {
    const name = `v${this.next++}`;
    this.line(`float ${name} = ${code};`);
    return name;
  }

  scalar(e: Expr, load: (e: LoadExpr) => string): string {
    switch (e.kind) {
      case 'literal':
        return literal(e.text);
      case 'shape':
        return `__ll2float_rn(${this.dimensions.get(e.name)!})`;
      case 'load':
        return load(e);
      case 'op': {
        const [a, b] = e.args.map(x => this.scalar(x, load));
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
          const axis = this.bind(id),
            n = this.dim(extent.dim);
          let bound = n;
          if (extent.kind === 'blocks') {
            const tail = extent.rounding === 'ceil' ? ` + (${n} % ${width} != 0)` : '';
            bound = `${n} / ${width}${tail}`;
          }
          if (extent.kind === 'tail') {
            const remaining = `(${n} - ${width}LL * ${this.index(extent.block)})`;
            bound = `(${remaining} < ${width}LL ? ${remaining} : ${width}LL)`;
          }
          this.line(`const I end_${axis} = ${bound};`);
          this.line(`for (I ${axis} = 0; ${axis} < end_${axis}; ++${axis}) {`);
          this.open();
        }
        const value = this.scalar(e.body, load);
        this.line(
          `${acc} = ${e.op === 'sum' ? `__fadd_rn(${acc}, ${value})` : `minmax(${acc}, ${value}, true)`};`,
        );
        for (const _axis of e.axes) {
          this.close();
          this.line('}');
        }
        return acc;
      }
    }
  }
}

/** The stage 2 row-major global address of a load. */
function globalAddress(
  e: LoadExpr,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
  scalar: Scalar,
): string {
  const shape = tensors.get(e.name)!.shape;
  const offset = e.indices.reduce(
    (prior, a, i) =>
      i
        ? `(${prior} * ${scalar.dim(shape[i])} + ${affine(a, id => scalar.index(id))})`
        : affine(a, id => scalar.index(id)),
    '',
  );
  return `${tensorName(e.name)}[${offset}]`;
}

interface KernelPart {
  readonly code: string;
  readonly preload: string;
  readonly hasWork: string;
  readonly launch: string;
}

/** Stage 2: one thread per output element, one kernel per statement. */
function emitSingle(
  statement: Fn['statements'][number],
  kernel: string,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
): KernelPart {
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
  const s = new Scalar(lines, dimensions);
  s.line('const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
  s.line('if (thread >= count) return;');
  s.line('U coordinate = thread;');
  for (let i = statement.axes.length - 1; i >= 0; --i) {
    const axis = s.bind(statement.axes[i].id);
    s.line(`const I ${axis} = coordinate % ${s.dim(statement.shape[i])};`);
    if (i > 0) s.line(`coordinate /= ${s.dim(statement.shape[i])};`);
  }
  const result = s.scalar(statement.expr, e => globalAddress(e, tensors, tensorName, s));
  s.line(`result[thread] = ${result};`);
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

/** A row or chain segment: its statements, their slice lengths and which are read inside the group. */
interface GroupInfo {
  readonly statements: readonly Fn['statements'][number][];
  /** Statement names the group reads back inside itself, in statement order. */
  readonly internal: ReadonlySet<string>;
  /** Row-local tensors produced outside the group and read inside it, in first-occurrence order. */
  readonly stagedOutside: readonly string[];
  /** True when the statement's value must also reach memory outside this kernel. */
  readonly external: readonly boolean[];
  /** Every tensor the kernel needs a pointer for, in parameter order. */
  readonly pointers: readonly Tensor[];
}

function groupInfo(
  fn: Fn,
  seg: Extract<Segment, { kind: 'row' | 'chain' }>,
  tensors: ReadonlyMap<string, Tensor>,
): GroupInfo {
  const statements = fn.statements.slice(seg.start, seg.end + 1);
  const names = new Set(statements.map(s => s.name));
  const after = fn.statements.slice(seg.end + 1);
  const external = statements.map(
    s =>
      s.name === fn.result ||
      after.some(t => {
        let hit = false;
        visit(t.expr, e => {
          if (e.kind === 'load' && e.name === s.name) hit = true;
        });
        return hit;
      }),
  );
  const internal = new Set<string>();
  const stagedOutside: string[] = [];
  for (const s of statements)
    visit(s.expr, e => {
      if (e.kind !== 'load') return;
      const load = e as LoadExpr;
      if (names.has(load.name)) internal.add(load.name);
      else if (
        !stagedOutside.includes(load.name) &&
        classifyLoad(load, s.axes[0].id, tensors, seg.row) === 'row-local'
      )
        stagedOutside.push(load.name);
    });
  const needed = new Set<string>([...stagedOutside, ...statements.map(s => s.name)]);
  for (const s of statements)
    visit(s.expr, e => {
      if (e.kind === 'load') needed.add(e.name);
    });
  const pointers = [...fn.params, ...fn.statements].filter(t => needed.has(t.name));
  return { statements, internal, stagedOutside, external, pointers };
}

/** One block per row: statements in order, row slices staged in shared memory (or their own buffers). */
function emitRowGroup(
  fn: Fn,
  seg: Extract<Segment, { kind: 'row' }>,
  kernel: string,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
): KernelPart {
  const info = groupInfo(fn, seg, tensors);
  const groupNames = new Set(info.statements.map(s => s.name));
  const rowExtent = `shape_${tensorName(info.statements[0].name)}[0]`;
  // The staged slot layout: row-local outside tensors first, then internally read group statements.
  const slots: { tensor: string; len: string }[] = [
    ...info.stagedOutside.map(name => ({ tensor: name, len: sliceLength(tensors.get(name)!, dimensions) })),
    ...info.statements
      .filter(s => info.internal.has(s.name))
      .map(s => ({ tensor: s.name, len: sliceLength(s, dimensions) })),
  ];
  const slotOf = new Map(slots.map((slot, k) => [slot.tensor, { off: `off${k}`, len: slot.len }]));
  const args = [...dimensions.values(), ...info.pointers.map(t => tensorName(t.name))];
  const params = [
    ...Array.from(dimensions.values(), d => `I ${d}`),
    ...info.pointers.map(t => `${groupNames.has(t.name) ? '' : 'const '}float* ${tensorName(t.name)}`),
  ];
  const need = slots.map(x => `(${x.len})`).join(' + ') || '0';
  // One warp per row: a row's serial reductions run on one lane chain while the block carries several rows, so
  // row concurrency is not throttled by idle threads of a one-block-per-row mapping. Each warp stages its own
  // row in its own slice of the static shared array; statements are ordered with __syncwarp, which the guard
  // makes warp-uniform. The host picks the warp count so every warp's slice fits the stage (or 8 warps with the
  // global staging fallback).
  const warps = slots.length
    ? `((${need}) <= ${stageFloats}u ? (${stageFloats}u / (${need}) < 8u ? ${stageFloats}u / (${need}) : 8u) : 8u)`
    : '8u';
  const lines = [`__global__ void ${kernel}(${params.join(', ')}) {`];
  const s = new Scalar(lines, dimensions);
  s.line(`const I rows = ${s.dim(seg.row)};`);
  s.line('const I row = static_cast<I>(blockIdx.x) * (blockDim.x / 32) + static_cast<I>(threadIdx.x / 32);');
  s.line('if (row >= rows) return;');
  s.line('const U lane = static_cast<U>(threadIdx.x % 32u);');
  if (slots.length) {
    s.line(`__shared__ float stage[${stageFloats}];`);
    slots.forEach((_slot, k) =>
      s.line(
        `const U off${k} = ${
          k
            ? slots
                .slice(0, k)
                .map(x => `(${x.len})`)
                .join(' + ')
            : '0'
        };`,
      ),
    );
    s.line(`const U need = ${need};`);
    s.line('const U wbase = static_cast<U>(threadIdx.x / 32u) * need;');
    s.line(`const bool fits = need <= ${stageFloats}u;`);
    s.line('if (fits) {');
    s.open();
    info.stagedOutside.forEach((name, k) => {
      const len = slots[k].len;
      s.line(`for (U l = lane; l < (${len}); l += 32u) {`);
      s.open();
      s.line(`stage[wbase + off${k} + l] = ${tensorName(name)}[(row) * (${len}) + l];`);
      s.close();
      s.line('}');
    });
    s.close();
    s.line('}');
  }
  if (slots.length) s.line('__syncwarp();');
  for (const [j, statement] of info.statements.entries()) {
    const len = sliceLength(statement, dimensions);
    const slot = slotOf.get(statement.name);
    s.indices.set(statement.axes[0].id, 'row');
    s.line(`for (U l = lane; l < (${len}); l += 32u) {`);
    s.open();
    if (statement.axes.length > 1) {
      s.line('U coordinate = l;');
      for (let i = statement.axes.length - 1; i >= 1; --i) {
        const axis = s.bind(statement.axes[i].id);
        s.line(`const I ${axis} = coordinate % ${s.dim(statement.shape[i])};`);
        if (i > 1) s.line(`coordinate /= ${s.dim(statement.shape[i])};`);
      }
    }
    const load = (e: LoadExpr): string => {
      const found = slotOf.get(e.name);
      if (found && classifyLoad(e, statement.axes[0].id, tensors, seg.row) === 'row-local') {
        const shape = tensors.get(e.name)!.shape;
        const rest = e.indices.slice(1);
        const inner = rest.reduce(
          (prior, a, i) =>
            i
              ? `(${prior} * ${s.dim(shape[i + 1])} + ${affine(a, id => s.index(id))})`
              : affine(a, id => s.index(id)),
          rest.length ? '' : '0',
        );
        const global = `${tensorName(e.name)}[(row) * (${found.len}) + ${inner}]`;
        return slots.length ? `(fits ? stage[wbase + ${found.off} + ${inner}] : ${global})` : global;
      }
      return globalAddress(e, tensors, tensorName, s);
    };
    const value = s.scalar(statement.expr, load);
    const out = `${tensorName(statement.name)}[(row) * (${len}) + l]`;
    if (info.external[j]) s.line(`${out} = ${value};`);
    else if (slot) s.line(`if (!fits) ${out} = ${value};`);
    if (slot) s.line(`if (fits) stage[wbase + ${slot.off} + l] = ${value};`);
    s.close();
    s.line('}');
    if (slots.length) s.line('__syncwarp();');
  }
  lines.push('}');
  return {
    code: lines.join('\n'),
    preload: `  if (${rowExtent}) check(cudaFuncGetAttributes(&attributes, ${kernel}));`,
    hasWork: rowExtent,
    launch: `    if (${rowExtent}) {
      const unsigned warps${kernel} = ${warps};
      ${kernel}<<<static_cast<unsigned>(((${rowExtent}) + warps${kernel} - 1) / warps${kernel}), warps${kernel} * 32>>>(${args.map((arg, i) => (i < dimensions.size ? arg : arg + '.ptr')).join(', ')});
      check(cudaGetLastError());
    }`,
  };
}

/**
 * A register-forwarding chain: one thread per output element (stage 2's own mapping), computing every
 * statement of the group in order and passing producer values through registers. All statements share the
 * shape after the row axis, and every in-group read is elementwise, so the thread's element is the same
 * coordinate in each statement. Reductions run as the element's own sequential loops, exactly as in stage 2.
 */
function emitChain(
  fn: Fn,
  seg: Extract<Segment, { kind: 'chain' }>,
  kernel: string,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
): KernelPart {
  const info = groupInfo(fn, seg, tensors);
  const names = new Set(info.statements.map(s => s.name));
  const first = info.statements[0];
  const count = `${tensorName(first.name)}.size`;
  const args = [...dimensions.values(), ...info.pointers.map(t => tensorName(t.name) + '.ptr'), count];
  const params = [
    ...Array.from(dimensions.values(), d => `I ${d}`),
    ...info.pointers.map(t => `${names.has(t.name) ? '' : 'const '}float* ${tensorName(t.name)}`),
    'U count',
  ];
  const lines = [`__global__ void ${kernel}(${params.join(', ')}) {`];
  const s = new Scalar(lines, dimensions);
  s.line('const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
  s.line('if (thread >= count) return;');
  s.line('U coordinate = thread;');
  for (let i = first.axes.length - 1; i >= 0; --i) {
    const axis = s.bind(first.axes[i].id);
    s.line(`const I ${axis} = coordinate % ${s.dim(first.shape[i])};`);
    if (i > 0) s.line(`coordinate /= ${s.dim(first.shape[i])};`);
  }
  const values = new Map<string, string>();
  for (const [j, statement] of info.statements.entries()) {
    statement.axes.forEach((a, k) => s.indices.set(a.id, s.index(first.axes[k].id)));
    const value = s.scalar(statement.expr, e =>
      values.has(e.name) ? values.get(e.name)! : globalAddress(e, tensors, tensorName, s),
    );
    values.set(statement.name, value);
    if (info.external[j]) s.line(`${tensorName(statement.name)}[thread] = ${value};`);
  }
  lines.push('}');
  return {
    code: lines.join('\n'),
    preload: `  if (${count}) check(cudaFuncGetAttributes(&attributes, ${kernel}));`,
    hasWork: count,
    launch: `    if (${count}) {
      ${kernel}<<<(${count} - 1) / 256 + 1, 256>>>(${args.join(', ')});
      check(cudaGetLastError());
    }`,
  };
}

/** The number of elements in one row slice: the product of the tensor's dimensions after the leading one. */
function sliceLength(t: Tensor, dimensions: ReadonlyMap<string, string>): string {
  const factors = t.shape.slice(1).map(d => `static_cast<U>(${affine(d, n => dimensions.get(n)!)})`);
  return factors.length ? factors.join(' * ') : '1u';
}

export function emitCuda(fn: Fn, options?: { fuse?: boolean }): string {
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
  const segments = options?.fuse === false ? singleSegments(fn) : fusionPlan(fn).segments;
  const kernels = segments.map((seg, i) =>
    seg.kind === 'single'
      ? emitSingle(fn.statements[seg.index], `k${i}`, dims, tensors, name)
      : seg.kind === 'row'
        ? emitRowGroup(fn, seg, `k${i}`, dims, tensors, name)
        : emitChain(fn, seg, `k${i}`, dims, tensors, name),
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
