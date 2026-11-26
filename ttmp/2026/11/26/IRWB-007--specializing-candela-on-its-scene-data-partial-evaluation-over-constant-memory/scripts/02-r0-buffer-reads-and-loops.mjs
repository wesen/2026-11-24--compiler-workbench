// IRWB-007 measurement 2: a static scan of Candela at r0 (lifted from the tape, no pass applied, nothing executed).
//   - which functions read which fields of the kernel record K, and which of K's buffers they index;
//   - every checked address (caddr) into a K buffer, by buffer, with its position constant or not;
//   - which functions reach a scene-buffer read through calls;
//   - which K buffers and which K fields each function stores into, and so which each entry can write through calls;
//   - every natural loop, with what its exit conditions depend on (flow-insensitively: the union over all
//     assignments of each local read), so that loops whose trip count comes from scene data stand out.
// Run under the memory cap (it lifts Candela):
//   systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 node --max-old-space-size=10240 \
//     …/02-r0-buffer-reads-and-loops.mjs --json out.json --text out.txt
import { writeFileSync } from 'node:fs';
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor({ reference: false });
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { loopsOf } = await import(root + 'dist/typed/analyses.js');

const args = process.argv.slice(2);
const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const t0 = performance.now();
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const liftMs = Math.round(performance.now() - t0);
const K = st.frontEnd.records.K;
const fieldAt = Object.fromEntries(Object.entries(K).map(([name, f]) => [f.offset, name]));
const BUFFERS = new Set(['bU', 'bO', 'bL', 'bB', 'bS', 'etab', 'sky']);
const SCENE = new Set(['bU', 'bO', 'bL', 'bB', 'bS']);

const fns = [...st.fns.values()];
const perFn = {};
const loopsOut = [];
const directReaders = new Map(); // fn -> Set of buffers read
const calls = new Map();
const writes = new Map(); // fn -> Set of 'buf:<field>' / 'K.<field>' / 'other'
let caddrTotal = 0;
const caddrByBuffer = {};

