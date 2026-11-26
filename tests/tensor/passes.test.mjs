// The two passes, their wrong variants, and the verdicts of the contract's two relations on each.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as API from '../../dist/tensor/index.js';
import { AnalysisManager } from '../../dist/framework/contracts/index.js';
import { applyPass, applyPassSync } from '../../dist/framework/passes/index.js';
import { checkMeaning, tensorContract } from '../../dist/tensor/contract.js';
import { applyChecked, PASSES, SPLIT_BLOCK, WRONG_PASSES } from '../../dist/tensor/passes.js';
import { CORPUS, corpusSource, fr, sameBits, tensor, values } from './helpers.mjs';

const { compileTix, runTix, optimizeTix } = API;
const ALL = { inline: PASSES.inline, 'split-sum': PASSES['split-sum'], 'wrong-inline': WRONG_PASSES.inline, 'wrong-split-sum': WRONG_PASSES.splitSum };
/** 'accepted' | 'rejected' | 'unchanged' for a pass on a program under a relation, through applyPassSync. */
function verdict(program, entry, relation) {
  let checked = false;
  try {
    const r = applyPassSync(entry.pass, program.current, {
      check: ({ input, output }) => ((checked = true), checkMeaning(relation, { origin: program.origin, input, output })),
    });
    return r.changed ? 'accepted' : 'unchanged';
  } catch (e) {
    assert.equal(e.code, 'contractRejected', e.message);
    assert.ok(checked);
    return 'rejected';
  }
}

test('the API exports exactly the fixed functions, and the public table has no wrong pass', () => {
  assert.deepEqual(Object.keys(API).sort(), ['compileTix', 'optimizeTix', 'runTix']);
  assert.deepEqual(Object.keys(PASSES), ['inline', 'split-sum']);
  const p = compileTix(corpusSource('mlp'));
  assert.throws(() => optimizeTix(p, ['wrong-inline']), /unknown pass 'wrong-inline'/);
  assert.throws(() => optimizeTix(p, ['wrong-split-sum']), /unknown pass/);
});

// which passes change which corpus program (conv2d: its sum has three indices and nothing is pointwise)
const APPLIES = {
  attention: ['inline', 'split-sum', 'wrong-inline', 'wrong-split-sum'],
  conv2d: [],
  layernorm: ['inline', 'split-sum', 'wrong-split-sum'], // its inlinable statement has rank 1: wrong-inline is inline
  matmul: ['split-sum', 'wrong-split-sum'],
  mlp: ['inline', 'split-sum', 'wrong-inline', 'wrong-split-sum'],
  softmax: ['split-sum', 'wrong-split-sum'],
};
const EXPECTED = {
  inline: { exact: 'accepted', tolerance: 'accepted' },
  'split-sum': { exact: 'rejected', tolerance: 'accepted' },
  'wrong-inline': { exact: 'rejected', tolerance: 'rejected' },
  'wrong-split-sum': { exact: 'rejected', tolerance: 'rejected' },
};
test('verdicts on the corpus: exact rejects split-sum, tolerance accepts it, both reject the wrong variants', () => {
  for (const name of CORPUS) {
    const program = compileTix(corpusSource(name));
    for (const [pass, entry] of Object.entries(ALL))
      for (const relation of ['exact', 'tolerance']) {
        const want = APPLIES[name].includes(pass) ? EXPECTED[pass][relation] : 'unchanged';
        if (name === 'layernorm' && pass === 'wrong-inline') {
          assert.equal(verdict(program, entry, relation), 'accepted');
          continue;
        }
        assert.equal(verdict(program, entry, relation), want, `${name}: ${pass} under ${relation}`);
      }
  }
});

test('inline substitutes subscripts, affine ones included, and changes no bit', () => {
  const p = compileTix(`fn f(x: f32[N], z: f32[N, N]): f32[N - 1] {
    t[i] = x[i] * 2;
    u[a, b] = z[a, b] - t[b];
    y[j]: f32[N - 1] = u[j + 1, j + 1] * 3;
    return y;
  }`);
  const { program, steps } = optimizeTix(p, ['inline']);
  assert.deepEqual(steps, [{ pass: 'inline', accepted: true, changed: true, relation: 'exact' }]);
  const f = program.current.value.fns.f;
  assert.deepEqual(f.stmts.map(s => s.name), ['y']);
  // u[j + 1, j + 1] with u[a, b] = z[a, b] - t[b] and t[i] = x[i] * 2
  const at = c => ({ c, terms: { j: 1 } });
  assert.deepEqual(f.stmts[0].expr, {
    k: 'bin', op: '*',
    a: { k: 'bin', op: '-',
      a: { k: 'ref', tensor: 'z', at: [at(1), at(1)] },
      b: { k: 'bin', op: '*', a: { k: 'ref', tensor: 'x', at: [at(1)] }, b: { k: 'lit', value: 2 } } },
    b: { k: 'lit', value: 3 },
  });
  const next = values(11), inputs = { x: tensor([5], next), z: tensor([5, 5], next) };
  assert.ok(sameBits(runTix(program, 'f', inputs).data, runTix(p, 'f', inputs).data));
  assert.equal(program.origin, p.origin);
  // nothing left to inline
  assert.deepEqual(optimizeTix(program, ['inline']).steps, [{ pass: 'inline', accepted: true, changed: false, relation: 'exact' }]);
});

