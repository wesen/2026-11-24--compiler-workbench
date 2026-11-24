import type { Artifact } from '../core/types.js';
import type { StrategyNode } from '../strategy/ir.js';
import { walk as walkStrategy } from '../strategy/editing.js';
import { IR_LAB_DOMAINS, defaultIRLabSource, getIRLabAdapter, predicateRegistry, runIRLab, type IRLabResult } from '../ir-examples/index.js';
import type { SourceCatalog } from '../workbench/source-catalog.js';
import { append, button, details, element, yamlBlock } from '../workbench/dom.js';
import { yaml } from '../workbench/presentation.js';
import { renderSourceBrowser } from '../workbench/source-browser.js';
import { mountWorkbench } from '../workbench/ui.js';
import { mountIRInspector, type IRInspectionStep } from './ir-inspector.js';
import { mountYAMLEditor } from './ir-data-editor.js';
import { parseYAMLData } from './yaml-data.js';
import { composeCorrespondence, traceEntity } from '../ir/correspondence.js';
import { openIR } from '../ir/index.js';
import { correspondencePath } from './ir-lineage.js';

type Domain = Parameters<typeof runIRLab>[0];
type Tab = 'ir' | 'lineage' | 'passes' | 'strategy' | 'source' | 'input';
interface SavedRun { result: IRLabResult; text: string; tolerance: number; warm: boolean }
interface DomainState { text: string; runs: SavedRun[]; selected: number; error: string; tolerance: number; warm: boolean }
function sameRef(a: { artifact: string; revision: string }, b: Artifact): boolean { return a.artifact === b.id && a.revision === b.revision; }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function downloadText(name: string, text: string): void { const url = URL.createObjectURL(new Blob([text], { type: 'application/yaml' })), link = element('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 300); }
function download(name: string, value: unknown): void { downloadText(name, yaml(value) + '\n'); }

/** Build the UI sequence from actual transaction and rewrite records. Missing
 * revisions are an error, never replaced with a convenient neighboring value. */
export function irInspectionSteps(result: IRLabResult): IRInspectionStep[] {
  const artifacts = [...result.artifacts, ...result.snapshot.artifacts, result.before, result.after];
  const resolve = (ref: { artifact: string; revision: string }): Artifact => {
    const artifact = artifacts.find(a => sameRef(ref, a));
    if (!artifact) throw new Error(`Inspection revision is missing: ${ref.artifact}@${ref.revision}`);
    return artifact;
  };
  const sourcePath = result.sourcePaths.find(path => path.endsWith(`/${result.domain}.ts`)) ?? result.sourcePaths[0];
  const firstPattern = result.patterns.find(pattern => pattern.matches.some(match => sameRef(match.artifact, result.before)));
  const steps: IRInspectionStep[] = [{ id: 'input', label: 'Input representation', before: result.before, after: result.before, ...(firstPattern ? { pattern: firstPattern.pattern, matches: firstPattern.matches } : {}), sourcePath }];
  for (const rewrite of result.rewrites) {
    const origin = result.snapshot.invocations.find(invocation => invocation.id === rewrite.invocationId), link = origin ? { taskId: origin.taskId, runId: origin.runId, invocationId: origin.id } : {};
    if (rewrite.trace) {
      rewrite.trace.steps.forEach((step, index) => {
        const before = resolve(step.before), after = step.result?.artifact ?? (step.after ? resolve(step.after) : before);
        steps.push({ id: `${rewrite.id}:${index}`, label: `${rewrite.label} · ${index + 1}`, before, after, rewrite: step, ...(step.result ? { result: step.result } : {}), sourcePath, ...link });
      });
    } else if (rewrite.result) {
      const before = resolve(rewrite.result.changes.from), matching = result.patterns.find(pattern => pattern.matches.some(match => sameRef(match.artifact, before)));
      steps.push({ id: rewrite.id, label: rewrite.label, before, after: rewrite.result.artifact, result: rewrite.result, ...(matching ? { pattern: matching.pattern, matches: matching.matches } : {}), sourcePath, ...link });
    }
  }
  const finalInvocation = result.snapshot.invocations.find(invocation => invocation.taskId === result.finalTask && invocation.runId === result.runId);
  steps.push({ id: 'output', label: 'Compiler result', before: result.after, after: result.after, sourcePath, taskId: result.finalTask, runId: result.runId, ...(finalInvocation ? { invocationId: finalInvocation.id } : {}) });
  return steps;
}

/** Four independently stored representations, one reusable manipulation UI. */
export function mountIRLab(host: HTMLElement, catalog: SourceCatalog): () => void {
  let domain: Domain = IR_LAB_DOMAINS[0].id, tab: Tab = 'ir', busy = false, disposed = false, childCleanup: (() => void) | undefined, initialPass = '', initialPassRun = '', passTab: 'overview' | 'contracts' = 'overview';
  const states = new Map<Domain, DomainState>();
  for (const descriptor of IR_LAB_DOMAINS) states.set(descriptor.id, { text: yaml(defaultIRLabSource(descriptor.id)) + '\n', runs: [], selected: -1, error: '', tolerance: .35, warm: false });
  const state = () => states.get(domain)!;
  const selectedRun = () => state().runs[state().selected];
  const app = element('section', 'ir-lab'); app.setAttribute('aria-label', 'IR manipulation laboratory'); host.replaceChildren(app);
  const toolbar = element('div', 'ir-lab-toolbar'), identity = element('div'), title = element('h2'), description = element('p', 'muted');
  identity.append(element('p', 'eyebrow', 'LAYER 3 · NATIVE REPRESENTATIONS, SHARED MANIPULATION'), title, description);
  const actions = element('div', 'ir-lab-actions'), run = button('Run pipeline', () => { void compile(); }, 'button compile-strategy'), warm = element('input'); warm.type = 'checkbox'; warm.setAttribute('aria-label', 'Run twice to inspect cache reuse');
  const tolerance = element('input', 'source-input'); tolerance.type = 'number'; tolerance.min = '0'; tolerance.max = '1'; tolerance.step = '.01'; tolerance.setAttribute('aria-label', 'Mesh approximation tolerance');
  const toleranceLabel = append(element('label', 'ir-limit'), 'Mesh error bound ', tolerance), exportButton = button('Export lab YAML', () => { const current = selectedRun(); if (current) download(`ir-${domain}-trace.yaml`, current.result); }, 'button small');
  actions.append(toleranceLabel, append(element('label', 'ir-checkbox'), warm, 'Run twice for cache'), run, exportButton); toolbar.append(identity, actions); app.append(toolbar);
  const domains = element('nav', 'ir-domain-nav'); domains.setAttribute('aria-label', 'IR example domains'); const domainButtons = new Map<Domain, HTMLButtonElement>();
  for (const descriptor of IR_LAB_DOMAINS) { const b = button(descriptor.label, () => { if (!busy) switchDomain(descriptor.id); }); domainButtons.set(descriptor.id, b); domains.append(b); } app.append(domains);
  const summary = element('div', 'ir-lab-summary'), history = element('select', 'source-picker'); history.setAttribute('aria-label', 'IR lab history'); const stats = element('div', 'source-result-meta'); summary.append(element('span', 'field-label', 'Run'), history, stats); app.append(summary);
  const status = element('p', 'ir-lab-status'); status.setAttribute('aria-live', 'polite'); app.append(status);
  const tabs = element('nav', 'inspection-modes'); tabs.setAttribute('aria-label', 'IR lab sections'); const tabButtons = new Map<Tab, HTMLButtonElement>();
  for (const [id, label] of [['ir', 'IR explorer'], ['lineage', 'Entity lineage'], ['passes', 'Compiler passes'], ['strategy', 'Strategy trace'], ['source', 'Example & compiler code'], ['input', 'Edit native input']] as const) {
    const b = button(label, () => { tab = id; renderBody(); }); b.setAttribute('aria-pressed', String(tab === id)); tabButtons.set(id, b); tabs.append(b);
  } app.append(tabs);
  const body = element('div', 'ir-lab-body'); app.append(body);
  history.addEventListener('change', () => { state().selected = Number(history.value); state().error = ''; initialPass = ''; initialPassRun = ''; render(); });
  tolerance.addEventListener('change', () => { state().tolerance = Number(tolerance.value); }); warm.addEventListener('change', () => { state().warm = warm.checked; });
  function switchDomain(next: Domain): void { domain = next; initialPass = ''; initialPassRun = ''; render(); if (!state().runs.length) void compile(); }
  function render(): void {
    const descriptor = IR_LAB_DOMAINS.find(d => d.id === domain)!; title.textContent = descriptor.label; description.textContent = descriptor.description;
    toleranceLabel.hidden = domain !== 'meshes'; tolerance.value = String(state().tolerance); warm.checked = state().warm;
    for (const [id, b] of domainButtons) { b.classList.toggle('active', domain === id); b.setAttribute('aria-pressed', String(domain === id)); b.disabled = busy; }
    history.replaceChildren(); state().runs.forEach((saved, index) => { const option = element('option', '', `#${index + 1} · ${saved.result.runId}${saved.warm ? ' · warm' : ''}`); option.value = String(index); history.append(option); }); history.value = String(state().selected);
    const saved = selectedRun(); stats.replaceChildren(); if (saved) {
      const r = saved.result, rows = r.snapshot.invocations.filter(i => i.runId === r.runId), checks = r.contracts.executions.flatMap(e => e.checks).length;
      for (const [label, count] of [['entities before', r.beforeGraph.entities.length], ['entities after', r.afterGraph.entities.length], ['edit transactions', r.changes.length], ['cache hits', rows.filter(i => i.status === 'cached').length], ['semantic checks', checks]] as const) stats.append(append(element('span'), element('strong', '', String(count)), ` ${label}`));
    }
    status.classList.toggle('bad', !!state().error); status.textContent = state().error || (busy ? `Running the ${domain} compiler, contracts and IR transformations…` : saved ? 'The selected run is immutable. Inspect its exact revisions, matching evidence, checked edits and compiler invocations.' : 'Run the pipeline to inspect actual IR transformations.');
    run.disabled = busy; history.disabled = busy; tolerance.disabled = busy; warm.disabled = busy; exportButton.disabled = !saved || busy; renderBody();
  }
  function renderBody(): void {
    childCleanup?.(); childCleanup = undefined; body.replaceChildren();
    for (const [id, b] of tabButtons) { b.classList.toggle('active', tab === id); b.setAttribute('aria-pressed', String(tab === id)); }
    const saved = selectedRun();
    if (tab === 'source') { const descriptor = IR_LAB_DOMAINS.find(d => d.id === domain)!; renderSourceBrowser(body, catalog, `ir-lab.${domain}`, descriptor.sourcePaths.find(path => path.endsWith(`/${domain}.ts`)) ?? descriptor.sourcePaths[0]); return; }
    if (tab === 'input') { renderInput(); return; }
    if (state().error) { body.append(element('p', 'source-empty', 'The latest input was rejected. No new result is displayed. Choose a retained run from history to inspect an earlier successful result, or correct the input and run again.')); return; }
    if (!saved) { body.append(element('p', 'source-empty', busy ? 'Executing the real compiler…' : 'No successful run is selected.')); return; }
    const result = saved.result;
    if (tab === 'ir') {
      try { childCleanup = mountIRInspector(body, { adapter: getIRLabAdapter(domain), steps: irInspectionSteps(result), sources: catalog, patternRegistry: predicateRegistry, onPass: (taskId, runId) => { initialPass = taskId; initialPassRun = runId ?? result.runId; passTab = 'overview'; tab = 'passes'; renderBody(); } }); }
      catch (error) { body.append(element('p', 'ir-query-error', `Cannot inspect retained revisions: ${errorText(error)}`)); }
    }
    if (tab === 'passes') {
      const inspectedRun = initialPassRun || result.runId;
      if (inspectedRun !== result.runId) body.append(append(element('div', 'ir-origin-notice'), element('p', '', `Inspecting the original invocation from ${inspectedRun}. The selected lab result is ${result.runId}; its cache hit reuses the earlier transformation evidence.`), button('Inspect selected run instead', () => { initialPassRun = result.runId; renderBody(); }, 'button small')));
      const passHost = element('div', 'ir-pass-host'); body.append(passHost);
      childCleanup = mountWorkbench(result.snapshot, passHost, { sources: catalog, embedded: true, initialRunId: inspectedRun, initialTaskId: initialPass || result.finalTask, initialTab: passTab, executedSource: { entry: `${domain}.ts`, files: Object.fromEntries(result.sourcePaths.map(path => [path, catalog.files.find(f => f.path === path)?.text ?? 'Source was not embedded in this build.'])) } });
    }
    if (tab === 'strategy') renderStrategy(result);
    if (tab === 'lineage') renderLineage(result);
  }
  function renderInput(): void {
    body.append(element('h3', '', 'Native source data'), element('p', 'muted', 'This data is passed to the real TypeScript example compiler. Each adapter validates its own storage format. Use “Example & compiler code” to inspect the actual authored transformation programs.'));
    const editorHost = element('div'); body.append(editorHost);
    const editor = mountYAMLEditor(editorHost, 'Editable native IR YAML', state().text, text => { state().text = text; }); childCleanup = editor.destroy;
    const actions = element('div', 'ir-input-actions'), reset = button('Restore example input', () => { state().text = yaml(defaultIRLabSource(domain)) + '\n'; editor.set(state().text); }, 'button small'), restore = button('Restore selected run input', () => { const saved = selectedRun(); if (saved) { state().text = saved.text; state().tolerance = saved.tolerance; state().warm = saved.warm; tolerance.value = String(saved.tolerance); warm.checked = saved.warm; editor.set(saved.text); } }, 'button small'); restore.disabled = !selectedRun();
    actions.append(reset, restore, button('Download input YAML', () => downloadText(`ir-${domain}-input.yaml`, state().text), 'button small'), button('Compile edited input', () => { void compile(); }, 'button compile-strategy')); body.append(actions);
  }
  function renderStrategy(result: IRLabResult): void {
    const workspace = element('div', 'ir-inspection-workspace'), sidebar = element('aside', 'ir-step-sidebar'), list = element('div', 'ir-step-list'), content = element('div', 'ir-detail-content');
    sidebar.append(append(element('div', 'ir-step-head'), element('h3', '', 'Executed strategy nodes'), element('p', 'muted', 'Actual plan, registry pins and execution evidence')), list); workspace.append(sidebar, content); body.append(workspace);
    const nodes = walkStrategy(result.strategy.plan), rows = result.strategy.trace.records; let selected = rows.at(-1)?.nodeId ?? result.strategy.plan.root.id;
    function show(node: StrategyNode): void {
      selected = node.id; list.querySelectorAll<HTMLButtonElement>('.ir-step').forEach(b => { b.classList.toggle('selected', b.dataset.node === selected); b.setAttribute('aria-pressed', String(b.dataset.node === selected)); });
      content.replaceChildren(); const executions = rows.filter(row => row.nodeId === node.id); content.append(element('h3', '', node.label ?? node.id), yamlBlock(node));
      content.append(element('h3', '', `${executions.length} recorded execution${executions.length === 1 ? '' : 's'}`));
      for (const execution of executions) {
        content.append(yamlBlock({ id: execution.id, status: execution.status, path: execution.path, evidence: execution.evidence, ...(execution.error ? { error: execution.error } : {}) }));
        for (const link of execution.links) content.append(button(`Inspect ${link.taskId}`, () => { initialPass = link.taskId; initialPassRun = result.snapshot.invocations.find(invocation => invocation.id === link.invocationId)?.runId ?? result.runId; passTab = 'overview'; tab = 'passes'; renderBody(); }, 'button small'));
      }
      content.append(details('Complete immutable Strategy IR', result.strategy.plan), details('Versioned algorithm registry', result.strategy.trace.registry), details('Example summary', result.summary));
    }
    for (const visit of nodes) {
      const counts = rows.filter(row => row.nodeId === visit.node.id), b = button('', () => show(visit.node), 'ir-step'); b.dataset.node = visit.node.id; b.setAttribute('aria-label', `IR strategy node ${visit.node.id}`); b.style.setProperty('--depth', String(visit.depth));
      b.append(element('span', `status-dot ${counts.some(r => r.status === 'failed') ? 'failed' : 'executed'}`), element('span', 'ir-step-label', visit.node.label ?? visit.node.id), element('span', 'ir-step-state', `${visit.node.kind} · ${counts.length}`)); list.append(b);
    }
    show(nodes.find(visit => visit.node.id === selected)?.node ?? result.strategy.plan.root);
  }
  function renderLineage(result: IRLabResult): void {
    const adapter = getIRLabAdapter(domain), artifacts = [...new Map([result.before, ...result.artifacts, ...result.snapshot.artifacts, result.after].filter(a => a.kind === adapter.kind && a.schemaVersion === adapter.schemaVersion).map(a => [JSON.stringify([a.id, a.revision]), a])).values()];
    const controls = element('div', 'ir-query-controls'), start = element('select', 'source-picker'), target = element('select', 'source-picker'), entity = element('select', 'source-picker'), direction = element('select', 'source-picker');
    start.setAttribute('aria-label', 'Lineage starting revision'); target.setAttribute('aria-label', 'Lineage target revision'); entity.setAttribute('aria-label', 'Lineage starting entity'); direction.setAttribute('aria-label', 'Lineage direction');
    for (const [index, artifact] of artifacts.entries()) for (const picker of [start, target]) { const option = element('option', '', `${artifact.id}@${artifact.revision.slice(0, 10)}`); option.value = String(index); picker.append(option); }
    start.value = String(artifacts.findIndex(a => a.id === result.before.id && a.revision === result.before.revision)); target.value = String(artifacts.findIndex(a => a.id === result.after.id && a.revision === result.after.revision));
    for (const [id, label] of [['forward', 'Follow transformations'], ['inverse', 'Follow origins (inverse relation)']]) { const option = element('option', '', label); option.value = id; direction.append(option); } direction.value = 'forward';
    function entities(): void { const view = openIR(artifacts[Number(start.value)], adapter); entity.replaceChildren(); for (const ref of view.entities()) { const option = element('option', '', ref.entity); option.value = ref.entity; entity.append(option); } entity.value = view.entities()[0]?.entity ?? ''; }
    entities(); start.addEventListener('change', entities);
    const output = element('div', 'ir-lineage-result'); output.setAttribute('aria-live', 'polite');
    function trace(): void {
      output.replaceChildren();
      try {
        const before = artifacts[Number(start.value)], after = artifacts[Number(target.value)], from = { artifact: before.id, revision: before.revision }, to = { artifact: after.id, revision: after.revision }, found = correspondencePath(result.correspondence, from, to, { reverse: direction.value === 'inverse', maxEdges: 1000 });
        if (!found) { output.append(element('p', 'ir-lineage-empty', 'No recorded correspondence path connects these exact revisions in the selected direction.')); return; }
        const ref = openIR(before, adapter).ref(entity.value), traced = traceEntity(ref, found.path, { maxRefs: 10000 });
        output.append(element('p', 'ir-lineage-status', `${found.path.length} correspondence steps · ${traced.current.length} resulting entities · ${found.exploredEdges} revision edges searched`));
        const chain = element('div', 'chain-strip'); for (const [index, revision] of [from, ...found.path.map(map => map.to)].entries()) { if (index) chain.append(element('span', 'chain-arrow', '→')); chain.append(append(element('div', 'chain-node'), element('span', 'chain-kind', revision.artifact), element('span', 'chain-task', revision.revision))); } output.append(chain);
        output.append(element('h3', '', 'Resulting entity references'), yamlBlock(traced.current), details('Step-by-step entity trace', traced, true));
        if (found.path.length) { const composed = found.path.slice(1).reduce((mapping, next) => composeCorrespondence(mapping, next, { maxPairs: 100000 }), found.path[0]); output.append(details('Composed correspondence for this route', composed)); }
        output.append(details('Revision branch points encountered', found.branchPoints));
      } catch (error) { output.append(element('p', 'ir-query-error', errorText(error))); }
    }
    controls.append(append(element('label', 'ir-checkbox'), 'From ', start), append(element('label', 'ir-checkbox'), 'Entity ', entity), append(element('label', 'ir-checkbox'), 'To ', target), direction, button('Swap revisions', () => { const previous = start.value; start.value = target.value; target.value = previous; direction.value = direction.value === 'forward' ? 'inverse' : 'forward'; entities(); trace(); }, 'button small'), button('Trace entity', trace, 'button compile-strategy'));
    body.append(element('h3', '', 'Follow an entity across exact IR revisions'), element('p', 'muted', 'Choose a destination revision to select a recorded route. The viewer uses one deterministic shortest route; it keeps alternative mesh candidates as separate branches. Merges and splits within that route remain many-to-many. Inverse correspondence describes origins and does not undo a transformation.'), controls, output); trace();
  }
  async function compile(): Promise<void> {
    if (busy || disposed) return; busy = true; const currentDomain = domain, target = state(), captured = { text: target.text, tolerance: target.tolerance, warm: target.warm }; target.error = ''; render();
    try {
      const source = parseYAMLData(captured.text);
      if (currentDomain === 'meshes' && (!Number.isFinite(captured.tolerance) || captured.tolerance < 0 || captured.tolerance > 1)) throw new Error('Mesh error bound must be a finite number from 0 to 1.');
      const result = await runIRLab(currentDomain, { source, meshTolerance: captured.tolerance, warm: captured.warm });
      if (disposed) return; target.runs.push({ result, ...captured }); target.selected = target.runs.length - 1; initialPass = ''; initialPassRun = ''; if (tab === 'input') tab = 'ir';
    } catch (error) { target.error = errorText(error); }
    finally { busy = false; if (!disposed) render(); }
  }
  render(); void compile(); return () => { disposed = true; childCleanup?.(); app.remove(); };
}
