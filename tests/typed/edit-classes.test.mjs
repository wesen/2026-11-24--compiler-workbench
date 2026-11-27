// IRWB-035-G: the edit classifier (src/typed/edit-classes.ts): local value rewrites, structural edits, other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { lowerToImage } = await import('../../dist/typed/backend/index.js');
const EC = await import('../../dist/typed/edit-classes.js');

const open = id => Program.fromProject(projectSource(id, projectFiles(id)));
/** Every application of a program's timeline, classified, with instruction weights. */
const classified = p => {
  const images = p.revisions.map(r => lowerToImage(r.artifact).image.value);
  return p.revisions.slice(1).map((r, i) => {
    const app = { pass: r.pass, before: p.revisions[i].artifact.value, after: r.artifact.value, edits: r.edits };
    const edits = EC.classifyApplication(app);
    const weights = EC.instructionWeights(edits, images[i], images[i + 1]);
    const upper = EC.instructionWeights(edits, images[i], images[i + 1], { rebuilt: true });
    return { app, edits, weights, upper, images: [images[i], images[i + 1]] };
  });
};
const T = (op, ...args) => ({ op, imm: undefined, type: undefined, args });
const K = n => ({ op: 'const', imm: n, type: undefined, args: [] });
const G = i => ({ op: 'get', imm: i, type: undefined, args: [] });

// What each (pass, kind) of the built-in passes is expected to be: the simpler classifier the design did not choose.
const BY_PASS = {
  'simplify replace': 'local/rule', 'fold replace': 'local/rule',
  'constprop replace': 'local/fact', 'strength replace': 'local/fact', 'subst replace': 'local/fact',
  'licm replace': 'structural/motion', 'lvn replace': 'structural/motion',
  'licm insert': 'structural/motion', 'lvn insert': 'structural/motion',
  'licm local': 'structural/new-local', 'lvn local': 'structural/new-local',
  'dce remove': 'other/dead-statement', 'subst remove': 'other/dead-statement',
  // D2's speed passes (IRWB-037-G), added when A0 was merged after D2
  'copies replace': 'local/fact', 'subst-mem replace': 'local/fact', 'subst-mem remove': 'other/dead-statement',
  'identities replace': 'local/rule',
};
const expected = e =>
  BY_PASS[`${e.pass} ${e.kind}`] ?? (e.pass === 'inline' ? 'structural/inline' : 'structural/cfg');

test('rederive: a tree pair is an instance of a verified table, or it is not', () => {
  const x = G(0);
  const a = EC.rederive(T('add', T('mul', x, K(1)), K(0)), x);
  assert.deepEqual([a.table, a.fired, a.weakest], ['simplify', ['mul-one', 'add-zero'], 'proof']);
  const f = EC.rederive(T('mul', K(6), K(7)), K(42));
  assert.deepEqual([f.table, f.fired, f.weakest], ['fold', ['fold-mul'], 'by-construction']);
  assert.equal(EC.rederive(T('div', x, K(8)), T('shr', x, K(3))), undefined); // needs x >= 0: no table has it
  assert.equal(EC.rederive(x, x), undefined); // nothing fired
  // the pure guard: x - x is 0 only when x has no effect and cannot trap
  assert.equal(EC.rederive(T('sub', T('div', x, G(1)), T('div', x, G(1))), K(0)), undefined);
  assert.equal(EC.rederive(T('sub', x, x), K(0)).fired[0], 'sub-self');
});

test('blend under O2: the classes of each pass, by edits', async () => {
  const p = open('blend');
  await p.pipeline('O2');
  const rows = classified(p).map(({ app, edits }) => {
    const n = {};
    for (const e of edits) n[`${e.class}/${e.sub}`] = (n[`${e.class}/${e.sub}`] ?? 0) + 1;
    return [app.pass, n];
  });
  assert.deepEqual(rows, [
    ['cfg', { 'structural/cfg': 2 }],
    ['fold', { 'local/rule': 1 }],
    ['simplify', { 'local/rule': 1 }],
    ['constprop', { 'local/fact': 1 }],
    ['dce', { 'other/dead-statement': 1 }],
    ['licm', { 'structural/new-local': 1, 'structural/motion': 2 }],
  ]);
});

test('speed on six projects: classes agree with the per-pass table, rule edits re-derive, every change is accounted for', async () => {
  const seen = new Set();
  // dead-code: cfg replaces a constant branch by a `br` and merges it away in the same application
  for (const id of ['blend', 'strength', 'value-numbering', 'calls', 'algebra', 'dead-code']) {
    const p = open(id);
    await p.pipeline('speed');
    for (const { app, edits, weights, upper, images } of classified(p)) {
      for (const e of edits) {
        const got = `${e.class}/${e.sub}`;
        seen.add(got.split('/').slice(0, 2).join('/'));
        assert.ok(got.startsWith(expected(e)), `${id} ${e.id} ${e.pass} ${e.kind}: ${got}, expected ${expected(e)}`);
        if (e.sub === 'rule') assert.equal(e.rule.table, e.pass);
        if (e.sub === 'fact') assert.match(e.shape, / -> .* by /);
      }
      // the attribution accounts for the whole diff of values and statements
      const { before, after } = app;
      const claimed = new Set(edits.flatMap(e => [...e.removed, ...e.added, ...(e.rebuilt ?? [])]));
      const changed = [
        ...[...Object.keys(before.values), ...Object.keys(before.stmts)].filter(x => !(x in after.values) && !(x in after.stmts)),
        ...[...Object.keys(after.values), ...Object.keys(after.stmts)].filter(x => !(x in before.values) && !(x in before.stmts)),
      ];
      assert.deepEqual(changed.filter(x => !claimed.has(x)), [], `${id} ${app.pass}: unclaimed entities`);
      // an instruction counts at most once per image
      const total = upper.reduce((a, b) => a + b, 0);
      assert.ok(total <= images[0].insns.length + images[1].insns.length);
      weights.forEach((w, i) => assert.ok(w <= upper[i] || edits[i].class !== 'local'));
    }
  }
  for (const c of ['local/rule', 'local/fact', 'structural/cfg', 'structural/motion', 'structural/inline', 'other/dead-statement'])
    assert.ok(seen.has(c), `no ${c} edit seen`);
});

test('a pass with no table and no because: div-to-shift is local/uncited, with its shape', async () => {
  const p = open('wrong-shift');
  await p.apply('div-to-shift', { check: false });
  const r = p.revisions.at(-1);
  const edits = EC.classifyApplication({ pass: r.pass, before: p.revisions.at(-2).artifact.value, after: r.artifact.value, edits: r.edits });
  assert.ok(edits.length > 0);
  for (const e of edits) assert.deepEqual([e.class, e.sub, e.shape], ['local', 'uncited', 'div(get,#) -> shr(get,#)']);
  const t = EC.tallyInto(EC.emptyTally(), edits);
  assert.deepEqual([t.edits, t.byClass.local.edits, t.byClass.structural.edits], [edits.length, edits.length, 0]);
});
