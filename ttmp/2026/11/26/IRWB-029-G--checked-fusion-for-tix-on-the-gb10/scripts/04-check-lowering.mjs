// The contract's verdict on the fused lowering, and what it costs.
//
// For every corpus program, run checkLowering on the original revision and on the optimized one, fused and unfused,
// and print the verdict, the relation and the wall time of the check. The relation is exact (bit equality with the
// current revision's f32 meaning on the contract's sampled cases, NaN compared as a class), so no tolerance is
// involved and a fused result that differed in one word would be rejected.
//
//   node <ticket>/scripts/04-check-lowering.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, optimizeTix, checkLowering } = await import(new URL('dist/tensor/index.js', root));

for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = compileTix(await readFile('corpus/tensor/' + name + '/main.tix', 'utf8'));
  const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
  const verdicts = [];
  for (const [label, revision] of [
    ['original', program],
    ['optimized', optimized],
  ])
    for (const fuse of [false, true]) {
      const start = Date.now();
      const verdict = await checkLowering(revision, name, { fuse });
      verdicts.push(
        `${label}/${fuse ? 'fused' : 'unfused'} ${verdict.accepted ? 'accepted' : 'REJECTED'} ` +
          `${verdict.relation} ${Date.now() - start}ms${verdict.reason ? ' ' + verdict.reason : ''}`,
      );
    }
  console.log(name.padEnd(9), verdicts.join(' | '));
}
