import { blockThreads, groupCap, unfusedPlan, type FusionGroup, type FusionPlan, type ParallelTerm } from './fusion.js';
import {
  plain,
  visit,
  width,
  type Affine,
  type Axis,
  type Expr,
  type Fn,
  type Statement,
  type Tensor,
} from './model.js';

export { blockThreads } from './fusion.js';

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

type Load = Extract<Expr, { kind: 'load' }>;
type Reduce = Extract<Expr, { kind: 'reduce' }>;
type Offset = (indices: readonly Affine[], shape: readonly Affine[]) => string;

// The scalar code of one kernel: index names, temporaries and the tree walk shared by stage 2's one-statement
// kernels and stage 3's fused kernels, so every element is computed by the same code either way. With `fold` set
// (IRWB-030-F), a reduction in the map is not expanded into serial loops: its terms were computed in parallel by
// the block into a shared term buffer, and the walk folds that buffer in the meaning's order instead.
function kernelWriter(
  dimensions: ReadonlyMap<string, string>,
  load: (e: Load, offset: Offset) => string,
  maxFold = 'minmax(ACC, VALUE, true)',
) {
  const lines: string[] = [];
  let termFold: ReadonlyMap<Reduce, { count: string; buffer: string }> | null = null;
  const setFold = (value: ReadonlyMap<Reduce, { count: string; buffer: string }> | null) => {
    termFold = value;
  };
  // Axis names come from a dedicated counter, not from the indices map's size: a staged member's expression is
  // walked more than once (fill, fold, serial fallback), and an axis bound in an earlier walk would otherwise
  // reuse a stale size and collide with the next binder's name (IRWB-030-F). Stage 2's kernels bind every
  // axis exactly once in order, so their emitted names are unchanged.
  let axisNames = 0;
  let indent = '  ',
    next = 0;
  const line = (code: string) => lines.push(indent + code);
  const dim = (a: Affine) => affine(a, n => dimensions.get(n)!);
  const indices = new Map<string, string>();
  const bind = (id: string) => {
    const name = `i${axisNames++}`;
    indices.set(id, name);
    return name;
  };
  const index = (id: string) => indices.get(id)!;
  const offset: Offset = (at, shape) =>
    at.reduce(
      (prior, a, i) => (i ? `(${prior} * ${dim(shape[i])} + ${affine(a, index)})` : affine(a, index)),
      '',
    );
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
        const staged = termFold?.get(e);
        if (staged) {
          const acc = temporary(e.op === 'sum' ? '0.0f' : '-INFINITY');
          const term = `${staged.buffer}[t]`;
          line(
            `for (U t = 0; t < ${staged.count}; ++t) ${acc} = ${e.op === 'sum' ? `__fadd_rn(${acc}, ${term})` : maxFold.replace('ACC', acc).replace('VALUE', term)};`,
          );
          return acc;
        }
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
        const fold = maxFold.replace('ACC', acc).replace('VALUE', value);
        line(`${acc} = ${e.op === 'sum' ? `__fadd_rn(${acc}, ${value})` : fold};`);
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
    bind,
    alias: (id: string, name: string) => void indices.set(id, name),
    scalar,
    setFold,
    enter: () => void (indent += '  '),
    leave: () => void (indent = indent.slice(2)),
  };
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
  w.line('U coordinate = thread;');
  for (let i = statement.axes.length - 1; i >= 0; --i) {
    const axis = w.bind(statement.axes[i].id);
    w.line(`const I ${axis} = coordinate % ${w.dim(statement.shape[i])};`);
    if (i > 0) w.line(`coordinate /= ${w.dim(statement.shape[i])};`);
  }
  const result = w.scalar(statement.expr);
  w.line(`result[thread] = ${result};`);
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

