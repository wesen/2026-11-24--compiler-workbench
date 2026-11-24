// dsl.js: the UI DSL. A UI script (ui/*.js in a project) builds tiles from components and cells.
//   cells       ui.query(ctx => …) · ui.from(script, args) · ui.state(v) · ui.param.* · ui.selection()
//               · cell.map(fn) · ui.derive({ a, b }, fn). Each records what it read and reruns when that changes.
//   components  text, stat, table, chart, code, tree, diff, badge, list, json, slider, toggle, select,
//               multiselect, input, button, row, col, tabs, section, when; ui.task for long work
//   tiles       ui.tile(id).title(…).place({ splitRight: 'ir' }).body(component), returned by the script
//   decoration  ui.annotate('ir' | 'source' | 'rv32').stmt(fn) / .gutter(fn) / .insn(fn) …
//   extension   ui.fragment(name).on('Table').method(…) · ui.use(name) · ui.component(name)…register()
//   inspection  ui.plan(script).explain() · runtime mutation for the agent: ui.live.tile(id).append(…)
// Build-time lambdas shape the tree; runtime lambdas (queries, cell renderers, handlers) run as values change.
(function (G) {
'use strict';
const UI = G.UI = G.UI || {};
const WB = G.WB;
const esc = s => UI.esc(s);
const fail = (code, msg, fix) => WB.fail(code, msg, fix ? { fix } : undefined);
const DSL = UI.dsl = { owners: new Map(), errors: new Map(), annotations: [], fragments: new Map(), used: new Set(), components: new Map(), params: new Map(), live: new Map() };

// ---------- the reactive core ----------
let tracking = null, ids = 0, currentOwner = null;
const scheduled = new Set();
let flushing = false;
function track(cell) { if (tracking && tracking !== cell) { tracking.deps.add(cell); cell.subs.add(tracking); } }
function invalidate(cell) {
  for (const s of [...cell.subs]) {
    if (s instanceof Cell) { if (!s.dirty) { s.dirty = true; invalidate(s); } }
    else schedule(s);
  }
}
function schedule(consumer) {
  scheduled.add(consumer);
  if (!flushing) { flushing = true; queueMicrotask(flush); }
}
function flush() {
  flushing = false;
  const list = [...scheduled]; scheduled.clear();
  for (const c of list) if (!c.disposed) try { c.run(); } catch (e) { console.error(e); }
}
class Cell {
  constructor(kind, label, fn) {
    this.id = ++ids; this.kind = kind; this.label = label || `${kind}#${this.id}`;
    this.fn = fn || null; this.computed = !!fn; this.dirty = !!fn; this.deps = new Set(); this.subs = new Set();
    this.version = 0; this._value = undefined; this.error = null; this.pending = false; this.computing = false; this.owner = currentOwner;
    if (currentOwner) currentOwner.cells.push(this);
  }
  get value() { track(this); return this.get(); }
  get() {
    if (this.computed && this.dirty) this.recompute();
    if (this.error) throw this.error;
    return this._value;
  }
  recompute() {
    if (this.computing) fail('cycle', `${this.label} depends on itself`, 'a cell cannot read itself, directly or through other cells');
    for (const d of this.deps) d.subs.delete(this);
    this.deps = new Set();
    const prev = tracking; tracking = this; this.computing = true;
    try {
      const v = this.fn();
      this.error = null;
      if (v && typeof v.then === 'function') {
        this.pending = true;
        const mine = ++this.version;
        v.then(r => { if (this.version !== mine) return; this._value = r; this.pending = false; this.version++; invalidate(this); },
               e => { if (this.version !== mine) return; this.error = e; this.pending = false; this.version++; invalidate(this); });
      } else { this._value = v; this.version++; }
    } catch (e) {
      if (e && e.code === 'cycle' && !String(e.message).includes(' → ')) e.message = e.message.replace(' depends on itself', ` → ${this.label} depends on itself`);
      this.error = e; this.version++;
    } finally { this.computing = false; tracking = prev; this.dirty = false; }
  }
  set(v) {
    if (this.computed) fail('readOnlyCell', `${this.label} is computed from other cells; set the cells it reads`, 'ui.state(initial) makes a cell you can set');
    this._value = v; this.version++; invalidate(this);
    return v;
  }
  update(fn) { return this.set(fn(this._value)); }
  map(fn) { const src = this; return cellProxy(new Cell('map', `${src.label}.map`, () => fn(src.value))); }
  as(name) { this.label = name; return this; }
  lazy() { return this; }
  peek() { try { return this.get(); } catch { return undefined; } }
  _describe() { return { cell: this.label, kind: this.kind, ...(this.pending ? { pending: true } : {}), ...(this.error ? { error: this.error.message } : {}) }; }
}
const cellProxy = c => WB.guard('Cell', c);
DSL.Cell = Cell;
const isCell = x => x instanceof Cell || (x && x.__isCell);
Object.defineProperty(Cell.prototype, '__isCell', { value: true });
const val = x => isCell(x) ? x.value : x;
const peekVal = x => isCell(x) ? x.peek() : x;

// external sources: the program (any revision or edit), the selection, the project files
const sources = DSL.sources = { program: new Cell('source', 'program'), focus: new Cell('source', 'selection'), files: new Cell('source', 'files') };
DSL.bump = name => { const s = sources[name]; s.version++; invalidate(s); };

// a consumer re-runs a render or a watcher when a cell it read changes
class Consumer {
  constructor(label, run) { this.label = label; this.deps = new Set(); this.children = []; this.disposed = false; this._run = run; }
  run() { if (this.disposed) return; this.clear(); const prev = tracking; tracking = this; try { this._run(this); } finally { tracking = prev; } }
  clear() { for (const d of this.deps) d.subs.delete(this); this.deps = new Set(); for (const c of this.children) c.dispose(); this.children = []; }
  dispose() { this.disposed = true; this.clear(); }
}
DSL.Consumer = Consumer;

// the ctx a query, a handler or a script sees: reading p or wb makes the program a dependency
function ctxFor(owner) {
  const wb = UI.wb;
  return {
    get wb() { track(sources.program); return wb; },
    get p() { track(sources.program); const cur = wb.current; return cur; },
    get project() { track(sources.files); return owner && owner.project ? wb.projects.get(owner.project) : wb.projects.current; },
    get ui() { return owner ? owner.ui : DSL.liveUi; },
  };
}
function readOnly(fn, what) {
  const wb = UI.wb, was = wb._state.readOnly;
  wb._setReadOnly(true);
  try { return fn(); }
  catch (e) {
    if (e && e.code === 'readOnly') fail('sideEffectInQuery', `${what} is read-only, but it tried ${e.message.replace(/^\[readOnly\] read-only mode: /, '').replace(/ is off$/, '')}`, "change the program in a handler: ui.button('…').on(({ p }) => p.apply('fold')), or run a script on a copy: ui.from(name, args, { fresh: true })");
    throw e;
  } finally { wb._setReadOnly(was); }
}

// ---------- owners: what one UI script (or the agent) made, so it can be taken down ----------
function makeOwner(key, info) {
  const prev = DSL.owners.get(key);
  if (prev) disposeOwner(prev);
  const o = { key, ...info, cells: [], consumers: [], views: [], annotations: [], ui: null };
  DSL.owners.set(key, o);
  return o;
}
function disposeOwner(o) {
  for (const c of o.consumers) c.dispose();
  for (const v of o.views) { UI.dock.removeView(v); delete UI.views[v]; }
  DSL.annotations = DSL.annotations.filter(a => a.owner !== o);
  DSL.owners.delete(o.key);
}

// ---------- DOM helper ----------
const SVGNS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'line', 'rect', 'circle', 'path', 'text', 'polyline', 'title']);
function h(tag, attrs, ...kids) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k === 'className' ? 'class' : k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids, parent) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    if (k instanceof Node) el.appendChild(k);
    else if (isComponent(k)) el.appendChild(mount(k, parent));
    else if (isCell(k)) {
      const v = k.value;
      if (v && typeof v === 'object' && !isComponent(v) && !(v instanceof Node) && !Array.isArray(v)) fail('notAComponent', `${k.label} holds ${describeThing(v)}, not something to show`, `show part of it: ui.stat('bytes', ${k.label.split(':')[0]}.map(x => x.bytes)), or ui.json(${k.label.split(':')[0]})`);
      append(el, [v], parent);
    }
    else el.appendChild(document.createTextNode(String(k)));
  }
}
h.svg = (attrs, ...kids) => h('svg', { xmlns: SVGNS, ...attrs }, ...kids);
h.line = a => h('line', { x1: a.x1, x2: a.x2, y1: a.y ?? a.y1, y2: a.y ?? a.y2, class: a.class || 'ink' });
h.label = (a, text) => h('text', { x: a.x, y: a.y, class: a.class || '', 'text-anchor': a.anchor }, text);
h.rect = a => h('rect', a);
h.path = a => h('path', a);
h.circle = a => h('circle', a);
DSL.h = h;

