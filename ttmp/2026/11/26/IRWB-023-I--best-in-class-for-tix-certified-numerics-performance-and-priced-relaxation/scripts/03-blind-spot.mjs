// E7: the sampled gate's blind spot. The case generator assigns extents from
// {1,3,4,7,mixed 3/5/7} and caps tensors at 4096 elements, so no reduction is
// ever checked with more than 7 folded terms at width-4 blocks, and error
// growth in long sums is invisible. Here: sequential f32 sum vs width-4 split
// sum vs f64 sum over K = 4..2^20 on the half-ULP stream [1,0,0,0,u,u,u],
// compared against the stage-2 budget |g - r| <= 2e-6 + 2e-5 |r| with r = f64 sum.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../../../../../../dist/tensor/evaluate.js';
import { parse } from '../../../../../../dist/tensor/parser.js';
import { selectFunction } from '../../../../../../dist/tensor/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const fr = Math.fround;
const rows = [];
for (const K of [4, 7, 64, 4096, 65536, 1 << 20]) {
  // build x[1,K] half-ulp stream, y[1] = sum(k) x[0,k]
  const src = 'fn s(x: f32[1,K]): f32[1] { y[i] = sum(k) x[i,k]; return y; }';
  const fn = selectFunction(parse(src), 's');
  const data = new Float32Array(K);
  const half = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];
  for (let i = 0; i < K; i++) data[i] = half[i % 7];
  const inputs = { x: { shape: [1, K], data } };

  const f64 = evaluate(fn, inputs, 'f64').data[0];
  const f32seq = evaluate(fn, inputs, 'f32').data[0];
  // width-4 split: emulate the IR the split-sum pass produces
  let split = 0;
  const blocks = Math.ceil(K / 4);
  for (let b = 0; b < blocks; b++) {
    let inner = 0;
    const n = Math.min(4, K - 4 * b);
    for (let l = 0; l < n; l++) inner = fr(inner + data[4 * b + l]);
    split = fr(split + inner);
  }
  const budget = 2e-6 + 2e-5 * Math.abs(f64);
  rows.push({
    K, f64, f32seq, split,
    seqErr: Math.abs(f32seq - f64), splitErr: Math.abs(split - f64), budget,
    seqInBudget: Math.abs(f32seq - f64) <= budget, splitInBudget: Math.abs(split - f64) <= budget,
  });
  console.log(
    `K=${K}: f64=${f64.toExponential(6)} seq_f32=${f32seq} (err ${rows.at(-1).seqErr.toExponential(3)}) ` +
    `split_f32=${split} (err ${rows.at(-1).splitErr.toExponential(3)}) budget=${budget.toExponential(2)} ` +
    `seq ${rows.at(-1).seqInBudget ? 'in' : 'OUT'} split ${rows.at(-1).splitInBudget ? 'in' : 'OUT'}`,
  );
}
writeFileSync(join(here, '..', 'results', 'blind-spot.json'), JSON.stringify(rows, null, 2));
// cancellation cases: inside the sampled *size* class but outside the sampled streams
const cancel = [];
for (const [label, vals] of [
  ['B,1,-B with B=2^24', [2 ** 24, 1, -(2 ** 24)]],
  ['B,1,-B with B=1e8', [1e8, 1, -1e8]],
  ['half-ulp prefix + cancellation', [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24, -(2 ** 24) * 0, 0]],
]) {
  const K = vals.length;
  const src = 'fn s(x: f32[1,K]): f32[1] { y[i] = sum(k) x[i,k]; return y; }';
  const fn = selectFunction(parse(src), 's');
  const data = new Float32Array(K);
  for (let i = 0; i < K; i++) data[i] = vals[i] ? fr(vals[i]) : 0;
  const inputs = { x: { shape: [1, K], data } };
  const f64 = evaluate(fn, inputs, 'f64').data[0];
  const f32 = evaluate(fn, inputs, 'f32').data[0];
  const budget = 2e-6 + 2e-5 * Math.abs(f64);
  cancel.push({ label, K, f64, f32, err: Math.abs(f32 - f64), budget, inBudget: Math.abs(f32 - f64) <= budget });
  console.log(`cancel ${label}: f32=${f32} f64=${f64} err=${cancel.at(-1).err} budget=${budget.toExponential(2)} -> ${cancel.at(-1).inBudget ? 'in' : 'OUT (correct lowering would be rejected)'}`);
}
writeFileSync(join(here, '..', 'results', 'blind-spot.json'), JSON.stringify({ growth: rows, cancellation: cancel }, null, 2));
console.log('E7 done');
