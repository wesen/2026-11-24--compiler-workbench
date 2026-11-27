// IRWB-033-F script 06: the launch rule across sizes (which tile configuration it picks, and whether forcing
// the other one is worse), the clock right after a 4096^3 run, and contraction variants at 512^3.
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import * as schedule from '../../../../../../dist/tensor/schedule.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';

const run = promisify(execFile);
const root = new URL('../../../../../../', import.meta.url);
const inputs = (fn, sizesList, seed = 20) => {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const symbols = [...new Set(fn.params.flatMap(p => p.shape.map(d => d.terms[0]?.[0]).filter(Boolean)))];
  const dims = new Map(symbols.map((n, i) => [n, sizesList[i]]));
  return Object.fromEntries(
    fn.params.map(p => [
      p.name,
      {
        shape: p.shape.map(d => (d.terms[0]?.[0] ? dims.get(d.terms[0][0]) : d.constant)),
        data: Float32Array.from(
          { length: p.shape.reduce((n, d) => n * (d.terms[0]?.[0] ? dims.get(d.terms[0][0]) : d.constant), 1) },
          () => 0.1 * rnd(),
        ),
      },
    ]),
  );
};
const median = t => [...t].sort((a, b) => a - b)[Math.floor(t.length / 2)];
async function clock() {
  const { stdout } = await run('node', [
    new URL('../../../../../../tools/cuda-remote.mjs', import.meta.url).pathname,
    '05-clock',
  ]);
  return JSON.parse(stdout).stdout.trim();
}

const program = compileTix(readFileSync(new URL('corpus/tensor/matmul/main.tix', root), 'utf8'));
const fn = program.current.value.functions[0];
const table = schedule.tile.configs;
const gridOf = (c, M, N) => Math.ceil(M / c.bm) * Math.ceil(N / c.bn);

for (const size of [512, 1024, 2048, 4096]) {
  const inp = inputs(fn, [size, size, size]);
  const rows = { size, rule: {} };
  // what the rule picks, computed exactly as the emitted host code does
  let cfg = 0;
  for (let i = table.length - 1; i > 0; --i) if (gridOf(table[i], size, size) >= schedule.tile.dispatch.waves * 48) cfg = i;
  rows.rule.cfg = cfg;
  for (const [label, configs] of [
    ['rule', table],
    ['c0', [table[0]]],
    ['c1', [table[1]]],
  ]) {
    schedule.tile.configs = configs;
    const source = cudaSource(program, 'matmul');
    const times = [];
    for (let i = 0; i < 3; i++) times.push((await runTixCuda(program, 'matmul', inp, { benchmark: true })).gpuMs);
    rows[label] = Math.round(median(times) * 1000) / 1000;
  }
  schedule.tile.configs = table;
  if (size === 4096) {
    // a full run then the clock, to check for thermal drift at the biggest size
    await runTixCuda(program, 'matmul', inp, { benchmark: true });
    rows.clockAfter = await clock();
  }
  console.log(JSON.stringify(rows));
}

// variants of the contraction at 512^3: the epilogue and the operand layouts the tile pass accepts
const variants = compileTix(`
  fn bias(a:f32[M,K], b:f32[K,N], c:f32[N]):f32[M,N] { y[i,j] = (sum(k) a[i,k]*b[k,j]) + c[j]; return y; }
  fn scaled(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = (sum(k) a[i,k]*b[k,j]) / sqrt(K); return y; }
  fn transposed(a:f32[K,M], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[k,i]*b[k,j]; return y; }
`);
for (const name of ['bias', 'scaled', 'transposed']) {
  const f = variants.current.value.functions.find(f => f.name === name);
  const inp = inputs(f, [512, 512, 512]);
  const fused = [], unfused = [];
  for (let i = 0; i < 3; i++) {
    fused.push((await runTixCuda(variants, name, inp, { benchmark: true })).gpuMs);
    unfused.push((await runTixCuda(variants, name, inp, { benchmark: true, fuse: false })).gpuMs);
  }
  console.log(JSON.stringify({ variant: name, fusedMs: Math.round(median(fused) * 1000) / 1000, unfusedMs: Math.round(median(unfused) * 1000) / 1000 }));
}
