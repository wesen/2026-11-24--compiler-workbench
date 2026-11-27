// IRWB-030-I script 06: what the exact check costs with the staged lowering. Cold `checkLowering` (compile +
// GPU batch of the contract's cases) and the memoized repeat, for two corpus programs and the layernorm inside
// variant, fused and unfused.
//   node <ticket>/scripts/06-contract-cost.mjs
import { performance } from 'node:perf_hooks';
import { corpusInputs } from './01-baseline.mjs';
import { checkLowering } from '../../../../../../dist/tensor/index.js';

const programs = ['softmax', 'layernorm', 'layernorm-inside', 'attention-inside'];
for (const name of programs) {
  const { program } = corpusInputs(name);
  const fnName = name.replace(/-inside$/, '');
  for (const fuse of [true, false]) {
    const start = performance.now();
    const first = await checkLowering(program, fnName, { fuse });
    const cold = performance.now() - start;
    const repeatStart = performance.now();
    const repeat = await checkLowering(program, fnName, { fuse });
    console.log(
      JSON.stringify({ name, fuse, accepted: first.accepted, relation: first.relation, coldMs: Math.round(cold), repeatMs: Math.round(performance.now() - repeatStart), reason: first.reason }),
    );
  }
}
