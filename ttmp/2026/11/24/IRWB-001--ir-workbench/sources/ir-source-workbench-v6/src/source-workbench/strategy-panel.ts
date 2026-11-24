import type { DatabaseSnapshot, InvocationRecord } from '../core/records.js';
import { canonical } from '../core/data.js';
import type { AlgorithmRegistry } from '../strategy/registry.js';
import type { StrategyPlan, StrategyNode, StrategyExecution, NodeExecution, NodeVisit } from '../strategy/ir.js';
import { validate } from '../strategy/validation.js';
import { walk, find, replace, insertBefore, insertAfter, remove, diff } from '../strategy/editing.js';
import { append, button, details, element, yamlBlock, number } from '../workbench/dom.js';
import { yaml, tokenizeYAML, renderTokens } from '../workbench/presentation.js';
import { renderSourceBrowser } from '../workbench/source-browser.js';
import type { SourceCatalog } from '../workbench/source-catalog.js';
import { parseYAMLData } from './yaml-data.js';

export interface StrategyPanelOptions {
  plan: StrategyPlan;
  defaultPlan: StrategyPlan;
  draftText: string;
  custom: boolean;
  busy: boolean;
  execution?: StrategyExecution;
  snapshot: DatabaseSnapshot;
  runId: string;
  registry: AlgorithmRegistry;
  sources: SourceCatalog;
  onText(text: string): void;
  onApply(plan: StrategyPlan, text: string): void;
  onCompile(plan: StrategyPlan): void;
  onDefault(): void;
  onTask(taskId: string): void;
  onContract?(taskId:string):void;
}

type Tab = 'overview' | 'executions' | 'yaml' | 'edit' | 'implementation';
const descriptions: Record<StrategyNode['kind'], string> = {
  apply: 'Invoke the exact registered algorithm version using resolved input and arguments.',
  sequence: 'Feed each result into the next step. Named bindings are available to later siblings.',
  parallel: 'Execute independent children against the same immutable input; return results in plan order.',
  fork: 'Evaluate named, isolated alternatives. Expected rejections remain candidate evidence.',
  chooseBest: 'Rank feasible alternatives by the declared metric and constraints. Stable candidate names break ties.',
  conditional: 'Evaluate the predicate, execute one branch, and explicitly record the skipped branch.',
  repeatUntilStable: 'Repeat the body until its identity is stable. Cycles and iteration exhaustion are explicit errors.',
  forEach: 'Run the body for each selected item with a bounded item count and ordered results.',
  require: 'Compute an analysis and bind its result while preserving the current value.',
  verify: 'Evaluate a named invariant and retain its verdict and evidence.',
  checkpoint: 'Record named evidence without changing the current value.',
  attempt: 'Use the fallback only for declared expected rejections. Algorithm bugs remain failures.',
  scope: 'Give nested work a named boundary and keep its bindings local.'
};

