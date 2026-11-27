import { gateRule, outerReductions, type Reduce } from './fusion.js';
import {
  plain,
  variable,
  visit,
  width,
  type Affine,
  type Expr,
  type Extent,
  type Fn,
  type Statement,
  type Tensor,
} from './model.js';
import { tileGate } from './schedule-passes.js';
import type { ChunkSchedule, SchedKernel, ScheduleUnit, StageTile, TileMember } from './schedule.js';

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

// A source with a gated kernel also takes --gate=fused or --gate=unfused, which forces every gate to that side.
const benchmarkFlag = '    const bool benchmark = argc == 2 && strcmp(argv[1], "--benchmark") == 0;\n';
const gatedMain = main.replace(
  benchmarkFlag,
  String.raw`    bool benchmark = false;
    for (int a = 1; a < argc; ++a) {
      if (!strcmp(argv[a], "--benchmark")) benchmark = true;
      else if (!strcmp(argv[a], "--gate=fused")) gate_mode = 1;
      else if (!strcmp(argv[a], "--gate=unfused")) gate_mode = 2;
      else throw std::runtime_error("unknown argument");
    }
`,
);
if (gatedMain === main) throw Error('The CUDA main no longer has the benchmark flag line');
const gateSupport = '\nstatic int gate_mode = 0;';
/** Whether a generated program has a gated kernel, and so takes --gate=fused|unfused. */
export const takesGate = (source: string) => source.includes(gateSupport);

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

type Load = Extract<Expr, { kind: 'load' }>;
type Offset = (indices: readonly Affine[], shape: readonly Affine[]) => string;

// The scalar code of one kernel: index names, temporaries and the tree walk shared by stage 2's one-statement
// kernels and stage 3's fused kernels, so every element is computed by the same code either way.
function kernelWriter(
  dimensions: ReadonlyMap<string, string>,
  load: (e: Load, offset: Offset) => string,
  maxFold = 'minmax(ACC, VALUE, true)',
  /** A reduction whose terms are already in a buffer: its count and pointer (IRWB-030-E). */
  stagedTerms: (e: Reduce) => { count: string; terms: string } | undefined = () => undefined,
  /** A reduction the schedule has already computed into registers: its value at the current point (IRWB-033-I). */
  reduced: (e: Reduce) => string | undefined = () => undefined,
) {
  const lines: string[] = [];
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
  const offset: Offset = (at, shape) =>
    at.reduce(
      (prior, a, i) => (i ? `(${prior} * ${dim(shape[i])} + ${affine(a, index)})` : affine(a, index)),
      '',
    );
  const bound = (extent: Extent) => {
    const n = dim(extent.dim);
    if (extent.kind === 'blocks')
      return `${n} / ${width}${extent.rounding === 'ceil' ? ` + (${n} % ${width} != 0)` : ''}`;
    if (extent.kind === 'tail') {
      const remaining = `(${n} - ${width}LL * ${index(extent.block)})`;
      return `(${remaining} < ${width}LL ? ${remaining} : ${width}LL)`;
    }
    return n;
  };
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
      case 'load':
        return load(e, offset);
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
        const inRegisters = reduced(e);
        if (inRegisters !== undefined) return inRegisters;
        const acc = temporary(e.op === 'sum' ? '0.0f' : '-INFINITY');
        const step = (value: string) =>
          line(
            `${acc} = ${e.op === 'sum' ? `__fadd_rn(${acc}, ${value})` : maxFold.replace('ACC', acc).replace('VALUE', value)};`,
          );
        const ready = stagedTerms(e);
        if (ready) {
          line(`for (U t = 0; t < ${ready.count}; ++t) {`);
          indent += '  ';
          step(`${ready.terms}[t]`);
          indent = indent.slice(2);
          line('}');
          return acc;
        }
        for (const { id, extent } of e.axes) {
          const axis = bind(id);
          line(`const I end_${axis} = ${bound(extent)};`);
          line(`for (I ${axis} = 0; ${axis} < end_${axis}; ++${axis}) {`);
          indent += '  ';
        }
        step(scalar(e.body));
        for (const _axis of e.axes) {
          indent = indent.slice(2);
          line('}');
        }
        return acc;
      }
    }
  }
  return {
    lines,
    line,
    dim,
    bound,
    bind,
    alias: (id: string, name: string) => void indices.set(id, name),
    scalar,
    affineOf: (a: Affine) => affine(a, index),
    address: offset,
    enter: () => void (indent += '  '),
    leave: () => void (indent = indent.slice(2)),
  };
}

// Stage 2's mapping for one statement: thread number `thread` computes that element and stores it in `target`.
function elementOfThread(w: ReturnType<typeof kernelWriter>, statement: Statement, target: string) {
  w.line('U coordinate = thread;');
  for (let i = statement.axes.length - 1; i >= 0; --i) {
    const axis = w.bind(statement.axes[i].id);
    w.line(`const I ${axis} = coordinate % ${w.dim(statement.shape[i])};`);
    if (i > 0) w.line(`coordinate /= ${w.dim(statement.shape[i])};`);
  }
  const result = w.scalar(statement.expr);
  w.line(`${target}[thread] = ${result};`);
}

