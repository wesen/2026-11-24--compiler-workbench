import type { Artifact } from '../core/types.js';
import type { IRAdapter, IREntity, IRGraph, IRRef, IRView, TransformationResult } from '../ir/types.js';
import { openIR } from '../ir/index.js';
import type { PatternMatch, PatternDescriptor, PatternPredicateRegistry } from '../ir/patterns.js';
import { entity, explainMatch, matchAll } from '../ir/patterns.js';
import type { RewriteStep } from '../ir/rewrites.js';
import type { SourceCatalog } from '../workbench/source-catalog.js';
import { append, button, details, element, svg, yamlBlock } from '../workbench/dom.js';
import { renderSourceBrowser } from '../workbench/source-browser.js';
import { yaml } from '../workbench/presentation.js';
import { parseYAMLData } from './yaml-data.js';
import { mountYAMLEditor } from './ir-data-editor.js';

export interface IRInspectionStep {
  readonly id: string;
  readonly label: string;
  readonly before: Artifact;
  readonly after: Artifact;
  readonly result?: TransformationResult;
  readonly pattern?: PatternDescriptor;
  readonly matches?: readonly PatternMatch[];
  readonly rewrite?: RewriteStep;
  readonly sourcePath?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly invocationId?: string;
}

export interface IRInspectorOptions {
  readonly adapter: IRAdapter;
  readonly steps: readonly IRInspectionStep[];
  readonly sources: SourceCatalog;
  readonly patternRegistry?: PatternPredicateRegistry;
  readonly onPass?: (taskId: string, runId?: string) => void;
}

type Side = 'before' | 'after';
type Tab = 'entities' | 'query' | 'pattern' | 'changes' | 'native' | 'source';
type QueryKind = 'walk' | 'children' | 'parents' | 'successors' | 'predecessors' | 'ancestors' | 'dependencies' | 'subgraph' | 'find' | 'resolve';

function short(value: string, length = 16): string { return value.length > length ? `${value.slice(0, length - 1)}…` : value; }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function select(label: string, choices: readonly (readonly [string, string])[], value: string): HTMLSelectElement {
  const picker = element('select', 'source-picker'); picker.setAttribute('aria-label', label);
  for (const [id, text] of choices) { const option = element('option', '', text); option.value = id; picker.append(option); }
  picker.value = value; return picker;
}
function table(headers: readonly string[], rows: readonly (readonly (Node | string)[])[]): HTMLElement {
  const wrap = element('div', 'table-scroll'), t = element('table'), head = element('thead'), h = element('tr');
  for (const header of headers) h.append(element('th', '', header)); head.append(h); t.append(head);
  const body = element('tbody');
  for (const row of rows) { const tr = element('tr'); for (const value of row) tr.append(append(element('td'), value)); body.append(tr); }
  t.append(body); wrap.append(t); return wrap;
}