for (const f of fns) {
  const kParams = new Set(f.params.map((t, i) => (t === 'K' ? i : -1)).filter(i => i >= 0));
  const defs = new Map(); // local -> [value ids]
  const stmts = [];
  for (const b of f.blocks)
    for (const sid of b.stmts) {
      const s = st.get(sid);
      stmts.push([b.id, sid, s]);
      if (s.op === 'set') (defs.get(s.local) ?? defs.set(s.local, []).get(s.local)).push(s.value);
    }
  const isParam = l => f.locals[l]?.param;
  // the K field a value loads, when it is load32[get k + offset] with k a K parameter never reassigned
  const kField = v => {
    if (v.op !== 'load') return null;
    const a = st.get(v.args[0]);
    if (a.op === 'get' && kParams.has(a.imm) && !defs.has(a.imm)) return fieldAt[v.imm] ?? `@${v.imm}`;
    return null;
  };
  // the buffer a local holds: every assignment is a load of one K buffer field
  const bufOfLocal = new Map();
  for (const [l, vs] of defs) {
    const fs = new Set(vs.map(id => kField(st.get(id))));
    if (fs.size === 1) {
      const [x] = fs;
      if (x && BUFFERS.has(x)) bufOfLocal.set(l, x);
    }
  }
  // constant value of a tree, resolving locals with exactly one assignment (null when not constant)
  const constOf = (id, seen = new Set()) => {
    const v = st.get(id);
    if (v.op === 'const') return v.imm;
    if (v.op === 'get') {
      const ds = defs.get(v.imm);
      if (!ds || ds.length !== 1 || isParam(v.imm) || seen.has(v.imm)) return null;
      seen.add(v.imm);
      return constOf(ds[0], seen);
    }
    const ops = { add: (a, b) => (a + b) | 0, sub: (a, b) => (a - b) | 0, mul: (a, b) => Math.imul(a, b), shl: (a, b) => a << b };
    if (ops[v.op] && v.args.length === 2) {
      const a = constOf(v.args[0], seen), b = constOf(v.args[1], seen);
      return a === null || b === null ? null : ops[v.op](a, b);
    }
    return null;
  };
  // flow-insensitive sources of a tree: K fields, buffers read (with the buffer), parameters, calls, frame arrays
  const memo = new Map();
  const sourcesOfLocal = (l, stack) => {
    if (memo.has(l)) return memo.get(l);
    if (stack.has(l)) return new Set();
    stack.add(l);
    const out = new Set();
    if (isParam(l)) out.add(`param:${f.locals[l].name}`);
    for (const id of defs.get(l) ?? []) for (const x of sourcesOf(id, stack)) out.add(x);
    stack.delete(l);
    memo.set(l, out);
    return out;
  };
  const sourcesOf = (id, stack = new Set()) => {
    const v = st.get(id), out = new Set();
    const kf = kField(v);
    if (kf) { out.add(BUFFERS.has(kf) ? `ptr:${kf}` : `K.${kf}`); return out; }
    if (v.op === 'get') return sourcesOfLocal(v.imm, stack);
    if (v.op === 'load' || v.op === 'load16u') {
      const a = st.get(v.args[0]);
      if (a.op === 'caddr') {
        const r = st.get(a.args[0]);
        const b = r.op === 'get' ? bufOfLocal.get(r.imm) : null;
        out.add(b ? `buf:${b}` : 'buf:?');
      } else if (a.op === 'aaddr' || (a.op === 'add' && st.get(a.args[0]).op === 'aaddr')) out.add('frame');
      else out.add('mem');
    }
    if (v.op === 'call') out.add(`call:${v.imm}`);
    if (v.op === 'result') out.add('result');
    for (const x of v.args) for (const y of sourcesOf(x, stack)) out.add(y);
    return out;
  };
  // checked addresses into K buffers
  const sites = {};
  const kfields = new Set();
  const callees = new Set();
  const walk = id => {
    if (!id) return;
    const v = st.get(id);
    const kf = kField(v);
    if (kf) kfields.add(kf);
    if (v.op === 'call') callees.add(v.imm);
    if (v.op === 'caddr') {
      caddrTotal++;
      const r = st.get(v.args[0]);
      const b = (r.op === 'get' && bufOfLocal.get(r.imm)) || '?';
      const c = constOf(v.args[1]);
      const k = c === null ? 'variable' : 'constant';
      (sites[b] ??= { constant: 0, variable: 0 })[k]++;
      (caddrByBuffer[b] ??= { constant: 0, variable: 0, fns: new Set() })[k]++;
      caddrByBuffer[b].fns.add(f.name);
    }
    v.args.forEach(walk);
  };
  for (const [, , s] of stmts) [s.value, s.cond, s.addr].forEach(walk);
  // stores: through a checked address into a K buffer, or into a field of a K parameter
  const w = new Set();
  for (const [, , s] of stmts) {
    if (s.op !== 'store') continue;
    const a = st.get(s.addr);
    if (a.op === 'caddr') {
      const r = st.get(a.args[0]);
      const b = r.op === 'get' ? bufOfLocal.get(r.imm) : null;
      w.add(b ? `buf:${b}` : 'buf:?');
    } else if (a.op === 'get' && kParams.has(a.imm) && !defs.has(a.imm)) w.add(`K.${fieldAt[s.offset] ?? '@' + s.offset}`);
    else if (a.op === 'aaddr' || (a.op === 'add' && st.get(a.args[0]).op === 'aaddr')) w.add('frame');
    else w.add('other');
  }
  if (w.size) writes.set(f.name, w);
  calls.set(f.name, callees);
  const read = new Set(Object.keys(sites).filter(b => b !== '?'));
  if (read.size) directReaders.set(f.name, read);
  if (kfields.size || Object.keys(sites).length)
    perFn[f.name] = { kFields: [...kfields].sort(), caddr: sites, stmts: stmts.length };
  // loops and what their exits depend on
  for (const loop of loopsOf(st, f)) {
    const body = new Set(loop.body);
    const exitConds = [];
    for (const bid of loop.body) {
      const b = st.get(bid);
      for (const sid of b.stmts) {
        const s = st.get(sid);
        if (s.op === 'br_if' && (!body.has(s.then) || !body.has(s.else))) exitConds.push([...sourcesOf(s.cond)].sort());
      }
    }
    const all = new Set(exitConds.flat());
    const scene = [...all].filter(x => x.startsWith('buf:') && SCENE.has(x.slice(4)));
    const kind = scene.length
      ? 'scene-data bound'
      : [...all].every(x => x === 'frame' || x.startsWith('call:') === false && !x.startsWith('param:') && !x.startsWith('buf:') && x !== 'mem' && x !== 'result')
        ? 'constant or frame-array bound'
        : [...all].some(x => x.startsWith('param:')) ? 'parameter bound' : 'other';
    loopsOut.push({ fn: f.name, head: loop.head, blocks: loop.body.length, exits: exitConds.length, kind, sources: [...all].sort() });
  }
}

