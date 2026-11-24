// analyses.js: facts. A dataflow solver over lattices, the built-in analyses (cfg, dominators,
// loops, liveness, reaching definitions, ranges), the analysis builder, and the fact cache
// that marks facts stale when a transaction touches what they read.
(function (G) {
'use strict';
const WB = G.WB;

// ---------- lattices ----------
const setL = () => ({
  name: 'set', bottom: () => new Set(), join: (a, b) => { const s = new Set(a); for (const x of b) s.add(x); return s; },
  equal: (a, b) => a.size === b.size && [...a].every(x => b.has(x)), finiteHeight: true,
});
const TOP = 'varies', BOT = 'unknown';
const flatL = () => ({
  name: 'flat', top: TOP, bottom: () => BOT,
  join: (a, b) => a === BOT ? b : b === BOT ? a : a === b ? a : TOP, equal: (a, b) => a === b, finiteHeight: true,
  lift2: f => (a, b) => (a === BOT || b === BOT) ? BOT : (a === TOP || b === TOP) ? TOP : f(a, b),
});
const MIN = -2147483648, MAX = 2147483647;
const intervalL = () => ({
  name: 'interval', bottom: () => null, top: [MIN, MAX],
  join: (a, b) => !a ? b : !b ? a : [Math.min(a[0], b[0]), Math.max(a[1], b[1])],
  equal: (a, b) => a === b || (a && b && a[0] === b[0] && a[1] === b[1]), finiteHeight: false,
  widen: (a, b) => !a ? b : !b ? a : [b[0] < a[0] ? MIN : a[0], b[1] > a[1] ? MAX : a[1]],
});
const mapL = (inner) => ({
  name: `map(${inner.name})`, bottom: () => new Map(),
  join: (a, b) => { const m = new Map(a); for (const [k, v] of b) m.set(k, m.has(k) ? inner.join(m.get(k), v) : v); return m; },
  equal: (a, b) => a.size === b.size && [...a].every(([k, v]) => b.has(k) && inner.equal(v, b.get(k))),
  widen: inner.widen && ((a, b) => { const m = new Map(b); for (const [k, v] of b) if (a.has(k)) m.set(k, inner.widen(a.get(k), v)); return m; }),
  finiteHeight: inner.finiteHeight, inner,
});
WB.lattice = { set: setL, flat: flatL, interval: intervalL, map: mapL, TOP, BOT, MIN, MAX };

// ---------- the solver ----------
// Round-robin over blocks in reverse postorder (forward) or postorder (backward) until no
// block's fact changes. A lattice of infinite height must widen after a few visits.
WB.solve = function solve(p, f, { direction = 'forward', lattice, transfer, entry, edge, widenAfter = 3 }) {
  const cfg = WB.cfgOf(p, f);
  const order = direction === 'forward' ? cfg.rpo : cfg.rpo.slice().reverse();
  const IN = new Map(), OUT = new Map(), visits = new Map();
  for (const b of order) { IN.set(b, lattice.bottom()); OUT.set(b, lattice.bottom()); }
  if (!lattice.finiteHeight && !lattice.widen) WB.fail('noWidening', `lattice "${lattice.name}" has infinite height, so iteration may never stop`, { fix: '.widen(…) on the analysis, or a lattice of finite height' });
  // widening happens only where a back edge enters (loop heads), so refinements inside the body survive
  const pos = new Map(cfg.rpo.map((b, i) => [b, i]));
  const heads = new Set(cfg.rpo.filter(b => cfg.preds.get(b).some(q => pos.get(q) >= pos.get(b))));
  const tails = new Set(cfg.rpo.filter(b => cfg.succ.get(b).some(s => pos.get(s) <= pos.get(b))));
  let changed = true, rounds = 0, total = 0;
  while (changed) {
    changed = false; rounds++;
    if (rounds > 200) WB.fail('noFixpoint', `${f.name}: no fixpoint after 200 rounds`);
    for (const b of order) {
      total++;
      const n = (visits.get(b) || 0) + 1; visits.set(b, n);
      if (direction === 'forward') {
        let inn = b === cfg.entry && entry ? entry() : lattice.bottom();
        for (const q of cfg.preds.get(b)) inn = lattice.join(inn, edge ? edge(q, b, OUT.get(q)) : OUT.get(q));
        if (lattice.widen && n > widenAfter && heads.has(b)) inn = lattice.widen(IN.get(b), inn);
        const out = transfer(p.store.get(b), inn);
        if (!lattice.equal(inn, IN.get(b))) { IN.set(b, inn); changed = true; }
        if (!lattice.equal(out, OUT.get(b))) { OUT.set(b, out); changed = true; }
      } else {
        let out = lattice.bottom();
        for (const s of cfg.succ.get(b)) out = lattice.join(out, IN.get(s));
        let inn = transfer(p.store.get(b), out);
        if (lattice.widen && n > widenAfter && (tails.has(b) || !tails.size)) inn = lattice.widen(IN.get(b), inn);
        OUT.set(b, out);
        if (!lattice.equal(inn, IN.get(b))) { IN.set(b, inn); changed = true; }
      }
    }
  }
  return { in: IN, out: OUT, rounds, visits: total, heads: [...heads] };
};

// ---------- helpers over value trees ----------
WB.readsOf = function readsOf(p, id, acc = new Set()) { if (!id) return acc; const v = p.store.get(id); if (v.op === 'get') acc.add(v.imm); for (const a of v.args) readsOf(p, a, acc); return acc; };
WB.hasEffect = function hasEffect(p, id) { if (!id) return false; const v = p.store.get(id); return v.op === 'call' || v.op === 'load' || v.op === 'load16u' || v.op === 'div' || v.op === 'rem' || v.args.some(a => hasEffect(p, a)); };
WB.isPure = function isPure(p, id) { const v = p.store.get(id); if (['call', 'load', 'load16u', 'div', 'rem'].includes(v.op)) return false; return v.args.every(a => isPure(p, a)); };
const stmtValues = s => [s.value, s.cond, s.addr].filter(Boolean);
WB.stmtValues = stmtValues;

// ---------- built-in analyses ----------
function cfgOf(p, f) {
  const succ = new Map(), preds = new Map();
  for (const b of f.blocks) { succ.set(b.id, b.succ.slice()); preds.set(b.id, []); }
  for (const b of f.blocks) for (const s of b.succ) if (preds.has(s)) preds.get(s).push(b.id);
  const order = [], seen = new Set();
  const dfs = id => { if (seen.has(id) || !succ.has(id)) return; seen.add(id); for (const s of succ.get(id)) dfs(s); order.push(id); };
  dfs(f.blocks[0].id);
  return { entry: f.blocks[0].id, succ, preds, rpo: order.reverse(), edges: f.blocks.reduce((n, b) => n + b.succ.length, 0) };
}
WB.cfgOf = cfgOf;

function dominators(p, f) {
  const cfg = cfgOf(p, f), rpo = cfg.rpo, idx = new Map(rpo.map((id, i) => [id, i]));
  const idom = new Map([[rpo[0], rpo[0]]]);
  const inter = (a, b) => { while (a !== b) { while (idx.get(a) > idx.get(b)) a = idom.get(a); while (idx.get(b) > idx.get(a)) b = idom.get(b); } return a; };
  let changed = true, rounds = 0;
  while (changed) {
    changed = false; rounds++;
    for (const id of rpo.slice(1)) {
      let n = null;
      for (const q of cfg.preds.get(id)) if (idom.has(q)) n = n === null ? q : inter(q, n);
      if (idom.get(id) !== n) { idom.set(id, n); changed = true; }
    }
  }
  const dominates = (a, b) => { for (;;) { if (a === b) return true; const d = idom.get(b); if (!d || d === b) return false; b = d; } };
  const children = new Map(rpo.map(id => [id, []]));
  for (const [b, d] of idom) if (b !== d) children.get(d).push(b);
  return { idom, dominates, children, rounds, rpo };
}

function loops(p, f) {
  const dom = WB.factOf(p, 'dominators', f.name).value, cfg = cfgOf(p, f), out = [];
  for (const b of f.blocks) for (const s of b.succ) if (dom.dominates(s, b.id)) {
    const body = new Set([s]), work = [b.id];
    while (work.length) { const x = work.pop(); if (body.has(x)) continue; body.add(x); work.push(...cfg.preds.get(x)); }
    const outside = cfg.preds.get(s).filter(q => !body.has(q));
    const pre = outside.length === 1 && cfg.succ.get(outside[0]).length === 1 ? outside[0] : null;
    const exits = [...body].flatMap(x => cfg.succ.get(x).filter(y => !body.has(y)));
    const assigned = new Set();
    for (const x of body) for (const sid of p.store.get(x).stmts) { const st = p.store.get(sid); if (st.op === 'set') assigned.add(st.local); }
    out.push({ id: `loop:${f.name}@${s}`, head: s, latch: b.id, body: [...body], preheader: pre, exits: [...new Set(exits)], assigned: [...assigned] });
  }
  return out;
}

function liveness(p, f) {
  const use = new Map(), def = new Map();
  for (const b of f.blocks) {
    const u = new Set(), d = new Set();
    for (const sid of b.stmts) {
      const s = p.store.get(sid);
      for (const v of stmtValues(s)) for (const l of WB.readsOf(p, v)) if (!d.has(l)) u.add(l);
      if (s.op === 'set') d.add(s.local);
    }
    use.set(b.id, u); def.set(b.id, d);
  }
  const r = WB.solve(p, f, { direction: 'backward', lattice: setL(),
    transfer: (b, out) => { const s = new Set(use.get(b.id)); for (const l of out) if (!def.get(b.id).has(l)) s.add(l); return s; } });
  // live after each statement
  const after = new Map();
  for (const b of f.blocks) {
    const now = new Set(r.out.get(b.id));
    for (let i = b.stmts.length - 1; i >= 0; i--) {
      const s = p.store.get(b.stmts[i]);
      after.set(s.id, new Set(now));
      if (s.op === 'set') now.delete(s.local);
      for (const v of stmtValues(s)) for (const l of WB.readsOf(p, v)) now.add(l);
    }
  }
  return { in: r.in, out: r.out, after, visits: r.visits, rounds: r.rounds,
    liveAfter: sid => after.get(sid) || new Set(), names: set => [...set].map(l => f.locals[l].name) };
}

// Reaching definitions: which assignments (or the parameter itself) can reach each read.
function reaching(p, f) {
  const defsOf = new Map();
  for (const b of f.blocks) for (const sid of b.stmts) { const s = p.store.get(sid); if (s.op === 'set') { if (!defsOf.has(s.local)) defsOf.set(s.local, []); defsOf.get(s.local).push(sid); } }
  const local = d => d.startsWith('param:') || d.startsWith('init:') ? +d.split(':')[1] : p.store.get(d).local;
  const r = WB.solve(p, f, { direction: 'forward', lattice: setL(),
    entry: () => new Set(f.locals.map((l, i) => (l.param ? 'param:' : 'init:') + i)),
    transfer: (b, inn) => { const s = new Set(inn); for (const sid of b.stmts) { const st = p.store.get(sid); if (st.op === 'set') { for (const d of [...s]) if (local(d) === st.local) s.delete(d); s.add(sid); } } return s; } });
  const before = new Map();
  for (const b of f.blocks) {
    const now = new Set(r.in.get(b.id));
    for (const sid of b.stmts) { before.set(sid, new Set(now)); const st = p.store.get(sid); if (st.op === 'set') { for (const d of [...now]) if (local(d) === st.local) now.delete(d); now.add(sid); } }
  }
  return { in: r.in, out: r.out, visits: r.visits, defsOf,
    reachingAt: (sid, l) => [...(before.get(sid) || [])].filter(d => local(d) === l) };
}

// Ranges: an interval for every local at every point, with branch refinement and widening.
function evalRange(p, id, env) {
  const v = p.store.get(id), I = (lo, hi) => [Math.max(MIN, lo), Math.min(MAX, hi)];
  const full = [MIN, MAX];
  switch (v.op) {
    case 'const': return [v.imm, v.imm];
    case 'get': return env.get(v.imm) || full;
    case 'eqz': case 'eq': case 'ne': case 'lt': case 'gt': case 'le': case 'ge': case 'ltu': case 'geu': return [0, 1];
    case 'load16u': return [0, 65535];
  }
  if (v.args.length !== 2) return full;
  const a = evalRange(p, v.args[0], env), b = evalRange(p, v.args[1], env);
  const fits = (lo, hi) => lo >= MIN && hi <= MAX ? [lo, hi] : full;
  switch (v.op) {
    case 'add': return fits(a[0] + b[0], a[1] + b[1]);
    case 'sub': return fits(a[0] - b[1], a[1] - b[0]);
    case 'mul': { const c = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]; return fits(Math.min(...c), Math.max(...c)); }
    case 'shl': return b[0] === b[1] && b[0] >= 0 && b[0] < 31 ? fits(a[0] * 2 ** b[0], a[1] * 2 ** b[0]) : full;
    case 'shr': return b[0] === b[1] && b[0] >= 0 ? [a[0] >> b[0], a[1] >> b[0]] : full;
    case 'div': return b[0] > 0 ? I(Math.min(Math.trunc(a[0] / b[0]), 0), Math.max(Math.trunc(a[1] / b[0]), 0)) : full;
    case 'rem': return b[0] > 0 ? I(a[0] < 0 ? -(b[1] - 1) : 0, a[1] < 0 ? 0 : b[1] - 1) : full;
    case 'and': return a[0] >= 0 || b[0] >= 0 ? [0, Math.min(a[0] >= 0 ? a[1] : MAX, b[0] >= 0 ? b[1] : MAX)] : full;
  }
  return full;
}
WB.evalRange = evalRange;
function refine(p, cond, env, taken) {
  const v = p.store.get(cond);
  if (v.op === 'eqz') return refine(p, v.args[0], env, !taken);
  if (!['lt', 'le', 'gt', 'ge'].includes(v.op)) return env;
  let [x, y] = v.args.map(a => p.store.get(a));
  let op = v.op;
  const flip = { lt: 'gt', gt: 'lt', le: 'ge', ge: 'le' }, neg = { lt: 'ge', ge: 'lt', le: 'gt', gt: 'le' };
  if (!taken) op = neg[op];
  const m = new Map(env);
  const narrow = (local, op, r) => {
    const cur = m.get(local) || [MIN, MAX];
    let [lo, hi] = cur;
    if (op === 'lt') hi = Math.min(hi, r[1] - 1); if (op === 'le') hi = Math.min(hi, r[1]);
    if (op === 'gt') lo = Math.max(lo, r[0] + 1); if (op === 'ge') lo = Math.max(lo, r[0]);
    m.set(local, lo > hi ? [lo, lo] : [lo, hi]);
  };
  if (x.op === 'get') narrow(x.imm, op, evalRange(p, y.id, env));
  if (y.op === 'get') narrow(y.imm, flip[op], evalRange(p, x.id, env));
  return m;
}
function ranges(p, f) {
  const L = mapL(intervalL());
  const step = (env, s) => { if (s.op === 'set') { const m = new Map(env); m.set(s.local, evalRange(p, s.value, env)); return m; } return env; };
  const params = () => new Map(f.locals.map((l, i) => [i, l.param ? (l.type === 'bool' ? [0, 1] : [MIN, MAX]) : [0, 0]]));
  const r = WB.solve(p, f, { direction: 'forward', lattice: L, entry: params, widenAfter: 3,
    transfer: (b, inn) => b.stmts.reduce((env, sid) => step(env, p.store.get(sid)), inn),
    edge: (from, to, out) => {
      const b = p.store.get(from), last = p.store.get(b.stmts.at(-1));
      if (last && last.op === 'br_if' && last.then !== last.else) return refine(p, last.cond, out, last.then === to);
      return out;
    } });
  const before = new Map();
  for (const b of f.blocks) {
    let env = r.in.get(b.id);
    for (const sid of b.stmts) { before.set(sid, env); env = step(env, p.store.get(sid)); }
  }
  return { in: r.in, out: r.out, visits: r.visits, rounds: r.rounds,
    at: (sid, local) => (before.get(sid) || new Map()).get(local) || [MIN, MAX],
    of: (sid, valueId) => evalRange(p, valueId, before.get(sid) || new Map()) };
}

WB.analyses = new Map();
WB.defineAnalysis = (name, def) => { WB.analyses.set(name, { name, ...def }); return WB.analyses.get(name); };
WB.defineAnalysis('cfg', { about: 'successors, predecessors and reverse postorder', compute: cfgOf, reads: ['cfg'] });
WB.defineAnalysis('dominators', { about: 'immediate dominators (Cooper, Harvey and Kennedy)', compute: dominators, reads: ['cfg'] });
WB.defineAnalysis('loops', { about: 'natural loops from back edges, with preheaders and assigned locals', compute: loops, reads: ['cfg', 'stmts'] });
WB.defineAnalysis('liveness', { about: 'locals live into and out of each block, and after each statement', compute: liveness, reads: ['cfg', 'stmts', 'values'] });
WB.defineAnalysis('reaching', { about: 'reaching definitions: which assignments reach each read', compute: reaching, reads: ['cfg', 'stmts'] });
WB.defineAnalysis('ranges', { about: 'an interval for each local at each statement, with widening', compute: ranges, reads: ['cfg', 'stmts', 'values'] });

// ---------- the fact cache ----------
// A fact is fresh for the revision it was computed at, until a transaction touches its
// function without declaring the analysis preserved.
WB.factOf = function factOf(p, name, fname) {
  const a = WB.analyses.get(name);
  if (!a) WB.fail('unknownAnalysis', `no analysis named "${name}".` + (WB.didYouMean(name, [...WB.analyses.keys()]) ? ` Did you mean "${WB.didYouMean(name, [...WB.analyses.keys()])}"?` : ''), { fix: `analyses: ${[...WB.analyses.keys()].join(', ')}` });
  const key = `${name}:${fname}`;
  const cached = p.facts.get(key);
  if (cached && cached.status === 'fresh') return cached;
  const f = p.fn(fname), t0 = WB.now();
  const value = a.compute(p, f);
  const fact = { id: `fact:${name}(${fname})@r${p.rev}`, kind: 'fact', analysis: name, fn: fname, rev: p.rev, status: 'fresh', value, ms: +(WB.now() - t0).toFixed(2), visits: value.visits, reads: a.reads };
  p.facts.set(key, fact);
  return fact;
};
WB.invalidate = function invalidate(p, fname, preserves = [], byPass = '') {
  for (const [key, fact] of p.facts) if (fact.fn === fname && fact.status === 'fresh' && !preserves.includes(fact.analysis)) { fact.status = 'stale'; fact.staleAt = p.rev; fact.staleBy = byPass; }
};

// ---------- the analysis builder ----------
// wb.analysis('name').direction('forward').lattice(L).transfer((block, value) => value)
WB.analysisBuilder = function analysisBuilder(name) {
  const spec = { name, direction: 'forward', lattice: null, transfer: null, reads: ['cfg', 'stmts', 'values'], entry: null, about: '' };
  const b = {
    direction(d) { if (!['forward', 'backward'].includes(d)) WB.fail('badArgument', `direction is 'forward' or 'backward', not ${d}`); spec.direction = d; return b; },
    forward() { spec.direction = 'forward'; return b; },
    backward() { spec.direction = 'backward'; return b; },
    lattice(L) { spec.lattice = L; return b; },
    transfer(fn) { spec.transfer = fn; return b; },
    entry(fn) { spec.entry = fn; return b; },
    reads(...r) { spec.reads = r; return b; },
    about(text) { spec.about = text; return b; },
    widen(fn) { spec.lattice = { ...spec.lattice, widen: fn }; return b; },
    register() {
      if (!spec.lattice) WB.fail('incomplete', `analysis "${name}" has no .lattice(…)`, { fix: '.lattice(wb.lattice.set())' });
      if (!spec.transfer) WB.fail('incomplete', `analysis "${name}" has no .transfer(…)`);
      if (!spec.lattice.finiteHeight && !spec.lattice.widen) WB.fail('noWidening', `analysis "${name}": lattice "${spec.lattice.name}" has infinite height, so iteration may never stop`, { fix: 'add .widen((old, next) => …)' });
      return WB.defineAnalysis(name, { about: spec.about || `user analysis (${spec.direction})`, reads: spec.reads, user: true,
        compute: (p, f) => WB.solve(p, f, { direction: spec.direction, lattice: spec.lattice, entry: spec.entry && (() => spec.entry(f)),
          transfer: (block, v) => spec.transfer(WB.handle(p, block.id), v) }) });
    },
  };
  return WB.guard('AnalysisBuilder', b);
};
})(globalThis);
