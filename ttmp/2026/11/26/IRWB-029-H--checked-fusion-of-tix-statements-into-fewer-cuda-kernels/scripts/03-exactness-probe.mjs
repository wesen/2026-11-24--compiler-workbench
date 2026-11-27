// Probe 03: is the fused lowering exact? Runs checkLowering (the GPU contract, exact relation) on the corpus and
// on small programs chosen to hit the plan's edges, fused and unfused, and prints the verdicts and their wall time.
//
// Run from the worktree root after `npm run build`:
//   node ttmp/2026/11/26/IRWB-029-H--*/scripts/03-exactness-probe.mjs [--programs]
import { readFileSync } from 'node:fs';

const { checkLowering, compileTix, optimizeTix } = await import(
  new URL('dist/tensor/index.js', `file://${process.cwd()}/`)
);
const only = process.argv.includes('--programs');

// Small programs that exercise the plan's edges rather than the corpus's shapes.
const programs = {
  shadow: 'fn f(x:f32[N,K], z:f32[N,L]):f32[N]{a[i]=sum(j) x[i,j];b[i]=sum(j) z[i,j];y[i]=a[i]+b[i];return y;}',
  'two-row-reductions':
    'fn f(x:f32[N,K]):f32[N,K]{m[i]=max(j) x[i,j];s[i]=sum(j) exp(x[i,j]-m[i]);y[i,j]=exp(x[i,j]-m[i])/s[i];return y;}',
  'row-then-contraction':
    'fn f(x:f32[N,K], v:f32[K,O]):f32[N,O]{s[i]=sum(j) x[i,j];y[i,o]=sum(k) (x[i,k]-s[i])*v[k,o];return y;}',
  'permuted-pointwise': 'fn f(x:f32[N,N]):f32[N,N]{p[i,j]=x[j,i]*2;q[i,j]=p[j,i]+1;return q;}',
  'permuted-staged': 'fn f(x:f32[N,K]):f32[N,N]{s[i,j]=sum(k) x[i,k]*x[j,k];t[i,j]=s[j,i]+1;return t;}',
  'epilogue-after-contraction':
    'fn f(x:f32[N,K], w:f32[K,H]):f32[N,H]{h[i,j]=sum(k) x[i,k]*w[k,j];g[i,j]=h[i,j]*h[i,j];return g;}',
  'empty-extent': 'fn f(x:f32[N,K]):f32[N]{m[i]=max(j) x[i,j];s[i]=sum(j) exp(x[i,j]-m[i]);return s;}',
  'rank-three': 'fn f(x:f32[N,K,L]):f32[N,K]{y[i,j]=sum(k) sum(l) x[i,j,l]*x[i,k,l];return y;}',
  'rank-one-chain': 'fn f(x:f32[N,K]):f32[N]{a[i]=sum(j) x[i,j];b[i]=a[i]*2;c[i]=b[i]+a[i];return c;}',
  'three-reductions':
    'fn f(x:f32[N,K]):f32[N]{a[i]=sum(j) x[i,j];b[i]=max(j) x[i,j];c[i]=sum(j) x[i,j]*x[i,j];y[i]=(c[i]/K-a[i]*a[i])/(b[i]+1);return y;}',
  'pointwise-after-fold':
    'fn f(x:f32[N,K]):f32[N,K]{s[i]=sum(j) x[i,j];y[i,j]=x[i,j]/s[i]+s[i];return y;}',
  'signed-zero':
    'fn f(x:f32[N,K]):f32[N]{m[i]=max(j) x[i,j];n[i]=max(j) (0-x[i,j]);y[i]=m[i]-n[i];return y;}',
  'nan-and-domain': 'fn f(x:f32[N,K]):f32[N]{s[i]=sum(j) sqrt(x[i,j]-1);y[i]=s[i]/0;return y;}',
  'nested-reduction': 'fn f(x:f32[N,K]):f32[N]{y[i]=sum(j) (x[i,j]*(sum(k) x[i,k]));return y;}',
  'reduction-chain': 'fn f(x:f32[N,K,L]):f32[N]{s[i,j]=sum(l) x[i,j,l];y[i]=sum(j) s[i,j]*2;return y;}',
  'dead-statement':
    'fn f(x:f32[N,K]):f32[N]{d[i,j]=x[i,j]*0;s[i]=sum(j) x[i,j];y[i]=s[i]+1;return y;}',
  'fold-with-tail': 'fn f(x:f32[N,K]):f32[N]{s[i]=sum(j) x[i,j];t[i]=s[i]*s[i];return t;}',
};

const rows = [];
async function check(label, program, fn) {
  for (const fuse of [true, false]) {
    const started = process.hrtime.bigint();
    const verdict = await checkLowering(program, fn, { fuse });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    rows.push({ label, fuse, ...verdict, ms: Math.round(ms) });
    console.log(
      `${label.padEnd(22)} fuse=${String(fuse).padEnd(5)} ${verdict.accepted ? 'accepted' : 'REJECTED'} ${verdict.relation} ${Math.round(ms)} ms${verdict.reason ? ' ' + verdict.reason : ''}`,
    );
  }
}
if (!only)
  for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
    const source = readFileSync('corpus/tensor/' + name + '/main.tix', 'utf8');
    const plain = compileTix(source);
    await check(name, plain, name);
    const optimized = optimizeTix(plain, ['inline', 'split-sum']).program;
    await check(name + '/optimized', optimized, name);
  }
for (const [label, source] of Object.entries(programs)) await check(label, compileTix(source), 'f');
const rejected = rows.filter(r => !r.accepted);
console.log(JSON.stringify({ checks: rows.length, rejected, medianMs: rows.map(r => r.ms).sort((a, b) => a - b)[rows.length >> 1] }));
process.exitCode = rejected.length ? 1 : 0;
