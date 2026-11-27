import { gateRule, outerReductions, unfusedPlan, type FusionPlan, type Reduce } from './fusion.js';
import {
  blockThreads,
  contractionReduction,
  scheduleGroup,
  type Contraction,
  type Schedule,
  type ScheduleGroup,
  type ScheduledContraction,
  type SharedTile,
} from './schedule.js';
export { blockThreads };
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

const scheduledFlag = '      else if (!strcmp(argv[a], "--gate=scheduled")) gate_mode = 3;\n';
const scheduledMain = gatedMain.replace('      else throw', scheduledFlag + '      else throw');
export const takesScheduledGate = (source: string) => source.includes(scheduledFlag);

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
  folded: (e: Reduce) => string | undefined = () => undefined,
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
        const replacement = folded(e);
        if (replacement !== undefined) return replacement;
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
    offset,
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

// The tile printer uses disjoint output coordinates and loads only the axes each operand reads.
// Filling shared memory outside the operand domain is safe because the fold visits only valid terms.
function emitTile(
  domain: Contraction,
  layout: SharedTile,
  statement: Statement,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
) {
  const { swap, columnLoad, stripe } = layout;
  const [ty, tx] = layout.threads,
    [ry, rx] = layout.patch;
  const rows = ty * ry,
    columns = tx * rx,
    threads = ty * tx;
  const row = swap ? domain.column : domain.row,
    column = swap ? domain.row : domain.column;
  const [left, right] = swap ? [domain.operands[1], domain.operands[0]] : domain.operands;
  const reduction = contractionReduction(statement, domain);
  const w = kernelWriter(
    dimensions,
    (e, offset) => `${tensorName(e.name)}[${offset(e.indices, tensors.get(e.name)!.shape)}]`,
    undefined,
    undefined,
    e => (e === reduction ? 'acc[ri][ci]' : undefined),
  );
  w.enter();
  const axisDims = (axes: number[]) => axes.map(i => w.dim(statement.shape[i]));
  const terms = reduction.axes.map(a => w.bound(a.extent));
  const m = product(axisDims(row)),
    n = product(axisDims(column)),
    k = product(terms);
  const batch = product(axisDims(domain.batch));
  const divUp = (size: string, tile: number) => `(${size} / ${tile} + (${size} % ${tile} != 0))`;
  const decode = (linear: string, axes: { id: string; dim: string }[]) => {
    if (!axes.length) return;
    axes.forEach(a => w.alias(a.id, 'at_' + a.id));
    if (axes.length === 1) {
      w.line(`const I at_${axes[0].id} = ${linear};`);
      return;
    }
    const scratch = `rest_${axes[0].id}`;
    w.line(`U ${scratch} = ${linear};`);
    for (let i = axes.length - 1; i >= 0; i--) {
      w.line(`const I at_${axes[i].id} = ${i ? `${scratch} % ${axes[i].dim}` : scratch};`);
      if (i) w.line(`${scratch} /= ${axes[i].dim};`);
    }
  };
  const outputAxes = (axes: number[]) =>
    axes.map(i => ({ id: statement.axes[i].id, dim: w.dim(statement.shape[i]) }));
  const termAxes = reduction.axes.map((a, i) => ({ id: a.id, dim: terms[i] }));
  const open = (line: string) => {
    w.line(line + ' {');
    w.enter();
  };
  const close = () => {
    w.leave();
    w.line('}');
  };

  w.line(`const U M = ${m}, N = ${n}, K = ${k};`);
  w.line(`const U tiles_m = ${divUp('M', rows)}, tiles_n = ${divUp('N', columns)};`);
  w.line(`const U batch_index = blockIdx.x / (tiles_m * tiles_n);`);
  decode('batch_index', outputAxes(domain.batch));
  w.line(`const U m0 = (blockIdx.x / tiles_n % tiles_m) * ${rows};`);
  w.line(`const U n0 = (blockIdx.x % tiles_n) * ${columns};`);
  w.line(`const unsigned lane_m = threadIdx.x / ${tx}, lane_n = threadIdx.x % ${tx};`);
  w.line(`__shared__ float tile_a[${stripe}][${rows + 1}];`);
  w.line(`__shared__ float tile_b[${stripe}][${columns + (columnLoad === 'term-first' ? 1 : 0)}];`);
  w.line(`float acc[${ry}][${rx}] = {};`);
  open(`for (U k0 = 0; k0 < K; k0 += ${stripe})`);
  const loadTile = (side: 'a' | 'b', load: Load, termFirst: boolean, width: number, axes: number[]) => {
    open(`for (unsigned x = threadIdx.x; x < ${width * stripe}; x += ${threads})`);
    w.line(`const unsigned kt = ${termFirst ? `x % ${stripe}` : `x / ${width}`};`);
    w.line(`const unsigned item = ${termFirst ? `x / ${stripe}` : `x % ${width}`};`);
    const [base, limit] = side === 'a' ? ['m0', 'M'] : ['n0', 'N'];
    w.line('float word = 0.0f;');
    open(`if (TileMode == 2 || (${base} + item < ${limit} && k0 + kt < K))`);
    decode(`${base} + item`, outputAxes(axes));
    // Keep each coordinate decoder's scratch name in its own scope.
    if (termAxes.length > 1) {
      w.line('U term_rest = k0 + kt;');
      for (let i = termAxes.length - 1; i >= 0; i--) {
        const { id, dim } = termAxes[i];
        w.alias(id, 'at_' + id);
        w.line(`const I at_${id} = ${i ? 'term_rest % ' + dim : 'term_rest'};`);
        if (i) w.line(`term_rest /= ${dim};`);
      }
    } else decode('k0 + kt', termAxes);
    w.line(`word = ${w.scalar(load)};`);
    close();
    w.line(`tile_${side}[kt][item] = word;`);
    close();
  };
  loadTile('a', left, true, rows, row);
  loadTile('b', right, columnLoad === 'term-first', columns, column);
  w.line('__syncthreads();');
  w.line(`const unsigned valid = K - k0 < ${stripe} ? K - k0 : ${stripe};`);
  const fold = (limit: string, unroll: boolean) => {
    if (unroll) w.line('#pragma unroll');
    open(`for (unsigned kk = 0; kk < ${limit}; ++kk)`);
    w.line('#pragma unroll');
    open(`for (unsigned ri = 0; ri < ${ry}; ++ri)`);
    w.line(`const float a = tile_a[kk][lane_m + ri * ${ty}];`);
    w.line('#pragma unroll');
    open(`for (unsigned ci = 0; ci < ${rx}; ++ci)`);
    w.line(`const float b = tile_b[kk][lane_n + ci * ${tx}];`);
    w.line(`acc[ri][ci] = __fadd_rn(acc[ri][ci], __fmul_rn(${swap ? 'b, a' : 'a, b'}));`);
    close();
    close();
    close();
  };
  open(`if (TileMode == 2 || valid == ${stripe})`);
  fold(String(stripe), true);
  w.leave();
  w.line('} else {');
  w.enter();
  fold('valid', false);
  close();
  w.line('__syncthreads();');
  close();
  w.line('#pragma unroll');
  open(`for (unsigned ri = 0; ri < ${ry}; ++ri)`);
  w.line('#pragma unroll');
  open(`for (unsigned ci = 0; ci < ${rx}; ++ci)`);
  w.line(`const U out_m = m0 + lane_m + ri * ${ty}, out_n = n0 + lane_n + ci * ${tx};`);
  open('if (TileMode == 2 || (out_m < M && out_n < N))');
  decode('out_m', outputAxes(row));
  // At present recognition may produce several axes in either direction. Use different scratch names.
  decode('out_n', outputAxes(column));
  const result = w.scalar(statement.expr);
  const at = statement.axes.map(a => ({ constant: 0, terms: [[a.id, 1]] as [string, number][] }));
  w.line(`result[${w.offset(at, statement.shape)}] = ${result};`);
  close();
  close();
  close();
  return {
    lines: w.lines,
    threads,
    grid: `${batch} * ${divUp(m, rows)} * ${divUp(n, columns)}`,
    aligned: `${m} % ${rows} == 0 && ${n} % ${columns} == 0 && ${k} % ${stripe} == 0`,
    profitability: `${k} >= ${layout.minTerms} && elements(shape_${tensorName(statement.name)}) >= ${layout.minOutputs}`,
  };
}

