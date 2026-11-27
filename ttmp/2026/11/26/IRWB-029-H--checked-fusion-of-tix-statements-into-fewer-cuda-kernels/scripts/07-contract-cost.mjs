// Probe 07: what the lowering contract checks, and what that costs.
//
// The fused lowering is judged by the same invariant as stage 2, under the exact relation (`tensor.cuda-meaning`,
// version 2). This prints, per corpus function, the eligible case count and the compared element count, then times a
// cold check and a replay of the same verdict, fused and unfused.
//
// Run from the worktree root after `npm run build`:
//   node ttmp/2026/11/26/IRWB-029-H--*/scripts/07-contract-cost.mjs
import { readFileSync } from 'node:fs';

const { checkLowering, compileTix } = await import(new URL('dist/tensor/index.js', `file://${process.cwd()}/`));
const { cudaCases, seed } = await import(new URL('dist/tensor/contract.js', `file://${process.cwd()}/`));
const { seededRandom } = await import(new URL('dist/framework/contracts/index.js', `file://${process.cwd()}/`));

const rows = [];
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = compileTix(readFileSync('corpus/tensor/' + name + '/main.tix', 'utf8'));
  const fn = program.current.value.functions[0];
  const generating = process.hrtime.bigint();
  const cases = cudaCases(fn, seededRandom(seed));
  const generateMs = Number(process.hrtime.bigint() - generating) / 1e6;
  const elements = cases.reduce((n, c) => n + c.reference.data.length, 0);
  for (const fuse of [true, false]) {
    const cold = process.hrtime.bigint();
    const verdict = await checkLowering(program, name, { fuse });
    const coldMs = Number(process.hrtime.bigint() - cold) / 1e6;
    const replayStart = process.hrtime.bigint();
    const replay = await checkLowering(program, name, { fuse });
    const replayMs = Number(process.hrtime.bigint() - replayStart) / 1e6;
    rows.push({
      name,
      fuse,
      accepted: verdict.accepted,
      relation: verdict.relation,
      cases: cases.length,
      elements,
      generateMs: Math.round(generateMs),
      coldMs: Math.round(coldMs),
      replayMs: Math.round(replayMs),
    });
    console.log(
      `${name.padEnd(10)} fuse=${String(fuse).padEnd(5)} cases=${String(cases.length).padStart(3)} compared=${String(elements).padStart(6)} ${verdict.accepted ? 'accepted' : 'REJECTED'} ${verdict.relation} cold=${Math.round(coldMs)} ms replay=${Math.round(replayMs)} ms (case generation ${Math.round(generateMs)} ms) ${replay.accepted === verdict.accepted ? '' : 'REPLAY MISMATCH'}`,
    );
  }
}
console.log('JSON ' + JSON.stringify(rows));
