// IRWB-029-D script 08: is one block-mode kernel for mlp (h, g and y per row) faster than the epilogue-only plan
// (k0: h and g, one thread per element; k1: y)? Both plans are legal; this measures them at the brief's size with
// the public benchmark mode's runner (inputs as in script 04). Not product code: the second plan is built by hand.
//   node <ticket>/scripts/08-mlp-plans.mjs [--threads=N]
import { createHash } from 'node:crypto';
import { cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { corpusInputs } from './04-benchmark.mjs';

const withCap = (source, n) => (n ? source.replace(/std::min<U>\(\d+, \(longest_/g, `std::min<U>(${n}, (longest_`) : source);
const threads = Number(process.argv.find(a => a.startsWith('--threads='))?.slice(10) ?? 0) || undefined;
const { program, fn, inputs } = corpusInputs('mlp');
const group = (kernel, statements, depth, stored) => ({
  kernel, statements, depth, mapping: 'thread', stored, buffered: [], staged: [], reasons: ['script 08'],
});
const plans = {
  'one block-mode kernel (planFusion)': cudaSource(program, 'mlp'),
  'epilogue only': emitCuda(fn, { fn: 'mlp', groups: [group('k0', ['h', 'g'], 2, ['g']), group('k1', ['y'], 2, ['y'])], refusals: [] }),
};
for (const [name, source] of Object.entries(plans)) {
  const [result] = await runCudaBatch(withCap(source, threads), fn, [inputs], { benchmark: true });
  const sha = createHash('sha256').update(Buffer.from(result.data.buffer)).digest('hex').slice(0, 16);
  console.log(JSON.stringify({ plan: name, threads, kernels: (source.match(/__global__ void/g) ?? []).length, gpuMs: result.gpuMs, output: sha }));
}
