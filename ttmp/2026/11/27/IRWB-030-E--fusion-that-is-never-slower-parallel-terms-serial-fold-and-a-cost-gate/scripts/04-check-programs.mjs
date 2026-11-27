// IRWB-030-E script 04: checkLowering (exact, both sides of the gate) on every program of script 01's table, as
// written and after inline + split-sum, fused and unfused. Prints one line per check with its wall time.
//   node <ticket>/scripts/04-check-programs.mjs [name ...]
import { checkLowering, compileTix, optimizeTix } from '../../../../../../dist/tensor/index.js';
import { programs } from './01-benchmark.mjs';

const names = process.argv.slice(2);
let failed = 0;
for (const name of names.length ? names : Object.keys(programs)) {
  const spec = programs[name];
  const original = compileTix(spec.source);
  const optimized = optimizeTix(original, ['inline', 'split-sum']).program;
  for (const [form, program] of [['source', original], ['inline+split', optimized]])
    for (const fuse of [true, false]) {
      const start = performance.now();
      const verdict = await checkLowering(program, spec.fn ?? name, { fuse });
      if (!verdict.accepted) failed++;
      console.log(JSON.stringify({ name, form, fuse, ...verdict, wallMs: Math.round(performance.now() - start) }));
    }
}
console.log(JSON.stringify({ failed }));
process.exitCode = failed ? 1 : 0;
