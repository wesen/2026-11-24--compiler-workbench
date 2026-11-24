// main.js: the shell. Header bar, wiring to the dock (dock.js), linked selection,
// toasts, theme, hash routing, and the wiring from wb events to views. Views live in views.js,
// the agent in agent.js. Every change to a program goes through the wb API, as in the console.
(function (G) {
'use strict';
const UI = G.UI = G.UI || {};
const $ = (sel, root = document) => root.querySelector(sel);
const esc = UI.esc;

const store = UI.store;

// ---------- the workbench ----------
const wb = G.WB.createWorkbench({
  storage: store, projects: G.WB_PROJECTS || [], references: G.WB_REFERENCES || {},
  book: G.WB_BOOK || [], sources: G.WB_SOURCES || {},
  reference: topic => UI.referenceText(topic),
});
UI.wb = wb;
G.wb = wb; // for the browser's own console

const S = UI.S = {
  fn: null, pipeline: null, pipeIndex: 0, enabled: {}, heat: null, lastCheck: null,
  backend: Object.fromEntries(Object.entries(G.WB.backendDefaults).filter(([k]) => k !== 'layout')),
  chapter: store.get('wb.chapter') || 'welcome',
};


// ---------- the dock (dock.js) ----------
UI.views = UI.views || {};
const D = UI.dock;
// A view may cause an event while it renders (compiling an image, say). Such events are
// queued and handled once the current refresh is done, never inside it.
let refreshing = false; const queued = new Set();
UI.refresh = function refresh(which) {
  if (refreshing) { (which || ['*']).forEach(w => queued.add(w)); return; }
  refreshing = true;
  try { D.refresh(which); renderBar(); } finally { refreshing = false; }
  if (queued.size) { const next = queued.has('*') ? undefined : [...queued]; queued.clear(); setTimeout(() => UI.refresh(next), 0); }
};
UI.open = function open(viewId) { S.lastOpened = viewId; const ok = D.open(viewId); setHash(); return ok; };
document.addEventListener('click', e => {
  const link = e.target.closest('[data-link]');
  if (link) { e.preventDefault(); UI.follow(link.dataset.link); return; }
  const nid = e.target.closest('.nid[data-id]');
  if (nid) { UI.focus(nid.dataset.id); return; }
  const run = e.target.closest('[data-run]');
  if (run) { UI.consoleRun(run.dataset.run); UI.open('console'); return; }
});

// ---------- links and selection ----------
UI.follow = UI.guarded(function follow(href) {
  const [kind, ...rest] = href.split(':'), arg = rest.join(':');
  if (kind === 'lab' || kind === 'project') {
    const id = UI.resolveProject(arg);
    if (id) { UI.loadProject(id); return; }
    const words = arg.replace(/[-_]+/g, ' ').toLowerCase();
    const some = wb.projects.list().some(x => (x.title + ' ' + x.about + ' ' + x.id).toLowerCase().includes(words));
    S.projFilter = some ? words : ''; UI.open('projects'); UI.refresh(['projects']);
    UI.toast(`No project "${arg}". ${some ? 'The Projects view shows the nearest matches.' : 'Pick one in the Projects view.'}`, true);
    return;
  }
  if (kind === 'view') { UI.open(arg); return; }
  if (kind === 'chapter') { const [raw, sec] = arg.split('#'); const book = G.WB_BOOK || []; const id = (book.find(c => c.id === raw) || book.find(c => c.title.toLowerCase() === raw.toLowerCase()) || {}).id || G.WB.didYouMean(raw, book.map(c => c.id)); if (!id) { UI.toast(`No chapter "${raw}"`, true); return; } S.chapter = id; store.set('wb.chapter', id); S.section = sec || null; UI.open('book'); UI.refresh(['book']); setHash(); return; }
  if (kind === 'src') { const [path, line] = arg.split('#L'); S.file = { path, line: +line || 1 }; UI.open('code'); UI.refresh(['code']); return; }
  if (kind === 'file') { UI.openFile(arg); return; }
  if (kind === 'focus') { UI.focus(arg); return; }
});
// A project named loosely (as an agent or a person might write it): the exact id, then the id
// with words joined by dashes, then the title, then the nearest id or title.
UI.resolveProject = function resolveProject(name) {
  const list = wb.projects.list(), q = String(name || '').trim();
  const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const sl = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const hit = list.find(x => x.id === q) || list.find(x => x.id === slug) || list.find(x => sl(x.title) === slug) || list.find(x => sl(x.title).startsWith(slug + '-') && slug.length > 3) ||
    list.find(x => x.title.toLowerCase().startsWith(q.toLowerCase()) && q.length > 3);
  if (hit) return hit.id;
  return G.WB.didYouMean(slug, list.map(x => x.id)) || null;
};
UI.focus = UI.guarded(function focus(id) {
  const p = wb.current;
  if (!p) return;
  if (id && !p.has(id)) { UI.toast(`${id} is not in ${p.id} at ${p.rev}`, true); return; }
  wb.focus(id);
});

// ---------- the header bar ----------
function renderBar() {
  const p = wb.current, pr = wb.projects.current;
  $('#presetBtn .ptitle').textContent = pr ? pr.title : 'Pick a project';
  $('#presetBtn .pcode').textContent = pr ? pr.group : '';
  const rev = $('#revPill');
  if (!p) { rev.innerHTML = '<b>—</b><span>no program</span>'; rev.className = 'pill'; }
  else if (p.status !== 'ok') { rev.innerHTML = `<b>error</b><span>line ${p.error && p.error.line || '?'}</span>`; rev.className = 'pill bad'; }
  else { rev.innerHTML = `<b>${p.rev}</b><span>${p.revisions().length - 1} passes applied</span>`; rev.className = 'pill'; }
  const ck = $('#checkPill'), c = S.lastCheck;
  if (!c) { ck.innerHTML = '<b>—</b><span>not checked</span>'; ck.className = 'pill'; }
  else { const a = c.fns.reduce((n, f) => n + f.agree, 0), t = c.fns.reduce((n, f) => n + f.total, 0); ck.innerHTML = `<b>${a}/${t}</b><span>${c.status} · ${c.rev}</span>`; ck.className = 'pill' + (c.status === 'agree' ? '' : ' bad'); }
}
function presetMenu() {
  const menu = $('#presetMenu');
  if (!menu.hidden) { menu.hidden = true; return; }
  const groups = new Map();
  for (const x of wb.projects.list()) { if (!groups.has(x.group)) groups.set(x.group, []); groups.get(x.group).push(x); }
  const cur = wb.projects.current && wb.projects.current.id;
  menu.innerHTML = [...groups].map(([g, list]) => `<div class="grp">${esc(g)}</div>` + list.map(x => `<button data-preset="${esc(x.id)}" class="${x.id === cur ? 'on' : ''}"><span class="t">${esc(x.title)}</span><small>${esc(x.about)}</small></button>`).join('')).join('');
  menu.hidden = false;
}
function setHash() {
  const bookOn = D.where('book') && D.where('book').active === 'book' && S.lastOpened === 'book';
  const h = bookOn ? 'book-' + S.chapter : wb.projects.current ? 'project-' + wb.projects.current.id : '';
  try { if (('#' + h) !== location.hash) history.replaceState(null, '', h ? '#' + h : location.pathname); } catch { /* sandboxed */ }
}

// ---------- projects ----------
UI.loadProject = UI.guarded(function loadProject(id, opts = {}) {
  const n = opened;
  const pr = wb.projects.open(id);      // emits 'program' (why: 'project'), which sets the views up for a new project
  if (opened === n) projectOpened(id);  // the same project again: set them up anyway
  // on a phone every view is a tab: show the project's first tile, or its source
  if (UI.dock.narrow && !opts.quiet) { const own = UI.dock.custom.find(v => UI.views[v] && UI.views[v].owner && UI.views[v].owner.startsWith(id + '/')); UI.open(own || 'source'); }
  const tiles = [...UI.dsl.owners.values()].filter(o => o.project === id).reduce((n, o) => n + o.views.length, 0);
  if (!opts.quiet) UI.toast(`Opened ${pr.title}${tiles ? ` · ${tiles} tile${tiles === 1 ? '' : 's'} of its own` : ''}`);
  return pr;
});
// a project was opened, from the header, a link, the console or the agent: reset the views and run its UI scripts
let opened = 0;
function projectOpened(id) {
  UI.loadedProject = id; opened++;
  const pr = wb.projects.get(id), p = wb.current, meta = pr.meta;
  S.fn = p.status === 'ok' ? (meta.focus && p.fns().find(f => p.fn(f).lines().includes(meta.focus))) || p.fns()[0] : null;
  S.pipeline = Array.isArray(meta.pipeline) ? meta.pipeline.slice() : (G.WB.PIPELINES[meta.pipeline || 'O2'] || []).slice();
  S.pipeName = Array.isArray(meta.pipeline) ? 'custom' : (meta.pipeline || 'O2');
  S.pipeIndex = 0; S.enabled = {}; S.heat = null; S.lastCheck = null; S.runLog = []; S.typedFile = null; S.file2 = null;
  store.set('wb2.project', id);
  UI.dsl.runProject(id);
  setHash();
  UI.refresh();
}

// ---------- wiring wb events to views ----------
let uiTimers = {};
wb.on('*', (event, data) => {
  if (event === 'view') { if (data.view === 'book' && data.chapter) { S.chapter = data.chapter; S.section = data.section || null; } UI.open(data.view); return; }
  if (event === 'log' || event === 'paramValue') return;
  // checks, runs and images of fresh copies (scripts and UI scripts make them) are not the open program's
  if (data && data.program && wb.current && data.program !== wb.current.name && ['check', 'run', 'image', 'revision'].includes(event)) return;
  if (event === 'check') S.lastCheck = data.check;
  if (event === 'program' && data.why === 'project' && data.project !== UI.loadedProject) projectOpened(data.project);
  if (event === 'program' && data.why !== 'project') { const p = wb.current; S.fn = p && p.status === 'ok' && p.fns().includes(S.fn) ? S.fn : p && p.status === 'ok' ? p.fns()[0] : null; }
  if (event === 'revision') { S.heat = null; }
  // the UI DSL's sources: queries that read the program, the selection or the files rerun
  if (event === 'program' || event === 'revision') UI.dsl.bump('program');
  if (event === 'focus') UI.dsl.bump('focus');
  if (event === 'files' || event === 'projects') UI.dsl.bump('files');
  if (event === 'files' && data.kind === 'ui' && wb.projects.current && data.project === wb.projects.current.id) {   // a UI script changed: rebuild its tiles
    const name = data.path.replace(/^ui\//, '').replace(/\.js$/, '');
    clearTimeout(uiTimers[name]);
    uiTimers[name] = setTimeout(() => {
      const u = wb.projects.current.uiScripts().find(x => x.name === name);
      if (data.removed || !u || !u.on) UI.dsl.stopScript(data.project, name);
      else { try { UI.dsl.runScript(data.project, name); } catch (e) { UI.toast(`ui/${name}.js: ${e.message.split('\n')[0]}`, true); } }
      UI.refresh(['ui']);
    }, 300);
  }
  if (event === 'ui' && wb.projects.current && data.project === wb.projects.current.id) {
    if (data.on) { try { UI.dsl.runScript(data.project, data.name); } catch (e) { UI.toast(`ui/${data.name}.js: ${e.message.split('\n')[0]}`, true); } }
    else UI.dsl.stopScript(data.project, data.name);
  }
  if (event === 'files' && data.reset) UI.dsl.runProject(data.project);
  if (UI.batching) { UI.pending.add(event); return; }
  UI.refresh([event]);
});
UI.pending = new Set();
UI.batch = async function batch(fn) {
  UI.batching = true;
  try { return await fn(); } finally { UI.batching = false; const evs = [...UI.pending]; UI.pending.clear(); if (evs.length) UI.refresh(evs); }
};

// ---------- boot ----------
function boot() {
  const theme = store.get('wb.theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  $('#themeTog').classList.toggle('on', theme === 'dark');
  $('#themeTog').addEventListener('click', () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; store.set('wb.theme', t); $('#themeTog').classList.toggle('on', t === 'dark'); UI.refresh(['theme']); });
  $('#presetBtn').addEventListener('click', e => { e.stopPropagation(); presetMenu(); });
  $('#presetMenu').addEventListener('click', e => { const b = e.target.closest('[data-preset]'); if (b) { $('#presetMenu').hidden = true; UI.loadProject(b.dataset.preset); } });
  document.addEventListener('click', e => { if (!e.target.closest('.proj')) $('#presetMenu').hidden = true; });
  $('#layoutBtn').addEventListener('click', e => { e.stopPropagation(); D.layoutMenu($('#layoutBtn')); });
  $('#bookBtn').addEventListener('click', () => UI.open('book'));
  $('#stepBtn').addEventListener('click', () => UI.step());
  $('#runBtn').addEventListener('click', () => UI.runPipeline());
  $('#undoBtn').addEventListener('click', UI.guarded(() => { const p = wb.current; if (p) p.undo(); if (S.pipeIndex > 0) S.pipeIndex--; }));
  $('#checkBtn').addEventListener('click', UI.guarded(() => { const p = wb.current; if (p) { p.check({ count: 100 }); UI.open('checks'); } }));
  let w = window.innerWidth;
  window.addEventListener('resize', () => { const n = window.innerWidth < 760; if (n !== D.narrow) { w = window.innerWidth; D.build(); } });
  window.addEventListener('hashchange', route);
  D.build();
  route(true);
  if (!wb.current) UI.loadProject(store.get('wb2.project') && wb.projects.list().some(x => x.id === store.get('wb2.project')) ? store.get('wb2.project') : 'start-here', { quiet: true });
}
function route(first) {
  const h = (location.hash || '').slice(1);
  if (h.startsWith('book-')) { S.chapter = h.slice(5); if (first === true && !wb.current) UI.loadProject(store.get('wb2.project') || 'start-here', { quiet: true }); UI.open('book'); UI.refresh(['book']); return; }
  const id = h.startsWith('project-') ? h.slice(8) : h.startsWith('preset-') ? h.slice(7) : null;
  if (id && wb.projects.list().some(x => x.id === id)) { if (!wb.projects.current || wb.projects.current.id !== id) UI.loadProject(id, { quiet: true }); }
}
UI.step = UI.guarded(function step() {
  const p = wb.current; if (!p) return;
  while (S.pipeIndex < S.pipeline.length && S.enabled[S.pipeIndex] === false) S.pipeIndex++;
  if (S.pipeIndex >= S.pipeline.length) { UI.toast('The pipeline is done. Reset to start again.'); return; }
  const name = S.pipeline[S.pipeIndex];
  const r = p.apply(name);
  const c = r.changed ? p.check({ count: 40 }) : null;
  S.runLog.push({ i: S.pipeIndex, pass: name, rev: r.rev, edits: r.edits, check: c ? c.fns.map(f => `${f.fn} ${f.agree}/${f.total}`).join(', ') : '', bad: c && c.status !== 'agree' });
  S.pipeIndex++;
  if (UI.batching) { UI.pending.add('revision'); UI.pending.add('pipeline'); } else UI.refresh(['revision', 'pipeline']);
});
UI.runPipeline = UI.guarded(function runPipeline() {
  const p = wb.current; if (!p) return;
  UI.batch(() => { while (S.pipeIndex < S.pipeline.length) UI.step(); });
});
document.addEventListener('DOMContentLoaded', boot);
})(globalThis);
