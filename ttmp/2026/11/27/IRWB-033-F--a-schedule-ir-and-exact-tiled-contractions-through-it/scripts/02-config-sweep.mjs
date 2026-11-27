// IRWB-033-F script 02: tile-configuration sweep for the tiled matmul. One configuration (and the
// double-buffer flag) at a time, by mutating the exported `tile` table before emitting; three benchmark calls
// each at 512^3 and 4096^3, alternating with nothing else on the GPU (benchmark holds the timed lock). The
// tiled result is checked against the stage-2 lowering once per configuration at 512^3.
//   node <ticket>/scripts/02-config-sweep.mjs [--configs <json file>]
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import * as schedule from '../../../../../../dist/tensor/schedule.js';

const program = compileTix(
  readFileSync(new URL('../../../../../../corpus/tensor/matmul/main.tix', import.meta.url), 'utf8'),
);
const firstDifference = (a, b) => {
  const wa = new Uint32Array(a.buffer, a.byteOffset, a.length),
    wb = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < a.length; i++)
    if (wa[i] !== wb[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return `word ${i}`;
  return 'equal';
};
const inputs = ([M, K, N], seed) => {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const data = n => Float32Array.from({ length: n }, rnd);
  return { a: { shape: [M, K], data: data(M * K) }, b: { shape: [K, N], data: data(K * N) } };
};

const configs = [
  { bm: 64, bn: 128, bk: 32, tm: 4, tn: 4 },
  { bm: 64, bn: 96, bk: 32, tm: 4, tn: 4 },
  { bm: 64, bn: 96, bk: 32, tm: 4, tn: 4, double: false },
  { bm: 96, bn: 64, bk: 32, tm: 4, tn: 4, double: false },
  { bm: 64, bn: 128, bk: 32, tm: 4, tn: 4 },
  { bm: 128, bn: 128, bk: 32, tm: 8, tn: 8, double: false },
];

for (const config of configs) {
  const { double = true, ...c } = config;
  schedule.tile.configs = [c];
  schedule.tile.doubleBuffer = double;
  const source = cudaSource(program, 'matmul');
  const row = { config: JSON.stringify(config), threads: (c.bm / c.tm) * (c.bn / c.tn) };
  try {
  // correctness once, against the stage-2 lowering at a size that exercises masks and tails
  const inp = inputs([130, 65, 100], 20);
  const [tiled, plain] = await Promise.all([
    import('../../../../../../dist/tensor/cuda-runtime.js').then(m =>
      m.runCudaBatch(source, program.current.value.functions[0], [inp], { gate: 'fused' }),
    ),
    import('../../../../../../dist/tensor/cuda-runtime.js').then(m =>
      m.runCudaBatch(source, program.current.value.functions[0], [inp], { gate: 'unfused' }),
    ),
  ]);
  row.verdict = firstDifference(plain[0].data, tiled[0].data);
  for (const shape of [
    [512, 512, 512],
    [4096, 4096, 4096],
  ]) {
    const input = inputs(shape, 20);
    const times = [];
    for (let i = 0; i < 3; i++) {
      const out = await runTixCuda(program, 'matmul', input, { benchmark: true });
      times.push(out.gpuMs);
    }
    times.sort((x, y) => x - y);
    row[shape[0] === 512 ? 'ms512' : 'ms4096'] = times[1];
    }
  } catch (error) {
    row.failed = (String(error).match(/too many resources|Error: ([^\n]*)/) ?? [])[1] ?? String(error).slice(0, 120);
  }
  console.log(JSON.stringify(row));
}
schedule.tile.configs = [
  { bm: 64, bn: 64, bk: 32, tm: 4, tn: 4 },
  { bm: 128, bn: 128, bk: 32, tm: 8, tn: 4 },
  { bm: 256, bn: 128, bk: 32, tm: 8, tn: 4 },
];
schedule.tile.doubleBuffer = true;
