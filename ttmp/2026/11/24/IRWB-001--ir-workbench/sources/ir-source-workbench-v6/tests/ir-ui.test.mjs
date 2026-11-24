import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { installDOM } from './helpers/dom.mjs';
import { collectSources } from '../dist/workbench/source-catalog.js';
import { yaml } from '../dist/workbench/presentation.js';
import { parseYAMLData } from '../dist/source-workbench/yaml-data.js';
import { mountIRInspector } from '../dist/source-workbench/ir-inspector.js';
import { irInspectionSteps, mountIRLab } from '../dist/source-workbench/ir-lab-panel.js';
import { IR_LAB_DOMAINS, runIRLab, getIRLabAdapter, predicateRegistry, expressionCSE } from '../dist/ir-examples/index.js';
import { openIR } from '../dist/ir/index.js';
import { entity, matchAll } from '../dist/ir/patterns.js';
import { saturate } from '../dist/ir/rewrites.js';
import { traceEntity } from '../dist/ir/correspondence.js';
import { correspondencePath } from '../dist/source-workbench/ir-lineage.js';

// Real compiler, adapters, matcher and edits; DOM and SVG transport are doubles.
// These checks establish component behavior and evidence integrity, not rendering.
const fixtures = new Map();
const fixture = domain => {
  if (!fixtures.has(domain)) fixtures.set(domain, runIRLab(domain));
  return fixtures.get(domain);
};
let catalog;
const sources = () => catalog ??= collectSources(process.cwd());
const exact = (a, ref) => a.id === ref.artifact && a.revision === ref.revision;
const ready = async (host, dom) => {
  const deadline = Date.now() + 30000;
  while (dom.button(host, 'Run pipeline').disabled) {
    if (Date.now() > deadline) throw new Error('IR laboratory compilation did not finish');
    await nextTurn();
  }
};

test('IR inspection sequence resolves every exact retained transaction revision for all four representations', async () => {
  for (const descriptor of IR_LAB_DOMAINS) {
    const result = await fixture(descriptor.id), steps = irInspectionSteps(result);
    assert.ok(steps.length > 2, descriptor.id);
    assert.equal(steps[0].before, result.before);
    assert.equal(steps.at(-1).after, result.after);
    const mutations = steps.filter(step => step.result);
    assert.ok(mutations.length > 0, descriptor.id);
    for (const step of mutations) {
      assert.ok(exact(step.before, step.result.changes.from));
      assert.ok(exact(step.after, step.result.changes.to));
      assert.ok(step.taskId, 'Every edit links back to an actual compiler task');
      assert.ok(result.snapshot.invocations.some(invocation => invocation.id === step.invocationId && invocation.runId === step.runId && invocation.taskId === step.taskId), 'Each edit links its exact originating run and invocation');
      if (step.rewrite) assert.ok(exact(step.before, step.rewrite.match.artifact));
    }
  }
});