// Threads per block in block mode are capped in fusion.ts (groupCap); the cap constants are measured there.
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
  const outputs = members.filter(m => stored.has(m.name)).map(m => tensorName(m.name));
  const params = [
    ...Array.from(dimensions.values(), d => `I ${d}`),
    ...Array.from(reads, t => `const float* ${tensorName(t)}`),
    ...outputs.map(t => `float* ${t}`),
    block ? 'float* scratch' : 'U count',
  ];
  const suffix = (name: string) => tensorName(name).slice(1);
  const rowBuffers = [...group.staged, ...group.buffered];
  const registers = new Map<string, string>();
  let current = members[0];
  // IRWB-030-F: the parallel-term staging and its template flag; a group without staged reductions keeps
  // stage 3's single Shared parameter, so its source is unchanged.
  const termStaged = block && group.parallelTerms.length > 0;
  const reduceAt = (e: Expr, path: readonly number[]): Reduce =>
    path.reduce<Expr>((x, i) => (x as { args: Expr[] }).args[i], e) as Reduce;
  const extentCount = (a: Axis, dim: (x: Affine) => string): string => {
    const e = a.extent;
    if (e.kind === 'tail') throw Error('A tail extent cannot be counted for staging');
    const n = dim(e.dim);
    return e.kind === 'dim' ? n : e.rounding === 'ceil' ? `((${n}) + ${width - 1}) / ${width}` : `(${n}) / ${width}`;
  };
  const cap = groupCap(group, tensors);
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
  );
  w.lines.push(`// ${kernel}: ${group.statements.join(', ')}; ${group.reasons.join('; ')}`);
  // Block mode is a template on where the rows live, so that shared-memory rows are addressed as shared memory
  // (generic addressing cost 25% on a row max, script 06); the host picks the instantiation. With staged
  // reductions it is also a template on whether the terms were staged (IRWB-030-F): the host stages them only
  // while the term buffers fit in shared memory beside the rows, and otherwise launches the serial fold.
  if (block) w.lines.push(`template <bool Shared${termStaged ? ', bool Staged' : ''}>`);
  w.lines.push(`__global__ void ${kernel}(${params.join(', ')}) {`);
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
    const row = rowBuffers.map(n => `n${suffix(n)}`).join(' + ');
    w.line(`float* const base = Shared ? shared : scratch + point * (${row});`);
    rowBuffers.forEach((name, i) =>
      w.line(
        `float* const r${suffix(name)} = ${i ? `r${suffix(rowBuffers[i - 1])} + n${suffix(rowBuffers[i - 1])}` : 'base'};`,
      ),
    );
    // The staged reductions' term buffers, after the rows when the rows are shared, at the start of shared
    // memory when they are not. One region serves every member: members are separated by barriers.
    if (termStaged) w.line(`float* const terms = Shared ? shared + (${row}) : shared;`);
    for (const name of group.staged) {
      const s = suffix(name);
      w.line(`for (U e = threadIdx.x; e < n${s}; e += blockDim.x) r${s}[e] = t${s}[point * n${s} + e];`);
    }
    if (group.staged.length) w.line('__syncthreads();');
    members.forEach((m, j) => {
      current = m;
      const s = suffix(m.name);
      const stagedTerms =
        block && m.axes.length === depth ? group.parallelTerms.filter(t => t.statement === m.name) : [];
      if (stagedTerms.length) {
        // Declarations visible to both the fill and the fold; the buffers of one member's reductions coexist,
        // and a later member reuses the region after the barrier that follows this one.
        const buffers: { count: string; buffer: string }[] = [];
        stagedTerms.forEach((t, i) => {
          const R = reduceAt(m.expr, t.path),
            q = `q${s}_${i}`,
            nt = `nt${s}_${i}`;
          R.axes.forEach((a, p) => w.line(`const I ${nt}_${p} = ${extentCount(a, w.dim)};`));
          w.line(`float* const ${q} = terms + (${buffers.map(b => b.count).join(' + ') || '0'});`);
          w.line(`const U ${nt} = ${R.axes.map((_, p) => `${nt}_${p}`).join(' * ') || '1'};`);
          buffers.push({ count: nt, buffer: q });
        });
        // Every thread computes its strided share of the terms; the flat index decomposes in the meaning's
        // lexicographic order, so thread 0's fold below keeps the accumulation order.
        w.line('if constexpr (Staged) {');
        w.enter();
        stagedTerms.forEach((t, i) => {
          const R = reduceAt(m.expr, t.path),
            q = `q${s}_${i}`,
            nt = `nt${s}_${i}`;
          w.line(`for (U f = threadIdx.x; f < ${nt}; f += blockDim.x) {`);
          w.enter();
          R.axes.forEach((a, p) => {
            const last = p === R.axes.length - 1,
              stride = R.axes.map((_, k) => `${nt}_${k}`).slice(p + 1).join(' * ') || '1';
            if (last) w.line(`const I b${p} = static_cast<I>(f) % ${nt}_${p};`);
            else if (p === 0) w.line(`const I b${p} = static_cast<I>(f) / (${stride});`);
            else w.line(`const I b${p} = (static_cast<I>(f) / (${stride})) % ${nt}_${p};`);
            w.alias(a.id, `b${p}`);
          });
          w.line(`${q}[f] = ${w.scalar(R.body)};`);
          w.leave();
          w.line('}');
        });
        w.line('__syncthreads();');
        w.leave();
        w.line('}');
        // Thread 0 computes the member from the folded buffers; the serial branch keeps stage 3's code.
        w.line(`for (U e = threadIdx.x; e < n${s}; e += blockDim.x) {`);
        w.enter();
        w.line(`float m${s};`);
        w.line('if constexpr (Staged) {');
        w.enter();
        w.setFold(
          new Map(stagedTerms.map((t, i) => [reduceAt(m.expr, t.path), buffers[i]] as const)),
        );
        const folded = w.scalar(m.expr);
        w.setFold(null);
        w.line(`m${s} = ${folded};`);
        w.leave();
        w.line('} else {');
        w.enter();
        const serial = w.scalar(m.expr);
        w.line(`m${s} = ${serial};`);
        w.leave();
        w.line('}');
        if (group.buffered.includes(m.name)) w.line(`r${s}[e] = m${s};`);
        if (stored.has(m.name)) w.line(`t${s}[point * n${s} + e] = m${s};`);
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
    const hostRow = rowBuffers.map(n => lengthOf(n, hostDim)).join(' + ');
    // The term region holds the largest sum of term counts over the members (members reuse it in turn).
    const hostCount = (a: Axis) => extentCount(a, hostDim);
    const termsPerMember = members.map(m => {
      const list = group.parallelTerms.filter(t => t.statement === m.name);
      if (!list.length) return 'static_cast<U>(0)';
      return list
        .map(t => `(${reduceAt(m.expr, t.path).axes.map(hostCount).join(' * ')})`)
        .join(' + ');
    });
    host.push(
      `  const U grid_${kernel} = ${product(first.shape.slice(0, depth).map(hostDim))};`,
      `  const U row_${kernel} = (${hostRow}) * sizeof(float);`,
      `  const bool shared_${kernel} = row_${kernel} <= static_cast<U>(shared_limit);`,
      `  DeviceBuffer scratch_${kernel}(shared_${kernel} ? 0 : grid_${kernel} * (row_${kernel} / sizeof(float)));`,
      `  const U terms_${kernel} = ${termStaged ? `std::max<U>({${termsPerMember.join(', ')}})` : '0'};`,
      `  const bool staged_${kernel} = ${termStaged ? `terms_${kernel} * sizeof(float) + (shared_${kernel} ? row_${kernel} : 0) <= static_cast<U>(shared_limit)` : 'false'};`,
      `  const unsigned smem_${kernel} = static_cast<unsigned>((shared_${kernel} ? row_${kernel} : 0) + (staged_${kernel} ? terms_${kernel} * sizeof(float) : 0));`,
      `  const U longest_${kernel} = std::max<U>({${lengths.join(', ')}, static_cast<U>(1)});`,
      `  const unsigned threads_${kernel} = static_cast<unsigned>(std::min<U>(${cap}, (longest_${kernel} + 31) / 32 * 32));`,
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
  const instance = termStaged
    ? `${kernel}<shared_${kernel}, staged_${kernel}>`
    : `${kernel}<shared_${kernel}>`;
  const args = [
    ...dimensions.values(),
    ...Array.from(reads, t => tensorName(t) + '.ptr'),
    ...outputs.map(t => t + '.ptr'),
    block ? `scratch_${kernel}.ptr` : `count_${kernel}`,
  ].join(', ');
  return {
    code: w.lines.join('\n'),
    host,
    preload: block
      ? `  if (grid_${kernel}) {
    check(cudaFuncGetAttributes(&attributes, ${instance}));
    if (smem_${kernel} > ${defaultShared}) check(cudaFuncSetAttribute(${instance}, cudaFuncAttributeMaxDynamicSharedMemorySize, static_cast<int>(smem_${kernel})));
  }`
      : `  if (count_${kernel}) check(cudaFuncGetAttributes(&attributes, ${kernel}));`,
    hasWork,
    launch: block
      ? `    if (grid_${kernel}) {
      ${instance}<<<static_cast<unsigned>(grid_${kernel}), threads_${kernel}, smem_${kernel}>>>(${args});
      check(cudaGetLastError());
    }`
      : `    if (count_${kernel}) {
      ${kernel}<<<(count_${kernel} - 1) / 256 + 1, 256>>>(${args});
      check(cudaGetLastError());
    }`,
  };
}

/** The CUDA translation unit for `fn`, one kernel per group of `plan` (default: stage 2, one per statement). */
export function emitCuda(fn: Fn, plan: FusionPlan = unfusedPlan(fn)): string {
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
  const kernels = plan.groups.map(g =>
    g.statements.length === 1
      ? emitKernel(tensors.get(g.statements[0]) as Statement, g.kernel, dims, tensors, name)
      : emitGroup(g, dims, tensors, name),
  );
  const stored = new Set(plan.groups.flatMap(g => g.stored));
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
    if (plan.groups.some(g => g.mapping === 'block'))
      host.push(
        '  int shared_limit = 0;',
        '  check(cudaDeviceGetAttribute(&shared_limit, cudaDevAttrMaxSharedMemoryPerBlockOptin, 0));',
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
    '}',
  );
  const fused = plan.groups.some(g => g.statements.length > 1) ? [fusedSupport] : [];
  return [support, ...fused, ...kernels.map(k => k.code), host.join('\n'), main].join('\n\n');
}