// ---------- components ----------
const COMPONENT = Symbol('component');
const isComponent = x => !!(x && x[COMPONENT]);
DSL.isComponent = isComponent;
// a component builder: props set by fluent methods; render(props, h, ctx) gives a node, re-run when cells it read change
function component(kind, render, methods = {}, init = {}) {
  const b = { [COMPONENT]: true, _kind: kind, _props: { ...init }, _render: render, _owner: currentOwner };
  const self = new Proxy(b, {
    get(t, k) {
      if (k === COMPONENT || typeof k === 'symbol' || k.startsWith('_')) return t[k];
      if (k in methods) return (...a) => { methods[k](t._props, ...a); return self; };
      const frag = fragmentMember(kind, k);
      if (frag) return frag.type === 'attr' ? frag.fn(self) : (...a) => { const r = frag.fn(self, ...a); return r === undefined ? self : r; };
      if (k === 'then' || k === 'toJSON') return undefined;
      const names = Object.keys(methods);
      const near = WB.didYouMean(k, names), provider = fragmentProvider(kind, k);
      fail('unknownMember', `${kind} has no member "${String(k)}".` + (near ? ` Did you mean "${near}"?` : ''), provider ? `fragment "${provider}" provides it: ui.use('${provider}')` : `${kind} members: ${names.join(', ') || 'none'}`);
    },
    set(t, k) { fail('immutable', `${kind} is a builder; set .${String(k)} through its methods`); },
  });
  b._self = self;
  return self;
}
function mount(comp, parentConsumer) {
  const box = document.createElement(comp._props.inline ? 'span' : 'div');
  box.className = 'dsl-' + comp._kind.toLowerCase();
  const consumer = new Consumer(comp._kind, (c) => {
    box.textContent = '';
    try {
      const node = comp._render(comp._props, h, ctxFor(comp._owner), c);
      if (node) append(box, [node], c);
    } catch (e) {
      box.appendChild(h('div', { class: 'fail dslfail' }, h('b', {}, `${comp._kind}: `), e.message.split('\n')[0], e.fix ? h('div', { class: 'note' }, 'fix: ' + e.fix) : null));
    }
  });
  if (parentConsumer) parentConsumer.children.push(consumer);
  else if (comp._owner) comp._owner.consumers.push(consumer);
  consumer.run();
  return box;
}
DSL.mount = mount;
// children of a layout: components, text, or cells whose value is either
function kids(list, where) {
  for (const k of list) {
    if (k === null || k === undefined || typeof k === 'string' || typeof k === 'number' || isComponent(k)) continue;
    if (isCell(k)) continue;
    if (Array.isArray(k)) { kids(k, where); continue; }
    if (k && typeof k.then === 'function') fail('notAComponent', `${where} takes components; got a Promise`, 'wrap async work in ui.query(async ctx => …) or ui.task(…)');
    fail('notAComponent', `${where} takes components or text; got ${describeThing(k)}`, 'ui.text(…), ui.table(…), ui.stat(label, cell)…');
  }
  return list;
}
function describeThing(x) {
  if (x && x._describe) { const d = x._describe(); if (d && d.of) return 'a Selection (' + d.of + ')'; if (d && d.id) return `a handle (${d.id})`; }
  if (Array.isArray(x)) return `an array of ${x.length}`;
  return typeof x === 'object' ? 'an object' : typeof x;
}
// data for a table, list or chart: an array, or a cell of one
function dataOf(x, where) {
  if (isCell(x) || Array.isArray(x)) return x;
  if (x && x._describe && x._describe().of) fail('notACell', `${where} wants a cell or an array, got a Selection (it would never update)`, `${where.replace(/\(.*$/, '')}(ui.query(({ p }) => ${x._describe().of}.list()))`);
  if (x && typeof x.then === 'function') fail('notACell', `${where} wants a cell or an array, got a Promise`, 'ui.query(async ctx => …) makes a cell of async work');
  fail('notACell', `${where} wants a cell or an array, got ${describeThing(x)}`, 'ui.query(({ p }) => [...]) or ui.state([...])');
}
const resolve = x => { const v = val(x); return isCell(v) ? v.value : v; };
const asNode = (v, c) => isComponent(v) ? mount(v, c) : v instanceof Node ? v : document.createTextNode(v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// value formatting for tables
const fmtCell = v => v === null || v === undefined ? '' : typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('en-GB') : v.toFixed(2)) : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? (v.id || JSON.stringify(v)) : String(v);
function colSpec(c) {
  if (typeof c === 'string') return { label: c, get: r => r && (typeof r[c] === 'function' ? r[c]() : r[c]) };
  if (Array.isArray(c)) return { label: c[0], get: c[1] };
  if (typeof c === 'function') return { label: c.name || '', get: c };
  if (c && c.label) return { label: c.label, get: c.value || (r => r[c.key]) };
  fail('badArgument', 'a column is a key, [label, row => value] or { label, value }');
}