// Stage 2: one kernel for one statement, one thread per output element.
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
  const w = kernelWriter(
    dimensions,
    (e, offset) => `${tensorName(e.name)}[${offset(e.indices, tensors.get(e.name)!.shape)}]`,
  );
  w.lines.push(`__global__ void ${kernel}(${params.join(', ')}) {`);
  w.line('const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
  w.line('if (thread >= count) return;');
  elementOfThread(w, statement, 'result');
  w.lines.push('}');
  const count = `${tensorName(statement.name)}.size`;
  return {
    code: w.lines.join('\n'),
    host: [] as string[],
    preload: `  if (${count}) check(cudaFuncGetAttributes(&attributes, ${kernel}));`,
    hasWork: count,
    launch: `    if (${count}) {
      ${kernel}<<<(${count} - 1) / 256 + 1, 256>>>(${args.map((arg, i) => (i < dimensions.size ? arg : arg + '.ptr')).join(', ')}, ${count});
      check(cudaGetLastError());
    }`,
  };
}

// Fused kernels fold max with PTX max.NaN.f32: a NaN operand gives the canonical NaN, and +0 is above -0, as in
// minmax(a, b, true) (probe 07 in IRWB-029-D: equal on all 324 pairs of special and ordinary words). It is one
// instruction where minmax is a chain of compares; a block-mode kernel runs fewer serial folds per SM than stage 2
// runs threads, so the fold's latency is its critical path (script 06: 0.32 ms to 0.15 ms for a row max).
const fusedSupport = String.raw`
__device__ static float max_nan(float a, float b) {
  float r;
  asm("max.NaN.f32 %0, %1, %2;" : "=f"(r) : "f"(a), "f"(b));
  return r;
}`;

// Threads per block in block mode: the shortest warp multiple covering the longest row, up to a cap chosen by
// measurement (IRWB-029-D diary step 4, caps 64, 128 and 256 on softmax, layernorm, attention and mlp): 64 when a
// member's reduction reads a tensor from global memory (a contraction operand: attention's k and v, mlp's w and
// v), 128 otherwise (rows only: softmax, layernorm).
//
// IRWB-030-E: when a member with trailing axes carries a costly reduction (the plan's `heavy`), the block is as
// wide as the narrowest such row, up to 256, so that every lane works in that member's phase. Measured with the
// division inside (scripts 06 and 09): attention (rows of 1024 and 64) 1.41 ms at 64 threads, 1.91 at 128, 1.86
// at 32; narrow-div with rows of 128: 1.56 at 64, 1.21 at 128, 2.33 at 256. 256 is the widest block that was
// faster than the next narrower one in any measurement (layernorm with staged terms; 512 was slower).
export const blockThreads = { rows: 128, contraction: 64, heavy: 256 };
// Dynamic shared memory a block may use without opting in (CUDA's fixed default).
const defaultShared = 48 * 1024;

const product = (dims: string[]) =>
  dims.length ? `(${dims.map(d => `static_cast<U>(${d})`).join(' * ')})` : 'static_cast<U>(1)';

