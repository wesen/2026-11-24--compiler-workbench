// evaluator.js: our own interpreter for the store's statements, memory images for typed
// arguments, generated test cases, and the checks that compare revisions and images.
(function (G) {
'use strict';
const WB = G.WB;

class Trap extends Error { constructor(kind, at) { super(kind); this.trap = kind; this.at = at; } }

// ---------- memory: buffers (u32 length, u16 cells) and records (one word per field) ----------
class Memory {
  constructor(bytes = 4096) { this.bytes = new Uint8Array(bytes); this.view = new DataView(this.bytes.buffer); this.top = 1024; this.items = []; }
  alloc(n) { const at = this.top; this.top = (this.top + n + 15) & ~15; if (this.top > this.bytes.length) this.grow(this.top + 1024); return at; }
  grow(n) { const b = new Uint8Array(Math.ceil(n / 4096) * 4096); b.set(this.bytes); this.bytes = b; this.view = new DataView(b.buffer); }
  buffer(cells, name) {
    const at = this.alloc(4 + 2 * Math.max(1, cells.length));
    this.view.setUint32(at, cells.length, true);
    cells.forEach((c, i) => this.view.setUint16(at + 4 + 2 * i, c & 65535, true));
    this.items.push({ kind: 'buffer', name, at, length: cells.length });
    return at;
  }
  string(text, name) { return this.buffer(Array.from(text, ch => ch.charCodeAt(0)), name); }
  record(words, name) {
    const at = this.alloc(4 * Math.max(1, words.length));
    words.forEach((w, i) => this.view.setInt32(at + 4 * i, w | 0, true));
    this.items.push({ kind: 'record', name, at, words: words.length });
    return at;
  }
  image() { return this.bytes.slice(0, Math.max(this.top, 1024)); }
}
WB.Memory = Memory;

// Read a buffer back out of a memory image (for showing results).
WB.readBuffer = function readBuffer(bytes, at) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = v.getUint32(at, true), out = [];
  for (let i = 0; i < Math.min(n, 256); i++) out.push(v.getUint16(at + 4 + 2 * i, true));
  return out;
};

// ---------- inputs ----------
// An input spec per parameter: [lo, hi] for i32, { buffer: [minLen, maxLen], cell: [lo, hi] },
// { string: 'text' }, { bool: true }, { record: { field: spec } }, or a fixed number.
function makeValue(spec, type, mem, rnd, fe, name) {
  const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  if (typeof spec === 'number') return spec | 0;
  if (Array.isArray(spec)) return between(spec[0], spec[1]) | 0;
  if (spec && spec.cells) return mem.buffer(spec.cells, name);
  if (spec && spec.string !== undefined) return mem.string(spec.string, name);
  if (spec && spec.buffer) {
    const [a, b] = spec.buffer, [c0, c1] = spec.cell || [0, 255];
    const len = between(a, b);
    return mem.buffer(Array.from({ length: len }, () => between(c0, c1)), name);
  }
  if (spec && spec.bool) return rnd() < 0.5 ? 0 : 1;
  if (spec && spec.record) {
    const layout = fe.records[type] || {};
    const words = Object.entries(layout).map(([field, f]) => makeValue(spec.record[field] ?? [-50, 50], f.type, mem, rnd, fe, name + '.' + field));
    return mem.record(words, name);
  }
  if (spec && spec.oneOf) return spec.oneOf[Math.floor(rnd() * spec.oneOf.length)] | 0;
  // defaults by type
  if (type === 'bool') return rnd() < 0.5 ? 0 : 1;
  if (type === 'buffer') return makeValue({ buffer: [0, 40] }, type, mem, rnd, fe, name);
  if (type === 'string') return makeValue({ buffer: [0, 24], cell: [32, 126] }, type, mem, rnd, fe, name);
  if (fe && fe.records[type]) return makeValue({ record: {} }, type, mem, rnd, fe, name);
  if (fe && fe.enums[type]) { const vals = Object.values(fe.enums[type]); return vals[Math.floor(rnd() * vals.length)]; }
  const r = rnd(), edges = [0, 1, -1, 2147483647, -2147483648, 65535, 65536];
  return r < 0.72 ? between(-20, 60) : r < 0.92 ? between(-1000, 1000) : r < 0.97 ? edges[Math.floor(rnd() * edges.length)] : between(-2147483648, 2147483647);
}

WB.cases = {
  // count cases for one function, deterministic in seed
  from(p, fname, { count = 50, seed = 7, inputs = {} } = {}) {
    const f = p.fn(fname), fe = p.fe, out = [], rnd = WB.rng(seed);
    for (let k = 0; k < count; k++) {
      const mem = new Memory();
      const args = f.params.map((t, i) => makeValue(inputs[f.locals[i].name], t, mem, rnd, fe, f.locals[i].name));
      out.push({ n: k, args, memory: mem.image(), items: mem.items.slice() });
    }
    return out;
  },
  // one concrete call: bench = { name: number | {cells}|{buffer}|{string} }
  bench(p, fname, bench = {}) {
    const f = p.fn(fname), mem = new Memory(), rnd = WB.rng(1);
    const args = f.params.map((t, i) => makeValue(bench[f.locals[i].name] ?? 0, t, mem, rnd, p.fe, f.locals[i].name));
    return { args, memory: mem.image(), items: mem.items.slice() };
  },
};

// ---------- the evaluator ----------
const MASK = 31;
function binop(op, a, b) {
  switch (op) {
    case 'add': return (a + b) | 0;
    case 'sub': return (a - b) | 0;
    case 'mul': return Math.imul(a, b);
    case 'div': if (b === 0) throw new Trap('division by zero'); if (a === -2147483648 && b === -1) throw new Trap('division overflow'); return (a / b) | 0;
    case 'rem': if (b === 0) throw new Trap('division by zero'); if (b === -1) return 0; return (a % b) | 0;
    case 'and': return a & b; case 'or': return a | b; case 'xor': return a ^ b;
    case 'shl': return a << (b & MASK); case 'shr': return a >> (b & MASK); case 'shru': return (a >>> (b & MASK)) | 0;
    case 'eq': return +(a === b); case 'ne': return +(a !== b);
    case 'lt': return +(a < b); case 'gt': return +(a > b); case 'le': return +(a <= b); case 'ge': return +(a >= b);
    case 'ltu': return +((a >>> 0) < (b >>> 0)); case 'geu': return +((a >>> 0) >= (b >>> 0));
  }
  throw new Error('evaluator: unknown operator ' + op);
}
WB.binop = binop;

WB.evaluate = function evaluate(p, fname, args, memBytes, opts = {}) {
  const limit = opts.limit ?? 2e5, counts = opts.counts ? new Map() : null;
  const bytes = new Uint8Array(memBytes);
  const mem = new DataView(bytes.buffer);
  let steps = 0;
  const check = (addr, w) => { if (addr < 0 || addr + w > bytes.length) throw new Trap('memory access outside guest memory: ' + addr); };
  function call(fname, argv, depth) {
    if (depth > 64) throw new Trap('call depth');
    const f = p.fn(fname), st = p.store;
    const L = new Int32Array(f.locals.length);
    argv.forEach((a, i) => (L[i] = a));
    const ev = id => {
      const v = st.get(id);
      switch (v.op) {
        case 'const': return v.imm;
        case 'get': return L[v.imm];
        case 'eqz': return +(ev(v.args[0]) === 0);
        case 'load': { const a = ev(v.args[0]) + v.imm; check(a, 4); return mem.getInt32(a, true); }
        case 'load16u': { const a = ev(v.args[0]) + v.imm; check(a, 2); return mem.getUint16(a, true); }
        case 'call': return call(v.imm, v.args.map(ev), depth + 1);
        default: { const a = ev(v.args[0]), b = ev(v.args[1]); return binop(v.op, a, b); }
      }
    };
    let b = f.blocks[0];
    for (;;) {
      let next = null;
      for (const sid of b.stmts) {
        if (++steps > limit) { const t = new Trap('step limit ' + limit); t.limit = true; throw t; }
        if (counts) counts.set(sid, (counts.get(sid) || 0) + 1);
        const s = st.get(sid);
        switch (s.op) {
          case 'set': L[s.local] = ev(s.value); break;
          case 'eval': ev(s.value); break;
          case 'store': { const a = ev(s.addr) + s.offset, v = ev(s.value); if (s.width === 32) { check(a, 4); mem.setInt32(a, v, true); } else { check(a, 2); mem.setUint16(a, v & 65535, true); } break; }
          case 'br': next = s.to; break;
          case 'br_if': next = ev(s.cond) ? s.then : s.else; break;
          case 'return': return ev(s.value);
          case 'trap': throw new Trap(s.why || 'unreachable', sid);
        }
        if (next) break;
      }
      if (!next) next = b.succ[0];
      if (!next) throw new Trap('fell off the end of ' + b.id);
      b = st.get(next);
    }
  }
  try {
    const result = call(fname, args, 0);
    return { kind: 'run', engine: 'evaluator', trap: false, result, steps, unit: 'statements', counts, bytes };
  } catch (e) {
    if (e instanceof Trap) return { kind: 'run', engine: 'evaluator', trap: e.trap, at: e.at, limit: !!e.limit, steps, unit: 'statements', counts, bytes };
    throw e;
  }
};

// ---------- checks ----------
// Compare a program at its head revision with a baseline: the same source at r0 (our
// evaluator), an RV32 image of the head (the emulator), or recorded reference results.
const sameBytes = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
WB.outcome = r => r.trap ? 'trap' : r.result;
WB.check = function check(p, { fn, cases, against = 'r0', image = null } = {}) {
  const fname = fn || [...p.fns.keys()][0];
  cases = cases || WB.cases.from(p, fname, { count: 50 });
  const baseline = against === 'r0' ? WB.baseline(p) : null;
  let agree = 0, bothTrap = 0, inconclusive = 0;
  const counterexamples = [];
  for (const c of cases) {
    const head = WB.evaluate(p, fname, c.args, c.memory, { limit: 2e4 });
    let other;
    if (against === 'r0') other = WB.evaluate(baseline, fname, c.args, c.memory, { limit: 2e4 });
    else if (against === 'image') other = WB.runImage(image, fname, c.args, c.memory, { limit: 2e5 });
    else if (against === 'reference') other = c.reference;
    if (!other) { counterexamples.push({ n: c.n, args: c.args, status: 'unavailable' }); continue; }
    if (head.limit || other.limit) { inconclusive++; continue; } // a step limit is not a verdict
    const ok = other.fault ? false : head.trap ? !!other.trap : (!other.trap && other.result === head.result && (!other.bytes || sameBytes(other.bytes.subarray(0, head.bytes.length), head.bytes.subarray(0, Math.min(head.bytes.length, other.bytes.length)))));
    if (ok) { agree++; if (head.trap) bothTrap++; }
    else if (counterexamples.length < 5) counterexamples.push({ n: c.n, args: c.args, expected: WB.outcome(head), got: other.fault ? 'fault: ' + other.trap : WB.outcome(other), ...(against === 'r0' ? { expected: WB.outcome(other), got: WB.outcome(head) } : {}) });
  }
  const decided = cases.length - inconclusive;
  return { kind: 'check', fn: fname, against, rev: `r${p.rev}`, agree, total: decided, bothTrap, inconclusive, status: decided === 0 ? 'inconclusive' : agree === decided ? 'agree' : 'disagree', counterexamples };
};
// A fresh program from the same source, at r0: the meaning every pass must keep.
const baselines = new Map();
WB.baseline = function baseline(p) {
  const key = WB.hash(p.source);
  if (!baselines.has(key)) baselines.set(key, new WB.Program(p.name + '@r0', p.source));
  return baselines.get(key);
};
WB.Trap = Trap;
})(globalThis);