function makeComponents(owner) {
  const C = {};
  C.text = (md) => component('Text', (p, h) => { const v = resolve(p.md); const d = h('div', { class: 'doc-inline' }); d.innerHTML = UI.md(String(v ?? ''), { ids: true }); return d; }, {}, { md });
  C.stat = (label, value) => component('Stat', (p, h) => {
    const v = resolve(p.value), cmp = p.compare !== undefined ? resolve(p.compare) : undefined, bad = p.badIf ? p.badIf(v) : false;
    return h('div', { class: 'stat' + (bad ? ' bad' : '') }, h('small', {}, resolve(p.label)), h('b', {}, cmp !== undefined && cmp !== v ? `${fmtCell(cmp)} → ${fmtCell(v)}` : fmtCell(v)), p.unit !== undefined ? h('small', {}, String(resolve(p.unit) ?? '')) : null);
  }, { badIf(p, fn) { p.badIf = fn; }, compareTo(p, c) { p.compare = c; }, unit(p, u) { p.unit = u; } }, { label, value });
  C.badge = (text, tone = '') => component('Badge', (p, h) => h('span', { class: 'dslbadge ' + (p.tone || '') }, resolve(p.text)), {}, { text, tone, inline: true });
  C.code = (text, lang = 'text') => component('Code', (p, h) => h('pre', { class: 'src', html: UI.highlight(String(resolve(p.text) ?? ''), p.lang) }), {}, { text, lang });
  C.json = (x) => component('Json', (p, h) => h('pre', { class: 'res' }, G.WB.toYaml(resolve(p.x))), {}, { x });
  C.table = (data) => component('Table', (p, h, ctx, c) => {
    let rows = resolve(p.data);
    if (rows && rows._describe && rows._describe().of) rows = rows.list();
    if (!Array.isArray(rows)) rows = rows === undefined ? [] : [rows];
    const pending = isCell(p.data) && p.data.pending;
    if (p.sort) rows = rows.slice().sort((a, b) => { const x = colSpec(p.sort).get(a), y = colSpec(p.sort).get(b); return (x > y) - (x < y); });
    if (p.limit) rows = rows.slice(0, p.limit);
    const cols = (p.columns || (rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]).filter(k => !k.startsWith('_')).slice(0, 8) : ['value'])).map(colSpec);
    const sel = p.highlight ? resolve(p.highlight[0]) : null;
    const all = cols.map(col => rows.map(r => col.get(r)));
    const tbl = h('table', { class: 'rt dsltable' }, h('tr', {}, cols.map(col => h('th', {}, col.label))),
      rows.map((r, i) => h('tr', {
        class: [p.onRow ? 'clickable' : '', p.rowClass ? p.rowClass(r) : '', p.highlight && p.highlight[1](r, sel) ? 'hlrow' : ''].join(' '),
        onclick: p.onRow ? () => UI.guarded(() => p.onRow(r, ctxFor(owner)))() : null,
      }, cols.map((col, k) => {
        const v = all[k][i], st = p.styles && p.styles[col.label] ? p.styles[col.label](v, all[k]) : null;
        return h('td', { class: typeof v === 'number' ? 'num' : 'mono', style: st && st.shade !== undefined ? { background: `color-mix(in srgb, var(--accent) ${Math.round(Math.max(0, Math.min(1, st.shade)) * 28)}%, transparent)` } : null }, asNode(isComponent(v) ? v : fmtCell(v), c));
      }))));
    return h('div', { class: 'dslblock' }, p.title ? h('div', { class: 'dsltitle' }, p.title) : null, rows.length ? tbl : h('p', { class: 'empty' }, pending ? 'Running…' : (p.empty || 'Nothing to show.')));
  }, {
    columns(p, ...cols) { p.columns = cols; }, onRow(p, ev, fn) { if (typeof ev === 'function') fn = ev; p.onRow = fn; },
    highlight(p, cell, fn) { p.highlight = [cell, fn]; }, rowClass(p, fn) { p.rowClass = fn; }, empty(p, t) { p.empty = t; },
    sort(p, key) { p.sort = key; }, limit(p, n) { p.limit = n; }, title(p, t) { p.title = t; },
    cellStyle(p, col, fn) { (p.styles = p.styles || {})[col] = fn; },
  }, { data: dataOf(data, 'table()') });
  C.list = (data) => component('List', (p, h, ctx, c) => {
    const items = resolve(p.data) || [];
    if (!items.length) return h('p', { class: 'empty' }, p.empty || 'Nothing to show.');
    return h('div', { class: 'dsllist' }, items.map((it, i) => h('div', { class: 'dslitem' }, asNode(p.item ? p.item(it, i) : fmtCell(it), c))));
  }, { item(p, fn) { p.item = fn; }, empty(p, t) { p.empty = t; } }, { data: dataOf(data, 'list()') });
  C.tree = (data) => component('Tree', (p, h) => {
    const root = resolve(p.data);
    const label = p.label || (n => `${n.id || ''}  ${n.text || ''}${n.via ? '  · via ' + n.via : ''}`);
    const children = p.children || (n => [n.from, ...(n.because || [])].filter(x => x && typeof x === 'object'));
    const node = (n, d) => d > 12 ? null : h('li', {}, h('span', { class: n.id ? 'treelink' : '', onclick: n.id ? () => UI.focus(n.id) : null }, label(n)), (() => { const k = children(n); return k.length ? h('ul', {}, k.map(x => node(x, d + 1))) : null; })());
    return root ? h('ul', { class: 'dsltree' }, node(root, 0)) : h('p', { class: 'empty' }, 'Nothing to show.');
  }, { label(p, fn) { p.label = fn; }, children(p, fn) { p.children = fn; } }, { data });
  C.diff = (data) => component('Diff', (p, h, ctx, c) => {
    const d = resolve(p.data);
    if (!d) return h('p', { class: 'empty' }, isCell(p.data) && p.data.pending ? 'Running…' : 'Nothing to compare.');
    let rows = d.rows;
    if (!rows && typeof d.a === 'string') rows = lineDiff(d.a, d.b);
    const sum = p.summary ? p.summary(d) : d.kind === 'asmDiff' ? `${d.a.bytes} → ${d.b.bytes} bytes · ${d.same} same, −${d.removed} +${d.added}` : '';
    return h('div', { class: 'dslblock' }, sum ? h('div', { class: 'dsltitle' }, sum) : null,
      h('table', { class: 'rt asm asmdiff' }, rows.map(r => h('tr', { class: r.op === '=' ? 'dsame' : r.op === '-' ? 'ddel' : 'dadd' }, h('td', { class: 'mono sign' }, r.op === '=' ? '' : r.op === '-' ? '−' : '+'), h('td', { class: 'mono' }, r.text), h('td', { class: 'mono dim' }, r.covers || '')))));
  }, { summary(p, fn) { p.summary = fn; } }, { data });
  C.chart = (data) => component('Chart', (p, h) => chart(resolve(p.data) || [], p, h, owner), {
    line(p) { p.kind = 'line'; }, bar(p) { p.kind = 'bar'; }, scatter(p) { p.kind = 'scatter'; },
    x(p, k) { p.x = k; }, y(p, ...ks) { p.y = ks; }, tone(p, fn) { p.tone = fn; }, mark(p, fn) { p.mark = fn; },
    onPoint(p, fn) { p.onPoint = fn; }, title(p, t) { p.title = t; }, sameAxis(p, on = true) { p.same = on; }, height(p, n) { p.height = n; },
  }, { data: dataOf(data, 'chart()'), kind: 'line' });
  // controls
  C.slider = (cell) => { needParam(cell, 'slider()', ['int', 'float']); return component('Slider', (p, h) => {
    const d = cell._param, v = cell.value;
    return h('label', { class: 'dslctl' }, h('span', { class: 'lbl' }, d.name), h('input', { type: 'range', min: d.min, max: d.max, step: d.step, value: v, oninput: e => { e.target.nextSibling.textContent = e.target.value; }, onchange: e => setParam(cell, +e.target.value) }), h('b', {}, String(v)));
  }); };
  C.toggle = (cell, label) => component('Toggle', (p, h) => { const v = !!cell.value; return h('button', { class: 'tog' + (v ? ' on' : ''), onclick: () => cell._param ? setParam(cell, !v) : cell.set(!v) }, label || (cell._param ? cell._param.name : cell.label)); });
  C.select = (cell, options) => component('Select', (p, h) => {
    const opts = resolve(options || (cell._param && cell._param.options)) || [], v = cell.value;
    return h('label', { class: 'dslctl' }, h('span', { class: 'lbl' }, cell._param ? cell._param.name : cell.label), h('select', { onchange: e => cell._param ? setParam(cell, e.target.value) : cell.set(e.target.value) }, opts.map(o => h('option', { selected: o === v ? true : null }, o))));
  });
  C.multiselect = (cell) => { needParam(cell, 'multiselect()', ['set']); return component('Multiselect', (p, h) => {
    const v = cell.value || [];
    return h('div', { class: 'chips dslctl' }, h('span', { class: 'lbl' }, cell._param.name), cell._param.options.map(o => h('button', { class: v.includes(o) ? 'on' : '', onclick: () => setParam(cell, v.includes(o) ? v.filter(x => x !== o) : cell._param.options.filter(x => x === o || v.includes(x))) }, o)));
  }); };
  C.input = (cell, opts = {}) => component('Input', (p, h) => h('input', { class: 'filter', placeholder: opts.placeholder || '', value: cell.peek() ?? '', onchange: e => cell.set(e.target.value) }));
  C.button = (label) => component('Button', (p, h) => {
    const off = p.disabledIf ? !!resolve(p.disabledIf) : false;
    return h('button', { class: 'btn sm ' + (p.tone || ''), disabled: off ? true : null, onclick: async () => {
      if (!p.on) return;
      try { await UI.batch(() => p.on(ctxFor(owner))); } catch (e) { UI.toast(e.message.split('\n')[0], true); }
    } }, resolve(p.label));
  }, { on(p, fn) { p.on = fn; }, disabledIf(p, c) { p.disabledIf = c; }, tone(p, t) { p.tone = t; } }, { label });
  // layout
  C.row = (...k) => component('Row', (p, h) => h('div', { class: 'dslrow' }, p.k), {}, { k: kids(k, 'row()') });
  C.col = (...k) => component('Col', (p, h) => h('div', { class: 'dslcol' }, p.k), {}, { k: kids(k, 'col()') });
  C.section = (title, ...k) => component('Section', (p, h) => h('div', { class: 'block dslsection' }, h('header', {}, h('h2', {}, resolve(p.title))), p.k), {}, { title, k: kids(k, 'section()') });
  C.tabs = (spec) => {
    const entries = Array.isArray(spec) ? spec : Object.entries(spec);
    kids(entries.map(e => e[1]), 'tabs()');
    const on = new Cell('state', 'tabs'); on._value = entries[0] && entries[0][0];
    return component('Tabs', (p, h) => { const cur = on.value; return h('div', { class: 'dsltabs' }, h('div', { class: 'seg sm' }, entries.map(([l]) => h('button', { class: l === cur ? 'on' : '', onclick: () => on.set(l) }, l))), (entries.find(e => e[0] === cur) || [])[1]); });
  };
  C.when = (cell, fn) => component('When', (p, h, ctx, c) => { const v = val(cell); if (!v) return p.else ? asNode(p.else, c) : null; return asNode(fn(v), c); }, { else(p, comp) { p.else = comp; } });
  return C;
}
function lineDiff(a, b) {
  const x = String(a).split('\n'), y = String(b).split('\n'), n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { out.push({ op: '=', text: x[i] }); i++; j++; }
    else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) out.push({ op: '-', text: x[i++] });
    else out.push({ op: '+', text: y[j++] });
  }
  return out;
}
function chart(rows, p, h, owner) {
  const W = 480, H = p.height || 200, L = 44, R = 44, T = 14, B = 26;
  if (!rows.length) return h('p', { class: 'empty' }, 'No data yet.');
  const xk = p.x || Object.keys(rows[0])[0], yks = p.y || Object.keys(rows[0]).filter(k => k !== xk && typeof rows[0][k] === 'number').slice(0, 2);
  const xs = rows.map(r => +r[xk]), xNum = xs.every(Number.isFinite);
  const xmin = xNum ? Math.min(...xs) : 0, xmax = xNum ? Math.max(...xs) : rows.length - 1;
  const X = (r, i) => L + (W - L - R) * ((xNum ? +r[xk] : i) - xmin) / Math.max(1e-9, xmax - xmin);
  const scales = {};
  // one scale per series (left and right axes), or one for all of them with .sameAxis()
  const range = ks => { const v = rows.flatMap(r => ks.map(k => +r[k])).filter(Number.isFinite); const lo = Math.min(0, ...v); return [lo, Math.max(...v, lo + 1)]; };
  for (const k of yks) { const [lo, hi] = range(p.same ? yks : [k]); scales[k] = y => T + (H - T - B) * (1 - (y - lo) / (hi - lo)); scales[k].lo = lo; scales[k].hi = hi; }
  const marks = [];
  yks.forEach((k, ki) => {
    const Y = scales[k], cls = ki === 0 ? 'ink' : 'mut';
    if (p.kind === 'line') marks.push(h('polyline', { points: rows.map((r, i) => `${X(r, i)},${Y(+r[k])}`).join(' '), class: 'cline ' + cls }));
    rows.forEach((r, i) => {
      const x = X(r, i), y = Y(+r[k]), tone = p.tone ? p.tone(r) : cls;
      const click = p.onPoint ? () => UI.guarded(() => p.onPoint(r, ctxFor(owner)))() : null;
      const tip = h('title', {}, `${xk} ${r[xk]} · ${k} ${r[k]}`);
      if (p.kind === 'bar') { const bw = Math.max(3, (W - L - R) / rows.length / yks.length - 2); marks.push(h('rect', { x: x - bw * yks.length / 2 + ki * bw, y, width: bw, height: Math.max(0, Y(Math.max(0, scales[k].lo)) - y), class: 'cbar ' + tone, onclick: click }, tip)); }
      else if (p.mark && p.mark(r) === 'cross') marks.push(h('path', { d: `M${x - 4} ${y - 4}L${x + 4} ${y + 4}M${x - 4} ${y + 4}L${x + 4} ${y - 4}`, class: 'cross ' + tone, onclick: click }, tip));
      else marks.push(h('circle', { cx: x, cy: y, r: p.kind === 'scatter' ? 4 : 3, class: 'cdot ' + tone, onclick: click }, tip));
    });
  });
  const k0 = yks[0], k1 = yks[1];
  return h('div', { class: 'dslblock' }, p.title ? h('div', { class: 'dsltitle' }, p.title) : null,
    h.svg({ viewBox: `0 0 ${W} ${H}`, class: 'dslchart' },
      h('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'axis' }),
      h('text', { x: L, y: H - 8, class: 'tick' }, `${xk} ${xNum ? xmin : ''}`), h('text', { x: W - R, y: H - 8, class: 'tick', 'text-anchor': 'end' }, xNum ? String(xmax) : ''),
      k0 ? h('text', { x: L - 4, y: T + 4, class: 'tick', 'text-anchor': 'end' }, fmtCell(scales[k0].hi)) : null,
      k0 ? h('text', { x: L - 4, y: H - B, class: 'tick', 'text-anchor': 'end' }, fmtCell(scales[k0].lo)) : null,
      k1 && !p.same ? h('text', { x: W - R + 4, y: T + 4, class: 'tick mut' }, fmtCell(scales[k1].hi)) : null,
      marks),
    h('div', { class: 'legend' }, yks.map((k, i) => h('span', { class: i ? 'mut' : '' }, (i ? '○ ' : '● ') + k + (i && !p.same ? ' (right)' : '')))));
}

// ---------- parameters: cells backed by the workbench's parameter store ----------
function needParam(cell, where, kinds) {
  if (!isCell(cell) || !cell._param || !kinds.includes(cell._param.kind)) fail('notAParam', `${where} wants a ${kinds.join(' or ')} parameter`, `const n = ui.param.${kinds[0]}('name', { … }); ${where.replace('()', '')}(n)`);
}
function setParam(cell, v) { UI.wb.param.set(cell._param.name, v); cell.set(v); }
function paramCell(kind, name, opts) {
  const key = name, prev = DSL.params.get(key);
  const sig = JSON.stringify([kind, opts.min, opts.max, Array.isArray(opts.options) ? opts.options : null]);
  if (prev && prev._sig !== sig && prev._owner !== currentOwner && prev._owner && DSL.owners.has(prev._owner.key)) fail('paramConflict', `"${name}" is already a ${prev._param.kind} parameter here${prev._param.min !== undefined ? ` (${prev._param.min}..${prev._param.max})` : ''}`, 'use the same kind and range, or another name');
  const wb = UI.wb;
  const def = { kind, name, ...opts };
  let v;
  if (kind === 'int') v = wb.param.int(name, opts); else if (kind === 'float') v = wb.param.float(name, opts); else if (kind === 'bool') v = wb.param.bool(name, opts);
  else if (kind === 'choice') { const o = peekVal(opts.options) || []; v = wb.param.choice(name, o.length ? o : [opts.default ?? ''], { default: opts.default ?? o[0], about: opts.about }); def.options = opts.options; }
  else if (kind === 'set') { def.options = opts.options; const cur = wb._state.paramValues[name]; v = Array.isArray(cur) ? cur : (opts.default || opts.options.slice()); }
  const c = prev && prev._sig === sig ? prev : new Cell('param', name);
  c._param = def; c._sig = sig; c._owner = currentOwner; c._value = v;
  if (kind === 'choice' && isCell(opts.options)) {   // options from a cell: keep the value one of them
    const w = new Consumer('param options ' + name, () => { const o = opts.options.value || []; if (o.length && !o.includes(c._value)) setParam(c, opts.default && o.includes(opts.default) ? opts.default : o[0]); });
    if (currentOwner) currentOwner.consumers.push(w);
    queueMicrotask(() => w.run());
  }
  DSL.params.set(key, c);
  return cellProxy(c);
}

// ---------- tasks: long runtime work with progress, partial results, stop and restart ----------
function makeTask(fn, owner) {
  const rows = new Cell('state', 'task.rows'); rows._value = [];
  const progress = new Cell('state', 'task.progress'); progress._value = 0;
  const status = new Cell('state', 'task.status'); status._value = 'idle';
  let ctrl = null, pendingRows = [], flushQueued = false;
  const flushRows = () => { flushQueued = false; if (pendingRows.length) { rows.set(rows._value.concat(pendingRows)); pendingRows = []; } };
  const T = {
    rows: cellProxy(rows), progress: cellProxy(progress), status: cellProxy(status),
    async start() {
      if (ctrl) ctrl.abort();
      const mine = ctrl = new AbortController();
      rows.set([]); progress.set(0); status.set('running');
      try {
        const out = await fn(ctxFor(owner), { signal: mine.signal, progress: f => progress.set(f), partial: r => { pendingRows.push(r); if (!flushQueued) { flushQueued = true; setTimeout(flushRows, 50); } } });
        flushRows();
        if (Array.isArray(out) && !rows._value.length) rows.set(out);
        if (ctrl === mine) status.set(mine.signal.aborted ? 'stopped' : 'done');
      } catch (e) { flushRows(); if (ctrl === mine) { status.set('error: ' + e.message.split('\n')[0]); } }
      finally { if (ctrl === mine) ctrl = null; }
    },
    stop() { if (ctrl) { ctrl.abort(); status.set('stopped'); } },
    restartOn(...cells) {
      let first = true;
      // a change restarts a task that is running or has results; one never started waits for Start
      const w = new Consumer('task restart', () => { cells.forEach(c => val(c)); if (first) { first = false; return; } if (ctrl || status._value !== 'idle') { T.stop(); queueMicrotask(() => T.start()); } });
      if (owner) owner.consumers.push(w);
      w.run();
      return T;
    },
    controls() {
      return component('TaskControls', (p, h) => {
        const st = status.value, f = progress.value, n = rows.value.length;
        return h('div', { class: 'dslrow taskctl' },
          h('button', { class: 'btn sm primary', onclick: () => T.start() }, st === 'running' ? 'Restart' : 'Start'),
          h('button', { class: 'btn sm', disabled: st !== 'running' ? true : null, onclick: () => T.stop() }, 'Stop'),
          h('div', { class: 'meter' + (String(st).startsWith('error') ? ' bad' : '') }, h('i', { style: { width: Math.round(f * 100) + '%' } })),
          h('small', { class: 'dim' }, `${st} · ${n} results`));
      });
    },
    _describe() { return { task: status._value, results: rows._value.length, progress: progress._value }; },
  };
  return WB.guard('Task', T);
}

// ---------- tiles ----------
const PLACES = ['splitRight', 'splitLeft', 'splitAbove', 'splitBelow', 'tabWith', 'replace'];
function makeTile(id, owner) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][\w-]{0,40}$/.test(id)) fail('badArgument', `a tile id is a word (letters, digits, - and _), not "${id}"`);
  const t = { id, title: id, place: null, size: 0.4, body: null, visibleWhen: null };
  const B = WB.guard('Tile', {
    title(x) { t.title = x; return B; },
    place(where) {
      if (!where || typeof where !== 'object') fail('badPlacement', 'place() takes { splitRight: view } or another placement', PLACES.join(', '));
      for (const k of Object.keys(where)) if (!PLACES.includes(k) && k !== 'size') fail('badPlacement', `place() has no "${k}".` + (WB.didYouMean(k, PLACES) ? ` Did you mean "${WB.didYouMean(k, PLACES)}"?` : ''), PLACES.join(', '));
      t.place = where; if (where.size) t.size = where.size; return B;
    },
    size(n) { t.size = n; return B; },
    body(comp) { if (!isComponent(comp) && !isCell(comp)) fail('notAComponent', `body() takes a component; got ${describeThing(comp)}`, 'ui.col(ui.text(…), ui.table(…))'); t.body = comp; return B; },
    visibleWhen(cell) { t.visibleWhen = cell; return B; },
    _describe() { return { tile: t.id, title: String(peekVal(t.title) ?? t.id), ...(t.place ? { place: t.place } : {}), body: t.body ? (t.body._kind || 'cell') : null }; },
    _tile: t, _owner: owner,
  });
  return B;
}
function viewIdOf(owner, id) { return `u-${owner.script || 'live'}-${id}`.replace(/[^\w-]/g, '-'); }
function mountTile(B, owner) {
  const t = B._tile, vid = viewIdOf(owner, t.id);
  const view = {
    title: '', on: [], custom: true, owner: owner.key,
    get titleText() { return String(peekVal(t.title) ?? t.id); },
    render(el) {
      if (view._mounted) view._mounted.dispose();
      el.innerHTML = '';
      const root = h('div', { class: 'tabbody col' }, h('div', { class: 'scroll dslscroll' }));
      el.appendChild(root);
      const box = root.firstChild;
      const c = new Consumer('tile ' + t.id, (me) => { box.textContent = ''; const b = isCell(t.body) ? t.body.value : t.body; if (b) append(box, [b], me); else box.appendChild(h('p', { class: 'empty padded' }, 'This tile has no body yet.')); });
      view._mounted = c; owner.consumers.push(c);
      c.run();
    },
  };
  Object.defineProperty(view, 'title', { get() { return view.titleText; } });
  UI.views[vid] = view;
  owner.views.push(vid);
  if (isCell(t.title)) { const w = new Consumer('title ' + t.id, () => { void t.title.value; UI.dock.refreshStrips(); }); owner.consumers.push(w); w.run(); }
  // a placement names a built-in view (ir, source, rv32 …) or another tile by its id
  const target = name => {
    if (UI.views[name] && !UI.views[name].custom) return name;
    const mine = viewIdOf(owner, name);
    if (UI.views[mine]) return mine;
    for (const o of DSL.owners.values()) { const v = viewIdOf(o, name); if (o.project === owner.project && UI.views[v]) return v; }
    return name;
  };
  const where = () => { const pl = { ...(t.place || { tabWith: 'pipeline' }) }; for (const k of Object.keys(pl)) if (k !== 'size') pl[k] = target(pl[k]); return pl; };
  const place = () => UI.dock.placeView(vid, where(), t.size);
  if (t.visibleWhen) {
    const w = new Consumer('visible ' + t.id, () => { const on = !!val(t.visibleWhen); if (on) place(); else UI.dock.removeView(vid, { keepRegistered: true }); });
    owner.consumers.push(w); w.run();
  } else place();
  return vid;
}

