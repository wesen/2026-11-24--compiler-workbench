// Specialization on facts from an outer artifact (design-doc 03), on match-enum's dispatch over an enum parameter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { BindingsIR, factRef } = await import('../../dist/typed/specialize.js');
const { splitLocalRanges } = await import('../../dist/typed/split-ranges.js');
const { meaningKept } = await import('../../dist/typed/evaluate.js');
const { createArtifact } = await import('../../dist/framework/contracts/index.js');

const square = () =>
  createArtifact(BindingsIR, 'shapes', { formatVersion: 1, source: 'demo', bindings: [{ fn: 'area', param: 's', value: 4, entity: 'shape/Square' }] });
const reaches = (node, text, seen = new Set()) => {
  if (typeof node === 'string') return node === text;
  if (!node || seen.has(node)) return false;
  seen.add(node);
  return [node.from, ...(node.because ?? []), node.value].some(x => reaches(x, text, seen));
};

test('specialize: an outer fact turns a dispatch into one case, under a restricted contract', async () => {
  const ps = projectSource('match-enum', projectFiles('match-enum')), p = Program.fromProject(ps);
  const facts = square();
  const r = await p.specialize(facts);
  assert.equal(r.changed, true);
  assert.deepEqual(p.assumptions, { area: { s: 4 } });
  await p.pipeline('O2');
  assert.equal(p.listing('area').split('\n').slice(1).join('\n').replace(/\s+/g, ' ').trim(), 'bb:area.0 -> [] s:area.15 return (k * k)');
  // the program means r0 on inputs where s = Square ...
  assert.equal(p.check({ fn: 'area' }).status, 'agree');
  // ... and not on others: the restriction is what made the passes valid
  const unrestricted = await p.manager.checkInvariant(meaningKept({ inputs: ps.meta.inputs }), { origin: p.origin, candidate: p.head });
  assert.equal(unrestricted.ok, false);
  // why: each branch cfg resolved was resolved because of a folded comparison whose because-chain reaches the
  // outer fact (the new branch statements themselves were pruned in the same revision, so the edit's because is
  // where the chain starts)
  const fact = factRef(facts, facts.value.bindings[0]);
  const resolved = p.revisions.flatMap(rv => rv.edits).filter(e => e.kind === 'replaceStmt');
  assert.equal(resolved.length, 3);
  for (const e of resolved) assert.ok(e.because.some(b => reaches(p.why(b), fact)), `${e.to}: no why tree reaches ${fact}`);
});

test('specialize: a bad binding is refused and the assumptions are restored', async () => {
  const p = Program.fromProject(projectSource('match-enum', projectFiles('match-enum')));
  const bad = createArtifact(BindingsIR, 'bad', { formatVersion: 1, source: 'demo', bindings: [{ fn: 'area', param: 'nope', value: 1, entity: 'x' }] });
  await assert.rejects(p.specialize(bad), /no parameter "nope"/);
  assert.deepEqual(p.assumptions, {});
  assert.equal(p.rev, 0);
});

test('specialize: undoing the specialization drops its assumption', async () => {
  const p = Program.fromProject(projectSource('match-enum', projectFiles('match-enum')));
  await p.specialize(square());
  await p.apply('cfg');
  assert.deepEqual(p.assumptions, { area: { s: 4 } });
  p.undo(); // back to the specialized revision: still assumed
  assert.deepEqual(p.assumptions, { area: { s: 4 } });
  p.undo(); // back to r0: no restriction
  assert.deepEqual(p.assumptions, {});
  assert.equal(p.check({ fn: 'area' }).status, 'agree');
});

const bufferProgram = (body, extra = '') => Program.fromProject(projectSource('reader', {
  'main.typed': `function reader(code: buffer, pos: i32): i32 { ${body} } ${extra}`,
  'project.json': JSON.stringify({ ingest: { tape: true }, inputs: { reader: { pos: { oneOf: [-1, 0, 1] } } } }),
}));
const bufferFacts = cells => createArtifact(BindingsIR, 'table', {
  formatVersion: 1, source: 'host', bindings: [{ fn: 'reader', param: 'code', value: { cells }, entity: 'initial-table' }],
});

