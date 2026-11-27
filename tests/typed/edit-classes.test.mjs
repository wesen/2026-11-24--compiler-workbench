// IRWB-035-D: the edit classifier - the rule-table replay, the fact-guarded shapes, the structural cases, and the
// guarantee that every edit record of a run is classified with nothing left unexplained.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { projectSource, ingestProject, runPipeline } = await import('../../dist/typed/project.js');
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');
const { SIMPLIFY_RULES } = await import('../../dist/typed/rules/simplify.js');
const E = await import('../../dist/typed/edit-classes.js');

const project = id => projectSource(id, projectFiles(id));

async function classify(id, pipeline = 'O2') {
  const p = project(id);
  const run = await runPipeline(ingestProject(p), pipeline, {
    manager: new AnalysisManager(),
    inputs: p.meta.inputs,
    count: 4,
  });
  const steps = new Map();
  for (const step of run.steps) {
    if (!step.changed || !step.report?.edits?.length) continue;
    const findings = E.classifyPass(step.result.before, step.result.artifact, step.report.edits);
    steps.set(step.pass, { edits: step.report.edits, findings });
  }
  return steps;
}
const rows = findings => findings.map(f => [f.cls, f.how, f.kind, f.rules ?? [], f.records].join(':')).sort();

test('deriveWith replays a rule table over a plain tree, naming the rules that fired', () => {
  const two = { op: 'mul', args: [{ op: 'get', imm: 0, args: [] }, { op: 'const', imm: 2, args: [] }] };
  const d = E.deriveWith(SIMPLIFY_RULES.rules, two);
  assert.equal(d.tree.op, 'shl');
  assert.equal(d.tree.args[1].imm, 1);
  assert.deepEqual(d.rules, ['mul-pow2']);
  // a tree no rule matches comes back as it was
  const other = { op: 'get', imm: 3, args: [] };
  assert.deepEqual(E.deriveWith(SIMPLIFY_RULES.rules, other), { tree: other, rules: [] });
});

test('classifyPass: fold and simplify are local rule citations; constprop is a cited fact; dce is structural', async () => {
  const steps = await classify('blend');
  assert.deepEqual([...steps.keys()], ['cfg', 'fold', 'simplify', 'constprop', 'dce', 'licm']);
  assert.deepEqual(rows(steps.get('fold').findings), ['local:rule-table:replace:fold-mul:1']);
  assert.deepEqual(rows(steps.get('simplify').findings), ['local:rule-table:replace:not-lt:1']);
  assert.deepEqual(rows(steps.get('constprop').findings), ['local:fact:replace:read-to-constant:1']);
  assert.deepEqual(rows(steps.get('dce').findings), ['structural:statement:remove::1']);
  // licm: the preheader local, its assignment, and the replacement by a read of that local
  assert.deepEqual(rows(steps.get('licm').findings), [
    'structural:motion:replace::1',
    'structural:statement:insert::1',
    'structural:statement:local::1',
  ]);
});

test('every edit record of these runs is classified exactly once, and nothing is unexplained', async () => {
  for (const id of ['blend', 'strength', 'algebra', 'licm-nested']) {
    for (const [pass, { edits, findings }] of await classify(id)) {
      assert.equal(
        findings.reduce((n, f) => n + f.records, 0),
        edits.length,
        `${id}/${pass}: findings must cover every edit record`,
      );
      const t = E.totals(findings);
      assert.equal(t.other.edits, 0, `${id}/${pass}: ${JSON.stringify(findings.filter(f => f.cls === 'other'))}`);
      assert.equal(t.local.records + t.structural.records, edits.length);
    }
  }
});

test('strength reduction is a fact-guarded local rewrite with both shapes named', async () => {
  const steps = await classify('strength');
  assert.deepEqual(rows(steps.get('strength').findings), [
    'local:fact:replace:div-pow2-to-shr,rem-pow2-to-and:1',
  ]);
});

test('a hoisted or value-numbered replacement is structural, and a two-record chain is one finding', async () => {
  const nested = await classify('licm-nested');
  const licm = nested.get('licm');
  assert.ok(licm.findings.some(f => f.cls === 'structural' && f.how === 'motion' && f.records === 2));
  const vn = await classify('value-numbering');
  assert.ok(vn.get('lvn').findings.some(f => f.cls === 'structural' && f.how === 'motion'));
  assert.ok(vn.get('lvn').findings.some(f => f.kind === 'insert'));
});

test('the classification is deterministic and the rule table is the pass\'s own', async () => {
  const p = project('blend');
  const run = await runPipeline(ingestProject(p), 'O2', {
    manager: new AnalysisManager(),
    inputs: p.meta.inputs,
    count: 4,
  });
  const step = run.steps.find(s => s.pass === 'simplify');
  const a = E.classifyPass(step.result.before, step.result.artifact, step.report.edits);
  const b = E.classifyPass(step.result.before, step.result.artifact, step.report.edits);
  assert.deepEqual(a, b);
  assert.ok(E.PASS_RULES.fold && E.PASS_RULES.simplify);
  assert.equal(E.PASS_RULES.constprop, undefined); // not a table-driven pass: its rewrites need a citation
});

test('classifySteps weights edits by the instructions they touch', async () => {
  const p = project('blend');
  const run = await runPipeline(ingestProject(p), 'O2', {
    manager: new AnalysisManager(),
    inputs: p.meta.inputs,
    count: 4,
  });
  const steps = E.classifySteps(run.steps, { count: 4 });
  const fold = steps.find(s => s.pass === 'fold');
  assert.equal(fold.edits.length, 1);
  assert.ok(fold.edits[0].instructions >= 0 && Number.isFinite(fold.edits[0].instructions));
  // the unexecuted-constant case: the folded multiply is in the hot loop, so its weight is not zero
  assert.ok(fold.edits[0].instructions > 0);
  // the weights of the finding set equal the per-class totals
  const t = E.totals(steps.flatMap(s => s.edits));
  assert.equal(
    t.local.instructions + t.structural.instructions + t.other.instructions,
    steps.flatMap(s => s.edits).reduce((n, e) => n + (e.instructions ?? 0), 0),
  );
});