// ---------- annotations on the built-in views ----------
const ANNOTATE = { ir: ['stmt', 'value', 'block'], source: ['gutter', 'lineClass'], rv32: ['insn'], cfg: ['block'] };
function makeAnnotate(view, owner) {
  if (!ANNOTATE[view]) fail('badArgument', `annotate() knows ${Object.keys(ANNOTATE).join(', ')}, not "${view}"`);
  const A = {};
  for (const kind of ANNOTATE[view]) A[kind] = fn => { DSL.annotations.push({ owner, view, kind, fn }); UI.refresh && UI.refresh([view]); return G_A; };
  const G_A = WB.guard(`Annotate(${view})`, A);
  return G_A;
}
const watchers = {};
// what the built-in views ask: badges (HTML) and classes for one row
UI.annotationsFor = function annotationsFor(view, kind, arg) {
  const list = DSL.annotations.filter(a => a.view === view && a.kind === kind);
  if (!list.length) return [];
  if (!watchers[view] || watchers[view].disposed) watchers[view] = new Consumer('annotations ' + view, () => {});
  const w = watchers[view];
  w._run = () => { UI.refresh([view]); };
  const prev = tracking; tracking = w;
  const out = [];
  try {
    for (const a of list) {
      try { const r = a.fn(arg); if (r === null || r === undefined || r === false || r === '') continue; out.push(isComponent(r) ? badgeHtml(r) : String(r)); }
      catch (e) { out.push(`<span class="dslbadge accent" title="${esc(e.message)}">annotation failed</span>`); }
    }
  } finally { tracking = prev; }
  return out;
};
UI.annotationsBegin = view => { if (watchers[view]) watchers[view].clear(); };
function badgeHtml(comp) {
  if (comp._kind === 'Badge') return `<span class="dslbadge ${esc(comp._props.tone || '')}">${esc(String(peekVal(comp._props.text)))}</span>`;
  const n = mount(comp); return n.outerHTML;
}