test('IR inspector links entity selection through recorded many-to-one correspondence and exposes typed relationships', async t => {
  const result = await fixture('scenes'), steps = irInspectionSteps(result), merging = steps.find(step => step.result?.correspondence.entries.some(entry => entry.from.some(id => !entry.to.includes(id)) && entry.to.length));
  assert.ok(merging);
  const mapping = merging.result.correspondence.entries.find(entry => entry.from.some(id => !entry.to.includes(id)) && entry.to.length), from = mapping.from.find(id => !mapping.to.includes(id));
  const dom = installDOM(); t.after(dom.restore); const host = dom.document.createElement('div');
  const cleanup = mountIRInspector(host, { adapter: getIRLabAdapter('scenes'), steps: [merging], sources: await sources() }); t.after(cleanup);
  host.querySelectorAll('.ir-entity-row').find(row => row.dataset.side === 'before' && row.dataset.entity === from).click();
  const selectedAfter = host.querySelectorAll('.ir-entity-row').filter(row => row.dataset.side === 'after' && row.classList.contains('selected')).map(row => row.dataset.entity);
  assert.deepEqual(selectedAfter.sort(), [...mapping.to].sort());
  assert.match(host.querySelector('.ir-correspondence-note').textContent, /Recorded correspondence/);
  assert.match(host.querySelector('.ir-selection-detail').textContent, /Typed relationships/);
  assert.ok(host.querySelectorAll('.tok-key').length > 0);
  dom.button(host, 'Changes & origin').click();
  assert.match(host.textContent, /Actual logical diff/);
  assert.match(host.textContent, /mapping alone does not prove semantic equivalence/);
  assert.match(host.textContent, new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('live IR queries execute adapter semantics, preserve empty results, and expose budgets and unknown entities', async t => {
  const result = await fixture('expressions'), step = irInspectionSteps(result)[0], view = openIR(step.before, getIRLabAdapter('expressions'));
  const dom = installDOM(); t.after(dom.restore); const host = dom.document.createElement('div');
  t.after(mountIRInspector(host, { adapter: getIRLabAdapter('expressions'), steps: [step], sources: await sources() }));
  dom.button(host, 'Query').click();
  const picker = host.querySelector('[aria-label="IR query"]'), target = host.querySelector('[aria-label="Query entity"]'), budget = host.querySelector('[aria-label="Query node budget"]');
  dom.change(target, '$expression'); dom.change(picker, 'children'); dom.button(host, 'Run query').click();
  assert.deepEqual(parseYAMLData(host.querySelector('.ir-query-result').querySelector('pre').textContent), view.children('$expression'));
  dom.change(picker, 'parents'); dom.button(host, 'Run query').click();
  assert.deepEqual(parseYAMLData(host.querySelector('.ir-query-result').querySelector('pre').textContent), []);
  dom.change(picker, 'walk'); dom.input(budget, '1'); dom.button(host, 'Run query').click();
  assert.match(host.querySelector('.ir-query-error').textContent, /budget|limit|exceed/i); assert.equal(host.querySelector('.ir-query-result').querySelector('pre'), null);
  dom.input(budget, '1000'); dom.change(picker, 'resolve'); dom.change(target, 'missing-entity'); dom.button(host, 'Run query').click();
  assert.match(host.querySelector('.ir-query-error').textContent, /unknown|missing|not found|resolve|exist/i);
});

test('live pattern YAML calls the real matcher and explains failed matches without mutating historical IR', async t => {
  const result = await fixture('expressions'), steps = irInspectionSteps(result), selected = steps.find(step => step.rewrite), before = JSON.stringify(result);
  assert.ok(selected);
  const dom = installDOM(); t.after(dom.restore); const host = dom.document.createElement('div');
  t.after(mountIRInspector(host, { adapter: getIRLabAdapter('expressions'), steps: [selected], sources: await sources() }));
  dom.button(host, 'Pattern & match').click(); assert.match(host.textContent, /Why it matched/); assert.match(host.textContent, /Exact revision/);
  const editor = host.querySelector('[aria-label="Editable IR pattern YAML"]'), pattern = entity('expression.mul');
  dom.input(editor, yaml(pattern)); dom.button(host, 'Find matches').click();
  const expected = matchAll(pattern, openIR(selected.before, getIRLabAdapter('expressions'))), actual = parseYAMLData(host.querySelector('.ir-pattern-query-result').querySelector('pre').textContent);
  assert.deepEqual(actual, expected); assert.ok(host.querySelectorAll('.tok-key').length > 0);
  dom.change(host.querySelector('[aria-label="Explain pattern entity"]'), '$expression'); dom.button(host, 'Explain selected entity').click();
  const explanation = parseYAMLData(host.querySelector('.ir-pattern-query-result').querySelector('pre').textContent); assert.equal(explanation.matched, false); assert.ok(explanation.evidence.length > 0);
  dom.input(editor, 'type: arbitrary-code\n'); dom.button(host, 'Find matches').click(); assert.ok(host.querySelector('.ir-query-error'));
  assert.equal(JSON.stringify(result), before);
});

test('IR implementation navigation shows exact adapter and rewrite source with real syntax highlighting', async t => {
  const result = await fixture('expressions'), step = irInspectionSteps(result).find(step => step.rewrite), allSources = await sources();
  const dom = installDOM(); t.after(dom.restore); const host = dom.document.createElement('div');
  t.after(mountIRInspector(host, { adapter: getIRLabAdapter('expressions'), steps: [step], sources: allSources }));
  dom.button(host, 'Implementation').click();
  const location = allSources.definitions[`rewrite:${step.rewrite.rule.id}@${step.rewrite.rule.version}`]; assert.ok(location);
  assert.equal(host.querySelector('[aria-label="Source file"]').value, location.path); assert.ok(host.querySelectorAll('.code-pass-range').length > 0);
  assert.ok(host.querySelectorAll('.tok-keyword').length > 0);
  dom.button(host, 'IR transactions').click(); assert.equal(host.querySelector('[aria-label="Source file"]').value, 'src/ir/transactions.ts');
  const lines = host.querySelectorAll('.code-text').map(row => row.textContent).join('\n');
  assert.equal(lines, allSources.files.find(file => file.path === 'src/ir/transactions.ts').text);
});

test('IR lab runs all four real compilers and keeps source, invocations and strategy evidence connected', async t => {
  const dom = installDOM(); t.after(dom.restore); const host = dom.document.createElement('div'), allSources = await sources();
  t.after(mountIRLab(host, allSources));
  for (const descriptor of IR_LAB_DOMAINS) {
    if (descriptor.id !== IR_LAB_DOMAINS[0].id) dom.button(host, descriptor.label).click();
    await ready(host, dom); assert.doesNotMatch(host.querySelector('.ir-lab-status').textContent, /error|failed|invalid/i); assert.ok(host.querySelector('.ir-inspector'));
    dom.button(host, 'Example & compiler code').click();
    const path = host.querySelector('[aria-label="Source file"]').value; assert.ok(descriptor.sourcePaths.includes(path));
    assert.equal(host.querySelectorAll('.code-text').map(row => row.textContent).join('\n'), allSources.files.find(file => file.path === path).text);
    dom.button(host, 'Compiler passes').click(); assert.ok(host.querySelectorAll('.invocation').length > 0); assert.ok(host.querySelector('.ir-chain'));
    dom.button(host, 'Contracts').click(); assert.match(host.querySelector('.inspector-content').textContent, /Semantic pass contract|contract/i);
    dom.button(host, 'Strategy trace').click(); assert.ok(host.querySelectorAll('[data-node]').length > 0); assert.match(host.textContent, /recorded execution/);
    dom.button(host, 'IR explorer').click();
  }
});

test('IR lab rejects invalid edited input, restores history, retains per-domain drafts and runs warm cache inspection', async t => {
  const dom = installDOM(); t.after(dom.restore); const host = dom.document.createElement('div'); t.after(mountIRLab(host, await sources())); await ready(host, dom);
  dom.button(host, 'Edit native input').click(); const original = host.querySelector('[aria-label="Editable native IR YAML"]').value;
  dom.input(host.querySelector('[aria-label="Editable native IR YAML"]'), 'root: missing\nnodes: {}\n'); dom.button(host, 'Compile edited input').click(); await ready(host, dom);
  assert.equal(host.querySelector('.ir-lab-status').classList.contains('bad'), true);
  dom.button(host, 'IR explorer').click(); assert.equal(host.querySelector('.ir-inspector'), null);
  dom.change(host.querySelector('[aria-label="IR lab history"]'), '0'); assert.ok(host.querySelector('.ir-inspector'));
  dom.button(host, 'Edit native input').click(); assert.match(host.querySelector('[aria-label="Editable native IR YAML"]').value, /missing/);
  dom.button(host, IR_LAB_DOMAINS[1].label).click(); await ready(host, dom); dom.button(host, IR_LAB_DOMAINS[0].label).click();
  dom.button(host, 'Edit native input').click();
  assert.match(host.querySelector('[aria-label="Editable native IR YAML"]').value, /missing/);
  dom.button(host, 'Restore selected run input').click(); assert.equal(host.querySelector('[aria-label="Editable native IR YAML"]').value, original);
  const warm = host.querySelector('[aria-label="Run twice to inspect cache reuse"]'); warm.checked = true; warm.dispatchEvent({ type: 'change' }); dom.button(host, 'Run pipeline').click(); await ready(host, dom);
  assert.equal(host.querySelector('.ir-lab-status').classList.contains('bad'), false);
  dom.button(host, 'Compiler passes').click(); assert.ok(host.querySelectorAll('.compact-status').some(node => node.textContent === 'hit'));
  dom.button(host, 'IR explorer').click(); dom.button(host, 'Inspect compiler invocation').click();
  assert.match(host.querySelector('.ir-origin-notice').textContent, /original invocation/);
  assert.equal(host.querySelector('.invocation.selected').querySelector('.compact-status').textContent, 'run');
  dom.button(host, 'Inspect selected run instead').click(); assert.equal(host.querySelector('.ir-origin-notice'), null);
  assert.equal(host.querySelector('.invocation.selected').querySelector('.compact-status').textContent, 'hit');
  dom.button(host, 'IR explorer').click(); host.querySelector('[aria-label="IR step Compiler result"]').click(); dom.button(host, 'Inspect compiler invocation').click();
  assert.equal(host.querySelector('.ir-origin-notice'), null); assert.equal(host.querySelector('.invocation.selected').querySelector('.compact-status').textContent, 'hit');
});

test('mesh error bound changes the real selected approximation and malformed bounds are rejected', async t => {
  const dom = installDOM(); t.after(dom.restore); const host = dom.document.createElement('div'); t.after(mountIRLab(host, await sources())); await ready(host, dom);
  const meshes = IR_LAB_DOMAINS.find(domain => domain.id === 'meshes'); dom.button(host, meshes.label).click(); await ready(host, dom);
  const initial = host.querySelector('.source-result-meta').textContent;
  dom.change(host.querySelector('[aria-label="Mesh approximation tolerance"]'), '.1'); dom.button(host, 'Run pipeline').click(); await ready(host, dom);
  assert.notEqual(host.querySelector('.source-result-meta').textContent, initial);
  dom.change(host.querySelector('[aria-label="Mesh approximation tolerance"]'), '-1'); dom.button(host, 'Run pipeline').click(); await ready(host, dom);
  assert.match(host.querySelector('.ir-lab-status').textContent, /finite number from 0 to 1/);
});

test('recorded constraint patterns can be rerun with their exact versioned domain predicate registry', async t => {
  const result = await fixture('constraints'), step = irInspectionSteps(result).find(step => step.rewrite);
  const dom = installDOM(); t.after(dom.restore); const host = dom.document.createElement('div');
  t.after(mountIRInspector(host, { adapter: getIRLabAdapter('constraints'), steps: [step], sources: await sources(), patternRegistry: predicateRegistry }));
  dom.button(host, 'Pattern & match').click(); dom.button(host, 'Find matches').click();
  assert.equal(host.querySelector('.ir-pattern-query-result').querySelector('.ir-query-error'), null);
  const expected = matchAll(step.rewrite.match.pattern, openIR(step.before, getIRLabAdapter('constraints')), { registry: predicateRegistry });
  assert.deepEqual(parseYAMLData(host.querySelector('.ir-pattern-query-result').querySelector('pre').textContent), expected);
});

test('uncommitted budget candidates are inspected explicitly and never presented as accepted after revisions', async t => {
  const result = await fixture('expressions'), view = openIR(result.before, getIRLabAdapter('expressions')), scheduled = await saturate(view, [expressionCSE], { budget: 0 });
  assert.equal(scheduled.status, 'budget'); const rejected = scheduled.steps.find(step => step.status === 'budget-rejected'); assert.ok(rejected?.result);
  assert.equal(scheduled.artifact.revision, view.artifact.revision);
  const dom = installDOM(); t.after(dom.restore); const host = dom.document.createElement('div');
  t.after(mountIRInspector(host, { adapter: getIRLabAdapter('expressions'), steps: [{ id: 'budget', label: 'Budget rejection', before: view.artifact, after: rejected.result.artifact, result: rejected.result, rewrite: rejected }], sources: await sources() }));
  assert.match(host.querySelector('.ir-candidate-note').textContent, /did not commit/);
  assert.match(host.querySelector('.after').textContent, /Candidate · not committed/);
  dom.button(host, 'Changes & origin').click(); assert.match(host.textContent, /Candidate logical diff · not committed/);
});

test('entity lineage follows one exact revision route through alternative mesh branches and supports inverse origin queries', async t => {
  const result = await fixture('meshes'), from = { artifact: result.before.id, revision: result.before.revision }, to = { artifact: result.after.id, revision: result.after.revision }, route = correspondencePath(result.correspondence, from, to);
  assert.ok(route); assert.ok(route.branchPoints.length > 0);
  for (let index = 1; index < route.path.length; index++) assert.deepEqual(route.path[index - 1].to, route.path[index].from);
  assert.deepEqual(route.path.at(-1).to, to);
  const entity = openIR(result.before, getIRLabAdapter('meshes')).entities()[0], traced = traceEntity(entity, route.path);
  assert.ok(traced.current.every(ref => ref.artifact === to.artifact && ref.revision === to.revision));
  const inverse = correspondencePath(result.correspondence, to, from, { reverse: true }); assert.ok(inverse);
  assert.equal(correspondencePath(result.correspondence, to, from), undefined);
  assert.throws(() => correspondencePath(result.correspondence, from, to, { maxEdges: 1 }), /budget/);
  const dom = installDOM(); t.after(dom.restore); const host = dom.document.createElement('div'); t.after(mountIRLab(host, await sources())); await ready(host, dom);
  dom.button(host, IR_LAB_DOMAINS.find(domain => domain.id === 'meshes').label).click(); await ready(host, dom);
  assert.equal(host.querySelector('.ir-inspector').querySelector('.chain-strip').querySelectorAll('.chain-arrow').length, 0, 'Independent candidate edits are not drawn as a linear chain');
  dom.button(host, 'Entity lineage').click(); assert.match(host.querySelector('.ir-lineage-status').textContent, /correspondence steps/); assert.match(host.textContent, /separate branches/);
  dom.button(host, 'Swap revisions').click(); assert.equal(host.querySelector('[aria-label="Lineage direction"]').value, 'inverse'); assert.match(host.querySelector('.ir-lineage-status').textContent, /resulting entities/);
});

test('standalone initial IR mode is selectable without losing the baseline source compiler', async t => {
  const { mountSourceWorkbench } = await import('../dist/source-workbench/ui.js'), { evaluateModules } = await import('../dist/source-workbench/evaluate.js'), { default: ts } = await import('typescript');
  const dom = installDOM(), previous = new Map(['Worker', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'devicePixelRatio'].map(name => [name, globalThis[name]]));
  class LocalEvaluationTransport {
    stopped = false;
    postMessage({ files, entry }) { Promise.resolve().then(() => { if (this.stopped) return; try { this.onmessage({ data: { ok: true, program: evaluateModules(ts, files, entry) } }); } catch (error) { this.onmessage({ data: { ok: false, error: error.message } }); } }); }
    terminate() { this.stopped = true; }
  }
  Object.assign(globalThis, { Worker: LocalEvaluationTransport, requestAnimationFrame: callback => setTimeout(() => callback(performance.now()), 0), cancelAnimationFrame: clearTimeout, getComputedStyle: () => ({ getPropertyValue: () => '270px' }), devicePixelRatio: 1 });
  t.after(() => { for (const [name, value] of previous) if (value === undefined) delete globalThis[name]; else globalThis[name] = value; dom.restore(); });
  const host = dom.document.createElement('div'); mountSourceWorkbench(host, await sources(), 'real local evaluator transport double', { initialMode: 'ir' });
  await ready(host.querySelector('.ir-lab'), dom); assert.equal(host.querySelector('.source-app').classList.contains('inspect-ir-lab'), true);
  dom.button(host, 'Building').click(); const deadline = Date.now() + 30000;
  while (host.querySelector('.compile-button').disabled) { if (Date.now() > deadline) throw new Error('Baseline compiler did not finish'); await nextTurn(); }
  assert.equal(host.querySelector('.source-app').classList.contains('inspect-ir-lab'), false); assert.match(host.querySelector('.source-run-status').textContent, /Compiled building.ts/);
  const original = host.querySelector('[aria-label="Editable TypeScript program"]').value;
  dom.button(host, 'IR manipulation lab').click(); assert.ok(host.querySelector('.ir-inspector'));
  dom.button(host, 'Building').click(); assert.equal(host.querySelector('[aria-label="Editable TypeScript program"]').value, original);
});
