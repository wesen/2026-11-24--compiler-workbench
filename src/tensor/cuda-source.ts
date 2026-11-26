import {
  width,
  plain,
  visit,
  type Affine,
  type Expr,
  type Extent,
  type Fn,
  type Op,
  type Statement,
} from './model.js';

export const inputMagic = 0x31584954;
export const resultMagic = 0x31524954;
export const protocolVersion = 1;

const scalarOps: Record<Exclude<Op, 'neg'>, string> = {
  '+': '__fadd_rn',
  '-': '__fsub_rn',
  '*': '__fmul_rn',
  '/': '__fdiv_rn',
  exp: 'expf',
  log: 'logf',
  sqrt: '__fsqrt_rn',
  tanh: 'tanhf',
  max: 'tix_max',
  min: 'tix_min',
};

const header = `
#include <cuda_runtime.h>
#include <math_constants.h>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <vector>

static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__ && sizeof(float) == 4,
              "Tix I/O requires a little-endian f32 host");

__device__ float tix_max(float a, float b) {
  if (isnan(a) || isnan(b)) return CUDART_NAN_F;
  if (a == 0 && b == 0) return __uint_as_float(__float_as_uint(a) & __float_as_uint(b));
  return a > b ? a : b;
}

__device__ float tix_min(float a, float b) {
  if (isnan(a) || isnan(b)) return CUDART_NAN_F;
  if (a == 0 && b == 0) return __uint_as_float(__float_as_uint(a) | __float_as_uint(b));
  return a < b ? a : b;
}

static void fail(const char *message) {
  std::fprintf(stderr, "%s\\n", message);
  std::exit(1);
}

static void check(cudaError_t status) {
  if (status != cudaSuccess) fail(cudaGetErrorString(status));
}

template <class T> static T read(FILE *file) {
  T value;
  if (std::fread(&value, sizeof(T), 1, file) != 1) fail("Truncated input");
  return value;
}

template <class T> static void write(FILE *file, T value) {
  if (std::fwrite(&value, sizeof(T), 1, file) != 1) fail("Could not write output");
}

template <size_t Rank> static std::array<long long, Rank> read_shape(FILE *in) {
  std::array<long long, Rank> shape;
  for (auto &extent : shape) {
    auto value = read<uint64_t>(in);
    if (value > std::numeric_limits<long long>::max()) fail("Unsupported input extent");
    extent = static_cast<long long>(value);
  }
  return shape;
}

template <size_t Rank> static size_t elements(const std::array<long long, Rank> &shape) {
  for (auto extent : shape) {
    if (extent < 0) fail("Negative extent");
  }
  for (auto extent : shape) {
    if (extent == 0) return 0;
  }
  size_t count = 1;
  for (auto extent : shape) {
    if (uint64_t(extent) > std::numeric_limits<size_t>::max() / sizeof(float) / count)
      fail("Tensor size exceeds device address space");
    count *= extent;
  }
  return count;
}

struct DeviceBuffer {
  float *ptr = nullptr;
  size_t count;
  explicit DeviceBuffer(size_t n) : count(n) {
    if (count) check(cudaMalloc(&ptr, count * sizeof(float)));
  }
  ~DeviceBuffer() {
    if (ptr) check(cudaFree(ptr));
  }
};

static void read_tensor(FILE *in, DeviceBuffer &tensor) {
  if (!tensor.count) return;
  std::vector<float> data(tensor.count);
  if (std::fread(data.data(), sizeof(float), tensor.count, in) != tensor.count)
    fail("Truncated input tensor");
  check(cudaMemcpy(tensor.ptr, data.data(), tensor.count * sizeof(float), cudaMemcpyHostToDevice));
}

template <size_t Rank> static void write_tensor(
    FILE *out, const std::array<long long, Rank> &shape, const DeviceBuffer &tensor,
    const std::vector<float> &times) {
  for (auto extent : shape) write<uint64_t>(out, extent);
  for (auto time : times) write(out, time);
  if (!tensor.count) return;
  std::vector<float> data(tensor.count);
  check(cudaMemcpy(data.data(), tensor.ptr, tensor.count * sizeof(float), cudaMemcpyDeviceToHost));
  if (std::fwrite(data.data(), sizeof(float), tensor.count, out) != tensor.count)
    fail("Could not write output tensor");
}

static constexpr unsigned threads = 128;

static unsigned blocks(size_t count, unsigned limit) {
  size_t n = count / threads + (count % threads != 0);
  if (n > limit) fail("Output does not fit CUDA grid");
  return static_cast<unsigned>(n);
}
`;

