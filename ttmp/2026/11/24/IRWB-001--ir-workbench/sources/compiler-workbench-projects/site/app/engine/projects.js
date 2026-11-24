// projects.js: a project is a set of plain files.
//   project.json      title, about, group, sources (order), inputs, pipeline, scripts, ui, chapter, try
//   *.typed           typed source; all of them compile together, in the order project.json gives
//   scripts/*.js      workbench scripts: the body of a function with wb, p, project, args, param, log in scope
//   ui/*.js           UI scripts: the body of a function with ui, wb, p, project in scope; returns tiles
//   notes.md          notes, shown under the source
// Built-in projects ship with the page. Your edits to one are kept in this browser as an overlay
// (reset brings the original back); projects you make are kept whole.
(function (G) {
'use strict';
const WB = G.WB;
const KEY = 'wb.projects.v1';
const kindOf = path => /\.typed$/.test(path) ? 'typed' : /^scripts\/.+\.js$/.test(path) ? 'script' : /^ui\/.+\.js$/.test(path) ? 'ui' : path === 'project.json' ? 'meta' : /\.md$/.test(path) ? 'notes' : /\.json$/.test(path) ? 'json' : 'file';
WB.fileKind = kindOf;
const nameOf = path => path.replace(/^.*\//, '').replace(/\.js$/, '');
const SCOPE = ['wb', 'p', 'project', 'args', 'param', 'log', 'yaml'];

// Compile a script body. Plain bodies run synchronously; a body that uses await runs as async.
const compiled = new Map();
WB.compileBody = function compileBody(body, names, label) {
  const key = names.join(',') + '\n' + body;
  if (compiled.has(key)) return compiled.get(key);
  let fn;
  try { fn = new Function(...names, '"use strict";\n' + body + '\n//# sourceURL=' + label); }
  catch (e) {
    if (!/await/.test(String(e.message)) && !/\bawait\b/.test(body)) throw new WB.WorkbenchError('scriptSyntax', `${label}: ${e.message}`, { fix: 'a script is the body of a function: statements, then return a value' });
    try { const A = Object.getPrototypeOf(async function () {}).constructor; fn = new A(...names, '"use strict";\n' + body + '\n//# sourceURL=' + label); }
    catch (e2) { throw new WB.WorkbenchError('scriptSyntax', `${label}: ${e2.message}`, { fix: 'a script is the body of a function: statements, then return a value' }); }
  }
  compiled.set(key, fn);
  return fn;
};

WB.makeProjects = function makeProjects(env) {
  const { state, emit, writes, storage, programHandle } = env;
  const builtins = new Map((env.config.projects || []).map(x => [x.id, x]));
  let saved = {};
  try { saved = JSON.parse((storage && storage.get(KEY)) || '{}') || {}; } catch { saved = {}; }
  const persist = () => { if (storage) storage.set(KEY, JSON.stringify(saved)); };
  const ids = () => [...new Set([...builtins.keys(), ...Object.keys(saved).filter(id => saved[id].user)])];
  const exists = id => builtins.has(id) || (saved[id] && saved[id].user);
  const need = id => {
    if (!exists(id)) WB.fail('unknownProject', `no project "${id}".` + (WB.didYouMean(id, ids()) ? ` Did you mean "${WB.didYouMean(id, ids())}"?` : ''), { fix: 'wb.projects.list() shows them' });
  };
  // the files of a project: the original, with this browser's edits laid over it
  function filesOf(id) {
    const base = builtins.has(id) ? { ...builtins.get(id).files } : {};
    const over = (saved[id] && saved[id].files) || {};
    for (const [path, text] of Object.entries(over)) { if (text === null) delete base[path]; else base[path] = text; }
    return base;
  }
  function metaOf(id) {
    const files = filesOf(id);
    let m = {};
    if (files['project.json']) { try { m = JSON.parse(files['project.json']); } catch (e) { m = { _error: e.message }; } }
    const typed = Object.keys(files).filter(f => kindOf(f) === 'typed').sort();
    const sources = (Array.isArray(m.sources) ? m.sources.filter(f => files[f] !== undefined) : []).concat(typed.filter(f => !(m.sources || []).includes(f)));
    return { title: id, about: '', group: 'Mine', pipeline: 'O2', inputs: {}, scripts: {}, ui: {}, ...m, sources };
  }

  // one compiled program per project, rebuilt when its typed files change
  const programs = new Map();
  function build(id, name) {
    const meta = metaOf(id), files = filesOf(id);
    let text = '', line = 1;
    const fileMap = [];
    for (const f of meta.sources) {
      let t = files[f];
      if (!t.endsWith('\n')) t += '\n';
      const n = t.split('\n').length - 1;
      fileMap.push({ file: f, start: line, lines: n });
      text += t; line += n;
    }
    const q = new WB.Program(name || id.replace(/-/g, '_'), text);
    q.fileMap = fileMap; q.project = id; q.inputs = meta.inputs || {};
    if (name) q._scratch = true;   // a fresh copy: scripts and queries may change it freely
    if (q.error && q.error.line) { const at = WB.locateLine(q, q.error.line); q.error.file = at.file; q.error.fileLine = at.line; }
    return q;
  }
  const sigOf = id => WB.hash(metaOf(id).sources.map(f => f + '\n' + filesOf(id)[f]).join('\u0000'));
  const textOf = id => { const f = filesOf(id); return metaOf(id).sources.map(x => f[x].endsWith('\n') ? f[x] : f[x] + '\n').join(''); };
  function programFor(id, { rebuild = false } = {}) {
    const sig = sigOf(id);
    let e = programs.get(id);
    if (!e || e.sig !== sig || rebuild) {
      e = { sig, q: build(id) };
      programs.set(id, e);
      state.programs.set(e.q.name, e.q);
      if (state.current && state.current.project === id) { state.current = e.q; emit('program', { program: e.q.name, why: 'source', project: id }); }
    }
    return e.q;
  }

  // ---------- scripts ----------
  function runScript(id, name, args = {}, opts = {}) {
    const files = filesOf(id), path = `scripts/${name}.js`;
    if (files[path] === undefined) {
      const names = Object.keys(files).filter(f => kindOf(f) === 'script').map(nameOf);
      WB.fail('unknownScript', `project "${id}" has no script "${name}".` + (WB.didYouMean(name, names) ? ` Did you mean "${WB.didYouMean(name, names)}"?` : ''), { fix: `scripts: ${names.join(', ') || 'none yet: add scripts/<name>.js'}` });
    }
    const meta = metaOf(id), conf = (meta.scripts || {})[name] || {};
    const fn = WB.compileBody(files[path], SCOPE, `${id}/${path}`);
    const q = conf.fresh || opts.fresh ? build(id, `${id.replace(/-/g, '_')}_fresh`) : programFor(id);
    const logs = opts.logs || [];
    const out = fn(env.api(), programHandle(q), handle(id), args, env.api().param, x => { logs.push(typeof x === 'string' ? x : WB.toYaml(x)); }, WB.toYaml);
    return out;
  }

  // ---------- the handle a script, the console or the agent gets ----------
  const handles = new Map();
  function handle(id) {
    need(id);
    if (handles.has(id)) return handles.get(id);
    const H = {
      get id() { return id; },
      get title() { return metaOf(id).title; }, get about() { return metaOf(id).about; }, get group() { return metaOf(id).group; },
      get meta() { const m = metaOf(id); return JSON.parse(JSON.stringify(m)); },
      get builtin() { return builtins.has(id); },
      get program() { return programHandle(programFor(id)); },
      fresh() { return programHandle(build(id, `${id.replace(/-/g, '_')}_fresh`)); },
      sources() { return metaOf(id).sources.slice(); },
      files: WB.guard('Files', {
        list() { const f = filesOf(id), over = (saved[id] && saved[id].files) || {}; return Object.keys(f).sort(sortFiles).map(path => ({ path, kind: kindOf(path), lines: f[path].split('\n').length, ...(builtins.has(id) && path in over ? { edited: true } : {}) })); },
        read(path) { const f = filesOf(id); if (f[path] === undefined) WB.fail('unknownFile', `project "${id}" has no file "${path}".` + (WB.didYouMean(path, Object.keys(f)) ? ` Did you mean "${WB.didYouMean(path, Object.keys(f))}"?` : ''), { fix: `files: ${Object.keys(f).sort(sortFiles).join(', ')}` }); return f[path]; },
        write(path, text) {
          writes('project.files.write');
          if (typeof path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(path) || path.includes('..')) WB.fail('badPath', `"${path}" is not a file path: letters, digits, _ . / -`, { fix: "kernels.typed, scripts/report.js, ui/dashboard.js, notes.md" });
          if (typeof text !== 'string') WB.fail('badArgument', 'write(path, text): text is a string');
          if (path === 'project.json') { try { JSON.parse(text); } catch (e) { WB.fail('badJson', `project.json does not parse: ${e.message}`); } }
          if (/\.js$/.test(path)) WB.compileBody(text, kindOf(path) === 'ui' ? ['ui', 'wb', 'p', 'project', 'param'] : SCOPE, `${id}/${path}`);
          const s = saved[id] = saved[id] || { files: {} };
          s.files = s.files || {}; s.files[path] = text; persist();
          emit('files', { project: id, path, kind: kindOf(path) });
          if (kindOf(path) === 'typed' || path === 'project.json') programFor(id);
          return { written: path, lines: text.split('\n').length };
        },
        remove(path) {
          writes('project.files.remove');
          H.files.read(path);
          const s = saved[id] = saved[id] || { files: {} };
          s.files = s.files || {};
          if (builtins.has(id) && builtins.get(id).files[path] !== undefined) s.files[path] = null; else delete s.files[path];
          persist(); emit('files', { project: id, path, kind: kindOf(path), removed: true });
          if (kindOf(path) === 'typed') programFor(id);
          return { removed: path };
        },
        rename(from, to) { const t = H.files.read(from); H.files.write(to, t); H.files.remove(from); return { renamed: from, to }; },
      }),
      scripts() { const f = filesOf(id), m = metaOf(id); return Object.keys(f).filter(p => kindOf(p) === 'script').sort().map(p => ({ name: nameOf(p), path: p, about: ((m.scripts || {})[nameOf(p)] || {}).about || firstComment(f[p]) })); },
      // in the order project.json's ui.order gives (a script that registers a component or a fragment
      // goes before the ones that use it), then by name
      uiScripts() {
        const f = filesOf(id), m = metaOf(id), off = new Set((m.ui && m.ui.off) || []), en = saved[id] && saved[id].uiOff, first = (m.ui && m.ui.order) || [];
        const rank = p => { const i = first.indexOf(nameOf(p)); return i < 0 ? first.length : i; };
        return Object.keys(f).filter(p => kindOf(p) === 'ui').sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)).map(p => ({ name: nameOf(p), path: p, on: en ? !en.includes(nameOf(p)) : !off.has(nameOf(p)), about: firstComment(f[p]) }));
      },
      setUi(name, on) {
        const s = saved[id] = saved[id] || { files: {} };
        const off = new Set(s.uiOff || ((metaOf(id).ui && metaOf(id).ui.off) || []));
        if (on) off.delete(name); else off.add(name);
        s.uiOff = [...off]; persist(); emit('ui', { project: id, name, on });
        return { ui: name, on };
      },
      run(name, args = {}, opts = {}) { return runScript(id, name, args, opts); },
      reset() {
        writes('project.reset');
        if (!builtins.has(id)) WB.fail('notBuiltin', `"${id}" is your own project; there is no original to go back to`);
        delete saved[id]; persist(); programs.delete(id); emit('files', { project: id, reset: true }); programFor(id);
        return { reset: id };
      },
      export() { return JSON.stringify({ id, files: filesOf(id) }, null, 2); },
      describe() {
        const m = metaOf(id), q = programFor(id);
        return { id, title: m.title, group: m.group, about: m.about, builtin: builtins.has(id), sources: m.sources, status: q.status, ...(q.error ? { error: q.error } : {}), fns: q.status === 'ok' ? [...q.fns.keys()] : [], scripts: H.scripts().map(s => s.name), ui: H.uiScripts().map(u => u.name + (u.on ? '' : ' (off)')) };
      },
      _describe() { return H.describe(); },
    };
    const g = WB.guard('Project', H);
    handles.set(id, g);
    return g;
  }
  // what a script is about: its leading comment, up to the end of the first sentence
  const firstComment = text => {
    const lead = [];
    for (const line of text.split('\n')) { const m = line.match(/^\s*\/\/\s?(.*)$/); if (!m) break; lead.push(m[1].trim()); }
    const all = lead.join(' ').trim(), end = all.search(/[.!?](\s|$)/);
    const first = end >= 0 ? all.slice(0, end + 1) : all;
    return first.length > 160 ? first.slice(0, 157) + '…' : first;
  };
  const ORDER = { meta: 0, notes: 1, typed: 2, script: 3, ui: 4, json: 5, file: 6 };
  function sortFiles(a, b) { return (ORDER[kindOf(a)] - ORDER[kindOf(b)]) || a.localeCompare(b); }

  // ---------- wb.projects ----------
  const api = {
    list(filter = {}) {
      return ids().map(id => ({ id, ...metaOf(id) })).filter(x => (!filter.group || x.group === filter.group) && (!filter.text || (x.title + ' ' + x.about + ' ' + x.id).toLowerCase().includes(String(filter.text).toLowerCase())))
        .map(x => ({ id: x.id, title: x.title, group: x.group, about: x.about, ui: Object.keys(filesOf(x.id)).filter(f => kindOf(f) === 'ui').length, ...(builtins.has(x.id) ? {} : { mine: true }), ...(builtins.has(x.id) && saved[x.id] && saved[x.id].files && Object.keys(saved[x.id].files).length ? { edited: true } : {}) }));
    },
    groups() { const g = {}; for (const x of api.list()) g[x.group] = (g[x.group] || 0) + 1; return g; },
    get(id) { return handle(id); },
    open(id) {
      need(id);
      const q = programFor(id);
      if (state.projectId !== id) state.paramValues = {};   // parameters belong to a project
      state.current = q; state.projectId = id; state.focus = null;
      state.paramDefs = new Map();
      emit('program', { program: q.name, why: 'project', project: id });
      return handle(id);
    },
    get current() { return state.projectId && exists(state.projectId) ? handle(state.projectId) : null; },
    create(id, opts = {}) {
      writes('projects.create');
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) WB.fail('badProject', `project ids are lower-case words joined by dashes, not "${id}"`, { fix: "wb.projects.create('my-loops', { title: 'My loops' })" });
      if (exists(id)) WB.fail('duplicateProject', `a project "${id}" exists`, { fix: `wb.projects.get('${id}').files.write(...) changes it; pick another id for a new one` });
      const files = opts.files || {
        'project.json': JSON.stringify({ title: opts.title || id, about: opts.about || '', group: opts.group || 'Mine', pipeline: 'O2' }, null, 2) + '\n',
        'main.typed': opts.source || 'function f(x: i32): i32 {\n    return x * 8 + 1;\n}\n',
        'scripts/explore.js': "// O2 on the program, and what it changed\np.pipeline('O2');\nreturn { revisions: p.revisions().length - 1, listing: p.listing() };\n",
        'notes.md': '',
      };
      if (!files['project.json']) files['project.json'] = JSON.stringify({ title: opts.title || id, group: opts.group || 'Mine' }, null, 2) + '\n';
      try { JSON.parse(files['project.json']); } catch (e) { WB.fail('badJson', `project.json does not parse: ${e.message}`); }
      for (const [path, text] of Object.entries(files)) if (/\.js$/.test(path)) WB.compileBody(text, kindOf(path) === 'ui' ? ['ui', 'wb', 'p', 'project', 'param'] : SCOPE, `${id}/${path}`);
      saved[id] = { user: true, files: { ...files }, created: new Date().toISOString() };
      persist(); emit('projects', { created: id });
      const q = programFor(id);
      return { created: id, status: q.status, ...(q.error ? { error: q.error } : {}), note: 'kept in this browser; wb.projects.open(id) opens it' };
    },
    duplicate(id, newId, opts = {}) { need(id); return api.create(newId, { files: { ...filesOf(id), 'project.json': JSON.stringify({ ...JSON.parse(filesOf(id)['project.json'] || '{}'), title: opts.title || `${metaOf(id).title} (copy)`, group: 'Mine' }, null, 2) + '\n' } }); },
    remove(id) {
      writes('projects.remove');
      need(id);
      if (builtins.has(id)) WB.fail('builtinProject', `"${id}" is built in; reset() discards your edits to it`);
      delete saved[id]; programs.delete(id); persist(); emit('projects', { removed: id });
      return { removed: id };
    },
    import(json) {
      writes('projects.import');
      const x = typeof json === 'string' ? JSON.parse(json) : json;
      if (!x || !x.id || !x.files) WB.fail('badProject', 'import wants { id, files: { path: text } }');
      let id = x.id; while (exists(id)) id = id.replace(/(-\d+)?$/, m => '-' + ((+(m || '-1').slice(1)) + 1));
      return api.create(id, { files: x.files });
    },
    _files: filesOf, _meta: metaOf, _program: programFor, _saved: () => saved,
    // back to a snapshot of the files; a program whose sources no longer match is rebuilt on demand,
    // and a program from the snapshot whose sources match again is adopted, so p stays the same object
    _restore(s, keep = []) {
      saved = JSON.parse(s); persist();
      for (const [id, e] of [...programs]) if (!exists(id) || e.sig !== sigOf(id)) programs.delete(id);
      for (const q of keep) if (q && q.project && exists(q.project) && !q._scratch && textOf(q.project) === q.source) programs.set(q.project, { sig: sigOf(q.project), q });
      emit('projects', { restored: true });
    },
  };
  return api;
};

// a global line of the concatenated source, as a file and a line in it
WB.locateLine = function locateLine(p, line) {
  const m = p.fileMap || [];
  for (const f of m) if (line >= f.start && line < f.start + f.lines) return { file: f.file, line: line - f.start + 1 };
  return { file: m.length ? m[m.length - 1].file : 'main.typed', line };
};
})(globalThis);
