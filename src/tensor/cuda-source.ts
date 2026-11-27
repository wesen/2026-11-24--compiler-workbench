import { gateRule, outerReductions, type FusionGroup, type Reduce } from './fusion.js';
import {
  tileSharedBytes,
  type ScheduleKernel,
  type ScheduleUnit,
  type TileOperand,
  type TileSchedule,
} from './schedule.js';
import {
  plain,
  visit,
  width,
  type Affine,
  type Expr,
  type Extent,
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
  /** A reduction already folded elsewhere: its precomputed value (IRWB-033-F, the tiled contraction's fold). */
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
        const pre = reduced(e);
        if (pre !== undefined) return pre;
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
  group: FusionGroup,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
) {
  const { kernel, depth } = group;
  const members = group.statements.map(n => tensors.get(n) as Statement);
  const inGroup = new Set(group.statements),
    stored = new Set(group.stored),
    staged = new Set(group.staged);
  const block = group.mapping === 'block';
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
  const rowBuffers = [...group.staged, ...group.buffered];
  const registers = new Map<string, string>();
  let current = members[0];
  const operands = (e: Expr, inReduction: boolean): boolean =>
    e.kind === 'load'
      ? inReduction && !rowBuffers.includes(e.name)
      : e.kind === 'op'
        ? e.args.some(a => operands(a, inReduction))
        : e.kind === 'reduce' && operands(e.body, true);
  const cap = members.some(m => operands(m.expr, false)) ? blockThreads.contraction : blockThreads.rows;
  // Staged terms (fusion.ts): reduction -> the name suffix of its count and pointer.
  const termIds = new Map<Reduce, string>();
  const memberTerms = members.map(m => {
    const outer = outerReductions(m.expr);
    return group.terms
      .filter(t => t.statement === m.name)
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
    for (const name of new Set([...group.staged, ...group.statements]))
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
    const over = new Map(group.inPlace.map(p => [p.statement, p.over]));
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
    for (const name of group.staged) {
      const s = suffix(name);
      w.line(`for (U e = threadIdx.x; e < n${s}; e += blockDim.x) r${s}[e] = t${s}[point * n${s} + e];`);
    }
    if (group.staged.length) w.line('__syncthreads();');
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
      if (group.buffered.includes(m.name)) w.line(`r${s}[e] = ${value};`);
      if (stored.has(m.name)) w.line(`t${s}[point * n${s} + e] = ${value};`);
      w.leave();
      w.line('}');
      if (j < members.length - 1) w.line('__syncthreads();');
    });
    // The host computes the same lengths from the same shape values.
    const hostDim = (a: Affine) => affine(a, n => dimensions.get(n)!);
    const lengths = [...new Set([...group.staged, ...group.statements])].map(n => lengthOf(n, hostDim));
    lengths.push(...staging.flat().map(count));
    const hostRow = [...owners.map(n => lengthOf(n, hostDim)), ...(staging.length ? [area(count)] : [])].join(
      ' + ',
    );
    host.push(
      `  const U grid_${kernel} = ${product(first.shape.slice(0, depth).map(hostDim))};`,
      `  const U row_${kernel} = (${hostRow}) * sizeof(float);`,
      `  const bool shared_${kernel} = row_${kernel} <= static_cast<U>(shared_limit);`,
      `  const U longest_${kernel} = std::max<U>({${lengths.join(', ')}, static_cast<U>(1)});`,
      group.heavy.length
        ? `  const unsigned threads_${kernel} = static_cast<unsigned>(std::min<U>(${blockThreads.heavy}, (std::max<U>(std::min<U>({${group.heavy.map(n => lengthOf(n, hostDim)).join(', ')}}), 1) + 31) / 32 * 32));`
        : `  const unsigned threads_${kernel} = static_cast<unsigned>(std::min<U>(${cap}, (longest_${kernel} + 31) / 32 * 32));`,
      // The gate: block mode, or the members one by one. --gate=fused|unfused forces a side (the contract).
      // Blocks of this kernel that fit on one SM, by its block, thread and shared-memory limits (each block's
      // shared memory includes the device's reserved part: 1 KiB on the GB10).
      `  const U resident_${kernel} = std::min<U>({sm_blocks, sm_threads / threads_${kernel}, shared_${kernel} ? sm_shared / (row_${kernel} + sm_reserved) : sm_blocks});`,
      `  const bool fused_${kernel} = gate_mode ? gate_mode == 1 : ${gateRule({
        grid: `grid_${kernel}`,
        longest: `longest_${kernel}`,
        lanes: group.heavy.map(
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

// Stage 6 (IRWB-033-F): a tiled contraction kernel, printed from a `tile` schedule (schedule.ts). One
// definition per kernel: Mode 0 is the tiled schedule, one instantiation per tile configuration; Mode 1 is the
// statement in stage 2's element mapping, which the launch rule picks for small shapes and --gate can force.
// Each output element still folds its terms one at a time, k ascending, rounding the product with __fmul_rn and
// the fold with __fadd_rn (or max_nan) — the meaning's order. Only the layout around that order comes from the
// schedule: output tiles bound to blocks (consecutive blocks share the row panel, for L2), a register patch per
// thread, the reduction axis walked in BK-sized ascending chunks, operand tiles staged in shared memory (the
// i-tile rows stride BK+1 so the patch rows spread over banks; the j-tile rows are 16-byte aligned and read as
// one float4), masks for shapes that are not tile multiples, and k-iterations past the extent skipped, never
// folded with a zero.
function emitTileKernel(
  kernel: ScheduleKernel,
  tile: TileSchedule,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
) {
  const s = tensors.get(tile.statement) as Statement;
  const reads = new Set<string>();
  visit(s.expr, e => {
    if (e.kind === 'load') reads.add(e.name);
  });
  const args = [...dimensions.values(), ...Array.from(reads, tensorName), tensorName(s.name)];
  const params = [
    ...Array.from(dimensions.values(), d => `I ${d}`),
    ...Array.from(reads, t => `const float* ${tensorName(t)}`),
    'float* result',
    'U count',
  ];
  // The reduction node and its extent, decided by the tile pass from this same statement.
  let reduceNode: Reduce | undefined;
  visit(s.expr, e => {
    if (e.kind === 'reduce') reduceNode ??= e as Reduce;
  });
  const dim = (a: Affine) => affine(a, key => dimensions.get(key)!);
  const M = dim(s.shape[0]),
    N = dim(s.shape[1]),
    K = dim(reduceNode!.axes[0].extent.dim);
  const [iAxis, jAxis] = [s.axes[0].id, s.axes[1].id];
  const fold = (acc: string, term: string) =>
    reduceNode!.op === 'sum' ? `__fadd_rn(${acc}, ${term})` : `max_nan(${acc}, ${term})`;
  const init = reduceNode!.op === 'sum' ? '0.0f' : '-INFINITY';
  // Operand tile sizes (floats) and offsets inside one buffer set, in shared memory.
  const size = (l: TileOperand) =>
    l.cls === 'i' ? 'BM * (BK + 1)' : l.cls === 'j' ? 'BK * (BN + 4)' : 'BK';
  const setSize = () => `(${tile.loads.map(l => size(l)).join(' + ')})`;
  const offsetOf = (o: number) => tile.loads.slice(0, o).reduce((expr, l) => `(${expr} + ${size(l)})`, '0');
  // A plain-indexed load's global address: each axis id substituted by a tile-local expression, the stride of
  // position p the product of the extents after it (row-major).
  const globalOffset = (l: TileOperand, subs: ReadonlyMap<string, string>) => {
    const shape = tensors.get(l.tensor)!.shape;
    const stride = (p: number) =>
      shape
        .slice(p + 1)
        .reduce((text, a) => `${text} * ${dim(a)}`, '')
        .slice(3) || '1';
    const parts = l.indices.map(
      (id, p) => (p === l.indices.length - 1 ? subs.get(id)! : `${subs.get(id)!} * ${stride(p)}`),
    );
    return parts.length === 1 ? parts[0] : `(${parts.join(' + ')})`;
  };
  // Stage one chunk's operand tiles: every thread copies tile elements, fastest along the tensor's contiguous
  // axis (its last index position), so the global reads are coalesced; masked elements read as 0 and are never
  // folded. `chunk` is a parenthesized C++ expression of the chunk index.
  const stage = (chunk: string, set: string) =>
    tile.loads.flatMap((l, o) => {
      const ptr = `t_s${o}`;
      const lines = [`float* const ${ptr} = shared + (U)(${set}) * ${setSize()} + (U)(${offsetOf(o)});`];
      const t = tensorName(l.tensor);
      const k = `${chunk} * BK + `;
      const kFirst = l.indices[0] === tile.reduce.axis;
      if (l.cls === 'i') {
        // tile [BM over i][BK over k]: k-last operands enumerate k fastest, k-first ones i fastest
        const row = kFirst ? `t_e % BM` : `t_e / BK`;
        const col = kFirst ? `t_e / BM` : `t_e % BK`;
        lines.push(
          `for (U t_e = threadIdx.x; t_e < (U)(BM * BK); t_e += blockDim.x) {`,
          `  const I t_r = (I)(${row}), t_c2 = (I)(${col});`,
          `  ${ptr}[t_r * (BK + 1) + t_c2] = (t_i0 + t_r) < ${M} && (${k}t_c2) < ${K} ? ${t}[${globalOffset(l, new Map([[iAxis, '(t_i0 + t_r)'], [tile.reduce.axis, `(${k}t_c2)`]]))}] : 0.0f;`,
          `}`,
        );
      } else if (l.cls === 'j') {
        // tile [BK over k][BN over j]: k-first operands ([k, j]) enumerate j fastest, k-last ones k fastest
        const k2 = kFirst ? `t_e / BN` : `t_e % BK`;
        const j2 = kFirst ? `t_e % BN` : `t_e / BK`;
        lines.push(
          `for (U t_e = threadIdx.x; t_e < (U)(BK * BN); t_e += blockDim.x) {`,
          `  const I t_k2 = (I)(${k2}), t_j2 = (I)(${j2});`,
          `  ${ptr}[t_k2 * (BN + 4) + t_j2] = (${k}t_k2) < ${K} && (t_j0 + t_j2) < ${N} ? ${t}[${globalOffset(l, new Map([[jAxis, '(t_j0 + t_j2)'], [tile.reduce.axis, `(${k}t_k2)`]]))}] : 0.0f;`,
          `}`,
        );
      } else {
        lines.push(
          `for (U t_e = threadIdx.x; t_e < (U)BK; t_e += blockDim.x)`,
          `  ${ptr}[t_e] = (${k}t_e) < ${K} ? ${t}[${globalOffset(l, new Map([[tile.reduce.axis, `(${k}t_e)`]]))}] : 0.0f;`,
        );
      }
      return lines;
    });
  // One tiled body, parameterized by the template constants BM/BN/BK/TM/TN and Dbl; each launch site
  // instantiates it with a configuration's values. `Dbl` is a template constant, so its branches are uniform.
  const tiledBody = () => {
    const lines: string[] = [];
    const push = (text: string) => lines.push(text);
    push(`extern __shared__ float shared[];`);
    push(`const I t_M = ${M}, t_N = ${N}, t_K = ${K};`);
    push(`const I t_jt = (t_N + BN - 1) / BN;`);
    // consecutive blocks share the row panel of the first operand (i0 fixed, j0 fastest): L2 reuse
    push(`const I t_i0 = (I)blockIdx.x / t_jt * BM, t_j0 = ((I)blockIdx.x % t_jt) * BN;`);
    push(`const int t_pi = (int)threadIdx.x / (BN / TN), t_pj = (int)threadIdx.x % (BN / TN);`);
    push(`float t_acc[TM][TN];`);
    push('#pragma unroll');
    push('for (int t_pu = 0; t_pu < TM; ++t_pu)');
    push('#pragma unroll');
    push('  for (int t_pv = 0; t_pv < TN; ++t_pv)');
    push(`    t_acc[t_pu][t_pv] = ${init};`);
    push('const U t_chunks = ((U)t_K + BK - 1) / BK;');
    if (tile.double) {
      push('if (Dbl) {');
      for (const l of stage('0', '0')) push('  ' + l);
      push('  __syncthreads();');
      push('}');
    }
    push('for (U t_c = 0; t_c < t_chunks; ++t_c) {');
    if (tile.double) {
      push('  if (Dbl) {');
      push('    if (t_c + 1 < t_chunks) {');
      for (const l of stage('(t_c + 1)', '(t_c + 1) & 1')) push('      ' + l);
      push('    }');
      push('  } else {');
      for (const l of stage('t_c', '0')) push('    ' + l);
      push('    __syncthreads();');
      push('  }');
    } else {
      for (const l of stage('t_c', '0')) push('  ' + l);
      push('  __syncthreads();');
    }
    push('  const I t_kk = BK < t_K - (I)t_c * BK ? BK : t_K - (I)t_c * BK;');
    // read pointers for this chunk's buffer set
    tile.loads.forEach((l, o) =>
      push(
        `  const float* t_q${o} = shared + (U)(${tile.double ? '(Dbl ? t_c & 1 : 0)' : '0'}) * ${setSize()} + (U)(${offsetOf(o)});`,
      ),
    );
    push('  #pragma unroll');
    push('  for (int t_k1 = 0; t_k1 < BK; ++t_k1) {');
    push('    if (t_k1 < t_kk) {');
    tile.loads.forEach((l, o) => {
      if (l.cls === 'i') {
        push(`      float t_a${o}[TM];`);
        push('      #pragma unroll');
        push('      for (int t_pu = 0; t_pu < TM; ++t_pu)');
        push(`        t_a${o}[t_pu] = t_q${o}[(t_pi * TM + t_pu) * (BK + 1) + t_k1];`);
      } else if (l.cls === 'j') {
        // the j-tile rows are 4-float padded, so a patch column's TN values are 16-byte aligned: read them as
        // float4s (one LDS.128 per four banks: conflict-free throughput)
        push(`      float t_b${o}[TN];`);
        push('      #pragma unroll');
        push('      for (int t_q = 0; t_q < TN / 4; ++t_q) {');
        push(
          `        const float4 t_f${o} = *reinterpret_cast<const float4*>(t_q${o} + t_k1 * (BN + 4) + t_pj * TN + t_q * 4);`,
        );
        push(`        t_b${o}[t_q * 4] = t_f${o}.x; t_b${o}[t_q * 4 + 1] = t_f${o}.y; t_b${o}[t_q * 4 + 2] = t_f${o}.z; t_b${o}[t_q * 4 + 3] = t_f${o}.w;`);
        push('      }');
        push('      #pragma unroll');
        push('      for (int t_q = 0; t_q < TN % 4; ++t_q)');
        push(`        t_b${o}[TN - TN % 4 + t_q] = t_q${o}[t_k1 * (BN + 4) + t_pj * TN + TN - TN % 4 + t_q];`);
      } else {
        push(`      const float t_v${o} = t_q${o}[t_k1];`);
      }
    });
    push('      #pragma unroll');
    push('      for (int t_pu = 0; t_pu < TM; ++t_pu) {');
    push('        #pragma unroll');
    push('        for (int t_pv = 0; t_pv < TN; ++t_pv) {');
    const value = (o: number, pu: string, pv: string) =>
      tile.loads[o].cls === 'i' ? `t_a${o}[${pu}]` : tile.loads[o].cls === 'j' ? `t_b${o}[${pv}]` : `t_v${o}`;
    push(
      `          t_acc[t_pu][t_pv] = ${fold(
        't_acc[t_pu][t_pv]',
        `__fmul_rn(${value(0, 't_pu', 't_pv')}, ${value(1, 't_pu', 't_pv')})`,
      )};`,
    );
    push('        }');
    push('      }');
    push('    }');
    push('  }');
    push('  __syncthreads();');
    push('}');
    // The epilogue: each patch element's fold result, then any tree around the reduction (loads at affine
    // addresses of the output axes, evaluated per element exactly as stage 2 would).
    let valueOf: (pu: string, pv: string) => string;
    const epiLines: string[] = [];
    if (s.expr.kind === 'reduce') {
      valueOf = (pu, pv) => `t_acc[${pu}][${pv}]`;
    } else {
      const epi = kernelWriter(
        dimensions,
        (e, offset) => `${tensorName(e.name)}[${offset(e.indices, tensors.get(e.name)!.shape)}]`,
        'max_nan(ACC, VALUE)',
        undefined,
        e => (e === reduceNode ? `t_acc[t_pu][t_pv]` : undefined),
      );
      epi.alias(iAxis, 't_gi');
      epi.alias(jAxis, 't_gj');
      const value = epi.scalar(s.expr);
      epiLines.push(...epi.lines);
      valueOf = () => value;
    }
    push('#pragma unroll');
    push('for (int t_pu = 0; t_pu < TM; ++t_pu) {');
    push('  #pragma unroll');
    push('  for (int t_pv = 0; t_pv < TN; ++t_pv) {');
    push('    const I t_gi = t_i0 + (I)(t_pi * TM + t_pu), t_gj = t_j0 + (I)(t_pj * TN + t_pv);');
    push('    if (t_gi < t_M && t_gj < t_N) {');
    for (const l of epiLines) push('      ' + l);
    push(`      result[(t_gi) * ${dim(s.shape[1])} + (t_gj)] = ${valueOf('t_pu', 't_pv')};`);
    push('    }');
    push('  }');
    push('}');
    return lines;
  };
  const head = `template <int Mode, int Dbl, int BM, int BN, int BK, int TM, int TN>\n__global__ void ${kernel.kernel}(${params.join(', ')}) {`;
  const alone = kernelWriter(
    dimensions,
    (e, offset) => `${tensorName(e.name)}[${offset(e.indices, tensors.get(e.name)!.shape)}]`,
  );
  elementOfThread(alone, s, 'result');
  const lines = [
    `// ${kernel.kernel}: ${kernel.statements.join(', ')}; ${kernel.reasons.join('; ')}`,
    head,
    '  if (Mode == 1) {',
    '    const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;',
    '    if (thread >= count) return;',
    ...alone.lines.map(l => '    ' + l),
    '    return;',
    '  }',
    ...tiledBody(),
    '}',
  ];
  // The host: the launch rule picks the element mapping below minWork outputs, and otherwise the last
  // configuration whose grid still covers `waves` device waves (larger tiles reuse operands more).
  const host = [
    `  const I M_${kernel.kernel} = ${M}, N_${kernel.kernel} = ${N}, K_${kernel.kernel} = ${K};`,
    `  const U count_${kernel.kernel} = elements(shape_${tensorName(s.name)});`,
    `  const U work_${kernel.kernel} = (U)M_${kernel.kernel} * (U)N_${kernel.kernel};`,
    ...tile.configs.map(
      (c, i) =>
        `  const U grid_${kernel.kernel}_c${i} = (U)((M_${kernel.kernel} + ${c.bm} - 1) / ${c.bm}) * (U)((N_${kernel.kernel} + ${c.bn} - 1) / ${c.bn});`,
    ),
    `  const bool fused_${kernel.kernel} = gate_mode ? gate_mode == 1 : work_${kernel.kernel} >= ${tile.dispatch.minWork};`,
  ];
  for (let i = tile.configs.length - 1; i > 0; --i)
    host.push(
      `  if (grid_${kernel.kernel}_c${i} >= (U)${tile.dispatch.waves} * (U)device.multiProcessorCount) cfg_${kernel.kernel} = ${i};`,
    );
  host.unshift(`  unsigned cfg_${kernel.kernel} = 0;`);
  const launchArgs = [
    ...dimensions.values(),
    ...Array.from(reads, t => tensorName(t) + '.ptr'),
    tensorName(s.name) + '.ptr',
    `count_${kernel.kernel}`,
  ].join(', ');
  const launch: string[] = [];
  tile.configs.forEach((c, i) => {
    const threads = (c.bm / c.tm) * (c.bn / c.tn);
    const shared = tileSharedBytes(c, tile.loads) * (tile.double ? 2 : 1);
    const template = `${kernel.kernel}<0, ${tile.double ? 1 : 0}, ${c.bm}, ${c.bn}, ${c.bk}, ${c.tm}, ${c.tn}>`;
    launch.push(
      `    if (fused_${kernel.kernel} && cfg_${kernel.kernel} == ${i} && grid_${kernel.kernel}_c${i}) ${template}<<<(unsigned)grid_${kernel.kernel}_c${i}, ${threads}, ${shared}>>>(${launchArgs});`,
    );
  });
  launch.push(
    `    if (!fused_${kernel.kernel} && count_${kernel.kernel}) ${kernel.kernel}<1, 0, 16, 16, 16, 4, 4><<<(count_${kernel.kernel} - 1) / 256 + 1, 256>>>(${launchArgs});`,
    `    check(cudaGetLastError());`,
  );
  const preload = [
    `  if (count_${kernel.kernel}) {`,
    ...tile.configs.map((c, i) => {
      const shared = tileSharedBytes(c, tile.loads) * (tile.double ? 2 : 1);
      const template = `${kernel.kernel}<0, ${tile.double ? 1 : 0}, ${c.bm}, ${c.bn}, ${c.bk}, ${c.tm}, ${c.tn}>`;
      return (
        `    check(cudaFuncGetAttributes(&attributes, ${template}));` +
        (shared > defaultShared
          ? `\n    check(cudaFuncSetAttribute(${template}, cudaFuncAttributeMaxDynamicSharedMemorySize, ${shared}));`
          : '')
      );
    }),
    `    check(cudaFuncGetAttributes(&attributes, ${kernel.kernel}<1, 0, 16, 16, 16, 4, 4>));`,
    `  }`,
  ];
  return {
    code: lines.join('\n'),
    host,
    preload: preload.join('\n'),
    hasWork: `count_${kernel.kernel}`,
    launch: launch.join('\n'),
  };
}

/** The CUDA translation unit for `fn`, printed from its schedule (default: stage 2, one kernel per statement). */
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
  const kernels = schedule.kernels.map(g =>
    g.tile
      ? emitTileKernel(g, g.tile, dims, tensors, name)
      : g.statements.length === 1
        ? emitKernel(tensors.get(g.statements[0]) as Statement, g.kernel, dims, tensors, name)
        : emitGroup(g as FusionGroup, dims, tensors, name),
  );
  const stored = new Set(schedule.kernels.flatMap(g => g.stored));
  // kernels the host may run per statement at launch: block-mode groups (stage 3b's gate) and tiled contractions
  // (stage 6's dispatch between tiles and stage 2's element mapping)
  const gated = (g: ScheduleKernel) =>
    (g.statements.length > 1 && g.mapping === 'block') || g.tile !== undefined;
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
    if (schedule.kernels.some(g => g.mapping === 'block' || g.tile))
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
      .filter(gated)
      .map(g => `  { const unsigned char choice = fused_${g.kernel} ? 1 : 0; write(output, &choice, 1); }`),
    '}',
  );
  const fused = schedule.kernels.some(g => g.statements.length > 1 || g.tile?.reduce.op === 'max')
    ? [fusedSupport]
    : [];
  const takes = schedule.kernels.some(gated);
  if (takes) fused.push(gateSupport);
  return [support, ...fused, ...kernels.map(k => k.code), host.join('\n'), takes ? gatedMain : main].join(
    '\n\n',
  );
}
