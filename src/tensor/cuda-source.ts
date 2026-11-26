import type { TixProgram } from './index.js';
import {
  plain,
  width,
  type Affine,
  type Expr,
  type Extent,
  type Fn,
  type Module,
  type Statement,
} from './model.js';
import { cudaRuntime } from './cuda-runtime.js';

export function functionNamed(module: Module, name: string): Fn {
  const fn = module.functions.find(f => f.name === name);
  if (!fn) throw Error('Unknown function ' + name);
  return fn;
}

const ops = {
  '+': '__fadd_rn',
  '-': '__fsub_rn',
  '*': '__fmul_rn',
  '/': '__fdiv_rn',
  neg: '-',
  exp: 'expf',
  log: 'logf',
  sqrt: '__fsqrt_rn',
  tanh: 'tanhf',
  min: 'tix_min',
  max: 'tix_max',
};

function affine(a: Affine, name: (id: string) => string): string {
  const terms = a.terms.map(([id, k]) => (k === 1 ? name(id) : `(${k}LL * ${name(id)})`));
  if (a.constant || !terms.length) terms.unshift(a.constant + 'LL');
  return terms.length === 1 ? terms[0] : '(' + terms.join(' + ') + ')';
}

export function emitCuda(fn: Fn): string {
  const tensors = [...fn.params, ...fn.statements];
  const slots = new Map(tensors.map((t, i) => [t.name, i]));
  const symbols = new Map<string, { id: string; binding: string }>();
  fn.params.forEach((p, i) =>
    p.shape.forEach((a, j) => {
      const n = plain(a);
      if (n && !symbols.has(n)) symbols.set(n, { id: 's' + symbols.size, binding: `t${i}.shape[${j}]` });
    }),
  );
  const symbol = (n: string) => symbols.get(n)!.id;
  const dim = (a: Affine) => affine(a, symbol);
  const shape = (dims: Affine[]) => '{' + dims.map(dim).join(', ') + '}';
  const kernels: string[] = [],
    launches: string[] = [],
    preloads: string[] = [];

  function kernel(s: Statement, number: number) {
    const output = slots.get(s.name)!;
    const reads = new Set<number>();
    const shapeArgs = new Set<string>();
    const kernelSymbol = (name: string) => {
      const id = symbol(name);
      shapeArgs.add(id);
      return id;
    };
    const kernelDim = (a: Affine) => affine(a, kernelSymbol);
    const lines: string[] = [];
    let depth = 1,
      next = 0;
    const line = (code: string) => lines.push('  '.repeat(depth) + code);
    const binders = new Map<string, string>();
    const binder = (id: string) => {
      if (!binders.has(id)) binders.set(id, 'i' + binders.size);
      return binders.get(id)!;
    };
    const bound = (e: Extent): string => {
      const n = kernelDim(e.dim);
      if (e.kind === 'blocks')
        return e.rounding === 'ceil' ? `((${n} + ${width - 1}LL) / ${width}LL)` : `(${n} / ${width}LL)`;
      if (e.kind === 'tail') return `min(${width}LL, ${n} - ${width}LL * ${binder(e.block)})`;
      return n;
    };
    function scalar(e: Expr): string {
      const t = 'v' + next++;
      switch (e.kind) {
        case 'literal': {
          const bits = new Uint32Array(Float32Array.of(Number(e.text)).buffer)[0];
          return `__uint_as_float(0x${bits.toString(16)}u)`;
        }
        case 'shape':
          return `__ll2float_rn(${kernelSymbol(e.name)})`;
        case 'load': {
          const slot = slots.get(e.name)!;
          reads.add(slot);
          // Horner's rule for the row-major offset.
          const offset = e.indices
            .map(a => affine(a, binder))
            .reduce((off, ix, j) => `(${off} * ${kernelDim(tensors[slot].shape[j])} + ${ix})`);
          return `p${slot}[${offset}]`;
        }
        case 'op': {
          const args = e.args.map(scalar);
          line(`float ${t} = ${ops[e.op]}(${args.join(', ')});`);
          break;
        }
        case 'reduce': {
          line(`float ${t} = ${e.op === 'sum' ? '0.0f' : '-INFINITY'};`);
          for (const a of e.axes) {
            const i = binder(a.id);
            line(`for (long long ${i} = 0; ${i} < ${bound(a.extent)}; ++${i}) {`);
            depth++;
          }
          const body = scalar(e.body);
          line(`${t} = ${e.op === 'sum' ? '__fadd_rn' : 'tix_max'}(${t}, ${body});`);
          for (const _ of e.axes) {
            depth--;
            line('}');
          }
          break;
        }
      }
      return t;
    }
    line('long long offset = (long long)blockIdx.x * blockDim.x + threadIdx.x;');
    line('if (offset >= count) return;');
    line('long long rem = offset;');
    for (let j = s.axes.length - 1; j >= 0; j--) {
      line(`long long ${binder(s.axes[j].id)} = rem % ${kernelDim(s.shape[j])};`);
      if (j) line(`rem /= ${kernelDim(s.shape[j])};`);
    }
    const rhs = scalar(s.expr);
    line(`out[offset] = ${rhs};`);
    lines.push('}');
    const params = ['long long count', 'float *out'];
    const args = [`t${output}.count`, `t${output}.device`];
    for (const i of reads) {
      params.push(`const float *p${i}`);
      args.push(`t${i}.device`);
    }
    for (const id of shapeArgs) {
      params.push('long long ' + id);
      args.push(id);
    }
    lines.unshift(`__global__ void kernel_${number}(${params.join(', ')}) {`);
    kernels.push(lines.join('\n'));
    preloads.push(`  CUDA(cudaFuncGetAttributes(&attr, kernel_${number}));`);
    launches.push(`    if (t${output}.count) {
      kernel_${number}<<<(t${output}.count + 255) / 256, 256>>>(${args.join(', ')});
      CUDA(cudaGetLastError());
      launched = true;
    }`);
  }
  fn.statements.forEach(kernel);

  const setup = [
    ...fn.params.map((p, i) => `    Tensor t${i}(read_shape(in, ${p.shape.length})); t${i}.upload(in);`),
    ...[...symbols.values()].map(s => `    long long ${s.id} = ${s.binding};`),
    ...fn.params.map(
      (p, i) =>
        `    if (t${i}.shape != Shape${shape(p.shape)}) throw std::runtime_error("input shape mismatch");`,
    ),
    ...fn.statements.map(s => `    Tensor t${slots.get(s.name)}(Shape${shape(s.shape)});`),
  ];
  return `${cudaRuntime}
${kernels.join('\n\n')}

int main() try {
  std::ifstream in("in.bin", std::ios::binary);
  std::ofstream out("out/results.bin", std::ios::binary);
  in.exceptions(std::ios::failbit | std::ios::badbit);
  out.exceptions(std::ios::failbit | std::ios::badbit);
  cudaDeviceProp prop;
  int runtime;
  CUDA(cudaGetDeviceProperties(&prop, 0));
  CUDA(cudaRuntimeGetVersion(&runtime));
  std::cout << prop.name << '\\n' << prop.major << ' ' << prop.minor << ' ' << runtime << '\\n';
  cudaFuncAttributes attr;
${preloads.join('\n')}
  cudaEvent_t start, stop;
  CUDA(cudaEventCreate(&start));
  CUDA(cudaEventCreate(&stop));
  uint32_t count;
  in.read((char*)&count, sizeof(count));
  out.write((char*)&count, sizeof(count));
  for (uint32_t c = 0; c < count; ++c) {
${setup.join('\n')}
    CUDA(cudaDeviceSynchronize());
    bool launched = false;
    CUDA(cudaEventRecord(start));
${launches.join('\n')}
    CUDA(cudaEventRecord(stop));
    CUDA(cudaEventSynchronize(stop));
    float ms = 0;
    if (launched) CUDA(cudaEventElapsedTime(&ms, start, stop));
    t${slots.get(fn.result)}.download(out);
    double elapsed = ms;
    out.write((char*)&elapsed, sizeof(elapsed));
  }
  out.close();
  CUDA(cudaEventDestroy(start));
  CUDA(cudaEventDestroy(stop));
  return 0;
} catch (const std::exception &e) {
  std::cerr << e.what() << '\\n';
  return 1;
}
`;
}

export function cudaSource(program: TixProgram, fn: string): string {
  return emitCuda(functionNamed(program.current.value, fn));
}