test('inline leaves statements with two uses, with a reduction, and the result alone', () => {
  const p = compileTix(corpusSource('softmax'));
  const r = optimizeTix(p, ['inline']);
  assert.equal(r.steps[0].changed, false);
  assert.equal(r.program, p);
});

test('wrong-inline on a square rank-2 statement reads the transposed element and is rejected on values', () => {
  const p = compileTix(`fn f(x: f32[N, N]): f32[N, N] { t[i, j] = x[i, j] * 2; y[i, j] = t[i, j] + 1; return y; }`);
  for (const relation of ['exact', 'tolerance']) {
    const { step, program } = applyChecked(p, WRONG_PASSES.inline, relation);
    assert.equal(step.accepted, false);
    assert.match(step.reason, /cases disagree; f#\d+: element \d+ is /);
    assert.equal(program, p);
    assert.equal(applyChecked(p, PASSES.inline, relation).step.accepted, true);
  }
});

test('split-sum is the blocked sum, for extents below, at and above the block, with and without a partial block', () => {
  const p = compileTix('fn f(x: f32[N]): f32[1] { y[i]: f32[1] = sum(j) x[j]; return y; }');
  const { program, steps } = optimizeTix(p, ['split-sum']);
  assert.deepEqual(steps, [{ pass: 'split-sum', accepted: true, changed: true, relation: 'tolerance' }]);
  const e = program.current.value.fns.f.stmts[0].expr;
  assert.deepEqual(e.indices, [{ name: 'j_b', extent: { k: 'ceildiv', a: { k: 'aff', aff: { c: 0, terms: { N: 1 } } }, by: 4 } }]);
  assert.deepEqual(e.body.indices, [{ name: 'j_i', extent: { k: 'min', a: { k: 'aff', aff: { c: 4, terms: {} } }, b: { k: 'aff', aff: { c: 0, terms: { N: 1, j_b: -4 } } } } }]);
  assert.deepEqual(e.body.body, { k: 'ref', tensor: 'x', at: [{ c: 0, terms: { j_b: 4, j_i: 1 } }] });
  let reassociated = 0;
  for (const N of [1, 3, 4, 5, 8, 11]) {
    const x = tensor([N], values(20 + N));
    let want = 0, seq = 0;
    for (let b = 0; b * SPLIT_BLOCK < N; b++) {
      let block = 0;
      for (let j = b * SPLIT_BLOCK; j < Math.min(N, (b + 1) * SPLIT_BLOCK); j++) block = fr(block + x.data[j]);
      want = fr(want + block);
    }
    for (let j = 0; j < N; j++) seq = fr(seq + x.data[j]);
    assert.ok(Object.is(runTix(program, 'f', { x }).data[0], want), `N = ${N}`);
    assert.ok(Object.is(runTix(p, 'f', { x }).data[0], seq));
    if (!Object.is(want, seq)) reassociated++;
    // the f64 reference is reassociated too, by far less than the f32 change
    assert.ok(Math.abs(runTix(program, 'f', { x }, { precision: 'f64' }).data[0] - runTix(p, 'f', { x }, { precision: 'f64' }).data[0]) < 1e-12);
  }
  assert.ok(reassociated > 0, 'some extent shows the f32 change');
  // already split: nothing to do
  assert.equal(optimizeTix(program, ['split-sum']).steps[0].changed, false);
});

test('split-sum avoids index names in use and splits nested sums', () => {
  const p = compileTix(`fn f(x: f32[N, M]): f32[N] {
    y[j_b] = sum(j) x[j_b, j] * (sum(j_i) x[j_i, j]);
    return y;
  }`);
  const { program, steps } = optimizeTix(p, ['split-sum']);
  assert.equal(steps[0].accepted, true);
  const names = [];
  const walk = e => {
    if (e.k === 'reduce') (names.push(...e.indices.map(i => i.name)), walk(e.body));
    else if (e.k === 'bin') (walk(e.a), walk(e.b));
  };
  walk(program.current.value.fns.f.stmts[0].expr);
  assert.equal(names.length, 4);
  assert.equal(new Set([...names, 'j_b']).size, 5, `distinct names: ${names}`);
});

test('wrong-split-sum drops the partial last block: accepted nowhere, visible exactly when 4 does not divide N', () => {
  const p = compileTix('fn f(x: f32[N]): f32[1] { y[i]: f32[1] = sum(j) x[j]; return y; }');
  for (const relation of ['exact', 'tolerance']) assert.equal(verdict(p, WRONG_PASSES.splitSum, relation), 'rejected');
  // on a domain of multiples of 4 only it would pass: the check domain has to contain the other extents
  const wrong = applyPassSync(WRONG_PASSES.splitSum.pass, p.current, { check: () => ({ ok: true }) }).artifact;
  const run = (N, art) => runTix({ origin: p.origin, current: art }, 'f', { x: tensor([N], values(N)) }).data[0];
  const right = optimizeTix(p, ['split-sum']).program.current;
  for (const N of [4, 8]) assert.ok(Object.is(run(N, wrong), run(N, right)));
  for (const N of [1, 3, 5, 7]) assert.ok(!Object.is(run(N, wrong), run(N, right)));
});

test('a pipeline: inline stays exact after an accepted split-sum, and the result runs', () => {
  for (const name of ['mlp', 'attention', 'layernorm']) {
    const p = compileTix(corpusSource(name));
    const { program, steps } = optimizeTix(p, ['split-sum', 'inline']);
    assert.deepEqual(steps, [
      { pass: 'split-sum', accepted: true, changed: true, relation: 'tolerance' },
      { pass: 'inline', accepted: true, changed: true, relation: 'exact' },
    ], name);
    // inline compared with the origin would be rejected here: the split changed bits
    const split = optimizeTix(p, ['split-sum']).program;
    const inlined = applyPassSync(PASSES.inline.pass, split.current, { check: () => ({ ok: true }) }).artifact;
    assert.equal(checkMeaning('exact', { origin: p.origin, input: p.origin, output: inlined }).ok, false);
    assert.equal(checkMeaning('exact', { origin: p.origin, input: split.current, output: inlined }).ok, true);
    assert.equal(program.current.revision, inlined.revision);
  }
  const p = compileTix(corpusSource('mlp'));
  const { program } = optimizeTix(p, ['inline', 'split-sum']);
  const next = values(31);
  const inputs = { x: tensor([3, 6], next), w1: tensor([6, 7], next), b1: tensor([7], next), w2: tensor([7, 6], next), b2: tensor([6], next) };
  const before = runTix(p, 'mlp', inputs), after = runTix(program, 'mlp', inputs), ref = runTix(p, 'mlp', inputs, { precision: 'f64' });
  assert.deepEqual(after.shape, before.shape);
  assert.ok(!sameBits(after.data, before.data));
  for (let i = 0; i < ref.data.length; i++) assert.ok(Math.abs(after.data[i] - ref.data[i]) < 1e-4 * Math.max(1, Math.abs(ref.data[i])));
});

test('the manager path (applyPass with tensorContract) gives the same verdicts, with the check as the reason', async () => {
  const manager = new AnalysisManager(); // one manager for every application: the contract objects must be stable
  for (const name of ['mlp', 'softmax']) {
    const p = compileTix(corpusSource(name));
    for (const [pass, entry] of Object.entries(ALL))
      for (const relation of ['exact', 'tolerance']) {
        const sync = verdict(p, entry, relation);
        let viaManager;
        try {
          const r = await applyPass(entry.pass, p.current, { manager, contract: tensorContract(relation), contractInputs: { origin: p.origin } });
          viaManager = r.changed ? 'accepted' : 'unchanged';
        } catch (e) {
          assert.equal(e.code, 'contractRejected', e.message);
          // the rejection is the meaning check's, not a registry or encoding failure
          assert.match(e.message, /sampled cases disagree/, `${name} ${pass} ${relation}`);
          viaManager = 'rejected';
        }
        assert.equal(viaManager, sync, `${name}: ${pass} under ${relation}`);
      }
  }
});

test('the framework records what a pass did: statement entities only, and a merge correspondence', () => {
  const p = compileTix(corpusSource('mlp'));
  const r = applyPassSync(PASSES.inline.pass, p.current, { check: io => checkMeaning('exact', { origin: p.origin, ...io }) });
  assert.deepEqual(r.changes.entities.map(c => `${c.kind} ${c.entity}`).sort(), ['removed stmt:mlp/g', 'updated stmt:mlp/y']);
  const merge = r.correspondence.entries.find(e => e.relation === 'merge');
  assert.deepEqual([merge.from, merge.to], [['stmt:mlp/g', 'stmt:mlp/y'], ['stmt:mlp/y']]);
  assert.equal(r.contract.ok, true);
  assert.equal(r.contract.evidence.method, 'sampled');
});