/** A small structural view built only from adapter entities and typed relations. */
function renderGraph(host: HTMLElement, view: IRView, selected: ReadonlySet<string>, onEntity: (id: string) => void): void {
  const graph = view.graph();
  // The full entity list remains available below. A bounded visual is explicitly
  // labelled; no query or transformation is ever truncated by this display cap.
  const shown = graph.entities.slice(0, 36), ids = new Set(shown.map(e => e.id));
  if (!shown.length) { host.append(element('p', 'muted', 'This revision contains no entities.')); return; }
  const columns = Math.min(3, shown.length), cell = 170, width = columns * cell + 24, height = Math.ceil(shown.length / columns) * 72 + 22;
  const canvas = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'ir-entity-graph', role: 'img', 'aria-label': 'Typed IR entity relationships' });
  const positions = new Map(shown.map((e, i) => [e.id, { x: 12 + (i % columns) * cell + cell / 2, y: 24 + Math.floor(i / columns) * 72 }]));
  const colors = { containment: '#6d8790', dependency: '#397f86', binding: '#987047', adjacency: '#7773a0', provenance: '#8d657a' };
  for (const relation of graph.relations.filter(r => ids.has(r.from) && ids.has(r.to))) {
    const a = positions.get(relation.from)!, b = positions.get(relation.to)!;
    const bend = relation.from === relation.to ? 42 : a.y === b.y ? 36 : (b.y - a.y) / 2;
    const path = svg('path', { d: `M ${a.x} ${a.y + 14} C ${a.x + (relation.from === relation.to ? 50 : 0)} ${a.y + bend} ${b.x + (relation.from === relation.to ? 50 : 0)} ${b.y - bend} ${b.x} ${b.y - 14}`, fill: 'none', stroke: colors[relation.category], 'stroke-width': selected.has(relation.from) || selected.has(relation.to) ? 2 : 1, opacity: selected.size && !selected.has(relation.from) && !selected.has(relation.to) ? .3 : .8 });
    const label = svg('title'); label.textContent = `${relation.from} → ${relation.to} · ${relation.kind} (${relation.category})`; path.append(label); canvas.append(path);
  }
  for (const entity of shown) {
    const p = positions.get(entity.id)!, active = selected.has(entity.id);
    const group = svg('g', { transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'button', 'aria-label': `Select entity ${entity.id}`, 'aria-pressed': String(active), class: 'ir-graph-node' });
    group.append(svg('rect', { x: -75, y: -15, width: 150, height: 39, rx: 6, fill: active ? '#d7efeb' : '#f9fcfc', stroke: active ? '#2e827e' : '#bdcfd4', 'stroke-width': active ? 2 : 1 }));
    const label = svg('text', { y: 0, 'text-anchor': 'middle', 'font-size': 10, fill: '#244652' }); label.textContent = short(view.describe(entity.id).label, 23);
    const kind = svg('text', { y: 14, 'text-anchor': 'middle', 'font-size': 8, fill: '#6c8590' }); kind.textContent = short(entity.kind, 28);
    const title = svg('title'); title.textContent = `${entity.id} · ${entity.kind}`; group.append(label, kind, title);
    group.addEventListener('click', () => onEntity(entity.id)); group.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEntity(entity.id); } }); canvas.append(group);
  }
  host.append(canvas);
  if (shown.length < graph.entities.length) host.append(element('p', 'muted', `Graph preview shows ${shown.length} of ${graph.entities.length} entities. The searchable lists and query results below contain the full representation.`));
}

/** Inspection reads exact retained revisions. Queries execute against the adapter,
 * and selection crosses revisions only through recorded correspondence entries. */
