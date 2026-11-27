// F27 probe: the meaning gate inside a strategy plan, before/after the fix.
// 1. optimizeTix uses the relation declared on the pass (not the pass name): the wrong pass below is rejected
//    under inline's declared 'exact' relation.
// 2. tixAlgorithm wraps the gate as a contract through the bridge: a wrong pass is rejected inside a plan
//    (attempt/fallback recovers), and a correct plan sequence agrees with optimizeTix's revisions.
const { compileTix, optimizeTix, runTix, tixAlgorithm } = await import('../../../../../../dist/tensor/index.js');
const { inlinePass, splitPass } = await import('../../../../../../dist/tensor/passes.js');
const { meaningGate } = await import('../../../../../../dist/tensor/contract.js');
const { applyNativePassSync, definePass } = await import('../../../../../../dist/framework/passes/index.js');
const S = await import('../../../../../../dist/framework/strategy/index.js');

const src = 'fn f(x:f32[N,K]):f32[N] { a[i,k] = x[i,k] * 2; y[i] = sum(k) a[i,k]; return y; }';
const p = compileTix(src);

// 1. the declared relation drives the gate: inline declared 'exact' rejects the wrong pass (a pass that lied
//    with 'tolerance' would still be caught on the 3x values, but 'exact' is what inline declares).
const wrong = definePass({
  ...inlinePass,
  id: 'probe.wrong',
  description: 'inline, but multiplies by 3',
  run: () => ({
    native: compileTix('fn f(x:f32[N,K]):f32[N] { y[i] = sum(k) x[i,k] * 3; return y; }').origin.value,
  }),
});
console.log('1. declared relations:', inlinePass.relation, splitPass.relation);
try {
  applyNativePassSync(wrong, p.current, meaningGate(p.origin, wrong.relation));
  console.log('1. wrong pass under its declared relation: ACCEPTED (unexpected)');
} catch (e) {
  console.log('1. wrong pass under its declared relation:', e.code, '-', String(e.message).slice(0, 70));
}

// 2. the gate inside a plan: wrong pass rejected (attempt falls back), correct sequence matches optimizeTix.
const keep = { id: 'keep', version: '1', kind: 'transform', description: 'identity', run: (_c, a) => a };
const reg = new S.AlgorithmRegistry()
  .register(tixAlgorithm(wrong, { origin: p.origin }))
  .register(tixAlgorithm(inlinePass, { origin: p.origin }))
  .register(tixAlgorithm(splitPass, { origin: p.origin }))
  .register(keep);
const tried = await S.execute(
  S.plan(
    't',
    S.attempt('try', S.apply('wrong', S.algorithm('probe.wrong')), S.apply('keep', S.algorithm('keep'))),
  ),
  reg,
  p.current,
);
console.log(
  '2a. wrong pass in attempt/fallback:',
  tried.status,
  '| result is the input:',
  tried.value?.revision === p.current.revision,
);
const seq = await S.execute(
  S.plan(
    's',
    S.sequence(
      'main',
      S.apply('inline', S.algorithm(inlinePass.id)),
      S.apply('split', S.algorithm(splitPass.id)),
    ),
  ),
  reg,
  p.current,
);
console.log(
  '2b. plan [inline, split-sum] vs optimizeTix:',
  seq.status,
  '| same revision:',
  seq.value?.revision === optimizeTix(p, ['inline', 'split-sum']).program.current.revision,
);
const inputs = { x: { shape: [1, 2], data: new Float32Array([1, 1]) } };
console.log(
  '2c. y(origin)',
  runTix(p, 'f', inputs).data[0],
  'y(plan result)',
  runTix({ origin: p.origin, current: seq.value }, 'f', inputs).data[0],
);
