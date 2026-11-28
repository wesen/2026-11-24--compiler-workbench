// IRWB-060-A: Tix's two passes are rules over the expression signature through the term library
// (src/stdlib/term/). The revisions they give must be the ones the hand-written rewrites gave: the
// table below records, for every corpus program, the revision after `inline` and after `split-sum`
// (as of IRWB-060-A; the coordinator's baselines check keeps them byte-identical), and the test
// also asserts what the rules claim: `inline` merges exactly the single-use pointwise statements
// (each merge recorded, its statement gone, the consumer rewritten), and `split-sum` leaves no
// one-axis dimension-bound `sum` anywhere in the program, because the rule rewrote each of them
// into a sum over blocks of a sum over lanes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileTix, optimizeTix } from '../../dist/tensor/index.js';
import { inlinePass, splitPass } from '../../dist/tensor/passes.js';
import { applyNativePassSync } from '../../dist/framework/passes/index.js';

const PROGRAMS = ['attention', 'conv2d', 'layernorm', 'matmul', 'mlp', 'softmax'];

/** The revisions after each pass, recorded at IRWB-060-A (when the passes became rules on the library). */
const AFTER_INLINE = {
  attention: 'ceccad1db59135336ea1e11d1958e7278701c8d5913babb1a532904da0b233a9',
  conv2d: '272d5a92596009f7df05f194b8575a7ab753a3101342d79c24686f2a75fdb839',
  layernorm: '50365cbf1844d6de1483c1a3f326e78a6b07fc47b9d1947d004d90c0b69fdb13',
  matmul: '3c3df835a9465f69e5e3e5b6151951c96436686666d1822fa8d18125c2e3ec68',
  mlp: 'a5ab646cc7b4fea8281196e7b47e28d2ebfb7888e770b72486e3e684056f5cd4',
  softmax: 'e9a18d4c0cacc1d5b0a39ad948e3ce294384a5c3a61ee865997d88ed8fb91dcf',
};
const AFTER_SPLIT = {
  attention: '2dafdec2f6ef275a272a6361778280cdc7ce0f1d109d5927884eac834303336a',
  conv2d: '272d5a92596009f7df05f194b8575a7ab753a3101342d79c24686f2a75fdb839',
  layernorm: '43605adeb821c9fc756028b47571be5124f785745f81fc68e311f814c266abac',
  matmul: '6b7b3fc174f672153deae8e86aaae4eb1d1a5ce6ec8413dc940cee36f1a9a5c6',
  mlp: '884a4a424537bd0990704a54d40e099bff4188cca4a9e57fc45db9b59372524c',
  softmax: '917cb8519ccbc5fd9c32d19ea51afbc03a441abc4f7e2a7bcec1b6a4369587bc',
};

const program = name =>
  compileTix(readFileSync(new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url), 'utf8'));

test('IRWB-060-A: every corpus program optimizes to the recorded revisions through the two rules', () => {
  const ok = () => ({ ok: true });
  for (const name of PROGRAMS) {
    const p = program(name);
    const inlined = applyNativePassSync(inlinePass, p.current, ok);
    assert.ok(inlined.changed === (name === 'attention' || name === 'mlp'), `${name}: inline changes only these`);
    assert.equal(inlined.artifact.revision, AFTER_INLINE[name], `${name}: after inline`);
    const split = applyNativePassSync(splitPass, inlined.artifact, ok);
    assert.equal(split.artifact.revision, AFTER_SPLIT[name], `${name}: after split-sum`);
    // and the plan runs the same two passes to the same end revision
    const optimized = optimizeTix(p, ['inline', 'split-sum']);
    assert.ok(optimized.steps.every(s => s.accepted), `${name}: both passes accepted`);
    assert.equal(optimized.program.current.revision, AFTER_SPLIT[name], `${name}: the plan agrees`);
  }
});

