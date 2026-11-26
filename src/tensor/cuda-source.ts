import {
  plain,
  visit,
  width,
  type Affine,
  type Expr,
  type Extent,
  type Fn,
  type Statement,
} from './model.js';
import type { TixProgram } from './index.js';

export function selected(program: TixProgram['current'], name: string) {
  const fn = program.value.functions.find(f => f.name === name);
  if (!fn) throw Error('Unknown function ' + name);
  return fn;
}

function affine(a: Affine, names: Map<string, string>) {
  return (
    '(' + [a.constant + 'LL', ...a.terms.map(([id, k]) => k + 'LL * ' + names.get(id))].join(' + ') + ')'
  );
}
const ops = {
  '+': '__fadd_rn',
  '-': '__fsub_rn',
  '*': '__fmul_rn',
  '/': '__fdiv_rn',
  exp: 'expf',
  log: 'logf',
  tanh: 'tanhf',
  sqrt: 'sqrtf',
  max: 'jsmax',
  min: 'jsmin',
};

function kernel(fn: Fn, stmt: Statement, index: number, dims: Map<string, string>) {
  const tensors = [...fn.params, ...fn.statements];
  const number = (name: string) => tensors.findIndex(t => t.name === name);
  const reads = new Set<number>();
  visit(stmt.expr, e => {
    if (e.kind === 'load') reads.add(number(e.name));
  });
  const result = number(stmt.name);
  const args = [
    'long long count',
    'float *out',
    ...[...reads].map(n => 'const float *t' + n),
    ...[...dims.values()].map(d => 'long long ' + d),
  ];
  const lines = ['__global__ void kernel' + index + '(' + args.join(', ') + ') {'];
  let depth = 1,
    serial = 0;
  const line = (s: string) => lines.push('  '.repeat(depth) + s);
  const fresh = () => 'v' + serial++;
  const axes = new Map<string, string>();
  function extent(e: Extent) {
    const n = affine(e.dim, dims);
    if (e.kind === 'dim') return n;
    if (e.kind === 'blocks')
      return '((' + n + ' + ' + (e.rounding === 'ceil' ? width - 1 : 0) + ') / ' + width + ')';
    return 'min(' + width + 'LL, ' + n + ' - ' + width + 'LL * ' + axes.get(e.block) + ')';
  }
  function scalar(e: Expr): string {
    const v = fresh();
    let rhs: string;
    switch (e.kind) {
      case 'reduce': {
        line('float ' + v + ' = ' + (e.op === 'sum' ? '0.0f' : '-INFINITY') + ';');
        for (const axis of e.axes) {
          const id = fresh(),
            limit = extent(axis.extent);
          axes.set(axis.id, id);
          line('for (long long ' + id + ' = 0; ' + id + ' < ' + limit + '; ++' + id + ') {');
          depth++;
        }
        const body = scalar(e.body);
        line(v + ' = ' + (e.op === 'sum' ? '__fadd_rn' : 'jsmax') + '(' + v + ', ' + body + ');');
        for (const axis of e.axes) {
          depth--;
          line('}');
          axes.delete(axis.id);
        }
        return v;
      }
      case 'literal': {
        const bits = new Uint32Array(Float32Array.of(Number(e.text)).buffer)[0];
        rhs = '__uint_as_float(' + bits + 'u)';
        break;
      }
      case 'shape':
        rhs = '__ll2float_rn(' + dims.get(e.name) + ')';
        break;
      case 'op': {
        const args = e.args.map(scalar);
        rhs = e.op === 'neg' ? '-' + args[0] : ops[e.op] + '(' + args.join(', ') + ')';
        break;
      }
      case 'load': {
        const n = number(e.name);
        const offset = e.indices.reduce(
          (off, a, i) =>
            '(' + off + ' * ' + affine(tensors[n].shape[i], dims) + ' + ' + affine(a, axes) + ')',
          '0LL',
        );
        rhs = 't' + n + '[' + offset + ']';
      }
    }
    line('float ' + v + ' = ' + rhs + ';');
    return v;
  }
  line('long long flat = (long long)blockIdx.x * blockDim.x + threadIdx.x;');
  line('if (flat >= count) return;');
  line('long long coord = flat;');
  for (const axis of [...stmt.axes].reverse()) {
    const v = fresh(),
      n = extent(axis.extent);
    axes.set(axis.id, v);
    line('long long ' + v + ' = coord % ' + n + '; coord /= ' + n + ';');
  }
  const rhs = scalar(stmt.expr);
  line('out[flat] = ' + rhs + ';');
  lines.push('}');
  const n = 't' + result + '.count';
  const actual = [n, 't' + result + '.device', ...[...reads].map(i => 't' + i + '.device'), ...dims.values()];
  return {
    code: lines.join('\n'),
    launch:
      'if (' + n + ') kernel' + index + '<<<(' + n + ' + 255) / 256, 256>>>(' + actual.join(', ') + ');',
  };
}

