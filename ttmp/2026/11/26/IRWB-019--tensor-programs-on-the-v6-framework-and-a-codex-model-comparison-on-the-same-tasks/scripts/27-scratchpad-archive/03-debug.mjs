// IRWB-007 measurement 3: a binding-time profile of Candela's per-pixel work, at r0, on real scene data.
//
// The scene is bound exactly as the frame comparison binds it (CandelaHost: cdlLayout, cdlInit, bind, cdlSky, all on
// the evaluator). Then, for every pixel at the given stride, cdlRenderSpan(K, out, y, x, x + 1, 0) is executed by a
// shadow interpreter: a copy of the evaluator's loop (src/typed/evaluate.ts `evaluate`) that also carries, for
// every local, every result leaf and every byte of memory, a binding-time tag:
//   C  computed from literal constants only
//   K  depends on K.scene (what the per-scene kernels of IRWB-001 already bind)
//   M  depends on the frame-constant memory the host promise would cover: the five scene buffers, the GGX table,
//      the sky table, K's pointer words, K.spectral, K.skyOn, the output buffer's capacity word
//      (the addresses of K and of the output buffer, the call's first two arguments, are C: the host fixes them)
//   X  a load from that constant memory at a dynamic address (a table lookup "The Trick" could split on)
//   D  dynamic: depends on y, x, the RNG state or anything computed from them
// The tag of an operation is the largest of its operands' tags (C < K < M < X < D). Each executed operation (every
// value node except const, get, result, tuple and aaddr, plus every store and every conditional branch) is counted
// once with its tag. Two modes:
//   data     tags follow data only. This is what an online specializer with unlimited polyvariance would see: it
//            specializes the continuation of every dynamic branch separately, so a value assigned under a dynamic
//            test stays static. An upper bound on what any partial evaluator can make static.
//            In this mode the script also computes a dynamic slice: which X/D operations an output (a store into
//            the out buffer) depends on, through data, memory, the dynamic branches that control them, and the
//            dynamic branches that select a value they read (an assignment, store or return made under a dynamic
//            branch depends on that branch, even when the value assigned is static; at the branch's immediate
//            post-dominator, so does every local the branch's region may assign, whichever arm ran). X/D
//            operations outside the slice would be dead in the residual program.
//   control  in addition, a value assigned or returned while one of its frame's dynamic-branch regions is active
//            (from the branch to its immediate post-dominator) is D, and so is a store made while a region of its
//            frame or of any caller is active; at the post-dominator, every local the region may assign is D.
//            This approximates a monovariant offline binding-time analysis, in which a variable assigned under
//            dynamic control is dynamic at the join.
// The shadow run's 12 output floats per pixel are compared bit for bit with the evaluator's own run of the same
// call, so the profile is a profile of the real execution.
//
//   systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 node --max-old-space-size=10240 \
//     …/03-binding-time-profile.mjs B-01 [R-01 …] [--stride 8] [--json out.json]
import { writeFileSync } from 'node:fs';
const root = '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a835ea9e40615941e/';
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor({ reference: false });
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { candelaScenes } = await import(root + 'tools/candela-render.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { evaluate, binop, STACK_BYTES } = await import(root + 'dist/typed/evaluate.js');
const { f32Op } = await import(root + 'dist/typed/f32.js');
const R = await import(root + 'dist/typed/candela-render.js');

const args = process.argv.slice(2);
const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const stride = +(opt('--stride') ?? 8);
const want = args.filter((a, i) => !a.startsWith('--') && !['--stride', '--json'].includes(args[i - 1]));
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const scenes = candelaScenes();

const VIDS = new Map(), VNAMES = []; let CURV = -1; const vidOf = id => { let x = VIDS.get(id); if (x === undefined) { x = VNAMES.length; VIDS.set(id, x); VNAMES.push(id); } return x; };
const DETAIL = new Map();
const C = 0, KT = 1, M = 2, X = 3, D = 4;
const TAGS = ['C', 'K', 'M', 'X', 'D'];
const I32_BINARY = new Set(['add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'shl', 'shr', 'shru', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'ltu', 'geu']);
const CLASS = op => (op === 'load' || op === 'load16u' ? 'load' : op === 'caddr' ? 'caddr' : op === 'call' ? 'call' : I32_BINARY.has(op) || op === 'eqz' ? 'i32' : 'f32');
const CLASSES = ['i32', 'f32', 'load', 'caddr', 'call', 'store', 'branch'];
const CI = Object.fromEntries(CLASSES.map((c, i) => [c, i]));
const fnIndex = new Map([...st.fns.keys()].map((n, i) => [n, i]));
const fnNames = [...st.fns.keys()];
const hasFrames = [...st.fns.values()].some(f => f.arrayBytes);

// immediate post-dominators per function (reverse graph with a virtual exit), for dynamic-branch regions
const EXIT = '^exit';
const ipdomCache = new Map();
function ipdoms(f) {
  if (ipdomCache.has(f.name)) return ipdomCache.get(f.name);
  const preds = new Map(f.blocks.map(b => [b.id, []]));
  for (const b of f.blocks) for (const s of b.succ) preds.get(s)?.push(b.id);
  const exits = f.blocks.filter(b => b.succ.length === 0).map(b => b.id);
  const rsucc = n => (n === EXIT ? exits : preds.get(n));
  const rpred = n => { const b = f.blocks.find(x => x.id === n); return b.succ.length ? b.succ : [EXIT]; };
  const post = [], seen = new Set();
  const dfs = n => { seen.add(n); for (const m of rsucc(n)) if (!seen.has(m)) dfs(m); post.push(n); };
  dfs(EXIT);
  const num = new Map(post.map((n, i) => [n, i]));
  const idom = new Map([[EXIT, EXIT]]);
  const inter = (a, b) => { while (a !== b) { while (num.get(a) < num.get(b)) a = idom.get(a); while (num.get(b) < num.get(a)) b = idom.get(b); } return a; };
  const rpo = post.slice().reverse();
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of rpo) {
      if (n === EXIT) continue;
      let nd;
      for (const p of rpred(n)) if (idom.has(p)) nd = nd === undefined ? p : inter(p, nd);
      if (nd !== undefined && idom.get(n) !== nd) { idom.set(n, nd); changed = true; }
    }
  }
  ipdomCache.set(f.name, idom);
  return idom;
}

// the locals a branch's region may assign: blocks reachable from the branch's successors before its post-dominator
const regionLocalsCache = new Map();
function regionLocals(f, bid, end) {
  const key = f.name + ' ' + bid;
  if (regionLocalsCache.has(key)) return regionLocalsCache.get(key);
  const byId = new Map(f.blocks.map(b => [b.id, b]));
  const seen = new Set(), work = [...byId.get(bid).succ], locals = new Set();
  while (work.length) {
    const x = work.pop();
    if (x === end || seen.has(x)) continue;
    seen.add(x);
    const b = byId.get(x);
    for (const sid of b.stmts) { const t = st.get(sid); if (t.op === 'set') locals.add(t.local); }
    work.push(...b.succ);
  }
  const out = [...locals];
  regionLocalsCache.set(key, out);
  return out;
}

/** One profiled call. Returns the memory afterwards and fills `prof`. */
function shadow(mode, fname, argv, argTags, memBytes, memTags, regions, prof) {
  const size = hasFrames ? (memBytes.length + STACK_BYTES + 15) & -16 : memBytes.length;
  const bytes = new Uint8Array(size);
  bytes.set(memBytes);
  const tags = new Uint8Array(size).fill(D);
  tags.set(memTags);
  const wprod = new Int32Array(size >> 2).fill(-1); // producer record of each memory word (data mode)
  const mem = new DataView(bytes.buffer);
  const slice = mode === 'data';
  // dynamic operation records (data mode): deps, controlling branch, class, function, live
  let n = 0, cap = 1 << 16;
  let d0 = new Int32Array(cap), d1 = new Int32Array(cap), d2 = new Int32Array(cap), ctl = new Int32Array(cap);
  let vix = new Int32Array(cap); let cls = new Uint8Array(cap), fnr = new Int32Array(cap), tg = new Uint8Array(cap), live = new Uint8Array(cap);
  const rec = (a, b, c, ctrl, klass, fi, tag) => {
    if (n === cap) {
      cap *= 2;
      const g = (A, T) => { const x = new T(cap); x.set(A); return x; };
      d0 = g(d0, Int32Array); d1 = g(d1, Int32Array); d2 = g(d2, Int32Array); ctl = g(ctl, Int32Array);
      vix = g(vix, Int32Array); cls = g(cls, Uint8Array); fnr = g(fnr, Int32Array); tg = g(tg, Uint8Array); live = g(live, Uint8Array);
    }
    vix[n] = CURV; d0[n] = a; d1[n] = b; d2[n] = c; ctl[n] = ctrl; cls[n] = klass; fnr[n] = fi; tg[n] = tag;
    return n++;
  };
  const roots = [];
  // an uncounted record: a selection (an assignment, store or return under a dynamic branch, which the residual
  // program needs that branch for) or the merge of two producers flowing through a static operation
  const PHI = CLASSES.length;
  const prop = (a, b, fi) => (a < 0 ? b : b < 0 || a === b ? a : rec(a, b, -1, -1, PHI, fi, C));
  const count = (fi, klass, tag) => {
    prof.byTag[tag]++;
    prof.byClass[klass][tag]++;
    const pf = (prof.byFn[fi] ??= new Float64Array(5));
    pf[tag]++;
  };
  const check = (a, w) => { if (a < 0 || a + w > bytes.length) throw new Error('memory access outside guest memory: ' + a); };
  const regionOf = a => { for (const r of regions) if (a >= r.lo && a < r.hi) return r.name; return a >= memBytes.length ? 'frame' : 'other'; };
  const memTag = (a, w) => { let t = 0; for (let i = 0; i < w; i++) t = Math.max(t, tags[a + i]); return t; };
  let sp = size, T = C, P = -1;
  function call(name, args, atags, aprod, depth, ctx, ctxCtl) {
    if (depth > 64) throw new Error('call depth');
    const f = st.fn(name), fi = fnIndex.get(name);
    prof.calls[fi] = (prof.calls[fi] ?? 0) + 1;
    const nl = f.locals.length;
    const L = new Int32Array(nl), LT = new Uint8Array(nl), LP = new Int32Array(nl).fill(-1);
    args.forEach((a, i) => { L[i] = a; LT[i] = atags[i]; LP[i] = aprod[i]; });
    const saved = sp;
    let frame = 0, results = [], rtags = [], rprod = [];
    if (f.arrayBytes) { sp = (sp - f.arrayBytes) & -16; if (sp < memBytes.length) throw new Error('stack overflow'); frame = sp; }
    const ipd = ipdoms(f);
    const reg = []; // active dynamic regions of this frame: [end block, previous ctl record, branch record, locals]
    let cur = ctxCtl; // the innermost dynamic branch record controlling what executes now
    // control mode: a value assigned or returned under this frame's dynamic regions is dynamic; a store is dynamic
    // under those regions or under the caller's (memory outlives the call, a callee's locals do not)
    const taint = () => (mode === 'control' && reg.length ? D : C);
    const taintStore = () => (mode === 'control' && (reg.length || ctx) ? D : C);
    const ev = id => {
      const v = st.get(id);
      switch (v.op) {
        case 'const': T = C; P = -1; return v.imm;
        case 'get': T = LT[v.imm]; P = LP[v.imm]; return L[v.imm];
        case 'aaddr': T = C; P = -1; return (frame + v.imm) | 0;
        case 'result': T = rtags[v.imm]; P = rprod[v.imm]; return results[v.imm];
        case 'load': case 'load16u': {
          const w = v.op === 'load' ? 4 : 2;
          const a = ev(v.args[0]) + v.imm, ta = T, pa = P;
          check(a, w);
          const x = w === 4 ? mem.getInt32(a, true) : mem.getUint16(a, true);
          const mt = memTag(a, w);
          T = ta <= M ? Math.max(ta, mt) : mt <= M ? X : D;
          const rg = regionOf(a);
          const pr = (prof.loads[rg] ??= new Float64Array(5)); pr[T]++;
          count(fi, CI.load, T);
          P = slice ? (T >= X ? rec(pa, wprod[a >> 2], -1, cur, CI.load, fi, T) : prop(pa, wprod[a >> 2], fi)) : -1;
          return x;
        }
        case 'caddr': {
          const r = ev(v.args[0]), tr = T, pr = P;
          const p = ev(v.args[1]), tp = T, pp = P;
          check(r, 4);
          const capTag = memTag(r, 4);
          if (p >>> 0 >= mem.getInt32(r, true) >>> 0) throw new Error('checked address out of range ' + id);
          const tcheck = Math.max(tr, tp, capTag);
          count(fi, CI.caddr, tcheck);
          T = Math.max(tr, tp);
          P = slice ? (tcheck >= X ? rec(pr, pp, wprod[r >> 2], cur, CI.caddr, fi, tcheck) : prop(pr, pp, fi)) : -1;
          return (r + (p << 1)) | 0;
        }
        case 'call': {
          const xs = [], ts = [], ps = [];
          let tmax = C;
          for (const a of v.args) { xs.push(ev(a)); ts.push(T); ps.push(P); tmax = Math.max(tmax, T); }
          prof.callArgs[tmax]++;
          const out = call(v.imm, xs, ts, ps, depth + 1, ctx || reg.length > 0, cur);
          if (out.multi) { results = out.values; rtags = out.tags; rprod = out.prods; T = C; P = -1; return 0; }
          T = out.tag; P = out.prod; return out.value;
        }
        case 'tuple': throw new Error('tuple outside return');
        case 'eqz': {
          const a = ev(v.args[0]), ta = T, pa = P;
          count(fi, CI.i32, ta);
          T = ta; P = slice ? (ta >= X ? rec(pa, -1, -1, cur, CI.i32, fi, ta) : pa) : -1;
          return +(a === 0);
        }
        default: {
          const a = ev(v.args[0]), ta = T, pa = P;
          let x, tb = C, pb = -1, b;
          if (v.args.length === 1) x = f32Op(v.op, a);
          else { b = ev(v.args[1]); tb = T; pb = P; x = I32_BINARY.has(v.op) ? binop(v.op, a, b) : f32Op(v.op, a, b); }
          const t = Math.max(ta, tb), k = CLASS(v.op);
          count(fi, CI[k], t);
          if (t === D && (v.op === 'fmul' || v.op === 'fadd' || v.op === 'fsub') && (ta <= M || tb <= M)) {
            const c = ta <= M ? a : b;
            if (c === 0 || c === -2147483648 || c === 0x3f800000 || c === -0x40800000) prof.identityCandidates++;
          }
          T = t; P = slice ? (t >= X ? rec(pa, pb, -1, cur, CI[k], fi, t) : prop(pa, pb, fi)) : -1;
          return x;
        }
      }
    };
    try {
      let b = f.blocks[0];
      for (;;) {
        // the join of a dynamic (or selected) branch: every local its region may assign now depends on the branch,
        // whichever arm ran (in control mode it is dynamic; in data mode its producer is a selection by the branch)
        while (reg.length && reg[reg.length - 1][0] === b.id) {
          const [, prev, br, locals] = reg.pop();
          for (const l of locals) {
            if (mode === 'control') LT[l] = D;
            else LP[l] = rec(LP[l], -1, -1, br, PHI, fi, C);
          }
          cur = prev;
        }
        let next;
        for (const sid of b.stmts) {
          const s = st.get(sid); CURV = vidOf(sid);
          switch (s.op) {
            case 'set': {
              const x = ev(s.value);
              L[s.local] = x; LT[s.local] = Math.max(T, taint()); LP[s.local] = slice && reg.length ? rec(P, -1, -1, cur, PHI, fi, C) : P;
              break;
            }
            case 'eval': ev(s.value); break;
            case 'store': {
              const a = ev(s.addr) + s.offset, ta = T, pa = P;
              const x = ev(s.value), tv = T, pv = P;
              const w = s.width === 32 ? 4 : 2;
              check(a, w);
              if (w === 4) mem.setInt32(a, x, true); else mem.setUint16(a, x & 65535, true);
              const t = Math.max(ta, tv);
              count(fi, CI.store, Math.max(t, taintStore()));
              const stored = ta <= M ? Math.max(tv, taintStore()) : D;
              tags.fill(stored, a, a + w);
              const rg = regionOf(a);
              const ps = (prof.stores[rg] ??= new Float64Array(5)); ps[Math.max(t, taintStore())]++;
              if (slice) {
                const id = t >= X || rg === 'out' ? rec(pa, pv, -1, cur, CI.store, fi, Math.max(t, X)) : cur >= 0 ? rec(pa, pv, -1, cur, PHI, fi, C) : prop(pa, pv, fi);
                wprod[a >> 2] = id;
                if (rg === 'out') roots.push(id);
              }
              break;
            }
            case 'zero': bytes.fill(0, frame + s.offset, frame + s.offset + s.bytes); tags.fill(C, frame + s.offset, frame + s.offset + s.bytes); break;
            case 'br': next = s.to; break;
            case 'br_if': {
              const c = ev(s.cond), tc = T, pc = P;
              count(fi, CI.branch, tc);
              next = c ? s.then : s.else;
              if (tc >= X) {
                const id = slice ? rec(pc, -1, -1, cur, CI.branch, fi, tc) : -1;
                reg.push([ipd.get(b.id), cur, id, regionLocals(f, b.id, ipd.get(b.id))]);
                if (slice) cur = id;
              } else if (slice && pc >= 0) {
                // a static condition whose value was selected by dynamic branches (e.g. which object a ray hit):
                // the residual program reaches this arm through those branches, so what runs here depends on them
                const id = rec(pc, -1, -1, cur, PHI, fi, C);
                reg.push([ipd.get(b.id), cur, id, regionLocals(f, b.id, ipd.get(b.id))]);
                cur = id;
              }
              break;
            }
            case 'return': {
              const rv = st.get(s.value);
              if (rv.op === 'tuple') {
                const values = [], ts = [], ps = [];
                for (const a of rv.args) { values.push(ev(a)); ts.push(Math.max(T, taint())); ps.push(slice && reg.length ? rec(P, -1, -1, cur, PHI, fi, C) : P); }
                return { multi: true, values, tags: ts, prods: ps };
              }
              const value = ev(s.value);
              return { multi: false, value, tag: Math.max(T, taint()), prod: slice && reg.length ? rec(P, -1, -1, cur, PHI, fi, C) : P };
            }
            case 'trap': throw new Error('trap ' + (s.why || 'unreachable') + ' at ' + sid);
          }
          if (next) break;
        }
        if (!next) next = b.succ[0];
        if (!next) throw new Error('fell off the end of ' + b.id);
        b = st.get(next);
      }
    } finally {
      sp = saved;
    }
  }
  call(fname, argv, argTags, argv.map(() => -1), 0, false, -1);
  if (slice) {
    for (const r of roots) if (r >= 0) live[r] = 1;
    for (let i = n - 1; i >= 0; i--)
      if (live[i]) { if (d0[i] >= 0) live[d0[i]] = 1; if (d1[i] >= 0) live[d1[i]] = 1; if (d2[i] >= 0) live[d2[i]] = 1; if (ctl[i] >= 0) live[ctl[i]] = 1; }
    for (let i = 0; i < n; i++) {
      if (cls[i] === PHI) { if (live[i]) prof.livePhis++; continue; }
      if (fnNames[fnr[i]] === process.env.DETAIL) { const k2 = VNAMES[vix[i]]; const e = DETAIL.get(k2) ?? [0, 0]; e[live[i] ? 0 : 1]++; DETAIL.set(k2, e); }
      const k = live[i] ? 'live' : 'dead';
      prof.slice[k][tg[i]]++;
      prof.sliceByClass[k][cls[i]]++;
      const pf = (prof.sliceByFn[fnr[i]] ??= [0, 0]); pf[live[i] ? 0 : 1]++;
    }
  }
  return bytes.subarray(0, memBytes.length);
}

const newProf = () => ({
  byTag: new Float64Array(5), byClass: CLASSES.map(() => new Float64Array(5)), byFn: [], calls: [], loads: {}, stores: {},
  callArgs: new Float64Array(5), identityCandidates: 0, livePhis: 0,
  slice: { live: new Float64Array(5), dead: new Float64Array(5) }, sliceByClass: { live: new Float64Array(CLASSES.length), dead: new Float64Array(CLASSES.length) }, sliceByFn: [],
});

const results = [];
for (const s of want.length ? want.map(w => scenes.find(x => x.id === w || String(x.index) === w)) : [scenes[0]]) {
  const t0 = performance.now();
  const host = new R.CandelaHost((nm, a, m) => evaluate(st, nm, a, m, { limit: 2e9 }));
  host.bind(s);
  const v = host.view, ARENA = 4096;
  // regions of the frame-constant memory, read from K's pointer words as the host wrote them
  const NAMES = ['U', 'O', 'LI', 'BV', 'SD', 'etab', 'sky'];
  const regions = [{ name: 'K', lo: ARENA, hi: ARENA + 68 }];
  for (let b = 0; b < 7; b++) { const p = v.getInt32(ARENA + 4 * b, true), cap = v.getInt32(p, true); regions.push({ name: NAMES[b], lo: p, hi: p + 4 + 2 * cap }); }
  regions.push({ name: 'out', lo: host.out, hi: host.out + 4 + 2 * v.getInt32(host.out, true) });
  const memTagsOf = () => {
    const t = new Uint8Array(host.mem.length).fill(D);
    for (const r of regions.slice(1, 8)) t.fill(M, r.lo, r.hi);
    t.fill(M, ARENA, ARENA + 28); t.fill(KT, ARENA + 28, ARENA + 32); t.fill(M, ARENA + 32, ARENA + 40);
    t.fill(M, host.out, host.out + 4); // the output buffer's capacity word
    return t;
  };
  const profs = { data: newProf(), control: newProf() };
  let pixels = 0, differ = 0, evalSteps = 0;
  const w = Math.ceil(s.width / stride), h = Math.ceil(s.height / stride);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const y = j * stride, x = i * stride;
      const argv = [ARENA, host.out, y, x, x + 1, 0], argTags = [C, C, D, D, D, D]; // K's and out's addresses are the host's
      const before = host.mem.slice();
      const outs = {};
      for (const mode of ['data', 'control']) outs[mode] = shadow(mode, 'cdlRenderSpan', argv, argTags, before, memTagsOf(), regions, profs[mode]);
      const s0 = host.steps;
      host.span(y, x, x + 1, 0);
      evalSteps += host.steps - s0;
      for (const mode of ['data', 'control'])
        for (let k = 0; k < 12; k++) if (new DataView(outs[mode].buffer, outs[mode].byteOffset).getUint32(host.out + 4 + 4 * k, true) !== v.getUint32(host.out + 4 + 4 * k, true)) differ++;
      pixels++;
    }
  const per = x => +(x / pixels).toFixed(1);
  const sum = a => a.reduce((x, y) => x + y, 0);
  const summarize = (p, mode) => {
    const total = sum(p.byTag);
    const o = {
      perPixel: Object.fromEntries(TAGS.map((t, i) => [t, per(p.byTag[i])])), totalPerPixel: per(total),
      byClassPerPixel: Object.fromEntries(CLASSES.map((c, k) => [c, Object.fromEntries(TAGS.map((t, i) => [t, per(p.byClass[k][i])]))])),
      loadsPerPixel: Object.fromEntries(Object.entries(p.loads).map(([r, a]) => [r, Object.fromEntries(TAGS.map((t, i) => [t, per(a[i])]))])),
      storesPerPixel: Object.fromEntries(Object.entries(p.stores).map(([r, a]) => [r, Object.fromEntries(TAGS.map((t, i) => [t, per(a[i])]))])),
      callsByMaxArgTagPerPixel: Object.fromEntries(TAGS.map((t, i) => [t, per(p.callArgs[i])])),
      identityCandidatesPerPixel: per(p.identityCandidates),
      topFunctions: p.byFn.map((a, fi) => a && { fn: fnNames[fi], calls: per(p.calls[fi] ?? 0), ...Object.fromEntries(TAGS.map((t, i) => [t, per(a[i])])) }).filter(Boolean)
        .sort((a, b) => sum(TAGS.map(t => b[t])) - sum(TAGS.map(t => a[t]))).slice(0, 25),
    };
    const [c, k, m, x, d] = [...p.byTag];
    o.bounds = {
      staticShare: +(((c + k + m) / total) * 100).toFixed(1),
      memoryShare: +((m / total) * 100).toFixed(1),
      // what remains after the existing per-scene kernel, taken optimistically (every C and K operation already gone)
      // or pessimistically (only K gone), divided by what remains after ideal specialization
      noTrick: { lo: +((m + x + d) / (x + d)).toFixed(2), hi: +((c + m + x + d) / (x + d)).toFixed(2) },
      withTrick: { lo: +((m + x + d) / d).toFixed(2), hi: +((c + m + x + d) / d).toFixed(2) },
    };
    if (mode === 'data') {
      const live = sum(p.slice.live), dead = sum(p.slice.dead);
      o.slice = { liveXDPerPixel: per(live), deadXDPerPixel: per(dead), liveSelectionsPerPixel: per(p.livePhis), liveByClassPerPixel: Object.fromEntries(CLASSES.map((cl, i) => [cl, per(p.sliceByClass.live[i])])), deadByClassPerPixel: Object.fromEntries(CLASSES.map((cl, i) => [cl, per(p.sliceByClass.dead[i])])) };
      o.bounds.noTrickWithDce = { lo: +((m + x + d) / live).toFixed(2), hi: +((c + m + x + d) / live).toFixed(2) };
      o.topDeadFunctions = p.sliceByFn.map((a, fi) => a && { fn: fnNames[fi], live: per(a[0]), dead: per(a[1]) }).filter(Boolean).sort((a, b) => b.dead - a.dead).slice(0, 12);
    }
    return o;
  };
  const row = {
    scene: s.id, title: s.title, stride, pixels, evaluatorStatementsPerPixel: per(evalSteps), differingFloats: differ,
    data: summarize(profs.data, 'data'), control: summarize(profs.control, 'control'), ms: Math.round(performance.now() - t0),
  };
  results.push(row);
  const d = row.data, c = row.control;
  console.error(`${s.id}: ${pixels} px, ${differ} differing floats, ${row.ms} ms; ops/px ${d.totalPerPixel} (data: C ${d.perPixel.C} K ${d.perPixel.K} M ${d.perPixel.M} X ${d.perPixel.X} D ${d.perPixel.D}; live X/D ${d.slice.liveXDPerPixel}); control: C ${c.perPixel.C} K ${c.perPixel.K} M ${c.perPixel.M} X ${c.perPixel.X} D ${c.perPixel.D}`);
  console.error(`  bounds data ${JSON.stringify(d.bounds)} control ${JSON.stringify(c.bounds)}`);
}
const rows = [...DETAIL].sort((a, b) => b[1][1] - a[1][1]).slice(0, 20);
for (const [id, [l, d]] of rows) console.error(id, 'live', l, 'dead', d, st.get(id)?.op);
const out = JSON.stringify(results, null, 1);
if (opt('--json')) writeFileSync(opt('--json'), out + '\n');
else console.log(out);
