// IRWB-029-D probe 12: what the framework checks of the lowering's statements-to-kernels correspondence. A
// candidate CUDA artifact whose recorded kernels name statements and kernels that do not exist, with a fake
// engine that returns the f32 meaning (so the numerical check passes), goes through the same transformation.
//   node <ticket>/scripts/12-correspondence-probe.mjs
import { readFileSync } from 'node:fs';
import { AnalysisManager } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { createCudaLowering, cudaArtifact } from '../../../../../../dist/tensor/cuda-contract.js';
import { evaluate } from '../../../../../../dist/tensor/evaluate.js';

const engine = async (_source, f, cases) => cases.map(inputs => ({ ...evaluate(f, inputs, 'f32'), gpuMs: 0 }));
const check = createCudaLowering('probe-12', engine);
const program = compileTix(readFileSync('corpus/tensor/softmax/main.tix', 'utf8'));
const source = cudaSource(program, 'softmax');
for (const [label, kernels] of [
  ['as planned', [{ name: 'k0', mapping: 'block', statements: ['m', 'e', 's', 'y'] }]],
  ['invented entities', [{ name: 'k7', mapping: 'thread', statements: ['nonexistent'] }]],
  ['no kernels', []],
]) {
  const manager = new AnalysisManager();
  const verdict = await check(program.current, 'softmax', cudaArtifact('softmax', source, kernels), { manager });
  const record = manager.snapshot().executions.at(-1).checks.find(c => c.phase === 'correspondence');
  console.log(JSON.stringify({ label, verdict, correspondence: { ok: record?.ok, reason: record?.reason, entities: record?.evidence.entities } }));
}
