import { readFileSync } from 'node:fs';

const jsonl = name => readFileSync(new URL(name, import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
const whole = new Map([...jsonl('05-corpus-timings.jsonl'), ...jsonl('11-final-group-timings.jsonl')]
  .map(row => [row.key, row.median]));
const phases = jsonl('12-final-phases.jsonl');
const median = series => [...series].sort((a,b) => a-b)[Math.floor(series.length / 2)];
const phase = (key, fuse, index) => {
  const samples = phases.filter(p => p.key === key && p.fuse === fuse).map(p => p.medians[index]);
  if (samples.length !== 5 || samples.some(v => !Number.isFinite(v))) throw Error('Incomplete phase ' + key);
  return median(samples);
};
const ms = value => value.toFixed(value >= 1 ? 3 : 5);
const table = [
  '| Program | Base fused ms | Stage 6 fused ms | Base and Stage 6 unfused ms | Definitions fused / unfused | Fused launches |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
];
for (const [key, name, unfusedKernels, launches] of [
  ['matmul','Matmul 512³',1,1], ['large','Matmul 4096³',1,1], ['softmax','Softmax',4,1],
  ['layernorm','Layernorm',4,1], ['attention','Attention',6,3], ['mlp','MLP',3,2], ['conv2d','Convolution',1,1],
]) {
  const t = whole.get(key);
  table.push(`| ${name} | ${ms(t.base)} | ${ms(t.fused)} | ${ms(t.unfused)} | 1 / ${unfusedKernels} | ${launches} |`);
}
console.log(table.join('\n'));

const contractions = [
  ['Matmul 512³', 2 * 512 ** 3, whole.get('matmul').fused, whole.get('matmul').unfused, .0329],
  ['Matmul 4096³', 2 * 4096 ** 3, whole.get('large').fused, whole.get('large').unfused, 2 * 4096 ** 3 / 19.2e9],
  ['Attention score and scale', 2 * 1024 * 1024 * 64, phase('attention',true,0), phase('attention',false,0), .0177],
  ['Attention value', 2 * 1024 * 1024 * 64, phase('attention',true,2), phase('attention',false,5), .0216],
  ['MLP h and fused GELU', 2 * 1024 * 1024 * 256, phase('mlp',true,0), phase('mlp',false,0), .0423],
  ['MLP y and bias', 2 * 1024 * 1024 * 256, phase('mlp',true,1), phase('mlp',false,2), .0475],
  ['Convolution', 2 * 8 * 32 * 62 ** 2 * 16 * 9, whole.get('conv2d').fused, whole.get('conv2d').unfused],
];

console.log('\n| Contraction | Fused ms | Unfused ms | Fused TFLOP/s | Unfused TFLOP/s | Time / cuBLAS fused / unfused |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
for (const [name, ops, fused, unfused, reference] of contractions) {
  const rate = ms => (ops / (1e9 * ms)).toFixed(2);
  const ratio = reference ? `${(fused/reference).toFixed(2)}× / ${(unfused/reference).toFixed(2)}×` : '—';
  console.log(`| ${name} | ${ms(fused)} | ${ms(unfused)} | ${rate(fused)} | ${rate(unfused)} | ${ratio} |`);
}

console.log('\n| Program | GPU batches | Schedule and emit ms | First check ms | Repeat check ms |');
console.log('| --- | ---: | ---: | ---: | ---: |');
for (const c of jsonl('13-contract-cost.jsonl'))
  console.log(`| ${c.name} | ${c.batches} | ${c.scheduleAndEmitMs.toFixed(1)} | ${c.firstMs.toFixed(1)} | ${c.repeatMs.toFixed(1)} |`);