const runtime = `#include <cuda_runtime.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <vector>
#include <algorithm>
#include <string>

#define CUDA(call) do { cudaError_t err = (call); if (err != cudaSuccess) { \\
  fprintf(stderr, "%s: %s\\n", #call, cudaGetErrorString(err)); exit(2); } } while (0)
__device__ float jsmin(float a, float b) {
  if (isnan(a) || isnan(b)) return NAN;
  if (a == 0 && b == 0) return __uint_as_float(__float_as_uint(a) | __float_as_uint(b));
  return fminf(a,b);
}
__device__ float jsmax(float a, float b) {
  if (isnan(a) || isnan(b)) return NAN;
  if (a == 0 && b == 0) return __uint_as_float(__float_as_uint(a) & __float_as_uint(b));
  return fmaxf(a,b);
}
template<class T> void readItems(FILE *f, T *p, size_t n) {
  if (n && fread(p, sizeof(T), n, f) != n) { perror("read"); exit(3); }
}
template<class T> void writeItems(FILE *f, const T *p, size_t n) {
  if (n && fwrite(p, sizeof(T), n, f) != n) { perror("write"); exit(3); }
}
struct Tensor {
  std::vector<long long> shape;
  long long count = 1;
  float *device = nullptr;
  explicit Tensor(std::vector<long long> dims) : shape(dims) {
    for (auto d : dims) count *= d;
    if (count) CUDA(cudaMalloc(&device, count * sizeof(float)));
  }
  ~Tensor() { if (device) CUDA(cudaFree(device)); }
  void load(FILE *f) {
    std::vector<float> data(count);
    readItems(f, data.data(), count);
    if (count) CUDA(cudaMemcpy(device, data.data(), count*sizeof(float), cudaMemcpyHostToDevice));
  }
  void save(FILE *f) {
    uint32_t rank = shape.size();
    writeItems(f, &rank, 1);
    writeItems(f, shape.data(), rank);
    std::vector<float> data(count);
    if (count) CUDA(cudaMemcpy(data.data(), device, count*sizeof(float), cudaMemcpyDeviceToHost));
    writeItems(f, data.data(), count);
  }
};
std::vector<long long> readShape(FILE *f) {
  uint32_t rank;
  readItems(f, &rank, 1);
  std::vector<long long> dims(rank);
  readItems(f, dims.data(), rank);
  return dims;
}`;

export function emit(fn: Fn): string {
  const dims = new Map<string, string>();
  const setup: string[] = [];
  fn.params.forEach((p, i) => {
    setup.push('Tensor t' + i + '(readShape(in)); t' + i + '.load(in);');
    p.shape.forEach((a, j) => {
      const name = plain(a);
      if (name && !dims.has(name)) {
        const id = 's' + dims.size;
        dims.set(name, id);
        setup.push('long long ' + id + ' = t' + i + '.shape[' + j + '];');
      }
    });
  });
  const kernels = fn.statements.map((s, i) => {
    setup.push(
      'Tensor t' + (fn.params.length + i) + '({' + s.shape.map(a => affine(a, dims)).join(', ') + '});',
    );
    return kernel(fn, s, i, dims);
  });
  const result = [...fn.params, ...fn.statements].findIndex(t => t.name === fn.result);
  const hasWork =
    fn.statements.map((_, i) => 't' + (fn.params.length + i) + '.count').join(' || ') || 'false';
  return `${runtime}
${kernels.map(k => k.code).join('\n')}
int main(int argc, char **argv) {
  FILE *in = fopen("inputs.bin", "rb"), *out = fopen("out/results.bin", "wb");
  if (!in || !out) { perror("case files"); return 3; }
  uint32_t cases;
  readItems(in, &cases, 1);
  writeItems(out, &cases, 1);
  cudaFuncAttributes attr;
  ${kernels.map((_, i) => 'CUDA(cudaFuncGetAttributes(&attr, kernel' + i + '));').join('\n  ')}
  cudaEvent_t start, stop;
  CUDA(cudaEventCreate(&start));
  CUDA(cudaEventCreate(&stop));
  bool benchmark = argc == 2 && std::string(argv[1]) == "--benchmark";
  for (uint32_t c = 0; c < cases; ++c) {
    ${setup.join('\n    ')}
    float elapsed[3] = {};
    if (${hasWork}) {
      for (int rep = benchmark ? -1 : 0; rep < (benchmark ? 3 : 1); ++rep) {
        CUDA(cudaEventRecord(start));
        ${kernels.map(k => k.launch).join('\n        ')}
        CUDA(cudaEventRecord(stop));
        CUDA(cudaGetLastError());
        CUDA(cudaEventSynchronize(stop));
        if (rep >= 0) CUDA(cudaEventElapsedTime(&elapsed[rep],start,stop));
      }
    }
    t${result}.save(out);
    std::sort(elapsed, elapsed + (benchmark ? 3 : 1));
    writeItems(out, &elapsed[benchmark ? 1 : 0], 1);
  }
  CUDA(cudaEventDestroy(start));
  CUDA(cudaEventDestroy(stop));
  fclose(in);
  return fclose(out) != 0;
}
`;
}
export function cudaSource(program: TixProgram, fn: string): string {
  return emit(selected(program.current, fn));
}
