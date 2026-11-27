// Run from the worktree root after building: prints the fused plan, the refusals and (with --source) the CUDA
// kernels of a corpus program, or of a .tix file given as a path with a function name.
//   node <ticket>/scripts/06-show-plan.mjs softmax [--source]
//   node <ticket>/scripts/06-show-plan.mjs path/to/file.tix fnName [--source]
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix } = await import(new URL('dist/tensor/index.js', root));
const { planKernels } = await import(new URL('dist/tensor/kernels.js', root));
const { emitPlan } = await import(new URL('dist/tensor/cuda-source.js', root));
const args = process.argv.slice(2).filter(a => a !== '--source');
const file = args[0].endsWith('.tix') ? args[0] : `corpus/tensor/${args[0]}/main.tix`;
const name = args[1] ?? args[0];
const program = compileTix(await readFile(file, 'utf8'));
const fn = program.current.value.functions.find(f => f.name === name);
const { plan, refused } = planKernels(fn);
console.log(JSON.stringify({ inlined: plan.inlined, kernels: plan.kernels, refused }));
if (process.argv.includes('--source')) {
  const source = emitPlan(plan);
  console.log(source.slice(source.indexOf('__global__'), source.indexOf('int main')));
}
