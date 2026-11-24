// api.js: the workbench root, `wb`. Everything a person types in the console, a project's script
// runs, or the agent's eval() reaches goes through this object: programs and their handles,
// projects (projects.js), the pass manager's builders, parameters, fragments, images, views, the
// book, and the workbench's own source. Handles are guarded proxies; changes go through passes only.
(function (G) {
'use strict';
const WB = G.WB;

const PIPELINES = {
  O0: [],
  O1: ['cfg', 'fold', 'simplify', 'constprop', 'fold', 'simplify', 'dce', 'cfg'],
  O2: ['cfg', 'fold', 'simplify', 'constprop', 'fold', 'simplify', 'dce', 'cfg', 'licm', 'lvn', 'strength', 'bce', 'subst', 'subst', 'dce', 'cfg'],
  loops: ['cfg', 'simplify', 'licm', 'lvn', 'subst', 'dce', 'cfg'],
  checks: ['cfg', 'simplify', 'bce', 'cfg'],
  broken: ['div-to-shift'],
};
WB.PIPELINES = PIPELINES;

WB.createWorkbench = function createWorkbench(config = {}) {
  const storage = config.storage || null; // { get(key), set(key, value) }
  const listeners = new Map();
  const state = {
    programs: new Map(), current: null, focus: null, readOnly: false,
    projectId: null, paramDefs: new Map(), paramValues: {}, logs: [],
    references: config.references || {},
  };
  const emit = (event, data) => { for (const fn of listeners.get(event) || []) try { fn(data); } catch (e) { console.error(e); } for (const fn of listeners.get('*') || []) try { fn(event, data); } catch (e) { console.error(e); } };
  const writes = (what, q) => { if (state.readOnly && !(q && q._scratch)) WB.fail('readOnly', `read-only mode: ${what}() is off`, { fix: 'switch the agent to Ask or Auto to let it change programs or project files' }); };

  // ---------- program handles ----------
  const handles = new WeakMap();
  function programHandle(p) {
    if (handles.has(p)) return handles.get(p);
    const requireOk = () => { if (p.status !== 'ok') WB.fail('frontEndError', `${p.id} did not pass the front end` + (p.error && p.error.line ? ` (line ${p.error.line}:${p.error.col})` : '') + `: ${p.error && p.error.message}`, { fix: 'fix the source, then p.edit(source)' }); };
    const fname = name => { requireOk(); if (name === undefined) return [...p.fns.keys()][0]; p.fn(name); return name; };
    const changed = (what, r) => { emit('revision', { program: p.name, what, rev: p.rev, result: r }); return r; };
    const P = {
      get id() { return p.id; }, get name() { return p.name; }, get source() { return p.source; },
      get status() { return p.status; }, get error() { return p.error ? { ...p.error } : null; },
      get rev() { return `r${p.rev}`; }, get inputs() { return JSON.parse(JSON.stringify(p.inputs || {})); },
      get project() { return p.project || null; },
      files() { return (p.fileMap || []).map(f => ({ ...f })); },
      locate(line) { return WB.locateLine(p, line); },
      where(id) { return WB.linesOf(p, id).map(n => { const at = WB.locateLine(p, n); return `${at.file}:${at.line}`; }); },
      fns() { return [...p.fns.keys()]; },
      fn(name) { return WB.handle(p, `fn:${fname(name)}`); },
      get(id) { return WB.handle(p, id); },
      has(id) { return p.store.has(id); },
      describe() {
        if (p.status !== 'ok') return { id: p.id, status: p.status, error: p.error };
        return { id: p.id, status: p.status, rev: `r${p.rev}`, project: p.project || null, files: (p.fileMap || []).map(f => f.file),
          fns: [...p.fns.values()].map(f => ({ name: f.name, signature: `${f.name}(${f.params.map((t, i) => `${f.locals[i].name}: ${t}`).join(', ')}): ${f.result}`, blocks: f.blocks.length, stmts: f.blocks.reduce((n, b) => n + b.stmts.length, 0), locals: f.locals.length })),
          revisions: p.revisions.length, image: p._image || null };
      },
      listing(name) { requireOk(); return WB.listing(p, name); },
      // ---- the pass manager ----
      apply(pass, opts = {}) { writes('apply', p); requireOk(); return changed('apply', WB.applyPass(p, pass, opts)); },
      dryRun(pass) { requireOk(); return WB.dryRun(p, pass); },
      actions() {
        requireOk();
        return [...WB.passes.keys()].filter(n => n !== 'div-to-shift').map(n => WB.dryRun(p, n)).filter(r => r.edits > 0).map(r => ({ pass: r.pass, edits: r.edits, kinds: r.kinds }));
      },
      pipeline(x = 'O2', opts = {}) {
        writes('pipeline', p); requireOk();
        let plan;
        if (typeof x === 'string') {
          if (!PIPELINES[x]) WB.fail('unknownPipeline', `no pipeline "${x}".` + (WB.didYouMean(x, Object.keys(PIPELINES)) ? ` Did you mean "${WB.didYouMean(x, Object.keys(PIPELINES))}"?` : ''), { fix: `pipelines: ${Object.keys(PIPELINES).join(', ')}, or a list of pass names` });
          x = PIPELINES[x];
        }
        if (Array.isArray(x)) { const b = WB.pipelineBuilder(opts.name || 'adhoc'); for (const s of x) b.pipe(s); if (opts.checkEach !== false) b.checkEach(true, { count: opts.count || 40 }); plan = b.build(); }
        else plan = typeof x === 'object' && x && 'build' in x ? x.build() : x;
        const r = plan.run(p, { enabled: opts.enabled || null });
        return changed('pipeline', { ...r, steps: r.steps.map(s => ({ pass: s.pass, rev: s.rev, edits: s.edits, ...(s.skipped ? { skipped: true } : {}), ...(s.check ? { check: s.check.map(c => `${c.fn} ${c.agree}/${c.total}`).join(', ') } : {}) })) });
      },
      undo() { writes('undo', p); return changed('undo', `r${p.undo()}`); },
      checkout(rev) { writes('checkout', p); const n = typeof rev === 'string' ? +rev.replace(/^r/, '') : rev; return changed('checkout', `r${p.checkout(n)}`); },
      revisions() { return p.revisions.map(r => ({ rev: `r${r.rev}`, pass: r.pass, edits: r.edits.length, ms: r.ms, ...(r.note ? { note: r.note } : {}), ...(r.fns ? { fns: r.fns } : {}) })); },
      edits(rev) { const n = typeof rev === 'string' ? +rev.replace(/^r/, '') : (rev ?? p.rev); const r = p.revisions[n]; if (!r) WB.fail('noRevision', `${p.id} has r0 to r${p.rev}`); return r.edits.map(e => ({ ...e })); },
      diff(a = 0, b = p.rev) {
        const n = x => typeof x === 'string' ? +x.replace(/^r/, '') : x;
        return p.revisions.slice(n(a) + 1, n(b) + 1).flatMap(r => r.edits.map(e => ({ id: e.id, pass: e.pass, fn: e.fn, kind: e.kind, ...(e.stmt ? { stmt: e.stmt } : {}), ...(e.from ? { from: e.from } : {}), ...(e.to ? { to: e.to } : {}), ...(e.note ? { note: e.note } : {}) })));
      },
      edit(source) {
        writes('edit', p);
        if (p.project) WB.fail('useProjectFiles', `${p.id} belongs to project "${p.project}": edit its files instead`, { fix: `project.files.write('${(p.fileMap && p.fileMap[0] && p.fileMap[0].file) || 'main.typed'}', source)` });
        const q = new WB.Program(p.name, source);
        q.inputs = p.inputs;
        state.programs.set(p.name, q);
        if (state.current === p) state.current = q;
        emit('program', { program: q.name, why: 'edit' });
        return programHandle(q);
      },
      // ---- facts ----
      facts() { return [...p.facts.values()].map(f => ({ id: f.id, status: f.status, ms: f.ms, visits: f.visits, ...(f.staleBy ? { staleBy: f.staleBy, staleAt: `r${f.staleAt}` } : {}) })); },
      fact(name, fn) { return P.fn(fn).fact(name); },
      // ---- provenance ----
      why(id) { return WB.why(p, id); }, lineage(id) { return WB.lineage(p, id); },
      lines(id) { return WB.linesOf(p, id); }, related(id) { return WB.related(p, id); },
      statusOf(id) { return p.statusOf(id); },
      text(id) { return WB.describeText(p, id); },
      // ---- runs and checks ----
      cases(fn, opts = {}) { const f = fname(fn); return WB.cases.from(p, f, { count: 20, ...opts, inputs: { ...((p.inputs || {})[f] || {}), ...(opts.inputs || {}) } }).map(c => ({ n: c.n, args: c.args, items: c.items })); },
      exec(fn, args = [], opts = {}) {
        const f = fname(fn), F = p.fn(f);
        const bench = {};
        const list = Array.isArray(args) ? args : F.params.map((_, i) => args[F.locals[i].name]);
        F.params.forEach((t, i) => { bench[F.locals[i].name] = argSpec(p, t, list[i]); });
        const c = WB.cases.bench(p, f, bench);
        const engine = opts.engine || (opts.image ? 'rv32' : 'evaluator');
        let r;
        if (engine === 'rv32') { const img = opts.image ? imageEnt(opts.image) : imageEnt(P.compile().id); r = WB.runImage(img, f, c.args, c.memory, { limit: opts.limit || 5e6 }); }
        else r = WB.evaluate(p, f, c.args, c.memory, { limit: opts.limit || 5e6, counts: !!opts.counts });
        const out = { kind: 'run', engine: r.engine, fn: f, args: c.args, result: r.result, trap: r.trap, steps: r.steps, unit: r.unit };
        if (r.fault) out.fault = true;
        if (r.bytes) out.buffers = c.items.filter(x => x.kind === 'buffer').map(x => ({ name: x.name, at: x.at, cells: WB.readBuffer(r.bytes, x.at).slice(0, 64) }));
        if (opts.counts && r.counts) out.counts = r.counts instanceof Map ? Object.fromEntries(r.counts) : r.counts;
        emit('run', { program: p.name, run: out });
        return out;
      },
      check(opts = {}) {
        requireOk();
        const fns = opts.fn ? [fname(opts.fn)] : [...p.fns.keys()];
        const img = opts.against === 'image' ? imageEnt(opts.image || P.compile().id) : null;
        const rows = fns.map(f => {
          const cases = WB.cases.from(p, f, { count: opts.count || 100, seed: opts.seed || 7, inputs: { ...((p.inputs || {})[f] || {}), ...(opts.inputs || {}) } });
          if (opts.against === 'reference') {
            const ref = referenceImage(p);
            if (!ref) WB.fail('noReference', `${p.id} has no reference image (only built-in projects, unedited, carry one)`, { fix: "check against 'r0' or 'image'" });
            for (const c of cases) c.reference = WB.runImage(ref, f, c.args, c.memory);
          }
          const c = WB.check(p, { fn: f, cases, against: opts.against || 'r0', image: img });
          return { fn: f, against: c.against === 'image' ? img.id : c.against, rev: c.rev, agree: c.agree, total: c.total, status: c.status, bothTrap: c.bothTrap, inconclusive: c.inconclusive, counterexamples: c.counterexamples };
        });
        const out = { kind: 'check', program: p.id, rev: `r${p.rev}`, status: rows.every(r => r.status !== 'disagree') ? 'agree' : 'disagree', fns: rows };
        emit('check', { program: p.name, check: out });
        return out;
      },
      // ---- the backend ----
      compile(opts = {}) {
        requireOk();
        const { rev, ...o } = opts;
        const n = rev === undefined ? p.rev : typeof rev === 'string' ? +rev.replace(/^r/, '') : rev;
        const img = WB.compile(p, o, n);
        emit('image', { program: p.name, image: img.id });
        return imageHandle(p, img);
      },
      // two revisions (or two option sets) compiled and compared, instruction by instruction
      asmDiff(a = 'r0', b = undefined, opts = {}) {
        requireOk();
        const { fn, optionsA, optionsB, cases = 12, ...common } = opts;
        const f = fname(fn);
        const rv = x => x === undefined ? p.rev : typeof x === 'string' ? +x.replace(/^r/, '') : x;
        const A = WB.compile(p, { ...common, ...(optionsA || {}) }, rv(a)), B = WB.compile(p, { ...common, ...(optionsB || {}) }, rv(b));
        const d = WB.diffImages(p, A, B, f);
        const cs = WB.cases.from(p, f, { count: cases, seed: 11, inputs: (p.inputs || {})[f] || {} });
        // count only cases both images finish within the limit, so the two totals compare
        const sa = { steps: 0, runs: 0 }, sb = { steps: 0, runs: 0 };
        for (const c of cs) {
          const ra = WB.runImage(A, f, c.args, c.memory, { limit: 5e4 });
          if (ra.limit || ra.fault) continue;
          const rb = A === B ? ra : WB.runImage(B, f, c.args, c.memory, { limit: 5e4 });
          if (rb.limit || rb.fault) continue;
          sa.steps += ra.steps; sa.runs++; sb.steps += rb.steps; sb.runs++;
        }
        return {
          kind: 'asmDiff', fn: f, a: { image: A.id, rev: `r${A.rev}`, bytes: A.fns[f].bytes, frame: A.fns[f].frame, spills: A.fns[f].spills, saved: A.fns[f].saved, instructionsRun: sa.steps },
          b: { image: B.id, rev: `r${B.rev}`, bytes: B.fns[f].bytes, frame: B.fns[f].frame, spills: B.fns[f].spills, saved: B.fns[f].saved, instructionsRun: sb.steps },
          cases: sa.runs, same: d.same, removed: d.removed, added: d.added,
          rows: d.rows.map(r => ({ op: r.op, a: r.a ? r.a.id : null, b: r.b ? r.b.id : null, text: (r.b || r.a).sym, covers: (r.b || r.a).covers.slice(-1)[0] || null })),
        };
      },
      image(id) { const iid = id || p._image; if (!iid) return null; return imageHandle(p, imageEnt(iid)); },
      images() { return [...p.store.ents.values()].filter(e => e.kind === 'image' && e.program === p.id).map(e => ({ id: e.id, rev: `r${e.rev}`, bytes: e.bytes, status: WB.imageStatus(p, e), options: diffOptions(e.options) })); },
      reference() { const ref = referenceImage(p); return ref ? { id: ref.id, bytes: ref.bytes, fns: ref.fns, note: 'compiled by compiler/typed-rv32.js (default policy) when the project was built; runs on the same emulator' } : null; },
      machine(fn, opts = {}) { return WB.machineCode(p, fname(fn), opts); },
      focus(id) { return api.focus(id, p); },
      _describe() { return P.describe(); },
      _p: p,
    };
    const imageEnt = id => { const e = p.store.get(typeof id === 'string' ? id : id.id); if (!e || e.kind !== 'image') WB.fail('absent', `no image ${id} in ${p.id}`, { fix: 'p.compile() makes one' }); return e; };
    const h = WB.guard('Program', P);
    handles.set(p, h);
    return h;
  }
  // a plain argument (number, array of cells, text, { field: n }, enum case name) as an input spec
  function argSpec(p, type, v) {
    const fe = p.fe || { records: {}, enums: {} };
    if (fe.enums[type] && typeof v === 'string') { if (!(v in fe.enums[type])) WB.fail('badArgument', `${type} has no case "${v}"`, { fix: `cases: ${Object.keys(fe.enums[type]).join(', ')}` }); return fe.enums[type][v]; }
    if (fe.records[type] && v && typeof v === 'object' && !Array.isArray(v) && !v.record) return { record: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, [x | 0, x | 0]])) };
    if (Array.isArray(v)) return { cells: v };
    if (typeof v === 'string') return { string: v };
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v ?? 0;
  }
  const diffOptions = o => Object.fromEntries(Object.entries(o).filter(([k, v]) => WB.backendDefaults[k] !== v));
  function referenceImage(p) {
    const r = p.project && state.references[p.project];
    if (!r || r.source !== WB.hash(p.source)) return null;
    if (!r._img) {
      const bin = typeof atob === 'function' ? atob(r.image) : Buffer.from(r.image, 'base64').toString('binary');
      const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      r._img = { id: `ref:${p.project}`, kind: 'reference', bytes: bytes.length, fns: r.fns, code: { image: bytes, entries: r.entries, relocations: [], imports: [] } };
    }
    return r._img;
  }
  function imageHandle(p, img) {
    const I = {
      get id() { return img.id; }, get rev() { return `r${img.rev}`; }, get bytes() { return img.bytes; },
      get status() { return WB.imageStatus(p, img); }, get options() { return { ...img.options }; },
      get fns() { return JSON.parse(JSON.stringify(img.fns)); }, get ms() { return img.ms; },
      insns(fn) { return img.insns.map(i => p.store.get(i)).filter(e => !fn || e.fn === fn).map(e => ({ id: e.id, offset: e.offset, text: e.text, sym: e.sym, covers: e.covers, lines: WB.linesOf(p, e.covers[0] || ''), ...(e.why ? { why: e.why } : {}) })); },
      listing(fn) {
        return img.insns.map(i => p.store.get(i)).filter(e => !fn || e.fn === fn).map(e => {
          const lines = WB.linesOf(p, e.covers[0] || '');
          return `${('0x' + e.offset.toString(16)).padStart(6)}  ${e.text.padEnd(24)} ${e.covers.slice(-1)[0] || ''}${lines.length ? ' line ' + lines.join(',') : ''}${e.why ? '  (' + e.why + ')' : ''}`;
        }).join('\n');
      },
      run(fn, args, opts = {}) { return programHandle(p).exec(fn, args, { ...opts, engine: 'rv32', image: img.id }); },
      check(opts = {}) { return programHandle(p).check({ ...opts, against: 'image', image: img.id }); },
      heat(fn, args) {
        const P = programHandle(p), f = fn || [...p.fns.keys()][0], F = p.fn(f), bench = {};
        const list = Array.isArray(args) ? args : [];
        F.params.forEach((t, i) => { bench[F.locals[i].name] = argSpec(p, t, list[i]); });
        const c = WB.cases.bench(p, f, bench), r = WB.runImage(img, f, c.args, c.memory, { limit: 5e6 });
        const h = WB.heat(p, img, r.counts);
        void P;
        return { steps: r.steps, result: r.result, trap: r.trap, byLine: Object.fromEntries([...h.byLine].sort((a, b) => a[0] - b[0])), hottest: h.byInsn.filter(x => x.n).sort((a, b) => b.n - a.n).slice(0, 8).map(x => ({ insn: x.id, text: p.store.get(x.id).text, n: x.n })) };
      },
      _describe() { return { id: img.id, rev: `r${img.rev}`, status: WB.imageStatus(p, img), bytes: img.bytes, fns: img.fns, options: diffOptions(img.options) }; },
      _img: img,
    };
    return WB.guard('Image', I);
  }

  // ---------- projects (projects.js) ----------
  const projects = WB.makeProjects({ state, emit, writes, storage, programHandle: q => programHandle(q), config, api: () => api });

  // ---------- parameters: sliders and toggles a script declares ----------
  const declare = (kind, name, opts) => {
    if (typeof name !== 'string' || !name) WB.fail('badArgument', 'a parameter needs a name');
    const def = { name, kind, ...opts };
    state.paramDefs.set(name, def);
    emit('params', [...state.paramDefs.values()]);
    const v = state.paramValues[name];
    return v === undefined ? def.default : v;
  };
  const param = WB.guard('Params', {
    int(name, { min = 0, max = 100, step = 1, default: d = min, about = '' } = {}) { return declare('int', name, { min, max, step, default: d, about }) | 0; },
    float(name, { min = 0, max = 1, step = 0.01, default: d = min, about = '' } = {}) { return +declare('float', name, { min, max, step, default: d, about }); },
    bool(name, { default: d = false, about = '' } = {}) { return !!declare('bool', name, { default: d, about }); },
    choice(name, options, { default: d = options[0], about = '' } = {}) { const v = declare('choice', name, { options, default: d, about }); return options.includes(v) ? v : d; },
    list() { return [...state.paramDefs.values()].map(d => ({ ...d, value: state.paramValues[d.name] ?? d.default })); },
    set(name, value) { state.paramValues[name] = value; emit('paramValue', { name, value }); return { [name]: value }; },
    reset() { state.paramValues = {}; emit('params', [...state.paramDefs.values()]); return 'reset'; },
  });

  // ---------- the book and the workbench's own source ----------
  const BOOK = config.book || [];
  const book = WB.guard('Book', {
    contents() { return BOOK.map((c, i) => ({ id: c.id, n: i + 1, title: c.title, sections: (c.md.match(/^## .*/gm) || []).map(s => s.slice(3)) })); },
    read(id, section) {
      const c = BOOK.find(x => x.id === id || x.title === id);
      if (!c) WB.fail('unknownChapter', `no chapter "${id}".` + (WB.didYouMean(id, BOOK.map(x => x.id)) ? ` Did you mean "${WB.didYouMean(id, BOOK.map(x => x.id))}"?` : ''), { fix: 'wb.book.contents() lists them' });
      if (!section) return c.md;
      const parts = c.md.split(/^(?=## )/m), hit = parts.slice(1).find(s => s.split('\n')[0].toLowerCase().includes(String(section).toLowerCase()));
      if (!hit) WB.fail('unknownSection', `chapter "${id}" has no section "${section}"`, { fix: `sections: ${parts.slice(1).map(s => s.split('\n')[0].slice(3)).join(' | ')}` });
      return hit;
    },
    search(text, { limit = 20 } = {}) {
      const q = String(text).toLowerCase(), out = [];
      for (const c of BOOK) c.md.split('\n').forEach((l, i) => { if (out.length < limit && l.toLowerCase().includes(q)) out.push({ chapter: c.id, line: i + 1, text: l.trim().slice(0, 160) }); });
      return out;
    },
    open(id, section) { book.read(id, section ? section : undefined); emit('view', { view: 'book', chapter: id, section }); return { opened: id }; },
  });
  const SOURCES = config.sources || {};
  const source = WB.guard('Source', {
    files() { return Object.keys(SOURCES).map(path => ({ path, lines: SOURCES[path].split('\n').length, bytes: SOURCES[path].length, about: (SOURCES[path].match(/^\/\/ (.*)$/m) || ['', ''])[1].slice(0, 140) })); },
    read(path, from = 1, to) {
      const text = SOURCES[path] ?? SOURCES[Object.keys(SOURCES).find(k => k.endsWith('/' + path) || k.endsWith(path)) || ''];
      if (text === undefined) WB.fail('unknownFile', `no source file "${path}".` + (WB.didYouMean(path, Object.keys(SOURCES)) ? ` Did you mean "${WB.didYouMean(path, Object.keys(SOURCES))}"?` : ''), { fix: 'wb.source.files() lists them' });
      const lines = text.split('\n'), end = Math.min(lines.length, to ?? from + 199);
      return lines.slice(from - 1, end).map((l, i) => `${String(from + i).padStart(5)}  ${l}`).join('\n') + (end < lines.length ? `\n… ${lines.length - end} more lines: wb.source.read('${path}', ${end + 1})` : '');
    },
    grep(pattern, { path = '', limit = 60, context = 0 } = {}) {
      const re = pattern instanceof RegExp ? pattern : new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const out = [];
      for (const [file, text] of Object.entries(SOURCES)) {
        if (path && !file.includes(path)) continue;
        const lines = text.split('\n');
        lines.forEach((l, i) => { if (out.length < limit && re.test(l)) out.push(context ? { file, line: i + 1, text: lines.slice(Math.max(0, i - context), i + context + 1).join('\n') } : { file, line: i + 1, text: l.trim().slice(0, 200) }); });
      }
      return out;
    },
    outline(path) {
      const text = SOURCES[path] ?? SOURCES[Object.keys(SOURCES).find(k => k.endsWith(path)) || ''];
      if (text === undefined) WB.fail('unknownFile', `no source file "${path}"`, { fix: 'wb.source.files() lists them' });
      const out = [];
      text.split('\n').forEach((l, i) => {
        const m = /^\s{0,4}(?:(?:async\s+)?function\s+(\w+)|class\s+(\w+)|(WB\.\w+)\s*=|const\s+(\w+)\s*=\s*(?:\(|function|\{)|WB\.definePass\(\{|WB\.defineAnalysis\('(\w+)'|\/\/ -{6,} (.*?) -{3,})/.exec(l);
        if (m) out.push(`${String(i + 1).padStart(5)}  ${(m[1] || m[2] || m[3] || m[4] || m[5] || (m[6] ? '§ ' + m[6] : '') || (l.includes('definePass') ? 'pass ' + ((text.split('\n')[i + 1] || '').match(/name: '([^']+)'/) || ['', '?'])[1] : '')).trim()}`);
      });
      return out.join('\n');
    },
    find(name) { return source.grep(new RegExp(`(function ${name}\\b|${name}\\s*[:=]\\s*(function|\\(|\\{)|name: '${name}'|defineAnalysis\\('${name}'|WB\\.${name}\\s*=)`)); },
  });

  // ---------- the root ----------
  const api = {
    version: '1.0',
    program(name, source, opts = {}) {
      if (typeof name !== 'string' || typeof source !== 'string') WB.fail('badArgument', 'wb.program(name, source): two strings', { fix: "wb.program('mine', 'function f(x: i32): i32 { return x + 1; }')" });
      const q = new WB.Program(name, source); q.inputs = opts.inputs || {};
      state.programs.set(name, q);
      if (opts.open) { state.current = q; emit('program', { program: name, why: 'new' }); }
      return programHandle(q);
    },
    open(x) {
      const q = typeof x === 'string' ? state.programs.get(x) : x && x._p;
      if (!q) WB.fail('unknownProgram', `no program "${x}"`, { fix: `programs: ${[...state.programs.keys()].join(', ')}` });
      state.current = q; emit('program', { program: q.name, why: 'open' });
      return programHandle(q);
    },
    get current() { return state.current ? programHandle(state.current) : null; },
    programs() { return [...state.programs.values()].map(q => ({ name: q.name, status: q.status, rev: `r${q.rev}`, project: q.project || null, current: q === state.current })); },
    projects: WB.guard('Projects', projects),
    pipelines() { return Object.fromEntries(Object.entries(PIPELINES).map(([k, v]) => [k, v.join(' → ') || '(nothing: the lifted code as is)'])); },
    passes() { return [...WB.passes.values()].map(x => ({ name: x.name, about: x.about, needs: Object.values(x.needs), writes: x.writes, preserves: x.preserves, ...(x.user ? { user: true } : {}) })); },
    analyses() { return [...WB.analyses.values()].map(a => ({ name: a.name, about: a.about, reads: a.reads, ...(a.user ? { user: true } : {}) })); },
    pass(name) {
      writes('pass');
      if (WB.passes.has(name) && !WB.passes.get(name).user) WB.fail('builtinPass', `"${name}" is a built-in pass; pick another name`, { fix: `wb.pass('my-${name}')` });
      const b = WB.passBuilder(name);
      return b;
    },
    analysis(name) { writes('analysis'); return WB.analysisBuilder(name); },
    pipeline(name) { return WB.pipelineBuilder(name); },
    lattice: WB.lattice,
    param,
    fragment(name) { writes('fragment'); return WB.fragments.define(name); },
    use(x) { writes('use'); const n = WB.fragments.use(x); emit('fragments', WB.fragments.list()); return { using: n }; },
    drop(name) { WB.fragments.drop(name); return { dropped: name }; },
    fragments() { return WB.fragments.list(); },
    focus(id, p) {
      const q = p ? p._p || p : state.current;
      if (id && q && !q.store.has(id)) WB.fail('absent', `${id} does not exist in ${q.id}`);
      state.focus = id || null;
      const related = id && q ? WB.related(q, id) : null;
      emit('focus', { id, related });
      return id ? { focus: id, text: WB.describeText(q, id), ...related } : { focus: null };
    },
    get focused() { return state.focus; },
    view(name, arg) { emit('view', { view: name, arg }); return { view: name }; },
    book, source,
    help(topic) { return config.reference ? config.reference(topic) : 'no reference loaded'; },
    errors() { return WB.ERRORS; },
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event).delete(fn); },
    log(...xs) { const line = xs.map(x => typeof x === 'string' ? x : WB.toYaml(x)).join(' '); state.logs.push(line); emit('log', line); return undefined; },
    yaml: WB.toYaml,
    backendOptions() { return { ...WB.backendDefaults, about: { registers: "'all' or a number: how many registers the allocator may use, in the order t0–t4, then a1–a7 and a0 in leaf functions, then s1–s11", fuse: 'fuse a comparison into the branch that tests it', immediates: 'use I-type forms and x0 for small constants', divmagic: 'divide by a constant with mulh and shifts', useRanges: 'consult the ranges fact to drop division checks', order: "'caller' tries t0–t4 (and a-registers) first; 'callee' tries s1–s11 first, so every value costs a save", spill: "'furthest' spills whichever interval ends last (the classic heuristic); 'current' spills the interval that found no register", hints: 'let parameters prefer their a-register and returned values a0, so copies disappear', layout: 'block order: source' } }; },
    _state: state, _emit: emit, _programHandle: programHandle,
    _setReadOnly(on) { state.readOnly = !!on; },
    // snapshots for the agent's revert: programs with their revisions, the current one, project files
    _snapshot() {
      return { current: state.current, programs: [...state.programs].map(([n, q]) => [n, q, q.revisions.slice()]), files: JSON.stringify(projects._saved()), projectId: state.projectId, focus: state.focus };
    },
    _restore(snap) {
      state.programs = new Map(snap.programs.map(([n, q, revs]) => { q.revisions = revs.slice(); q.restore(q.revisions[q.revisions.length - 1].snapshot); return [n, q]; }));
      projects._restore(snap.files, snap.programs.map(x => x[1]));
      state.current = snap.current; state.projectId = snap.projectId; state.focus = snap.focus;
      emit('program', { program: state.current && state.current.name, why: 'revert' });
      return { restored: state.current ? `${state.current.id}@r${state.current.rev}` : null };
    },
    _describe() { return { version: api.version, current: state.current ? state.current.id : null, programs: [...state.programs.keys()], projects: projects.list().length, passes: WB.passes.size, analyses: WB.analyses.size }; },
  };
  return WB.guard('Workbench', api);
};

// Error codes, what they mean, and the usual fix.
WB.ERRORS = {
  unknownMember: 'a handle has no such member; the message suggests the nearest name and lists the members',
  immutable: 'handles are read-only; change a program through a pass (p.apply) or p.edit(source)',
  absent: 'no entity with that id in this program',
  unknownFunction: 'the program has no function by that name',
  unknownPass: 'no pass by that name; wb.passes() lists them',
  unknownAnalysis: 'no analysis by that name; wb.analyses() lists them',
  unknownPipeline: 'no pipeline by that name; wb.pipelines() lists them',
  unknownProject: 'no project by that id; wb.projects.list()',
  unknownScript: 'the project has no script by that name; project.scripts()',
  unknownFile: 'the project has no file by that path; project.files.list()',
  scriptSyntax: 'a script file does not parse as the body of a function',
  badPath: 'a file path is letters, digits, _ . / and -',
  badJson: 'project.json does not parse',
  useProjectFiles: 'a project program changes through its files, not p.edit',
  undeclaredWrite: 'a pass changed a kind of entity it did not declare in .writes(…)',
  missingBecause: 'tx.remove needs { because: [...] }: say what makes the removal valid',
  noWidening: 'an analysis over an infinite lattice needs .widen(…)',
  noFixpoint: 'an analysis did not settle in 200 rounds',
  frontEndError: 'the typed front end rejected the source (line and column given)',
  readOnly: "the agent is in Read-only mode; switch to Ask or Auto",
  badProject: 'a project id or import is malformed',
  builtinProject: 'built-in projects cannot be removed; reset() discards your edits',
  duplicateProject: 'a project with that id exists',
  notBuiltin: 'only a built-in project has an original to reset to',
  unsupported: 'the backend has no tile for this operation',
  noReference: 'only built-in projects, unedited, carry a reference image',
  fragmentConflict: 'two fragments define the same member on the same kind',
  unknownOption: 'the backend has no option by that name; wb.backendOptions()',
  notACell: 'a table, list or chart wants a cell or an array; a Selection or a Promise would never update: wrap it in ui.query',
  notAComponent: 'a layout, a tile body or a live tile wants components (or text); show part of an object with ui.stat, or all of it with ui.json',
  notATile: 'a UI script returns tiles made with ui.tile(id)',
  notAParam: 'slider and multiselect need a parameter of the right kind (ui.param.int, ui.param.set)',
  sideEffectInQuery: 'queries are read-only; change the program in a button handler or a task, or run a script on a fresh copy',
  cycle: 'two cells read each other, directly or through others',
  readOnlyCell: 'a computed cell cannot be set; set the cells it reads, or use ui.state',
  paramConflict: 'a parameter of that name exists with another kind or range',
  badPlacement: 'place() takes splitRight, splitLeft, splitAbove, splitBelow, tabWith or replace, naming a view or a tile',
  badProps: 'a component got a prop it does not declare, or lacks one it needs',
  unknownFragment: 'no UI fragment of that name has been defined',
  unknownTile: 'no live tile of that id',
  noProject: 'the call reads the open project, and none is open',
};
})(globalThis);
