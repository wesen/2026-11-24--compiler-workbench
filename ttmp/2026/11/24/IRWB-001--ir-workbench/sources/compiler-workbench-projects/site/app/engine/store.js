// store.js: the store of entities, ingest from the typed front end, lifting stack code into
// blocks of statements over value trees, revisions with snapshots, and provenance.
(function (G) {
'use strict';
const WB = G.WB;

// Short operator names used by our IR, from the front end's Wasm-style op names.
const BINOPS = {
  'i32.add': 'add', 'i32.sub': 'sub', 'i32.mul': 'mul', 'i32.div_s': 'div', 'i32.rem_s': 'rem',
  'i32.and': 'and', 'i32.or': 'or', 'i32.xor': 'xor', 'i32.shl': 'shl', 'i32.shr_s': 'shr', 'i32.shr_u': 'shru',
  'i32.eq': 'eq', 'i32.ne': 'ne', 'i32.lt_s': 'lt', 'i32.gt_s': 'gt', 'i32.le_s': 'le', 'i32.ge_s': 'ge',
  'i32.lt_u': 'ltu', 'i32.ge_u': 'geu',
};
WB.BINOPS = BINOPS;
WB.SYMBOL = { add: '+', sub: '-', mul: '*', div: '/', rem: '%', and: '&', or: '|', xor: '^', shl: '<<', shr: '>>', shru: '>>>',
  eq: '==', ne: '!=', lt: '<', gt: '>', le: '<=', ge: '>=', ltu: '<u', geu: '>=u' };
WB.COMPARE = new Set(['eq', 'ne', 'lt', 'gt', 'le', 'ge', 'ltu', 'geu', 'eqz']);

// ---------- the store ----------
class Store {
  constructor() { this.ents = new Map(); this.counters = new Map(); }
  fresh(prefix) { const n = this.counters.get(prefix) ?? 0; this.counters.set(prefix, n + 1); return `${prefix}.${n}`; }
  add(e) { this.ents.set(e.id, e); return e; }
  get(id) { return this.ents.get(id); }
  has(id) { return this.ents.has(id); }
}
WB.Store = Store;

// ---------- the front end, reused unchanged ----------
// typedWasm.compile with an inspect callback gives, per function, its locals and every
// emitted operation with the source span of the token that emitted it.
WB.frontEnd = function frontEnd(source) {
  if (!G.typedWasm) WB.fail('noFrontEnd', 'typed-wasm.js is not loaded');
  const events = [];
  const out = G.typedWasm.compile(source, { inspect: { emit: e => events.push(e) } });
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  const pos = off => { let lo = 0, hi = starts.length; while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (starts[m] <= off) lo = m; else hi = m; } return { line: lo + 1, col: off - starts[lo] + 1 }; };
  const fns = events.filter(e => e.kind === 'frontend').map(f => ({
    name: f.function, params: f.params, result: f.result, localCount: f.localCount,
    locals: f.locals.map(l => ({ index: l.index, name: l.name, type: l.type, mutable: l.mutable, param: l.parameter, at: l.source ? pos(l.source.start) : null })),
    ops: f.operations.map(o => ({ ordinal: o.ordinal, op: o.op, operands: o.operands, at: o.source ? { ...pos(o.source.start), start: o.source.start, end: o.source.end } : null })),
  }));
  return { fns, wasmBytes: out.bytes.length, records: out.records, enums: out.enums, signatures: out.signatures };
};

// ---------- lifting: stack code and structured control into a CFG ----------
// Values are trees; a value has one user. Statements are set, store, eval, br, br_if, return
// and trap. The operand stack is materialized into temporaries wherever evaluation order
// could change: before a local it reads is assigned, before memory changes, around control.
function lift(store, fe, f) {
  const F = f.name;
  const fn = {
    id: `fn:${F}`, kind: 'function', name: F, params: f.params.slice(), result: f.result,
    locals: [], blocks: [], origin: [{ from: 'source', via: 'ingest', kind: 'recorded' }],
  };
  const named = new Map(f.locals.map(l => [l.index, l]));
  const ensureLocal = i => {
    while (fn.locals.length <= i) {
      const k = fn.locals.length, l = named.get(k);
      fn.locals.push(l ? { index: k, name: l.name, type: l.type, param: !!l.param, mutable: !!l.mutable, at: l.at }
        : { index: k, name: `t${k}`, type: 'i32', param: false, mutable: true, temp: 'front end' });
    }
  };
  ensureLocal(f.localCount - 1);
  const newTemp = (why) => { const k = fn.locals.length; fn.locals.push({ index: k, name: `t${k}`, type: 'i32', param: false, mutable: true, temp: why }); return k; };
  store.add(fn);
  const blockOf = () => { const b = { id: `bb:${F}.${fn.blocks.length}`, kind: 'block', fn: fn.id, stmts: [], succ: [], origin: [] }; fn.blocks.push(b); store.add(b); return b; };
  const origin = o => [{ from: `op:${F}#${o.ordinal}`, via: 'ingest', kind: 'recorded' }];
  const val = (op, args, imm, o) => store.add({ id: store.fresh(`v:${F}`), kind: 'value', fn: fn.id, op, args, imm, origin: origin(o) }).id;
  let cur = blockOf();
  const stmt = (s, o, note) => {
    const e = store.add({ id: store.fresh(`s:${F}`), kind: 'stmt', fn: fn.id, ...s, origin: origin(o).map(x => note ? { ...x, note } : x) });
    cur.stmts.push(e.id);
    if (!cur.origin.length) cur.origin = origin(o);
    return e;
  };
  const reads = (id, pred) => { const v = store.get(id); return pred(v) || v.args.some(a => reads(a, pred)); };
  const stack = [], ctl = [];
  // materialize stack entries matching pred into fresh temporaries, in order
  const flush = (pred, o, why) => {
    for (let i = 0; i < stack.length; i++) {
      const v = store.get(stack[i]);
      if (v.op === 'const' || (v.op === 'get' && why === 'control') || !pred(stack[i])) continue;
      const t = newTemp(why);
      stmt({ op: 'set', local: t, value: stack[i] }, o, `stack value kept in t${t} (${why})`);
      stack[i] = val('get', [], t, o);
    }
  };
  const terminated = () => cur.stmts.length && ['br', 'br_if', 'return', 'trap'].includes(store.get(cur.stmts.at(-1)).op);
  const jump = (to, o) => { if (!terminated()) { stmt({ op: 'br', to: to.id }, o); cur.succ.push(to.id); } };
  const endOf = c => c.end || (c.end = blockOf());
  const target = k => { const c = ctl[ctl.length - 1 - k]; if (!c) return null; return c.kind === 'loop' ? c.head : endOf(c); };
  for (const o of f.ops) {
    if (!store.has(`op:${F}#${o.ordinal}`)) store.add({ id: `op:${F}#${o.ordinal}`, kind: 'op', fn: fn.id, op: o.op, operands: o.operands, at: o.at });
    const op = o.op;
    if (op === 'i32.const') stack.push(val('const', [], o.operands[0] | 0, o));
    else if (op === 'local.get') { ensureLocal(o.operands[0]); stack.push(val('get', [], o.operands[0], o)); }
    else if (op === 'local.set') {
      const L = o.operands[0]; ensureLocal(L);
      const v = stack.pop();
      flush(id => reads(id, x => x.op === 'get' && x.imm === L), o, `before ${fn.locals[L].name} changes`);
      stmt({ op: 'set', local: L, value: v }, o);
    }
    else if (BINOPS[op]) { const b = stack.pop(), a = stack.pop(); stack.push(val(BINOPS[op], [a, b], undefined, o)); }
    else if (op === 'i32.eqz') stack.push(val('eqz', [stack.pop()], undefined, o));
    else if (op === 'i32.load' || op === 'i32.load16_u') stack.push(val(op === 'i32.load' ? 'load' : 'load16u', [stack.pop()], o.operands[1], o));
    else if (op === 'i32.store' || op === 'i32.store16') {
      const v = stack.pop(), a = stack.pop();
      flush(id => reads(id, x => x.op === 'load' || x.op === 'load16u' || x.op === 'call'), o, 'before memory changes');
      stmt({ op: 'store', width: op === 'i32.store' ? 32 : 16, addr: a, value: v, offset: o.operands[1] }, o);
    }
    else if (op === 'call') {
      const callee = fe.fns.find(x => x.name === fe.signatures[o.operands[0]]?.name) || fe.fns[o.operands[0]];
      const n = callee ? callee.params.length : 0;
      const args = stack.splice(stack.length - n, n);
      flush(id => reads(id, x => x.op === 'load' || x.op === 'load16u' || x.op === 'call'), o, 'before a call');
      const t = newTemp('call result');
      stmt({ op: 'set', local: t, value: val('call', args, callee ? callee.name : String(o.operands[0]), o) }, o);
      stack.push(val('get', [], t, o));
    }
    else if (op === 'drop') stack.pop();
    else if (op === 'block') { flush(() => true, o, 'control'); ctl.push({ kind: 'block', end: null, height: stack.length }); }
    else if (op === 'loop') { flush(() => true, o, 'control'); const h = blockOf(); jump(h, o); cur = h; ctl.push({ kind: 'loop', head: h, height: stack.length }); }
    else if (op === 'if') {
      const c = stack.pop();
      flush(() => true, o, 'control');
      const th = blockOf(), el = blockOf();
      const hasResult = o.operands[0] === 0x7f;
      stmt({ op: 'br_if', cond: c, then: th.id, else: el.id }, o); cur.succ.push(th.id, el.id);
      cur = th;
      ctl.push({ kind: 'if', elseB: el, end: null, hasElse: false, result: hasResult ? newTemp('if result') : null, height: stack.length });
    }
    else if (op === 'else') {
      const c = ctl.at(-1);
      if (c.result !== null && stack.length > c.height) stmt({ op: 'set', local: c.result, value: stack.pop() }, o);
      jump(endOf(c), o);
      c.hasElse = true; cur = c.elseB;
    }
    else if (op === 'end') {
      const c = ctl.pop();
      if (!c) { if (stack.length) stmt({ op: 'return', value: stack.pop() }, o); else stmt({ op: 'return', value: val('const', [], 0, o) }, o); break; }
      if (c.kind === 'loop') continue;
      if (c.kind === 'if') {
        if (c.result !== null && stack.length > c.height) stmt({ op: 'set', local: c.result, value: stack.pop() }, o);
        const e = endOf(c);
        jump(e, o);
        if (!c.hasElse) { cur = c.elseB; jump(e, o); }
        cur = e;
        if (c.result !== null) stack.push(val('get', [], c.result, o));
        continue;
      }
      if (!c.end) continue; // a block nobody branched to
      jump(c.end, o); cur = c.end;
    }
    else if (op === 'br') { const to = target(o.operands[0]); stmt({ op: 'br', to: to.id }, o); cur.succ.push(to.id); cur = blockOf(); }
    else if (op === 'br_if') {
      const cond = stack.pop(), to = target(o.operands[0]);
      flush(() => true, o, 'control');
      const next = blockOf();
      stmt({ op: 'br_if', cond, then: to.id, else: next.id }, o); cur.succ.push(to.id, next.id); cur = next;
    }
    else if (op === 'return') { stmt({ op: 'return', value: stack.length ? stack.pop() : val('const', [], 0, o) }, o); cur = blockOf(); }
    else if (op === 'unreachable') { stmt({ op: 'trap', why: 'unreachable' }, o); cur = blockOf(); }
    else WB.fail('unsupportedOp', `ingest: the front end emitted ${op}, which the workbench does not lift yet`);
  }
  prune(store, fn);
  return fn;
}
WB.lift = lift;

// Remove blocks the entry cannot reach, and edges into them.
function prune(store, fn) {
  const reach = new Set(), work = [fn.blocks[0].id];
  while (work.length) { const id = work.pop(); if (reach.has(id)) continue; reach.add(id); work.push(...store.get(id).succ); }
  const gone = fn.blocks.filter(b => !reach.has(b.id));
  fn.blocks = fn.blocks.filter(b => reach.has(b.id));
  return gone;
}
WB.prune = prune;

// ---------- the program: one source, its store, its revisions ----------
let programCounter = 0;
class Program {
  constructor(name, source, opts = {}) {
    this.name = name;
    this.source = source;
    this.serial = ++programCounter;
    this.id = `prog:${name}`;
    this.store = new Store();
    this.fns = new Map();
    this.facts = new Map();
    this.revisions = [];
    this.status = 'ok';
    this.error = null;
    try {
      this.fe = WB.frontEnd(source);
      for (const f of this.fe.fns) this.fns.set(f.name, lift(this.store, this.fe, f));
    } catch (e) {
      if (e instanceof WB.WorkbenchError) { this.status = 'unsupported'; this.error = { message: e.message }; }
      else {
        this.status = 'frontEndError';
        const m = /^(\d+):(\d+): (.*)$/s.exec(e.message);
        this.error = m ? { line: +m[1], col: +m[2], message: m[3] } : { message: e.message };
      }
    }
    this.revisions.push({ rev: 0, pass: 'ingest', edits: [], snapshot: this.snapshot(), ms: 0, note: 'ingest from the typed front end' });
  }
  get rev() { return this.revisions.length - 1; }
  fn(name) {
    const f = this.fns.get(name);
    if (!f) WB.fail('unknownFunction', `${this.id} has no function "${name}".` + (WB.didYouMean(name, [...this.fns.keys()]) ? ` Did you mean "${WB.didYouMean(name, [...this.fns.keys()])}"?` : ''), { fix: `functions: ${[...this.fns.keys()].join(', ')}` });
    return f;
  }
  // The mutable parts of the program: per function its locals and blocks, per statement its fields.
  snapshot() {
    const fns = {}, stmts = {};
    for (const [name, f] of this.fns) {
      fns[name] = { locals: f.locals.map(l => ({ ...l })), blocks: f.blocks.map(b => ({ id: b.id, stmts: b.stmts.slice(), succ: b.succ.slice() })) };
      for (const b of f.blocks) for (const s of b.stmts) { const e = this.store.get(s); stmts[s] = { ...e }; }
    }
    return { fns, stmts };
  }
  restore(snap) {
    for (const [name, fs] of Object.entries(snap.fns)) {
      const f = this.fns.get(name);
      f.locals = fs.locals.map(l => ({ ...l }));
      f.blocks = fs.blocks.map(b => { const e = this.store.get(b.id); e.stmts = b.stmts.slice(); e.succ = b.succ.slice(); return e; });
    }
    for (const [id, fields] of Object.entries(snap.stmts)) Object.assign(this.store.get(id), fields);
    this.facts.clear();
  }
  checkout(rev) {
    if (rev < 0 || rev > this.rev) WB.fail('noRevision', `${this.id} has revisions r0 to r${this.rev}`);
    this.restore(this.revisions[rev].snapshot);
    this.revisions.length = rev + 1;
    return this.rev;
  }
  undo() { if (this.rev === 0) WB.fail('noRevision', 'nothing to undo: this is r0'); return this.checkout(this.rev - 1); }
  // Every live statement and value, reached from the blocks.
  liveIds(fname) {
    const out = new Set();
    const walk = id => { if (!id || out.has(id)) return; out.add(id); for (const a of this.store.get(id).args || []) walk(a); };
    for (const f of fname ? [this.fn(fname)] : this.fns.values())
      for (const b of f.blocks) { out.add(b.id); for (const s of b.stmts) { out.add(s); const e = this.store.get(s); for (const k of ['value', 'cond', 'addr']) walk(e[k]); } }
    return out;
  }
  statusOf(id) {
    const e = this.store.get(id);
    if (!e) return 'absent';
    if (e.kind === 'op' || e.kind === 'function') return 'live';
    if (this.liveIds().has(id)) return 'live';
    const removed = this.revisions.find(r => r.edits.some(x => x.kind === 'remove' && x.stmt === id));
    if (removed) return `removed@r${removed.rev}`;
    const replaced = this.revisions.find(r => r.edits.some(x => x.from === id));
    if (replaced) return `replaced@r${replaced.rev}`;
    return 'detached';
  }
}
WB.Program = Program;

// ---------- printing ----------
function show(p, id, fnEnt) {
  const v = p.store.get(id), f = fnEnt || p.store.get(v.fn);
  switch (v.op) {
    case 'const': return String(v.imm);
    case 'get': return f.locals[v.imm] ? f.locals[v.imm].name : `l${v.imm}`;
    case 'eqz': return `!(${show(p, v.args[0], f)})`;
    case 'load': return `load32[${show(p, v.args[0], f)}+${v.imm}]`;
    case 'load16u': return `load16[${show(p, v.args[0], f)}+${v.imm}]`;
    case 'call': return `${v.imm}(${v.args.map(a => show(p, a, f)).join(', ')})`;
    default: return `(${show(p, v.args[0], f)} ${WB.SYMBOL[v.op] || v.op} ${show(p, v.args[1], f)})`;
  }
}
WB.show = show;
const short = id => id && id.replace(/^bb:[^.]+\./, '.');
WB.showStmt = function showStmt(p, id) {
  const s = p.store.get(id), f = p.store.get(s.fn);
  switch (s.op) {
    case 'set': return `${f.locals[s.local].name} = ${show(p, s.value, f)}`;
    case 'store': return `store${s.width}[${show(p, s.addr, f)}+${s.offset}] = ${show(p, s.value, f)}`;
    case 'eval': return show(p, s.value, f);
    case 'br': return `goto ${short(s.to)}`;
    case 'br_if': return `if ${show(p, s.cond, f)} goto ${short(s.then)} else ${short(s.else)}`;
    case 'return': return `return ${show(p, s.value, f)}`;
    case 'trap': return 'trap';
  }
  return s.op;
};
WB.listing = function listing(p, fname) {
  const out = [];
  for (const f of fname ? [p.fn(fname)] : p.fns.values()) {
    const params = f.params.map((t, i) => `${f.locals[i].name}: ${t}`).join(', ');
    out.push(`function ${f.name}(${params}): ${f.result}`);
    for (const b of f.blocks) {
      out.push(`${b.id}  -> [${b.succ.map(short).join(', ')}]`);
      for (const s of b.stmts) out.push(`    ${s.padEnd(13)}${WB.showStmt(p, s)}`);
    }
  }
  return out.join('\n');
};

// ---------- provenance ----------
// lineage: follow origin and value arguments down to front-end ops; returns op ids.
WB.lineage = function lineage(p, id, seen = new Set()) {
  const e = p.store.get(id);
  if (!e || seen.has(id)) return [];
  seen.add(id);
  if (e.kind === 'op') return [id];
  const out = [];
  for (const o of e.origin || []) if (o.from && o.from !== 'source') out.push(...lineage(p, o.from, seen));
  for (const a of e.args || []) out.push(...lineage(p, a, seen));
  for (const k of ['value', 'cond', 'addr']) if (e[k]) out.push(...lineage(p, e[k], seen));
  if (e.covers) for (const c of e.covers) out.push(...lineage(p, c, seen));
  return [...new Set(out)];
};
WB.linesOf = function linesOf(p, id) {
  const lines = new Set();
  for (const o of WB.lineage(p, id)) { const at = p.store.get(o).at; if (at) lines.add(at.line); }
  return [...lines].sort((a, b) => a - b);
};
// why: the because-chain, as a tree of { id, text, via, rev, status, because: [...] }
WB.why = function why(p, id, depth = 0, seen = new Set()) {
  const e = p.store.get(id);
  if (!e) return { id, status: 'absent' };
  const node = { id, kind: e.kind, text: describeText(p, id), status: p.statusOf(id) };
  if (seen.has(id) || depth > 8) return node;
  seen.add(id);
  const o = (e.origin || [])[0];
  if (o) {
    node.via = o.via; if (o.rev !== undefined) node.rev = o.rev; if (o.note) node.note = o.note;
    if (e.kind !== 'op') {
      node.from = o.from && o.from !== 'source' ? WB.why(p, o.from, depth + 1, seen) : o.from;
      if (o.because && o.because.length) node.because = o.because.map(b => typeof b === 'string' && p.store.get(b) ? WB.why(p, b, depth + 1, seen) : b);
    }
  }
  if (e.kind === 'stmt' && e.value && depth < 3) node.value = WB.why(p, e.value, depth + 1, seen);
  return node;
};
function describeText(p, id) {
  const e = p.store.get(id);
  if (e.kind === 'op') return `${e.op}${e.operands && e.operands.length ? ' ' + e.operands.join(' ') : ''}` + (e.at ? ` (line ${e.at.line})` : '');
  if (e.kind === 'value') return show(p, id);
  if (e.kind === 'stmt') return WB.showStmt(p, id);
  if (e.kind === 'block') return `${e.stmts.length} statements -> ${e.succ.map(short).join(', ')}`;
  if (e.kind === 'function') return `${e.name}(${e.params.join(', ')}): ${e.result}`;
  if (e.kind === 'insn') return e.text;
  return e.kind;
}
WB.describeText = describeText;
})(globalThis);