// ---------- fragments and new components ----------
function fragmentMember(kind, name) { for (const f of DSL.used) { const fr = DSL.fragments.get(f); const m = fr && fr.members.find(x => x.kind === kind && x.member === name); if (m) return m; } return null; }
function fragmentProvider(kind, name) { for (const fr of DSL.fragments.values()) if (!DSL.used.has(fr.name) && fr.members.some(x => x.kind === kind && x.member === name)) return fr.name; return null; }
function defineFragment(name) {
  const fr = { name, members: [] }; let kind = null;
  DSL.fragments.set(name, fr);
  const B = WB.guard('Fragment', {
    on(k) { kind = k; return B; },
    method(member, fn) { if (!kind) fail('incomplete', 'fragment: .on(Kind) before .method'); fr.members.push({ kind, member, type: 'method', fn }); return B; },
    attr(member, fn) { if (!kind) fail('incomplete', 'fragment: .on(Kind) before .attr'); fr.members.push({ kind, member, type: 'attr', fn }); return B; },
    get members() { return fr.members.map(m => `${m.kind}.${m.member} (${m.type})`); },
  });
  return B;
}
function useFragment(name) {
  const fr = DSL.fragments.get(name);
  if (!fr) fail('unknownFragment', `no UI fragment "${name}"`, `fragments: ${[...DSL.fragments.keys()].join(', ') || 'none yet'}`);
  for (const m of fr.members) for (const other of DSL.used) { const o = DSL.fragments.get(other); if (o && o !== fr && o.members.some(x => x.kind === m.kind && x.member === m.member)) fail('fragmentConflict', `${m.kind}.${m.member} is defined by "${o.name}" and "${fr.name}"`, `ui.drop('${o.name}') first`); }
  DSL.used.add(name);
  return { using: name };
}
function defineComponent(name) {
  const spec = { name, props: {}, data: null, render: null };
  const B = WB.guard('ComponentBuilder', {
    props(schema) { spec.props = schema; return B; },
    data(fn) { spec.data = fn; return B; },
    render(fn) { spec.render = fn; return B; },
    register() {
      if (!spec.render) fail('incomplete', `component "${name}" has no .render(…)`);
      if (/^(text|stat|table|chart|tile|query|state|row|col)$/.test(name)) fail('badArgument', `"${name}" is a built-in component name`);
      DSL.components.set(name, spec);
      return { component: name };
    },
  });
  return B;
}
function customComponent(spec, owner) {
  return (props = {}) => {
    const keys = Object.keys(spec.props);
    for (const k of Object.keys(props)) if (!keys.includes(k)) fail('badProps', `${spec.name} has no prop "${k}".` + (WB.didYouMean(k, keys) ? ` Did you mean "${WB.didYouMean(k, keys)}"?` : ''), `props: ${keys.map(k => `${k} (${spec.props[k]})`).join(', ')}`);
    for (const k of keys) if (!String(spec.props[k]).endsWith('?') && props[k] === undefined) fail('badProps', `${spec.name} needs the prop "${k}" (${spec.props[k]})`);
    const prev = currentOwner; currentOwner = owner;
    const data = spec.data ? new Cell('query', `${spec.name}.data`, () => readOnly(() => spec.data(ctxFor(owner), Object.fromEntries(Object.entries(props).map(([k, v]) => [k, val(v)]))), `${spec.name}.data`)) : null;
    currentOwner = prev;
    return component(spec.name[0].toUpperCase() + spec.name.slice(1), (p, h) => spec.render(data ? data.value : null, h, Object.fromEntries(Object.entries(props).map(([k, v]) => [k, val(v)]))), {});
  };
}