interface KernelEmission {
  code: string;
  params: string[];
  argumentKeys: string[];
  host: string[];
  preload: string;
  launch: string;
  hasWork: string;
  tiled?: ReturnType<typeof emitTile>;
}

interface KernelLink {
  device: string;
  target: (mode: number) => string;
  arguments?: (scratch: string, count: string) => string;
}

interface GroupLink extends KernelLink {
  /** Availability of the alternative phase path. */
  alternate?: { active: string; materialized: string[] };
  /** Fused phase with externally owned buffers. */
  phase?: string;
}

// Stage 2: one kernel for one statement, one thread per output element.
function emitKernel(
  statement: Fn['statements'][number],
  kernel: string,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
  contraction?: ScheduledContraction,
  link?: KernelLink,
): KernelEmission {
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
  const tiled =
    contraction?.layout?.kind === 'shared-tile'
      ? emitTile(contraction.domain, contraction.layout, statement, dimensions, tensors, tensorName)
      : undefined;
  if (tiled) w.lines.push('template <int TileMode>');
  const qualifier = link ? '__device__ __forceinline__' : '__global__';
  w.lines.push(`${qualifier} void ${link?.device ?? kernel}(${params.join(', ')}) {`);
  if (tiled) {
    w.line('if constexpr (TileMode != 0) {');
    w.lines.push(...tiled.lines);
    w.line('} else {');
    w.enter();
  }
  w.line('const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
  w.line('if (thread >= count) return;');
  elementOfThread(w, statement, 'result');
  if (tiled) {
    w.leave();
    w.line('}');
  }
  w.lines.push('}');
  const count = `${tensorName(statement.name)}.size`;
  const argumentKeys = [...args, 'count'];
  const actual =
    link?.arguments?.('nullptr', count) ??
    [...args.map((arg, i) => (i < dimensions.size ? arg : arg + '.ptr')), count].join(', ');
  const target = (mode: number) => link?.target(mode) ?? (tiled ? `${kernel}<${mode}>` : kernel);
  const code = w.lines.join('\n');
  const metadata = { code, params, argumentKeys, hasWork: count, tiled };
  if (tiled) {
    return {
      ...metadata,
      host: [
        `  const U tile_grid_${kernel} = ${tiled.grid};`,
        `  const bool tiled_${kernel} = ${link ? 'true' : `gate_mode ? gate_mode == 1 : ${tiled.profitability}`};`,
        `  const bool aligned_${kernel} = ${tiled.aligned};`,
      ],
      preload: `  if (${count}) check(cudaFuncGetAttributes(&attributes, tiled_${kernel} ? (aligned_${kernel} ? ${target(2)} : ${target(1)}) : ${target(0)}));`,
      launch: `    if (${count}) {
      if (tiled_${kernel} && aligned_${kernel}) ${target(2)}<<<tile_grid_${kernel}, ${tiled.threads}>>>(${actual});
      else if (tiled_${kernel}) ${target(1)}<<<tile_grid_${kernel}, ${tiled.threads}>>>(${actual});
      else ${target(0)}<<<(${count} - 1) / 256 + 1, 256>>>(${actual});
      check(cudaGetLastError());
    }`,
    };
  }
  return {
    ...metadata,
    host: [] as string[],
    preload: `  if (${count}) check(cudaFuncGetAttributes(&attributes, ${target(0)}));`,
    launch: `    if (${count}) {
      ${target(0)}<<<(${count} - 1) / 256 + 1, 256>>>(${actual});
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
// Dynamic shared memory a block may use without opting in (CUDA's fixed default).
const defaultShared = 48 * 1024;

const product = (dims: string[]) =>
  dims.length ? `(${dims.map(d => `static_cast<U>(${d})`).join(' * ')})` : 'static_cast<U>(1)';

// Stage 3: one kernel for a fused group (fusion.ts). Thread mode keeps stage 2's mapping with the members'
// values in registers; block mode runs one block per block-domain point with rows in shared memory, or in a
// global scratch area when they do not fit.
function emitGroup(
  group: ScheduleGroup,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
  link?: GroupLink,
): KernelEmission {
  const { kernel, depth } = group;
  const target = (mode: number) => link?.target(mode) ?? `${kernel}<${mode}>`;
  const phase = link?.phase;
  const alternate = link?.alternate;
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
  const cap = group.launch.kind === 'row' ? group.launch.cap : 0;
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
  const qualifier = link ? '__device__ __forceinline__' : '__global__';
  w.lines.push(`${qualifier} void ${link?.device ?? kernel}(${params.join(', ')}) {`);
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
      const store = (value: string) => {
        if (group.buffered.includes(m.name)) w.line(`r${s}[e] = ${value};`);
        if (stored.has(m.name)) w.line(`t${s}[point * n${s} + e] = ${value};`);
      };
      w.line(`for (U e = threadIdx.x; e < n${s}; e += blockDim.x) {`);
      w.enter();
      if (m.axes.length > depth) w.line('U rest = e;');
      for (let p = m.axes.length - 1; p >= depth; --p) {
        const axis = w.bind(m.axes[p].id);
        w.line(`const I ${axis} = rest % ${w.dim(m.shape[p])};`);
        if (p > depth) w.line(`rest /= ${w.dim(m.shape[p])};`);
      }
      store(w.scalar(m.expr));
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
        ? `  const unsigned threads_${kernel} = static_cast<unsigned>(std::min<U>(${group.launch.kind === 'row' ? group.launch.heavyCap : 0}, (std::max<U>(std::min<U>({${group.heavy.map(n => lengthOf(n, hostDim)).join(', ')}}), 1) + 31) / 32 * 32));`
        : `  const unsigned threads_${kernel} = static_cast<unsigned>(std::min<U>(${cap}, (longest_${kernel} + 31) / 32 * 32));`,
      // The gate: block mode, or the members one by one. --gate=fused|unfused forces a side (the contract).
      // Blocks of this kernel that fit on one SM, by its block, thread and shared-memory limits (each block's
      // shared memory includes the device's reserved part: 1 KiB on the GB10).
      `  const U resident_${kernel} = std::min<U>({sm_blocks, sm_threads / threads_${kernel}, shared_${kernel} ? sm_shared / (row_${kernel} + sm_reserved) : sm_blocks});`,
      `  const bool fused_${kernel} = ${alternate ? alternate.active + ' || ' : ''}${
        phase
          ? 'true'
          : `${alternate ? '(' : ''}gate_mode ? gate_mode == 1 : ${gateRule(
              {
                grid: `grid_${kernel}`,
                longest: `longest_${kernel}`,
                lanes: group.heavy.map(
                  n => `resident_${kernel} * std::min<U>(threads_${kernel}, ${lengthOf(n, hostDim)})`,
                ),
                slots: 'sm_threads',
              },
              group.launch.kind === 'row' ? group.launch.gate : undefined,
            )}${alternate ? ')' : ''}`
      };`,
      `  DeviceBuffer scratch_${kernel}(${phase ? phase + ' && ' : alternate ? '!' + alternate.active + ' && ' : ''}fused_${kernel} && !shared_${kernel} ? grid_${kernel} * (row_${kernel} / sizeof(float)) : 0);`,
      ...members
        .filter(m => !phase && !stored.has(m.name))
        .map(m => {
          const baseNeeds = `!fused_${kernel}`;
          const needed = alternate
            ? `(${alternate.active} ? ${alternate.materialized.includes(m.name)} : ${baseNeeds})`
            : baseNeeds;
          return `  DeviceBuffer ${tensorName(m.name)}(${needed} ? elements(shape_${tensorName(m.name)}) : 0);`;
        }),
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
  const argumentKeys = [
    ...dimensions.values(),
    ...Array.from(reads, tensorName),
    ...outputs,
    ...(block ? ['scratch'] : []),
    'count',
  ];
  const actual = (count: string) =>
    link?.arguments?.(`scratch_${kernel}.ptr`, count) ?? [...args, count].join(', ');
  const blockArgs = actual('0');
  return {
    code: w.lines.join('\n'),
    host,
    params,
    argumentKeys,
    preload: block
      ? `  if (grid_${kernel} && fused_${kernel}) {
    check(cudaFuncGetAttributes(&attributes, shared_${kernel} ? ${target(1)} : ${target(0)}));
    if (${optIn}) check(cudaFuncSetAttribute(${target(1)}, cudaFuncAttributeMaxDynamicSharedMemorySize, static_cast<int>(row_${kernel})));
  }
  if (grid_${kernel} && !fused_${kernel}) {
${members.map((_m, j) => `    check(cudaFuncGetAttributes(&attributes, ${target(2 + j)}));`).join('\n')}
  }`
      : `  if (count_${kernel}) check(cudaFuncGetAttributes(&attributes, ${link?.target(0) ?? kernel}));`,
    hasWork,
    launch: block
      ? `    if (grid_${kernel} && fused_${kernel} && shared_${kernel}) ${target(1)}<<<static_cast<unsigned>(grid_${kernel}), threads_${kernel}, row_${kernel}>>>(${blockArgs});
    if (grid_${kernel} && fused_${kernel} && !shared_${kernel}) ${target(0)}<<<static_cast<unsigned>(grid_${kernel}), threads_${kernel}>>>(${blockArgs});
${members
  .map(
    (m, j) =>
      `    if (!fused_${kernel} && ${size(m)}) ${target(2 + j)}<<<(${size(m)} - 1) / 256 + 1, 256>>>(${actual(size(m))});`,
  )
  .join('\n')}
    if (grid_${kernel}) check(cudaGetLastError());`
      : `    if (count_${kernel}) {
      ${link?.target(0) ?? kernel}<<<(count_${kernel} - 1) / 256 + 1, 256>>>(${link?.arguments?.('nullptr', `count_${kernel}`) ?? args.join(', ')});
      check(cudaGetLastError());
    }`,
  };
}

function emitPartition(
  group: ScheduleGroup,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
) {
  const { kernel, partition } = group;
  const { phases, materialized } = partition!;
  const active = `scheduled_${kernel}`;
  const target = (mode: number) => `${kernel}<${mode}>`;
  const baseDevice = kernel + '_original';
  const base = emitGroup(group, dimensions, tensors, tensorName, {
    device: baseDevice,
    target,
    alternate: { active, materialized },
  });
  const forwarded = base.argumentKeys;
  const actual = (scratch: string, count: string) =>
    forwarded
      .map((key, i) =>
        key === 'scratch' ? scratch : key === 'count' ? count : i < dimensions.size ? key : key + '.ptr',
      )
      .join(', ');
  const firstPhaseMode = 2 + group.statements.length;
  const phaseKernels = phases.map((phase, i) => {
    const offset = firstPhaseMode + i * 3;
    const link = { device: phase.kernel, target: (mode: number) => target(offset + mode), arguments: actual };
    const emitted =
      phase.statements.length === 1
        ? emitKernel(
            tensors.get(phase.statements[0]) as Statement,
            phase.kernel,
            dimensions,
            tensors,
            tensorName,
            phase.contractions[0],
            link,
          )
        : emitGroup(phase, dimensions, tensors, tensorName, { ...link, phase: active });
    const tiled = emitted.tiled;
    const templated = Boolean(tiled) || phase.mapping === 'block';
    const dispatch = [
      `  if constexpr (Mode >= ${offset} && Mode < ${offset + 3})`,
      `    ${link.device}${templated ? `<Mode - ${offset}>` : ''}(${emitted.argumentKeys.join(', ')});`,
    ];
    return { ...emitted, dispatch, profitable: tiled?.profitability };
  });
  const condition = phaseKernels.flatMap(p => (p.profitable ? [p.profitable] : [])).join(' && ');
  const scoped = (code: string, active: string) => `  if (${active}) {\n${code}\n  }`;
  return {
    code: [
      base.code,
      ...phaseKernels.map(p => p.code),
      'template <int Mode>',
      `__global__ void ${kernel}(${base.params.join(', ')}) {`,
      `  if constexpr (Mode < ${firstPhaseMode}) ${baseDevice}<Mode>(${forwarded.join(', ')});`,
      ...phaseKernels.flatMap(p => p.dispatch),
      '}',
    ].join('\n'),
    hasWork: base.hasWork,
    host: [
      `  const bool ${active} = gate_mode ? gate_mode == 3 : (${condition});`,
      ...base.host,
      ...phaseKernels.flatMap(p => p.host),
    ],
    preload: [
      scoped(base.preload, '!' + active),
      scoped(phaseKernels.map(p => p.preload).join('\n'), active),
    ].join('\n'),
    launch: [
      scoped(base.launch, '!' + active),
      scoped(
        phaseKernels
          .map((p, i) => `    // begin schedule phase ${i}\n${p.launch}\n    // end schedule phase ${i}`)
          .join('\n'),
        active,
      ),
    ].join('\n'),
  };
}

/** The CUDA translation unit for `fn`, one kernel per group of `plan` (default: stage 2, one per statement). */
export function emitCuda(fn: Fn, plan: FusionPlan = unfusedPlan(fn)): string {
  return emitSchedule({ fn, groups: plan.groups.map(g => scheduleGroup(fn, g)) });
}

export function emitSchedule({ fn, groups }: Schedule): string {
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
  const kernels = groups.map(g =>
    g.partition
      ? emitPartition(g, dims, tensors, name)
      : g.statements.length === 1
        ? emitKernel(
            tensors.get(g.statements[0]) as Statement,
            g.kernel,
            dims,
            tensors,
            name,
            g.contractions.find(c => c.layout?.kind === 'shared-tile'),
          )
        : emitGroup(g, dims, tensors, name),
  );
  const stored = new Set(groups.flatMap(g => g.stored));
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
    if (groups.some(g => g.mapping === 'block'))
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
    ...groups
      .filter(g => g.statements.length > 1 && g.mapping === 'block')
      .map(g => `  { const unsigned char choice = fused_${g.kernel} ? 1 : 0; write(output, &choice, 1); }`),
    '}',
  );
  const fused = groups.some(g => g.statements.length > 1) ? [fusedSupport] : [];
  const gated = groups.some(g => g.gated || g.contractions.some(c => c.layout?.kind === 'shared-tile'));
  if (gated) fused.push(gateSupport);
  const entry = groups.some(g => g.partition) ? scheduledMain : gated ? gatedMain : main;
  return [support, ...fused, ...kernels.map(k => k.code), host.join('\n'), entry].join('\n\n');
}