export function mountIRInspector(host: HTMLElement, options: IRInspectorOptions): () => void {
  let selectedIndex = Math.max(0, options.steps.findLastIndex(step => step.result?.changes.changed && (!step.rewrite || step.rewrite.status === 'applied'))), tab: Tab = 'entities', side: Side = 'before', entityId = '', filter = '', query: QueryKind = 'dependencies', relationKind = '', queryKind = '', queryOrder: 'pre' | 'post' | 'breadth' = 'pre';
  let queryLimit = 1000, queryTransitive = true, selectedMatch = 0;
  let editorCleanup: (() => void) | undefined;
  const patternDrafts = new Map<string, string>();
  const app = element('section', 'ir-inspector'); app.setAttribute('aria-label', 'Generic IR manipulation inspector'); host.replaceChildren(app);
  const chain = element('section', 'ir-chain'); app.append(chain);
  const workspace = element('div', 'ir-inspection-workspace'), sidebar = element('aside', 'ir-step-sidebar'), heading = append(element('div', 'ir-step-head'), element('h3', '', 'Transformation steps'), element('p', 'muted', 'Committed revisions and attempted rewrites'));
  const stepList = element('div', 'ir-step-list'); sidebar.append(heading, stepList);
  const panel = element('section', 'ir-detail'), header = element('div', 'ir-detail-head'), tabs = element('nav', 'strategy-tabs'), content = element('div', 'ir-detail-content'); tabs.setAttribute('aria-label', 'IR inspection sections'); tabs.setAttribute('role', 'tablist');
  const tabButtons = new Map<Tab, HTMLButtonElement>();
  for (const [id, label] of [['entities', 'Entities'], ['query', 'Query'], ['pattern', 'Pattern & match'], ['changes', 'Changes & origin'], ['native', 'Native IR'], ['source', 'Implementation']] as const) {
    const b = button(label, () => { tab = id; render(); }, 'tab'); b.setAttribute('role', 'tab'); tabButtons.set(id, b); tabs.append(b);
  }
  panel.append(header, tabs, content); workspace.append(sidebar, panel); app.append(workspace);
  function current(): IRInspectionStep | undefined { return options.steps[selectedIndex]; }
  function views(step: IRInspectionStep): Record<Side, IRView> { return { before: openIR(step.before, options.adapter), after: openIR(step.after, options.adapter) }; }
  function selectEntity(which: Side, id: string): void { side = which; entityId = id; render(); }
  function targets(step: IRInspectionStep): Record<Side, Set<string>> {
    const selected = { before: new Set<string>(), after: new Set<string>() }; if (!entityId) return selected;
    selected[side].add(entityId);
    for (const entry of step.result?.correspondence.entries ?? []) {
      if ((side === 'before' ? entry.from : entry.to).includes(entityId)) for (const target of side === 'before' ? entry.to : entry.from) selected[side === 'before' ? 'after' : 'before'].add(target);
    }
    if (step.before.id === step.after.id && step.before.revision === step.after.revision) selected[side === 'before' ? 'after' : 'before'].add(entityId);
    return selected;
  }
  function renderNavigation(): void {
    chain.replaceChildren(); const strip = element('div', 'chain-strip');
    chain.append(append(element('div', 'chain-title'), element('h2', '', 'IR revisions & edits'), element('span', 'muted', 'Each tile is its own recorded edge; alternative candidates remain separate branches')));
    stepList.replaceChildren();
    options.steps.forEach((step, index) => {
      const selected = index === selectedIndex, status = step.rewrite?.status ?? (step.result?.changes.changed ? 'applied' : 'inspected');
      const choose = () => { selectedIndex = index; entityId = ''; selectedMatch = 0; render(); };
      const row = button('', choose, `ir-step${selected ? ' selected' : ''}`); row.setAttribute('aria-label', `IR step ${step.label}`); row.setAttribute('aria-pressed', String(selected)); row.dataset.step = step.id;
      append(row, element('span', `status-dot ${status === 'applied' ? 'executed' : status === 'rejected' ? 'failed' : 'cached'}`), element('span', 'ir-step-label', step.label), element('span', 'ir-step-state', status)); stepList.append(row);
      const node = button('', choose, `chain-node${selected ? ' active' : ''}`); node.setAttribute('aria-label', `IR revision ${step.label}`);
      node.title = `${step.label} · ${status} · ${step.before.id}@${step.before.revision} → ${step.after.id}@${step.after.revision}`;
      append(node, element('span', 'chain-kind', `${step.label} · ${status}`), element('span', 'chain-task', `${short(step.before.revision, 10)} → ${short(step.after.revision, 10)}`)); strip.append(node);
    }); chain.append(strip);
  }
  function render(): void {
    editorCleanup?.(); editorCleanup = undefined;
    renderNavigation(); header.replaceChildren(); content.replaceChildren();
    for (const [id, b] of tabButtons) { b.classList.toggle('active', tab === id); b.setAttribute('aria-selected', String(tab === id)); }
    const step = current(); if (!step) { content.append(element('p', 'source-empty', 'No IR transformations have been recorded.')); return; }
    const bound = views(step), available = bound[side].entities(); if (!available.some(ref => ref.entity === entityId)) entityId = available[0]?.entity ?? '';
    const title = append(element('div', 'title-row'), element('h3', '', step.label), element('span', 'badge', step.rewrite?.status ?? 'retained revision'));
    if (step.taskId && options.onPass) { const inspect = button('Inspect compiler invocation', () => options.onPass!(step.taskId!, step.runId), 'button small'); inspect.title = `Exact originating invocation: ${step.invocationId ?? step.taskId}${step.runId ? ` in ${step.runId}` : ''}`; title.append(inspect); }
    header.append(title, element('p', 'source-path', `${step.before.id}@${short(step.before.revision)} → ${step.after.id}@${short(step.after.revision)}`));
    if (step.rewrite?.reason) header.append(element('p', 'ir-rule-reason', step.rewrite.reason));
    if (step.result && step.rewrite && step.rewrite.status !== 'applied') header.append(element('p', 'ir-candidate-note', 'This is an inspected candidate. The rewrite did not commit it; the retained head remains the before revision.'));
    if (tab === 'entities') renderEntities(step, bound);
    if (tab === 'query') renderQuery(bound);
    if (tab === 'pattern') renderPattern(step, bound);
    if (tab === 'changes') renderChanges(step);
    if (tab === 'native') renderNative(step, bound);
    if (tab === 'source') {
      const rule = step.rewrite?.rule, location = rule ? options.sources.definitions?.[`rewrite:${rule.id}@${rule.version}`] : undefined;
      renderSourceBrowser(content, options.sources, rule?.id ?? step.id, location ? undefined : step.sourcePath, location ? { location, label: 'rewrite rule' } : undefined);
    }
  }
  function renderEntities(step: IRInspectionStep, bound: Record<Side, IRView>): void {
    const search = element('input', 'search'); search.type = 'search'; search.placeholder = 'Filter entity id, kind or label…'; search.value = filter; search.setAttribute('aria-label', 'Filter IR entities');
    const panels = element('div', 'ir-revisions'), selection = element('div', 'ir-selection-detail'); content.append(search, panels, selection);
    const linked = targets(step);
    function draw(): void {
      panels.replaceChildren();
      for (const which of ['before', 'after'] as const) {
        const view = bound[which], box = element('section', `ir-revision ${which}`), refs = view.entities();
        const revisionLabel = which === 'before' ? 'Before' : step.result && step.rewrite && step.rewrite.status !== 'applied' ? 'Candidate · not committed' : 'After';
        box.append(element('h4', '', `${revisionLabel} · ${refs.length} entities`), element('p', 'source-path', `${view.artifact.kind}@${short(view.artifact.revision)}`));
        const visual = element('div', 'ir-graph-host'); renderGraph(visual, view, linked[which], id => selectEntity(which, id)); box.append(visual);
        const list = element('div', 'ir-entity-list'); list.setAttribute('aria-label', `${which} entities`);
        const filtered = refs.filter(ref => { const entity = view.resolve(ref); return `${entity.id} ${entity.kind} ${view.describe(ref).label}`.toLowerCase().includes(filter.toLowerCase()); });
        for (const ref of filtered) {
          const entity = view.resolve(ref), b = button('', () => selectEntity(which, ref.entity), `ir-entity-row${linked[which].has(ref.entity) ? ' selected' : ''}`);
          b.dataset.entity = ref.entity; b.dataset.side = which; b.setAttribute('aria-label', `${which} entity ${ref.entity}`); b.setAttribute('aria-pressed', String(linked[which].has(ref.entity)));
          append(b, element('span', 'ir-entity-name', ref.entity), element('span', 'ir-entity-kind', entity.kind)); list.append(b);
        }
        if (!filtered.length) list.append(element('p', 'muted', 'No entities match this filter.')); box.append(list); panels.append(box);
      }
    }
    search.addEventListener('input', () => { filter = search.value; draw(); }); draw();
    if (entityId) {
      const selected = bound[side].resolve(entityId), description = bound[side].describe(entityId), mapped = [...linked[side === 'before' ? 'after' : 'before']];
      selection.append(element('h3', '', `${description.label} · selected in ${side}`), element('p', 'ir-correspondence-note', mapped.length ? `Recorded correspondence: ${entityId} → ${mapped.join(', ')}` : `No counterpart is recorded for ${entityId} in the other revision.`), yamlBlock({ reference: bound[side].ref(entityId), kind: selected.kind, attributes: selected.attributes }));
      const relations = bound[side].relations(entityId, 'both');
      selection.append(element('h3', '', 'Typed relationships'), relations.length ? table(['Relation', 'Category', 'From', 'To'], relations.map(r => [r.kind, r.category, button(r.from, () => selectEntity(side, r.from), 'dependency-link'), button(r.to, () => selectEntity(side, r.to), 'dependency-link')])) : element('p', 'muted', 'This entity has no incident relations.'));
    }
  }
  function renderQuery(bound: Record<Side, IRView>): void {
    const controls = element('div', 'ir-query-controls'), sidePicker = select('Query revision', [['before', 'Before'], ['after', 'After']], side), entityPicker = select('Query entity', bound[side].entities().map(r => [r.entity, r.entity]), entityId);
    const queryPicker = select('IR query', [['walk', 'walk'], ['children', 'children'], ['parents', 'parents'], ['successors', 'successors'], ['predecessors', 'predecessors'], ['ancestors', 'ancestors'], ['dependencies', 'dependencies'], ['subgraph', 'subgraph'], ['find', 'find by kind'], ['resolve', 'resolve']], query);
    const relation = select('Query relation kind', [['', 'Default relationship semantics'], ...Object.keys(options.adapter.relationKinds).map(k => [k, `${k} · ${options.adapter.relationKinds[k]}`] as const)], relationKind);
    const order = select('Traversal order', [['pre', 'Preorder'], ['post', 'Postorder'], ['breadth', 'Breadth first']], queryOrder);
    const kind = element('input', 'source-input'); kind.setAttribute('aria-label', 'Find entity kind'); kind.placeholder = 'Entity kind'; kind.value = queryKind;
    const limit = element('input', 'source-input'); limit.type = 'number'; limit.min = '1'; limit.max = '10000'; limit.value = String(queryLimit); limit.setAttribute('aria-label', 'Query node budget');
    const transitive = element('input'); transitive.type = 'checkbox'; transitive.checked = queryTransitive; transitive.setAttribute('aria-label', 'Transitive dependencies');
    const output = element('div', 'ir-query-result'); output.setAttribute('aria-live', 'polite');
    function execute(): void {
      output.replaceChildren();
      try {
        side = sidePicker.value as Side; entityId = entityPicker.value; query = queryPicker.value as QueryKind; relationKind = relation.value; queryOrder = order.value as typeof queryOrder; queryKind = kind.value; queryLimit = Number(limit.value); queryTransitive = transitive.checked;
        if (!Number.isInteger(queryLimit) || queryLimit < 1 || queryLimit > 10000) throw new Error('Query node budget must be an integer from 1 to 10,000.');
        const view = bound[side], relations = relationKind ? [relationKind] : undefined; let result: unknown;
        if (query === 'walk') result = view.walk({ roots: entityId ? [entityId] : [], order: queryOrder, ...(relations ? { relations } : {}), maxNodes: queryLimit });
        else if (query === 'children') result = view.children(entityId);
        else if (query === 'parents') result = view.parents(entityId);
        else if (query === 'successors') result = view.successors(entityId, relations);
        else if (query === 'predecessors') result = view.predecessors(entityId, relations);
        else if (query === 'ancestors') result = view.ancestors(entityId, { maxNodes: queryLimit });
        else if (query === 'dependencies') result = view.dependencies(entityId, { transitive: queryTransitive, ...(relations ? { relations } : {}), maxNodes: queryLimit });
        else if (query === 'subgraph') result = view.subgraph([entityId], { closure: 'dependencies', ...(relations ? { relations } : {}), maxNodes: queryLimit });
        else if (query === 'find') result = view.find(entity => entity.kind === queryKind);
        else result = view.resolve(entityId);
        output.append(element('p', 'ir-query-status', `Executed ir.${query} on ${view.artifact.id}@${view.artifact.revision}.`), yamlBlock(result));
      } catch (error) { output.append(element('p', 'ir-query-error', errorText(error))); }
    }
    sidePicker.addEventListener('change', () => { side = sidePicker.value as Side; entityId = bound[side].entities().some(r => r.entity === entityId) ? entityId : bound[side].entities()[0]?.entity ?? ''; render(); });
    const run = button('Run query', execute, 'button compile-strategy');
    append(controls, sidePicker, queryPicker, entityPicker, relation, order, kind, append(element('label', 'ir-checkbox'), transitive, 'Transitive'), append(element('label', 'ir-limit'), 'Node budget ', limit), run);
    content.append(element('p', 'muted', 'These controls call the adapter-bound query APIs on the selected immutable revision. Containment, dependencies, bindings and adjacency remain distinct.'), controls, output); execute();
  }
  function renderPattern(step: IRInspectionStep, bound: Record<Side, IRView>): void {
    const matches = step.matches ?? (step.rewrite ? [step.rewrite.match] : []), pattern = step.pattern ?? matches[0]?.pattern;
    content.append(element('h3', '', 'Declarative pattern'));
    if (!pattern) content.append(element('p', 'muted', 'This step uses direct transactional edits. No pattern match was claimed.'));
    else content.append(yamlBlock(pattern));
    if (pattern && !matches.length) content.append(element('p', 'muted', 'The recorded pattern produced no matches on this revision.'));
    if (matches.length) {
      selectedMatch = Math.min(selectedMatch, matches.length - 1);
      const picker = select('Recorded pattern match', matches.map((m, i) => [String(i), `${i + 1}. ${m.root.entity} · ${Object.keys(m.bindings).join(', ') || 'no captures'}`]), String(selectedMatch));
      picker.addEventListener('change', () => { selectedMatch = Number(picker.value); render(); }); content.append(element('h3', '', `${matches.length} recorded match${matches.length === 1 ? '' : 'es'}`), picker);
      const match = matches[selectedMatch], explanation = explainMatch(match);
      content.append(table(['Capture', 'Entity', 'Exact revision'], Object.entries(match.bindings).map(([name, ref]) => [name, ref.entity, `${ref.artifact}@${ref.revision}`])), element('h3', '', 'Why it matched'), yamlBlock(explanation));
    }
    if (step.rewrite) content.append(element('h3', '', 'Rewrite acceptance'), yamlBlock({ rule: step.rewrite.rule, status: step.rewrite.status, ...(step.rewrite.reason ? { reason: step.rewrite.reason } : {}), preservation: step.rewrite.preservation }));
    content.append(element('h3', '', 'Run a pattern query'), element('p', 'muted', 'Edit the declarative YAML pattern and run the matcher on a retained revision. This query does not change the IR. Budget exhaustion is reported explicitly.'));
    const draftKey = step.id, initial = patternDrafts.get(draftKey) ?? yaml(pattern ?? entity()) + '\n', editorHost = element('div'); content.append(editorHost);
    const editor = mountYAMLEditor(editorHost, 'Editable IR pattern YAML', initial, text => patternDrafts.set(draftKey, text)); editorCleanup = editor.destroy;
    const controls = element('div', 'ir-query-controls'), revision = select('Pattern query revision', [['before', 'Before'], ['after', 'After']], side), root = select('Explain pattern entity', bound[side].entities().map(ref => [ref.entity, ref.entity]), entityId);
    const limit = element('input', 'source-input'); limit.type = 'number'; limit.min = '1'; limit.max = '100000'; limit.value = '10000'; limit.setAttribute('aria-label', 'Pattern search budget');
    const output = element('div', 'ir-pattern-query-result'); output.setAttribute('aria-live', 'polite');
    revision.addEventListener('change', () => { const view = bound[revision.value as Side]; root.replaceChildren(); for (const ref of view.entities()) { const option = element('option', '', ref.entity); option.value = ref.entity; root.append(option); } root.value = view.entities()[0]?.entity ?? ''; });
    function run(explain: boolean): void {
      output.replaceChildren();
      try {
        const parsed = parseYAMLData(editor.textarea.value) as PatternDescriptor, view = bound[revision.value as Side], budget = Number(limit.value);
        if (!Number.isInteger(budget) || budget < 1 || budget > 100000) throw new Error('Pattern budget must be an integer from 1 to 100,000.');
        const matchOptions = { maxSteps: budget, maxMatches: 1000, ...(options.patternRegistry ? { registry: options.patternRegistry } : {}) };
        if (explain) output.append(yamlBlock(explainMatch(parsed, view, root.value, matchOptions)));
        else { const found = matchAll(parsed, view, matchOptions); output.append(element('p', 'ir-pattern-query-status', `${found.length} matches on ${view.artifact.id}@${view.artifact.revision}`), yamlBlock(found)); }
      } catch (error) { output.append(element('p', 'ir-query-error', errorText(error))); }
    }
    controls.append(revision, root, append(element('label', 'ir-limit'), 'Search budget ', limit), button('Find matches', () => run(false), 'button compile-strategy'), button('Explain selected entity', () => run(true), 'button small'));
    content.append(controls, output);
  }
  function renderChanges(step: IRInspectionStep): void {
    const result = step.result;
    if (!result) { content.append(element('p', 'muted', 'This record contains no committed edit transaction. No changes or entity correspondence are inferred.')); if (step.rewrite) content.append(yamlBlock(step.rewrite)); return; }
    const changes = result.changes;
    content.append(element('h3', '', step.rewrite && step.rewrite.status !== 'applied' ? 'Candidate logical diff · not committed' : 'Actual logical diff'), element('p', 'ir-change-summary', `${changes.entities.length} entity changes · ${changes.relations.length} relationship changes · ${changes.operations.length} edit operations`));
    content.append(table(['Entity', 'Change', 'Before kind', 'After kind'], changes.entities.map(e => [e.entity, e.kind, e.before?.kind ?? '—', e.after?.kind ?? '—'])));
    content.append(table(['Relationship', 'Change', 'Before', 'After'], changes.relations.map(r => [r.relation, r.kind, r.before ? `${r.before.from} —${r.before.kind}→ ${r.before.to}` : '—', r.after ? `${r.after.from} —${r.after.kind}→ ${r.after.to}` : '—'])));
    content.append(element('h3', '', 'Entity correspondence'), element('p', 'muted', 'Each row is the recorded relation between source and target entities. Empty endpoints represent creation or removal; a mapping alone does not prove semantic equivalence.'));
    content.append(table(['Before entities', 'Relation', 'After entities'], result.correspondence.entries.map(entry => [entry.from.join(', ') || '∅', entry.relation, entry.to.join(', ') || '∅'])));
    content.append(details('Exact edit operations', changes.operations), details('Full correspondence with revision scope', result.correspondence), details('Diagnostics', result.diagnostics));
  }
  function renderNative(step: IRInspectionStep, bound: Record<Side, IRView>): void {
    const native = element('div', 'ir-native-values');
    for (const which of ['before', 'after'] as const) native.append(append(element('section'), element('h3', '', which === 'before' ? 'Native representation before' : 'Native representation after'), yamlBlock(step[which].value)));
    content.append(element('p', 'muted', 'These are the native artifact values. The adapter supplies a logical projection without replacing their domain storage format.'), native, details('Adapter interface and capabilities', bound.before.descriptor));
    if (bound[side].capabilities.includes('Visualizable')) content.append(details('Domain visualization payload', bound[side].visualize(entityId ? [entityId] : [])));
  }
  render(); return () => { editorCleanup?.(); app.remove(); };
}
