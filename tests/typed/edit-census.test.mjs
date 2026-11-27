import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';
import { Program } from '../../dist/typed/program.js';
import { projectSource } from '../../dist/typed/project.js';
import { planFromSpec, PRESETS, runStrategy } from '../../dist/typed/strategies.js';
import { classifyRevision } from '../../dist/typed/edit-census.js';
import { RULE_EVIDENCE } from '../../dist/typed/rules/evidence.js';

await installVendor();

test('classifies published edit records, including nested rules and reused operands', async () => {
  const p = Program.fromProject(projectSource('algebra', projectFiles('algebra')));
  assert.equal((await runStrategy(p, planFromSpec('speed', PRESETS.speed))).status, 'succeeded');
  const rows = p.revisions.slice(1).flatMap((r, i) => classifyRevision(p.revisions[i], r));
  assert.equal(rows.length, p.revisions.flatMap(r => r.edits).length);
  const pair = rows.find(r => r.rules.includes('sub-self') && r.rules.includes('add-zero'));
  assert.equal(pair.category, 'local');
  assert.equal(pair.cited, false);
  assert.deepEqual(pair.beforeStatements, [pair.edit.stmt]);
  assert.deepEqual(pair.afterStatements, [pair.edit.stmt]);
  const before = p.revisions[pair.edit.rev - 1], after = p.revisions[pair.edit.rev];
  const rerun = edit => classifyRevision(before, { ...after, edits: [edit] })[0];
  const tokens = pair.rules.map(name => {
    const ev = RULE_EVIDENCE[name];
    return `rule:simplify/${name}@${ev.version}#${ev.fingerprint}`;
  });
  assert.equal(rerun({ ...pair.edit, because: tokens }).cited, true);
  assert.equal(rerun({ ...pair.edit, because: tokens.slice(1) }).cited, false);
  assert.equal(rerun({ ...pair.edit, to: pair.edit.from }).category, 'other');
});

test('motion, a guarded arithmetic rewrite and a binding-dependent edit take distinct paths', async () => {
  const all = [];
  for (const id of ['strength', 'licm-nested', 'constants']) {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    assert.equal((await runStrategy(p, planFromSpec('O2', PRESETS.O2))).status, 'succeeded');
    all.push(...p.revisions.slice(1).flatMap((r, i) => classifyRevision(p.revisions[i], r)));
  }
  assert.ok(all.some(r => r.reason === 'guarded arithmetic' && r.category === 'local'));
  assert.ok(all.some(r => r.edit.pass === 'licm' && r.edit.kind === 'replace' && r.category === 'structural'));
  assert.ok(all.some(r => r.edit.pass === 'constprop' && r.category === 'other'));
});
