import type { TixProgram } from './index.js';
import { plain, width, type Affine, type Expr, type Fn, type Op } from './model.js';
import { runtime } from './cuda-runtime.js';

export function selectFn(program: TixProgram['current'], name: string): Fn {
  const fn = program.value.functions.find(f => f.name === name);
  if (!fn) throw Error('Unknown function ' + name);
  return fn;
}
const arithmetic: Record<Exclude<Op, 'neg'>, string> = {
  '+': '__fadd_rn',
  '-': '__fsub_rn',
  '*': '__fmul_rn',
  '/': '__fdiv_rn',
  max: 'maximum',
  min: 'minimum',
  sqrt: 'sqrtf',
  log: 'logf',
  tanh: 'tanhf',
  exp: 'expf',
};
function affine(a: Affine, env: Map<string, string>) {
  return '(' + [a.constant + 'LL', ...a.terms.map(([id, k]) => `${k}LL*${env.get(id)!}`)].join(' + ') + ')';
}
function literal(s: string) {
  const bits = new Uint32Array(Float32Array.of(Number(s)).buffer)[0];
  return `__uint_as_float(0x${bits.toString(16)}u)`;
}

export function cudaSource(program: TixProgram, name: string): string {
  const fn = selectFn(program.current, name);
  const tensors = [...fn.params, ...fn.statements];
  const tensorId = new Map(tensors.map((t, i) => [t.name, i]));
  const symbols = new Map<string, string>();
  const host: string[] = ['Shapes s{};'];
  fn.params.forEach((p, i) => {
    host.push(`Tensor t${i}(in,${p.shape.length});`);
    p.shape.forEach((d, j) => {
      const n = plain(d);
      if (n && !symbols.has(n)) {
        const field = `s.d${symbols.size}`;
        symbols.set(n, field);
        host.push(`${field}=t${i}.dims[${j}];`);
      }
    });
  });
  const dim = (d: Affine) => affine(d, symbols);
  fn.params.forEach((p, i) =>
    p.shape.forEach((d, j) => host.push(`if(t${i}.dims[${j}]!=${dim(d)}) fail("shape mismatch");`)),
  );
  const source = [runtime, `struct Shapes { ${[...symbols.keys()].map((_, i) => `I d${i};`).join(' ')} };`];
  const launch: string[] = [];
  for (const [si, st] of fn.statements.entries()) {
    const id = tensorId.get(st.name)!;
    host.push(`Tensor t${id}({${st.shape.map(dim).join(',')}});`);
    const lines = ['I t=I(blockIdx.x)*blockDim.x+threadIdx.x;', 'if(t>=count) return;', 'I rem=t;'];
    const axes = new Map<string, string>(),
      reads = new Set<number>();
    let next = 0;
    for (let j = st.axes.length - 1; j >= 0; j--) {
      const ix = `i${next++}`,
        d = dim(st.shape[j]);
      axes.set(st.axes[j].id, ix);
      // A zero-count statement never launches; keep even constant-zero divisions out of the TU.
      lines.push(`I ${ix}=rem%max(1LL,${d}); rem/=max(1LL,${d});`);
    }
    function scalar(e: Expr): string {
      const v = `v${next++}`;
      let rhs: string;
      switch (e.kind) {
        case 'literal':
          rhs = literal(e.text);
          break;
        case 'shape':
          rhs = `__ll2float_rn(${symbols.get(e.name)!})`;
          break;
        case 'load': {
          const read = tensorId.get(e.name)!;
          reads.add(read);
          let offset = '0LL';
          e.indices.forEach((ix, j) => {
            const extent = dim(tensors[read].shape[j]);
            offset = `(${offset}*${extent}+index_at(${affine(ix, axes)},${extent}))`;
          });
          rhs = `p${read}[${offset}]`;
          break;
        }
        case 'op': {
          const args = e.args.map(scalar);
          rhs = e.op === 'neg' ? `-${args[0]}` : `${arithmetic[e.op]}(${args.join(',')})`;
          break;
        }
        case 'reduce': {
          lines.push(`float ${v}=${e.op === 'sum' ? '+0.0f' : '-INFINITY'};`);
          for (const { id, extent } of e.axes) {
            const ix = `i${next++}`,
              d = dim(extent.dim);
            const bound =
              extent.kind === 'blocks'
                ? `(${d}/${width} + ${extent.rounding === 'ceil' ? `(${d}%${width}!=0)` : '0'})`
                : extent.kind === 'tail'
                  ? `min(${width}LL,${d}-${width}*${axes.get(extent.block)!})`
                  : d;
            axes.set(id, ix);
            lines.push(`for(I ${ix}=0;${ix}<${bound};++${ix}) {`);
          }
          const x = scalar(e.body);
          lines.push(`${v}=${e.op === 'sum' ? '__fadd_rn' : 'maximum'}(${v},${x});`);
          for (const a of e.axes) {
            axes.delete(a.id);
            lines.push('}');
          }
          return v;
        }
      }
      lines.push(`float ${v}=${rhs};`);
      return v;
    }
    const result = scalar(st.expr);
    lines.push(`out[t]=${result};`);
    const args = [...reads].map(i => `const float* p${i}`);
    source.push(
      `__global__ void k${si}(${['Shapes s', 'I count', ...args, 'float* out'].join(', ')}) {\n  ${lines.join('\n  ')}\n}`,
    );
    const passed = ['s', `t${id}.count`, ...[...reads].map(i => `t${i}.ptr`), `t${id}.ptr`];
    host.push(`if((t${id}.count+127)/128>INT32_MAX) fail("grid capacity");`);
    launch.push(
      `if(t${id}.count){ k${si}<<<unsigned((t${id}.count+127)/128),128>>>(${passed.join(',')}); ck(cudaGetLastError()); }`,
    );
  }
  const any = fn.statements.map(s => `t${tensorId.get(s.name)}.count`).join(' || ') || 'false';
  source.push(`void one(FILE* in,FILE* out,cudaEvent_t start,cudaEvent_t stop) {
  ${host.join('\n  ')}
  auto launch=[&](){ ${launch.join('\n    ')} };
  float ms=0;
  if(${any}) {
    launch(); ck(cudaDeviceSynchronize()); // context, module load and first launch outside interval
    ck(cudaEventRecord(start)); launch(); ck(cudaEventRecord(stop));
    ck(cudaEventSynchronize(stop)); ck(cudaEventElapsedTime(&ms,start,stop));
  }
  t${tensorId.get(fn.result)}.write(out,ms);
}
int main() {
  FILE* in=fopen("input.bin","rb"); FILE* out=fopen("out/result.bin","wb");
  if(!in || !out || get<U>(in)!=0x31495854u) fail("input header");
  U count=get<U>(in); put(out,0x314f5854u); put(out,count);
  cudaDeviceProp p{}; int driver,rt;
  ck(cudaGetDeviceProperties(&p,0)); ck(cudaDriverGetVersion(&driver)); ck(cudaRuntimeGetVersion(&rt));
  printf("%s sm_%d%d driver %d runtime %d\\n",p.name,p.major,p.minor,driver,rt);
  cudaEvent_t a,b; ck(cudaEventCreate(&a)); ck(cudaEventCreate(&b));
  for(U i=0;i<count;i++){ if(get<U>(in)!=i) fail("case order"); put(out,i); one(in,out,a,b); }
  if(fgetc(in)!=EOF || fclose(out)) fail("batch framing"); fclose(in);
  ck(cudaEventDestroy(a)); ck(cudaEventDestroy(b)); return 0;
}`);
  return source.join('\n') + '\n';
}
