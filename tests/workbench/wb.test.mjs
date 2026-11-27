// The wb layer on the kernel: Compiler Workbench's API for scripts, the console, the agent and the views.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWb, widest } from './helpers.mjs';

test('wb: Blend at O2 shows the hoisted statement, an 88-byte image and its why chain', async () => {
  const { wb } = makeWb();
  const pr = wb.projects.open('blend');
  const p = wb.current;
  const r = await pr.run('explore');
  assert.deepEqual(r.bytes, [96, 88]);
  assert.equal(p.rev, 'r6');
  assert.ok(p.listing('blend').split('\n').some(l => /^\s*s:blend\.15\s+inv = \(\(a \* b\) \+ 64\)/.test(l)));
  const img = p.compile();
  assert.equal(img.id, 'img:blend@r6');
  assert.equal(img.bytes, 88);
  const why = p.why('s:blend.15');
  assert.equal(why.via, 'licm');
  assert.equal(why.from.via, 'constprop');
  assert.deepEqual(why.because, ['loop:blend@bb:blend.1']);
  // an instruction id resolves against the image compiled last
  const rel = p.related('s:blend.15');
  assert.ok(rel.insns.length >= 2 && rel.insns.every(i => /^insn:blend\+0x/.test(i)));
});

test('wb.sync: passes are synchronous inside a replay context, and Promises outside it', async () => {
  const { wb } = makeWb();
  wb.projects.open('blend');
  const free = wb.current.apply('fold');
  assert.ok(free && typeof free.then === 'function');
  await free;
  wb.current.checkout(0);
  let attempts = 0;
  const out = await wb.sync(({ p }) => {
    attempts++;
    const a = p.apply('cfg');
    const b = p.apply('fold');
    return { a: a.rev, b: b.rev, rev: p.rev };
  });
  assert.deepEqual(out, { a: 'r1', b: 'r2', rev: 'r2' });
  assert.equal(attempts, 3); // two new passes: two suspensions, then the attempt that completes
  // read-only contexts refuse changes
  // (a refusal on the first attempt throws at once; later ones reject: either way the caller sees it)
  await assert.rejects(async () => wb.sync(({ p }) => p.apply('dce'), { readOnly: true }), e => e.code === 'readOnly');
});

test('wb: the gate is the kernel contract; a rejected pass changes nothing', async () => {
  const { wb } = makeWb();
  wb.projects.open('wrong-shift');
  await assert.rejects(wb.current.apply('div-to-shift'), e => e.code === 'contractRejected');
  assert.equal(wb.current.rev, 'r0');
  const r = await wb.current.apply('div-to-shift', { check: false });
  assert.equal(r.changed, true);
  assert.equal(wb.current.check({ count: 40 }).status, 'disagree');
});

test('projects: browser-local edits over the built-in files, kept in storage, and reset', async () => {
  const storage = new Map();
  const { wb } = makeWb({ storage });
  const pr = wb.projects.open('blend');
  pr.files.write('notes.md', 'mine\n');
  assert.equal(pr.files.read('notes.md'), 'mine\n');
  assert.ok(pr.files.list().find(f => f.path === 'notes.md').edited);
  assert.match(storage.get('wb.projects.v1'), /mine/);
  // a second root on the same storage sees the edit
  const again = makeWb({ storage }).wb;
  assert.equal(again.projects.get('blend').files.read('notes.md'), 'mine\n');
  pr.reset();
  assert.notEqual(pr.files.read('notes.md'), 'mine\n');
});

test('projects: project.json the workbench writes fits a tile; prose read back as one string', () => {
  const { wb } = makeWb();
  const about =
    'A project made from the workbench to see that a long description is written as lines, ' +
    'each short enough for a tile, and read back as the same text.';
  wb.projects.create('narrow', { title: 'Narrow', about });
  const text = wb.projects.get('narrow').files.read('project.json');
  assert.ok(widest(text) <= 72, text);
  assert.ok(Array.isArray(JSON.parse(text).about));
  assert.equal(wb.projects.get('narrow').meta.about, about);
  const built = wb.projects.get('blend').meta;
  assert.equal(typeof built.about, 'string'); // corpus prose fields may be arrays of lines
});

test('params, book and help', () => {
  const { wb } = makeWb();
  assert.equal(wb.param.int('n', { min: 1, max: 9, default: 3 }), 3);
  wb.param.set('n', 5);
  assert.equal(wb.param.int('n', { min: 1, max: 9, default: 3 }), 5);
  assert.equal(wb.book.contents().length, 17);
  assert.match(wb.book.read('loops'), /loop/i);
  const help = wb.help('strategies');
  assert.doesNotMatch(help, /^no section/);
  assert.ok(widest(wb.help()) <= 72);
});

test('events: views hear revisions, focus and files', async () => {
  const { wb } = makeWb();
  const seen = [];
  wb.on('*', e => seen.push(e));
  const pr = wb.projects.open('blend');
  await wb.current.apply('cfg');
  wb.focus('s:blend.4');
  pr.files.write('notes.md', 'x\n');
  for (const e of ['program', 'revision', 'focus', 'files']) assert.ok(seen.includes(e), e);
});

test('projects: shared metadata parser matches workbench metadata across the corpus', async () => {
  const { parseProjectMeta, projectSource } = await import('../../dist/typed/project.js');
  const { projectIds, projectFiles } = await import('../../tools/corpus.mjs');
  const { wb } = makeWb();
  for (const id of projectIds()) {
    const files = projectFiles(id);
    const meta = parseProjectMeta(id, files);
    assert.deepEqual(meta, projectSource(id, files).meta, id);
    assert.deepEqual(wb.projects.get(id).meta, { scripts: {}, ui: {}, ...meta }, id);
  }
});
