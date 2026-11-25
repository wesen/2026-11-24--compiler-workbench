// Specialization on facts from an outer artifact (design-doc 03), on match-enum's dispatch over an enum parameter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { BindingsIR, factRef } = await import('../../dist/typed/specialize.js');
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
