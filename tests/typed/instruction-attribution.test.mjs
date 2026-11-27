import assert from 'node:assert/strict';
import test from 'node:test';
import { projectFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';
import { attributeInstructions, lowerToImage, runImage } from '../../dist/typed/backend/index.js';
import { benchCase } from '../../dist/typed/evaluate.js';
import { storeOf } from '../../dist/typed/ir.js';
import { Program } from '../../dist/typed/program.js';
import { projectSource } from '../../dist/typed/project.js';

await installVendor();

test('executed words are counted once and retain earlier decisions across later passes', async () => {
  const p = Program.fromProject(projectSource('blend', projectFiles('blend')));
  await p.pipeline('O2');
  const c = benchCase(storeOf(p.origin.value), 'blend', { work: { buffer: [10, 10] }, n: 10, a: 3, b: 5 });
  const lowered = lowerToImage(p.head);
  const run = runImage(lowered.image, c.fn, c.args, c.memory);
  assert.equal(run.trap, false);
  const rows = attributeInstructions(lowered, run, p.revisions);
  assert.equal(
    rows.reduce((sum, row) => sum + row.count, 0),
    run.steps,
  );
  assert.equal(new Set(rows.map(row => row.instruction.id)).size, rows.length);
  assert.ok(
    rows.some(row => {
      const changes = row.lineage.filter(step => step.changed);
      return (
        changes.some(s => s.pass === 'licm' && s.origin?.note?.startsWith('hoisted')) &&
        changes.some(s => s.pass === 'constprop') &&
        row.original.length
      );
    }),
    'an executed hoist follows its expression through constprop to r0',
  );
  assert.ok(p.revisions.find(r => r.pass === 'fold').edits.some(e => e.rules?.length));
  assert.throws(
    () => attributeInstructions(lowered, { ...run, counts: null }, p.revisions),
    /per-word counts/,
  );
  assert.throws(() => attributeInstructions(lowered, run, p.revisions.slice(1)), /correspondence|revision/);
});
