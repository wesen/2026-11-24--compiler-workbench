import './02-source-loader.mjs';
import assert from 'node:assert/strict';

const root = new URL('../../../../../../', import.meta.url);
const source = path => import(new URL(path, root));
const { compileTix, optimizeTix } = await source('src/tensor/index.ts');
const { inlinePass } = await source('src/tensor/passes.ts');
const { adapter } = await source('src/tensor/ir.ts');
const { applyPass, applyNativePassSync } = await source('src/framework/passes/define-pass.ts');
const { AnalysisManager } = await source('src/framework/contracts/analysis-manager.ts');
const { assuranceOf, runDifferential, setDifferentialReuse } = await source(
  'src/framework/contracts/differential.ts',
);
const { IRStore, openIR } = await source('src/framework/ir/index.ts');

const program = compileTix('fn f(x:f32[N]):f32[N] { y[i] = x[i] * 2; z[i] = y[i] + 1; return z; }');
const { current } = program;
const optimized = optimizeTix(program, ['inline']);
assert.deepEqual(optimized.steps, [{ pass: 'inline', accepted: true, changed: true }]);
assert.throws(() => openIR(current, adapter).beginEdit(), { code: 'ir.capability' });
assert.throws(
  () => applyNativePassSync(inlinePass, current, () => ({ ok: false, reason: 'probe rejected' })),
  { code: 'contractRejected' },
);
const unguarded = await applyPass(inlinePass, current, { manager: new AnalysisManager() });
assert.equal(unguarded.artifact.revision, optimized.program.current.revision);
assert.equal(unguarded.contract, undefined);
const native = applyNativePassSync(inlinePass, current, () => ({ ok: true }));
console.log('inline: real Tix gate accepted; no rebuild; injected gate rejects; async apply has no gate');
console.log('inline correspondence:', JSON.stringify(native.correspondence.entries.map(
  ({ relation, from, to }) => ({ relation, from, to }),
)));
assert(!native.correspondence.entries.some(entry => entry.from.includes('f/y') && entry.to.length));

const store = new IRStore();
await assert.rejects(
  applyPass(inlinePass, current, { manager: new AnalysisManager(), store }),
  { code: 'ir.unpublished' },
);
assert.equal(store.head(current.id).revision, current.revision);
console.log('native pass with explicit store: ir.unpublished; base stays head');

const spec = {
  id: '038-a/baseline-key',
  version: '1',
  baseline: 'a',
  subject: 'b',
  count: 1,
  cases: () => [0],
  baselineKey: () => 'shared',
  run: (_, value, kase) => value + kase,
  compare: (left, right) => left === right,
};
setDifferentialReuse(false);
setDifferentialReuse(true);
const warm = runDifferential(spec, { a: 1, b: 1 }).status;
const aliased = runDifferential(spec, { a: 2, b: 1 }).status;
setDifferentialReuse(false);
const fresh = runDifferential(spec, { a: 2, b: 1 }).status;
assert.deepEqual([warm, aliased, fresh], ['agree', 'agree', 'disagree']);
assert.equal(assuranceOf(undefined), 'checked-exact');
console.log('identical cases, aliased baseline key: agree with reuse, disagree without reuse');
console.log('unclassified evidence:', assuranceOf(undefined));
