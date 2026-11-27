// IRWB-030-H script 09: what the exact contract costs. For each program, the number of cases the f32 recipe
// produces, the wall time of a cold `checkLowering` (plan, emit, nvcc, run on the GB10, compare) and of a repeated
// one (the framework memo replays the verdict).
//
//   node <ticket>/scripts/09-contract-cost.mjs [name ...]
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { checkLowering, compileTix } from '../../../../../../dist/tensor/index.js';
import { cudaCases, seed } from '../../../../../../dist/tensor/contract.js';
import { variants } from './01-programs.mjs';

const args = process.argv.slice(2);
const names = args.length ? args : ['layernorm', 'layernorm-inside', 'softmax', 'attention', 'attention-inside', 'mlp'];
for (const name of names) {
  const variant = variants[name];
  const program = compileTix(variant ? variant.program : readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const fn = program.current.value.functions[0];
  const cases = cudaCases(fn, seededRandom(seed));
  const row = { name, cases: cases.length, shapeAssignments: new Set(cases.map(c => c.shapeValues.join(','))).size };
  for (const fuse of [true, false]) {
    const start = performance.now();
    const cold = await checkLowering(program, fn.name, { fuse });
    const coldMs = performance.now() - start;
    const again = performance.now();
    const repeat = await checkLowering(program, fn.name, { fuse });
    row[fuse ? 'fused' : 'unfused'] = {
      accepted: cold.accepted,
      coldMs: Math.round(coldMs),
      repeatMs: Math.round(performance.now() - again),
      repeatedSame: repeat.accepted === cold.accepted,
    };
  }
  console.log(JSON.stringify(row));
}
