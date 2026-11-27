// Run from the worktree root after building: checkLowering for each corpus program, as compiled and after
// inline + split-sum, fused and unfused, with the wall time of each check (cases come from the contract).
//   node <ticket>/scripts/07-check-corpus.mjs [names...]
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { checkLowering, compileTix, cudaSource, optimizeTix } = await import(new URL('dist/tensor/index.js', root));
const { cudaCases } = await import(new URL('dist/tensor/contract.js', root));
const { seededRandom } = await import(new URL('dist/framework/contracts/index.js', root));
const names = process.argv.slice(2);
for (const name of names.length ? names : ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = compileTix(await readFile(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8'));
  const revisions = { compiled: program, optimized: optimizeTix(program, ['inline', 'split-sum']).program };
  for (const [revision, p] of Object.entries(revisions))
    for (const fuse of [true, false]) {
      const fn = p.current.value.functions.find(f => f.name === name);
      const start = performance.now();
      const verdict = await checkLowering(p, name, { fuse });
      console.log(
        JSON.stringify({
          name,
          revision,
          fuse,
          kernels: cudaSource(p, name, { fuse }).match(/__global__ void/g).length,
          cases: cudaCases(fn, seededRandom(20)).length,
          wallMs: Math.round(performance.now() - start),
          ...verdict,
        }),
      );
    }
}
