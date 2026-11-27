// IRWB-030-J script 05: what the contract checks and what it costs, per corpus program and the two inside
// variants, fused (staged terms inside the checked source). Same protocol as IRWB-029-D script 11: cases built
// locally, one cold batch through the GB10 runner, wall time, and a repeated (memoized) check.
//   node <ticket>/scripts/05-contract-cost.mjs [name ...]
import { performance } from 'node:perf_hooks';
import { checkLowering } from '../../../../../../dist/tensor/index.js';
import { cudaCases, seed } from '../../../../../../dist/tensor/contract.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { programOf } from './02-benchmark.mjs';

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = process.argv.slice(2);
  for (const name of names.length ? names : [
    'matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d',
    'layernorm-inside', 'attention-inside',
  ]) {
    const { program, fn } = programOf(name);
    const f = program.current.value.functions.find(x => x.name === fn);
    const buildStart = performance.now();
    const cases = cudaCases(f, seededRandom(seed));
    const buildMs = performance.now() - buildStart;
    const elements = cases.reduce(
      (n, c) =>
        n +
        Object.values(c.inputs).reduce((m, t) => m + t.data.length, 0) +
        c.reference.data.length,
      0,
    );
    const coldStart = performance.now();
    const cold = await checkLowering(program, fn);
    const coldMs = performance.now() - coldStart;
    const repeatStart = performance.now();
    const repeat = await checkLowering(program, fn);
    const repeatMs = performance.now() - repeatStart;
    console.log(
      JSON.stringify({
        name,
        accepted: cold.accepted && repeat.accepted,
        relation: cold.relation,
        cases: cases.length,
        elements,
        buildMs: Math.round(buildMs),
        coldMs: Math.round(coldMs),
        repeatMs: Math.round(repeatMs),
      }),
    );
  }
}
