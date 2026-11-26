import { cudaRuntime } from './cuda-runtime.js';
import { plain, visit, width, type Affine, type Expr, type Fn, type Module, type Op } from './model.js';
import type { TixProgram } from './index.js';

export function named(module: Module, name: string): Fn {
  const fn = module.functions.find(f => f.name === name);
  if (!fn) throw Error('Unknown function ' + name);
  return fn;
}
export const inputMagic = 0x49584954,
  outputMagic = 0x4f584954;
const ops: Record<Exclude<Op, 'neg'>, string> = {
  '+': '__fadd_rn',
  '-': '__fsub_rn',
  '*': '__fmul_rn',
  '/': '__fdiv_rn',
  max: 'mx',
  min: 'mn',
  exp: 'expf',
  log: 'logf',
  tanh: 'tanhf',
  sqrt: '__fsqrt_rn',
};
const affine = (a: Affine, names: Map<string, string>) =>
  `(${a.constant}LL${a.terms.map(([n, k]) => ` + ${k}LL*${names.get(n)!}`).join('')})`;

export function emitCuda(fn: Fn): string {
  const tensors = [...fn.params, ...fn.statements];
  const ids = new Map(tensors.map((t, i) => [t.name, i]));
  const symbols = new Map<string, string>();
  const host: string[] = [],
    launches: string[] = [],
    preload: string[] = [],
    kernels: string[] = [];
  fn.params.forEach((p, i) => {
    host.push(`Tensor t${i}(dims(in,${p.shape.length})); t${i}.read(in);`);
    p.shape.forEach((d, j) => {
      const n = plain(d);
      if (n && !symbols.has(n)) {
        const v = 's' + symbols.size;
        symbols.set(n, v);
        host.push(`I ${v}=t${i}.shape[${j}];`);
      }
    });
  });
  fn.params.forEach((p, i) =>
    p.shape.forEach((d, j) =>
      host.push(`if(t${i}.shape[${j}]!=${affine(d, symbols)}) fail("inconsistent input shape");`),
    ),
  );
  fn.statements.forEach((s, k) => {
    const id = ids.get(s.name)!,
      reads = new Set<number>();
    visit(s.expr, e => {
      if (e.kind === 'load') reads.add(ids.get(e.name)!);
    });
    const dims = s.shape.map(d => affine(d, symbols));
    host.push(`Tensor t${id}({${dims.join(',')}}); auto b${k}=blocks(t${id}.n);`);
    const params = [
      'float *out',
      'I count',
      ...[...symbols.values()].map(n => 'I ' + n),
      ...[...reads].map(i => `const float *t${i}`),
    ];
    const args = [`t${id}.dev`, `t${id}.n`, ...symbols.values(), ...[...reads].map(i => `t${i}.dev`)];
    preload.push(`CK(cudaFuncGetAttributes(&attr,k${k}));`);
    launches.push(`if(b${k}){ k${k}<<<b${k},128>>>(${args.join(',')}); CK(cudaGetLastError()); }`);
    const lines = [
      `__global__ void k${k}(${params.join(',')}) {`,
      'I tid=I(blockIdx.x)*blockDim.x+threadIdx.x; if(tid>=count) return; I q=tid;',
    ];
    const indices = new Map<string, string>();
    for (let j = s.axes.length - 1; j >= 0; j--) {
      const n = 'i' + indices.size;
      indices.set(s.axes[j].id, n);
      lines.push(`I ${n}=q%${dims[j]}; q/=${dims[j]};`);
    }
    let next = 0;
    function scalar(e: Expr): string {
      const tmp = 'v' + next++;
      let rhs: string;
      switch (e.kind) {
        case 'literal': {
          const bits = Buffer.alloc(4);
          bits.writeFloatLE(Math.fround(Number(e.text)));
          rhs = `__uint_as_float(0x${bits.readUInt32LE().toString(16)}u)`;
          break;
        }
        case 'shape':
          rhs = `__ll2float_rn(${symbols.get(e.name)})`;
          break;
        case 'load': {
          const i = ids.get(e.name)!;
          const offset = e.indices.reduce(
            (off, a, j) => `(${off}*${affine(tensors[i].shape[j], symbols)}+${affine(a, indices)})`,
            '0LL',
          );
          rhs = `t${i}[${offset}]`;
          break;
        }
        case 'op': {
          const args = e.args.map(scalar);
          rhs = e.op === 'neg' ? '-' + args[0] : `${ops[e.op]}(${args.join(',')})`;
          break;
        }
        case 'reduce': {
          lines.push(`float ${tmp}=${e.op === 'sum' ? '0.0f' : '-CUDART_INF_F'};`);
          for (const { id, extent } of e.axes) {
            const i = 'r' + next++,
              d = affine(extent.dim, symbols);
            const end =
              extent.kind === 'dim'
                ? d
                : extent.kind === 'tail'
                  ? `min(${width}LL,${d}-${width}LL*${indices.get(extent.block)})`
                  : `(${d}/${width}${extent.rounding === 'ceil' ? `+(${d}%${width}!=0)` : ''})`;
            indices.set(id, i);
            lines.push(`for(I ${i}=0;${i}<${end};++${i}){`);
          }
          const body = scalar(e.body);
          lines.push(
            `${tmp}=${e.op === 'sum' ? '__fadd_rn' : 'mx'}(${tmp},${body});`,
            '}'.repeat(e.axes.length),
          );
          return tmp;
        }
      }
      lines.push(`float ${tmp}=${rhs};`);
      return tmp;
    }
    lines.push(`out[tid]=${scalar(s.expr)};`, '}');
    kernels.push(lines.join('\n'));
  });
  const any = fn.statements.map((_, i) => `b${i}`).join(' || ') || 'false';
  return [
    cudaRuntime,
    ...kernels,
    `int main(int argc,char **argv){
  bool bench=argc==2 && !strcmp(argv[1],"--benchmark"); if(argc!=1 && !bench) fail("unknown arguments");
  FILE *in=fopen("in.bin","rb"), *out=fopen("out/result.bin","wb"); if(!in || !out) fail("batch files");
  if(get<U>(in)!=${inputMagic}u || get<U>(in)!=1) fail("bad input header");
  U count=get<U>(in); put(out,${outputMagic}u); put(out,1u); put(out,count);
  Events events; cudaFuncAttributes attr;
  ${preload.join('\n  ')}
  for(U c=0;c<count;++c){
    put(out,get<U>(in));
    ${host.join('\n    ')}
    CK(cudaDeviceSynchronize());
    double ms=(${any}) ? events.measure([&](){
      ${launches.join('\n      ')}
    },bench) : 0;
    t${ids.get(fn.result)}.write(out,ms);
  }
  if(fgetc(in)!=EOF || ferror(in) || fclose(out)) fail("batch IO"); return 0;
}\n`,
  ].join('\n');
}
export function cudaSource(program: TixProgram, fn: string): string {
  return emitCuda(named(program.current.value, fn));
}