// functions that reach a scene-buffer read through calls (including their own reads)
const reaches = new Map();
const reach = (n, stack = new Set()) => {
  if (reaches.has(n)) return reaches.get(n);
  if (stack.has(n)) return new Set();
  stack.add(n);
  const out = new Set(directReaders.get(n) ?? []);
  for (const c of calls.get(n) ?? []) for (const b of reach(c, stack)) out.add(b);
  stack.delete(n);
  reaches.set(n, out);
  return out;
};
for (const f of fns) reach(f.name);
// what each entry can write, through every function it reaches
const reachFns = r => { const seen = new Set([r]), todo = [r]; while (todo.length) for (const c of calls.get(todo.pop()) ?? []) if (!seen.has(c)) (seen.add(c), todo.push(c)); return seen; };
const ENTRIES = ['cdlLayout', 'cdlInit', 'cdlSky', 'cdlRenderSpan'];
const entryWrites = Object.fromEntries(ENTRIES.map(e => {
  const out = {};
  for (const f of reachFns(e)) for (const x of writes.get(f) ?? []) (out[x] ??= []).push(f);
  return [e, Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.sort()]))];
}));
const sceneReaders = [...directReaders].filter(([, s]) => [...s].some(b => SCENE.has(b))).map(([n]) => n);
const sceneReach = [...reaches].filter(([, s]) => [...s].some(b => SCENE.has(b))).map(([n]) => n);
const sections = fns.filter(f => /^s\d+_/.test(f.name)).length;

const summary = {
  liftMs, functions: fns.length, sceneSections: sections,
  kFieldOffsets: Object.fromEntries(Object.entries(K).map(([n, f]) => [n, f.offset])),
  caddrTotal,
  caddrByBuffer: Object.fromEntries(Object.entries(caddrByBuffer).map(([b, x]) => [b, { constant: x.constant, variable: x.variable, fns: x.fns.size }])),
  functionsReadingSceneBuffers: sceneReaders.length,
  functionsReachingSceneBuffers: sceneReach.length,
  readersByBuffer: Object.fromEntries([...BUFFERS].map(b => [b, [...directReaders].filter(([, s]) => s.has(b)).map(([n]) => n).sort()])),
  entryWrites,
  loops: loopsOut.length,
  loopsByKind: loopsOut.reduce((a, l) => ((a[l.kind] = (a[l.kind] ?? 0) + 1), a), {}),
};
const lines = [
  `Candela r0: ${fns.length} functions (${sections} scene sections), lifted in ${liftMs} ms`,
  `checked addresses: ${caddrTotal}; by K buffer (constant position / variable position / functions):`,
  ...Object.entries(summary.caddrByBuffer).map(([b, x]) => `  ${b.padEnd(5)} ${String(x.constant).padStart(4)} ${String(x.variable).padStart(4)} ${String(x.fns).padStart(4)}`),
  `functions that index a scene buffer (U, O, LI, BV, SD) directly: ${sceneReaders.length}; that reach one through calls: ${sceneReach.length}`,
  ...[...BUFFERS].map(b => `  ${b.padEnd(5)} read by ${summary.readersByBuffer[b].length}: ${summary.readersByBuffer[b].join(' ')}`),
  'stores reachable from each entry (what it writes: by whom):',
  ...ENTRIES.map(e => `  ${e}: ${Object.entries(entryWrites[e]).map(([k, v]) => `${k} (${v.length}: ${v.slice(0, 6).join(' ')}${v.length > 6 ? ' …' : ''})`).join('; ')}`),
  `natural loops: ${loopsOut.length}; ${Object.entries(summary.loopsByKind).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  ...loopsOut.filter(l => l.kind === 'scene-data bound' || l.kind === 'constant or frame-array bound').map(l => `  ${l.kind.padEnd(29)} ${l.fn}@${l.head}  exits ${l.exits}  ${l.sources.join(' ')}`),
];
console.log(lines.join('\n'));
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify({ summary, perFn, loops: loopsOut }, null, 1) + '\n');
if (opt('--text')) writeFileSync(opt('--text'), lines.join('\n') + '\n');
