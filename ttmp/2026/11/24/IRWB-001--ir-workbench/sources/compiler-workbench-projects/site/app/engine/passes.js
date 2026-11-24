// passes.js: transactions, the pass builder, the pass manager, pipelines, and the built-in
// passes. A pass changes a program only through tx, and every change records its origin.
(function (G) {
'use strict';
const WB = G.WB;
const KINDS = ['values', 'stmts', 'locals', 'cfg'];

// ---------- transactions ----------
class Tx {
  constructor(p, f, pass) {
    this.p = p; this.fn = f; this.pass = pass; this.rev = p.rev + 1; this.edits = [];
    this.writes = new Set(pass.writes || KINDS);
    this.store = p.store;
  }
  _may(kind, what) {
    if (!this.writes.has(kind)) WB.fail('undeclaredWrite', `pass "${this.pass.name}" ${what} (it changes ${kind}) but declares writes(${[...this.writes].map(k => `'${k}'`).join(', ')}).`, { fix: `.writes(${[...this.writes, kind].map(k => `'${k}'`).join(', ')})` });
  }
  _origin(from, opts = {}) { return [{ from, via: this.pass.name, kind: 'recorded', rev: this.rev, because: (opts.because || []).map(b => typeof b === 'object' && b ? b.id : b), ...(opts.note ? { note: opts.note } : {}) }]; }
  _id(x) { return typeof x === 'object' && x ? x.id : x; }
  record(kind, detail) { const e = { id: `edit:r${this.rev}.${this.edits.length}`, rev: this.rev, pass: this.pass.name, fn: this.fn.name, kind, ...detail }; this.edits.push(e); return e; }
  // values
  const(n, opts = {}) { this._may('values', 'made a constant'); return this.store.add({ id: this.store.fresh(`v:${this.fn.name}`), kind: 'value', fn: this.fn.id, op: 'const', args: [], imm: n | 0, origin: this._origin(this._id(opts.from) || this._cur, opts) }).id; }
  make(op, ...args) {
    this._may('values', 'made a value');
    const opts = args.length && typeof args.at(-1) === 'object' && args.at(-1) && !args.at(-1).id && !Array.isArray(args.at(-1)) ? args.pop() : {};
    const imm = opts.imm;
    return this.store.add({ id: this.store.fresh(`v:${this.fn.name}`), kind: 'value', fn: this.fn.id, op, args: args.map(a => this._id(a)), imm, origin: this._origin(this._id(opts.from) || this._cur, opts) }).id;
  }
  get(local, opts = {}) { return this.make('get', { imm: this._local(local), ...opts }); }
  _local(l) { if (typeof l === 'number') return l; if (typeof l === 'string') { const i = this.fn.locals.findIndex(x => x.name === l); if (i < 0) WB.fail('unknownLocal', `${this.fn.name} has no local "${l}"`); return i; } return l.index; }
  local(name, opts = {}) {
    this._may('locals', 'made a local');
    let n = name, k = 1; while (this.fn.locals.some(l => l.name === n)) n = name + (k++);
    const index = this.fn.locals.length;
    this.fn.locals.push({ index, name: n, type: opts.type || 'i32', param: false, mutable: true, madeBy: this.pass.name, rev: this.rev });
    this.record('local', { local: `local:${this.fn.name}/${n}`, name: n, because: (opts.because || []).map(b => this._id(b)) });
    return index;
  }
  // statements
  set(local, value, opts = {}) {
    this._may('stmts', 'made a statement');
    return this.store.add({ id: this.store.fresh(`s:${this.fn.name}`), kind: 'stmt', fn: this.fn.id, op: 'set', local: this._local(local), value: this._id(value), origin: this._origin(this._id(opts.from) || this._id(value), opts) }).id;
  }
  stmt(fields, opts = {}) {
    this._may('stmts', 'made a statement');
    return this.store.add({ id: this.store.fresh(`s:${this.fn.name}`), kind: 'stmt', fn: this.fn.id, ...fields, origin: this._origin(this._id(opts.from), opts) }).id;
  }
  _blockOf(sid) { return this.fn.blocks.find(b => b.stmts.includes(sid)); }
  insert(position, sid, opts = {}) {
    this._may('stmts', 'inserted a statement');
    sid = this._id(sid);
    const { block, index } = this._pos(position);
    block.stmts.splice(index, 0, sid);
    this.record('insert', { stmt: sid, block: block.id, at: index, because: (opts.because || []).map(b => this._id(b)) });
    return sid;
  }
  _pos(position) {
    if (position && position.block && position.index !== undefined) return position;
    WB.fail('badPosition', 'insert needs a position: tx.at.end(block), tx.at.before(stmt) or tx.at.after(stmt)');
  }
  get at() {
    const self = this;
    return {
      end(block) { const b = self.store.get(self._id(block)); const last = b.stmts.length && self.store.get(b.stmts.at(-1)); const term = last && ['br', 'br_if', 'return', 'trap'].includes(last.op); return { block: b, index: b.stmts.length - (term ? 1 : 0) }; },
      start(block) { return { block: self.store.get(self._id(block)), index: 0 }; },
      before(stmt) { const sid = self._id(stmt), b = self._blockOf(sid); return { block: b, index: b.stmts.indexOf(sid) }; },
      after(stmt) { const sid = self._id(stmt), b = self._blockOf(sid); return { block: b, index: b.stmts.indexOf(sid) + 1 }; },
    };
  }
  remove(stmt, opts = {}) {
    this._may('stmts', 'removed a statement');
    const sid = this._id(stmt);
    if (!opts.because || !opts.because.length) WB.fail('missingBecause', `tx.remove(${sid}) needs { because: [...] }: the facts or entities that make the removal valid`);
    const b = this._blockOf(sid);
    if (!b) WB.fail('absent', `${sid} is not in ${this.fn.name} at this revision`);
    b.stmts.splice(b.stmts.indexOf(sid), 1);
    this.record('remove', { stmt: sid, block: b.id, text: WB.showStmt(this.p, sid), because: opts.because.map(x => this._id(x)) });
  }
  move(stmt, position, opts = {}) {
    this._may('stmts', 'moved a statement');
    const sid = this._id(stmt), b = this._blockOf(sid);
    b.stmts.splice(b.stmts.indexOf(sid), 1);
    const { block, index } = this._pos(position);
    block.stmts.splice(index, 0, sid);
    this.record('move', { stmt: sid, from: b.id, to: block.id, because: (opts.because || []).map(x => this._id(x)) });
  }
  // replace one statement's value field, or a whole statement
  setField(stmt, field, value, opts = {}) {
    const s = this.store.get(this._id(stmt));
    if (['value', 'cond', 'addr'].includes(field)) this._may('values', 'changed a value'); else this._may('cfg', 'changed a branch');
    const from = s[field];
    s[field] = this._id(value);
    this.record(['to', 'then', 'else'].includes(field) ? 'retarget' : 'replace', { stmt: s.id, field, from, to: s[field], because: (opts.because || []).map(x => this._id(x)) });
  }
  replaceStmt(old, fields, opts = {}) {
    this._may('stmts', 'replaced a statement');
    if (fields.op === 'br' || fields.op === 'br_if') this._may('cfg', 'changed a branch');
    const oid = this._id(old), b = this._blockOf(oid);
    const nid = this.stmt(fields, { from: oid, ...opts });
    b.stmts[b.stmts.indexOf(oid)] = nid;
    this.record('replaceStmt', { from: oid, to: nid, block: b.id, text: WB.showStmt(this.p, nid), because: (opts.because || []).map(x => this._id(x)) });
    return nid;
  }
  block(opts = {}) {
    this._may('cfg', 'made a block');
    const b = this.store.add({ id: this.store.fresh(`bb:${this.fn.name}`).replace(/\.(\d+)$/, (m, n) => '.n' + n), kind: 'block', fn: this.fn.id, stmts: [], succ: [], origin: this._origin(this._id(opts.from), opts) });
    this.fn.blocks.push(b);
    this.record('block', { block: b.id, because: (opts.because || []).map(x => this._id(x)) });
    return b.id;
  }
  // Rebuild every live statement's trees bottom-up; visit(handle) returns a new value id or nothing.
  rewrite(visit, blocks = this.fn.blocks, opts = {}) {
    const walk = id => {
      const v = this.store.get(id);
      const args = v.args.map(walk);
      let cur = id;
      if (args.some((a, i) => a !== v.args[i])) { this._may('values', 'rebuilt a value'); cur = this.store.add({ id: this.store.fresh(`v:${this.fn.name}`), kind: 'value', fn: this.fn.id, op: v.op, args, imm: v.imm, origin: this._origin(id, { note: 'rebuilt around a changed argument' }) }).id; }
      this._cur = cur;
      const r = visit(WB.handle(this.p, cur, { stmt: this._sid }));
      this._cur = null;
      return r ? this._id(r) : cur;
    };
    for (const b of blocks) for (const sid of b.stmts.slice()) {
      const s = this.store.get(sid);
      this._sid = sid;
      for (const k of ['value', 'cond', 'addr']) if (s[k]) {
        const n = walk(s[k]);
        if (n !== s[k]) { this.record('replace', { stmt: sid, field: k, from: s[k], to: n, text: WB.show(this.p, n), because: (opts.because || []).map(x => this._id(x)) }); s[k] = n; }
      }
    }
  }
  // Replace one value wherever it occurs (it has one user), rebuilding its parents.
  replace(old, next, opts = {}) {
    const oid = this._id(old), nid = this._id(next);
    let found = false;
    this.rewrite(h => { if (h.id === oid) { found = true; return nid; } }, this.fn.blocks, opts);
    if (!found) WB.fail('absent', `${oid} is not used in ${this.fn.name} at this revision`);
    return nid;
  }
  note(text) { this.record('note', { text }); }
  // derive successors from terminators, then drop unreachable blocks
  commit() {
    for (const b of this.fn.blocks) {
      const last = b.stmts.length ? this.store.get(b.stmts.at(-1)) : null;
      const succ = !last ? b.succ : last.op === 'br' ? [last.to] : last.op === 'br_if' ? [last.then, last.else] : (last.op === 'return' || last.op === 'trap') ? [] : b.succ;
      b.succ = [...new Set(succ)];
    }
    const gone = WB.prune(this.p.store, this.fn);
    for (const b of gone) this.edits.push({ id: `edit:r${this.rev}.${this.edits.length}`, rev: this.rev, pass: this.pass.name, fn: this.fn.name, kind: 'unreachable', block: b.id, because: ['cfg'] });
  }
}
WB.Tx = Tx;

// ---------- passes ----------
WB.passes = new Map();
WB.definePass = function definePass(def) {
  const pass = { about: '', needs: {}, writes: KINDS, preserves: [], ...def };
  WB.passes.set(pass.name, pass);
  return pass;
};
// wb.pass('name').needs({ live: 'liveness' }).writes('stmts').preserves('cfg').run((fn, tx, facts) => …)
WB.passBuilder = function passBuilder(name) {
  const spec = { name, about: '', needs: {}, writes: [], preserves: [], user: true };
  const b = {
    about(t) { spec.about = t; return b; },
    needs(m) { for (const [k, v] of Object.entries(m)) { const a = typeof v === 'string' ? v : v && v.name; if (!WB.analyses.has(a)) WB.fail('unknownAnalysis', `needs: no analysis "${a}"`, { fix: `analyses: ${[...WB.analyses.keys()].join(', ')}` }); spec.needs[k] = a; } return b; },
    writes(...k) { for (const x of k) if (!KINDS.includes(x)) WB.fail('badArgument', `writes: "${x}" is not one of ${KINDS.join(', ')}`); spec.writes = k; return b; },
    preserves(...a) { spec.preserves = a; return b; },
    run(fn) { spec.run = fn; return WB.definePass(spec); },
  };
  return WB.guard('PassBuilder', b);
};
WB.resolvePass = function resolvePass(x) {
  if (typeof x === 'string') {
    const p = WB.passes.get(x);
    if (!p) WB.fail('unknownPass', `no pass named "${x}".` + (WB.didYouMean(x, [...WB.passes.keys()]) ? ` Did you mean "${WB.didYouMean(x, [...WB.passes.keys()])}"?` : ''), { fix: `passes: ${[...WB.passes.keys()].join(', ')}` });
    return p;
  }
  if (x && x.run) return x;
  WB.fail('notAPass', 'expected a pass name or a pass made with wb.pass(name)…run(fn)');
};

// Run one pass over every function (or one), as one revision. Returns what changed.
WB.applyPass = function applyPass(p, x, opts = {}) {
  const pass = WB.resolvePass(x);
  if (p.status !== 'ok') WB.fail('notCompiled', `${p.id} did not compile: ${p.error && p.error.message}`);
  const t0 = WB.now(), edits = [], fnames = opts.fn ? [opts.fn] : [...p.fns.keys()];
  const touched = [];
  try {
    for (const name of fnames) {
      const f = p.fn(name);
      const facts = {};
      for (const [alias, a] of Object.entries(pass.needs)) facts[alias] = WB.factOf(p, a, name).value;
      const guarded = WB.guard('Facts', facts, []);
      const tx = new Tx(p, f, pass);
      tx.rev = p.rev + 1;
      pass.run(WB.handle(p, f.id), tx, guarded, opts.params || {});
      tx.commit();
      if (tx.edits.length) { edits.push(...tx.edits); touched.push(name); }
    }
  } catch (e) {
    p.restore(p.revisions[p.rev].snapshot);
    throw e;
  }
  if (!edits.length) return { pass: pass.name, rev: `r${p.rev}`, edits: 0, changed: false, ms: +(WB.now() - t0).toFixed(2) };
  p.revisions.push({ rev: p.rev + 1, pass: pass.name, edits, snapshot: p.snapshot(), ms: +(WB.now() - t0).toFixed(2), fns: touched });
  for (const name of touched) WB.invalidate(p, name, pass.preserves, pass.name);
  return { pass: pass.name, rev: `r${p.rev}`, edits: edits.length, changed: true, kinds: countKinds(edits), ms: p.revisions[p.rev].ms };
};
const countKinds = edits => edits.reduce((m, e) => (m[e.kind] = (m[e.kind] || 0) + 1, m), {});

// Dry run: what would a pass change now? Runs it and rolls back.
WB.dryRun = function dryRun(p, x) {
  const before = p.rev;
  try {
    const r = WB.applyPass(p, x);
    // what would change, edit by edit (the ids name entities of the discarded revision)
    const changes = p.rev > before ? p.revisions[p.rev].edits.map(e => ({ fn: e.fn, kind: e.kind, ...(e.from ? { from: e.from } : {}), ...(e.text ? { text: e.text } : {}), ...(e.because ? { because: e.because.slice() } : {}), ...(e.note ? { note: e.note } : {}) })) : [];
    if (p.rev > before) p.checkout(before);
    return { pass: r.pass, edits: r.edits, kinds: r.kinds || {}, changes };
  }
  catch (e) { if (p.rev > before) p.checkout(before); return { pass: WB.resolvePass(x).name, edits: 0, error: e.message }; }
};

// ---------- pipelines: a DAG of passes and the analyses they need ----------
WB.pipelineBuilder = function pipelineBuilder(name) {
  const steps = [];
  let checkEach = null;
  const b = {
    pipe(x, opts = {}) { const pass = WB.resolvePass(x); steps.push({ kind: 'pass', pass: pass.name, when: opts.when || null, params: opts.params || {} }); return b; },
    repeat(times, sub) { const inner = WB.pipelineBuilder(name + '/repeat'); sub(inner); steps.push({ kind: 'repeat', times, steps: inner._steps() }); return b; },
    checkEach(on = true, opts = {}) { checkEach = on ? { count: opts.count || 40, seed: opts.seed || 7 } : null; return b; },
    _steps() { return steps; },
    build() { return WB.guard('Plan', makePlan(name, steps.slice(), checkEach)); },
  };
  return WB.guard('PipelineBuilder', b);
};
function makePlan(name, steps, checkEach) {
  const flat = (ss, depth = 0) => ss.flatMap(s => s.kind === 'repeat' ? [{ ...s, depth }, ...flat(s.steps, depth + 1)] : [{ ...s, depth }]);
  const plan = {
    name, steps,
    explain() {
      const lines = [`pipeline ${name} · ${flat(steps).filter(s => s.kind === 'pass').length} passes` + (checkEach ? ` · check after each pass (${checkEach.count} cases)` : '')];
      for (const s of flat(steps)) {
        if (s.kind === 'repeat') { lines.push('  '.repeat(s.depth + 1) + `repeat ${s.times === 'unchanged' ? 'until unchanged' : s.times + '×'}:`); continue; }
        const p = WB.passes.get(s.pass);
        const needs = Object.values(p.needs);
        lines.push('  '.repeat(s.depth + 1) + `${p.name.padEnd(12)}${needs.length ? 'needs ' + needs.join(', ') + ' · ' : ''}writes ${p.writes.join(', ')}` + (p.preserves.length ? ` · preserves ${p.preserves.join(', ')}` : '') + (s.when ? ' · when ' + s.when : ''));
      }
      return lines.join('\n');
    },
    params() { return flat(steps).filter(s => s.kind === 'pass').map(s => ({ name: s.pass, kind: 'bool', default: true })); },
    run(p, { enabled = null, onStep = null } = {}) {
      const log = [];
      const exec = (ss) => {
        for (const s of ss) {
          if (s.kind === 'repeat') {
            const n = s.times === 'unchanged' ? 8 : s.times;
            for (let i = 0; i < n; i++) { const before = p.rev; exec(s.steps); if (s.times === 'unchanged' && p.rev === before) break; }
            continue;
          }
          if (enabled && enabled[s.pass] === false) { log.push({ pass: s.pass, skipped: true }); continue; }
          const r = WB.applyPass(p, s.pass, { params: s.params });
          if (checkEach && r.changed) {
            const fns = [...p.fns.keys()];
            r.check = fns.map(fn => { const c = WB.check(p, { fn, cases: WB.cases.from(p, fn, { count: checkEach.count, seed: checkEach.seed, inputs: (p.inputs || {})[fn] || {} }) }); return { fn, agree: c.agree, total: c.total, status: c.status, counterexamples: c.counterexamples.slice(0, 2) }; });
          }
          log.push(r);
          if (onStep) onStep(r);
        }
      };
      exec(steps);
      return { kind: 'pipelineRun', pipeline: name, program: p.id, rev: `r${p.rev}`, steps: log };
    },
  };
  return plan;
}

// ---------- built-in passes ----------
const H = (fn) => fn; // marker for readability
const isPow2 = n => n > 0 && (n & (n - 1)) === 0;
const log2 = n => 31 - Math.clz32(n);
const FOLDABLE = new Set(['add', 'sub', 'mul', 'and', 'or', 'xor', 'shl', 'shr', 'shru', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'ltu', 'geu', 'div', 'rem']);

WB.definePass({
  name: 'fold', about: 'constant folding: an operator whose operands are constants becomes a constant',
  writes: ['values'], preserves: ['cfg', 'dominators', 'loops', 'liveness', 'reaching'],
  run: H((fn, tx) => tx.rewrite(v => {
    if (v.op === 'eqz' && v.args[0].isConst) return tx.const(+(v.args[0].imm === 0), { because: [v.args[0]] });
    if (!FOLDABLE.has(v.op) || !v.args.every(a => a.isConst)) return;
    const [a, b] = v.args.map(x => x.imm);
    if ((v.op === 'div' || v.op === 'rem') && (b === 0 || (a === -2147483648 && b === -1))) return; // keep the trap
    return tx.const(WB.binop(v.op, a, b), { because: v.args });
  })),
});

WB.definePass({
  name: 'simplify', about: 'algebraic identities: x+0, x*1, x*2^k, x-x, !!x and inverted comparisons',
  writes: ['values'], preserves: ['cfg', 'dominators', 'loops'],
  run: H((fn, tx) => tx.rewrite(v => {
    const [a, b] = v.args, k = b && b.isConst ? b.imm : null, ka = a && a.isConst ? a.imm : null;
    const note = text => ({ because: v.args.filter(x => x.isConst), note: text });
    switch (v.op) {
      case 'add': if (k === 0) return a.id; if (ka === 0) return b.id; break;
      case 'sub': if (k === 0) return a.id; if (a.isPure && a.same(b)) return tx.const(0, note('x - x')); break;
      case 'mul':
        if (k === 1) return a.id; if (ka === 1) return b.id;
        if (k === 0 && a.isPure) return tx.const(0, note('x * 0'));
        if (ka === 0 && b.isPure) return tx.const(0, note('0 * x'));
        if (k !== null && isPow2(k)) return tx.make('shl', a.id, tx.const(log2(k)), note(`x * ${k} = x << ${log2(k)}`));
        if (ka !== null && isPow2(ka)) return tx.make('shl', b.id, tx.const(log2(ka)), note(`${ka} * x = x << ${log2(ka)}`));
        break;
      case 'div': if (k === 1) return a.id; break;
      case 'or': case 'xor': case 'shl': case 'shr': case 'shru': if (k === 0) return a.id; break;
      case 'and': if (k === 0 && a.isPure) return tx.const(0, note('x & 0')); if (k === -1) return a.id; break;
      case 'eqz': {
        const inner = a;
        const inv = { lt: 'ge', ge: 'lt', gt: 'le', le: 'gt', eq: 'ne', ne: 'eq', ltu: 'geu', geu: 'ltu' };
        if (inv[inner.op]) return tx.make(inv[inner.op], inner.args[0].id, inner.args[1].id, { note: `!(${WB.SYMBOL[inner.op]}) is ${WB.SYMBOL[inv[inner.op]]}` });
        if (inner.op === 'eqz' && inner.args[0].isBoolean) return inner.args[0].id;
        break;
      }
    }
  })),
});

WB.definePass({
  name: 'constprop', about: 'constant propagation: a read whose reaching definitions all assign the same constant becomes that constant',
  needs: { reach: 'reaching' }, writes: ['values'], preserves: ['cfg', 'dominators', 'loops'],
  run: H((fn, tx, { reach }) => {
    const f = fn._ent, p = fn._p;
    for (const b of f.blocks) tx.rewrite(v => {
      if (v.op !== 'get') return;
      const sid = v.statement; if (!sid) return;
      const defs = reach.reachingAt(sid, v.imm);
      if (!defs.length) return;
      const consts = defs.map(d => d.startsWith('init:') ? 0 : d.startsWith('param:') ? null : (p.store.get(p.store.get(d).value).op === 'const' ? p.store.get(p.store.get(d).value).imm : null));
      if (consts.some(c => c === null) || new Set(consts).size !== 1) return;
      return tx.const(consts[0], { because: defs.filter(d => !d.startsWith('init:')).length ? defs.filter(d => !d.startsWith('init:')) : [`local:${f.name}/${f.locals[v.imm].name} starts at 0`] });
    }, [b]);
  }),
});

WB.definePass({
  name: 'dce', about: 'dead-code elimination: an assignment nobody reads, or a value computed for nothing, goes',
  needs: { live: 'liveness' }, writes: ['stmts'], preserves: ['cfg', 'dominators', 'loops'],
  run: H((fn, tx, { live }) => {
    for (const s of fn.stmts().list()) {
      if (s.op === 'set' && !live.liveAfter(s.id).has(s.local) && !s.value.hasEffect)
        tx.remove(s.id, { because: [`fact:liveness(${fn.name})@r${tx.rev - 1}`] });
      else if (s.op === 'eval' && !s.value.hasEffect) tx.remove(s.id, { because: ['no effect'] });
    }
  }),
});

WB.definePass({
  name: 'cfg', about: 'control-flow cleanup: constant branches, jumps through empty blocks, merging straight-line blocks',
  needs: { cfg: 'cfg' }, writes: ['stmts', 'cfg'], preserves: [],
  run: H((fn, tx, { cfg }) => {
    const f = fn._ent, p = fn._p, st = p.store;
    // constant and trivial branches
    for (const b of f.blocks) {
      const last = st.get(b.stmts.at(-1));
      if (!last || last.op !== 'br_if') continue;
      const c = st.get(last.cond);
      if (c.op === 'const') tx.replaceStmt(last.id, { op: 'br', to: c.imm ? last.then : last.else }, { because: [c.id], note: 'branch on a constant' });
      else if (last.then === last.else && WB.isPure(p, last.cond)) tx.replaceStmt(last.id, { op: 'br', to: last.then }, { because: [last.id], note: 'both arms go to the same block' });
    }
    // thread jumps through blocks that only jump
    const forward = new Map();
    for (const b of f.blocks) if (b.stmts.length === 1 && st.get(b.stmts[0]).op === 'br' && b.id !== f.blocks[0].id && st.get(b.stmts[0]).to !== b.id) forward.set(b.id, st.get(b.stmts[0]).to);
    const final = id => { const seen = new Set(); while (forward.has(id) && !seen.has(id)) { seen.add(id); id = forward.get(id); } return id; };
    for (const b of f.blocks) {
      const last = st.get(b.stmts.at(-1));
      if (!last) continue;
      for (const field of ['to', 'then', 'else']) if (last[field] && final(last[field]) !== last[field]) tx.setField(last.id, field, final(last[field]), { because: [last[field]] });
    }
    tx.commit();
    // merge b into a when a ends with br b and b has a as its only predecessor
    let merged = true;
    while (merged) {
      merged = false;
      const preds = new Map(f.blocks.map(b => [b.id, []]));
      for (const b of f.blocks) for (const s of b.succ) if (preds.has(s)) preds.get(s).push(b.id);
      for (const a of f.blocks) {
        const last = st.get(a.stmts.at(-1));
        if (!last || last.op !== 'br') continue;
        const bId = last.to;
        if (bId === a.id || bId === f.blocks[0].id || preds.get(bId).length !== 1) continue;
        const b = st.get(bId);
        tx.remove(last.id, { because: [bId], note: 'merged with its only successor' });
        for (const sid of b.stmts.slice()) tx.move(sid, { block: a, index: a.stmts.length }, { because: [last.id] });
        a.succ = b.succ.slice(); b.succ = [];
        tx.record('merge', { block: bId, into: a.id });
        tx.commit();
        merged = true; break;
      }
    }
  }),
});

WB.definePass({
  name: 'licm', about: 'loop-invariant code motion: pure expressions whose operands the loop never assigns move to the preheader',
  needs: { loops: 'loops' }, writes: ['stmts', 'values', 'locals', 'cfg'], preserves: [],
  run: H((fn, tx, { loops }) => {
    const p = fn._p, st = p.store, f = fn._ent;
    for (const L of loops) {
      let pre = L.preheader;
      if (!pre) {
        // make one: a new block that jumps to the head; outside predecessors go there instead
        pre = tx.block({ because: [L.id], note: 'preheader' });
        tx.insert(tx.at.start(pre), tx.stmt({ op: 'br', to: L.head }, { because: [L.id] }), { because: [L.id] });
        for (const b of f.blocks) {
          if (L.body.includes(b.id) || b.id === pre) continue;
          const last = st.get(b.stmts.at(-1));
          if (!last) continue;
          for (const field of ['to', 'then', 'else']) if (last[field] === L.head) tx.setField(last.id, field, pre, { because: [L.id] });
        }
        if (f.blocks[0].id === L.head) WB.fail('unsupported', 'licm: a loop at the entry block');
      }
      const assigned = new Set(L.assigned);
      const inv = id => { const v = st.get(id); if (!['get', 'const', 'add', 'sub', 'mul', 'shl', 'shr', 'and', 'or', 'xor', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'eqz'].includes(v.op)) return false; if (v.op === 'get') return !assigned.has(v.imm); return v.args.every(inv); };
      const hoist = id => {
        const v = st.get(id);
        if (v.op !== 'const' && v.op !== 'get' && inv(id)) {
          const t = tx.local('inv', { because: [L.id] });
          const set = tx.set(t, id, { because: [L.id], note: `hoisted out of ${L.id}` });
          tx.insert(tx.at.end(pre), set, { because: [L.id] });
          return tx.get(t, { from: id, because: [set] });
        }
        const args = v.args.map(hoist);
        return args.some((a, i) => a !== v.args[i]) ? tx.make(v.op, ...args, { imm: v.imm, from: id }) : id;
      };
      for (const bid of L.body) for (const sid of st.get(bid).stmts.slice()) {
        const s = st.get(sid);
        for (const k of ['value', 'cond', 'addr']) if (s[k]) { const n = hoist(s[k]); if (n !== s[k]) tx.setField(sid, k, n, { because: [L.id] }); }
      }
    }
  }),
});

WB.definePass({
  name: 'lvn', about: 'local value numbering: the same pure expression computed twice in a block is computed once',
  writes: ['stmts', 'values', 'locals'], preserves: ['cfg', 'dominators', 'loops'],
  run: H((fn, tx) => {
    const p = fn._p, st = p.store, f = fn._ent;
    const key = id => { const v = st.get(id); return v.op === 'const' ? `#${v.imm}` : v.op === 'get' ? `@${v.imm}` : `${v.op}(${v.args.map(key).join(',')})`; };
    const size = id => 1 + st.get(id).args.reduce((n, a) => n + size(a), 0);
    for (const b of f.blocks) {
      const seen = new Map(); // key -> { stmt, value }
      for (const sid of b.stmts.slice()) {
        const s = st.get(sid);
        const visit = id => {
          const v = st.get(id);
          if (v.args.length && size(id) >= 3 && WB.isPure(p, id)) {
            const k = key(id), first = seen.get(k);
            if (first && first.value !== id) {
              const t = tx.local('vn', { because: [first.value] });
              const set = tx.set(t, first.value, { because: [first.value, id], note: `computed once for ${first.stmt} and ${sid}` });
              tx.replace(first.value, tx.get(t, { from: first.value, because: [set] }));
              tx.replace(id, tx.get(t, { from: id, because: [set] }));
              tx.insert(tx.at.before(first.stmt), set, { because: [first.value, id] });
              seen.delete(k);
              return true;
            }
            if (!first) seen.set(k, { stmt: sid, value: id });
          }
          return v.args.some(visit);
        };
        for (const k of ['addr', 'value', 'cond']) if (s[k] && visit(s[k])) break;
        if (s.op === 'set') for (const [k, e] of [...seen]) if (WB.readsOf(p, e.value).has(s.local)) seen.delete(k);
      }
    }
  }),
});

WB.definePass({
  name: 'strength', about: 'strength reduction with proof: x / 2^k and x % 2^k become shifts and masks when ranges prove x is not negative',
  needs: { ranges: 'ranges' }, writes: ['values'], preserves: ['cfg', 'dominators', 'loops'],
  run: H((fn, tx, { ranges }) => tx.rewrite(v => {
    if ((v.op !== 'div' && v.op !== 'rem') || !v.args[1].isConst || !isPow2(v.args[1].imm)) return;
    const sid = v.statement, r = ranges.of(sid, v.args[0].id);
    if (r[0] < 0) return;
    const k = v.args[1].imm, why = [`fact:ranges(${fn.name})@r${tx.rev - 1}: ${v.args[0].text} in [${r[0]}, ${r[1]}]`];
    return v.op === 'div' ? tx.make('shr', v.args[0].id, tx.const(log2(k)), { because: why, note: `x / ${k} with x ≥ 0` })
      : tx.make('and', v.args[0].id, tx.const(k - 1), { because: why, note: `x % ${k} with x ≥ 0` });
  })),
});

WB.definePass({
  name: 'div-to-shift', about: 'deliberately wrong: x / 2^k becomes x >> k with no proof that x is not negative',
  writes: ['values'], preserves: ['cfg', 'dominators', 'loops'],
  run: H((fn, tx) => tx.rewrite(v => {
    if (v.op === 'div' && v.args[1].isConst && isPow2(v.args[1].imm)) return tx.make('shr', v.args[0].id, tx.const(log2(v.args[1].imm)), { note: 'no range check: wrong for negative x' });
  })),
});

WB.definePass({
  name: 'bce', about: 'bounds-check elimination: a check i >=u buf.length goes when a dominating branch proved i < buf.length and ranges prove i ≥ 0',
  needs: { dom: 'dominators', reach: 'reaching', ranges: 'ranges' }, writes: ['stmts', 'cfg'], preserves: [],
  run: H((fn, tx, { dom, reach, ranges }) => {
    const p = fn._p, st = p.store, f = fn._ent;
    // resolve a read through single copies: t = x  ->  x (when t has one definition)
    const resolve = (sid, id) => {
      const v = st.get(id);
      if (v.op !== 'get') return { id, local: null, sid };
      const defs = reach.reachingAt(sid, v.imm);
      if (defs.length === 1 && defs[0].startsWith('s:')) { const d = st.get(defs[0]), dv = st.get(d.value); if (dv.op === 'get') return { id: d.value, local: dv.imm, sid: d.id, via: d.id }; }
      return { id, local: v.imm, sid };
    };
    const isLength = (id, buf) => { const v = st.get(id); return v.op === 'load' && v.imm === 0 && st.get(v.args[0]).op === 'get' && (buf === undefined || st.get(v.args[0]).imm === buf); };
    for (const b of f.blocks) {
      const last = st.get(b.stmts.at(-1));
      if (!last || last.op !== 'br_if') continue;
      const c = st.get(last.cond);
      if (c.op !== 'geu' || !isLength(c.args[1])) continue;
      const trapB = st.get(last.then);
      if (!trapB.stmts.length || st.get(trapB.stmts[0]).op !== 'trap') continue;
      const idx = resolve(last.id, c.args[0]), buf = st.get(st.get(c.args[1]).args[0]).imm;
      if (idx.local === null) continue;
      // walk up the dominator tree for a branch whose taken edge proves idx < buf.length
      for (let d = dom.idom.get(b.id), child = b.id; d && d !== child; child = d, d = dom.idom.get(d)) {
        const t = st.get(st.get(d).stmts.at(-1));
        if (!t || t.op !== 'br_if') continue;
        let cond = st.get(t.cond), onTrue = true;
        if (cond.op === 'eqz') { cond = st.get(cond.args[0]); onTrue = false; }
        if (cond.op === 'ge') onTrue = !onTrue; // x >= len taken means x < len on the other arm
        else if (cond.op !== 'lt') continue;
        const arm = onTrue ? t.then : t.else;
        if (!dom.dominates(arm, b.id)) continue;
        const x = st.get(cond.args[0]);
        if (x.op !== 'get' || x.imm !== idx.local || !isLength(cond.args[1], buf)) continue;
        // the index and the buffer are the same values at the branch and at the check
        const same = l => { const a = reach.reachingAt(t.id, l).sort().join(), z = reach.reachingAt(idx.sid, l).sort().join(); return a === z; };
        if (!same(idx.local) || !same(buf)) continue;
        if (ranges.at(t.id, idx.local)[0] < 0) continue;
        tx.replaceStmt(last.id, { op: 'br', to: last.else }, { because: [t.id, `fact:ranges(${fn.name}): ${f.locals[idx.local].name} ≥ 0`], note: `${t.id} already proved ${f.locals[idx.local].name} < length` });
        break;
      }
    }
  }),
});

WB.definePass({
  name: 'subst', about: 'forward substitution: a temporary assigned a pure value and read once in the same block is replaced by the value',
  needs: { live: 'liveness' }, writes: ['stmts', 'values'], preserves: ['cfg', 'dominators', 'loops'],
  run: H((fn, tx, { live }) => {
    const p = fn._p, st = p.store, f = fn._ent;
    const defCount = new Map();
    for (const b of f.blocks) for (const sid of b.stmts) { const s = st.get(sid); if (s.op === 'set') defCount.set(s.local, (defCount.get(s.local) || 0) + 1); }
    for (const b of f.blocks) {
      for (let i = 0; i < b.stmts.length; i++) {
        const d = st.get(b.stmts[i]);
        if (d.op !== 'set' || defCount.get(d.local) !== 1 || f.locals[d.local].param || !WB.isPure(p, d.value)) continue;
        const operands = WB.readsOf(p, d.value);
        let users = 0, user = null, blocked = false;
        for (let j = i + 1; j < b.stmts.length; j++) {
          const s = st.get(b.stmts[j]);
          const n = WB.stmtValues(s).reduce((m, v) => m + countReads(p, v, d.local), 0);
          if (n) { users += n; if (!user) user = s; else break; }
          if (s.op === 'set' && (operands.has(s.local) || s.local === d.local)) { if (!user) blocked = true; break; }
        }
        if (blocked || users !== 1 || live.liveAfter(user.id).has(d.local)) continue;
        tx.rewrite(v => (v.op === 'get' && v.imm === d.local) ? copyTree(tx, p, d.value, v.id, d.id) : undefined, [b]);
        tx.remove(d.id, { because: [user.id], note: 'substituted into its only reader' });
        break; // one per block per run: liveness changed; the pipeline repeats
      }
    }
  }),
});
function countReads(p, id, l) { const v = p.store.get(id); return (v.op === 'get' && v.imm === l ? 1 : 0) + v.args.reduce((n, a) => n + countReads(p, a, l), 0); }
function copyTree(tx, p, id, from, because) {
  const v = p.store.get(id);
  return tx.make(v.op, ...v.args.map(a => copyTree(tx, p, a, from, because)), { imm: v.imm, from: id, because: [because] });
}
})(globalThis);