test('buffer facts fold static reads, keep dynamic checks, and travel with the revision', async () => {
  const p = bufferProgram('const alias = code; return alias.charCodeAt(0) + alias.charCodeAt(pos);');
  const facts = bufferFacts([65535, 19]);
  const r = await p.specialize(facts);
  assert.equal(r.check, '40/40');
  assert.equal((p.listing().match(/load16/g) ?? []).length, 1);
  assert.match(p.listing(), /65535/);
  assert.deepEqual(p.inputs.reader.code, { cells: [65535, 19] });
  const fact = factRef(facts, facts.value.bindings[0]);
  assert.ok(p.revisions.at(-1).correspondence.entries.some(e => e.because?.includes(fact) && e.from.length && e.to.length));
  await p.pipeline('O1');
  assert.equal(p.check({ fn: 'reader' }).status, 'agree');
  const unrestricted = await p.manager.checkInvariant(meaningKept({
    inputs: { reader: { code: { cells: [4, 10] }, pos: 0 } },
  }), { origin: p.origin, candidate: p.head });
  assert.equal(unrestricted.ok, false);
  const rev = p.rev;
  await assert.rejects(p.specialize(bufferFacts([4, 10])), /conflicting binding/);
  assert.equal(p.rev, rev);
  assert.deepEqual(p.inputs.reader.code, { cells: [65535, 19] });
  p.checkout('r0');
  assert.equal(p.inputs.reader.code, undefined);
});

test('a static out-of-range fetch retains the checked read', async () => {
  const p = bufferProgram('return code.charCodeAt(0);');
  assert.equal((await p.specialize(bufferFacts([]))).check, '40/40');
  assert.match(p.listing(), /caddr/);
});

test('writes, internal callers, invalid contents and exhausted state budgets are refused', async () => {
  assert.throws(() => bufferFacts([65536]), /malformed binding/);
  const facts = bufferFacts([3]);
  const reader = bufferProgram('return code.charCodeAt(0);');
  await assert.rejects(reader.specialize({ ...facts, revision: 'stale' }), /hash/);
  assert.deepEqual(reader.assumptions, {});
  const store = bufferProgram('const alias = code; alias.setCharCodeAt(0, pos); return code.charCodeAt(0);');
  await assert.rejects(store.specialize(facts), /may write the bound buffer/);
  assert.deepEqual(store.assumptions, {});
  const calls = bufferProgram('return code.charCodeAt(0);',
    'function caller(other: buffer): i32 { return reader(other, 0); }');
  await assert.rejects(calls.specialize(facts), /internal call/);
  const loop = bufferProgram('let i = 0; while (i < pos) { i = i + 1; } return code.charCodeAt(0) + i;');
  await assert.rejects(loop.specialize(facts, { maxStates: 3 }), /exceeded 3 block states/);
  assert.equal(loop.rev, 0);
  assert.deepEqual(loop.assumptions, {});
});

test('dispatch specialization follows a changed bytecode image and ties the dynamic loop backedge', async () => {
  const project = projectSource('bytecode-vm', projectFiles('bytecode-vm'));
  const p = Program.fromProject(project);
  const cells = project.meta.inputs.runVm.code.cells.slice();
  cells[41] = 17; // Change the checksum multiplier, keeping n and seed dynamic.
  const facts = createArtifact(BindingsIR, 'modified-checksum', { formatVersion: 1, source: 'host', bindings: [
    { fn: 'runVm', param: 'entry', value: 34, entity: 'checksum' },
    { fn: 'runVm', param: 'code', value: { cells }, entity: 'program' },
  ] });
  assert.equal((await p.specialize(facts)).check, '40/40');
  const { sourceEntities, targetEntities, entries } = p.revisions.at(-1).correspondence;
  const derived = new Set(entries.filter(e => e.from.length).flatMap(e => e.to));
  const before = new Set(sourceEntities);
  for (const id of targetEntities) assert.ok(before.has(id) || derived.has(id), `missing source for ${id}`);
  await p.apply('cfg');
  const listing = p.listing();
  assert.doesNotMatch(listing, /load16|caddr|store32|load32/);
  assert.match(listing, /17/);
  assert.match(listing, /if /);
  assert.equal((await p.fact('loops', 'runVm')).value.length, 1);
  assert.equal(p.check({ fn: 'runVm' }).status, 'agree');
});

test('split-local-ranges preserves a value live across both arms of a branch', async () => {
  const p = bufferProgram('let a = pos; let b = a + 1; a = b * 2; if (pos > 0) { a = b - a; } return a + b;');
  assert.equal((await p.apply(splitLocalRanges)).check, '40/40');
  assert.match(p.listing(), /Version/);
});
