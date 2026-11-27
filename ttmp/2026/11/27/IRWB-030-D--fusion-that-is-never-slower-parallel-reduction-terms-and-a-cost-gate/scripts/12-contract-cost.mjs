// IRWB-030-D: what the contract costs. For each corpus program and variant, fused: the case count of stage 2's
// recipe (cudaCases), the elements sent, the wall time of a cold checkLowering and of a repeat in the same process.
// Sequential, so that each cold time is one check alone.
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { cudaCases, seed } from '../../../../../../dist/tensor/contract.js';
import { checkLowering } from '../../../../../../dist/tensor/index.js';
import { fnName, names, program } from './01-programs.mjs';

for (const name of [...names, 'softmax-inside']) {
  const p = program(name);
  const cases = cudaCases(p.current.value.functions[0], seededRandom(seed));
  const elements = cases.reduce(
    (n, c) => n + Object.values(c.inputs).reduce((k, t) => k + t.data.length, 0) + c.reference.data.length,
    0,
  );
  let t = performance.now();
  const verdict = await checkLowering(p, fnName(name));
  const cold = performance.now() - t;
  t = performance.now();
  await checkLowering(p, fnName(name));
  const repeat = performance.now() - t;
  console.log(JSON.stringify({ name, cases: cases.length, elements, ...verdict, coldMs: Math.round(cold), repeatMs: +repeat.toFixed(1) }));
}
