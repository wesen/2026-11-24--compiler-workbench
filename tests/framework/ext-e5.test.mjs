// IRWB-001 E5: differential checkers as v6 invariants, with sampled-assurance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalysisManager,
  createArtifact,
  defineTransformation,
  differential,
  runDifferential,
  seededRandom,
  assuranceOf,
} from '../../dist/framework/contracts/index.js';
import { ExpressionIR, exampleExpression, evaluateExpression } from '../../dist/labs/expressions.js';

const variablesOf = p => [...new Set(Object.values(p.nodes).filter(n => n.op === 'variable').map(n => n.name))].sort();
const sameMeaning = (spec = {}) =>
  differential({
    id: 'test.expression-agrees', version: '1', description: 'candidate evaluates like origin on sampled environments',
    inputs: { origin: ExpressionIR, candidate: ExpressionIR }, baseline: 'origin', subject: 'candidate', count: 40, seed: 7,
    cases: ({ origin }, random, count) =>
      Array.from({ length: count }, () => Object.fromEntries(variablesOf(origin.value).map(v => [v, Math.floor(random() * 200) - 100]))),
    run: (_side, art, env) => evaluateExpression(art.value, env),
    compare: (a, b) => (a === b ? true : { ok: false, reason: `${a} != ${b}` }),
    ...spec,
  });

// 2*x*x + 2*y written differently: (x*x)*2 + y*2 -- same meaning.
const rewritten = () => ({
  root: 'sum',
  nodes: { x: { op: 'variable', name: 'x' }, y: { op: 'variable', name: 'y' }, two: { op: 'constant', value: 2 },
    sq: { op: 'mul', args: ['x', 'x'] }, a: { op: 'mul', args: ['sq', 'two'] }, b: { op: 'mul', args: ['y', 'two'] }, sum: { op: 'add', args: ['a', 'b'] } },
});
// wrong: 2*x*x + y
const wrong = () => ({ ...rewritten(), nodes: { ...rewritten().nodes, sum: { op: 'add', args: ['a', 'y'] } } });

test('E5: the seeded generator is deterministic', () => {
  const a = seededRandom(3), b = seededRandom(3);
  const xs = Array.from({ length: 5 }, a), ys = Array.from({ length: 5 }, b);
  assert.deepEqual(xs, ys);
  assert.ok(xs.every(x => x >= 0 && x < 1));
});

test('E5: a correct rewrite agrees on every sampled case; a wrong one yields counterexamples', async () => {
  const manager = new AnalysisManager(), check = sameMeaning(); // one definition object per id@version
  const origin = createArtifact(ExpressionIR, 'e', exampleExpression());
  const good = await manager.checkInvariant(check, { origin, candidate: createArtifact(ExpressionIR, 'e', rewritten()) });
  assert.equal(good.ok, true, good.reason);
  assert.equal(good.evidence.method, 'sampled');
  assert.equal(good.evidence.agree, 40);
  assert.equal(assuranceOf(good.evidence), 'checked-sampled');
  const bad = await manager.checkInvariant(check, { origin, candidate: createArtifact(ExpressionIR, 'e', wrong()) });
  assert.equal(bad.ok, false);
  assert.ok(bad.evidence.disagree > 0);
  assert.equal(bad.evidence.counterexamples.length, 5);
  assert.match(bad.evidence.counterexamples[0].reason, /!=/);
});

test('E5: inconclusive cases are counted, never a verdict; all-inconclusive fails', () => {
  const origin = createArtifact(ExpressionIR, 'e', exampleExpression());
  const spec = { ...sameMeaning(), inputs: { origin: ExpressionIR, candidate: ExpressionIR } };
  const half = runDifferential(
    { ...spec, baseline: 'origin', subject: 'candidate', count: 10, cases: (_i, r, n) => Array.from({ length: n }, (_, k) => ({ x: k, y: 1 })),
      run: (_s, art, env) => (env.x % 2 ? 'limit' : evaluateExpression(art.value, env)), compare: (a, b) => a === b, inconclusive: o => o === 'limit' },
    { origin, candidate: origin },
  );
  assert.deepEqual([half.agree, half.inconclusive, half.status], [5, 5, 'agree']);
  const none = runDifferential(
    { ...spec, baseline: 'origin', subject: 'candidate', count: 3, cases: (_i, r, n) => Array.from({ length: n }, () => ({ x: 1, y: 1 })), run: () => 'limit', compare: () => true, inconclusive: () => true },
    { origin, candidate: origin },
  );
  assert.equal(none.status, 'inconclusive');
});

test('E5: a transformation contract can ensure a differential invariant', async () => {
  const manager = new AnalysisManager();
  const contract = defineTransformation({
    id: 'test.rewrite', version: '1', description: 'a rewrite must keep sampled meaning',
    inputs: { input: ExpressionIR }, outputs: { output: ExpressionIR },
    ensures: [{ invariant: sameMeaning(), bindings: { origin: { from: 'inputs', port: 'input' }, candidate: { from: 'outputs', port: 'output' } } }],
  });
  const input = createArtifact(ExpressionIR, 'e', exampleExpression());
  const ok = await manager.verifyTransformation({ input }, { output: createArtifact(ExpressionIR, 'e', rewritten()) }, contract);
  assert.ok(ok);
  await assert.rejects(manager.verifyTransformation({ input }, { output: createArtifact(ExpressionIR, 'e', wrong()) }, contract), /disagree/);
});

test('baseline key rejects cases that change outside the key', () => {
  let outside = 1;
  const spec = {
    id: 'test.key-contract', version: '1', count: 1, seed: 1,
    baseline: 'origin', subject: 'candidate', baselineKey: () => 'fixed-key',
    cases: () => [{ outside }], run: (_side, _art, c) => c.outside, compare: (a, b) => a === b,
  };
  const origin = createArtifact(ExpressionIR, 'e', exampleExpression());
  const inputs = { origin, candidate: origin };
  assert.equal(runDifferential(spec, inputs).status, 'agree');
  assert.equal(runDifferential(spec, inputs).status, 'agree');
  outside = 2;
  assert.throws(() => runDifferential(spec, inputs), /fixed-key/);
});

test('baseline key checks typed arrays and signed zero using a stored snapshot', () => {
  const memory = new Uint8Array([1, 2]);
  let value = -0;
  const spec = {
    id: 'test.key-typed-data', version: '1', count: 1, baseline: 'origin', subject: 'candidate',
    baselineKey: () => 'typed-key', cases: () => [{ memory, value }], run: () => 1, compare: () => true,
  };
  const origin = createArtifact(ExpressionIR, 'e', exampleExpression());
  const inputs = { origin, candidate: origin };
  runDifferential(spec, inputs);
  value = 0;
  assert.throws(() => runDifferential(spec, inputs), e => e.name === 'ContractError' && /typed-key/.test(e.message));
  value = -0;
  memory[0] = 3;
  assert.throws(() => runDifferential(spec, inputs), e => e.name === 'ContractError' && /typed-key/.test(e.message));
});
