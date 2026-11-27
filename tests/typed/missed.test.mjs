// IRWB-037-F: missed optimizations found from provenance: bce on a dominating check of the same index, the
// reassoc rules (verified, then applied by a checked pass), and the hot-statement view of the attribution.
import assert from 'node:assert/strict';
import test from 'node:test';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { benchCase } = await import('../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../dist/typed/backend/index.js');
const { hotSites } = await import('../../dist/typed/attribute.js');
const { REASSOC_RULES } = await import('../../dist/typed/rules/reassoc.js');
const { RULE_EVIDENCE } = await import('../../dist/typed/rules/evidence.js');
const { rule, op, v, kv, c } = await import('../../dist/typed/rules/form.js');
const { verifyRule, ruleFingerprint } = await import('../../dist/typed/rules/verify.js');

const source = `
function twice(i: i32): i32 {
    const a = new Int32Array(4);
    a[i] = 7;
    return a[i];
}
function moved(i: i32, c: i32): i32 {
    const a = new Int32Array(4);
    let j = i;
    a[j] = 7;
    if (c > 0) {
        j = j + 1;
    }
    return a[j];
}
function copyLoop(n: i32): i32 {
    const a = new Int32Array(6);
    const b = new Int32Array(6);
    let s = 0;
    for (let k = 0; k < n; k = k + 1) {
        b[k] = k;
        a[k] = b[k];
        b[k] = 0;
        s = s + a[k];
    }
    return s;
}
function bumpInLoop(n: i32, c: i32): i32 {
    const a = new Int32Array(6);
    let s = 0;
    let k = 0;
    while (k < n) {
        s = s + a[k];
        if (c > s) {
            k = k + 1;
        }
        s = s + a[k];
        k = k + 1;
    }
    return s;
}
function offsets(x: i32): i32 {
    return ((x + 3) + 4) + ((x + 1) << 2);
}
`;
const inputs = {
  twice: { i: [-2, 6] },
  moved: { i: [-2, 6], c: [-1, 1] },
  copyLoop: { n: [0, 8] },
  bumpInLoop: { n: [0, 8], c: [-3, 3] },
  offsets: { x: [-100, 100] },
};
const open = () =>
  Program.fromProject(
    projectSource('missed', {
      'main.typed': source,
      'project.json': JSON.stringify({ ingest: { tape: true }, inputs }),
    }),
  );
const checksIn = (p, fn) => (p.listing(fn).match(/>=u \d+\) goto/g) || []).length;

test('bce: a check dominated by a check of the same index and bound goes; a reassigned index keeps its check', async () => {
  const p = open();
  const before = Object.fromEntries(['twice', 'moved', 'copyLoop', 'bumpInLoop'].map(f => [f, checksIn(p, f)]));
  const r = await p.apply('bce', { count: 40 });
  assert.equal(r.rejected, undefined);
  const after = Object.fromEntries(Object.keys(before).map(f => [f, checksIn(p, f)]));
  assert.deepEqual(before, { twice: 2, moved: 2, copyLoop: 5, bumpInLoop: 2 });
  // twice: the load's check is the store's; copyLoop: a and b have the same length, so the first check of k in
  // an iteration covers the other four
  assert.deepEqual(after, { twice: 1, moved: 2, copyLoop: 1, bumpInLoop: 2 });
  // the replacement branch says which check proved it (its origin's note and because)
  const notes = p
    .edits()
    .filter(e => e.kind === 'replaceStmt')
    .map(e => p.lookup(e.to).entity.origin[0].note);
  assert.equal(notes.length, 5);
  assert.ok(notes.every(n => /already checked (i|k) against a bound no larger/.test(n)), notes.join('; '));
  assert.equal(p.check({ count: 200 }).status, 'agree');
});

test('reassoc: the three rules are proofs, recorded for their current fingerprints', () => {
  assert.deepEqual(
    REASSOC_RULES.rules.map(r => r.name),
    ['add-add-const', 'shl-add-const', 'add-inner-const'],
  );
  for (const r of REASSOC_RULES.rules) {
    const e = RULE_EVIDENCE[r.name];
    assert.equal(e.fingerprint, ruleFingerprint(r), r.name);
    assert.equal(e.verdict, 'sound', r.name);
    assert.equal(e.strength, 'proof', r.name);
    const again = verifyRule(r, { random: 2000, maxW8: 0 });
    assert.equal(again.strength, 'proof', r.name);
  }
});

test('reassoc: the symbolic-linear method refutes a wrong constant and an unmasked shift', () => {
  const X = { x: 'i32', a: 'i32', k: 'i32' };
  // (x + a) << k is not (x << k) + a
  const wrong = rule('shl-add-wrong', X, op('shl', op('add', v('x'), kv('a')), kv('k')), op('add', op('shl', v('x'), v('k')), v('a')));
  const e = verifyRule(wrong, { random: 2000, maxW8: 0 });
  assert.equal(e.verdict, 'unsound');
  // (x + a) * k → x * k + a * k is linear only for constant k: a symbolic k times a symbolic x is not linear,
  // so the method does not apply and the rule is only sampled
  const mul = rule('mul-add', X, op('mul', op('add', v('x'), kv('a')), kv('k')), op('add', op('mul', v('x'), v('k')), c({ eval: 'mul', args: ['a', 'k'] })));
  const m = verifyRule(mul, { random: 2000, maxW8: 0 });
  assert.equal(m.verdict, 'sound');
  assert.equal(m.strength, 'sampled');
});

test('reassoc: the pass moves constants outwards under the meaning check', async () => {
  const p = open();
  const r = await p.apply('reassoc', { count: 40 });
  assert.equal(r.changed, true);
  const text = p.listing('offsets');
  // (x + 3) + 4 is x + 7; (x + 1) << 2 is (x << 2) + 4, whose 4 then moves out of the sum
  assert.match(text, /return \(\(\(x \+ 7\) \+ \(x << 2\)\) \+ 4\)/);
  assert.equal(p.check({ count: 200 }).status, 'agree');
});

test('hotSites: the statements of the last revision sum to the emulator count, with their provenance', async () => {
  const p = open();
  await p.pipeline('speed', { count: 20 });
  const call = benchCase(storeOf(p.origin.value), 'copyLoop', { n: 6 });
  const h = hotSites(p.revisions, call);
  const run = runImage(lowerToImage(p.head).image, call.fn, call.args, call.memory);
  assert.equal(h.total, run.steps);
  assert.equal(h.sites.reduce((n, s) => n + s.count, 0), run.steps);
  for (const s of h.sites) assert.equal(s.insns.reduce((n, m) => n + m.count, 0), s.count, s.id);
  assert.ok(h.sites.some(s => s.decisions.some(d => / bce: replaceStmt/.test(d)) || s.decisions.length));
});
