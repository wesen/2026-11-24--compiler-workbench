// handles.js: read-only handles on entities, and selections over them. Handles are what
// passes, views and the agent see; they are proxies, so a typo or an assignment is refused
// with a code and a fix instead of quietly doing nothing.
(function (G) {
'use strict';
const WB = G.WB;

// Which statement holds each value, and its parent value, for one revision of a program.
function usesOf(p) {
  const key = `${p.rev}:${p.store.ents.size}`;
  if (p._uses && p._uses.key === key) return p._uses.map;
  const map = new Map();
  const walk = (id, stmt, parent) => { if (!id) return; map.set(id, { stmt, parent }); for (const a of p.store.get(id).args) walk(a, stmt, id); };
  for (const f of p.fns.values()) for (const b of f.blocks) for (const sid of b.stmts) { const s = p.store.get(sid); for (const k of ['value', 'cond', 'addr']) walk(s[k], sid, null); }
  p._uses = { key, map };
  return map;
}
WB.usesOf = usesOf;
function blockOf(p, sid) { for (const f of p.fns.values()) for (const b of f.blocks) if (b.stmts.includes(sid)) return b.id; return null; }

const sameTree = (p, a, b) => { const x = p.store.get(a), y = p.store.get(b); return x.op === y.op && x.imm === y.imm && x.args.length === y.args.length && x.args.every((u, i) => sameTree(p, u, y.args[i])); };

WB.handle = function handle(p, id, ctx = {}) {
  const e = p.store.get(id);
  if (!e) WB.fail('absent', `${id} does not exist in ${p.id}`, { fix: 'ids look like fn:name, bb:name.3, s:name.7, v:name.12, op:name#5' });
  const h = { id, kind: e.kind, _ent: e, _p: p };
  const common = {
    get status() { return p.statusOf(id); },
    get text() { return WB.describeText(p, id); },
    describe() { return describe(p, id); },
    origin() { return (e.origin || []).map(o => ({ ...o })); },
    lineage() { return WB.lineage(p, id); },
    lines() { return WB.linesOf(p, id); },
    why() { return WB.why(p, id); },
    history() { return p.revisions.flatMap(r => r.edits.filter(x => Object.values(x).some(v => v === id || (Array.isArray(v) && v.includes(id))))); },
    _describe() { return describe(p, id); },
  };
  Object.defineProperties(h, Object.getOwnPropertyDescriptors(common));
  if (e.kind === 'value') {
    Object.defineProperties(h, Object.getOwnPropertyDescriptors({
      op: e.op, imm: e.imm,
      get args() { return e.args.map(a => WB.handle(p, a, ctx)); },
      get isConst() { return e.op === 'const'; },
      get isLeaf() { return !e.args.length; },
      get isPure() { return WB.isPure(p, id); },
      get hasEffect() { return WB.hasEffect(p, id); },
      get isBoolean() { return WB.COMPARE.has(e.op); },
      get reads() { const f = p.store.get(e.fn); return [...WB.readsOf(p, id)].map(l => f.locals[l].name); },
      get statement() { return ctx.stmt || (usesOf(p).get(id) || {}).stmt || null; },
      get parent() { return (usesOf(p).get(id) || {}).parent || null; },
      same(other) { return sameTree(p, id, typeof other === 'string' ? other : other.id); },
      size() { const n = x => 1 + p.store.get(x).args.reduce((s, a) => s + n(a), 0); return n(id); },
    }));
  } else if (e.kind === 'stmt') {
    const f = p.store.get(e.fn);
    Object.defineProperties(h, Object.getOwnPropertyDescriptors({
      op: e.op, local: e.local, to: e.to, then: e.then, else: e.else, width: e.width, offset: e.offset,
      get localName() { return e.local !== undefined ? f.locals[e.local].name : null; },
      get value() { return e.value ? WB.handle(p, e.value, { stmt: id }) : null; },
      get cond() { return e.cond ? WB.handle(p, e.cond, { stmt: id }) : null; },
      get addr() { return e.addr ? WB.handle(p, e.addr, { stmt: id }) : null; },
      get block() { return blockOf(p, id); },
      values() { return selection(p, `stmt('${id}').values()`, () => { const out = []; const w = v => { if (!v) return; out.push(v); p.store.get(v).args.forEach(w); }; WB.stmtValues(e).forEach(w); return out; }); },
    }));
  } else if (e.kind === 'block') {
    Object.defineProperties(h, Object.getOwnPropertyDescriptors({
      get succ() { return e.succ.slice(); },
      preds() { const f = p.store.get(e.fn); return f.blocks.filter(b => b.succ.includes(id)).map(b => b.id); },
      stmts() { return selection(p, `block('${id}').stmts()`, () => e.stmts.slice()); },
      defs() { return new Set(e.stmts.map(s => p.store.get(s)).filter(s => s.op === 'set').map(s => s.local)); },
      uses() { const u = new Set(), d = new Set(); for (const sid of e.stmts) { const s = p.store.get(sid); for (const v of WB.stmtValues(s)) for (const l of WB.readsOf(p, v)) if (!d.has(l)) u.add(l); if (s.op === 'set') d.add(s.local); } return u; },
    }));
  } else if (e.kind === 'function') {
    Object.defineProperties(h, Object.getOwnPropertyDescriptors({
      name: e.name, params: e.params.slice(), result: e.result,
      blocks() { return selection(p, `fn('${e.name}').blocks()`, () => e.blocks.map(b => b.id)); },
      stmts() { return selection(p, `fn('${e.name}').stmts()`, () => e.blocks.flatMap(b => b.stmts)); },
      values() { return selection(p, `fn('${e.name}').values()`, () => { const out = []; const w = v => { if (!v) return; out.push(v); p.store.get(v).args.forEach(w); }; for (const b of e.blocks) for (const s of b.stmts) WB.stmtValues(p.store.get(s)).forEach(w); return out; }); },
      ops() { return selection(p, `fn('${e.name}').ops()`, () => [...p.store.ents.values()].filter(x => x.kind === 'op' && x.fn === id).map(x => x.id)); },
      locals() { return e.locals.map(l => ({ id: `local:${e.name}/${l.name}`, ...l })); },
      loops() { return WB.factOf(p, 'loops', e.name).value.map(l => ({ ...l })); },
      fact(name) { const fct = WB.factOf(p, name, e.name); return { id: fct.id, status: fct.status, rev: fct.rev, ms: fct.ms, visits: fct.visits, value: fct.value }; },
      listing() { return WB.listing(p, e.name); },
    }));
  } else if (e.kind === 'op') {
    Object.defineProperties(h, Object.getOwnPropertyDescriptors({ op: e.op, operands: e.operands, line: e.at && e.at.line, col: e.at && e.at.col,
      get derived() { return WB.related(p, id); } }));
  } else if (e.kind === 'insn') {
    Object.defineProperties(h, Object.getOwnPropertyDescriptors({ offset: e.offset, word: e.word, text: e.text, fn: e.fn, image: e.image, why: e.why, covers: e.covers }));
  }
  if (WB.fragments) WB.fragments.decorate(e.kind, h);
  return WB.guard(kindName(e.kind), h);
};
const kindName = k => ({ value: 'Value', stmt: 'Statement', block: 'Block', function: 'Function', op: 'Op', insn: 'Instruction' })[k] || k;

function describe(p, id) {
  const e = p.store.get(id);
  const out = { id, kind: e.kind, what: WB.describeText(p, id), status: p.statusOf(id) };
  if (e.fn) out.fn = e.fn;
  if (e.kind === 'value' || e.kind === 'stmt') { const lines = WB.linesOf(p, id); if (lines.length) out.lines = lines; }
  if (e.kind === 'value') { const u = usesOf(p).get(id); if (u) out.in = u.stmt; }
  if (e.kind === 'op' && e.at) { out.line = e.at.line; out.col = e.at.col; }
  if (e.origin && e.origin.length) out.origin = e.origin.map(o => `${o.via}${o.rev !== undefined ? '@r' + o.rev : ''} from ${o.from}${o.because && o.because.length ? ' because ' + o.because.join(', ') : ''}${o.note ? ' (' + o.note + ')' : ''}`);
  return out;
}
WB.describe = describe;

// Everything that came from an entity, by provenance: values, statements, instructions.
WB.related = function related(p, id) {
  const out = { lines: [], values: [], stmts: [], insns: [] };
  const e = p.store.get(id);
  if (!e) return out;
  const live = p.liveIds();
  const ops = e.kind === 'op' ? [id] : WB.lineage(p, id);
  out.lines = e.kind === 'op' ? (e.at ? [e.at.line] : []) : WB.linesOf(p, id);
  const own = x => (x.origin || []).some(o => ops.includes(o.from)) || x.id === id;
  for (const x of p.store.ents.values()) {
    if (x.kind === 'value' && live.has(x.id) && (x.id === id || (e.kind === 'op' && WB.lineage(p, x.id).includes(id) && own(x)) || (e.kind === 'op' && own(x)))) out.values.push(x.id);
    if (x.kind === 'stmt' && live.has(x.id) && (x.id === id || (e.kind === 'op' && WB.lineage(p, x.id).includes(id)))) out.stmts.push(x.id);
    if (x.kind === 'insn' && x.image === p._image && (x.covers || []).some(c => c === id || WB.lineage(p, c).some(o => ops.includes(o)))) out.insns.push(x.id);
  }
  out.values = [...new Set(out.values)];
  return out;
};

// ---------- selections ----------
function selection(p, of, produce) {
  const s = {
    of,
    where(fn) { return selection(p, `${of}.where(${fn.toString().slice(0, 60)})`, () => produce().filter(id => fn(WB.handle(p, id)))); },
    line(n) { return selection(p, `${of}.line(${n})`, () => produce().filter(id => WB.linesOf(p, id).includes(n) || (p.store.get(id).at && p.store.get(id).at.line === n))); },
    op(name) { return selection(p, `${of}.op('${name}')`, () => produce().filter(id => p.store.get(id).op === name)); },
    take(n) { return selection(p, `${of}.take(${n})`, () => produce().slice(0, n)); },
    ids() { return produce(); },
    list() { return produce().map(id => WB.handle(p, id)); },
    first() { const id = produce()[0]; return id ? WB.handle(p, id) : null; },
    count() { return produce().length; },
    map(fn) { return produce().map(id => fn(WB.handle(p, id))); },
    sum(fn) { return produce().reduce((n, id) => n + fn(WB.handle(p, id)), 0); },
    table(...cols) { if (!cols.length) cols = ['id', 'text']; return produce().map(id => { const h = WB.handle(p, id), row = {}; for (const c of cols) row[c] = typeof c === 'function' ? c(h) : h[c]; return row; }); },
    result() { const ids = produce(); return { kind: 'count', value: ids.length, of, status: 'known', rev: `r${p.rev}`, witnesses: ids.slice(0, 12) }; },
    _describe() { const ids = produce(); return { of, count: ids.length, ids: ids.slice(0, 20).map(id => `${id}  ${WB.describeText(p, id)}`) }; },
  };
  return WB.guard('Selection', s);
}
WB.selection = selection;

// ---------- fragments: methods and attributes added to a kind of handle ----------
WB.fragments = (() => {
  const all = new Map(), used = new Set();
  return {
    define(name) {
      const frag = { name, members: [] };
      let kind = null;
      const b = {
        on(k) { kind = { Value: 'value', Statement: 'stmt', Block: 'block', Function: 'function', Op: 'op', Instruction: 'insn' }[k] || k; return b; },
        attr(member, fn) { if (!kind) WB.fail('incomplete', 'fragment: call .on(kind) before .attr'); frag.members.push({ kind, member, type: 'attr', fn }); return b; },
        method(member, fn) { if (!kind) WB.fail('incomplete', 'fragment: call .on(kind) before .method'); frag.members.push({ kind, member, type: 'method', fn }); return b; },
        get name() { return name; },
        get members() { return frag.members.map(m => `${m.kind}.${m.member} (${m.type})`); },
        _frag: frag,
      };
      all.set(name, frag);
      return b;
    },
    use(fragOrName) {
      const frag = typeof fragOrName === 'string' ? all.get(fragOrName) : fragOrName._frag || fragOrName;
      if (!frag) WB.fail('unknownFragment', `no fragment "${fragOrName}"`);
      for (const m of frag.members) for (const other of used) {
        const o = all.get(other);
        if (o !== frag && o.members.some(x => x.kind === m.kind && x.member === m.member)) WB.fail('fragmentConflict', `${m.kind}.${m.member} is defined by "${o.name}" and "${frag.name}"`, { fix: `remove one: wb.fragments.drop('${o.name}')` });
      }
      used.add(frag.name);
      return frag.name;
    },
    drop(name) { used.delete(name); },
    list() { return [...all.values()].map(f => ({ name: f.name, used: used.has(f.name), members: f.members.map(m => `${m.kind}.${m.member}`) })); },
    get(name) { return all.get(name); },
    provider(kind, member) { for (const f of all.values()) if (!used.has(f.name) && f.members.some(m => m.member === member)) return f.name; return null; },
    decorate(kind, h) {
      for (const name of used) for (const m of all.get(name).members) if (m.kind === kind) {
        if (m.type === 'attr') Object.defineProperty(h, m.member, { get: () => m.fn(h), enumerable: true });
        else h[m.member] = (...args) => m.fn(h, ...args);
      }
    },
  };
})();
})(globalThis);
