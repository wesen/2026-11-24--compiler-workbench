import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisManager } from '../../dist/framework/contracts/analysis-manager.js';
import { classifyEdits } from '../../dist/typed/edit-classification.js';
import { ingestProject, projectSource, runPipeline } from '../../dist/typed/project.js';
import { RULE_EVIDENCE } from '../../dist/typed/rules/evidence.js';
import { projectFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor();

async function onProject(id, pipeline) {
  const project = projectSource(id, projectFiles(id));
  const { steps } = await runPipeline(ingestProject(project), pipeline, {
    manager: new AnalysisManager(),
    inputs: project.meta.inputs,
    roots: project.meta.entries,
  });
  assert.ok(steps.every(s => !s.rejected));
  return steps.filter(s => s.changed).map(({ pass, result, report }) => {
    const args = [result.before.value, result.artifact.value, result.correspondence];
    const rows = classifyEdits(...args, report.edits);
    assert.deepEqual(rows.map(r => r.edit), report.edits);
    return { pass, args, rows };
  });
}

test('census recovers multiple firings per field but requires an explicit, matching citation', async () => {
  const [{ args, rows }] = await onProject('algebra', ['simplify']);
  const row = rows.find(r => r.rules.some(rule => rule.name === 'add-zero'));
  assert.equal(row.classification, 'local');
  assert.deepEqual(row.statements, [row.edit.stmt]);
  assert.deepEqual(row.rules.map(r => r.name).sort(), ['add-zero', 'mul-one']);
  assert.ok(row.rules.every(r => r.strength === 'proof' && !r.cited));

  const tokens = row.rules.map(({ name }) => {
    const { version, fingerprint } = RULE_EVIDENCE[name];
    return `rule:simplify/${name}@${version}#${fingerprint}`;
  });
  const [cited] = classifyEdits(...args, [{ ...row.edit, rules: tokens }]);
  assert.ok(cited.rules.every(r => r.cited));
  const [stale] = classifyEdits(...args, [{ ...row.edit, rules: tokens.map(t => t.replace('@1', '@0')) }]);
  assert.ok(stale.rules.every(r => !r.cited));

  const [unmatched] = classifyEdits(...args, [{ ...row.edit, to: row.edit.from }]);
  assert.equal(unmatched.classification, 'other');
  assert.equal(unmatched.reason, 'unmatched value replacement');
});

test('census separates guarded local rewrites, contextual rewrites and structural changes', async () => {
  const strength = await onProject('strength', 'O2');
  const guarded = strength.find(s => s.pass === 'strength').rows;
  assert.ok(guarded.every(r => r.classification === 'local' && r.rules.length === 0));
  assert.deepEqual(new Set(guarded.flatMap(r => r.candidateShapes)), new Set([
    'div(x, 2^k) → shr(x, k) if x ≥ 0',
    'rem(x, 2^k) → and(x, 2^k − 1) if x ≥ 0',
  ]));

  const blend = await onProject('blend', 'speed');
  const prop = blend.find(s => s.pass === 'constprop').rows;
  assert.ok(prop.every(r => r.classification === 'other' && r.contextualShape));
  const licm = blend.find(s => s.pass === 'licm').rows;
  assert.ok(licm.every(r => r.classification === 'structural'));
  assert.ok(licm.some(r => r.edit.kind === 'local' && r.statements.length === 0));
});

test('census uses correspondence to attribute inlining setup to the call', async () => {
  const [{ args: [, after, correspondence], rows }] = await onProject('calls', ['inline']);
  const byCall = rows.filter(r => r.edit.kind === 'inline');
  assert.ok(byCall.length > 0);
  assert.ok(rows.every(r => r.classification === 'structural'));
  const row = byCall[0];
  const call = row.edit.because[0];
  const related = correspondence.entries
    .filter(entry => entry.from.includes(call))
    .flatMap(entry => entry.to.filter(id => after.stmts[id]));
  assert.ok(related.length > 0);
  assert.ok(related.every(id => row.statements.includes(id)));
});
