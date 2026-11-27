import {
  outerReductions,
  type Reduce,
} from './fusion.js';
import {
  contractionOf,
  type MemberTile,
  type ScheduleUnit,
  type SkKernel,
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
  /** A reduction already computed into a register (IRWB-033-J's tiled paths): the accumulator's name. */
  accumulator: (e: Reduce) => string | undefined = () => undefined,
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
        const held = accumulator(e);
        if (held !== undefined) return held;
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

// Dynamic shared memory a block may use without opting in (CUDA's fixed default).
const defaultShared = 48 * 1024;

const product = (dims: string[]) =>
  dims.length ? `(${dims.map(d => `static_cast<U>(${d})`).join(' * ')})` : 'static_cast<U>(1)';

// Stage 3: one kernel for a fused group (the schedule IR, IRWB-033-J). Thread mode keeps stage 2's mapping with
// the members' values in registers; block mode runs one block per block-domain point with rows in shared memory,
// or in a global scratch area when they do not fit. Contraction members whose staged operand the lanes would read
// uncoalesced get an operand tile (schedule.ts): the block loads the tile cooperatively and each thread folds its
// element's chunk from shared memory, serially, in the meaning's order.
function emitGroup(
  group: SkKernel,
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
  const accIds = new Map<Reduce, string>();
  let current = members[0];
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
    e => accIds.get(e),
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
    // The operand tiles (IRWB-033-J): after the rows (or at the shared base when the rows went to scratch).
    const memberTiles = group.memberTiles ?? [];
    if (memberTiles.length)
      w.line(`float* const tiles = Shared ? base + (${row}) : shared;`);
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
      const tile = memberTiles.find(t => t.statement === m.name);
      if (tile) {
        // The tiled member (IRWB-033-J): the block loads the staged operand's tile cooperatively (coalesced,
        // masked) and each thread folds its own element's chunk from shared memory — one accumulator, the chunk
        // loop and the in-chunk loop both increasing, so the terms come in the meaning's order (schedule.ts's
        // order certificate). The element assignment is exactly the generic one below (e = tid + k * blockDim).
        const found = contractionOf(m);
        if ('refusal' in found) throw Error(`The schedule tiles ${m.name}, but ${found.refusal}`);
        const c = found.contraction;
        if (c.axis.id !== tile.reduction || c.row.name !== tile.row || c.staged.name !== tile.staged)
          throw Error(`The schedule's tile for ${m.name} does not match its contraction`);
        const R = tensors.get(c.staged.name)!;
        const BK = tile.chunk,
          pad = tile.pad;
        const Kr = w.dim(c.axis.extent.dim);
        const at = memberTiles.indexOf(tile);
        const stridesOf = (shape: Affine[]) =>
          shape.map((_, q) =>
            q === shape.length - 1 ? '1' : product(shape.slice(q + 1).map(w.dim)),
          );
        w.line(`float* const op${s} = tiles + ${at} * (blockDim.x * ${BK + pad});`);
        w.line(`for (U base${s} = 0; base${s} < n${s}; base${s} += blockDim.x) {`);
        w.enter();
        w.line(`float acc${s} = 0.0f;`);
        w.line(`const I own${s} = base${s} + threadIdx.x;`);
        w.line(`const bool live${s} = own${s} < n${s};`);
        w.line(`for (I cc${s} = 0; cc${s} * ${BK} < ${Kr}; ++cc${s}) {`);
        w.enter();
        w.line(`const I lo${s} = cc${s} * ${BK};`);
        w.line(`const I hi${s} = ${Kr} - lo${s} < ${BK} ? ${Kr} - lo${s} : ${BK};`);
        w.line(`for (U x${s} = threadIdx.x; x${s} < blockDim.x * ${BK}; x${s} += blockDim.x) {`);
        w.enter();
        w.line(`const U el${s} = x${s} / ${BK};`);
        w.line(`const U tk${s} = x${s} % ${BK};`);
        w.line(`U restT${s} = base${s} + el${s};`);
        const trailingPos = new Map(m.axes.map((a, p) => [a.id, p] as const));
        for (let p = m.axes.length - 1; p >= depth; --p) {
          w.line(`const I ct${s}_${p} = restT${s} % ${w.dim(m.shape[p])};`);
          if (p > depth) w.line(`restT${s} /= ${w.dim(m.shape[p])};`);
        }
        const valueAt = (q: number) =>
          q === c.stagedAt ? `lo${s} + tk${s}` : `ct${s}_${trailingPos.get(plain(c.staged.indices[q])!)}`;
        const address = R.shape
          .map((_, q) => (q === R.shape.length - 1 ? valueAt(q) : `(${valueAt(q)}) * ${stridesOf(R.shape)[q]}`))
          .join(' + ');
        w.line(
          `op${s}[el${s} * ${BK + pad} + tk${s}] = base${s} + el${s} < n${s} && lo${s} + tk${s} < ${Kr} ? ${tensorName(R.name)}[${address}] : 0.0f;`,
        );
        w.leave();
        w.line('}');
        w.line('__syncthreads();');
        w.line(
          `if (live${s}) for (I t${s} = 0; t${s} < hi${s}; ++t${s}) acc${s} = __fadd_rn(acc${s}, __fmul_rn(r${suffix(tile.row)}[lo${s} + t${s}], op${s}[threadIdx.x * ${BK + pad} + t${s}]));`,
        );
        w.line('__syncthreads();');
        w.leave();
        w.line('}');
        accIds.set(c.reduce, `acc${s}`);
        w.line(`if (live${s}) {`);
        w.enter();
        w.line(`U rest${s} = own${s};`);
        for (let p = m.axes.length - 1; p >= depth; --p) {
          const axis = w.bind(m.axes[p].id);
          w.line(`const I ${axis} = rest${s} % ${w.dim(m.shape[p])};`);
          if (p > depth) w.line(`rest${s} /= ${w.dim(m.shape[p])};`);
        }
        const value = w.scalar(m.expr);
        if (group.buffered.includes(m.name)) w.line(`r${s}[own${s}] = ${value};`);
        if (stored.has(m.name)) w.line(`t${s}[point * n${s} + own${s}] = ${value};`);
        w.leave();
        w.line('}');
      } else {
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
      }
      if (j < members.length - 1) w.line('__syncthreads();');
    });
    // The host computes the same lengths from the same shape values.
    const hostDim = (a: Affine) => affine(a, n => dimensions.get(n)!);
    const lengths = [...new Set([...group.staged, ...group.statements])].map(n => lengthOf(n, hostDim));
    lengths.push(...staging.flat().map(count));
    const hostRow = [...owners.map(n => lengthOf(n, hostDim)), ...(staging.length ? [area(count)] : [])].join(
      ' + ',
    );
    // The operand tiles always live in shared memory, one per tiled member, each blockDim.x * (chunk + pad)
    // words (the schedule's constants; IRWB-033-J).
    const tileWords = (group.memberTiles ?? []).reduce((n, t) => n + t.chunk + t.pad, 0);
    const tile = `tiles_${kernel}`;
    const threadsRule = group.threads;
    const gateConstants = group.gate!;
    host.push(
      `  const U grid_${kernel} = ${product(first.shape.slice(0, depth).map(hostDim))};`,
      `  const U row_${kernel} = (${hostRow}) * sizeof(float);`,
      `  const U longest_${kernel} = std::max<U>({${lengths.join(', ')}, static_cast<U>(1)});`,
      group.heavy.length
        ? `  const unsigned threads_${kernel} = static_cast<unsigned>(std::min<U>(${threadsRule.heavyCap}, (std::max<U>(std::min<U>({${group.heavy.map(n => lengthOf(n, hostDim)).join(', ')}}), 1) + 31) / 32 * 32));`
        : `  const unsigned threads_${kernel} = static_cast<unsigned>(std::min<U>(${threadsRule.cap}, (longest_${kernel} + 31) / 32 * 32));`,
      `  const U ${tile} = static_cast<U>(threads_${kernel}) * ${tileWords} * sizeof(float);`,
      `  const bool shared_${kernel} = row_${kernel} + ${tile} <= static_cast<U>(shared_limit);`,
      // The gate: block mode, or the members one by one. --gate=fused|unfused forces a side (the contract).
      // Blocks of this kernel that fit on one SM, by its block, thread and shared-memory limits (each block's
      // shared memory includes the device's reserved part: 1 KiB on the GB10).
      `  const U resident_${kernel} = std::min<U>({sm_blocks, sm_threads / threads_${kernel}, shared_${kernel} ? sm_shared / (row_${kernel} + ${tile} + sm_reserved) : sm_blocks});`,
      `  const bool fused_${kernel} = gate_mode ? gate_mode == 1 : (longest_${kernel} >= ${gateConstants.fullRow} || grid_${kernel} <= ${gateConstants.smallGrid})${group.heavy
        .map(
          n =>
            ` && resident_${kernel} * std::min<U>(threads_${kernel}, ${lengthOf(n, hostDim)}) * ${gateConstants.heavyLanes[1]} >= ${gateConstants.heavyLanes[0]} * sm_threads`,
        )
        .join('')};`,
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
  const sharedSize = block ? `row_${kernel} + tiles_${kernel}` : `count_${kernel}`;
  const optIn = `shared_${kernel} && row_${kernel} + tiles_${kernel} > ${defaultShared}`;
  const size = (m: Statement) => `elements(shape_${tensorName(m.name)})`;
  const blockArgs = [...args, '0'].join(', ');
  return {
    code: w.lines.join('\n'),
    host,
    preload: block
      ? `  if (grid_${kernel} && fused_${kernel}) {
    check(cudaFuncGetAttributes(&attributes, shared_${kernel} ? ${kernel}<1> : ${kernel}<0>));
    if (${optIn}) check(cudaFuncSetAttribute(${kernel}<1>, cudaFuncAttributeMaxDynamicSharedMemorySize, static_cast<int>(row_${kernel} + tiles_${kernel})));
  }
  if (grid_${kernel} && !fused_${kernel}) {
${members.map((_m, j) => `    check(cudaFuncGetAttributes(&attributes, ${kernel}<${2 + j}>));`).join('\n')}
  }`
      : `  if (count_${kernel}) check(cudaFuncGetAttributes(&attributes, ${kernel}));`,
    hasWork,
    launch: block
      ? `    if (grid_${kernel} && fused_${kernel} && shared_${kernel}) ${kernel}<1><<<static_cast<unsigned>(grid_${kernel}), threads_${kernel}, ${sharedSize}>>>(${blockArgs});
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

// IRWB-033-J: a standalone contraction as a tiled kernel (the schedule's `gemm` mapping): one block per output
// tile, (BM/TM)*(BN/TN) threads each owning a TM*TN register patch, both operands staged in padded shared tiles
// (each word reused across the tile). The reduction runs in one thread per output element, chunk by chunk, both
// loops increasing, so the terms come in the meaning's order and the product and the sum round separately, as
// the order certificate in schedule.ts says. The emitter only prints the schedule's constants; masks handle
// every shape, including shapes that are not multiples of a tile and empty extents.
function emitGemm(
  kernel: SkKernel,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
) {
  const k = kernel.kernel;
  const s = tensors.get(kernel.statements[0]) as Statement;
  const t = kernel.tile!;
  const found = contractionOf(s);
  if ('refusal' in found) throw Error(`The schedule tiles ${s.name} as a gemm kernel, but ${found.refusal}`);
  const c = found.contraction;
  if (
    c.axis.id !== t.reduction ||
    c.row.name !== t.row ||
    c.staged.name !== t.staged ||
    c.rowAxes.join() !== t.rowAxes.join() ||
    c.colAxes.join() !== t.colAxes.join()
  )
    throw Error(`The schedule's gemm tile for ${s.name} does not match its contraction`);
  const [BM, BN] = t.block,
    [TM, TN] = t.patch,
    BK = t.chunk,
    pad = t.pad;
  const threads = (BM / TM) * (BN / TN);
  const stage = BM * (BK + pad) + BK * (BN + pad);
  const sharedBytes = (t.doubleBuffer ? 2 : 1) * stage * 4;
  const reads = new Set<string>();
  visit(s.expr, e => {
    if (e.kind === 'load') reads.add(e.name);
  });
  const params = [
    ...Array.from(dimensions.values(), d => `I ${d}`),
    ...Array.from(reads, x => `const float* ${tensorName(x)}`),
    `float* ${tensorName(s.name)}`,
  ];
  const args = [...dimensions.values(), ...Array.from(reads, x => tensorName(x) + '.ptr'), tensorName(s.name) + '.ptr'];
  const stride = (shape: Affine[]) =>
    shape.map((_, q) =>
      q === shape.length - 1 ? '1' : product(shape.slice(q + 1).map(a => affine(a, n => dimensions.get(n)!))),
    );
  const L = tensors.get(c.row.name)!.shape,
    R = tensors.get(c.staged.name)!.shape;
  const Ls = stride(L),
    Rs = stride(R);
  const rowPos = t.rowAxes.length ? c.row.indices.findIndex(x => plain(x) === t.rowAxes[0]) : -1;
  const colPos = t.colAxes.length ? c.staged.indices.findIndex(x => plain(x) === t.colAxes[0]) : -1;
  const rowAddress = (rowCoord: string, kCoord: string) =>
    [rowPos >= 0 ? `(${rowCoord}) * ${Ls[rowPos]}` : '', `(${kCoord}) * ${Ls[c.rowAt]}`]
      .filter(Boolean)
      .join(' + ');
  const stagedAddress = (colCoord: string, kCoord: string) =>
    [colPos >= 0 ? `(${colCoord}) * ${Rs[colPos]}` : '', `(${kCoord}) * ${Rs[c.stagedAt]}`]
      .filter(Boolean)
      .join(' + ');
  const rowAxis = s.axes.find(a => a.id === t.rowAxes[0]),
    colAxis = s.axes.find(a => a.id === t.colAxes[0]);
  const dimOf = (a: Affine) => affine(a, n => dimensions.get(n)!);
  if (c.axis.extent.kind !== 'dim') throw Error('The gemm tile needs a plain reduction extent');
  const M = rowAxis ? `(${rowAxis.extent.kind === 'dim' ? dimOf(rowAxis.extent.dim) : ''})` : '1',
    N = colAxis ? `(${colAxis.extent.kind === 'dim' ? dimOf(colAxis.extent.dim) : ''})` : '1';
  const Kr = dimOf(c.axis.extent.dim);
  const accIds = new Map<Reduce, string>();
  const w = kernelWriter(
    dimensions,
    (e, offset) => `${tensorName(e.name)}[${offset(e.indices, tensors.get(e.name)!.shape)}]`,
    'max_nan(ACC, VALUE)',
    () => undefined,
    e => accIds.get(e),
  );
  w.lines.push(`// ${k}: ${kernel.statements.join(', ')}; ${kernel.reasons.join('; ')}`);
  w.lines.push(`__global__ void ${k}(${params.join(', ')}) {`);
  w.line('extern __shared__ float shared[];');
  w.line(`float* const aS = shared;`);
  w.line(`float* const bS = shared + ${BM * (BK + pad)};`);
  w.line(`const U tilesN = (static_cast<U>(${N}) + ${BN - 1}) / ${BN};`);
  w.line('const I bi = blockIdx.x / tilesN, bj = blockIdx.x % tilesN;');
  w.line(`const I ti = threadIdx.x / ${BN / TN}, tj = threadIdx.x % ${BN / TN};`);
  for (let u = 0; u < TM; u++)
    w.line(`float ${Array.from({ length: TN }, (_, x) => `acc${u}_${x} = 0.0f`).join(', ')};`);
  const loadChunk = (kk: string, buf: string) => {
    const at = `(${buf}) * ${stage}`;
    w.line(`for (U x = threadIdx.x; x < ${BM * BK}; x += ${threads}) {`);
    w.enter();
    w.line(`const I lu = x / ${BK}, lv = x % ${BK};`);
    w.line(
      `aS[${at} + lu * ${BK + pad} + lv] = bi * ${BM} + lu < ${M} && ${kk} + lv < ${Kr} ? ${tensorName(c.row.name)}[${rowAddress(`bi * ${BM} + lu`, `${kk} + lv`)}] : 0.0f;`,
    );
    w.leave();
    w.line('}');
    w.line(`for (U x = threadIdx.x; x < ${BK * BN}; x += ${threads}) {`);
    w.enter();
    w.line(`const I lu = x / ${BN}, lv = x % ${BN};`);
    w.line(
      `bS[${at} + lu * ${BN + pad} + lv] = ${kk} + lu < ${Kr} && bj * ${BN} + lv < ${N} ? ${tensorName(c.staged.name)}[${stagedAddress(`bj * ${BN} + lv`, `${kk} + lu`)}] : 0.0f;`,
    );
    w.leave();
    w.line('}');
  };
  const computeChunk = (kk: string, buf: string, hi: string, unroll: boolean) => {
    const at = `(${buf}) * ${stage}`;
    if (unroll) w.line('#pragma unroll');
    w.line(`for (I t = 0; t < ${hi}; ++t) {`);
    w.enter();
    for (let u = 0; u < TM; u++)
      w.line(`const float ar${u} = aS[${at} + (ti * ${TM} + ${u}) * ${BK + pad} + t];`);
    for (let x = 0; x < TN; x++)
      w.line(`const float br${x} = bS[${at} + t * ${BN + pad} + tj * ${TN} + ${x}];`);
    for (let u = 0; u < TM; u++)
      for (let x = 0; x < TN; x++)
        w.line(`acc${u}_${x} = __fadd_rn(acc${u}_${x}, __fmul_rn(ar${u}, br${x}));`);
    w.leave();
    w.line('}');
  };
  if (t.doubleBuffer) {
    loadChunk('0', '0');
    w.line('__syncthreads();');
    w.line(`for (I kk = 0; kk < ${Kr}; kk += ${BK}) {`);
    w.enter();
    w.line(`const I next = kk + ${BK};`);
    w.line(`if (next < ${Kr}) {`);
    w.enter();
    loadChunk('next', `(next / ${BK}) % 2`);
    w.leave();
    w.line('}');
    w.line(`if (kk + ${BK} <= ${Kr}) {`);
    w.enter();
    computeChunk('kk', `(kk / ${BK}) % 2`, `${BK}`, true);
    w.leave();
    w.line('} else {');
    w.enter();
    computeChunk('kk', `(kk / ${BK}) % 2`, `${Kr} - kk`, false);
    w.leave();
    w.line('}');
    w.line('__syncthreads();');
    w.leave();
    w.line('}');
  } else {
    w.line(`for (I kk = 0; kk + ${BK} <= ${Kr}; kk += ${BK}) {`);
    w.enter();
    loadChunk('kk', '0');
    w.line('__syncthreads();');
    computeChunk('kk', '0', `${BK}`, true);
    w.line('__syncthreads();');
    w.leave();
    w.line('}');
    w.line(`const I tail = (${Kr} / ${BK}) * ${BK};`);
    w.line(`if (tail < ${Kr}) {`);
    w.enter();
    loadChunk('tail', '0');
    w.line('__syncthreads();');
    computeChunk('tail', '0', `${Kr} - tail`, false);
    w.line('__syncthreads();');
    w.leave();
    w.line('}');
  }
  // The epilogue and the store, per patch element, masked at the tile's edges.
  const Ss = stride(s.shape);
  for (let u = 0; u < TM; u++)
    for (let v = 0; v < TN; v++) {
      const rowCoord = `bi * ${BM} + ti * ${TM} + ${u}`,
        colCoord = `bj * ${BN} + tj * ${TN} + ${v}`;
      w.line(`if (${rowCoord} < ${M}${colAxis ? ` && ${colCoord} < ${N}` : ''}) {`);
      w.enter();
      for (const a of s.axes) w.alias(a.id, a.id === t.rowAxes[0] ? rowCoord : colCoord);
      accIds.set(c.reduce, `acc${u}_${v}`);
      const value = w.scalar(s.expr);
      const offset = s.axes
        .map((a, p) => `(${a.id === t.rowAxes[0] ? rowCoord : colCoord})${Ss[p] === '1' ? '' : ` * ${Ss[p]}`}`)
        .join(' + ');
      w.line(`${tensorName(s.name)}[${offset}] = ${value};`);
      w.leave();
      w.line('}');
    }
  w.lines.push('}');
  return {
    code: w.lines.join('\n'),
    host: [
      `  const U grid_${k} = ((static_cast<U>(${M}) + ${BM - 1}) / ${BM}) * ((static_cast<U>(${N}) + ${BN - 1}) / ${BN});`,
    ],
    preload: `  if (grid_${k}) {
    check(cudaFuncGetAttributes(&attributes, ${k}));
${sharedBytes > defaultShared ? `    check(cudaFuncSetAttribute(${k}, cudaFuncAttributeMaxDynamicSharedMemorySize, ${sharedBytes}));\n` : ''}  }`,
    hasWork: `grid_${k}`,
    launch: `    if (grid_${k}) {
      ${k}<<<static_cast<unsigned>(grid_${k}), ${threads}, ${sharedBytes}>>>(${args.join(', ')});
      check(cudaGetLastError());
    }`,
  };
}

/** The CUDA translation unit for `fn` from its schedule (IRWB-033-J): the emitter only prints the schedule. */
export function emitCuda(fn: Fn, unit: ScheduleUnit): string {
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
  const kernels = unit.kernels.map(g =>
    g.mapping === 'gemm'
      ? emitGemm(g, dims, tensors, name)
      : g.statements.length === 1 && g.mapping === 'thread'
        ? emitKernel(tensors.get(g.statements[0]) as Statement, g.kernel, dims, tensors, name)
        : emitGroup(g, dims, tensors, name),
  );
  const stored = new Set(unit.kernels.flatMap(g => g.stored));
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
    if (unit.kernels.some(g => g.mapping === 'block'))
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
    ...unit.kernels
      .filter(g => g.statements.length > 1 && g.mapping === 'block')
      .map(g => `  { const unsigned char choice = fused_${g.kernel} ? 1 : 0; write(output, &choice, 1); }`),
    '}',
  );
  const fused = unit.kernels.some(g => g.statements.length > 1) ? [fusedSupport] : [];
  const gated = unit.kernels.some(g => g.statements.length > 1 && g.mapping === 'block');
  if (gated) fused.push(gateSupport);
  return [support, ...fused, ...kernels.map(k => k.code), host.join('\n'), gated ? gatedMain : main].join(
    '\n\n',
  );
}
