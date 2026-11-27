// E3b: cross-check the handwritten fused layernorm output (from scripts/gpu/e3-layernorm)
// against the product's own meaning: runTix in f64 (reference) and f32 (sequential meaning)
// on a 4-row subset of the probe's dumped inputs, and report budget fractions.
// Usage: node scripts/04-layernorm-crosscheck.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';

const here = import.meta.dirname;
const gpu = join(here, 'gpu/e3-layernorm/out');
const repo = join(here, '../../../../../../');

const N = 4096, D = 1024, rows = 4;
const read = (name, n) => {
  const b = readFileSync(join(gpu, name + '.bin'));
  const u8 = new Uint8Array(b.buffer, b.byteOffset, Math.min(b.length, n * 4));
  return new Float32Array(u8.slice().buffer);
};
const x = read('x', N * D), gamma = read('gamma', D), beta = read('beta', D), eps = read('eps', 1);
const yStage2 = read('y-stage2', N * D), yFused = read('y-fused', N * D);

const program = compileTix(readFileSync(join(repo, 'corpus/tensor/layernorm/main.tix'), 'utf8'));
const inputs = {
  x: { shape: [rows, D], data: x.subarray(0, rows * D) },
  gamma: { shape: [D], data: gamma },
  beta: { shape: [D], data: beta },
  eps: { shape: [1], data: eps },
};
const ref = new Float64Array(runTix(program, 'layernorm', inputs, { precision: 'f64' }).data);
const seq = new Float32Array(runTix(program, 'layernorm', inputs, { precision: 'f32' }).data);

function budget(got, ref) {
  let worst = 0, where = -1;
  for (let i = 0; i < got.length; i++) {
    const allowed = 2e-6 + 2e-5 * Math.abs(ref[i]);
    const f = Math.abs(got[i] - ref[i]) / allowed;
    if (f > worst) { worst = f; where = i; }
  }
  return { worst, where };
}
const bSeq = budget(seq, ref), bStage2 = budget(yStage2.subarray(0, rows * D), ref), bFused = budget(yFused.subarray(0, rows * D), ref);
// Bit identity of the sequential meaning row vs the stage-2 GPU rows (the lowering is bit-exact).
let mismSeqStage2 = 0;
for (let i = 0; i < rows * D; i++)
  if (new Uint32Array(seq.buffer.slice(i * 4, i * 4 + 4))[0] !== new Uint32Array(yStage2.buffer.slice(i * 4, i * 4 + 4))[0]) mismSeqStage2++;

console.log(
  JSON.stringify(
    {
      note: 'rows 0..3 of the E3 probe inputs, D=1024',
      interpreter_f32_vs_f64_budget: bSeq,
      stage2_gpu_vs_interpreter_f64_budget: bStage2,
      fused_vs_interpreter_f64_budget: bFused,
      interpreter_f32_vs_stage2_gpu_bit_mismatches: mismSeqStage2,
    },
    null,
    2,
  ),
);
