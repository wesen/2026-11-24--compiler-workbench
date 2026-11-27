import './02-source-loader.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../../../../', import.meta.url);
const source = path => import(new URL(path, root));
const { compileTix, cudaSource } = await source('src/tensor/index.ts');
const { evaluate } = await source('src/tensor/evaluate.ts');
const { unfusedPlan } = await source('src/tensor/fusion.ts');
const { createCudaLowering, cudaArtifact } = await source('src/tensor/cuda-contract.ts');

const program = compileTix(
  readFileSync(new URL('corpus/tensor/softmax/main.tix', root), 'utf8'),
);
const fn = program.current.value.functions[0];
const gates = [];
const referenceBatch = async (_source, f, cases, options) => {
  gates.push(options?.gate);
  return cases.map(inputs => ({ ...evaluate(f, inputs, 'f32'), gpuMs: 0 }));
};

const check = createCudaLowering('038-a-reference-stub', referenceBatch);
assert.deepEqual(await check(program.current, fn.name), { accepted: true, relation: 'exact' });
assert.deepEqual(gates.sort(), ['fused', 'unfused']);
console.log('injected executor received both forced sides; the relation is exact over the sampled outputs');

const code = cudaSource(program, fn.name, { fuse: false });
const kernels = unfusedPlan(fn).groups.map(group => ({
  name: group.kernel,
  mapping: group.mapping,
  statements: group.statements,
}));
const knownButWrong = kernels.map((kernel, index) =>
  index === 1 ? { ...kernel, statements: kernels[0].statements } : kernel,
);
const unknown = kernels.map((kernel, index) =>
  index === 1 ? { ...kernel, statements: ['038-a-unknown'] } : kernel,
);
const correct = await check(program.current, fn.name, cudaArtifact(fn.name, code, kernels));
const aliased = await check(program.current, fn.name, cudaArtifact(fn.name, code, knownButWrong));
const invalid = await check(program.current, fn.name, cudaArtifact(fn.name, code, unknown));
assert.equal(correct.accepted, true);
assert.equal(aliased.accepted, true);
assert.equal(invalid.accepted, false);
assert.match(invalid.reason, /Unknown source entity/);
console.log('cross-IR correspondence: valid-ID wrong mapping accepted, unknown source ID rejected');
