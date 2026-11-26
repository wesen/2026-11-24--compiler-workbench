import { plain, width, type Affine, type Axis, type Expr, type Fn, type Op } from './model.js';

const blockSize = 256;
const operations: Record<Op, string> = {
  '+': '__fadd_rn',
  '-': '__fsub_rn',
  '*': '__fmul_rn',
  '/': 'tix_div',
  neg: 'tix_neg',
  exp: 'tix_exp',
  log: 'tix_log',
  sqrt: 'tix_sqrt',
  tanh: 'tix_tanh',
  max: 'tix_max',
  min: 'tix_min',
};

function affine(form: Affine, names: Map<string, string>): string {
  return (
    '(' +
    [form.constant + 'LL', ...form.terms.map(([name, factor]) => `${factor}LL * ${names.get(name)}`)].join(
      ' + ',
    ) +
    ')'
  );
}

function dimensions(fn: Fn): Map<string, string> {
  const result = new Map<string, string>();
  for (const p of fn.params)
    for (const dim of p.shape) {
      const name = plain(dim);
      if (name && !result.has(name)) result.set(name, 'd' + result.size);
    }
  return result;
}

function literal(text: string): string {
  const bytes = new DataView(new ArrayBuffer(4));
  bytes.setFloat32(0, Math.fround(Number(text)));
  return `__uint_as_float(0x${bytes.getUint32(0).toString(16)}u)`;
}

function kernel(fn: Fn, statementIndex: number, shapes: Map<string, string>) {
  const statement = fn.statements[statementIndex];
  const prior = [...fn.params, ...fn.statements.slice(0, statementIndex)];
  const loads = new Map(prior.map((tensor, i) => [tensor.name, { tensor, index: i }]));
  const reads = new Set<number>();
  const binders = new Map<string, string>();
  let serial = 0;
  let indent = '  ';
  const body: string[] = [];
  const emit = (line: string) => body.push(indent + line);
  function local(prefix: string) {
    return prefix + serial++;
  }
  function bind(axis: Axis) {
    const name = local('i');
    binders.set(axis.id, name);
    return name;
  }
  function extent(axis: Axis) {
    const bound = axis.extent;
    const dim = affine(bound.dim, shapes);
    if (bound.kind === 'dim') return dim;
    if (bound.kind === 'blocks')
      return bound.rounding === 'floor'
        ? `${dim} / ${width}LL`
        : `${dim} / ${width}LL + (${dim} % ${width}LL != 0)`;
    return `tix_tail(${dim} - ${width}LL * ${binders.get(bound.block)})`;
  }
  function scalar(expr: Expr): string {
    switch (expr.kind) {
      case 'literal':
        return literal(expr.text);
      case 'shape':
        return `__ll2float_rn(${shapes.get(expr.name)})`;
      case 'load': {
        const { tensor, index } = loads.get(expr.name)!;
        reads.add(index);
        const offset = expr.indices.reduce(
          (offset, index, i) =>
            `(${offset} * ${affine(tensor.shape[i], shapes)} + ${affine(index, binders)})`,
          '0LL',
        );
        return `p${index}[${offset}]`;
      }
      case 'op':
        return `${operations[expr.op]}(${expr.args.map(scalar).join(', ')})`;
      case 'reduce': {
        const acc = local('acc');
        emit(`float ${acc} = ${expr.op === 'sum' ? '0.0f' : '-CUDART_INF_F'};`);
        for (const axis of expr.axes) {
          const limit = extent(axis);
          const index = bind(axis);
          emit(`for (long long ${index} = 0, limit = ${limit}; ${index} < limit; ++${index}) {`);
          indent += '  ';
        }
        const term = scalar(expr.body);
        emit(`${acc} = ${expr.op === 'sum' ? '__fadd_rn' : 'tix_max'}(${acc}, ${term});`);
        for (const axis of expr.axes) {
          binders.delete(axis.id);
          indent = indent.slice(2);
          emit('}');
        }
        return acc;
      }
    }
  }

  emit('const long long flat = (long long)blockIdx.x * blockDim.x + threadIdx.x;');
  emit('if (flat >= count) return;');
  emit('long long rest = flat;');
  for (let i = statement.axes.length - 1; i >= 0; --i) {
    const axis = statement.axes[i];
    const dim = extent(axis);
    emit(`const long long ${bind(axis)} = rest % ${dim};`);
    if (i > 0) emit(`rest /= ${dim};`);
  }
  const result = scalar(statement.expr);
  emit(`out[flat] = ${result};`);
  const parameters = [
    ...[...reads].map(i => 'const float* p' + i),
    'float* out',
    'long long count',
    ...[...shapes.values()].map(name => 'long long ' + name),
  ];
  return {
    source: `__global__ void statement_${statementIndex}(${parameters.join(', ')}) {\n${body.join('\n')}\n}`,
    reads: [...reads],
  };
}

