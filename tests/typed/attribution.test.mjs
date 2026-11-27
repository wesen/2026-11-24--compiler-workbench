import assert from 'node:assert/strict';
import test from 'node:test';
import { projectFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';
import { attributeInstructions } from '../../dist/typed/attribution.js';
import { benchCase } from '../../dist/typed/evaluate.js';
import { storeOf } from '../../dist/typed/ir.js';
import { Program } from '../../dist/typed/program.js';
import { projectSource } from '../../dist/typed/project.js';

await installVendor();

test('revision deltas and per-PC executions account for both VM dispatch paths', async () => {
  const p = Program.fromProject(projectSource('bytecode-vm', projectFiles('bytecode-vm')));
  const pipeline = await p.pipeline('speed');
  assert.deepEqual(pipeline.steps.filter(step => step.rejected), []);
  for (const entry of [0, 34]) {
    const c = benchCase(storeOf(p.origin.value), 'runVm', { code: p.inputs.runVm.code, entry, n: 12, seed: 8 });
    const profile = attributeInstructions(p.revisions, c, { coalesce: true });
    const first = profile[0], last = profile.at(-1);
    assert.equal(first.steps, entry === 0 ? 7678 : 6874);
    assert.ok(last.steps <= first.steps);
    assert.equal(profile.reduce((n, row) => n + row.delta, first.steps), last.steps);
    for (const row of profile) {
      assert.equal(row.instructions.reduce((n, pc) => n + pc.executions, 0), row.steps);
    }
    const pc = last.instructions.find(({ insn }) => insn.covers.length);
    assert.ok(last.explain(pc.insn.id).some(node => node.relation === 'covered-by'));
  }
});

test('a hot instruction explains the LICM decision for a single-latch loop', async () => {
  const p = Program.fromProject(projectSource('blend', projectFiles('blend')));
  await p.pipeline('O2');
  const c = benchCase(storeOf(p.origin.value), 'blend', { work: { cells: [1, 2] }, n: 2, a: 3, b: 5 });
  const last = attributeInstructions(p.revisions, c).at(-1);
  const word = last.instructions.find(({ insn }) => insn.covers.includes('s:blend.15'));
  assert.ok(word);
  const paths = last.explain(word.insn.id);
  assert.ok(paths.some(path => path.relation === 'covered-by' && path.from.some(
    node => node.relation === 'licm' && node.because.includes('loop:blend@bb:blend.1'),
  )));
});
