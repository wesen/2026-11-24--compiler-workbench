// IRWB-033-H script 06: what the contract checks and what it costs — cases, wall time of a cold check and of a
// repeated one, per program and side.
//   node 06-contract-cost.mjs [--only matmul]
import { readFileSync } from 'node:fs';
import { checkLowering, compileTix } from '../../../../../../dist/tensor/index.js';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const rows = [];
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  if (only && !only.includes(name)) continue;
  const program = compileTix(readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
  for (const fuse of [true, false]) {
    const t0 = performance.now();
    const verdict = await checkLowering(program, name, { fuse });
    const cold = performance.now() - t0;
    const t1 = performance.now();
    const again = await checkLowering(program, name, { fuse });
    const repeat = performance.now() - t1;
    rows.push({ program: name, fuse, accepted: verdict.accepted, coldMs: Math.round(cold), repeatMs: Math.round(repeat) });
    console.log(
      `${name.padEnd(9)} ${fuse ? 'fused  ' : 'unfused'} ${verdict.accepted ? 'accepted' : 'REJECTED'}  ` +
        `cold ${Math.round(cold)} ms, repeat ${Math.round(repeat)} ms`,
    );
  }
}
console.log(JSON.stringify(rows));
