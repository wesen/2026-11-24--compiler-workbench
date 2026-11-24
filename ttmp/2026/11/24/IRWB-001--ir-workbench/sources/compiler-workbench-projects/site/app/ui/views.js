// views.js: every view of the workbench. A view is { title, on: [events], render(el, ctx) }.
// Views read through the wb API and its handles, and change programs only through it.
(function (G) {
'use strict';
const UI = G.UI = G.UI || {};
const V = UI.views = UI.views || {};
const esc = UI.esc;
const S = () => UI.S;
const wbx = () => UI.wb;
const nid = (id, label) => `<button class="nid${UI.isSel(id) ? ' on' : UI.isRel(id) ? ' hi' : ''}" data-id="${esc(id)}">${esc(label || id)}</button>`;
const empty = (el, text) => { el.innerHTML = `<div class="tabbody col"><div class="scroll"><div class="doc"><p class="empty">${text}</p></div></div></div>`; };
const yaml = x => UI.esc(G.WB.toYaml(x));

// ---------- selection: the focused id and everything related to it ----------
let relCache = { key: '', rel: null };
UI.selection = function selection() {
  const wb = wbx(), id = wb.focused, p = wb.current;
  if (!id || !p) return { id: null, rel: { lines: [], values: [], stmts: [], insns: [] } };
  const key = `${p.id}:${p.rev}:${id}:${(p.images()[0] || {}).id || ''}`;
  if (relCache.key !== key) { let rel; try { rel = p.related(id); } catch { rel = { lines: [], values: [], stmts: [], insns: [] }; } relCache = { key, rel }; }
  return { id, rel: relCache.rel };
};
UI.isSel = id => wbx().focused === id;
UI.isRel = id => { const { rel } = UI.selection(); return rel.stmts.includes(id) || rel.values.includes(id) || rel.insns.includes(id); };
const needProgram = (el, p) => {
  if (!p) { empty(el, 'Open a project from the header or the Projects view.'); return false; }
  if (p.status !== 'ok') { el.innerHTML = `<div class="tabbody col"><div class="scroll"><div class="fail padded"><b>The front end rejected the source.</b> ${p.error && p.error.line ? `Line ${p.error.line}, column ${p.error.col}: ` : ''}${esc(p.error && p.error.message)}</div></div></div>`; return false; }
  return true;
};
const fnPicker = (p) => {
  const fns = p.fns();
  if (fns.length < 2) return `<span class="lbl">function</span> <b>${esc(fns[0])}</b>`;
  return `<span class="lbl">function</span><div class="seg sm" data-fnseg>${fns.map(f => `<button class="${f === S().fn ? 'on' : ''}" data-fn="${esc(f)}">${esc(f)}</button>`).join('')}</div>`;
};
document.addEventListener('click', e => { const b = e.target.closest('[data-fnseg] [data-fn]'); if (b) { S().fn = b.dataset.fn; UI.refresh(['fn']); } });
const curFn = p => { const s = S(); if (!s.fn || !p.fns().includes(s.fn)) s.fn = p.fns()[0]; return s.fn; };

// ---------- Projects ----------
V.projects = {
  title: 'Projects', on: ['projects', 'program'],
  render(el, { wb }) {
    const cur = wb.projects.current, q = (S().projFilter || '').toLowerCase();
    const all = wb.projects.list(), withUi = all.filter(x => x.ui).length;
    const list = all.filter(x => (!q || (x.title + ' ' + x.about + ' ' + x.id + ' ' + x.group).toLowerCase().includes(q)) && (!S().projUi || x.ui));
    const groups = new Map();
    for (const x of list) { if (!groups.has(x.group)) groups.set(x.group, []); groups.get(x.group).push(x); }
    el.innerHTML = `<div class="tabbody col"><div class="toolbar"><input class="filter" placeholder="Filter ${wb.projects.list().length} projects" value="${esc(S().projFilter || '')}" data-pfilter><button class="tog${S().projUi ? ' on' : ''}" data-projui title="Only projects whose UI scripts add tiles">With tiles · ${withUi}</button><span class="sp"></span><button class="btn sm" data-newproj>New</button><button class="btn sm" data-dupproj title="Copy the open project into a new one of your own">Duplicate</button></div>
      ${S().newProj ? `<div class="block saveform"><header><h2>${S().newProj === 'dup' ? 'Duplicate the open project' : 'New project'}</h2><span class="sub">kept in this browser</span></header><label>id <input class="filter" name="pid" placeholder="my-loops" value="${esc(S().newProj === 'dup' && cur ? cur.id + '-mine' : '')}"></label><label>title <input class="filter" name="ptitle" placeholder="My loops"></label><div class="row"><button class="btn primary sm" data-makeproj>Create</button><button class="btn sm" data-cancelproj>Cancel</button></div></div>` : ''}
      <div class="scroll presetlist">${[...groups].map(([g, xs]) => `<div class="grp">${esc(g)} <span class="dim">${xs.length}</span></div>` + xs.map(x => `<button class="pitem${cur && cur.id === x.id ? ' on' : ''}" data-project="${esc(x.id)}"><b>${esc(x.title)}${x.ui ? ` <span class="dslbadge good">${x.ui} UI script${x.ui === 1 ? '' : 's'}</span>` : ''}</b><small>${esc(x.about)}</small>${x.mine ? '<em>yours</em>' : x.edited ? '<em>edited here</em>' : ''}</button>`).join('')).join('') || '<p class="empty padded">Nothing matches.</p>'}</div></div>`;
    const f = el.querySelector('[data-pfilter]');
    f.oninput = () => { S().projFilter = f.value; const pos = f.selectionStart; V.projects.render(el, { wb }); const g = el.querySelector('[data-pfilter]'); g.focus(); g.setSelectionRange(pos, pos); };
    el.onclick = UI.guarded(e => {
      const b = e.target.closest('[data-project]'); if (b) { UI.loadProject(b.dataset.project); return; }
      if (e.target.closest('[data-projui]')) { S().projUi = !S().projUi; V.projects.render(el, { wb }); return; }
      if (e.target.closest('[data-newproj]')) { S().newProj = S().newProj === 'new' ? null : 'new'; V.projects.render(el, { wb }); return; }
      if (e.target.closest('[data-dupproj]')) { S().newProj = S().newProj === 'dup' ? null : 'dup'; V.projects.render(el, { wb }); return; }
      if (e.target.closest('[data-cancelproj]')) { S().newProj = null; V.projects.render(el, { wb }); return; }
      if (e.target.closest('[data-makeproj]')) {
        const id = el.querySelector('[name=pid]').value.trim(), title = el.querySelector('[name=ptitle]').value.trim();
        const r = S().newProj === 'dup' && cur ? wb.projects.duplicate(cur.id, id, { title: title || undefined }) : wb.projects.create(id, { title: title || id });
        S().newProj = null; UI.toast(`Created ${r.created}`); UI.loadProject(id);
      }
    });
  },
};

// ---------- Files: the open project's files ----------
const KIND_LABEL = { meta: 'project', notes: 'notes', typed: 'source', script: 'script', ui: 'UI script', json: 'data', file: 'file' };
V.files = {
  title: 'Files', on: ['files', 'program', 'projects', 'ui'],
  count: () => { const pr = wbx().projects.current; return pr ? pr.files.list().length : ''; },
  render(el, { wb }) {
    const pr = wb.projects.current;
    if (!pr) return empty(el, 'Open a project from the Projects view.');
    const files = pr.files.list(), open = S().file2;
    const ui = new Map(pr.uiScripts().map(u => [u.path, u]));
    const errs = UI.dsl ? UI.dsl.errors : new Map();
    el.innerHTML = `<div class="tabbody col"><div class="toolbar"><b>${esc(pr.title)}</b><span class="sp"></span><button class="btn sm" data-newfile>New file</button></div>
      ${S().newFile ? `<div class="block saveform"><label>path <input class="filter" name="fpath" placeholder="scripts/report.js, ui/dashboard.js, more.typed" value="${esc(S().newFile)}"></label><div class="row">${['more.typed', 'scripts/query.js', 'ui/tile.js', 'notes.md'].map(x => `<button class="btn sm" data-fpre="${x}">${x}</button>`).join('')}</div><div class="row"><button class="btn primary sm" data-makefile>Create</button><button class="btn sm" data-cancelfile>Cancel</button></div></div>` : ''}
      <div class="scroll">${files.map(f => { const u = ui.get(f.path), err = u && errs.get(`${pr.id}/${u.name}`); return `<div class="fileitem${open === f.path ? ' on' : ''}"><button class="pitem" data-openfile="${esc(f.path)}"><b class="mono">${esc(f.path)}</b><small>${KIND_LABEL[f.kind]} · ${f.lines} lines${f.edited ? ' · edited here' : ''}${err ? ` · <span class="bad">error</span>` : ''}</small></button>${f.kind === 'script' ? `<button class="btn sm" data-runscript="${esc(f.path)}" title="Run it on the program as it is">Run</button>` : ''}${u ? `<button class="tog${u.on ? ' on' : ''}" data-uitoggle="${esc(u.name)}" title="Turn this UI script's tiles on or off">${u.on ? 'on' : 'off'}</button>` : ''}</div>`; }).join('')}
      ${pr.builtin ? `<p class="note padded">A built-in project. Edits are kept in this browser; <button class="link" data-resetproj>reset</button> brings the original back.</p>` : `<p class="note padded">Your project, kept in this browser. <button class="link" data-exportproj>Export</button> · <button class="link bad" data-delproj>Delete</button></p>`}</div></div>`;
    el.onclick = UI.guarded(e => {
      const q = sel => e.target.closest(sel);
      if (q('[data-openfile]')) { UI.openFile(q('[data-openfile]').dataset.openfile); return; }
      if (q('[data-runscript]')) { UI.runProjectScript(q('[data-runscript]').dataset.runscript.replace(/^scripts\//, '').replace(/\.js$/, '')); return; }
      if (q('[data-uitoggle]')) { const n = q('[data-uitoggle]').dataset.uitoggle, u = pr.uiScripts().find(x => x.name === n); pr.setUi(n, !u.on); return; }
      if (q('[data-newfile]')) { S().newFile = S().newFile !== undefined && S().newFile !== null ? null : ''; V.files.render(el, { wb }); return; }
      if (q('[data-fpre]')) { el.querySelector('[name=fpath]').value = q('[data-fpre]').dataset.fpre; return; }
      if (q('[data-cancelfile]')) { S().newFile = null; V.files.render(el, { wb }); return; }
      if (q('[data-makefile]')) {
        const path = el.querySelector('[name=fpath]').value.trim(), kind = G.WB.fileKind(path);
        const name = path.replace(/^ui\//, '').replace(/\.js$/, '');
        const starter = {
          typed: 'function g(x: i32): i32 {\n    return x + 1;\n}\n',
          script: [
            '// A workbench script: wb, p, project, args, param and log are in',
            '// scope. Return a value to see it.',
            'return p.fns().map(f => ({',
            '  fn: f,',
            '  statements: p.fn(f).stmts().count(),',
            '}));',
            '',
          ].join('\n'),
          ui: [
            '// A UI script: return the tiles it makes.',
            'const rows = ui.query(({ p }) =>',
            '  p.fns().map(f => ({',
            '    fn: f,',
            '    statements: p.fn(f).stmts().count(),',
            '    values: p.fn(f).values().count(),',
            '  })),',
            ');',
            '',
            `return ui.tile('${name}')`,
            "  .title('Functions')",
            "  .place({ splitRight: 'ir' })",
            '  .body(',
            '    ui.table(rows).onRow((r, { wb }) => wb.focus(`fn:${r.fn}`)),',
            '  );',
            '',
          ].join('\n'),
          notes: '', meta: '{}\n', json: '{}\n', file: '',
        }[kind];
        pr.files.write(path, starter); S().newFile = null; UI.openFile(path); return;
      }
      if (q('[data-resetproj]')) { pr.reset(); UI.loadProject(pr.id, { quiet: true }); UI.toast('Back to the original files'); return; }
      if (q('[data-exportproj]')) { UI.exportProject(pr); return; }
      if (q('[data-delproj]')) { const id = pr.id; wb.projects.remove(id); UI.toast(`Deleted ${id}`); UI.loadProject('start-here'); return; }
    });
  },
};

// ---------- Editor: any file of the project ----------
V.editor = {
  title: 'Editor', on: ['files', 'projects'],
  count: () => S().file2 ? S().file2.replace(/^.*\//, '') : '',
  render(el, { wb }) {
    const pr = wb.projects.current, path = S().file2;
    if (!pr) return empty(el, 'Open a project.');
    if (!path || !pr.files.list().some(f => f.path === path)) return empty(el, 'Pick a file in the Files view. Typed sources open in Source; scripts, UI scripts, project.json and notes open here.');
    const text = pr.files.read(path), kind = G.WB.fileKind(path);
    const errKey = kind === 'ui' ? `${pr.id}/${path.replace(/^ui\//, '').replace(/\.js$/, '')}` : null;
    const err = errKey && UI.dsl.errors.get(errKey);
    const lang = /\.(js|json|typed)$/.test(path) ? 'js' : 'text';
    el.innerHTML = `<div class="tabbody col"><div class="toolbar"><span class="lbl mono">${esc(path)}</span><span class="dim">${esc(KIND_LABEL[kind])}</span><span class="sp"></span>${kind === 'script' ? '<button class="btn sm primary" data-edrun>Run</button><button class="btn sm" data-edrun0 title="Check out r0 first">Run on r0</button>' : ''}${kind === 'ui' ? '<button class="btn sm primary" data-edui>Rerun</button><button class="btn sm" data-edplan>Explain</button>' : ''}</div>
      <div class="ed"><div class="egutter"><div class="gutter-in">${text.split('\n').map((_, i) => `<div>${i + 1}</div>`).join('')}</div></div><div class="code"><pre>${text.split('\n').map(l => `<div>${UI.highlight(l, lang) || ' '}</div>`).join('')}</pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off">${esc(text)}</textarea></div></div>
      <div class="ed-foot">${err ? `<span class="bad">error</span> <span>${esc(err.split('\n')[0])}</span>` : kind === 'ui' ? '<b>UI script</b> <span>saved as you type; its tiles rebuild half a second later</span>' : kind === 'script' ? '<b>workbench script</b> <span>wb, p, project, args, param, log are in scope; return a value</span>' : '<span>saved as you type</span>'}</div></div>`;
    const ta = el.querySelector('textarea'), pre = el.querySelector('.code pre'), gut = el.querySelector('.gutter-in');
    ta.addEventListener('scroll', () => { pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`; gut.style.transform = `translateY(${-ta.scrollTop}px)`; });
    let timer = null;
    ta.addEventListener('input', () => {
      pre.innerHTML = ta.value.split('\n').map(l => `<div>${UI.highlight(l, lang) || ' '}</div>`).join('');
      gut.innerHTML = ta.value.split('\n').map((_, i) => `<div>${i + 1}</div>`).join('');
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { S().editing = true; pr.files.write(path, ta.value); el.querySelector('.ed-foot').innerHTML = '<b>saved</b>'; }
        catch (e) { el.querySelector('.ed-foot').innerHTML = `<span class="bad">not saved</span> <span>${esc(e.message.split('\n')[0])}</span>`; }
        finally { S().editing = false; }
      }, 500);
    });
    ta.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); const st = ta.selectionStart; ta.setRangeText('  ', st, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } });
    el.querySelector('.toolbar').onclick = UI.guarded(e => {
      const name = path.replace(/^(scripts|ui)\//, '').replace(/\.js$/, '');
      if (e.target.closest('[data-edrun]')) UI.runProjectScript(name);
      if (e.target.closest('[data-edrun0]')) { wb.current.checkout('r0'); UI.runProjectScript(name); }
      if (e.target.closest('[data-edui]')) { UI.dsl.runScript(pr.id, name); UI.toast(`Rebuilt the tiles of ui/${name}.js`); }
      if (e.target.closest('[data-edplan]')) { UI.consoleRun(`return ui.plan('${name}').explain();`); UI.open('console'); }
    });
  },
};
UI.openFile = function openFile(path) {
  const kind = G.WB.fileKind(path);
  S().file2 = path;
  if (kind === 'typed') { S().typedFile = path; UI.open('source'); UI.refresh(['program']); }
  else { UI.open('editor'); UI.refresh(['files']); }
};

// ---------- Scripts: run workbench scripts, see what UI scripts made ----------
V.scripts = {
  title: 'Scripts', on: ['files', 'projects', 'ui', 'scriptRun'],
  render(el, { wb }) {
    const pr = wb.projects.current;
    if (!pr) return empty(el, 'Open a project.');
    const runs = (S().scriptRuns || []).filter(r => r.project === pr.id).slice(-8).reverse();
    const errs = UI.dsl.errors;
    el.innerHTML = `<div class="tabbody col"><div class="scroll">
      <div class="block"><header><h2>Workbench scripts</h2><span class="sub">scripts/*.js · queries, passes, checks; they return data</span></header>
      ${pr.scripts().map(s2 => `<div class="scriptrow"><div><b class="mono">${esc(s2.name)}</b><small>${esc(s2.about || '')}</small></div><button class="btn sm primary" data-srun="${esc(s2.name)}">Run</button><button class="btn sm" data-srun0="${esc(s2.name)}" title="Check out r0 first">On r0</button><button class="btn sm" data-sopen="${esc(s2.path)}">Edit</button></div>`).join('') || '<p class="empty">None yet. New file → scripts/name.js.</p>'}</div>
      <div class="block"><header><h2>UI scripts</h2><span class="sub">ui/*.js · they make tiles, and update them as things change</span></header>
      ${pr.uiScripts().map(u => { const err = errs.get(`${pr.id}/${u.name}`), o = UI.dsl.owners.get(`${pr.id}/${u.name}`); return `<div class="scriptrow"><div><b class="mono">${esc(u.name)}</b><small>${esc(u.about || '')}${o ? ` · ${o.views.length} tile${o.views.length === 1 ? '' : 's'}, ${o.cells.length} cells` : ''}${err ? ` · <span class="bad">${esc(err.split('\n')[0])}</span>` : ''}</small></div><button class="tog${u.on ? ' on' : ''}" data-uitoggle="${esc(u.name)}">${u.on ? 'on' : 'off'}</button><button class="btn sm" data-uirun="${esc(u.name)}">Rerun</button><button class="btn sm" data-sopen="${esc(u.path)}">Edit</button></div>`; }).join('') || '<p class="empty">None yet. New file → ui/name.js.</p>'}</div>
      ${runs.length ? `<div class="block"><header><h2>Last runs</h2></header>${runs.map(r => `<div class="centry"><b class="mono">${esc(r.name)}</b> <span class="dim">${r.ms} ms${r.rev ? ' · ' + esc(r.rev) : ''}</span>${r.logs.map(l => `<pre class="res">${esc(l)}</pre>`).join('')}${r.error ? `<pre class="res bad">${esc(r.error)}</pre>` : `<pre class="res">${esc(G.WB.toYaml(r.result).slice(0, 6000))}</pre>`}</div>`).join('')}</div>` : ''}
      </div></div>`;
    el.onclick = UI.guarded(e => {
      const q = sel => e.target.closest(sel);
      if (q('[data-srun]')) UI.runProjectScript(q('[data-srun]').dataset.srun);
      if (q('[data-srun0]')) { wb.current.checkout('r0'); UI.runProjectScript(q('[data-srun0]').dataset.srun0); }
      if (q('[data-sopen]')) UI.openFile(q('[data-sopen]').dataset.sopen);
      if (q('[data-uitoggle]')) { const n = q('[data-uitoggle]').dataset.uitoggle, u = pr.uiScripts().find(x => x.name === n); pr.setUi(n, !u.on); }
      if (q('[data-uirun]')) { UI.dsl.runScript(pr.id, q('[data-uirun]').dataset.uirun); UI.refresh(['ui']); }
    });
  },
};
UI.runProjectScript = async function runProjectScript(name, args = {}) {
  const wb = wbx(), pr = wb.projects.current, t0 = performance.now(), logs = [];
  let result, error = null;
  try { result = await UI.batch(() => pr.run(name, args, { logs })); } catch (e) { error = e.message; }
  (S().scriptRuns = S().scriptRuns || []).push({ project: pr.id, name, result, error, logs, ms: Math.round(performance.now() - t0), rev: wb.current && wb.current.rev });
  UI.open('scripts'); UI.refresh(['scriptRun']);
  if (error) UI.toast(`${name}: ${error.split('\n')[0]}`, true);
  return { result, error };
};
UI.exportProject = async function exportProject(pr) {
  const text = pr.export(), name = `${pr.id}.project.json`;
  const dl = UI.agent && UI.agent.downloads;
  if (dl) { try { await dl.save({ filename: name, data: text }); UI.toast(`Saved ${name}`); return; } catch (e) { if (e && e.code === 'declined') return; } }
  try { await navigator.clipboard.writeText(text); UI.toast('Copied the project as JSON. wb.projects.import(text) brings it back.'); } catch { UI.toast('Neither saving nor the clipboard is available here.', true); }
};

// ---------- Source: the project's typed files ----------
V.source = {
  title: 'Source', on: ['program', 'focus', 'image', 'run', 'files'],
  count: () => { const p = wbx().current; return p && p.files().length > 1 ? p.files().length + ' files' : ''; },
  render(el, { wb, p }) {
    const pr = wb.projects.current;
    if (!p || !pr) return empty(el, 'Open a project from the Projects view.');
    const fm = p.files().length ? p.files() : [{ file: 'main.typed', start: 1, lines: p.source.split('\n').length }];
    let file = S().typedFile && fm.some(f => f.file === S().typedFile) ? S().typedFile : fm[0].file;
    if (p.error && p.error.file && S().errorJump !== p.error.message) { file = p.error.file; S().errorJump = p.error.message; }
    S().typedFile = file;
    const F = fm.find(f => f.file === file), off = F.start - 1;
    const text = pr.files.read(file), lines = text.replace(/\n$/, '').split('\n');
    const { rel } = UI.selection();
    const errLine = p.status !== 'ok' && p.error && p.error.file === file ? p.error.fileLine : 0;
    const heat = S().heat && S().heat.byLine;
    UI.annotationsBegin('source');
    const gl = i => i + 1 + off; // the line in the whole program
    const notes = (() => { try { return pr.files.read('notes.md').trim(); } catch { return ''; } })();
    el.innerHTML = `<div class="tabbody col"><div class="toolbar">${fm.length > 1 ? `<div class="seg sm" data-fileseg>${fm.map(f => `<button class="${f.file === file ? 'on' : ''}" data-tf="${esc(f.file)}">${esc(f.file)}</button>`).join('')}</div>` : `<span class="lbl mono">${esc(file)}</span>`}${p.status === 'ok' ? `<span class="dim">${p.fns().length} functions</span>` : ''}<span class="sp"></span><span class="dim">${esc(pr.group)}</span></div>
      <div class="ed"><div class="egutter"><div class="gutter-in">${lines.map((_, i) => { const g = gl(i), ann = UI.annotationsFor('source', 'gutter', g); return `<div class="${i + 1 === errLine ? 'err' : rel.lines.includes(g) ? 'warn' : ''}" data-line="${g}">${ann.length ? `<span class="heatn">${ann.join('')}</span>` : heat && heat[g] ? `<span class="heatn">${heat[g]}</span>` : ''}${i + 1}</div>`; }).join('')}</div></div>
      <div class="code"><pre>${lines.map((l, i) => { const g = gl(i), cls = UI.annotationsFor('source', 'lineClass', g).join(' '); return `<div class="${i + 1 === errLine ? 'ln-err' : rel.lines.includes(g) ? 'hlline' : ''} ${esc(cls)}">${UI.highlight(l) || ' '}</div>`; }).join('')}</pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off">${esc(text)}</textarea></div></div>
      <div class="ed-foot">${p.status === 'ok' ? `<b>ok</b> <span>${p.rev} · editing a file starts the program again at r0</span>` : `<span class="bad">${esc(p.error.file || '')} line ${p.error.fileLine || p.error.line || '?'}:${p.error.col || '?'}</span> <span>${esc(p.error.message)}</span>`}</div>
      ${notes ? `<div class="hint presetnote"><span>${UI.inline(notes.split('\n')[0])}</span></div>` : ''}</div>`;
    const ta = el.querySelector('textarea'), pre = el.querySelector('.code pre'), gut = el.querySelector('.gutter-in');
    ta.addEventListener('scroll', () => { pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`; gut.style.transform = `translateY(${-ta.scrollTop}px)`; });
    let timer = null;
    ta.addEventListener('input', () => {
      pre.innerHTML = ta.value.split('\n').map(l => `<div>${UI.highlight(l) || ' '}</div>`).join('');
      clearTimeout(timer);
      timer = setTimeout(UI.guarded(() => { if (ta.value !== pr.files.read(file)) { const pos = ta.selectionStart; pr.files.write(file, ta.value); const t2 = el.querySelector('textarea'); if (t2) { t2.focus(); t2.setSelectionRange(pos, pos); } } }), 500);
    });
    ta.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); const st = ta.selectionStart; ta.setRangeText('    ', st, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } });
    gut.onclick = UI.guarded(e => {
      const d = e.target.closest('[data-line]'); if (!d || p.status !== 'ok') return;
      const line = +d.dataset.line;
      for (const f of p.fns()) { const op = p.fn(f).ops().line(line).first(); if (op) { S().fn = f; UI.focus(op.id); return; } }
    });
    const seg = el.querySelector('[data-fileseg]');
    if (seg) seg.onclick = e => { const b = e.target.closest('[data-tf]'); if (b) { S().typedFile = b.dataset.tf; V.source.render(el, { wb, p }); } };
  },
};

// ---------- IR ----------
V.ir = {
  title: 'IR', on: ['program', 'revision', 'focus', 'fn'],
  count: () => { const p = wbx().current; return p && p.status === 'ok' ? p.rev : ''; },
  render(el, { p }) {
    if (!needProgram(el, p)) return;
    const fname = curFn(p), f = p.fn(fname);
    const { rel } = UI.selection();
    UI.annotationsBegin('ir');
    const rows = [];
    rows.push(`<div class="hd">function ${esc(f.text)}</div>`);
    const locals = f.locals();
    rows.push(`<div class="cm">// locals: ${locals.map(l => esc(l.name) + (l.param ? ' (param)' : l.madeBy ? ` (${esc(l.madeBy)})` : '')).join(', ')}</div>`);
    for (const b of f.blocks().list()) {
      const bann = UI.annotationsFor('ir', 'block', b);
      rows.push(`<div class="hd${UI.isSel(b.id) ? ' hl' : ''}">${nid(b.id)}  <span class="cm">-> [${b.succ.map(s => esc(s.replace(/^bb:[^.]+\./, '.'))).join(', ')}]</span>${bann.length ? ' ' + bann.join(' ') : ''}</div>`);
      for (const s of b.stmts().list()) {
        const lines = s.lines();
        const ann = UI.annotationsFor('ir', 'stmt', s).concat(s.values().list().flatMap(v => UI.annotationsFor('ir', 'value', v)));
        const where = lines.length ? p.where(s.id) : [];
        rows.push(`<div class="${UI.isSel(s.id) || rel.stmts.includes(s.id) ? 'hl' : ''}">    ${nid(s.id, s.id.padEnd(12))} ${esc(s.text)}${ann.length ? ' ' + ann.join(' ') : ''}${where.length ? `   <span class="cm">// ${where.length > 1 && where[0].split(':')[0] === where[1].split(':')[0] ? where[0] + ',' + where.slice(1).map(w => w.split(':')[1]).join(',') : where.join(', ')}</span>` : ''}</div>`);
      }
    }
    el.innerHTML = `<div class="tabbody col"><div class="toolbar">${fnPicker(p)}<span class="sp"></span><span class="dim">${f.blocks().count()} blocks · ${f.stmts().count()} statements · ${f.values().count()} values</span></div><div class="scroll"><div class="irtext">${rows.join('')}</div></div></div>`;
  },
};

// ---------- CFG ----------
V.cfg = {
  title: 'CFG', on: ['program', 'revision', 'focus', 'fn', 'theme'],
  render(el, { p }) {
    if (!needProgram(el, p)) return;
    const fname = curFn(p), f = p.fn(fname);
    const blocks = f.blocks().list(), ids = blocks.map(b => b.id);
    const loops = f.loops();
    const { rel } = UI.selection();
    // layers: longest path over forward edges in reverse postorder
    const order = rpo(blocks), pos = new Map(order.map((id, i) => [id, i]));
    const layer = new Map(); for (const id of order) layer.set(id, 0);
    for (const id of order) for (const s of blocks.find(b => b.id === id).succ) if (pos.get(s) > pos.get(id)) layer.set(s, Math.max(layer.get(s), layer.get(id) + 1));
    for (const id of ids) if (!layer.has(id)) layer.set(id, 0);
    const byLayer = []; for (const id of order) { const l = layer.get(id); (byLayer[l] = byLayer[l] || []).push(id); }
    const slot = new Map();
    byLayer.forEach(row => {
      const key = id => { let best = Infinity; for (const b of blocks) { const k = b.succ.indexOf(id); if (k >= 0 && slot.has(b.id) && pos.get(id) > pos.get(b.id)) best = Math.min(best, slot.get(b.id) * 4 + k * (b.succ.length > 1 && b.succ[0] !== b.succ[1] ? 1 : 0)); } return best === Infinity ? 0 : best; };
      row.sort((a, b) => key(a) - key(b) || pos.get(a) - pos.get(b));
      row.forEach((id, i) => slot.set(id, i));
    });
    const W = 230, gapX = 40, gapY = 46, lh = 14;
    const box = new Map();
    let y = 16, maxW = 0;
    byLayer.forEach((row) => {
      const hs = row.map(id => 24 + lh * Math.max(1, blocks.find(b => b.id === id).stmts().count()));
      const h = Math.max(...hs);
      row.forEach((id, i) => box.set(id, { x: 16 + i * (W + gapX), y, w: W, h: hs[i] }));
      maxW = Math.max(maxW, 16 + row.length * (W + gapX));
      y += h + gapY;
    });
    const height = y, width = maxW + 60;
    const inLoop = id => loops.find(l => l.body.includes(id));
    let svg = '';
    for (const b of blocks) {
      const a = box.get(b.id);
      b.succ.forEach((s, k) => {
        const c = box.get(s); if (!c) return;
        const back = pos.get(s) <= pos.get(b.id);
        const sx = a.x + a.w / 2 + (b.succ.length > 1 ? (k ? 30 : -30) : 0), sy = a.y + a.h;
        let d;
        if (back) { const rx = Math.max(a.x, c.x) + W + 18 + 6 * k; d = `M${a.x + a.w} ${a.y + a.h - 8} C${rx} ${a.y + a.h - 8} ${rx} ${c.y + 10} ${c.x + c.w} ${c.y + 10}`; }
        else d = `M${sx} ${sy} C${sx} ${sy + 24} ${c.x + c.w / 2} ${c.y - 24} ${c.x + c.w / 2} ${c.y}`;
        const label = b.succ.length > 1 ? (k === 0 ? 'then' : 'else') : '';
        svg += `<g class="edge${back ? ' dash' : ''}"><path d="${d}"/>${label ? `<text x="${sx + (k ? 4 : -30)}" y="${sy + 13}" class="elabel">${label}</text>` : ''}<path d="M${back ? c.x + c.w : c.x + c.w / 2} ${back ? c.y + 10 : c.y} l${back ? '5 -4 m0 8 l-5 -4' : '-4 -6 m8 0 l-4 6'}" /></g>`;
      });
    }
    for (const b of blocks) {
      const a = box.get(b.id), L = inLoop(b.id), sel = UI.isSel(b.id), head = loops.some(l => l.head === b.id);
      const stmts = b.stmts().list();
      svg += `<g class="node${sel ? ' sel' : ''}" data-id="${esc(b.id)}"><rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" class="${L ? 'inloop' : ''}"/>
        <text x="${a.x + 8}" y="${a.y + 15}" class="bid">${esc(b.id)}${head ? ' · loop head' : ''}</text>
        ${stmts.map((s, i) => `<text x="${a.x + 8}" y="${a.y + 31 + i * lh}" class="st${rel.stmts.includes(s.id) || UI.isSel(s.id) ? ' on' : ''}" data-id="${esc(s.id)}">${esc(trunc(s.text, 34))}</text>`).join('')}</g>`;
    }
    el.innerHTML = `<div class="tabbody col"><div class="toolbar">${fnPicker(p)}<span class="sp"></span><span class="dim">${blocks.length} blocks · ${loops.length} loop${loops.length === 1 ? '' : 's'} · dashed: back edge</span></div><div class="scroll graphscroll"><svg class="graph cfg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svg}</svg></div></div>`;
    el.querySelector('svg').onclick = e => { const t = e.target.closest('[data-id]'); if (t) UI.focus(t.dataset.id); };
  },
};
const trunc = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
function rpo(blocks) {
  const succ = new Map(blocks.map(b => [b.id, b.succ])), seen = new Set(), out = [];
  const dfs = id => { if (seen.has(id) || !succ.has(id)) return; seen.add(id); for (const s of succ.get(id)) dfs(s); out.push(id); };
  if (blocks.length) dfs(blocks[0].id);
  return out.reverse();
}

// ---------- Lineage and why ----------
V.lineage = {
  title: 'Lineage', on: ['focus', 'revision', 'program', 'image'],
  render(el, { p }) {
    if (!needProgram(el, p)) return;
    const { id, rel } = UI.selection();
    if (!id) return empty(el, 'Select something: a statement in IR, a block in CFG, a line number in Source, an instruction in RV32. Its origin, the facts that justify it, and everything derived from it show here.');
    const h = p.get(id), d = h.describe();
    const tree = (n, depth = 0) => {
      if (!n || depth > 8) return '';
      const kids = [];
      if (n.from) kids.push(`<li><span class="dim">made from</span> ${tree(n.from, depth + 1)}</li>`);
      for (const b of n.because || []) kids.push(`<li><span class="dim">because</span> ${typeof b === 'string' ? (p.has(b) ? nid(b) : `<code>${esc(b)}</code>`) : tree(b, depth + 1)}</li>`);
      return `${p.has(n.id) ? nid(n.id) : `<code>${esc(n.id)}</code>`} <span>${esc(n.text || '')}</span> <span class="dim">${esc([n.status, n.via && `via ${n.via}`, n.rev !== undefined && `r${n.rev}`, n.note].filter(Boolean).join(' · '))}</span>${kids.length ? `<ul>${kids.join('')}</ul>` : ''}`;
    };
    const hist = h.history();
    el.innerHTML = `<div class="tabbody col"><div class="scroll"><div class="doc related">
      <h4>${esc(d.kind)} ${nid(id)}</h4><p><b>${esc(d.what)}</b> <span class="dim">${esc(d.status)}${d.lines ? ' · line ' + d.lines.join(', ') : ''}</span></p>
      ${d.origin ? `<p class="dim">${d.origin.map(esc).join('<br>')}</p>` : ''}
      <h4>Why it is here</h4><div class="whytree"><ul><li>${tree(p.why(id))}</li></ul></div>
      <h4>Related</h4><p>${rel.lines.length ? `lines ${rel.lines.join(', ')} · ` : ''}${rel.stmts.length} statements · ${rel.values.length} values · ${rel.insns.length} instructions</p>
      <p class="refs">${rel.stmts.slice(0, 24).map(x => nid(x)).join('')}${rel.insns.slice(0, 24).map(x => nid(x)).join('')}</p>
      ${hist.length ? `<h4>History</h4><table class="rt"><tr><th>edit</th><th>pass</th><th>kind</th><th>detail</th></tr>${hist.map(e => `<tr><td>${esc(e.id)}</td><td>${esc(e.pass)}</td><td>${esc(e.kind)}</td><td>${esc(e.text || e.note || e.field || '')}</td></tr>`).join('')}</table>` : ''}
    </div></div></div>`;
  },
};

// ---------- Facts ----------
V.facts = {
  title: 'Facts', on: ['revision', 'program', 'fn', 'focus'],
  render(el, { wb, p }) {
    if (!needProgram(el, p)) return;
    const fname = curFn(p), f = p.fn(fname);
    const names = wb.analyses().map(a => a.name);
    const pick = S().fact && names.includes(S().fact) ? S().fact : 'liveness';
    let body = '';
    try {
      const fact = f.fact(pick), v = fact.value, L = f.locals(), nm = i => (L[i] || { name: 'l' + i }).name;
      const rows = [];
      const blocks = f.blocks().ids();
      if (pick === 'liveness') for (const b of blocks) rows.push([b, [...(v.in.get(b) || [])].map(nm).join(', ') || '∅', [...(v.out.get(b) || [])].map(nm).join(', ') || '∅']);
      else if (pick === 'dominators') for (const b of blocks) rows.push([b, v.idom.get(b) === b ? '(entry)' : v.idom.get(b) || 'unreachable', (v.children.get(b) || []).join(', ')]);
      else if (pick === 'loops') for (const l of v) rows.push([l.head, l.body.join(', '), `latch ${l.latch} · preheader ${l.preheader || 'none'} · assigns ${l.assigned.map(nm).join(', ')}`]);
      else if (pick === 'reaching') for (const b of blocks) rows.push([b, [...(v.in.get(b) || [])].slice(0, 14).join(', '), '']);
      else if (pick === 'ranges') for (const b of blocks) { const m = v.in.get(b) || new Map(); rows.push([b, [...m].filter(([, r]) => r).map(([k, r]) => `${nm(k)} ${fmtRange(r)}`).join(' · '), '']); }
      else if (pick === 'cfg') for (const b of blocks) rows.push([b, (v.succ.get(b) || []).join(', '), (v.preds.get(b) || []).join(', ')]);
      else if (v && v.in) for (const b of blocks) rows.push([b, short(v.in.get(b)), short(v.out && v.out.get(b))]);
      else rows.push(['value', esc(G.WB.toYaml(v).slice(0, 2000)), '']);
      const heads = { liveness: ['block', 'live in', 'live out'], dominators: ['block', 'idom', 'dominates'], loops: ['head', 'body', 'details'], reaching: ['block', 'definitions reaching the start', ''], ranges: ['block', 'intervals at the start', ''], cfg: ['block', 'succ', 'preds'] }[pick] || ['block', 'in', 'out'];
      body = `<p class="dim">${esc(fact.id)} · ${esc(fact.status)} · ${fact.ms} ms · ${fact.visits ?? '?'} block visits</p><table class="rt facts"><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr><td>${nid(r[0], r[0].replace(/^bb:[^.]+/, ''))}</td><td class="mono">${esc(r[1])}</td><td class="mono">${esc(r[2])}</td></tr>`).join('')}</table>`;
    } catch (e) { body = `<div class="fail"><b>${esc(pick)} failed.</b> ${esc(e.message)}</div>`; }
    const cached = p.facts().filter(x => x.id.includes(`(${fname})`));
    el.innerHTML = `<div class="tabbody col"><div class="toolbar">${fnPicker(p)}<span class="sp"></span><div class="seg sm" data-factseg>${names.map(n => `<button class="${n === pick ? 'on' : ''}" data-fact="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>
      <div class="scroll"><div class="doc related">${body}<h4>The fact cache</h4><p class="dim">Facts are computed on demand and go stale when a pass writes something they read, unless the pass declares it preserves them.</p><table class="rt">${cached.map(x => `<tr><td>${esc(x.id)}</td><td class="${x.status === 'stale' ? 'bad' : ''}">${esc(x.status)}${x.staleBy ? ` by ${esc(x.staleBy)} at ${esc(x.staleAt)}` : ''}</td></tr>`).join('') || '<tr><td class="dim">none yet</td><td></td></tr>'}</table></div></div></div>`;
    el.querySelector('[data-factseg]').onclick = e => { const b = e.target.closest('[data-fact]'); if (b) { S().fact = b.dataset.fact; V.facts.render(el, { wb, p }); } };
  },
};
const fmtRange = r => { const f = n => n === 2147483647 ? 'max' : n === -2147483648 ? 'min' : String(n); return r[0] === r[1] ? `= ${f(r[0])}` : `[${f(r[0])}, ${f(r[1])}]`; };
const short = x => x === undefined || x === null ? '' : x instanceof Set ? [...x].join(', ') : x instanceof Map ? [...x].map(([k, v]) => `${k}: ${v}`).join(', ') : String(x);

// ---------- Pipeline and parameters ----------
V.pipeline = {
  title: 'Pipeline', on: ['revision', 'program', 'pipeline', 'params'],
  render(el, { wb, p }) {
    const s = S();
    if (!p) return empty(el, 'Open a project.');
    const passes = new Map(wb.passes().map(x => [x.name, x]));
    const params = wb.param.list();
    const steps = (s.pipeline || []).map((name, i) => {
      const x = passes.get(name) || { about: '?' }, done = i < s.pipeIndex, log = (s.runLog || []).filter(r => r.i === i).at(-1);
      return `<tr class="${done ? 'dimrow' : i === s.pipeIndex ? 'sel' : ''}${log && log.bad ? ' badrow' : ''}"><td><input type="checkbox" data-en="${i}" ${s.enabled[i] === false ? '' : 'checked'} ${done ? 'disabled' : ''}></td><td class="nm">${esc(name)}</td><td class="aboutcell">${esc(x.about)}</td><td>${log ? `${log.edits ? `${esc(log.rev)} · ${log.edits} edits` : 'no change'}${log.check ? ` · <span class="${log.bad ? 'bad' : ''}">${esc(log.check)}</span>` : ''}` : ''}</td></tr>`;
    }).join('');
    el.innerHTML = `<div class="tabbody col"><div class="toolbar"><span class="lbl">pipeline</span><div class="seg sm" data-pipeseg>${Object.keys(G.WB.PIPELINES).map(k => `<button class="${k === s.pipeName ? 'on' : ''}" data-pipe="${k}">${k}</button>`).join('')}</div>
      <span class="sp"></span><button class="btn sm" data-reset title="Check out r0">Reset</button><button class="btn sm" data-step>Step</button><button class="btn sm primary" data-runall>Run all</button></div>
      <div class="scroll"><table class="rt pipe"><tr><th></th><th>pass</th><th>what it does</th><th>result</th></tr>${steps || '<tr><td></td><td class="dim" colspan="3">O0 runs nothing: the lifted code as it is.</td></tr>'}</table>
      <p class="note padded">Each pass that changes something makes one revision, and the program is checked against r0 on 40 cases after it. Step applies the next checked pass.</p>
      ${params.length ? `<div class="block paramlist"><header><h2>Parameters</h2><span class="sub">declared by the project's scripts; tiles that read one update when it moves</span></header>${params.map(paramRow).join('')}</div>` : ''}
      </div></div>`;
    el.onclick = UI.guarded(e => {
      const pb = e.target.closest('[data-pipe]'); if (pb) { s.pipeName = pb.dataset.pipe; s.pipeline = G.WB.PIPELINES[pb.dataset.pipe].slice(); s.pipeIndex = 0; s.enabled = {}; s.runLog = []; UI.refresh(['pipeline']); return; }
      if (e.target.closest('[data-reset]')) { if (p.rev !== 'r0') p.checkout('r0'); s.pipeIndex = 0; s.runLog = []; UI.refresh(['pipeline']); return; }
      if (e.target.closest('[data-step]')) { UI.step(); return; }
      if (e.target.closest('[data-runall]')) { UI.runPipeline(); return; }
    });
    el.onchange = UI.guarded(e => {
      const en = e.target.closest('[data-en]'); if (en) { s.enabled[+en.dataset.en] = en.checked; return; }
      const pr = e.target.closest('[data-param]'); if (pr) { const d = params.find(x => x.name === pr.dataset.param); let v = pr.type === 'checkbox' ? pr.checked : pr.value; if (d.kind === 'int' || d.kind === 'float') v = +v; const c = UI.dsl.params.get(d.name); if (c) UI.dsl.liveUi.param.value(d.name, v); else wb.param.set(d.name, v); UI.refresh(['params']); }
    });
    el.oninput = e => { const pr = e.target.closest('input[type=range][data-param]'); if (pr) { const out = pr.closest('.prow').querySelector('.pv'); if (out) out.textContent = pr.value; } };
  },
};
const paramValues = () => Object.fromEntries(wbx().param.list().map(d => [d.name, d.value]));
function paramRow(d) {
  let ctl = '';
  if (d.kind === 'int' || d.kind === 'float') ctl = `<input type="range" data-param="${esc(d.name)}" min="${d.min}" max="${d.max}" step="${d.step}" value="${d.value}">`;
  else if (d.kind === 'bool') ctl = `<input type="checkbox" data-param="${esc(d.name)}" ${d.value ? 'checked' : ''}>`;
  else if (d.kind === 'choice') ctl = `<select data-param="${esc(d.name)}">${d.options.map(o => `<option ${o === d.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  return `<div class="prow"><span class="pn" title="${esc(d.about || '')}">${esc(d.name)}</span><span class="pc">${ctl}</span><span class="pv">${esc(String(d.value))}</span><span></span></div>`;
}

// ---------- Timeline ----------
V.timeline = {
  title: 'Timeline', on: ['revision', 'program'],
  count: () => { const p = wbx().current; return p && p.status === 'ok' ? p.revisions().length : ''; },
  render(el, { p }) {
    if (!needProgram(el, p)) return;
    const revs = p.revisions(), open = S().openRev;
    const rows = revs.map(r => {
      const isOpen = open === r.rev;
      let edits = '';
      if (isOpen) edits = `<tr class="edits"><td colspan="5"><table class="rt changes">${p.edits(r.rev).map(e => `<tr><td>${esc(e.id)}</td><td>${esc(e.kind)}</td><td>${e.stmt ? nid(e.stmt) : e.block ? (p.has(e.block) ? nid(e.block) : esc(e.block)) : e.from && p.has(e.from) ? nid(e.from) : ''}${e.to && p.has(e.to) && e.kind !== 'retarget' ? ' → ' + nid(e.to) : ''}</td><td>${esc(e.text || e.note || e.field || e.name || '')}</td><td class="dim">${esc((e.because || []).join(', '))}</td></tr>`).join('') || '<tr><td class="dim">no edits</td></tr>'}</table></td></tr>`;
      return `<tr class="clickable${isOpen ? ' sel' : ''}" data-rev="${r.rev}"><td class="nm">${r.rev}</td><td>${esc(r.pass)}</td><td class="num">${r.edits}</td><td class="num">${r.ms} ms</td><td>${r.rev !== p.rev ? `<button class="link" data-checkout="${r.rev}">check out</button>` : '<span class="dim">head</span>'}</td></tr>` + edits;
    }).join('');
    el.innerHTML = `<div class="tabbody col"><div class="toolbar"><span class="lbl">${revs.length} revisions of ${esc(p.id)}</span><span class="sp"></span><button class="btn sm" data-undo ${revs.length > 1 ? '' : 'disabled'}>Undo last</button></div><div class="scroll"><table class="rt timeline"><tr><th>rev</th><th>pass</th><th class="num">edits</th><th class="num">time</th><th></th></tr>${rows}</table><p class="note padded">Check out drops the revisions after it. Removed statements stay in the store with status removed@rN, so their history stays readable.</p></div></div>`;
    el.onclick = UI.guarded(e => {
      const c = e.target.closest('[data-checkout]'); if (c) { p.checkout(c.dataset.checkout); S().pipeIndex = 0; return; }
      if (e.target.closest('[data-undo]')) { p.undo(); return; }
      const r = e.target.closest('[data-rev]'); if (r && !e.target.closest('.nid')) { S().openRev = S().openRev === r.dataset.rev ? null : r.dataset.rev; V.timeline.render(el, { p }); }
    });
  },
};

// ---------- Checks ----------
V.checks = {
  title: 'Checks', on: ['check', 'revision', 'program'],
  count: () => { const c = S().lastCheck; return c ? c.status : ''; }, countBad: () => S().lastCheck && S().lastCheck.status !== 'agree',
  render(el, { p }) {
    if (!needProgram(el, p)) return;
    const c = S().lastCheck, hasRef = !!p.reference();
    const body = !c ? '<p class="empty padded">No check yet. A check runs the head revision and a baseline on the same generated inputs and compares results, traps and memory.</p>' :
      c.fns.map(f => `<div class="block"><header><h2>${esc(f.fn)}</h2><span class="sub">${esc(c.rev)} against ${esc(f.against)}</span></header>
        <dl class="kv"><dt>agree</dt><dd class="${f.status === 'disagree' ? 'bad' : ''}">${f.agree} / ${f.total}</dd><dt>both trapped</dt><dd>${f.bothTrap}</dd><dt>inconclusive (step limit)</dt><dd>${f.inconclusive}</dd></dl>
        ${f.counterexamples.length ? `<table class="rt"><tr><th>case</th><th>arguments</th><th>expected</th><th>got</th><th></th></tr>${f.counterexamples.map(x => `<tr class="badrow"><td>${x.n}</td><td>${esc(JSON.stringify(x.args))}</td><td>${esc(String(x.expected))}</td><td>${esc(String(x.got))}</td><td></td></tr>`).join('')}</table><p class="note">Pointer arguments (buffers, records, strings) are addresses into the case's memory.</p>` : ''}</div>`).join('');
    el.innerHTML = `<div class="tabbody col"><div class="toolbar"><span class="lbl">check ${esc(p.rev)} against</span><button class="btn sm" data-ck="r0">r0</button><button class="btn sm" data-ck="image">its RV32 image</button><button class="btn sm" data-ck="reference" ${hasRef ? '' : 'disabled title="only built-in projects, unedited, carry a reference image"'}>the reference compiler</button><span class="sp"></span><span class="lbl">cases</span><select data-count>${[40, 100, 300, 1000].map(n => `<option ${n === (S().ckCount || 100) ? 'selected' : ''}>${n}</option>`).join('')}</select></div><div class="scroll">${body}</div></div>`;
    el.onclick = UI.guarded(e => { const b = e.target.closest('[data-ck]'); if (b) p.check({ against: b.dataset.ck, count: S().ckCount || 100, ...(b.dataset.ck === 'image' ? { image: p.compile(backendOpts()).id } : {}) }); });
    el.querySelector('[data-count]').onchange = e => { S().ckCount = +e.target.value; };
  },
};
const backendOpts = () => { const b = S().backend; return Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && k in G.WB.backendDefaults && G.WB.backendDefaults[k] !== v)); };
UI.backendOpts = backendOpts;

// ---------- RV32 ----------
V.rv32 = {
  title: 'RV32', on: ['image', 'revision', 'program', 'focus', 'fn', 'run'],
  count: () => { const p = wbx().current; const i = p && p.status === 'ok' && p.image(); return i ? i.bytes + ' B' : ''; },
  render(el, { p }) {
    if (!needProgram(el, p)) return;
    const s = S(), mode = s.rvMode || 'listing', fname = curFn(p);
    const head = `<div class="toolbar">${fnPicker(p)}<div class="seg sm" data-rvmode>${[['listing', 'Listing'], ['diff', 'Diff'], ['alloc', 'Allocation']].map(([k, l]) => `<button class="${k === mode ? 'on' : ''}" data-m="${k}">${l}</button>`).join('')}</div><span class="sp"></span><button class="btn sm${s.rvOpts ? ' on' : ''}" data-rvopts title="How instructions are selected and registers allocated">Backend options${optCount()}</button></div>${s.rvOpts ? optionsBlock() : ''}`;
    let body = '';
    try {
      if (mode === 'diff') body = diffBody(p, fname);
      else if (mode === 'alloc') body = allocBody(p, fname);
      else body = listingBody(p, fname);
    } catch (e) { body = `<div class="fail padded"><b>The backend refused.</b> ${esc(e.message)}</div>`; }
    el.innerHTML = `<div class="tabbody col">${head}<div class="scroll">${body}</div></div>`;
    el.onclick = UI.guarded(e => {
      const m = e.target.closest('[data-rvmode] [data-m]'); if (m) { s.rvMode = m.dataset.m; UI.refresh(['image']); return; }
      if (e.target.closest('[data-rvopts]')) { s.rvOpts = !s.rvOpts; UI.refresh(['image']); return; }
      const o = e.target.closest('[data-opt]'); if (o) { s.backend[o.dataset.opt] = !s.backend[o.dataset.opt]; UI.refresh(['image']); return; }
      const c = e.target.closest('[data-choice]'); if (c) { s.backend[c.dataset.choice] = c.dataset.v; UI.refresh(['image']); return; }
      if (e.target.closest('[data-optreset]')) { s.backend = { ...G.WB.backendDefaults }; delete s.backend.layout; UI.refresh(['image']); return; }
      const sw = e.target.closest('[data-diffkind]'); if (sw) { s.diffKind = sw.dataset.diffkind; UI.refresh(['image']); return; }
    });
    el.onchange = UI.guarded(e => {
      const sel = e.target.closest('[data-diffside]'); if (sel) { s['diff' + sel.dataset.diffside] = sel.value; UI.refresh(['image']); }
    });
    const r = el.querySelector('[data-regs]');
    if (r) {
      r.oninput = () => { el.querySelector('[data-regsv]').textContent = r.value === '24' ? 'all' : r.value; };
      r.onchange = () => { s.backend.registers = r.value === '24' ? 'all' : +r.value; UI.refresh(['image']); };
    }
  },
};
function optCount() {
  const b = S().backend, d = G.WB.backendDefaults;
  const n = Object.keys(b).filter(k => b[k] !== undefined && b[k] !== d[k]).length;
  return n ? ` <span class="count">${n} changed</span>` : '';
}
function optionsBlock() {
  const b = S().backend;
  const seg = (k, opts) => `<div class="seg sm">${opts.map(([v, l]) => `<button class="${b[k] === v ? 'on' : ''}" data-choice="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
  return `<div class="block rvopts">
    <div class="optrow"><span class="lbl">Instruction selection</span>${['fuse', 'immediates', 'divmagic', 'useRanges'].map(k => `<button class="tog${b[k] ? ' on' : ''}" data-opt="${k}" title="${esc(OPT_ABOUT[k])}">${k}</button>`).join('')}</div>
    <div class="optrow"><span class="lbl">Register allocation</span><span class="lbl">registers</span><input type="range" min="1" max="24" value="${b.registers === 'all' ? 24 : b.registers}" data-regs><b data-regsv>${b.registers === 'all' ? 'all' : b.registers}</b>
      <span class="lbl">try first</span>${seg('order', [['caller', 'caller-saved'], ['callee', 'callee-saved']])}
      <span class="lbl">spill</span>${seg('spill', [['furthest', 'ends last'], ['current', 'the new one']])}
      <button class="tog${b.hints ? ' on' : ''}" data-opt="hints" title="${esc(OPT_ABOUT.hints)}">hints</button></div>
    <p class="note">These go to every image this view makes, and to Diff and Allocation. In code: <code>p.compile(${esc(JSON.stringify(UI.backendOpts()))})</code>. <button class="link" data-optreset>Reset to defaults</button></p></div>`;
}
const OPT_ABOUT = {
  fuse: 'fuse a comparison into the branch that tests it (blt instead of slt then bnez)',
  immediates: 'use addi, slli, lw offsets and x0 for small constants instead of loading them',
  divmagic: 'divide by a constant with mulh and shifts instead of div',
  useRanges: 'read the ranges fact to drop division checks the facts make unnecessary',
  hints: 'parameters prefer their a-register and returned values a0, so copies disappear',
};
function currentImage(p, opts) {
  let img = p.image();
  const want = JSON.stringify({ ...G.WB.backendDefaults, ...opts });
  if (!img || img.status !== 'current' || JSON.stringify(img.options) !== want) img = p.compile(opts);
  return img;
}
function listingBody(p, fname) {
  const img = currentImage(p, backendOpts()), st = img.fns[fname], ref = p.reference();
  const counts = S().heat && S().heat.image === img.id ? S().heat.counts : null;
  const { rel } = UI.selection();
  UI.annotationsBegin('rv32');
  const rows = img.insns(fname).map(x => {
    const n = counts ? counts[x.offset >>> 2] || 0 : null;
    const cov = x.covers[x.covers.length - 1], ann = UI.annotationsFor('rv32', 'insn', x);
    return `<tr class="${UI.isSel(x.id) ? 'sel' : rel.insns.includes(x.id) ? 'hlrow' : ''}"><td class="mono dim">${(x.offset - st.entry).toString(16).padStart(3, '0')}</td><td class="mono">${nid(x.id, x.text)}${ann.length ? ' ' + ann.join(' ') : ''}</td><td class="mono dim">${cov && p.has(cov) ? nid(cov) : ''}${x.lines.length ? ' · ' + p.where(x.id).join(', ') : ''}${x.why ? ' · ' + esc(x.why) : ''}</td><td class="num">${n === null ? '' : n}</td></tr>`;
  }).join('');
  return `<div class="block"><dl class="kv kvwide"><dt>image</dt><dd>${esc(img.id)} · ${esc(img.status)}</dd><dt>${esc(fname)}</dt><dd>${st.bytes} bytes · ${st.insns} instructions</dd><dt>frame</dt><dd>${st.frame} bytes${st.saved.length ? ' · saves ' + st.saved.join(' ') : ''}</dd><dt>registers used</dt><dd>${st.regs.join(' ') || 'none'}</dd><dt>spills</dt><dd class="${st.spills ? 'bad' : ''}">${st.spills}</dd><dt>whole image</dt><dd>${img.bytes} bytes${ref ? ` · reference compiler ${ref.bytes} bytes` : ''}</dd>${counts ? `<dt>last run</dt><dd>${S().heat.steps} instructions</dd>` : ''}</dl></div>
    <table class="rt asm"><tr><th>off</th><th>instruction</th><th>covers</th><th class="num">${counts ? 'runs' : ''}</th></tr>${rows}</table>
    <p class="note padded">Each instruction is an entity: select one to see the statement and source line it came from. Counts appear after a run on the image in the Run view.</p>`;
}
function diffBody(p, fname) {
  const s = S(), revs = p.revisions().map(r => r.rev), kind = s.diffKind || 'revisions';
  const pick = (side, dflt) => { const v = s['diff' + side]; return revs.includes(v) ? v : dflt; };
  const a = pick('A', 'r0'), b = pick('B', p.rev);
  const opts = backendOpts();
  // one comparison per program, revisions, options and function; selecting things does not redo it
  const key = JSON.stringify([p.id, p.revisions().length, p.revisions().at(-1).rev, kind, a, b, fname, opts]);
  if (!s.diffCache || s.diffCache.key !== key || s.diffCache.prog !== p._p) {
    const d0 = kind === 'options' ? p.asmDiff(b, b, { fn: fname, optionsA: {}, optionsB: opts }) : p.asmDiff(a, b, { fn: fname, ...opts });
    s.diffCache = { key, prog: p._p, d: d0 };
  }
  const d = s.diffCache.d;
  const sameSide = kind === 'revisions' && a === b;
  const sel = (side, v) => `<select data-diffside="${side}">${revs.map(r => { const x = p.revisions().find(q => q.rev === r); return `<option value="${r}" ${r === v ? 'selected' : ''}>${r} · ${esc(x.pass)}</option>`; }).join('')}</select>`;
  const delta = (x, y, unit) => `${x} → <b>${y}</b> ${unit}${x !== y ? ` <span class="${y > x ? 'bad' : 'dim'}">(${y > x ? '+' : ''}${y - x})</span>` : ''}`;
  let ia = 0, ib = 0;
  const rows = d.rows.map(r => {
    const ca = r.a ? (p.get(r.a).offset - d.aEntry) : null;
    const cell = id => id ? (p.get(id).offset).toString(16).padStart(3, '0') : '';
    void ca; void ia; void ib;
    return `<tr class="d${r.op === '=' ? 'same' : r.op === '-' ? 'del' : 'add'}"><td class="mono dim">${r.a ? cell(r.a) : ''}</td><td class="mono dim">${r.b ? cell(r.b) : ''}</td><td class="mono sign">${r.op === '=' ? '' : r.op === '-' ? '−' : '+'}</td><td class="mono">${nid(r.b || r.a, r.text)}</td><td class="mono dim">${r.covers && p.has(r.covers) ? nid(r.covers) : ''}</td></tr>`;
  }).join('');
  return `<div class="toolbar sub"><div class="seg sm">${[['revisions', 'two revisions'], ['options', 'defaults vs my options']].map(([k, l]) => `<button class="${k === kind ? 'on' : ''}" data-diffkind="${k}">${l}</button>`).join('')}</div>
      ${kind === 'revisions' ? `<span class="lbl">A</span>${sel('A', a)}<span class="lbl">B</span>${sel('B', b)}` : `<span class="dim">both at ${esc(b)}; A with the default options, B with the backend options above</span>`}</div>
    ${sameSide ? `<p class="note padded">${revs.length === 1 ? 'This program has one revision, so A and B are the same code. Run some passes (Step or Run in the header) and compare r0 with the result, or switch to <b>defaults vs my options</b> to compare backend settings.' : 'A and B are the same revision. Pick another for one side.'}</p>` : ''}
    <div class="block"><dl class="kv kvwide"><dt>A</dt><dd>${esc(d.a.image)}</dd><dt>B</dt><dd>${esc(d.b.image)}</dd><dt>${esc(fname)}</dt><dd>${delta(d.a.bytes, d.b.bytes, 'bytes')}</dd><dt>instructions run</dt><dd>${delta(d.a.instructionsRun, d.b.instructionsRun, `on the ${d.cases} generated cases both finish`)}</dd><dt>frame</dt><dd>${delta(d.a.frame, d.b.frame, 'bytes')}</dd><dt>spills</dt><dd>${delta(d.a.spills, d.b.spills, '')}</dd><dt>instructions</dt><dd>${d.same} the same · <span class="del">−${d.removed}</span> · <span class="add">+${d.added}</span></dd></dl></div>
    <table class="rt asm asmdiff"><tr><th>A</th><th>B</th><th></th><th>instruction (targets by block)</th><th>covers</th></tr>${rows}</table>
    <p class="note padded">Branch targets are written as block names, so code that only moved compares equal. In code: <code>p.asmDiff('${esc(a)}', '${esc(b)}', { fn: '${esc(fname)}' })</code>.</p>`;
}
function allocBody(p, fname) {
  const opts = backendOpts(), m = p.machine(fname, opts);
  const iv = m.intervals.slice().sort((x, y) => x.start - y.start);
  const maxPos = Math.max(1, ...iv.map(x => x.end), m.selected.length);
  const W = 560, rowH = 16, left = 46, right = 70, H = iv.length * rowH + 24;
  const X = v => left + (W - left - right) * v / maxPos;
  const calls = m.selected.map((l, i) => /^\s+call /.test(l) ? i : -1).filter(i => i >= 0);
  const callee = r => /^s\d/.test(r);
  const svg = `<svg class="ivs" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${calls.map(c => `<line x1="${X(c)}" x2="${X(c)}" y1="4" y2="${H - 18}" class="callline"/>`).join('')}
    ${iv.map((x, k) => { const y = 10 + k * rowH; return `<text x="${left - 6}" y="${y + 4}" text-anchor="end" class="vn">${esc(x.vreg)}</text><line x1="${X(x.start)}" x2="${Math.max(X(x.end), X(x.start) + 3)}" y1="${y}" y2="${y}" class="iv ${x.reg === 'spilled' ? 'sp' : callee(x.reg) ? 'cs' : 'ts'}"/><text x="${Math.max(X(x.end), X(x.start) + 3) + 5}" y="${y + 4}" class="rn${x.reg === 'spilled' ? ' bad' : ''}">${esc(x.reg)}</text>`; }).join('')}
    <text x="${left}" y="${H - 4}" class="ax">instruction 0</text><text x="${W - right}" y="${H - 4}" text-anchor="end" class="ax">${maxPos}</text></svg>`;
  const spilled = iv.filter(x => x.reg === 'spilled').length, crossing = iv.filter(x => x.crossesCall).length;
  return `<div class="block"><dl class="kv kvwide"><dt>${esc(fname)}</dt><dd>${iv.length} virtual registers · ${m.leaf ? 'a leaf (no calls)' : `${calls.length} call${calls.length === 1 ? '' : 's'}`}</dd><dt>live across a call</dt><dd>${crossing} (they need s-registers or the stack)</dd><dt>spilled</dt><dd class="${spilled ? 'bad' : ''}">${spilled}</dd></dl>
    <p class="note">Each line is one virtual register's live interval, positions as in the code below. Dark: an s-register (saved by the function). Grey: a t- or a-register. Red: spilled to the stack. Thin red verticals are calls.</p></div>
    <div class="ivwrap">${svg}</div>
    <div class="block"><header><h2>Selected code, before allocation</h2><span class="sub">virtual registers v0, v1, …; the allocator replaces them</span></header><pre class="src selcode">${m.selected.map((l, i) => `<span class="dim">${String(i).padStart(3)}</span> ${esc(l)}`).join('\n')}</pre></div>`;
}
// ---------- Run ----------
V.run = {
  title: 'Run', on: ['program', 'fn', 'run'],
  render(el, { p }) {
    if (!needProgram(el, p)) return;
    const fname = curFn(p), f = p.fn(fname), F = p.describe().fns.find(x => x.name === fname);
    const params = f.params, names = f.locals().filter(l => l.param).map(l => l.name);
    const saved = (S().args || {})[fname] || {};
    const fe = p._p.fe;
    const field = (t, n) => {
      const v = saved[n];
      if (t === 'buffer') return `<input class="filter wide" data-arg="${n}" placeholder="cells: 1, 2, 3" value="${esc(v ?? '1, 2, 3, 4, 5, 6, 7, 8')}">`;
      if (t === 'string') return `<input class="filter wide" data-arg="${n}" placeholder="text" value="${esc(v ?? 'hello world')}">`;
      if (t === 'bool') return `<select data-arg="${n}"><option ${v === 'true' ? 'selected' : ''}>true</option><option ${v === 'false' ? 'selected' : ''}>false</option></select>`;
      if (fe.enums[t]) return `<select data-arg="${n}">${Object.keys(fe.enums[t]).map(k => `<option ${v === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>`;
      if (fe.records[t]) return `<input class="filter wide" data-arg="${n}" placeholder="${Object.keys(fe.records[t]).map(k => k + '=1').join(', ')}" value="${esc(v ?? Object.keys(fe.records[t]).map((k, i) => `${k}=${i + 3}`).join(', '))}">`;
      return `<input class="filter" type="number" data-arg="${n}" value="${esc(v ?? 5)}">`;
    };
    const out = (S().runOut || []).slice(-6).reverse();
    el.innerHTML = `<div class="tabbody col"><div class="toolbar">${fnPicker(p)}<span class="sp"></span><span class="dim">${esc(F.signature)}</span></div>
      <div class="scroll"><div class="block runform">${params.map((t, i) => `<label><span class="lbl">${esc(names[i])}: ${esc(t)}</span>${field(t, names[i])}</label>`).join('')}
      <div class="row"><button class="btn primary sm" data-run="evaluator">Run on the evaluator</button><button class="btn sm" data-runimg>Run on the RV32 image</button><button class="btn sm" data-both>Compare both</button></div></div>
      ${out.map(r => `<div class="block"><header><h2>${esc(r.fn)}(${esc(r.args.join(', '))})</h2><span class="sub">${esc(r.engine)} · ${esc(r.rev)}</span></header><dl class="kv"><dt>result</dt><dd class="${r.trap ? 'bad' : ''}">${r.trap ? 'trap: ' + esc(String(r.trap)) : esc(String(r.result))}</dd><dt>${esc(r.unit || 'steps')}</dt><dd>${r.steps}</dd></dl>${(r.buffers || []).map(b => `<p class="note">${esc(b.name)} at ${b.at}: [${esc(b.cells.join(', '))}]</p>`).join('')}</div>`).join('')}</div></div>`;
    const read = () => {
      const args = [], keep = {};
      params.forEach((t, i) => {
        const inp = el.querySelector(`[data-arg="${names[i]}"]`), v = inp.value; keep[names[i]] = v;
        if (t === 'buffer') args.push(v.split(/[\s,]+/).filter(Boolean).map(Number));
        else if (t === 'string') args.push(v);
        else if (t === 'bool') args.push(v === 'true');
        else if (fe.enums[t]) args.push(v);
        else if (fe.records[t]) args.push(Object.fromEntries(v.split(',').map(x => x.split('=').map(y => y.trim())).filter(x => x[0]).map(([k, n]) => [k, +n])));
        else args.push(+v);
      });
      S().args = { ...(S().args || {}), [fname]: keep };
      return args;
    };
    el.onclick = UI.guarded(e => {
      const add = r => { r.rev = p.rev; (S().runOut = S().runOut || []).push(r); };
      if (e.target.closest('[data-run]')) { add(p.exec(fname, read())); UI.refresh(['run']); }
      if (e.target.closest('[data-runimg]') || e.target.closest('[data-both]')) {
        const args = read();
        if (e.target.closest('[data-both]')) add(p.exec(fname, args));
        const img = p.compile(backendOpts()), r = img.run(fname, args);
        add(r);
        const h = img.heat(fname, args);
        S().heat = { image: img.id, steps: h.steps, byLine: h.byLine, counts: countsOf(p, img, fname, args) };
        UI.refresh(['run', 'image']);
      }
    });
  },
};
function countsOf(p, img, fname, args) {
  // per-instruction counts from the emulator, keyed by word index
  const h = img.insns(), res = {};
  const run = G.WB.runImage(img._img, fname, ...benchOf(p, fname, args), { limit: 5e6 });
  if (run.counts) for (const x of h) res[x.offset >>> 2] = run.counts[x.offset >>> 2];
  return res;
}
function benchOf(p, fname, args) {
  const P = p._p, F = P.fn(fname), bench = {};
  F.params.forEach((t, i) => { let v = args[i]; const fe = P.fe; if (fe.enums[t] && typeof v === 'string') v = fe.enums[t][v]; else if (fe.records[t] && v && typeof v === 'object' && !Array.isArray(v)) v = { record: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, [x, x]])) }; else if (Array.isArray(v)) v = { cells: v }; else if (typeof v === 'string') v = { string: v }; else if (typeof v === 'boolean') v = v ? 1 : 0; bench[F.locals[i].name] = v ?? 0; });
  const c = G.WB.cases.bench(P, fname, bench);
  return [c.args, c.memory];
}

// ---------- Console: a REPL with the same scope as scripts, plus ui ----------
UI.scope = () => {
  const wb = wbx();
  const logs = [];
  return {
    names: ['wb', 'p', 'project', 'ui', 'log', 'yaml', 'src', 'book', 'param'],
    values: [wb, wb.current, wb.projects.current, UI.dsl.liveUi, x => { logs.push(typeof x === 'string' ? x : G.WB.toYaml(x)); }, G.WB.toYaml, wb.source, wb.book, wb.param],
    logs,
  };
};
UI.evalCode = async function evalCode(code, { timeout = 25000 } = {}) {
  const sc = UI.scope();
  const t0 = performance.now();
  let result, error = null;
  try {
    const fn = new Function(...sc.names, '"use strict";\nreturn (async () => {\n' + code + '\n})();\n//# sourceURL=console-eval.js');
    result = await UI.batch(() => Promise.race([fn(...sc.values), new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${timeout / 1000} s`)), timeout))]));
    const mounted = UI.dsl.adopt(result);   // a returned tile goes on screen, as a live tile
    if (mounted) result = { mounted, note: 'mounted as live tiles; ui.live.close(id) removes one' };
  } catch (e) { error = e; }
  return { result, error, logs: sc.logs, ms: Math.round(performance.now() - t0) };
};
UI.consoleRun = async function consoleRun(code) {
  const r = await UI.evalCode(code);
  (S().console = S().console || []).push({ code, ...r });
  UI.refresh(['console']);
  return r;
};
V.console = {
  title: 'Console', on: ['console'],
  render(el) {
    const entries = (S().console || []).slice(-30);
    el.innerHTML = `<div class="tabbody col">
      <div class="scroll consolelog">${entries.map(e => `<div class="centry"><pre class="src cin">${UI.highlight(e.code.length > 600 ? e.code.slice(0, 600) + '\n…' : e.code)}</pre>${e.logs.map(l => `<pre class="res">${esc(l)}</pre>`).join('')}${e.error ? `<pre class="res bad">${esc(e.error.message)}</pre>` : e.result !== undefined ? `<pre class="res">${esc(G.WB.toYaml(e.result).slice(0, 9000))}</pre>` : ''}<span class="dim">${e.ms} ms</span></div>`).join('') || '<p class="empty padded">Results print here as YAML. In scope: wb, p (the program), project, ui (tiles made here are live: ui.live.tile(…)), log, yaml, src, book, param. Scripts you want to keep go in the project: Files → New file.</p>'}</div>
      <div class="composer"><textarea data-repl placeholder="p.apply('fold')   ·   Ctrl+Enter runs">${esc(S().replDraft || '')}</textarea><div class="row"><span class="meta">wb.help() lists the API · wb.help('ui') shows the UI DSL</span><button class="btn sm" data-clear>Clear</button><button class="btn sm primary" data-repl-run>Run</button></div></div></div>`;
    const repl = el.querySelector('[data-repl]');
    repl.oninput = () => { S().replDraft = repl.value; };
    const runRepl = () => { const code = repl.value.trim(); if (!code) return; S().replDraft = ''; UI.consoleRun(/\breturn\b|;|\n/.test(code) ? code : 'return ' + code); };
    repl.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runRepl(); } };
    el.onclick = UI.guarded(e => {
      if (e.target.closest('[data-repl-run]')) runRepl();
      if (e.target.closest('[data-clear]')) { S().console = []; UI.refresh(['console']); }
    });
    const log = el.querySelector('.consolelog'); log.scrollTop = log.scrollHeight;
  },
};

// ---------- Code: the workbench's own source ----------
V.code = {
  title: 'Code', on: ['code'],
  render(el, { wb }) {
    const s = S(), files = wb.source.files();
    if (s.file) {
      const text = (G.WB_SOURCES || {})[s.file.path];
      if (text === undefined) { s.file = null; return V.code.render(el, { wb }); }
      const lines = text.split('\n');
      el.innerHTML = `<div class="tabbody col"><div class="toolbar"><button class="btn sm" data-back>← Code</button><span class="lbl mono">${esc(s.file.path)}</span><span class="sp"></span><span class="dim">${lines.length} lines</span></div><div class="scroll filescroll"><div class="irtext csrc">${lines.map((l, i) => `<div class="${i + 1 === s.file.line ? 'hl' : ''}" id="fl-${i + 1}"><span class="cm">${String(i + 1).padStart(4)}  </span>${UI.highlight(l, /\.(js|mjs)$/.test(s.file.path) ? 'js' : 'text')}</div>`).join('')}</div></div></div>`;
      el.querySelector('[data-back]').onclick = () => { s.file = null; V.code.render(el, { wb }); };
      const target = el.querySelector('#fl-' + s.file.line); if (target) target.scrollIntoView({ block: 'center' });
      return;
    }
    const q = s.grep || '';
    const hits = q.length > 1 ? wb.source.grep(q, { limit: 80 }) : null;
    const groups = new Map(); for (const f of files) { const dir = f.path.split('/').slice(0, -1).join('/') || '.'; if (!groups.has(dir)) groups.set(dir, []); groups.get(dir).push(f); }
    el.innerHTML = `<div class="tabbody col"><div class="toolbar"><input class="filter" placeholder="Search the workbench's source" value="${esc(q)}" data-grep></div><div class="scroll">${hits ? `<table class="rt grep">${hits.map(h => `<tr class="clickable" data-open="${esc(h.file)}" data-line="${h.line}"><td class="mono dim">${esc(h.file.split('/').pop())}:${h.line}</td><td class="mono">${esc(h.text)}</td></tr>`).join('') || '<tr><td class="dim">no matches</td></tr>'}</table>` :
      [...groups].map(([dir, fs]) => `<div class="grp">${esc(dir)}</div>` + fs.map(f => `<button class="pitem" data-open="${esc(f.path)}"><b class="mono">${esc(f.path.split('/').pop())}</b><small>${f.lines} lines · ${esc(f.about)}</small></button>`).join('')).join('')}</div></div>`;
    const g = el.querySelector('[data-grep]');
    g.oninput = () => { s.grep = g.value; const pos = g.selectionStart; V.code.render(el, { wb }); const h = el.querySelector('[data-grep]'); h.focus(); h.setSelectionRange(pos, pos); };
    el.onclick = e => { const o = e.target.closest('[data-open]'); if (o) { s.file = { path: o.dataset.open, line: +o.dataset.line || 1 }; V.code.render(el, { wb }); } };
  },
};

// ---------- Book ----------
UI.renderBook = function renderBook(el) {
  const s = S(), book = G.WB_BOOK || [];
  const i = Math.max(0, book.findIndex(c => c.id === s.chapter)), ch = book[i];
  if (!ch) { el.innerHTML = '<p class="empty padded">No book loaded.</p>'; return; }
  el.innerHTML = `<div class="bookview"><nav class="bcontents${s.bopen ? ' open' : ''}"><div class="btitle"><b>Inside the Compiler Workbench</b><small>${book.length} chapters · every number measured</small></div>${book.map((c, k) => `${c.part && (k === 0 || book[k - 1].part !== c.part) ? `<div class="grp">${esc(c.part)}</div>` : ''}<button class="${k === i ? 'on' : ''}" data-ch="${esc(c.id)}"><span class="bn">${k + 1}</span><span class="bt">${esc(c.title)}</span></button>`).join('')}</nav>
    <div class="bmain"><div class="toolbar"><button class="btn sm bcbtn" data-bc>Contents</button><span class="ntitle"><span class="pcode">Chapter ${i + 1}</span> ${esc(ch.title)}</span><span class="sp"></span>${ch.projects ? ch.projects.map(id => `<button class="btn sm" data-link="project:${esc(id)}">Open ${esc(id)}</button>`).join('') : ''}</div>
    <div class="scroll" data-bscroll><div class="bchlabel doc">Chapter ${i + 1}${ch.part ? ` <em>· ${esc(ch.part)}</em>` : ''}</div><div class="doc">${UI.md(ch.md, { runnable: true, chapterN: i + 1, ids: true })}</div>
    <div class="bnav doc">${i > 0 ? `<button data-ch="${esc(book[i - 1].id)}"><small>Previous</small><b>${esc(book[i - 1].title)}</b></button>` : '<span></span>'}${i + 1 < book.length ? `<button class="nx" data-ch="${esc(book[i + 1].id)}"><small>Next</small><b>${esc(book[i + 1].title)}</b></button>` : ''}</div></div></div></div>`;
  el.onclick = e => {
    const c = e.target.closest('[data-ch]'); if (c) { s.chapter = c.dataset.ch; s.bopen = false; UI.store.set('wb.chapter', s.chapter); UI.renderBook(el); el.querySelector('[data-bscroll]').scrollTop = 0; try { history.replaceState(null, '', '#book-' + s.chapter); } catch { /* sandboxed */ } return; }
    if (e.target.closest('[data-bc]')) { s.bopen = !s.bopen; el.querySelector('.bcontents').classList.toggle('open', s.bopen); }
  };
  if (s.section) { const t = el.querySelector('#h-' + s.section); if (t) t.scrollIntoView(); s.section = null; }
};
V.book = { title: 'Book', on: ['book'], render(el) { UI.renderBook(el); } };
UI.views.book = V.book;

// ---------- Reference ----------
UI.referenceText = function referenceText(topic) {
  const ref = G.WB_REFERENCE || '';
  if (!topic) return ref.split('\n').filter(l => /^#{2,3} /.test(l)).map(l => l.replace(/^#+ /, '')).join('\n') + '\n\nwb.help(topic) prints one section; topics are the headings above (any word of them).';
  const parts = ref.split(/^(?=## )/m);
  const hit = parts.find(s => s.split('\n')[0].toLowerCase().includes(String(topic).toLowerCase()));
  return hit || `no section about "${topic}"; wb.help() lists them`;
};
V.reference = {
  title: 'Reference', on: [],
  render(el) { el.innerHTML = `<div class="tabbody col"><div class="scroll"><div class="doc">${UI.md(G.WB_REFERENCE || '', { runnable: true })}</div></div></div>`; },
};
})(globalThis);
