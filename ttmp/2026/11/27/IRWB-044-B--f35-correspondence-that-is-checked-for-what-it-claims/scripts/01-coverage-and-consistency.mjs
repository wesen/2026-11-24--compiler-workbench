// F35 probe, after the fix: the manager rejects a correspondence record whose mapping groups do not cover
// what the requirement declares, and a group that contradicts what the structural diff shows. The honest
// mapping, the lab records and the CUDA lowering requirement (targetTotal) are still accepted.
const C = await import('../../../../../../dist/framework/contracts/index.js');
const { applyNativePassSync, semanticCorrespondence } = await import(
  '../../../../../../dist/framework/passes/index.js'
);
const { compileTix } = await import('../../../../../../dist/tensor/index.js');
const { inlinePass } = await import('../../../../../../dist/tensor/passes.js');
const { meaningGate } = await import('../../../../../../dist/tensor/contract.js');
const { TixIR } = await import('../../../../../../dist/tensor/ir.js');
const { kernelCorrespondence, cudaArtifact, createCudaLowering } = await import(
  '../../../../../../dist/tensor/cuda-contract.js'
);

const tryVerify = async (label, verify) => {
  try {
    await verify();
    console.log(`${label}: ACCEPTED`);
  } catch (e) {
    console.log(`${label}: rejected - ${e.message}`);
  }
};

// The probe 04 scenario: Tix inline merges p into the surviving y.
const q = compileTix('fn f(x:f32[N,N]):f32[N,N] { p[i,j] = x[i,j] + 1; y[i,j] = p[j,i]; return y; }');
const inline = applyNativePassSync(inlinePass, q.current, meaningGate(q.origin, 'exact'));
const mappingOnly = C.defineTransformation({
  id: 'probe.mapping',
  version: '1',
  description: 'requires an entity mapping',
  inputs: { input: TixIR },
  outputs: { output: TixIR },
  correspondence: [{ id: 'entities', from: 'input', to: 'output', relation: 'generic-ir-edit' }],
});
const lists = {
  sourceEntities: TixIR.entities(q.current.value),
  targetEntities: TixIR.entities(inline.artifact.value),
};
const verify = entities =>
  new C.AnalysisManager().verifyTransformation({ input: q.current }, { output: inline.artifact }, mappingOnly, [
    { ...semanticCorrespondence(inline.correspondence), ...lists, entities },
  ]);
const src = re => lists.sourceEntities.filter(e => re.test(e)),
  dst = re => lists.targetEntities.filter(e => re.test(e));
console.log(`lists: ${JSON.stringify(lists)}`);
await tryVerify('default bothTotal, honest group (p,y -> y)', () =>
  verify([{ from: src(/\/(p|y)$/), to: dst(/\/y$/) }]),
);
await tryVerify('default bothTotal, zero groups', () => verify([]));
await tryVerify('default bothTotal, false group (surviving y mapped to nothing)', () =>
  verify([{ from: src(/\/y$/), to: [] }]),
);
await tryVerify("partial coverage, zero groups (a requirement that asks for nothing)", async () => {
  const partial = C.defineTransformation({
    id: 'probe.partial',
    version: '1',
    description: 'asks nothing of the mapping',
    inputs: { input: TixIR },
    outputs: { output: TixIR },
    correspondence: [
      { id: 'entities', from: 'input', to: 'output', relation: 'generic-ir-edit', coverage: 'partial' },
    ],
  });
  await new C.AnalysisManager().verifyTransformation(
    { input: q.current },
    { output: inline.artifact },
    partial,
    [{ ...semanticCorrespondence(inline.correspondence), ...lists, entities: [] }],
  );
});
await tryVerify('invalid coverage word is rejected at definition time', () => {
  C.defineTransformation({
    id: 'probe.bad-coverage',
    version: '1',
    description: 'typo in the vocabulary',
    inputs: { input: TixIR },
    outputs: { output: TixIR },
    correspondence: [{ id: 'entities', from: 'input', to: 'output', coverage: 'soure-total' }],
  });
});

// The two existing requirements in the repository still pass.
const { evaluate } = await import('../../../../../../dist/tensor/evaluate.js');
const engine = async (_source, f, cases) =>
  cases.map(inputs => ({ ...evaluate(f, inputs, 'f32'), gpuMs: 0 }));
const check = createCudaLowering('probe-f35-lowering', engine);
const lower = await check(q.current, 'f');
console.log(
  `cuda lowering (kernels requirement, targetTotal): accepted=${lower.accepted} relation=${lower.relation}`,
);
const subject = cudaArtifact('f', 'source', [{ name: 'k0', mapping: 'thread', statements: ['y'] }]);
await tryVerify('kernelCorrespondence record against the kernels requirement', async () => {
  const { CudaIR } = await import('../../../../../../dist/tensor/cuda-contract.js');
  const record = kernelCorrespondence(q.current, subject);
  const def = C.defineTransformation({
    id: 'probe.kernels',
    version: '1',
    description: 'the kernels requirement as the lowering declares it',
    inputs: { baseline: TixIR },
    outputs: { subject: CudaIR },
    correspondence: [
      {
        id: 'kernels',
        from: 'baseline',
        to: 'subject',
        relation: 'statements-to-kernels',
        coverage: 'targetTotal',
      },
    ],
  });
  await new C.AnalysisManager().verifyTransformation({ baseline: q.current }, { subject }, def, [record]);
});
await tryVerify('the same record under bothTotal demands more than the lowering claims', async () => {
  const { CudaIR } = await import('../../../../../../dist/tensor/cuda-contract.js');
  // A second function in the baseline: its statements are in the source universe, but the lowering of f
  // maps only f's statements, so full source coverage is not (and should not be) its claim.
  const two = compileTix(
    'fn f(x:f32[N]):f32[N] { y[i] = x[i] + 1; return y; } fn g(x:f32[N]):f32[N] { z[i] = x[i] * 2; return z; }',
  );
  const record = kernelCorrespondence(two.current, subject);
  const def = C.defineTransformation({
    id: 'probe.kernels-both',
    version: '1',
    description: 'if the lowering claimed full source coverage it would be caught',
    inputs: { baseline: TixIR },
    outputs: { subject: CudaIR },
    correspondence: [{ id: 'kernels', from: 'baseline', to: 'subject', coverage: 'bothTotal' }],
  });
  await new C.AnalysisManager().verifyTransformation({ baseline: two.current }, { subject }, def, [record]);
});