function badge(status: string): HTMLElement { return element('span', `strategy-status ${status}`, status); }
function table(headers: string[], rows: (Node | string)[][]): HTMLElement {
  const wrap = element('div', 'table-scroll'), t = element('table'), head = element('thead'), tr = element('tr');
  for (const label of headers) tr.append(element('th', '', label));
  head.append(tr); t.append(head);
  const body = element('tbody');
  for (const row of rows) { const tr = element('tr'); for (const value of row) { const td = element('td'); td.append(value); tr.append(td); } body.append(tr); }
  t.append(body); wrap.append(t); return wrap;
}
function download(name: string, text: string, mime = 'application/yaml'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime })), a = element('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 300);
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

/** Plan inspection and editing use the public Strategy IR API; execution data is never inferred from UI state. */
export function mountStrategyPanel(host: HTMLElement, options: StrategyPanelOptions): () => void {
  let applied = options.plan, text = options.draftText, selectedId = options.execution?.plan.root.id ?? applied.root.id;
  let tab: Tab = 'overview', filter = '', mode: 'executed' | 'draft' = options.execution ? 'executed' : 'draft';
  let selectedExecution = '', message = '', messageBad = false, editorCleanup: (() => void) | undefined;
  let visits: NodeVisit[] = [], nodeIndex = new Map<string, StrategyNode>(), recordIndex = new Map<string, NodeExecution[]>(), inspectionTrace: StrategyExecution | undefined;
  const app = element('section', 'strategy-workbench'); app.setAttribute('aria-label', 'Strategy IR workbench'); host.replaceChildren(app);
  const toolbar = element('div', 'strategy-toolbar');
  const identity = append(element('div'), element('p', 'eyebrow', 'STRATEGY IR · V6'), element('h2', '', 'The compilation plan'));
  const toolbarActions = element('div', 'strategy-actions');
  const planMode = element('select', 'source-picker'); planMode.setAttribute('aria-label', 'Inspected strategy plan');
  const executedOption = element('option', '', 'Executed plan'); executedOption.value = 'executed'; executedOption.disabled = !options.execution;
  const draftOption = element('option', '', 'Draft plan'); draftOption.value = 'draft'; planMode.append(executedOption, draftOption); planMode.value = mode;
  const exportPlan = button('Download plan YAML', () => download(`${inspected().id.replace(/[^a-z\d_.-]/gi, '-')}.yaml`, yaml(inspected()) + '\n'), 'button small');
  const importFile = element('input', 'source-download'); importFile.type = 'file'; importFile.accept = '.yaml,.yml,.json,application/yaml,application/json,text/yaml'; importFile.setAttribute('aria-label', 'Import strategy plan file');
  const importButton = button('Import plan', () => importFile.click(), 'button small');
  const defaultButton = button('Regenerate default plan', options.onDefault, 'button small'); defaultButton.disabled = options.busy;
  const editButton = button('Edit strategy', () => { mode = 'draft'; planMode.value = mode; tab = 'edit'; render(); }, 'button small');
  const compile = button('Compile strategy', compileDraft, 'button compile-strategy'); compile.disabled = options.busy;
  append(toolbarActions, planMode, editButton, exportPlan, importButton, importFile, defaultButton, compile); append(toolbar, identity, toolbarActions); app.append(toolbar);
  const state = element('p', 'strategy-state'); app.append(state);
  const notice = element('p', 'strategy-message'); notice.setAttribute('aria-live', 'polite'); app.append(notice);
  const workspace = element('div', 'strategy-workspace'), sidebar = element('aside', 'strategy-sidebar');
  const sidebarHead = append(element('div', 'strategy-sidebar-head'), element('h3', '', 'Planned nodes'));
  const search = element('input', 'search'); search.type = 'search'; search.placeholder = 'Filter node, operator or status…'; search.setAttribute('aria-label', 'Filter strategy nodes');
  const count = element('p', 'muted'); sidebarHead.append(search, count); sidebar.append(sidebarHead);
  const tree = element('div', 'strategy-tree'); tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', 'Strategy plan nodes'); sidebar.append(tree);
  const panel = element('section', 'strategy-detail'), panelHeader = element('div', 'strategy-detail-header'), tabs = element('nav', 'strategy-tabs');
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Strategy details');
  const tabButtons = new Map<Tab, HTMLButtonElement>();
  for (const [id, label] of [['overview', 'Step details'], ['executions', 'Executions'], ['yaml', 'Plan YAML'], ['edit', 'Edit plan'], ['implementation', 'Implementation']] as const) {
    const b = button(label, () => { tab = id; if (id === 'edit') { mode = 'draft'; planMode.value = mode; } render(); }, 'tab');
    b.setAttribute('role', 'tab'); tabButtons.set(id, b); tabs.append(b);
  }
  const content = element('div', 'strategy-detail-content'); append(panel, panelHeader, tabs, content); append(workspace, sidebar, panel); app.append(workspace);

  function inspected(): StrategyPlan { return mode === 'executed' && options.execution ? options.execution.plan : applied; }
  function indexPlan(): void {
    visits = walk(inspected()); nodeIndex = new Map(visits.map(v => [v.node.id, v.node])); recordIndex = new Map();
    inspectionTrace = options.execution && canonical(inspected()) === canonical(options.execution.plan) ? options.execution : undefined;
    for (const record of inspectionTrace?.records ?? []) {
      const bucket = recordIndex.get(record.nodeId) ?? []; bucket.push(record); recordIndex.set(record.nodeId, bucket);
    }
  }
  function matchingTrace(): StrategyExecution | undefined { return inspectionTrace; }
  function nodeRecords(nodeId: string): readonly NodeExecution[] { return recordIndex.get(nodeId) ?? []; }
  function selected(): StrategyNode { return nodeIndex.get(selectedId) ?? inspected().root; }
  function flag(nodeId: string): string {
    const records = nodeRecords(nodeId); if (!records.length) return matchingTrace() ? 'not reached' : 'unexecuted';
    for (const status of ['failed', 'cancelled', 'rejected', 'running'] as const) if (records.some(r => r.status === status)) return status;
    return records.some(r => r.status === 'succeeded') ? 'succeeded' : 'skipped';
  }
  function relatedRecords(node: StrategyNode): readonly NodeExecution[] {
    const records = matchingTrace()?.records ?? [], start = visits.findIndex(v => v.node.id === node.id), ids = new Set<string>();
    if (start < 0) return [];
    for (let i = start; i < visits.length; i++) {
      if (i > start && visits[i].depth <= visits[start].depth) break;
      ids.add(visits[i].node.id);
    }
    return records.filter(r => ids.has(r.nodeId));
  }
  function invocations(records: readonly NodeExecution[]): InvocationRecord[] {
    const rows = options.snapshot.invocations.filter(i => i.runId === options.runId), found = new Map<string, InvocationRecord>();
    for (const record of records) for (const link of record.links) {
      const row = link.invocationId ? rows.find(i => i.id === link.invocationId) : rows.find(i => i.taskId === link.taskId);
      if (row) found.set(row.id, row);
    }
    return [...found.values()];
  }
  function setMessage(value: string, bad = false): void { message = value; messageBad = bad; notice.textContent = message; notice.className = `strategy-message${bad ? ' bad' : ''}`; }
  function validateText(): StrategyPlan {
    const candidate = parseYAMLData(text), result = validate(candidate, options.registry);
    if (!result.valid) throw new Error(result.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
    return candidate as StrategyPlan;
  }
  function applyText(): void {
    try {
      const candidate = validateText(); applied = candidate; options.onApply(candidate, text);
      mode = 'draft'; planMode.value = mode; setMessage('Valid plan applied to the draft. Compile strategy to execute it.'); render();
    } catch (error) { setMessage(errorText(error), true); }
  }
  function compileDraft(): void {
    try { const candidate = validateText(); applied = candidate; options.onApply(candidate, text); setMessage('Executing the validated draft strategy…'); options.onCompile(candidate); }
    catch (error) { setMessage(errorText(error), true); }
  }
  function updatePlan(plan: StrategyPlan, explanation: string): void {
    const check = validate(plan, options.registry); if (!check.valid) throw new Error(check.issues.map(i => `${i.path}: ${i.message}`).join('\n'));
    applied = plan; text = yaml(plan) + '\n'; options.onText(text); options.onApply(plan, text); mode = 'draft'; planMode.value = mode;
    setMessage(explanation); render();
  }
  function edit(action: () => StrategyPlan, explanation: string): void { try { updatePlan(action(), explanation); } catch (e) { setMessage(errorText(e), true); } }
  function uniqueId(base: string): string { let id = base, n = 2; while (find(applied, id)) id = `${base}-${n++}`; return id; }
  function renderState(): void {
    let dirty = false; try { dirty = canonical(parseYAMLData(text)) !== canonical(options.execution?.plan ?? options.defaultPlan); } catch { dirty = true; }
    const trace = options.execution;
    state.textContent = `${mode === 'executed' ? 'Immutable plan captured for the selected run' : 'Editable draft; execution records appear only when this exact plan was run'}. ${options.custom || canonical(applied) !== canonical(options.defaultPlan) ? 'Custom strategy' : 'Generated strategy'}${dirty ? ' · draft differs from selected run' : ' · draft matches selected run'}${trace ? ` · ${trace.records.length} node records · ${trace.events.length} trace events` : ''}.`;
    notice.textContent = message; notice.className = `strategy-message${messageBad ? ' bad' : ''}`;
  }
  function renderTree(): void {
    tree.replaceChildren(); const displayed = visits.filter(v => `${v.node.id} ${v.node.kind} ${v.node.label ?? ''} ${flag(v.node.id)}`.toLowerCase().includes(filter));
    count.textContent = `${displayed.length} / ${visits.length} nodes · count = dynamic visits`;
    for (const visit of displayed) {
      const records = nodeRecords(visit.node.id), status = flag(visit.node.id);
      const row = button('', () => { selectedId = visit.node.id; selectedExecution = ''; render(); }, `strategy-node${selected().id === visit.node.id ? ' selected' : ''}`);
      row.dataset.nodeId = visit.node.id; row.dataset.kind = visit.node.kind; row.dataset.status = status; row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(visit.depth + 1)); row.setAttribute('aria-selected', String(selected().id === visit.node.id));
      row.style.setProperty('--depth', String(Math.min(visit.depth, 10))); row.title = `${visit.node.id}\n${visit.node.kind} · ${status}`;
      append(row, element('span', `strategy-dot ${status.replace(/ /g, '-')}`), append(element('span', 'strategy-node-label'), element('span', 'strategy-node-title', visit.node.label ?? visit.node.id), element('span', 'strategy-node-kind', visit.node.kind)), element('span', 'strategy-node-count', records.length ? String(records.length) : '—'));
      tree.append(row);
    }
  }
  function renderHeader(): void {
    panelHeader.replaceChildren(); const node = selected();
    append(panelHeader, append(element('div', 'strategy-selected-title'), element('h3', '', node.label ?? node.id), badge(flag(node.id))), element('p', 'source-path', `${node.id} · ${node.kind}`), element('p', 'strategy-operator-description', descriptions[node.kind]));
  }
  function renderCalls(records: readonly NodeExecution[]): void {
    const calls = invocations(records);
    if (!calls.length) { content.append(element('p', 'muted', 'This step has no linked compiler invocation. Control decisions and algorithm evidence are recorded below.')); return; }
    content.append(element('h3', '', 'Actual compiler invocations'));
    content.append(table(['Task', 'Result', 'Cache explanation',...(options.onContract?['Contract']:[])], calls.map(call => [button(call.taskId, () => options.onTask(call.taskId), 'dependency-link'), badge(call.status), call.cache.reason,...(options.onContract?[button('Contract evidence',()=>options.onContract!(call.taskId),'button small')]:[])])));
  }
  function renderOverview(): void {
    const node = selected(), records = nodeRecords(node.id), nested = relatedRecords(node), calls = invocations(nested);
    const metrics = element('div', 'strategy-facts');
    for (const [label, value] of [['Node executions', records.length], ['Nested records', nested.length], ['Linked passes', calls.length], ['Cache hits', calls.filter(c => c.status === 'cached').length]] as const)
      metrics.append(append(element('div'), element('span', 'field-label', label), element('strong', '', String(value))));
    content.append(metrics);
    if (!matchingTrace()) content.append(element('p', 'strategy-unexecuted', 'This draft has not been executed in the selected run. Its values and cache outcomes will be available after compilation.'));
    else if (!records.length) content.append(element('p', 'strategy-unexecuted', 'This node was not reached before execution ended. See the parent node for the failure or stopping condition.'));
    renderCalls(nested);
    const errors = records.filter(r => r.error); for (const r of errors) content.append(append(element('div', 'alert error'), element('strong', '', r.error!.code), element('p', '', r.error!.message)));
    for (const r of records) for (const evidence of r.evidence) content.append(details(`${evidence.label}${records.length > 1 ? ` · ${r.id}` : ''}`, evidence.data, true));
    content.append(details('Selected node definition · YAML', node, !records.length));
    if (records.length === 1) { if ('input' in records[0]) content.append(details('Resolved input', records[0].input)); if ('output' in records[0]) content.append(details('Produced result', records[0].output)); }
    content.append(element('p', 'muted', 'Node execution is control flow. Pass cache reuse is recorded by the linked compiler invocation. A reused pass still has a node execution in this run.'));
  }
  function renderExecutions(): void {
    const node = selected(), records = nodeRecords(node.id);
    if (!records.length) { content.append(element('p', 'source-empty', matchingTrace() ? 'No execution record for this node in the selected run.' : 'Compile this draft to inspect its executions.')); return; }
    const recordSelected = records.find(r => r.id === selectedExecution) ?? records[0]; selectedExecution = recordSelected.id;
    const list = element('div', 'strategy-execution-list');
    for (const record of records) {
      const context = [record.branch !== undefined ? `branch ${record.branch}` : '', record.index !== undefined ? `item ${record.index}` : '', record.iteration !== undefined ? `iteration ${record.iteration}` : ''].filter(Boolean).join(' · ');
      const b = button('', () => { selectedExecution = record.id; renderContent(); }, `strategy-execution${record.id === recordSelected.id ? ' selected' : ''}`); b.dataset.executionId = record.id;
      append(b, badge(record.status), element('span', '', context || record.id), element('span', 'muted', `${number(record.durationMs ?? 0, 2)} ms`)); list.append(b);
    }
    content.append(list, element('p', 'source-path', `${recordSelected.id} · ${recordSelected.path}`));
    if (recordSelected.error) content.append(details('Execution error', recordSelected.error, true));
    renderCalls([recordSelected]);
    for (const evidence of recordSelected.evidence) content.append(details(evidence.label, evidence.data, true));
    content.append(details('Resolved input', recordSelected.input), details('Produced result', recordSelected.output), details('Complete execution record', recordSelected));
    const events = matchingTrace()!.events.filter(e => e.executionId === recordSelected.id); content.append(details('Ordered trace events for this execution', events));
  }
  function renderYAML(): void {
    content.append(append(element('div', 'data-toolbar'), element('p', 'muted', `${mode === 'executed' ? 'Exact executed' : 'Applied draft'} Strategy IR · YAML`), button('Download this plan', () => download('strategy-plan.yaml', yaml(inspected()) + '\n'), 'button small')), yamlBlock(inspected()));
    if (options.execution) {
      const changes = diff(options.execution.plan, applied); content.append(details(`Executed → draft changes (${changes.length})`, changes));
      content.append(details('Execution identity and algorithm versions', { id: options.execution.id, planRevision: options.execution.planRevision, status: options.execution.status, registry: options.execution.registry }));
    }
  }
  function move(visit: NodeVisit, delta: number): StrategyPlan {
    const parent = visit.parent;
    if (!parent || (parent.kind !== 'sequence' && parent.kind !== 'parallel')) throw new Error('Reordering applies to sequence or parallel children. Use the YAML editor for other structures.');
    const steps = [...parent.steps], index = steps.findIndex(n => n.id === visit.node.id), target = index + delta;
    if (target < 0 || target >= steps.length) throw new Error('The node is already at this boundary');
    [steps[index], steps[target]] = [steps[target], steps[index]];
    return replace(applied, parent.id, { ...parent, steps });
  }
  function renderEditor(): void {
    content.append(element('p', 'muted', 'This is the executable Strategy IR. Edit YAML, validate it, then compile it. Algorithm references must use registered IDs and exact versions. Two-space indentation; JSON flow values; no anchors, aliases, tags or block strings.'));
    const actions = element('div', 'strategy-edit-actions');
    const validateButton = button('Validate draft', () => { try { const plan = validateText(); setMessage(`Valid plan: ${walk(plan).length} nodes; all algorithm references and bindings resolve.`); } catch (e) { setMessage(errorText(e), true); } }, 'button small');
    append(actions, validateButton, button('Apply draft', applyText, 'button small'), button('Compile this draft', compileDraft, 'button small'), button('Restore executed plan', () => { if (options.execution) updatePlan(options.execution.plan, 'Restored the exact plan from this run.'); }, 'button small'));
    const restore = actions.lastElementChild as HTMLButtonElement; restore.disabled = !options.execution || options.busy; content.append(actions);
    const wrap = element('div', 'strategy-editor-wrap'), color = element('pre', 'strategy-editor-color'), editor = element('textarea', 'strategy-editor');
    editor.setAttribute('aria-label', 'Editable strategy YAML'); editor.spellcheck = false; editor.wrap = 'off'; editor.value = text; color.setAttribute('aria-hidden', 'true');
    const sync = () => { color.scrollTop = editor.scrollTop; color.scrollLeft = editor.scrollLeft; };
    const highlight = () => { color.replaceChildren(); renderTokens(color, tokenizeYAML(editor.value)); color.append(document.createTextNode('\n')); sync(); };
    editor.addEventListener('input', () => { text = editor.value; options.onText(text); highlight(); renderState(); }); editor.addEventListener('scroll', sync);
    editor.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); editor.dispatchEvent(new Event('input')); } if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); compileDraft(); } });
    append(wrap, color, editor); content.append(wrap); highlight();
    const observer = new ResizeObserver(() => { color.style.height = `${editor.clientHeight}px`; color.style.width = `${editor.clientWidth}px`; sync(); }); observer.observe(editor); editorCleanup = () => observer.disconnect();
    const node = find(applied, selectedId) ?? applied.root, visit = walk(applied).find(v => v.node.id === node.id)!;
    content.append(element('h3', '', `Structural edits · ${node.id}`));
    const structural = element('div', 'strategy-edit-actions');
    const checkpoint = (): StrategyNode => ({ id: uniqueId(`${node.id}-checkpoint`), kind: 'checkpoint', name: 'User checkpoint' });
    append(structural,
      button('Insert checkpoint before', () => edit(() => insertBefore(applied, node.id, checkpoint()), 'Inserted a checkpoint before the selected node.'), 'button small'),
      button('Insert checkpoint after', () => edit(() => insertAfter(applied, node.id, checkpoint()), 'Inserted a checkpoint after the selected node.'), 'button small'),
      button('Wrap in scope', () => edit(() => replace(applied, node.id, { id: uniqueId(`${node.id}-scope`), kind: 'scope', name: 'User scope', body: node }), 'Wrapped the selected node in an isolated scope.'), 'button small'),
      button('Move earlier', () => edit(() => move(visit, -1), 'Moved the node earlier. Binding validation passed.'), 'button small'),
      button('Move later', () => edit(() => move(visit, 1), 'Moved the node later. Binding validation passed.'), 'button small'),
      button('Remove node', () => edit(() => remove(applied, node.id), 'Removed the selected node. Structural and binding validation passed.'), 'button small'));
    content.append(structural, element('p', 'muted', 'Structural buttons edit the applied draft. Pending text edits are retained until you apply them; apply text before using these buttons. Invalid removals and binding-breaking reorders are rejected.'));
    let pendingText = true;
    try { pendingText = canonical(parseYAMLData(text)) !== canonical(applied); } catch { /* Invalid drafts stay editable; structural actions wait. */ }
    if (pendingText) for (const b of structural.querySelectorAll('button')) { b.disabled = true; b.title = 'Apply the text draft before structural editing'; }
  }
  function renderImplementation(): void {
    content.append(element('p', 'strategy-source-note', 'The generated plan comes from the TypeScript plan builders. The interpreter executes its operators; registered algorithms call the actual domain compiler passes. All of those source files are embedded below.'));
    const actions = element('div', 'strategy-edit-actions');
    const browser = element('div', 'strategy-source-browser');
    const open = (path: string) => { browser.replaceChildren(); renderSourceBrowser(browser, options.sources, selected().id, path); };
    const generatorPath = inspected().id === 'geometry.cleanup' ? 'src/strategy-examples/cleanup.ts' : 'src/pipelines/strategy.ts';
    for (const [label, path] of [['Plan generator', generatorPath], ['Interpreter', 'src/strategy/interpreter.ts'], ['Operator builders', 'src/strategy/builders.ts'], ['Validation', 'src/strategy/validation.ts'], ['Editing API', 'src/strategy/editing.ts']] as const)
      actions.append(button(label, () => open(path), 'button small'));
    content.append(actions, browser); open(generatorPath);
  }
  function renderContent(): void {
    editorCleanup?.(); editorCleanup = undefined; content.replaceChildren(); content.scrollTop = 0;
    for (const [id, b] of tabButtons) { b.classList.toggle('active', tab === id); b.setAttribute('aria-selected', String(tab === id)); }
    if (tab === 'overview') renderOverview(); if (tab === 'executions') renderExecutions(); if (tab === 'yaml') renderYAML(); if (tab === 'edit') renderEditor(); if (tab === 'implementation') renderImplementation();
  }
  function render(): void { indexPlan(); renderState(); renderTree(); renderHeader(); renderContent(); }
  search.addEventListener('input', () => { filter = search.value.toLowerCase(); renderTree(); });
  planMode.addEventListener('change', () => { mode = planMode.value as typeof mode; selectedExecution = ''; render(); });
  importFile.addEventListener('change', async () => {
    try { const file = importFile.files?.[0]; if (!file) return; if (file.size > 1_000_000) throw new Error('Plan file exceeds the 1 MB limit'); const imported = await file.text();
      const previous = text; text = imported; try { validateText(); } catch (error) { text = previous; throw error; }
      options.onText(text); mode = 'draft'; planMode.value = mode; tab = 'edit'; setMessage(`Imported ${file.name}. Apply or compile the draft to use it.`); render();
    } catch (e) { setMessage(errorText(e), true); } finally { importFile.value = ''; }
  });
  render(); return () => { editorCleanup?.(); host.replaceChildren(); };
}