// ---------- the ui object a script gets ----------
function makeUi(owner, { plan = false } = {}) {
  const C = makeComponents(owner);
  const U = {
    ...C,
    query(fn, label) { if (typeof fn !== 'function') fail('badArgument', 'query(fn): fn is (ctx) => value', 'ui.query(({ p }) => p.fns())'); return cellProxy(new Cell('query', label || 'query: ' + String(fn).replace(/\s+/g, ' ').slice(0, 60), () => readOnly(() => fn(ctxFor(owner)), 'a query'))); },
    from(script, args = {}, opts = {}) {
      // the script belongs to the UI script's own project (or, from the console, the open one)
      const proj = owner.project ? UI.wb.projects.get(owner.project) : UI.wb.projects.current;
      if (!proj) fail('noProject', 'ui.from() reads a script of the open project, and no project is open');
      const names = proj.scripts().map(s => s.name);
      if (!names.includes(script)) fail('unknownScript', `no script "${script}" in ${proj.id}.` + (WB.didYouMean(script, names) ? ` Did you mean "${WB.didYouMean(script, names)}"?` : ''), `scripts: ${names.join(', ')}`);
      return cellProxy(new Cell('from', `from(${script})`, () => {
        track(sources.program); track(sources.files);
        const a = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, val(v)]));
        const fresh = opts.fresh || ((proj.meta.scripts || {})[script] || {}).fresh;
        return fresh ? proj.run(script, a, { fresh: true }) : readOnly(() => proj.run(script, a), `ui.from('${script}')`);
      }));
    },
    state(initial, label) { const c = new Cell('state', label || 'state'); c._value = initial; return cellProxy(c); },
    derive(cells, fn) {
      if (!cells || typeof cells !== 'object' || Array.isArray(cells)) fail('badArgument', 'derive({ a, b }, ({ a, b }) => …) takes an object of cells');
      return cellProxy(new Cell('derive', 'derive(' + Object.keys(cells).join(', ') + ')', () => fn(Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, val(v)])))));
    },
    selection() {
      return cellProxy(new Cell('selection', 'selection', () => {
        track(sources.focus); track(sources.program);
        const id = UI.wb.focused, p = UI.wb.current;
        if (!id || !p) return { id: null, related: { lines: [], values: [], stmts: [], insns: [] } };
        try { return { id, related: p.related(id) }; } catch { return { id, related: { lines: [], values: [], stmts: [], insns: [] } }; }
      }));
    },
    param: WB.guard('UiParams', {
      int: (name, o = {}) => paramCell('int', name, { min: 0, max: 100, step: 1, default: o.min ?? 0, ...o }),
      float: (name, o = {}) => paramCell('float', name, { min: 0, max: 1, step: 0.01, default: o.min ?? 0, ...o }),
      bool: (name, o = {}) => paramCell('bool', name, { default: false, ...o }),
      choice: (name, options, o = {}) => paramCell('choice', name, { options, ...o }),
      set: (name, options, o = {}) => paramCell('set', name, { options, default: o.default || options.slice(), ...o }),
      value(name, v) { const c = DSL.params.get(name); if (!c) fail('unknownParam', `no parameter "${name}"`, `parameters: ${[...DSL.params.keys()].join(', ')}`); setParam(c, v); return { [name]: v }; },
    }),
    task(fn) { return makeTask(fn, owner); },
    idle() { return new Promise(r => setTimeout(r, 0)); },
    tile(id) { return makeTile(id, owner); },
    annotate(view) { return makeAnnotate(view, owner); },
    fragment: defineFragment, use: useFragment,
    drop(name) { DSL.used.delete(name); return { dropped: name }; },
    component: defineComponent,
    plan(script) { return planOf(script); },
    get live() { return DSL.liveApi; },
    toast(text) { UI.toast(String(text)); },
  };
  const proxy = new Proxy(U, {
    get(t, k) {
      if (typeof k === 'symbol' || k in t) return t[k];
      if (DSL.components.has(k)) return customComponent(DSL.components.get(k), owner);
      if (k === 'then' || k === 'toJSON') return undefined;
      const names = [...Object.keys(t), ...DSL.components.keys()];
      const near = WB.didYouMean(k, names);
      fail('unknownMember', `ui has no member "${String(k)}".` + (near ? ` Did you mean "${near}"?` : ''), `ui members: ${names.join(', ')}`);
    },
    set(t, k) { fail('immutable', `ui is read-only; ui.${String(k)} cannot be assigned`, 'ui.component(name)…register() adds a component'); },
  });
  owner.ui = proxy;
  return proxy;
}
DSL.makeUi = makeUi;

