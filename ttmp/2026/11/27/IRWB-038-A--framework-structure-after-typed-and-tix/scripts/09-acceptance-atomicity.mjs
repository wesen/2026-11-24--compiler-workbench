import './02-source-loader.mjs';
import assert from 'node:assert/strict';

const root = new URL('../../../../../../', import.meta.url);
const source = path => import(new URL(path, root));
const { compileTix, optimizeTix } = await source('src/tensor/index.ts');
const { inlinePass } = await source('src/tensor/passes.ts');
const { TixIR } = await source('src/tensor/ir.ts');
const { applyPass, definePass } = await source('src/framework/passes/define-pass.ts');
const C = await source('src/framework/contracts/index.ts');

const program = compileTix('fn f(x:f32[N]):f32[N] { y[i] = x[i] * 2; z[i] = y[i] + 1; return z; }');
const after = optimizeTix(program, ['inline']).program.current;
const description = 'Probe the order of contract acceptance and pass-level preservation';
const count = C.defineAnalysis({
  id: '038-a/count', version: '1', description, input: TixIR, output: C.Integer,
  run: (_ctx, a) => a.value.functions[0].statements.length,
});
const check = C.defineAnalysis({
  id: '038-a/property-check', version: '1', description, input: TixIR, output: C.Check,
  run: (_ctx, a) => ({ ok: a.value.functions[0].statements.length === 1 }),
});
const property = C.defineProperty({ id: '038-a/property', version: '1', description, subject: TixIR, check });
const contract = C.defineTransformation({
  id: '038-a/establishes', version: '1', description,
  inputs: { input: TixIR }, outputs: { output: TixIR },
  establishes: [{ property, subject: { from: 'outputs', port: 'output' } }],
});

const manager = new C.AnalysisManager();
const badClaim = definePass({ ...inlinePass, contract, preserves: [count] });
assert.equal(manager.properties(after).length, 0);
await assert.rejects(
  applyPass(badClaim, program.current, { manager, auditPreservation: true }),
  { code: 'preserveViolated' },
);
assert.equal(manager.properties(after)[0].ok, true);
assert.equal(manager.snapshot().executions.at(-1).status, 'accepted');
console.log('pass rejected its false preservation claim after the contract published an accepted execution and candidate fact');

const staged = new C.AnalysisManager();
const prepared = await staged.verifyTransformation(
  { input: program.current }, { output: after }, contract, [], { deferCommit: true },
);
assert.equal(staged.properties(after).length, 0);
prepared.rollback('probe refused candidate');
assert.equal(staged.properties(after).length, 0);
console.log('deferred contract verification kept the same candidate fact private and permitted rollback');