const prelude = `#include <cuda_runtime.h>
#include <math_constants.h>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>

static void fail(const char* message) {
  std::fprintf(stderr, "%s\\n", message);
  std::exit(1);
}

static void checked(cudaError_t result, const char* call) {
  if (result == cudaSuccess) return;
  std::fprintf(stderr, "%s: %s\\n", call, cudaGetErrorString(result));
  std::exit(1);
}
#define CUDA(call) checked((call), #call)

template<class T> static T read(std::FILE* file) {
  T value;
  if (std::fread(&value, sizeof(T), 1, file) != 1) fail("truncated input record");
  return value;
}
template<class T> static void write(std::FILE* file, T value) {
  if (std::fwrite(&value, sizeof(T), 1, file) != 1) fail("cannot write result record");
}

static float* allocate(long long count) {
  float* address;
  CUDA(cudaMalloc(&address, (count == 0 ? 1 : count) * sizeof(float)));
  return address;
}
static float* upload(std::FILE* file, long long count) {
  float* address = allocate(count);
  if (count != 0) {
    std::vector<float> data(count);
    if (std::fread(data.data(), sizeof(float), count, file) != (size_t)count)
      fail("truncated input tensor");
    CUDA(cudaMemcpy(address, data.data(), count * sizeof(float), cudaMemcpyHostToDevice));
  }
  return address;
}
static void download(std::FILE* file, float* address, long long count) {
  if (count == 0) return;
  std::vector<float> data(count);
  CUDA(cudaMemcpy(data.data(), address, count * sizeof(float), cudaMemcpyDeviceToHost));
  if (std::fwrite(data.data(), sizeof(float), count, file) != (size_t)count)
    fail("cannot write result tensor");
}

__device__ static long long tix_tail(long long count) {
  return count < ${width}LL ? count : ${width}LL;
}
__device__ static float tix_neg(float x) { return -x; }
__device__ static float tix_div(float x, float y) {
  return __double2float_rn(__ddiv_rn((double)x, (double)y));
}
${(['exp', 'log', 'sqrt', 'tanh'] as const)
  .map(
    name => `__device__ static float tix_${name}(float x) { return __double2float_rn(${name}((double)x)); }`,
  )
  .join('\n')}
__device__ static float tix_max(float a, float b) {
  if (isnan(a) || isnan(b)) return nanf("");
  if (a == 0.0f && b == 0.0f) return signbit(a) && signbit(b) ? -0.0f : 0.0f;
  return a > b ? a : b;
}
__device__ static float tix_min(float a, float b) {
  if (isnan(a) || isnan(b)) return nanf("");
  if (a == 0.0f && b == 0.0f) return signbit(a) || signbit(b) ? -0.0f : 0.0f;
  return a < b ? a : b;
}`;