// ---------- running a project's UI scripts ----------
const UI_SCOPE = ['ui', 'wb', 'p', 'project', 'param'];
DSL.runScript = function runScript(projectId, name, { plan = false } = {}) {
  const wb = UI.wb, proj = wb.projects.get(projectId);
  const text = proj.files.read(`ui/${name}.js`);
  const key = plan ? `plan:${projectId}/${name}:${Date.now()}` : `${projectId}/${name}`;
  const owner = makeOwner(key, { project: projectId, script: name, plan });
  const ui = makeUi(owner);
  const prev = currentOwner; currentOwner = owner;
  let tiles;
  try {
    const fn = WB.compileBody(text, UI_SCOPE, `${projectId}/ui/${name}.js`);
    const out = fn(ui, wb, wb.current, proj, wb.param);
    if (out && typeof out.then === 'function') fail('notAComponent', `ui/${name}.js returned a Promise`, 'a UI script builds synchronously; put async work in ui.query(async …) or ui.task(…)');
    tiles = (Array.isArray(out) ? out : out ? [out] : []).filter(Boolean);
    for (const t of tiles) if (!t._tile) fail('notATile', `ui/${name}.js returned ${describeThing(t)}; a UI script returns tiles`, `return ui.tile('${name}').title('…').body(…)`);
    DSL.errors.delete(key);
  } catch (e) {
    currentOwner = prev;
    if (!plan) { DSL.errors.set(key, e.message); disposeOwner(owner); }
    throw e;
  } finally { currentOwner = prev; }
  if (plan) return { owner, tiles };
  for (const t of tiles) mountTile(t, owner);
  return { script: name, tiles: tiles.map(t => viewIdOf(owner, t._tile.id)) };
};
DSL.runProject = function runProject(projectId) {
  for (const o of [...DSL.owners.values()]) if (o.project && !o.plan) disposeOwner(o);
  DSL.annotations = DSL.annotations.filter(a => !a.owner.project);
  const proj = UI.wb.projects.get(projectId);
  const out = [];
  for (const u of proj.uiScripts()) {
    if (!u.on) continue;
    try { out.push(DSL.runScript(projectId, u.name)); }
    catch (e) { out.push({ script: u.name, error: e.message }); UI.toast(`ui/${u.name}.js: ${e.message.split('\n')[0]}`, true); }
  }
  return out;
};
DSL.stopScript = function stopScript(projectId, name) { const o = DSL.owners.get(`${projectId}/${name}`); if (o) disposeOwner(o); };

