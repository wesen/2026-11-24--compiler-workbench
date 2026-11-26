import type { TixProgram } from './index.js';
import { plain, visit, width, type Affine, type Expr, type Fn } from './model.js';

export function selected(p: TixProgram, name: string) {
  const fn = p.current.value.functions.find(f => f.name === name);
  if (!fn) throw Error('Unknown function ' + name);
  return fn;
}
export function cudaSource(program: TixProgram, fn: string): string {
  return emitCuda(selected(program, fn));
}
const runtime = `#include <cuda_runtime.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
using I = long long;
void require(bool ok){ if(!ok){fprintf(stderr,"invalid tensor packet\\n");exit(1);} }
void ck(cudaError_t e){if(e!=cudaSuccess){fprintf(stderr,"CUDA: %s\\n",cudaGetErrorString(e));exit(2);}}
template<class T> T read1(FILE*f){T n;require(fread(&n,sizeof(n),1,f)==1);return n;}
template<class T> void put(FILE*f,T n){require(fwrite(&n,sizeof(n),1,f)==1);}
struct Tensor {
  std::vector<float> host; float* ptr=nullptr;
  Tensor(I n):host(n){if(n)ck(cudaMalloc(&ptr,n*sizeof(float)));}
  ~Tensor(){if(ptr)ck(cudaFree(ptr));}
  void load(FILE*f){if(!host.empty()){require(fread(host.data(),4,host.size(),f)==host.size());ck(cudaMemcpy(ptr,host.data(),4*host.size(),cudaMemcpyHostToDevice));}}
  void save(FILE*f){if(!host.empty()){ck(cudaMemcpy(host.data(),ptr,4*host.size(),cudaMemcpyDeviceToHost));require(fwrite(host.data(),4,host.size(),f)==host.size());}}
};
__device__ float mx(float a,float b){return isnan(a)||isnan(b)?NAN:fmaxf(a,b);}
__device__ float mn(float a,float b){return isnan(a)||isnan(b)?NAN:fminf(a,b);}
`;
export function emitCuda(fn: Fn): string {
  const tensors = [...fn.params, ...fn.statements];
  const tensor = (name: string) => 't' + tensors.findIndex(t => t.name === name);
  const shapeIds = new Map<string, string>();
  const setup: string[] = [],
    launch: string[] = [],
    loads: string[] = [],
    kernels: string[] = [];
  const form = (a: Affine, env: Map<string, string>) =>
    '(' + [String(a.constant) + 'LL', ...a.terms.map(([id, c]) => `${c}LL*${env.get(id)!}`)].join('+') + ')';
  for (const [p, param] of fn.params.entries()) {
    const dims = param.shape.map((a, i) => {
      const d = `d${p}_${i}`;
      setup.push(`I ${d}=read1<I>(in); require(${d}>=0);`);
      const sym = plain(a);
      if (sym && !shapeIds.has(sym)) shapeIds.set(sym, d);
      return d;
    });
    setup.push(`Tensor t${p}(${dims.join('*')}); t${p}.load(in);`);
  }
  fn.params.forEach((p, j) =>
    p.shape.forEach((a, i) => setup.push(`require(d${j}_${i}==${form(a, shapeIds)});`)),
  );
  for (const [k, s] of fn.statements.entries()) {
    const dims = s.shape.map(a => form(a, shapeIds)),
      n = `n${k}`,
      out = tensor(s.name);
    setup.push(`I ${n}=${dims.join('*')}; Tensor ${out}(${n});`);
    const reads = new Set<string>();
    visit(s.expr, e => {
      if (e.kind === 'load') reads.add(tensor(e.name));
    });
    const pointers = [...reads, out],
      shapes = [...shapeIds.values()];
    const params = [...pointers.map(v => 'float* ' + v), ...shapes.map(v => 'I ' + v), 'I count'];
    const body = ['I at=(I)blockIdx.x*blockDim.x+threadIdx.x; if(at>=count)return;', 'I rem=at;'];
    const env = new Map<string, string>();
    let counter = 0;
    for (let i = s.axes.length - 1; i >= 0; i--) {
      const v = 'i' + counter++;
      env.set(s.axes[i].id, v);
      body.push(`I ${v}=rem%${dims[i]}; rem/=${dims[i]};`);
    }
    function scalar(e: Expr): string {
      const v = 'v' + counter++;
      let rhs: string;
      switch (e.kind) {
        case 'literal': {
          const bits = new Uint32Array(new Float32Array([Number(e.text)]).buffer)[0];
          rhs = `__uint_as_float(${bits}u)`;
          break;
        }
        case 'shape':
          rhs = `__ll2float_rn(${shapeIds.get(e.name)})`;
          break;
        case 'load': {
          const t = tensors.find(t => t.name === e.name)!;
          const offset = e.indices.reduce(
            (off, a, i) => `(${off}*${form(t.shape[i], shapeIds)}+${form(a, env)})`,
            '0LL',
          );
          rhs = `${tensor(e.name)}[${offset}]`;
          break;
        }
        case 'op': {
          const args = e.args.map(scalar);
          const op = {
            '+': '__fadd_rn',
            '-': '__fsub_rn',
            '*': '__fmul_rn',
            '/': '__fdiv_rn',
            neg: '-',
            exp: 'expf',
            log: 'logf',
            sqrt: 'sqrtf',
            tanh: 'tanhf',
            min: 'mn',
            max: 'mx',
          }[e.op];
          rhs = `${op}(${args.join(',')})`;
          break;
        }
        case 'reduce': {
          body.push(`float ${v}=${e.op === 'sum' ? '0.f' : '-INFINITY'};`);
          for (const { id, extent } of e.axes) {
            const d = form(extent.dim, shapeIds);
            let end = d;
            if (extent.kind === 'blocks')
              end = extent.rounding === 'ceil' ? `(${d}/${width}+(${d}%${width}!=0))` : `(${d}/${width})`;
            if (extent.kind === 'tail') end = `min(${width}LL,${d}-${width}LL*${env.get(extent.block)})`;
            const i = 'i' + counter++;
            env.set(id, i);
            body.push(`for(I ${i}=0;${i}<${end};++${i}){`);
          }
          const x = scalar(e.body);
          body.push(`${v}=${e.op === 'sum' ? '__fadd_rn' : 'mx'}(${v},${x});`, ...e.axes.map(() => '}'));
          return v;
        }
      }
      body.push(`float ${v}=${rhs};`);
      return v;
    }
    body.push(`${out}[at]=${scalar(s.expr)};`);
    kernels.push(`__global__ void k${k}(${params.join(',')}){\n${body.join('\n')}\n}`);
    loads.push(`ck(cudaFuncGetAttributes(&attr,k${k}));`);
    launch.push(
      `if(${n}){k${k}<<<(${n}+255)/256,256>>>(${[...pointers.map(v => v + '.ptr'), ...shapes, n].join(',')});ck(cudaGetLastError());}`,
    );
  }
  return `${runtime}${kernels.join('\n')}
int main(int argc,char**argv){
  FILE *in=fopen("input.bin","rb"),*out=fopen("out/result.bin","wb");require(in&&out);
  require(read1<unsigned>(in)==1);unsigned count=read1<unsigned>(in);put(out,1u);put(out,count);
  cudaFuncAttributes attr; ${loads.join('\n')}
  cudaEvent_t start,stop;ck(cudaEventCreate(&start));ck(cudaEventCreate(&stop));
  for(unsigned c=0;c<count;++c){
    ${setup.join('\n')}
    auto run=[&](){${launch.join('\n')}};
    bool bench=argc>1; if(bench)run(); ck(cudaDeviceSynchronize());
    put(out,c);put(out,${fn.shape.length}u);${fn.shape.map(a => `put(out,(I)${form(a, shapeIds)});`).join('')}
    for(int r=0;r<(bench?3:1);++r){ck(cudaEventRecord(start));run();ck(cudaEventRecord(stop));ck(cudaEventSynchronize(stop));float ms;ck(cudaEventElapsedTime(&ms,start,stop));put(out,(${fn.statements.map((_, k) => 'n' + k).join('||') || 'false'})?ms:0.f);}
    ${tensor(fn.result)}.save(out);
  }
  require(fgetc(in)==EOF);require(fclose(out)==0);ck(cudaEventDestroy(start));ck(cudaEventDestroy(stop));return 0;
}\n`;
}
