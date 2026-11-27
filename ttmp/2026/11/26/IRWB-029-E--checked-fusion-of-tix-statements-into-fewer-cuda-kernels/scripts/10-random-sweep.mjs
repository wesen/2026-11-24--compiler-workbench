// Run from the worktree root after building: checkLowering (fused) on random programs beyond the test's seeds,
// as compiled and after inline + split-sum. Prints one line per rejected program and a summary.
//   node <ticket>/scripts/10-random-sweep.mjs <firstSeed> <count>
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { checkLowering, compileTix, cudaSource, optimizeTix } = await import(new URL('dist/tensor/index.js', root));
const { randomProgram } = await import(new URL('tests/tensor/fixtures/random-programs.mjs', root));
const [first, count] = process.argv.slice(2).map(Number);
const summary = { programs: 0, checks: 0, rejected: 0, statements: 0, unfusedKernels: 0, fusedKernels: 0 };
const kernels = (p, fuse) => cudaSource(p, 'f', { fuse }).match(/__global__ void/g).length;
for (let seed = first; seed < first + count; seed += 3)
  await Promise.all(
    [0, 1, 2].filter(k => seed + k < first + count).map(async k => {
      const source = randomProgram(seed + k);
      const program = compileTix(source);
      summary.programs++;
      summary.unfusedKernels += kernels(program, false);
      summary.fusedKernels += kernels(program, true);
      const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
      for (const [revision, p] of [['compiled', program], ['optimized', optimized]]) {
        const verdict = await checkLowering(p, 'f');
        summary.checks++;
        if (!verdict.accepted) {
          summary.rejected++;
          console.log(JSON.stringify({ seed: seed + k, revision, source, reason: verdict.reason }));
        }
      }
    }),
  );
console.log(JSON.stringify(summary));