// ---------- plans: the tree and the cells, before or after mounting ----------
function planOf(script) {
  const proj = UI.wb.projects.current;
  if (!proj) fail('noProject', 'ui.plan() reads a UI script of the open project');
  const names = proj.uiScripts().map(u => u.name);
  if (!names.includes(script)) fail('unknownScript', `no UI script "${script}".` + (WB.didYouMean(script, names) ? ` Did you mean "${WB.didYouMean(script, names)}"?` : ''), `UI scripts: ${names.join(', ')}`);
  const { owner, tiles } = DSL.runScript(proj.id, script, { plan: true });
  const treeOf = (c, d = 0) => {
    if (!c) return [];
    if (isCell(c)) return ['  '.repeat(d) + `(${c.label})`];
    if (!isComponent(c)) return ['  '.repeat(d) + JSON.stringify(c)];
    const p = c._props, label = p.label !== undefined ? `(${peekVal(p.label)})` : p.title !== undefined && typeof p.title === 'string' ? `(${p.title})` : '';
    const lines = ['  '.repeat(d) + c._kind.toLowerCase() + label + (p.data && isCell(p.data) ? ` ← ${p.data.label}` : '') + (p.value && isCell(p.value) ? ` ← ${p.value.label}` : '')];
    for (const k of p.k || []) lines.push(...treeOf(k, d + 1));
    return lines;
  };
  const P = {
    explain({ run = true } = {}) {
      if (run) for (const c of owner.cells) if (c.computed) { try { c.get(); } catch { /* shown below */ } }
      const lines = [];
      for (const t of tiles) { lines.push(`tile ${t._tile.id} · ${peekVal(t._tile.title)}${t._tile.place ? ' · ' + JSON.stringify(t._tile.place) : ''}`); lines.push(...treeOf(t._tile.body, 1)); }
      lines.push('cells');
      for (const c of owner.cells) lines.push(`  ${c.label.padEnd(30)} ${c.kind}${c.deps.size ? ' ← ' + [...c.deps].map(d => d.label).join(', ') : ''}${c.error ? '  ERROR ' + c.error.message.split('\n')[0] : ''}`);
      for (const c of owner.cells) for (const d of c.deps) d.subs.delete(c);   // a plan watches nothing
      return lines.join('\n');
    },
    cells() { return owner.cells.map(c => ({ label: c.label, kind: c.kind, reads: [...c.deps].map(d => d.label), ...(c.error ? { error: c.error.message } : {}) })); },
    tiles() { return tiles.map(t => t._tile.id); },
    mount() { disposeOwner(owner); return DSL.runScript(proj.id, script); },
    _describe() { return { plan: script, tiles: P.tiles(), cells: owner.cells.length }; },
  };
  return WB.guard('Plan', P);
}

// ---------- live: the running UI, changed one call at a time (the agent, the console) ----------
const liveOwner = makeOwner('live', { script: 'live' });
DSL.liveUi = makeUi(liveOwner);
DSL.liveApi = WB.guard('Live', {
  tiles() {
    return [...UI.dock.tiles.values()].flatMap(t => t.tabs.map(v => ({ view: v, title: (UI.views[v] || {}).title || v, tile: t.id, active: t.active === v, ...(UI.views[v] && UI.views[v].custom ? { custom: true, by: UI.views[v].owner } : {}) })));
  },
  tile(id, opts = {}) {
    if (DSL.live.has(id)) { const e = DSL.live.get(id); if (opts.title) e.handle.set('title', opts.title); return e.handle; }
    const body = new Cell('state', `live:${id}`); body._value = [];
    const prev = currentOwner; currentOwner = liveOwner;
    const B = makeTile(id, liveOwner).title(opts.title || id).body(component('Live', (p, h) => h('div', { class: 'dslcol' }, body.value)));
    if (opts.place) B.place(opts.place);
    const vid = mountTile(B, liveOwner);
    currentOwner = prev;
    const handle = WB.guard('LiveTile', {
      append(c) { if (!isComponent(c)) fail('notAComponent', `append() takes a component; got ${describeThing(c)}`); body.set(body._value.concat([c])); return handle; },
      replace(c) { if (!isComponent(c)) fail('notAComponent', `replace() takes a component; got ${describeThing(c)}`); body.set([c]); return handle; },
      clear() { body.set([]); return handle; },
      set(prop, v) { if (prop !== 'title') fail('badArgument', `set() changes 'title'; not "${prop}"`); B._tile.title = v; UI.dock.refreshStrips(); return handle; },
      remove() { UI.dock.removeView(vid); delete UI.views[vid]; DSL.live.delete(id); return { removed: id }; },
      focus() { UI.open(vid); return handle; },
      describe() { return { id, view: vid, title: B._tile.title, components: body._value.map(c => c._kind) }; },
      _describe() { return handle.describe(); },
    });
    DSL.live.set(id, { vid, handle });
    UI.open(vid);
    return handle;
  },
  close(id) { const e = DSL.live.get(id); if (!e) fail('unknownTile', `no live tile "${id}"`, `live tiles: ${[...DSL.live.keys()].join(', ') || 'none'}`); return e.handle.remove(); },
});
// a tile returned to the console (or the agent) is mounted as a live tile
DSL.adopt = function adopt(x) {
  const list = (Array.isArray(x) ? x : [x]);
  if (!list.length || !list.every(t => t && t._tile)) return null;
  return list.map(B => {
    const id = B._tile.id;
    if (DSL.live.has(id)) DSL.live.get(id).handle.remove();
    const vid = mountTile(B, liveOwner);
    const handle = WB.guard('LiveTile', {
      remove() { UI.dock.removeView(vid); delete UI.views[vid]; DSL.live.delete(id); return { removed: id }; },
      focus() { UI.open(vid); return handle; },
      describe() { return { id, view: vid, title: String(peekVal(B._tile.title) ?? id), from: 'a returned tile' }; },
      _describe() { return handle.describe(); },
    });
    DSL.live.set(id, { vid, handle });
    UI.open(vid);
    return handle.describe();
  });
};
DSL.liveSnapshot = () => [...DSL.live.keys()];
DSL.liveRestore = keep => { for (const [id, e] of [...DSL.live]) if (!keep.includes(id)) e.handle.remove(); };
})(globalThis);
