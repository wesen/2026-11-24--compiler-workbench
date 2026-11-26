import { readFileSync } from 'node:fs';
import { compileTix, cudaSource, optimizeTix } from '../../../../../../dist/tensor/index.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { evaluate } from '../../../../../../dist/tensor/evaluate.js';
import { loweringCases } from '../../../../../../dist/tensor/cuda.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-io.js';
import { sampleSeed, tolerance } from '../../../../../../dist/tensor/samples.js';

const gpu = process.argv.includes('--gpu');
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const original = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const byRevision = new Map();
  for (const passes of [[], ['inline'], ['split-sum'], ['inline', 'split-sum'], ['split-sum', 'inline']]) {
    const { program } = optimizeTix(original, passes);
    const [fn] = program.current.value.functions;
    let result = byRevision.get(program.current.revision);
    if (!result) {
      const all = [...loweringCases(fn, seededRandom(sampleSeed))];
      const observations = gpu
        ? (
            await runCudaBatch(
              fn,
              cudaSource(program, name),
              all.map(sample => sample.inputs),
            )
          ).outputs
        : all.map(({ inputs }) => evaluate(fn, inputs, 'f32'));
      let worst = 0;
      for (const [index, { reference }] of all.entries()) {
        const got = observations[index];
        if (String(got.shape) !== String(reference.shape)) throw Error('Unexpected shape in ' + name);
        for (let i = 0; i < reference.data.length; i++) {
          const r = reference.data[i];
          const g = got.data[i];
          if (!Number.isFinite(g)) throw Error('Nonfinite result in ' + name);
          worst = Math.max(worst, Math.abs(g - r) / tolerance(r));
        }
      }
      result = { cases: all.length, worst };
      byRevision.set(program.current.revision, result);
    }
    if (result.worst > 1) throw Error('Sampled tolerance exceeded in ' + name);
    console.log(JSON.stringify({ name, passes, ...result }));
  }
}