export function emitCuda(fn: Fn): string {
  const shapes = dimensions(fn);
  const tensors = [...fn.params, ...fn.statements];
  const kernels = fn.statements.map((_, i) => kernel(fn, i, shapes));
  const result = tensors.findIndex(t => t.name === fn.result);
  const initializedShapes = new Set<string>();
  const inputs = fn.params.map((p, i) => {
    const extents = p.shape.map((_, axis) => `a${i}_${axis}`);
    const axes = p.shape.flatMap((dim, axis) => {
      const extent = extents[axis];
      const read = `const long long ${extent} = read<uint64_t>(input);`;
      const name = plain(dim);
      if (!name || initializedShapes.has(name)) return [read];
      initializedShapes.add(name);
      return [read, `${shapes.get(name)} = ${extent};`];
    });
    return [
      ...axes,
      `const long long n${i} = ${extents.join(' * ')};`,
      `float* p${i} = upload(input, n${i});`,
    ].join('\n  ');
  });
  const allocations = fn.statements.map((s, j) => {
    const i = fn.params.length + j;
    return `const long long n${i} = ${s.shape.map(a => affine(a, shapes)).join(' * ')};\n  float* p${i} = allocate(n${i});`;
  });
  const preload = kernels.map((_, i) => {
    const n = 'n' + (fn.params.length + i);
    return `if (${n} != 0) {
    cudaFuncAttributes attributes;
    CUDA(cudaFuncGetAttributes(&attributes, statement_${i}));
  }`;
  });
  const launches = kernels.map(({ reads }, i) => {
    const j = fn.params.length + i;
    const args = [...reads.map(p => 'p' + p), 'p' + j, 'n' + j, ...shapes.values()];
    return `if (n${j} != 0) {
      const long long grid = (n${j} - 1) / ${blockSize} + 1;
      if (grid > 2147483647LL) fail("launch grid exceeds device limit");
      statement_${i}<<<(unsigned)grid, ${blockSize}, 0, stream>>>(${args.join(', ')});
      CUDA(cudaGetLastError());
    }`;
  });
  const hasWork = fn.statements.map((_, i) => `n${fn.params.length + i} != 0`).join(' || ') || 'false';
  return `${prelude}

${kernels.map(k => k.source).join('\n\n')}

static void run_case(std::FILE* input, std::FILE* output, int warmup, int repeat) {
  write(output, read<uint32_t>(input));
  ${[...shapes.values()].map(name => 'long long ' + name + ';').join('\n  ')}
  ${inputs.join('\n  ')}
  ${allocations.join('\n  ')}
  ${fn.shape.map(dim => `write<uint64_t>(output, ${affine(dim, shapes)});`).join('\n  ')}
  ${preload.join('\n  ')}
  if (${hasWork}) {
    cudaStream_t stream;
    cudaEvent_t start, end;
    CUDA(cudaStreamCreate(&stream));
    CUDA(cudaEventCreate(&start));
    CUDA(cudaEventCreate(&end));
    const auto launch = [&]() {
    ${launches.join('\n    ')}
    };
    for (int i = 0; i < warmup; ++i) launch();
    if (warmup != 0) CUDA(cudaStreamSynchronize(stream));
    for (int i = 0; i < repeat; ++i) {
      CUDA(cudaEventRecord(start, stream));
      launch();
      CUDA(cudaEventRecord(end, stream));
      CUDA(cudaEventSynchronize(end));
      float milliseconds;
      CUDA(cudaEventElapsedTime(&milliseconds, start, end));
      write(output, milliseconds);
    }
    CUDA(cudaEventDestroy(start));
    CUDA(cudaEventDestroy(end));
    CUDA(cudaStreamDestroy(stream));
  } else {
    for (int i = 0; i < repeat; ++i) write(output, 0.0f);
  }
  download(output, p${result}, n${result});
  ${tensors.map((_, i) => `CUDA(cudaFree(p${i}));`).join('\n  ')}
}

int main(int argc, char** argv) {
  const int warmup = argc > 1 ? std::atoi(argv[1]) : 0;
  const int repeat = argc > 2 ? std::atoi(argv[2]) : 1;
  auto* input = std::fopen("inputs/cases.bin", "rb");
  auto* output = std::fopen("out/results.bin", "wb");
  if (!input || !output) fail("cannot open CUDA batch files");
  const auto count = read<uint32_t>(input);
  write(output, count);
  for (uint32_t i = 0; i < count; ++i) run_case(input, output, warmup, repeat);
  if (std::fgetc(input) != EOF) fail("extra bytes after input records");
  std::fclose(input);
  if (std::fclose(output) != 0) fail("cannot close results");
}
`;
}
