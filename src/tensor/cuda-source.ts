import {
  gate as defaultGate,
  gateRule,
  outerReductions,
  unfusedPlan,
  type FusionGroup,
  type FusionPlan,
  type Reduce,
} from './fusion.js';
import {
  blockThreads,
  configLimits,
  contractionOf,
  scheduleFromPlan,
  type GateRule,
  type Schedule,
  type TileKernel,
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
// A source with a tile kernel takes --tile=<n>, which forces every tile kernel to its configuration n, or to
// stage 2's mapping when it has no configuration n (IRWB-033-E).
const benchmarkFlag = '    const bool benchmark = argc == 2 && strcmp(argv[1], "--benchmark") == 0;\n';
const flagMain = (gated: boolean, tiled: boolean) => {
  const out = main.replace(
    benchmarkFlag,
    [
      '    bool benchmark = false;',
      '    for (int a = 1; a < argc; ++a) {',
      '      if (!strcmp(argv[a], "--benchmark")) benchmark = true;',
      ...(gated
        ? [
            '      else if (!strcmp(argv[a], "--gate=fused")) gate_mode = 1;',
            '      else if (!strcmp(argv[a], "--gate=unfused")) gate_mode = 2;',
          ]
        : []),
      ...(tiled ? [`      else if (!strncmp(argv[a], "--tile=", 7)) tile_mode = argv[a][7] - '0';`] : []),
      '      else throw std::runtime_error("unknown argument");',
      '    }',
      '',
    ].join('\n'),
  );
  if (out === main) throw Error('The CUDA main no longer has the benchmark flag line');
  return out;
};
const gateSupport = '\nstatic int gate_mode = 0;';
const tileSupport = '\nstatic int tile_mode = -1;';
/** Whether a generated program has a gated kernel, and so takes --gate=fused|unfused. */
export const takesGate = (source: string) => source.includes(gateSupport);
/** The number of tile configurations a generated program can be forced to with --tile=<n> (0: no tile kernel). */
export const tileModes = (source: string) =>
  source.includes(tileSupport)
    ? Math.max(...[...source.matchAll(/const int configs_k\d+ = (\d+);/g)].map(m => Number(m[1])))
    : 0;

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
  /** A reduction whose value a register already holds (a tile kernel's accumulator, IRWB-033-E). */
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
        const known = reduced(e);
        if (known) return known;
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
export { blockThreads };
// Dynamic shared memory a block may use without opting in (CUDA's fixed default).
const defaultShared = 48 * 1024;

const product = (dims: string[]) =>
  dims.length ? `(${dims.map(d => `static_cast<U>(${d})`).join(' * ')})` : 'static_cast<U>(1)';

// Stage 3: one kernel for a fused group (fusion.ts). Thread mode keeps stage 2's mapping with the members'
// values in registers; block mode runs one block per block-domain point with rows in shared memory, or in a
// global scratch area when they do not fit.
function emitGroup(
  group: FusionGroup,
  width: typeof blockThreads,
  gate: GateRule | undefined,
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
  const cap = members.some(m => operands(m.expr, false)) ? width.contraction : width.rows;
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
        ? `  const unsigned threads_${kernel} = static_cast<unsigned>(std::min<U>(${width.heavy}, (std::max<U>(std::min<U>({${group.heavy.map(n => lengthOf(n, hostDim)).join(', ')}}), 1) + 31) / 32 * 32));`
        : `  const unsigned threads_${kernel} = static_cast<unsigned>(std::min<U>(${cap}, (longest_${kernel} + 31) / 32 * 32));`,
      // The gate: block mode, or the members one by one. --gate=fused|unfused forces a side (the contract).
      // Blocks of this kernel that fit on one SM, by its block, thread and shared-memory limits (each block's
      // shared memory includes the device's reserved part: 1 KiB on the GB10).
      `  const U resident_${kernel} = std::min<U>({sm_blocks, sm_threads / threads_${kernel}, shared_${kernel} ? sm_shared / (row_${kernel} + sm_reserved) : sm_blocks});`,
      gate
        ? `  const bool fused_${kernel} = gate_mode ? gate_mode == 1 : ${gateRule(
            {
              grid: `grid_${kernel}`,
              longest: `longest_${kernel}`,
              lanes: group.heavy.map(
                n => `resident_${kernel} * std::min<U>(threads_${kernel}, ${lengthOf(n, hostDim)})`,
              ),
              slots: 'sm_threads',
            },
            gate,
          )};`
        : // a block kernel without the gate step (an intermediate schedule) always runs in block mode
          `  const bool fused_${kernel} = true;`,
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

// IRWB-033-E: a tiled contraction. Mode n < configs is configuration n of the schedule's tile kernel; the last
// mode is stage 2's mapping and scalar code. One block computes a TM x TN tile of the linearised (row, column)
// space of one batch point; one thread a RM x RN patch of it in registers. The terms run in the meaning's order
// (row-major over the reduction's axes), in chunks of TK; with staging every thread first copies the chunk's left
// and right factors to shared memory (left as [term][row], right as [term][column], so a patch's values are
// adjacent), computing each factor with the scalar code stage 2 would have run. Every accumulator then adds
// __fmul_rn(left, right) for term 0, 1, ... with __fadd_rn, so each output's bits are stage 2's.
function emitTile(
  k: TileKernel,
  statement: Statement,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
) {
  const kernel = k.name;
  const found = contractionOf(statement);
  if ('refused' in found || found.reduction.body.kind !== 'op') throw Error(`${kernel} is not a contraction`);
  const { reduction } = found;
  const [left, right] = found.reduction.body.args;
  const reads = new Set<string>();
  visit(statement.expr, e => {
    if (e.kind === 'load') reads.add(e.name);
  });
  const params = [
    ...Array.from(dimensions.values(), d => `I ${d}`),
    ...Array.from(reads, t => `const float* ${tensorName(t)}`),
    'float* result',
    'U count',
  ];
  const n = k.configs.length;
  const pick = (value: (i: number) => number | string) =>
    k.configs.reduceRight((rest, _c, i) => `Mode == ${i} ? ${value(i)} : ${rest}`, '1');
  const w = kernelWriter(
    dimensions,
    (e, offset) => `${tensorName(e.name)}[${offset(e.indices, tensors.get(e.name)!.shape)}]`,
    undefined,
    undefined,
    e => (e === reduction ? 'acc[r][q]' : undefined),
  );
  const position = new Map(statement.axes.map((a, p) => [a.id, p]));
  statement.axes.forEach((a, p) => w.alias(a.id, `x${p}`));
  reduction.axes.forEach((a, i) => w.alias(a.id, `y${i}`));
  const outExtent = (id: string) => w.dim(statement.shape[position.get(id)!]);
  const termExtent = (i: number) => `(${w.bound(reduction.axes[i].extent)})`;
  const space = (extents: string[]) =>
    extents.length ? extents.map(e => `static_cast<U>(${e})`).join(' * ') : 'static_cast<U>(1)';
  // `linear` decoded row-major into the named axes, the last fastest
  const decode = (temp: string, linear: string, names: string[], extents: string[]) => {
    if (!names.length) return;
    // (the outermost axis needs no remainder: the linear index is inside the space)
    // The host runs a configuration only when the spaces are below 2^31, so 32-bit division is enough.
    if (names.length === 1) return w.line(`const I ${names[0]} = ${linear};`);
    w.line(`unsigned ${temp} = ${linear};`);
    for (let i = names.length - 1; i >= 0; --i) {
      w.line(`const I ${names[i]} = ${i > 0 ? `${temp} % static_cast<unsigned>(${extents[i]})` : temp};`);
      if (i > 0) w.line(`${temp} /= static_cast<unsigned>(${extents[i]});`);
    }
  };
  const axesOf = (ids: string[]) => ({
    names: ids.map(id => `x${position.get(id)!}`),
    extents: ids.map(outExtent),
  });
  const rows = axesOf(k.roles.rows),
    cols = axesOf(k.roles.cols),
    batch = axesOf(k.roles.batch);
  const terms = {
    names: reduction.axes.map((_a, i) => `y${i}`),
    extents: reduction.axes.map((_a, i) => termExtent(i)),
  };
  const termCount = space(terms.extents.map(e => `(${e} > 0 ? ${e} : 0)`));
  // one factor at (row or column, term), stored by `store`
  const factor = (side: Expr, own: typeof rows, at: string, term: string, store: (v: string) => string) => {
    decode('lo', at, own.names, own.extents);
    decode('lt', term, terms.names, terms.extents);
    w.line(store(w.scalar(side)));
  };
  w.lines.push(`// ${kernel}: ${k.statements.join(', ')}; ${k.reasons.join('; ')}`);
  w.lines.push('template <int Mode>');
  w.lines.push(`__global__ void ${kernel}(${params.join(', ')}) {`);
  w.line(`if (Mode == ${n}) {`);
  const alone = kernelWriter(
    dimensions,
    (e, offset) => `${tensorName(e.name)}[${offset(e.indices, tensors.get(e.name)!.shape)}]`,
  );
  alone.line('const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
  alone.line('if (thread >= count) return;');
  elementOfThread(alone, statement, 'result');
  w.lines.push(...alone.lines.map(l => '  ' + l));
  w.line('  return;');
  w.line('}');
  w.line(`constexpr int TM = ${pick(i => k.configs[i].tile[0])}, TN = ${pick(i => k.configs[i].tile[1])};`);
  w.line(`constexpr int RM = ${pick(i => k.configs[i].patch[0])}, RN = ${pick(i => k.configs[i].patch[1])};`);
  w.line(`constexpr bool Staged = ${pick(i => (k.configs[i].staged ? 'true' : 'false'))};`);
  // TK: the chunk; 0 runs all terms as one chunk (an unstaged configuration)
  w.line(`constexpr int TK = ${pick(i => k.configs[i].chunk)}, SK = Staged ? TK : 1;`);
  w.line('extern __shared__ float shared[];');
  w.line(`const unsigned rows = static_cast<unsigned>(${space(rows.extents)});`);
  w.line(`const unsigned cols = static_cast<unsigned>(${space(cols.extents)});`);
  w.line(`const unsigned terms = static_cast<unsigned>(${termCount});`);
  w.line('unsigned tile = blockIdx.x;');
  w.line('const unsigned c0 = (tile % ((cols + TN - 1) / TN)) * TN;');
  w.line('tile /= (cols + TN - 1) / TN;');
  w.line('const unsigned r0 = (tile % ((rows + TM - 1) / TM)) * TM;');
  w.line('tile /= (rows + TM - 1) / TM;');
  decode('lb', 'tile', batch.names, batch.extents);
  w.line('const int pr = (threadIdx.x / (TN / RN)) * RM, pc = (threadIdx.x % (TN / RN)) * RN;');
  w.line('float acc[RM][RN];');
  w.line('for (int r = 0; r < RM; ++r)');
  w.line('  for (int q = 0; q < RN; ++q) acc[r][q] = 0.0f;');
  w.line('float* const sa = shared;');
  w.line('float* const sb = shared + SK * TM;');
  w.line('const unsigned step = TK ? static_cast<unsigned>(TK) : (terms ? terms : 1);');
  w.line('for (unsigned k0 = 0; k0 < terms; k0 += step) {');
  w.enter();
  w.line('const int kn = static_cast<int>(terms - k0 < step ? terms - k0 : step);');
  w.line('if (Staged) {');
  w.enter();
  w.line('for (int e = threadIdx.x; e < TM * SK; e += blockDim.x) {');
  w.enter();
  w.line('const int r = e / SK, kk = e % SK;');
  w.line('if (r0 + r < rows && kk < kn) {');
  w.enter();
  factor(left, rows, 'r0 + r', 'k0 + kk', v => `sa[kk * TM + r] = ${v};`);
  w.leave();
  w.line('}');
  w.leave();
  w.line('}');
  w.line('for (int e = threadIdx.x; e < SK * TN; e += blockDim.x) {');
  w.enter();
  w.line('const int kk = e / TN, q = e % TN;');
  w.line('if (c0 + q < cols && kk < kn) {');
  w.enter();
  factor(right, cols, 'c0 + q', 'k0 + kk', v => `sb[kk * TN + q] = ${v};`);
  w.leave();
  w.line('}');
  w.leave();
  w.line('}');
  w.line('__syncthreads();');
  w.leave();
  w.line('}');
  w.line('for (int kk = 0; kk < kn; ++kk) {');
  w.enter();
  w.line('float av[RM], bv[RN];');
  w.line('for (int r = 0; r < RM; ++r) {');
  w.enter();
  w.line('if (Staged) av[r] = sa[kk * TM + pr + r];');
  w.line('else {');
  w.enter();
  w.line('av[r] = 0.0f;');
  w.line('if (r0 + pr + r < rows) {');
  w.enter();
  factor(left, rows, 'r0 + pr + r', 'k0 + kk', v => `av[r] = ${v};`);
  w.leave();
  w.line('}');
  w.leave();
  w.line('}');
  w.leave();
  w.line('}');
  w.line('for (int q = 0; q < RN; ++q) {');
  w.enter();
  w.line('if (Staged) bv[q] = sb[kk * TN + pc + q];');
  w.line('else {');
  w.enter();
  w.line('bv[q] = 0.0f;');
  w.line('if (c0 + pc + q < cols) {');
  w.enter();
  factor(right, cols, 'c0 + pc + q', 'k0 + kk', v => `bv[q] = ${v};`);
  w.leave();
  w.line('}');
  w.leave();
  w.line('}');
  w.leave();
  w.line('}');
  w.line('for (int r = 0; r < RM; ++r)');
  w.line('  for (int q = 0; q < RN; ++q) acc[r][q] = __fadd_rn(acc[r][q], __fmul_rn(av[r], bv[q]));');
  w.leave();
  w.line('}');
  w.line('if (Staged) __syncthreads();');
  w.leave();
  w.line('}');
  w.line('for (int r = 0; r < RM; ++r)');
  w.line('  for (int q = 0; q < RN; ++q) {');
  w.enter();
  w.enter();
  w.line('if (r0 + pr + r >= rows || c0 + pc + q >= cols) continue;');
  decode('lr', 'r0 + pr + r', rows.names, rows.extents);
  decode('lc', 'c0 + pc + q', cols.names, cols.extents);
  const value = w.scalar(statement.expr);
  const at = statement.axes.reduce(
    (prior, _a, p) => (p ? `(${prior} * ${w.dim(statement.shape[p])} + x${p})` : 'x0'),
    '',
  );
  w.line(`result[${at}] = ${value};`);
  w.leave();
  w.line('}');
  w.leave();
  w.lines.push('}');

  const hostDim = (a: Affine) => affine(a, key => dimensions.get(key)!);
  const hostSpace = (ids: string[]) => space(ids.map(id => hostDim(statement.shape[position.get(id)!])));
  const count = `count_${kernel}`;
  const tiles = (i: number) => `tiles_${kernel}_${i}`;
  const args = [
    ...dimensions.values(),
    ...Array.from(reads, t => tensorName(t) + '.ptr'),
    tensorName(statement.name) + '.ptr',
    count,
  ].join(', ');
  const rule = k.configs.reduceRight(
    (rest, c, i) => `${tiles(i)} >= ${c.minTiles} ? ${i} : ${rest}`,
    String(n),
  );
  const hostTerms = space(
    reduction.axes.map(a => {
      const e = hostDim(a.extent.dim);
      return `(${e} > 0 ? ${e} : 0)`;
    }),
  );
  return {
    code: w.lines.join('\n'),
    host: [
      `  const U ${count} = elements(shape_${tensorName(statement.name)});`,
      `  const U rows_${kernel} = ${hostSpace(k.roles.rows)}, cols_${kernel} = ${hostSpace(k.roles.cols)}, batch_${kernel} = ${hostSpace(k.roles.batch)};`,
      ...k.configs.map(
        (c, i) =>
          `  const U ${tiles(i)} = batch_${kernel} * ((rows_${kernel} + ${c.tile[0] - 1}) / ${c.tile[0]}) * ((cols_${kernel} + ${c.tile[1] - 1}) / ${c.tile[1]});`,
      ),
      `  const int configs_${kernel} = ${n};`,
      // The first configuration with enough tiles, else stage 2's mapping; --tile=<n> forces one (the contract).
      // (a tile kernel indexes its spaces with 32 bits; beyond that the kernel keeps stage 2's mapping)
      `  const bool narrow_${kernel} = std::max<U>({rows_${kernel}, cols_${kernel}, ${hostTerms}, ${k.configs.map((_c, i) => tiles(i)).join(', ')}}) < (static_cast<U>(1) << 31);`,
      `  const int config_${kernel} = !narrow_${kernel} ? configs_${kernel} : tile_mode >= 0 ? std::min(tile_mode, configs_${kernel}) : (${rule});`,
    ],
    preload: Array.from(
      { length: n + 1 },
      (_x, i) =>
        `  if (${count} && config_${kernel} == ${i}) check(cudaFuncGetAttributes(&attributes, ${kernel}<${i}>));`,
    ).join('\n'),
    hasWork: count,
    launch: [
      ...k.configs.map((c, i) => {
        const { threads, shared } = configLimits(c);
        return `    if (${count} && config_${kernel} == ${i}) ${kernel}<${i}><<<static_cast<unsigned>(${tiles(i)}), ${threads}, ${shared * 4}>>>(${args});`;
      }),
      `    if (${count} && config_${kernel} == ${n}) ${kernel}<${n}><<<(${count} - 1) / 256 + 1, 256>>>(${args});`,
      `    if (${count}) check(cudaGetLastError());`,
    ].join('\n'),
  };
}

/** The CUDA translation unit for `fn` following `plan` (default: stage 2, one kernel per statement). */
export function emitCuda(fn: Fn, plan: FusionPlan = unfusedPlan(fn)): string {
  return emitSchedule(scheduleFromPlan(fn, plan));
}

/** Print a schedule: one kernel definition per schedule kernel, and the host that launches them. */
export function emitSchedule(schedule: Schedule): string {
  const { fn } = schedule;
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
  const kernels = schedule.kernels.map(k => {
    if (k.kind === 'tile') return emitTile(k, tensors.get(k.statements[0]) as Statement, dims, tensors, name);
    if (k.statements.length === 1 && k.kind === 'thread')
      return emitKernel(tensors.get(k.statements[0]) as Statement, k.name, dims, tensors, name);
    const group: FusionGroup =
      k.kind === 'block'
        ? { ...k, kernel: k.name, mapping: 'block', gated: !!k.gate }
        : {
            kernel: k.name,
            statements: k.statements,
            depth: (tensors.get(k.statements[0]) as Statement).axes.length,
            mapping: 'thread',
            stored: k.stored,
            buffered: [],
            staged: [],
            terms: [],
            inPlace: [],
            heavy: [],
            gated: false,
            reasons: k.reasons,
          };
    return emitGroup(
      group,
      k.kind === 'block' ? k.width : blockThreads,
      k.kind === 'block' ? k.gate : undefined,
      dims,
      tensors,
      name,
    );
  });
  const stored = new Set(schedule.kernels.flatMap(k => k.stored));
  const blocks = schedule.kernels.filter(k => k.kind === 'block');
  const tiles = schedule.kernels.filter(k => k.kind === 'tile');
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
    if (blocks.length)
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
    // what the host chose: each block kernel's side, then each tile kernel's configuration
    ...blocks.map(
      k => `  { const unsigned char choice = fused_${k.name} ? 1 : 0; write(output, &choice, 1); }`,
    ),
    ...tiles.map(
      k =>
        `  { const unsigned char choice = static_cast<unsigned char>(config_${k.name}); write(output, &choice, 1); }`,
    ),
    '}',
  );
  const fused = schedule.kernels.some(k => k.statements.length > 1) ? [fusedSupport] : [];
  const gated = blocks.some(k => k.kind === 'block' && k.gate);
  if (gated) fused.push(gateSupport);
  if (tiles.length) fused.push(tileSupport);
  return [
    support,
    ...fused,
    ...kernels.map(k => k.code),
    host.join('\n'),
    gated || tiles.length ? flagMain(gated, tiles.length > 0) : main,
  ].join('\n\n');
}