/** The single-use pointwise statements of a function, by the driver's own analysis (name -> consumer). */
function expectedMerges(fn) {
  const statements = [...fn.statements];
  const readsOf = (expr, name) => {
    let n = 0;
    const visit = e => {
      if (e.kind === 'load' && e.name === name) n++;
      if (e.kind === 'op') e.args.forEach(visit);
      if (e.kind === 'reduce') visit(e.body);
    };
    visit(expr);
    return n;
  };
  const merges = new Map();
  for (let i = 0; i < statements.length; i++) {
    const p = statements[i];
    if (p.name === fn.result) continue;
    let pointwise = true;
    const walk = e => {
      if (e.kind === 'reduce') pointwise = false;
      if (e.kind === 'op') e.args.forEach(walk);
      if (e.kind === 'reduce') walk(e.body);
    };
    walk(p.expr);
    if (!pointwise) continue;
    const consumers = [];
    for (let j = i + 1; j < statements.length; j++)
      if (readsOf(statements[j].expr, p.name)) consumers.push(statements[j]);
    const uses = consumers.reduce((n, s) => n + readsOf(s.expr, p.name), 0);
    if (uses === 1) merges.set(p.name, consumers[0].name);
  }
  return merges;
}

test('IRWB-060-A: inline merges exactly the single-use pointwise statements, and removes them', () => {
  for (const name of PROGRAMS) {
    const p = program(name),
      r = applyNativePassSync(inlinePass, p.current, () => ({ ok: true }));
    for (const fn of p.current.value.functions) {
      const want = expectedMerges(fn);
      const got = new Map(
        (r.derivation?.steps ?? [])
          .filter(s => s.relation === 'merged')
          .map(s => [s.consumes[0].split('/')[1], s.produces[0].split('/')[1]]),
      );
      assert.deepEqual([...got].sort(), [...want].sort(), `${name}/${fn.name}`);
      // every merged statement is gone, its consumer stays, and no other statement changed count
      const out = r.artifact.value.functions.find(f => f.name === fn.name);
      assert.equal(out.statements.length, fn.statements.length - want.size, `${name}/${fn.name}`);
      for (const [from, into] of want) {
        assert.ok(!out.statements.some(s => s.name === from), `${name}: ${from} removed`);
        assert.ok(out.statements.some(s => s.name === into), `${name}: ${into} stays`);
      }
    }
    // and the correspondence says the merge (F40)
    for (const step of r.derivation?.steps ?? []) {
      const entry = r.correspondence.entries.find(e => e.from.includes(step.consumes[0]));
      assert.deepEqual(
        [entry.relation, entry.to],
        ['merged', [step.produces[0]]],
        `${name}: ${step.consumes[0]} merged into ${step.produces[0]}`,
      );
    }
  }
});

test('IRWB-060-A: split-sum leaves no one-axis dimension-bound sum, on every corpus program', () => {
  let totalMatched = 0;
  for (const name of PROGRAMS) {
    const p = program(name),
      r = applyNativePassSync(splitPass, p.current, () => ({ ok: true }));
    const count = (module, kind) =>
      module.functions
        .flatMap(f => f.statements)
        .reduce((n, s) => {
          const walk = e => {
            if (e.kind === 'op') e.args.forEach(walk);
            if (e.kind === 'reduce') {
              walk(e.body);
              if (kind(e)) n++;
            }
          };
          walk(s.expr);
          return n;
        }, 0);
    // what the rule matches: one axis, a dimension bound — all of them are gone after the pass, and
    // each split made the pair the template builds: a blocks-bound sum over a tail-bound sum, one pair
    // per matched reduction (conv2d's sums have two axes: the rule matches none)
    const matched = count(
      p.current.value,
      e => e.op === 'sum' && e.axes.length === 1 && e.axes[0].extent.kind === 'dim',
    );
    totalMatched += matched;
    assert.equal(
      count(r.artifact.value, e => e.op === 'sum' && e.axes.length === 1 && e.axes[0].extent.kind === 'dim'),
      0,
      `${name}: every matched sum was split`,
    );
    const pairs = count(
      r.artifact.value,
      e => e.op === 'sum' && e.axes[0].extent.kind === 'blocks' && e.body.op === 'sum' && e.body.axes[0].extent.kind === 'tail',
    );
    assert.equal(pairs, matched, `${name}: one split pair per matched reduction`);
  }
  assert.ok(totalMatched > 0, 'the corpus gives the rule something to split');
});
