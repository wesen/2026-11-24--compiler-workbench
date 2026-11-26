// IRWB-020-N: the meaning contract and the two passes (design §6, §7, §10.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../../dist/tensor/index.js';
import { applyPass, applyPassSync, PassError } from '../../dist/framework/passes/index.js';
import { AnalysisManager } from '../../dist/framework/contracts/index.js';

const corpus = name => T.compileTix(fs.readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const ALL = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
const SUMS = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp']; // programs with a one-axis sum
const apply = (pass, p, contract) => applyPassSync(pass, p, { contract, contractInputs: { origin: p } });
const rejected = (fn, check) =>
  assert.throws(fn, e => {
    assert.ok(e instanceof PassError && e.code === 'contractRejected', String(e));
    check?.(e.evidence.checks.at(-1).evidence);
    return true;
  });
const stmtCount = p => Object.keys(p.value.stmts).length;

test('inline is accepted under the exact relation wherever it fires, and removes the statement', () => {
  const fired = [];
  for (const name of ALL) {
    const p = corpus(name);
    const r = apply(T.inline, p);
    if (!r.changed) continue;
    fired.push(name);
    assert.equal(r.contract[0].invariant, 'tensor.exact-f32');
    assert.equal(r.contract[0].evidence.status, 'agree');
    assert.equal(stmtCount(r.artifact), stmtCount(p) - 1, name);
  }
  assert.deepEqual(fired, ['attention', 'mlp']); // p into o; g into y
});

test('inline follows chains in one application', () => {
  const p = T.compileTix(
    'fn f(x: f32[N]): f32[N] {\n a[i] = x[i] * 2;\n b[i] = a[i] + 1;\n c[i] = sum(j) b[j] * x[i];\n return c;\n}',
  );
  const r = apply(T.inline, p);
  assert.equal(stmtCount(r.artifact), 1);
  assert.equal(r.edits, 2);
});

test('split-sum: the exact relation rejects it, including on the wide case; the tolerance relation accepts it', () => {
  for (const name of SUMS) {
    const p = corpus(name);
    rejected(
      () => apply(T.splitSum, p, T.exactContract),
      ev => assert.ok(ev.counterexamples.some(c => c.case.n === 0), `${name}: the wide case changes bits`),
    );
    const ok = apply(T.splitSum, p);
    assert.ok(ok.changed, name);
    assert.equal(ok.contract[0].invariant, 'tensor.close-f64');
    assert.equal(ok.contract[0].evidence.status, 'agree');
    assert.equal(ok.contract[0].evidence.inconclusive, 0, name);
  }
});

test('split-sum leaves multi-axis sums alone and does not split its own blocks again', () => {
  assert.equal(apply(T.splitSum, corpus('conv2d')).changed, false);
  const once = apply(T.splitSum, corpus('matmul')).artifact;
  assert.equal(applyPassSync(T.splitSum, once, { contractInputs: { origin: once } }).changed, false);
});

test('the wrong variants are rejected', () => {
  rejected(() => apply(T.inlineWrong, corpus('mlp')));
  // the reassociation is exact over the reals: the tolerance relation alone would accept it
  assert.ok(apply(T.inlineWrong, corpus('mlp'), T.toleranceContract).changed);
  for (const name of SUMS) rejected(() => apply(T.splitSumWrong, corpus(name)));
});

test('optimizeTix runs the passes, keeps rejected steps out, and the result stays within the tolerance', () => {
  for (const name of ALL) {
    const p = corpus(name);
    const r = T.optimizeTix(p, ['inline', 'split-sum', 'inline']);
    assert.deepEqual(r.steps.map(s => s.accepted), [true, true, true], name);
    assert.ok(T.maxScaledError(p, r.program) <= T.TAU, name);
    const inputs = Object.fromEntries(
      Object.values(T.tensorCases(p.value, () => 0.5))
        .filter(c => c.n === 1)
        .flatMap(c => Object.entries(c.inputs)),
    );
    assert.deepEqual(T.runTix(r.program, name, inputs).shape, T.runTix(p, name, inputs).shape);
  }
  assert.throws(() => T.optimizeTix(corpus('matmul'), ['inline-wrong']), /unknown pass/);
});

test('the async path (applyPass with a manager) gives the same verdicts and revisions, with readable evidence', async () => {
  for (const name of ['matmul', 'attention', 'mlp']) {
    const p = corpus(name);
    for (const pass of [T.inline, T.splitSum]) {
      const sync = apply(pass, p);
      const viaManager = await applyPass(pass, p, { manager: new AnalysisManager(), contractInputs: { origin: p } });
      assert.equal(viaManager.artifact.revision, sync.artifact.revision, `${name} ${pass.id}`);
    }
    await assert.rejects(
      applyPass(T.splitSum, p, { manager: new AnalysisManager(), contract: T.exactContract, contractInputs: { origin: p } }),
      e => e instanceof PassError && e.code === 'contractRejected' && /sampled cases disagree/.test(e.message),
    );
  }
});

test('passes produce valid IR with a total correspondence', () => {
  const r = apply(T.splitSum, corpus('attention'));
  assert.equal(r.correspondence.from.revision, r.before.revision);
  assert.ok(r.correspondence.entries.some(e => e.relation === 'split' && e.to.length === 2));
  const i = apply(T.inline, corpus('mlp'));
  assert.ok(i.correspondence.entries.some(e => e.relation === 'inlined'));
  assert.ok(i.changes.entities.length > 0);
});