// Stage 3: one kernel for a fused group (fusion.ts). Thread mode keeps stage 2's mapping with the members'
// values in registers; block mode runs one block per block-domain point with rows in shared memory, or in a
// global scratch area when they do not fit.
function emitGroup(
  group: SchedKernel,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
) {
  const { depth } = group;
  const kernel = group.id;
  const members = group.statements.map(n => tensors.get(n) as Statement);
  const inGroup = new Set(group.statements),
    stored = new Set(group.stored!),
    staged = new Set(group.staged!);
  const block = group.mode === 'block';
  const reads = new Set<string>();
  for (const m of members)
    visit(m.expr, e => {
      if (e.kind === 'load' && !inGroup.has(e.name)) reads.add(e.name);
    });
  // A block-mode kernel takes every member's buffer: its per-statement instantiations store each one.
  const outputs = members.filter(m => block || stored.has(m.name)).map(m => tensorName(m.name));
  const params = [
    ...Array.from(dimensions.values(), d => `I ${d}`),
    ...Array.from(reads, t => `const float* ${tensorName(t)}`),
    ...outputs.map(t => `float* ${t}`),
    ...(block ? ['float* scratch'] : []),
    'U count',
  ];
  const suffix = (name: string) => tensorName(name).slice(1);
  const rowBuffers = [...group.staged!, ...group.buffered!];
  const registers = new Map<string, string>();
  let current = members[0];
  const operands = (e: Expr, inReduction: boolean): boolean =>
    e.kind === 'load'
      ? inReduction && !rowBuffers.includes(e.name)
      : e.kind === 'op'
        ? e.args.some(a => operands(a, inReduction))
        : e.kind === 'reduce' && operands(e.body, true);
  // The bind pass decides the cap (a schedule field); a kernel with heavy members chooses its width at launch.
  const cap =
    group.threads ??
    (members.some(m => operands(m.expr, false)) ? blockThreads.contraction : blockThreads.rows);
  // Staged terms (fusion.ts): reduction -> the name suffix of its count and pointer.
  const termIds = new Map<Reduce, string>();
  const memberTerms = members.map(m => {
    const outer = outerReductions(m.expr);
    return group
      .terms!.filter(t => t.statement === m.name)
      .map(t => {
        termIds.set(outer[t.reduction], `${suffix(m.name)}_${t.reduction}`);
        return outer[t.reduction];
      });
  });
  const w = kernelWriter(
    dimensions,
    (e, offset) => {
      const shape = tensors.get(e.name)!.shape;
      if (!block && inGroup.has(e.name)) return registers.get(e.name)!;
      const ownRow = e.indices.slice(0, depth).every((a, p) => plain(a) === current.axes[p].id);
      if (block && rowBuffers.includes(e.name) && ownRow)
        return `r${suffix(e.name)}[${offset(e.indices.slice(depth), shape.slice(depth)) || '0'}]`;
      if (inGroup.has(e.name)) throw Error(`Fused read of ${e.name} outside its row`);
      return `${tensorName(e.name)}[${offset(e.indices, shape)}]`;
    },
    'max_nan(ACC, VALUE)',
    e => (termIds.has(e) ? { count: `c${termIds.get(e)}`, terms: `q${termIds.get(e)}` } : undefined),
  );
  w.lines.push(`// ${kernel}: ${group.statements.join(', ')}; ${group.reasons.join('; ')}`);
  // Block mode is a template; the host picks the instantiation. Modes 0 and 1 say where the rows live, so that
  // shared-memory rows are addressed as shared memory (generic addressing cost 25% on a row max, IRWB-029-D script
  // 06). Mode 2 + s is member s alone in stage 2's mapping and scalar code, for launches where the gate
  // (fusion.ts) finds block mode slower: the host then launches the members' instantiations in order.
  if (block) w.lines.push('template <int Mode>');
  w.lines.push(`__global__ void ${kernel}(${params.join(', ')}) {`);
  if (block) {
    w.line('if (Mode >= 2) {');
    w.line('  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
    w.line('  if (thread >= count) return;');
    members.forEach((m, j) => {
      const alone = kernelWriter(
        dimensions,
        (e, offset) => `${tensorName(e.name)}[${offset(e.indices, tensors.get(e.name)!.shape)}]`,
      );
      elementOfThread(alone, m, tensorName(m.name));
      w.line(`  if (Mode == ${2 + j}) {`);
      w.lines.push(...alone.lines.map(l => '    ' + l));
      w.line('  }');
    });
    w.line('  return;');
    w.line('}');
    w.line('constexpr bool Shared = Mode == 1;');
  }
  const first = members[0];
  const counter = block ? 'point' : 'thread';
  if (block) {
    w.line('extern __shared__ float shared[];');
    w.line('const U point = blockIdx.x;');
  } else {
    w.line('const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
    w.line('if (thread >= count) return;');
  }
  w.line(`U coordinate = ${counter};`);
  for (let p = depth - 1; p >= 0; --p) {
    const axis = w.bind(first.axes[p].id);
    w.line(`const I ${axis} = coordinate % ${w.dim(first.shape[p])};`);
    if (p > 0) w.line(`coordinate /= ${w.dim(first.shape[p])};`);
    for (const m of members.slice(1)) w.alias(m.axes[p].id, axis);
  }
  const lengthOf = (name: string, dim: (a: Affine) => string) =>
    product(tensors.get(name)!.shape.slice(depth).map(dim));
  const host: string[] = [];
  let hasWork: string;
  if (block) {
    for (const name of new Set([...group.staged!, ...group.statements]))
      w.line(`const U n${suffix(name)} = ${lengthOf(name, w.dim)};`);
    // A term count is the product of the reduction's extents; the host computes the same expressions. The term
    // area holds one member's terms at a time, so its length is the largest member's.
    const count = (r: Reduce) =>
      product(r.axes.map(a => `(${w.bound(a.extent)} > 0 ? ${w.bound(a.extent)} : 0)`));
    const staging = memberTerms.filter(rs => rs.length);
    for (const r of staging.flat()) w.line(`const U c${termIds.get(r)} = ${count(r)};`);
    const area = (c: (r: Reduce) => string) =>
      // (a ternary: std::max is not callable in device code, probe in diary step 2)
      staging
        .map(rs => rs.map(c).join(' + '))
        .reduce((a, b) => (a ? `((${a}) > (${b}) ? (${a}) : (${b}))` : b), '');
    // A member written in place (fusion.ts) has no buffer of its own.
    const over = new Map(group.inPlace!.map(p => [p.statement, p.over]));
    const owners = rowBuffers.filter(n => !over.has(n));
    const row = [
      ...owners.map(n => `n${suffix(n)}`),
      ...(staging.length ? [area(r => `c${termIds.get(r)}`)] : []),
    ].join(' + ');
    w.line(`float* const base = Shared ? shared : scratch + point * (${row});`);
    for (const name of rowBuffers) {
      const i = owners.indexOf(name);
      const at = over.has(name)
        ? `r${suffix(over.get(name)!)}`
        : i
          ? `r${suffix(owners[i - 1])} + n${suffix(owners[i - 1])}`
          : 'base';
      w.line(`float* const r${suffix(name)} = ${at};`);
    }
    const last = owners.at(-1);
    if (staging.length)
      w.line(`float* const terms = ${last ? `r${suffix(last)} + n${suffix(last)}` : 'base'};`);
    for (const name of group.staged!) {
      const s = suffix(name);
      w.line(`for (U e = threadIdx.x; e < n${s}; e += blockDim.x) r${s}[e] = t${s}[point * n${s} + e];`);
    }
    if (group.staged!.length) w.line('__syncthreads();');
    members.forEach((m, j) => {
      current = m;
      const s = suffix(m.name);
      // Term pass: every thread computes terms with the scalar code of the reduction's body; term e is the e-th
      // in the meaning's order (row-major over the reduction's axes, the first outermost).
      memberTerms[j].forEach((r, q) => {
        const id = termIds.get(r)!;
        const before = memberTerms[j].slice(0, q).map(x => ` + c${termIds.get(x)}`);
        w.line(`float* const q${id} = terms${before.join('')};`);
        w.line(`for (U e = threadIdx.x; e < c${id}; e += blockDim.x) {`);
        w.enter();
        if (r.axes.length > 1) w.line('U rest = e;');
        for (let a = r.axes.length - 1; a >= 0; --a) {
          const axis = w.bind(r.axes[a].id);
          w.line(`const I ${axis} = ${r.axes.length > 1 ? 'rest' : 'e'} % (${w.bound(r.axes[a].extent)});`);
          if (a > 0) w.line(`rest /= (${w.bound(r.axes[a].extent)});`);
        }
        const term = w.scalar(r.body);
        w.line(`q${id}[e] = ${term};`);
        w.leave();
        w.line('}');
      });
      if (memberTerms[j].length) w.line('__syncthreads();');
      w.line(`for (U e = threadIdx.x; e < n${s}; e += blockDim.x) {`);
      w.enter();
      if (m.axes.length > depth) w.line('U rest = e;');
      for (let p = m.axes.length - 1; p >= depth; --p) {
        const axis = w.bind(m.axes[p].id);
        w.line(`const I ${axis} = rest % ${w.dim(m.shape[p])};`);
        if (p > depth) w.line(`rest /= ${w.dim(m.shape[p])};`);
      }
      const value = w.scalar(m.expr);
      if (group.buffered!.includes(m.name)) w.line(`r${s}[e] = ${value};`);
      if (stored.has(m.name)) w.line(`t${s}[point * n${s} + e] = ${value};`);
      w.leave();
      w.line('}');
      if (j < members.length - 1) w.line('__syncthreads();');
    });
    // The host computes the same lengths from the same shape values.
    const hostDim = (a: Affine) => affine(a, n => dimensions.get(n)!);
    const lengths = [...new Set([...group.staged!, ...group.statements])].map(n => lengthOf(n, hostDim));
    lengths.push(...staging.flat().map(count));
    const hostRow = [...owners.map(n => lengthOf(n, hostDim)), ...(staging.length ? [area(count)] : [])].join(
      ' + ',
    );
    host.push(
      `  const U grid_${kernel} = ${product(first.shape.slice(0, depth).map(hostDim))};`,
      `  const U row_${kernel} = (${hostRow}) * sizeof(float);`,
      `  const bool shared_${kernel} = row_${kernel} <= static_cast<U>(shared_limit);`,
      `  const U longest_${kernel} = std::max<U>({${lengths.join(', ')}, static_cast<U>(1)});`,
      group.heavy!.length || cap === undefined
        ? `  const unsigned threads_${kernel} = static_cast<unsigned>(std::min<U>(${blockThreads.heavy}, (std::max<U>(std::min<U>({${group.heavy!.map(n => lengthOf(n, hostDim)).join(', ')}}), 1) + 31) / 32 * 32));`
        : `  const unsigned threads_${kernel} = static_cast<unsigned>(std::min<U>(${cap}, (longest_${kernel} + 31) / 32 * 32));`,
      // The gate: block mode, or the members one by one. --gate=fused|unfused forces a side (the contract).
      // Blocks of this kernel that fit on one SM, by its block, thread and shared-memory limits (each block's
      // shared memory includes the device's reserved part: 1 KiB on the GB10).
      `  const U resident_${kernel} = std::min<U>({sm_blocks, sm_threads / threads_${kernel}, shared_${kernel} ? sm_shared / (row_${kernel} + sm_reserved) : sm_blocks});`,
      `  const bool fused_${kernel} = gate_mode ? gate_mode == 1 : ${gateRule({
        grid: `grid_${kernel}`,
        longest: `longest_${kernel}`,
        lanes: group.heavy!.map(
          n => `resident_${kernel} * std::min<U>(threads_${kernel}, ${lengthOf(n, hostDim)})`,
        ),
        slots: 'sm_threads',
      })};`,
      `  DeviceBuffer scratch_${kernel}(fused_${kernel} && !shared_${kernel} ? grid_${kernel} * (row_${kernel} / sizeof(float)) : 0);`,
      ...members
        .filter(m => !stored.has(m.name))
        .map(
          m =>
            `  DeviceBuffer ${tensorName(m.name)}(fused_${kernel} ? 0 : elements(shape_${tensorName(m.name)}));`,
        ),
    );
    hasWork = `grid_${kernel}`;
  } else {
    for (const m of members) {
      current = m;
      const value = w.scalar(m.expr);
      registers.set(m.name, value);
      if (stored.has(m.name)) w.line(`${tensorName(m.name)}[thread] = ${value};`);
    }
    host.push(`  const U count_${kernel} = elements(shape_${tensorName(first.name)});`);
    hasWork = `count_${kernel}`;
  }
  w.lines.push('}');
  const args = [
    ...dimensions.values(),
    ...Array.from(reads, t => tensorName(t) + '.ptr'),
    ...outputs.map(t => t + '.ptr'),
    ...(block ? [`scratch_${kernel}.ptr`] : [`count_${kernel}`]),
  ];
  const optIn = `shared_${kernel} && row_${kernel} > ${defaultShared}`;
  const size = (m: Statement) => `elements(shape_${tensorName(m.name)})`;
  const blockArgs = [...args, '0'].join(', ');
  return {
    code: w.lines.join('\n'),
    host,
    preload: block
      ? `  if (grid_${kernel} && fused_${kernel}) {
    check(cudaFuncGetAttributes(&attributes, shared_${kernel} ? ${kernel}<1> : ${kernel}<0>));
    if (${optIn}) check(cudaFuncSetAttribute(${kernel}<1>, cudaFuncAttributeMaxDynamicSharedMemorySize, static_cast<int>(row_${kernel})));
  }
  if (grid_${kernel} && !fused_${kernel}) {
${members.map((_m, j) => `    check(cudaFuncGetAttributes(&attributes, ${kernel}<${2 + j}>));`).join('\n')}
  }`
      : `  if (count_${kernel}) check(cudaFuncGetAttributes(&attributes, ${kernel}));`,
    hasWork,
    launch: block
      ? `    if (grid_${kernel} && fused_${kernel} && shared_${kernel}) ${kernel}<1><<<static_cast<unsigned>(grid_${kernel}), threads_${kernel}, row_${kernel}>>>(${blockArgs});
    if (grid_${kernel} && fused_${kernel} && !shared_${kernel}) ${kernel}<0><<<static_cast<unsigned>(grid_${kernel}), threads_${kernel}>>>(${blockArgs});
${members
  .map(
    (m, j) =>
      `    if (!fused_${kernel} && ${size(m)}) ${kernel}<${2 + j}><<<(${size(m)} - 1) / 256 + 1, 256>>>(${[...args, size(m)].join(', ')});`,
  )
  .join('\n')}
    if (grid_${kernel}) check(cudaGetLastError());`
      : `    if (count_${kernel}) {
      ${kernel}<<<(count_${kernel} - 1) / 256 + 1, 256>>>(${args.join(', ')});
      check(cudaGetLastError());
    }`,
  };
}

// Tile mode (IRWB-033-I): one block per tile of the output space, each thread computing a register patch, and
// each chunked reduction staging its operands' tiles in shared memory before the chunk's terms run. The
// schedule says every size and layout; this function only prints. Mode 1 is the tiled path; mode 2 + j is
// member j alone in stage 2's mapping, for launches where the gate finds tiling slower.
function emitTileKernel(
  kernel: SchedKernel,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
) {
  const loadsOf = (m: Statement): Extract<Expr, { kind: 'load' }>[] => {
    const out: Extract<Expr, { kind: 'load' }>[] = [];
    visit(m.expr, e => {
      if (e.kind === 'load') out.push(e);
    });
    return out;
  };
  const members = kernel.statements.map(n => tensors.get(n) as Statement);
  const first = members[0];
  const axesN = first.axes.length;
  const tiles = kernel.tiles!;
  const threads = kernel.threads!;
  const block = tiles[0].block;
  const patch = tiles[0].patch;
  const patchMap = tiles[0].patchMap!;
  const unroll = tiles[0].unroll === true;
  const stored = new Set(kernel.stored!);
  const inKernel = new Set(kernel.statements);
  const reads = new Set<string>();
  for (const m of members)
    visit(m.expr, e => {
      if (e.kind === 'load' && !inKernel.has(e.name)) reads.add(e.name);
    });
  const params = [
    ...Array.from(dimensions.values(), d => `I ${d}`),
    ...Array.from(reads, t => `const float* ${tensorName(t)}`),
    ...members.map(m => `float* ${tensorName(m.name)}`),
    'U count',
  ];
  const suffix = (s: string) => tensorName(s).slice(1);
  const chunkElements = (c: ChunkSchedule) => (c.unit === 'block' ? c.size * c.split!.width : c.size);

  // Emission state: the patch loop variables and the linear patch index, the reductions already computed into
  // register arrays, and the staged tiles of the chunk phase being emitted.
  let patchLinear = '0';
  const patchVars: string[] = new Array(axesN).fill('0');
  const staged = new Map<
    string,
    {
      dims: ('chunk' | string)[];
      extents: number[];
      pointer: string;
      member: Statement;
      chunk: ChunkSchedule;
    }[]
  >();
  const reducedRegs = new Map<Reduce, string>();
  const axisAt = (m: Statement, d: string) => m.axes.findIndex(a => a.id === d);

  const w = kernelWriter(
    dimensions,
    (e, offset) => {
      if (inKernel.has(e.name)) return `v${suffix(e.name)}[${patchLinear}]`;
      const list = staged.get(e.name);
      if (list)
        for (const tile of list) {
          const mine = e.indices.map(idx => {
            const id = plain(idx);
            return id && (id === tile.chunk.axis || (tile.chunk.split && id === tile.chunk.split.inner))
              ? 'chunk'
              : id!;
          });
          if (JSON.stringify(mine) !== JSON.stringify(tile.dims)) continue;
          let at = '';
          tile.dims.forEach((d, p) => {
            const aff = w.affineOf(e.indices[p]);
            const local =
              d === 'chunk' ? `(${aff} - kBase)` : `(${aff} - ${origins[axisAt(tile.member, d as string)]})`;
            at = at ? `(${at} * ${tile.extents[p]} + ${local})` : local;
          });
          return `${tile.pointer}[${at}]`;
        }
      return `${tensorName(e.name)}[${offset(e.indices, tensors.get(e.name)!.shape)}]`;
    },
    'max_nan(ACC, VALUE)',
    undefined,
    e => (reducedRegs.has(e) ? `${reducedRegs.get(e)!}[${patchLinear}]` : undefined),
  );
  const origins: string[] = [];

  const lines = w.lines;
  lines.push(`// ${kernel.id}: ${kernel.statements.join(', ')}; ${kernel.reasons.join('; ')}`);
  lines.push('template <int Mode>');
  lines.push(`__global__ void ${kernel.id}(${params.join(', ')}) {`);
  w.line('if (Mode >= 2) {');
  w.line('  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
  w.line('  if (thread >= count) return;');
  members.forEach((m, j) => {
    const alone = kernelWriter(
      dimensions,
      (e, offset) => `${tensorName(e.name)}[${offset(e.indices, tensors.get(e.name)!.shape)}]`,
    );
    elementOfThread(alone, m, tensorName(m.name));
    w.line(`  if (Mode == ${2 + j}) {`);
    w.lines.push(...alone.lines.map(l => '    ' + l));
    w.line('  }');
  });
  w.line('  return;');
  w.line('}');

  w.line('extern __shared__ float shared[];');
  w.line('const U tile = blockIdx.x;');
  // Tile origins over the output axes, last axis fastest.
  w.line('U coordinate = tile;');
  for (let a = axesN - 1; a >= 0; --a) {
    const nt = `((${w.dim(first.shape[a])} + ${block[a]} - 1) / ${block[a]})`;
    w.line(`const I o${a} = static_cast<I>(coordinate % ${nt}) * ${block[a]};`);
    origins[a] = `o${a}`;
    if (a > 0) w.line(`coordinate /= ${nt};`);
  }
  // The thread's tile coordinates over the axes the patch spreads over, last axis fastest.
  w.line('int threadCoord = threadIdx.x;');
  const threadOf: string[] = [];
  for (let a = axesN - 1; a >= 0; --a) {
    const lanes = block[a] / patch[a];
    if (lanes > 1) {
      w.line(`const int c${a} = threadCoord % ${lanes};`);
      w.line(`threadCoord /= ${lanes};`);
      threadOf[a] = `c${a}`;
    } else threadOf[a] = '0';
  }
  // The global coordinate of output axis a, from the origins, the thread's tile coordinate and the patch.
  // The patch loop variables are named p<a> deterministically, so the text is valid wherever a patch loop is
  // in scope (every use of a coordinate is inside one).
  const coordOf = (a: number) => {
    const parts = [origins[a]];
    if (block[a] / patch[a] > 1) parts.push(threadOf[a]);
    if (patch[a] > 1) parts.push(patchMap[a] === 'strided' ? `p${a} * ${block[a] / patch[a]}` : `p${a}`);
    const live = parts.filter(p => p !== '0');
    return live.length > 1 ? `(${live.join(' + ')})` : (live[0] ?? '0');
  };

  // The linear patch index, from the patch loop variables.
  const linearOf = () => {
    let at = '0';
    for (let a = 0; a < axesN; ++a)
      at = patchVars[a] === '0' ? `(${at} * ${patch[a]})` : `(${at} * ${patch[a]} + ${patchVars[a]})`;
    return at;
  };
  const patchLoop = (withUnroll: boolean, body: () => void) => {
    const opened: number[] = [];
    for (let a = 0; a < axesN; ++a) {
      if (patch[a] > 1) {
        patchVars[a] = `p${a}`;
        if (withUnroll) w.line('#pragma unroll');
        w.line(`for (int p${a} = 0; p${a} < ${patch[a]}; ++p${a}) {`);
        w.enter();
        opened.push(a);
      } else patchVars[a] = '0';
    }
    patchLinear = linearOf();
    body();
    for (const _ of opened.reverse()) {
      w.leave();
      w.line('}');
    }
  };

  // The staging of a chunk's operand tiles, followed by the registration of their read addresses.
  const stageTiles = (
    m: Statement,
    chunk: ChunkSchedule,
    kBase: string,
    elementExtent: string,
    guardChunk: boolean,
  ) => {
    let off = 0;
    chunk.stage.forEach((st, ti) => {
      const t = tensors.get(st.tensor)!;
      const extents = st.dims.map(d =>
        d === 'chunk' ? chunkElements(chunk) : block[axisAt(m, d as string)],
      );
      const elems = extents.reduce((x, y) => x * y, 1);
      w.line(`float* const q${ti} = shared + ${off};`);
      off += elems;
      const globalAt = (p: number, local: string) => {
        const d = st.dims[p];
        return d === 'chunk' ? `(${kBase} + ${local})` : `(${origins[axisAt(m, d as string)]} + ${local})`;
      };
      const guardAt = (p: number, local: string) => {
        const d = st.dims[p];
        if (d === 'chunk') return guardChunk ? `(${kBase} + ${local}) < (${elementExtent})` : '';
        return `(${origins[axisAt(m, d as string)]} + ${local}) < (${w.dim(t.shape[p])})`;
      };
      const addressOf = (gs: string[]) =>
        gs.reduce((at, g, p) => (p ? `(${at} * ${w.dim(t.shape[p])} + ${g})` : g), '');
      const locals: string[] = new Array(st.dims.length).fill('0');
      const lastP = st.dims.length - 1;
      const linOf = (lastLocal: string) => {
        let at = '';
        st.dims.forEach((_, p) => {
          const l = p === lastP ? lastLocal : locals[p];
          at = at ? `(${at} * ${extents[p]} + ${l})` : l;
        });
        return at;
      };
      const scalarLoad = () => {
        w.line(`for (U e = threadIdx.x; e < ${elems}; e += blockDim.x) {`);
        w.enter();
        if (st.dims.length === 1) {
          w.line('const I l0 = static_cast<I>(e);');
          locals[0] = 'l0';
        } else {
          w.line('U rest = e;');
          for (let p = st.dims.length - 1; p >= 0; --p) {
            w.line(`const I l${p} = rest % ${extents[p]};`);
            locals[p] = `l${p}`;
            if (p > 0) w.line(`rest /= ${extents[p]};`);
          }
        }
        const conds = st.dims.map((_, p) => guardAt(p, locals[p])).filter(Boolean);
        const value = `${tensorName(st.tensor)}[${addressOf(st.dims.map((_, p) => globalAt(p, locals[p])))}]`;
        w.line(
          `q${ti}[${linOf(locals[lastP])}] = ${conds.length ? `${conds.join(' && ')} ? ${value} : 0.0f` : value};`,
        );
        w.leave();
        w.line('}');
      };
      scalarLoad();
      staged.set(st.tensor, [
        ...(staged.get(st.tensor) ?? []),
        { dims: st.dims, extents, pointer: `q${ti}`, member: m, chunk },
      ]);
    });
  };

  // One chunk phase: stage, barrier, the chunk's terms, drop the tile addresses, barrier.
  const phase = (
    m: Statement,
    r: Reduce,
    chunk: ChunkSchedule,
    acc: string,
    count: string,
    blocksBase: string,
    kBase: string,
    guardChunk: boolean,
    elementExtent: string,
  ) => {
    stageTiles(m, chunk, kBase, elementExtent, guardChunk);
    w.line('__syncthreads();');
    const foldInto = (term: string) =>
      w.line(
        `${acc}[${patchLinear}] = ${r.op === 'sum' ? `__fadd_rn(${acc}[${patchLinear}], ${term})` : `max_nan(${acc}[${patchLinear}], ${term})`};`,
      );
    if (chunk.unit === 'element') {
      if (unroll) w.line('#pragma unroll');
      w.line(`for (int kk = 0; kk < ${count}; ++kk) {`);
      w.enter();
      w.line('const I kG = kBase + kk;');
      w.alias(chunk.axis, 'kG');
      patchLoop(unroll, () => foldInto(w.scalar(r.body)));
      w.leave();
      w.line('}');
    } else {
      w.line(`for (int bb = 0; bb < ${count}; ++bb) {`);
      w.enter();
      w.line(`const I kO = ${blocksBase} + bb;`);
      w.alias(chunk.axis, 'kO');
      w.line(`const I endL = ${w.bound(r.axes[1].extent)};`);
      w.line('for (I ll = 0; ll < endL; ++ll) {');
      w.enter();
      w.alias(chunk.split!.inner, 'll');
      patchLoop(unroll, () => foldInto(w.scalar(r.body)));
      w.leave();
      w.line('}');
      w.leave();
      w.line('}');
    }
    staged.clear();
    w.line('__syncthreads();');
  };

  // The chunk loops of one tiled reduction: chunks of `size` axis units, then the remainder.
  const chunkLoops = (m: Statement, r: Reduce, chunk: ChunkSchedule, acc: string) => {
    const isSplit = chunk.unit === 'block';
    const ext = w.bound(r.axes[0].extent);
    const elementExtent = isSplit ? w.dim(r.axes[0].extent.dim) : ext;
    w.line('{');
    w.enter();
    w.line(`const I nFull = (${ext}) / ${chunk.size};`);
    w.line('for (I b = 0; b < nFull; ++b) {');
    w.enter();
    phase(
      m,
      r,
      chunk,
      acc,
      String(chunk.size),
      `b * ${chunk.size}`,
      `b * ${chunkElements(chunk)}`,
      isSplit,
      elementExtent,
    );
    w.leave();
    w.line('}');
    w.line(`const I rem = (${ext}) - nFull * ${chunk.size};`);
    w.line('if (rem) {');
    w.enter();
    phase(
      m,
      r,
      chunk,
      acc,
      'rem',
      `nFull * ${chunk.size}`,
      `nFull * ${chunkElements(chunk)}`,
      true,
      elementExtent,
    );
    w.leave();
    w.line('}');
    w.leave();
    w.line('}');
  };

  // The members, in order: each one's chunked reductions first, then its epilogue over the patch.
  members.forEach((m, mi) => {
    const tile = tiles[mi];
    for (let a = 0; a < axesN; ++a) w.alias(m.axes[a].id, coordOf(a));
    outerReductions(m.expr).forEach((r, ri) => {
      const chunk = tile.chunks[ri];
      if (!chunk) return;
      const acc = `a${mi}r${ri}`;
      reducedRegs.set(r, acc);
      w.line(`float ${acc}[${patch.reduce((x, y) => x * y, 1)}];`);
      if (unroll) w.line('#pragma unroll');
      w.line(
        `for (int e = 0; e < ${patch.reduce((x, y) => x * y, 1)}; ++e) ${acc}[e] = ${r.op === 'sum' ? '0.0f' : '-INFINITY'};`,
      );
      chunkLoops(m, r, chunk, acc);
    });
    const readLater = members
      .slice(mi + 1)
      .some(mm =>
        loadsOf(mm).some(e => e.name === m.name && e.indices.every((x, p) => plain(x) === mm.axes[p].id)),
      );
    patchLoop(unroll, () => {
      const value = w.scalar(m.expr);
      if (readLater) w.line(`v${suffix(m.name)}[${patchLinear}] = ${value};`);
      if (stored.has(m.name)) {
        const guard = m.axes.map((_, a) => `(${coordOf(a)}) < (${w.dim(m.shape[a])})`).join(' && ');
        w.line(
          `if (${guard}) ${tensorName(m.name)}[${w.address(
            m.axes.map(ax => variable(ax.id)),
            m.shape,
          )}] = ${value};`,
        );
      }
    });
  });

  lines.push('}');
  const hostDim = (a: Affine) => affine(a, n => dimensions.get(n)!);
  const tilesExpr = product(first.shape.map((d, a) => `((${hostDim(d)} + ${block[a]} - 1) / ${block[a]})`));
  const sharedExprs: string[] = [];
  const aligns: string[] = [];
  members.forEach((m, mi) =>
    outerReductions(m.expr).forEach((_, ri) => {
      const chunk = tiles[mi].chunks[ri];
      if (!chunk) return;
      const sizes = chunk.stage.map(st => {
        const t = tensors.get(st.tensor)!;
        const extents = st.dims.map(d =>
          d === 'chunk' ? chunkElements(chunk) : block[axisAt(m, d as string)],
        );
        if (st.vector === 4) aligns.push(`((${hostDim(t.shape[t.shape.length - 1])}) % 4 == 0)`);
        return product(extents.map(e => String(e)));
      });
      if (sizes.length) sharedExprs.push(sizes.join(' + '));
    }),
  );
  const rowElems = sharedExprs.reduce((a, b) => (a ? `((${a}) > (${b}) ? (${a}) : (${b}))` : b), '');
  const row = `${rowElems} * sizeof(float)`;
  const fits = `row_${kernel.id} <= static_cast<U>(shared_limit)`;
  const align = aligns.join(' && ');
  const rule = `${tilesExpr} >= ${tileGate.minTiles}`;
  const host = [
    `  const U tiles_${kernel.id} = ${tilesExpr};`,
    `  const U row_${kernel.id} = ${row};`,
    `  const bool fits_${kernel.id} = row_${kernel.id} <= static_cast<U>(shared_limit);`,
    `  const bool aligned_${kernel.id} = ${align || 'true'};`,
    `  const bool fused_${kernel.id} = gate_mode == 2 ? false : gate_mode == 1 ? fits_${kernel.id} && aligned_${kernel.id} : (${rule} && fits_${kernel.id} && aligned_${kernel.id});`,
    ...members
      .filter(m => !stored.has(m.name))
      .map(
        m =>
          `  DeviceBuffer ${tensorName(m.name)}(fused_${kernel.id} ? 0 : elements(shape_${tensorName(m.name)}));`,
      ),
  ];
  const args = [
    ...dimensions.values(),
    ...Array.from(reads, t => tensorName(t) + '.ptr'),
    ...members.map(m => tensorName(m.name) + '.ptr'),
  ];
  const size = (m: Statement) => `elements(shape_${tensorName(m.name)})`;
  const optIn = `row_${kernel.id} > ${defaultShared}`;
  return {
    code: lines.join('\n'),
    host,
    preload: `  if (tiles_${kernel.id} && fused_${kernel.id}) {
    check(cudaFuncGetAttributes(&attributes, ${kernel.id}<1>));
    if (${optIn}) check(cudaFuncSetAttribute(${kernel.id}<1>, cudaFuncAttributeMaxDynamicSharedMemorySize, static_cast<int>(row_${kernel.id})));
  }
  if (tiles_${kernel.id} && !fused_${kernel.id}) {
${members.map((_m, j) => `    check(cudaFuncGetAttributes(&attributes, ${kernel.id}<${2 + j}>));`).join('\n')}
  }`,
    hasWork: `tiles_${kernel.id}`,
    launch: `    if (tiles_${kernel.id} && fused_${kernel.id}) ${kernel.id}<1><<<static_cast<unsigned>(tiles_${kernel.id}), ${threads}, row_${kernel.id}>>>(${[...args, '0'].join(', ')});
${members
  .map(
    (m, j) =>
      `    if (!fused_${kernel.id} && ${size(m)}) ${kernel.id}<${2 + j}><<<(${size(m)} - 1) / 256 + 1, 256>>>(${[...args, size(m)].join(', ')});`,
  )
  .join('\n')}
    if (tiles_${kernel.id}) check(cudaGetLastError());`,
  };
}

/** The CUDA translation unit for `fn`'s schedule: one kernel per entry, printed exactly as the schedule says
 *  (IRWB-033-I). The emitter makes no decisions of its own; every mapping, tile, chunk, staging layout, thread
 *  count and gate rule is a field of the schedule. */
export function emitCuda(fn: Fn, schedule: ScheduleUnit): string {
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
  const kernels = schedule.kernels.map(k =>
    k.mode === 'tile'
      ? emitTileKernel(k, dims, tensors, name)
      : k.mode === 'thread' && k.statements.length === 1
        ? emitKernel(tensors.get(k.statements[0]) as Statement, k.id, dims, tensors, name)
        : emitGroup(k, dims, tensors, name),
  );
  const stored = new Set(schedule.kernels.flatMap(k => k.stored ?? []));
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
      host.push(`  const std::array<I, ${s.shape.length}> shape_${t}{${dimsText}};`);
      if (stored.has(s.name)) host.push(`  DeviceBuffer ${t}(elements(shape_${t}));`);
    }
    if (schedule.kernels.some(k => k.mode !== 'thread'))
      host.push(
        '  int shared_limit = 0, sm_shared_bytes = 0, sm_block_limit = 0, reserved_bytes = 0;',
        '  check(cudaDeviceGetAttribute(&reserved_bytes, cudaDevAttrReservedSharedMemoryPerBlock, 0));',
        '  check(cudaDeviceGetAttribute(&shared_limit, cudaDevAttrMaxSharedMemoryPerBlockOptin, 0));',
        // The SM's limits, for the gate (the calls of IRWB-029-D probe 01).
        '  check(cudaDeviceGetAttribute(&sm_shared_bytes, cudaDevAttrMaxSharedMemoryPerMultiprocessor, 0));',
        '  check(cudaDeviceGetAttribute(&sm_block_limit, cudaDevAttrMaxBlocksPerMultiprocessor, 0));',
        '  cudaDeviceProp device;',
        '  check(cudaGetDeviceProperties(&device, 0));',
        '  const U sm_shared = sm_shared_bytes, sm_blocks = sm_block_limit, sm_threads = device.maxThreadsPerMultiProcessor;',
        '  const U sm_reserved = std::max(reserved_bytes, 1);',
      );
    host.push(
      ...kernels.flatMap(k => k.host),
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
    ...schedule.kernels
      .filter(k => k.gated)
      .map(k => `  { const unsigned char choice = fused_${k.id} ? 1 : 0; write(output, &choice, 1); }`),
    '}',
  );
  const fused = schedule.kernels.some(k => k.mode === 'tile' || k.statements.length > 1)
    ? [fusedSupport]
    : [];
  const gated = schedule.kernels.some(k => k.gated);
  if (gated) fused.push(gateSupport);
  return [support, ...fused, ...kernels.map(k => k.code), host.join('\n'), gated ? gatedMain : main].join(
    '\n\n',
  );
}
