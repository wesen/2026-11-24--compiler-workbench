// IRWB-033-D script 07: the report's tables from scripts 05 and 06 (and 03 --variants).
import { readFileSync, existsSync } from 'node:fs';
const read = f => (existsSync(new URL(f, import.meta.url)) ? readFileSync(new URL(f, import.meta.url), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const corpus = read('./06-final-corpus.out.jsonl'),
  contractions = read('./06-final-contractions.out.jsonl'),
  variants = read('./03-variants.out.jsonl'),
  cost = read('./05-check-cases-and-schedule-cost.out.jsonl');
const f = x => (x === undefined ? '' : x.toFixed(4));
const cublas = { 'matmul-512': 0.0329, 'attention-score': 0.0177, 'attention-out': 0.0216, 'mlp-h': 0.0423, 'mlp-y': 0.0475 };
const flops = r => {
  const s = r.shapes;
  if (s.a) return 2 * s.a[0] * s.a[1] * s.b[1];
  if (r.name === 'attention-score') return 2 * s.q[0] * s.k[0] * s.q[1];
  if (r.name === 'attention-out') return 2 * s.w[0] * s.w[1] * s.v[1];
  if (r.name === 'mlp-h') return 2 * s.x[0] * s.x[1] * s.w[1];
  if (r.name === 'mlp-y') return 2 * s.g[0] * s.g[1] * s.v[1];
  if (r.name === 'conv2d') return 2 * s.x[0] * 32 * 62 * 62 * 16 * 9;
};
console.log('| Program | Kernels | Fused ms (5 calls) | Unfused ms | Base fused ms | Fused / base | Fused / unfused | Identical |');
console.log('| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |');
for (const r of corpus)
  console.log(`| ${r.name} | ${r.kernels} | **${f(r.fused.median)}** (${r.fused.calls.join(', ')}) | ${f(r.unfused.median)} | ${f(r.base?.median)} | ${(r.fused.median / r.base.median).toFixed(2)} | ${(r.fused.median / r.unfused.median).toFixed(2)} | ${r.identical ? 'yes' : 'NO'} |`);
console.log('\n| Contraction | Fused ms | TFLOP/s fused | Unfused ms | TFLOP/s unfused | Fused / cuBLAS | Identical |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
for (const r of [...corpus.filter(r => ['matmul-512', 'conv2d'].includes(r.name)), ...contractions.filter(r => !/^matmul-\d+x/.test(r.name))]) {
  const t = flops(r) / 1e9;
  console.log(`| ${r.name} | **${f(r.fused.median)}** | ${(t / r.fused.median).toFixed(2)} | ${f(r.unfused.median)} | ${(t / r.unfused.median).toFixed(2)} | ${cublas[r.name] ? (r.fused.median / cublas[r.name]).toFixed(2) : r.name === 'matmul-4096' ? `${(19.2 / (t / r.fused.median)).toFixed(2)} (19.2 TFLOP/s)` : ''} | ${r.identical ? 'yes' : 'NO'} |`);
}
console.log('\n| Other shape (M x N x K) | Fused ms | Unfused ms | Fused / unfused | Identical |');
console.log('| --- | ---: | ---: | ---: | --- |');
for (const r of contractions.filter(r => /^matmul-\d+x/.test(r.name)))
  console.log(`| ${r.name.slice(7)} | ${f(r.fused.median)} | ${f(r.unfused.median)} | ${(r.fused.median / r.unfused.median).toFixed(2)} | ${r.identical ? 'yes' : 'NO'} |`);
console.log('\n| Contraction | v0 one thread per output | v1 128×64 / 8×4 | v2 32×32 / 4×4 | v3 32×32 / 2×2 |');
console.log('| --- | ---: | ---: | ---: | ---: |');
for (const r of variants) console.log(`| ${r.name} | ${['v0', 'v1', 'v2', 'v3'].map(v => f(r[v]?.median)).join(' | ')} |`);
console.log('\n| Program | Samples | Cases fused | Cases unfused | Pass applications | Scheduling ms (first) |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
for (const r of cost) console.log(`| ${r.name} | ${r.samples} | ${r.casesFused} | ${r.casesUnfused} | ${r.passApplications} | ${r.scheduleMs} |`);
