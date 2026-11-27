// IRWB-033-E script 06: checkLowering (exact, every tile configuration and gate side forced) on the corpus, as
// written and after inline + split-sum, fused and unfused, and on contraction variants; with the wall time of
// each check. node 06-check-programs.mjs [--quick]  (--quick: fused only; the variants only as written)
import { readFileSync } from 'node:fs';
import { checkLowering, compileTix, cudaSource, optimizeTix } from '../../../../../../dist/tensor/index.js';
import { sidesOf } from '../../../../../../dist/tensor/cuda-contract.js';
const root = new URL('../../../../../../', import.meta.url);
const variants = compileTix(`
  fn batched(a:f32[B,M,K], b:f32[B,K,N]):f32[B,M,N] { y[t,i,j] = sum(k) a[t,i,k] * b[t,k,j]; return y; }
  fn transposed(a:f32[M,K], b:f32[N,K], c:f32[N]):f32[M,N] { y[i,j] = (sum(k) (a[i,k] - 1) * b[j,k]) / sqrt(K) + c[j]; z[i,j] = y[i,j] * 2; return z; }
  fn twoterms(a:f32[M,K,L], b:f32[K,L,N]):f32[M,N] { y[i,j] = sum(k,l) a[i,k,l] * b[k,l,j]; return y; }
  fn gram(a:f32[M,K]):f32[M,M] { y[i,j] = sum(k) a[i,k] * a[j,k]; return y; }
  fn chain(a:f32[M,K], b:f32[K,N], c:f32[N,P]):f32[M,P] { t[i,j] = sum(k) a[i,k] * b[k,j]; y[i,p] = sum(j) t[i,j] * c[j,p]; return y; }
  fn attention_inside(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
    score[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
    shift[i] = max(j) score[i,j];
    e[i,j] = exp(score[i,j] - shift[i]);
    z[i] = sum(j) e[i,j];
    out[i,c] = sum(j) e[i,j] / z[i] * v[j,c];
    return out;
  }
  fn matvec(a:f32[M,K], x:f32[K]):f32[M] { y[i] = sum(k) a[i,k] * x[k]; return y; }
`);
const quick = process.argv.includes('--quick');
const programs = [
  ...['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'].map(name => [
    name,
    compileTix(readFileSync(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8')),
  ]),
  ...variants.current.value.functions.map(f => [f.name, variants]),
];
for (const [name, written] of programs)
  for (const [form, program] of [
    ['written', written],
    ['inline+split', optimizeTix(written, ['inline', 'split-sum']).program],
  ])
    for (const fuse of quick ? [true] : [true, false]) {
      if (quick && form !== 'written' && written === variants) continue;
      const source = cudaSource(program, name, { fuse });
      const t0 = performance.now();
      const verdict = await checkLowering(program, name, { fuse });
      console.log(
        JSON.stringify({
          name,
          form,
          fuse,
          ...verdict,
          wallMs: Math.round(performance.now() - t0),
          sides: sidesOf(source).length,
          definitions: (source.match(/__global__ void/g) ?? []).length,
        }),
      );
    }