function affine(form: Affine, names: ReadonlyMap<string, string>): string {
  const terms = form.terms.map(([name, scale]) =>
    scale === 1 ? names.get(name)! : `(${scale}LL * ${names.get(name)})`,
  );
  if (form.constant || terms.length === 0) terms.unshift(`${form.constant}LL`);
  return terms.length === 1 ? terms[0] : `(${terms.join(' + ')})`;
}

function literal(text: string) {
  const storage = new Float32Array([Number(text)]);
  return `__uint_as_float(0x${new Uint32Array(storage.buffer)[0].toString(16)}U)`;
}

export function emitCuda(fn: Fn): string {
  const lines: string[] = [header];
  let indent = 0;
  const line = (text: string) => lines.push('  '.repeat(indent) + text);
  const block = (text: string, body: () => void) => {
    line(text + ' {');
    indent++;
    body();
    indent--;
    line('}');
  };

  const tensors = new Map([...fn.params, ...fn.statements].map((t, i) => [t.name, { ...t, slot: i }]));
  const shapeVars = new Map<string, string>();
  const shapeBindings: string[] = [];
  fn.params.forEach((p, slot) =>
    p.shape.forEach((form, axis) => {
      const name = plain(form);
      if (name && !shapeVars.has(name)) {
        const variable = `dim${shapeVars.size}`;
        shapeVars.set(name, variable);
        shapeBindings.push(`const long long ${variable} = shape${slot}[${axis}];`);
      }
    }),
  );
  const dims = [...shapeVars.values()];
  const reads = (s: Statement) => {
    const names = new Set<string>();
    visit(s.expr, e => {
      if (e.kind === 'load') names.add(e.name);
    });
    return [...names].map(name => tensors.get(name)!.slot);
  };
  const dependencies = fn.statements.map(reads);

  fn.statements.forEach((s, i) => {
    const slot = tensors.get(s.name)!.slot;
    const params = [
      'size_t count',
      ...dims.map(d => `long long ${d}`),
      ...dependencies[i].map(n => `const float *tensor${n}`),
      `float *tensor${slot}`,
    ];
    block(`__global__ void statement${i}(${params.join(', ')})`, () => {
      if (s.shape.some(d => !d.terms.length && d.constant === 0)) return;
      line('const size_t element = size_t(blockIdx.x) * blockDim.x + threadIdx.x;');
      line('if (element >= count) return;');
      if (s.axes.length > 1) line('long long remaining = element;');
      const indices = new Map<string, string>();
      let next = 0;
      for (let k = s.axes.length - 1; k >= 0; k--) {
        const name = `index${next++}`;
        indices.set(s.axes[k].id, name);
        const extent = affine(s.shape[k], shapeVars);
        if (s.axes.length === 1) line(`const long long ${name} = element;`);
        else if (k === 0) line(`const long long ${name} = remaining;`);
        else {
          line(`const long long ${name} = remaining % ${extent};`);
          line(`remaining /= ${extent};`);
        }
      }
      function extent(e: Extent) {
        const dim = affine(e.dim, shapeVars);
        if (e.kind === 'dim') return dim;
        if (e.kind === 'blocks')
          return e.rounding === 'ceil'
            ? `${dim} / ${width}LL + (${dim} % ${width}LL != 0)`
            : `${dim} / ${width}LL`;
        return `min(${width}LL, ${dim} - ${width}LL * ${indices.get(e.block)})`;
      }
      function scalar(e: Expr): string {
        if (e.kind === 'reduce') {
          const { axes, body, op } = e;
          const acc = `value${next++}`;
          line(`float ${acc} = ${op === 'sum' ? '0.0f' : '-CUDART_INF_F'};`);
          function loops(k: number) {
            if (k === axes.length) {
              const term = scalar(body);
              line(`${acc} = ${op === 'sum' ? '__fadd_rn' : 'tix_max'}(${acc}, ${term});`);
              return;
            }
            const axis = axes[k];
            const index = `index${next++}`;
            const end = extent(axis.extent);
            block(`for (long long ${index} = 0, end = ${end}; ${index} < end; ++${index})`, () => {
              indices.set(axis.id, index);
              loops(k + 1);
              indices.delete(axis.id);
            });
          }
          loops(0);
          return acc;
        }
        let expression: string;
        switch (e.kind) {
          case 'literal':
            expression = literal(e.text);
            break;
          case 'shape':
            expression = `__ll2float_rn(${shapeVars.get(e.name)})`;
            break;
          case 'load': {
            const t = tensors.get(e.name)!;
            const addresses = e.indices.map(a => affine(a, indices));
            const offset = addresses
              .slice(1)
              .reduce(
                (result, address, j) => `(${result} * ${affine(t.shape[j + 1], shapeVars)} + ${address})`,
                addresses[0],
              );
            expression = `tensor${t.slot}[${offset}]`;
            break;
          }
          case 'op': {
            const args = e.args.map(scalar);
            expression = e.op === 'neg' ? `-${args[0]}` : `${scalarOps[e.op]}(${args.join(', ')})`;
            break;
          }
        }
        const name = `value${next++}`;
        line(`const float ${name} = ${expression};`);
        return name;
      }
      const result = scalar(s.expr);
      line(`tensor${slot}[element] = ${result};`);
    });
    line('');
  });

  block('int main(int argc, char **argv)', () => {
    line('const int repeats = argc == 2 ? std::atoi(argv[1]) : 1;');
    line('if (argc > 2 || repeats < 1) fail("Expected a positive repetition count");');
    line('FILE *in = std::fopen("cases.bin", "rb");');
    line('FILE *out = std::fopen("out/results.bin", "wb");');
    line('if (!in || !out) fail("Could not open case or result file");');
    line(`if (read<uint32_t>(in) != ${inputMagic}U || read<uint32_t>(in) != ${protocolVersion}U)`);
    line('  fail("Unsupported input format");');
    line('const auto count = read<uint32_t>(in);');
    line(`write<uint32_t>(out, ${resultMagic}U);`);
    line(`write<uint32_t>(out, ${protocolVersion}U);`);
    line('write(out, count);');
    if (fn.statements.length) {
      line('cudaDeviceProp properties;');
      line('check(cudaGetDeviceProperties(&properties, 0));');
      line('cudaFuncAttributes attributes;');
      fn.statements.forEach((_, i) => line(`check(cudaFuncGetAttributes(&attributes, statement${i}));`));
      line('cudaEvent_t start, end;');
      line('check(cudaEventCreate(&start));');
      line('check(cudaEventCreate(&end));');
    }
    block('for (uint32_t c = 0; c < count; ++c)', () => {
      fn.params.forEach((p, slot) => {
        line(`const auto shape${slot} = read_shape<${p.shape.length}>(in);`);
        line(`DeviceBuffer tensor${slot}(elements(shape${slot}));`);
        line(`read_tensor(in, tensor${slot});`);
      });
      shapeBindings.forEach(line);
      fn.statements.forEach((s, i) => {
        const slot = tensors.get(s.name)!.slot;
        line(
          `const std::array<long long, ${s.shape.length}> shape${slot} = {${s.shape.map(d => affine(d, shapeVars)).join(', ')}};`,
        );
        line(`DeviceBuffer tensor${slot}(elements(shape${slot}));`);
        line(`const unsigned grid${i} = blocks(tensor${slot}.count, properties.maxGridSize[0]);`);
      });
      line('std::vector<float> times(repeats, 0.0f);');
      if (fn.statements.length)
        block(`if (${fn.statements.map((_, i) => `grid${i}`).join(' || ')})`, () => {
          block('for (auto &time : times)', () => {
            line('check(cudaEventRecord(start));');
            fn.statements.forEach((s, i) => {
              const slot = tensors.get(s.name)!.slot;
              const args = [
                `tensor${slot}.count`,
                ...dims,
                ...dependencies[i].map(n => `tensor${n}.ptr`),
                `tensor${slot}.ptr`,
              ];
              line(`if (grid${i}) statement${i}<<<grid${i}, threads>>>(${args.join(', ')});`);
            });
            line('check(cudaGetLastError());');
            line('check(cudaEventRecord(end));');
            line('check(cudaEventSynchronize(end));');
            line('check(cudaEventElapsedTime(&time, start, end));');
          });
        });
      const result = tensors.get(fn.result)!.slot;
      line(`write_tensor(out, shape${result}, tensor${result}, times);`);
    });
    if (fn.statements.length) {
      line('check(cudaEventDestroy(start));');
      line('check(cudaEventDestroy(end));');
    }
    line(
      'if (std::fgetc(in) != EOF || std::fclose(in) || std::fclose(out)) fail("Invalid case file or output");',
    );
    line('return 0;');
  });
  return lines.join('\n') + '\n';
}
