// E5: where does the cost of a checked pass go?
// Times, per corpus program: parse, the sampled exact gate for a real inline
// candidate, and the sampled tolerance gate for a real split-sum candidate.
// The gate cost is what a static exactness certificate (proposal 3) would replace.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTix, optimizeTix } from '../../../../../../dist/tensor/index.js';
import { meaningGate, seed } from '../../../../../../dist/tensor/contract.js';
import { applyNativePassSync } from '../../../../../../dist/framework/passes/index.js';
import { inlinePass, splitPass } from '../../../../../../dist/tensor/passes.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..', '..', '..');
const programs = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
const rows = [];
for (const name of programs) {
  const src = readFileSync(join(root, 'corpus/tensor', name, 'main.tix'), 'utf8');
  let t0 = performance.now();
  const program = compileTix(src);
  const parseMs = performance.now() - t0;

  t0 = performance.now();
  const inlined = optimizeTix(program, ['inline']);
  const inlineMs = performance.now() - t0;

  t0 = performance.now();
  const both = optimizeTix(program, ['inline', 'split-sum']);
  const bothMs = performance.now() - t0;

  // Gate-only cost: run the exact gate on the (already accepted) inline candidate.
  const candidate = inlined.program.current;
  t0 = performance.now();
  const verdict = meaningGate(program.origin, 'exact')(program.origin, candidate);
  const exactGateMs = performance.now() - t0;

  // Tolerance gate on the split candidate from the full pipeline.
  const splitCandidate = both.program.current;
  t0 = performance.now();
  const verdict2 = meaningGate(program.origin, 'tolerance')(program.origin, splitCandidate);
  const tolGateMs = performance.now() - t0;

  // A native pass run without any gate, to isolate transformation cost:
  t0 = performance.now();
  applyNativePassSync(inlinePass, program.current, () => ({ ok: true }));
  const barePassMs = performance.now() - t0;

  rows.push({
    name, parseMs: +parseMs.toFixed(1), inlineMs: +inlineMs.toFixed(1), bothMs: +bothMs.toFixed(1),
    exactGateMs: +exactGateMs.toFixed(1), tolGateMs: +tolGateMs.toFixed(1), barePassMs: +barePassMs.toFixed(3),
    exactOk: verdict.ok, tolOk: verdict2.ok, seed,
  });
  console.log(`${name}: parse ${parseMs.toFixed(1)} ms, inline ${inlineMs.toFixed(1)} ms (gate ${exactGateMs.toFixed(1)}), inline+split ${bothMs.toFixed(1)} ms (tol gate ${tolGateMs.toFixed(1)}), bare pass ${barePassMs.toFixed(2)} ms`);
}
import { writeFileSync } from 'node:fs';
writeFileSync(join(here, '..', 'results', 'check-cost.json'), JSON.stringify(rows, null, 2));
console.log('E5 done');
