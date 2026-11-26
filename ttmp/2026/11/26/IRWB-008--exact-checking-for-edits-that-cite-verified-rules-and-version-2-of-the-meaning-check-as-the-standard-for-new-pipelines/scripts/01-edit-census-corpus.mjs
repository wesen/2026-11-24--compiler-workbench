// IRWB-008, measurement 01: where the changes of the corpus pipelines come from, whether each rule-backed edit can be
// re-derived exactly from its before-tree and the rule data, and what the sampled meaning check costs per pass.
//
// For every corpus project and every pipeline (O1, O2, O2+, loops, checks, O2-sccp), each pass is applied with
// applyPass and no contract (the pass's own cost), then the sampled check `typed.meaning-kept` of the default
// parameters is run on (r0, output) with runDifferentialAsync, exactly the invariant the gate runs, and timed apart.
// A rejected step is recorded and skipped, as Program.pipeline does.
//
// Re-derivation (a prototype of the proposed edit validator, written here from the rule data only): for every
// `replace` edit of simplify or fold, take the tree rooted at edit.from in the input revision and the tree rooted at
// edit.to in the output revision, normalize the first bottom-up with the pass's rule table (first matching rule per
// root operator, in table order; the replacement is not revisited, as in Tx.rewrite), and compare the result with
// the second structurally (op, imm, type, operands). The matcher, the guards and the instantiation are re-implemented
// here; only the operator values come from the evaluator (evalOp: binop, f32Op), which is the specification.
//
// usage: node 01-edit-census-corpus.mjs [--no-reuse] [--json out.json] [--projects a,b]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { projectSource, ingestProject } = await import(root + 'dist/typed/project.js');
const { PIPELINES } = await import(root + 'dist/typed/passes.js');
const { SSA_PIPELINES, passNamed } = await import(root + 'dist/typed/sccp.js');
const { SIMPLIFY_RULES } = await import(root + 'dist/typed/rules/simplify.js');
const { FOLD_RULES } = await import(root + 'dist/typed/rules/fold.js');
const { RULE_EVIDENCE } = await import(root + 'dist/typed/rules/evidence.js');
const { evalOp } = await import(root + 'dist/typed/rules/compile.js');
const { meaningKept } = await import(root + 'dist/typed/evaluate.js');
const { COMPARE } = await import(root + 'dist/typed/listing.js');
const { F32_RESULT } = await import(root + 'dist/typed/f32.js');
const C = await import(root + 'dist/framework/contracts/index.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const { writeFileSync } = await import('node:fs');

const argv = process.argv.slice(2);
const opt = n => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const reuse = !argv.includes('--no-reuse');
C.setDifferentialReuse(reuse);
const ids = opt('--projects') ? opt('--projects').split(',') : projectIds();
const PIPES = ['O1', 'O2', 'O2+', 'loops', 'checks', 'O2-sccp'];
const listOf = pl => SSA_PIPELINES[pl] ?? PIPELINES[pl];

// ---------- the independent re-derivation ----------
const MIN = -2147483648;
const IMPURE = new Set(['call', 'load', 'load16u', 'div', 'rem', 'caddr', 'result']);
const isPow2 = n => n > 0 && (n & (n - 1)) === 0;
const log2 = n => 31 - Math.clz32(n);
const treeOf = (values, id) => {
  const v = values[id];
  return { op: v.op, imm: v.imm, type: v.type, args: v.args.map(a => treeOf(values, a)) };
};
const sameT = (x, y) =>
  x.op === y.op && x.imm === y.imm && x.type === y.type && x.args.length === y.args.length && x.args.every((a, i) => sameT(a, y.args[i]));
const pureT = t => !IMPURE.has(t.op) && t.args.every(pureT);
const sizeT = t => 1 + t.args.reduce((s, a) => s + sizeT(a), 0);
function match(p, t, b) {
  if ('var' in p) return (b[p.var] = t), true;
  if ('constVar' in p) return t.op === 'const' ? ((b[p.constVar] = t), true) : false;
  if ('const' in p) return t.op === 'const' && t.imm === p.const;
  if ('same' in p) return sameT(t, b[p.same]);
  return t.op === p.op && t.args.length === p.args.length && p.args.every((q, i) => match(q, t.args[i], b));
}
function guard(g, b) {
  if ('pure' in g) return pureT(b[g.pure]);
  if ('pow2' in g) return isPow2(b[g.pow2].imm);
  if ('boolean' in g) return COMPARE.has(b[g.boolean].op);
  const x = b[g.noTrap[0]].imm, y = b[g.noTrap[1]].imm;
  return !(y === 0 || (x === MIN && y === -1));
}
function num(n, b) {
  if (typeof n === 'number') return n;
  if ('log2' in n) return log2(b[n.log2].imm);
  return evalOp(n.eval, n.args.map(a => b[a].imm));
}
function inst(t, b) {
  if ('var' in t) return b[t.var];
  if ('const' in t) return { op: 'const', imm: num(t.const, b) | 0, type: t.type, args: [] };
  return { op: t.op, imm: undefined, type: F32_RESULT.has(t.op) ? 'f32' : undefined, args: t.args.map(a => inst(a, b)) };
}
const indexOf = rules => {
  const m = new Map();
  for (const r of rules) (m.get(r.lhs.op) ?? m.set(r.lhs.op, []).get(r.lhs.op)).push(r);
  return m;
};
const INDEX = { simplify: indexOf(SIMPLIFY_RULES.rules), fold: indexOf(FOLD_RULES.rules) };
function normalize(t, index, fired) {
  const n = { ...t, args: t.args.map(a => normalize(a, index, fired)) };
  for (const r of index.get(n.op) ?? []) {
    const b = {};
    if (!match(r.lhs, n, b)) continue;
    if (r.where && !r.where.every(g => guard(g, b))) continue;
    fired.push(r.name);
    return inst(r.rhs, b);
  }
  return n;
}
const STRENGTH_ORDER = ['proof', 'exhaustive', 'by-construction', 'reduced-width+argument', 'sampled'];
const weakest = names =>
  names.map(n => RULE_EVIDENCE[n]?.strength ?? 'none').reduce((w, s) => (STRENGTH_ORDER.indexOf(s) > STRENGTH_ORDER.indexOf(w) ? s : w), 'proof');

// ---------- census ----------
const byPass = {}; // pass -> totals
const P = name =>
  (byPass[name] ??= {
    applications: 0, changed: 0, rejected: 0, edits: 0, kinds: {}, entityChanges: 0, fnsTouched: 0, fnsTotal: 0,
    passMs: 0, checkMs: 0, subjectRuns: 0, replayed: 0, baselineRuns: 0, cases: 0,
    replace: 0, rederived: 0, notRederived: [], firings: {}, weakest: {}, rederiveMs: 0, nodesBefore: 0, nodesAfter: 0,
  });
const byPipeline = {};
const t0 = performance.now();
for (const id of ids) {
  const p = projectSource(id, projectFiles(id)),
    r0 = ingestProject(p);
  const fnsTotal = Object.keys(r0.value.fns).length;
  const spec = C.differentialSpec(meaningKept({ inputs: p.meta.inputs }));
  for (const pl of PIPES) {
    const manager = new C.AnalysisManager();
    const pipe = (byPipeline[pl] ??= { applications: 0, changed: 0, edits: 0, entityChanges: 0, checkMs: 0, passMs: 0 });
    let cur = r0;
    for (const name of listOf(pl)) {
      const pass = passNamed(name),
        s = P(name);
      s.applications++;
      pipe.applications++;
      let a = performance.now();
      const r = await applyPass(pass, cur, { manager });
      const passMs = performance.now() - a;
      s.passMs += passMs;
      pipe.passMs += passMs;
      if (!r.changed) continue;
      const st0 = C.differentialStats();
      a = performance.now();
      const ev = await C.runDifferentialAsync(spec, { origin: r0, candidate: r.artifact });
      const checkMs = performance.now() - a;
      const st1 = C.differentialStats();
      s.checkMs += checkMs;
      pipe.checkMs += checkMs;
      s.subjectRuns += st1.subjectRuns - st0.subjectRuns;
      s.replayed += st1.replayed - st0.replayed;
      s.baselineRuns += st1.baselineRuns - st0.baselineRuns;
      s.cases += ev.total;
      if (ev.status !== 'agree') {
        s.rejected++;
        continue;
      }
      s.changed++;
      pipe.changed++;
      const edits = r.report?.edits ?? [];
      s.edits += edits.length;
      pipe.edits += edits.length;
      for (const e of edits) s.kinds[e.kind] = (s.kinds[e.kind] ?? 0) + 1;
      s.entityChanges += r.changes.entities.length;
      pipe.entityChanges += r.changes.entities.length;
      s.fnsTouched += r.report?.fns?.length ?? 0;
      s.fnsTotal += fnsTotal;
      if (name === 'simplify' || name === 'fold') {
        a = performance.now();
        for (const e of edits) {
          if (e.kind !== 'replace') continue;
          s.replace++;
          const before = treeOf(cur.value.values, e.from),
            after = treeOf(r.artifact.value.values, e.to);
          const fired = [];
          const got = normalize(before, INDEX[name], fired);
          s.nodesBefore += sizeT(before);
          s.nodesAfter += sizeT(after);
          if (sameT(got, after)) {
            s.rederived++;
            for (const f of fired) s.firings[f] = (s.firings[f] ?? 0) + 1;
            const w = weakest(fired);
            s.weakest[w] = (s.weakest[w] ?? 0) + 1;
          } else s.notRederived.push(`${id} ${pl} ${name} ${e.id} ${e.stmt}`);
        }
        s.rederiveMs += performance.now() - a;
      }
      cur = r.artifact;
    }
  }
}
const ms = performance.now() - t0;
const round = x => Math.round(x * 10) / 10;
for (const s of Object.values(byPass)) for (const k of ['passMs', 'checkMs', 'rederiveMs']) s[k] = round(s[k]);
for (const s of Object.values(byPipeline)) for (const k of ['passMs', 'checkMs']) s[k] = round(s[k]);
const out = { projects: ids.length, pipelines: PIPES, reuse, ms: Math.round(ms), byPass, byPipeline };
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(out, null, 1) + '\n');

// ---------- a summary at 72 columns ----------
const pad = (x, n) => String(x).padStart(n);
const lines = [];
lines.push(`projects ${ids.length}, pipelines ${PIPES.join(' ')}, reuse ${reuse}, ${Math.round(ms)} ms`);
lines.push('pass        apps chg  edits  ent.chg  fns/tot   pass ms  check ms');
const tot = { edits: 0, ent: 0 };
for (const [n, s] of Object.entries(byPass)) {
  tot.edits += s.edits;
  tot.ent += s.entityChanges;
  lines.push(
    `${n.padEnd(10)} ${pad(s.applications, 5)}${pad(s.changed, 4)}${pad(s.edits, 7)}${pad(s.entityChanges, 9)}` +
      `${pad(`${s.fnsTouched}/${s.fnsTotal}`, 9)}${pad(Math.round(s.passMs), 10)}${pad(Math.round(s.checkMs), 10)}`,
  );
}
const rb = ['simplify', 'fold'].reduce((a, n) => ({ e: a.e + (byPass[n]?.edits ?? 0), c: a.c + (byPass[n]?.entityChanges ?? 0) }), { e: 0, c: 0 });
lines.push(`rule-backed (simplify, fold): edits ${rb.e} of ${tot.edits} (${round((100 * rb.e) / tot.edits)} %), entity changes ${rb.c} of ${tot.ent} (${round((100 * rb.c) / tot.ent)} %)`);
for (const n of ['simplify', 'fold']) {
  const s = byPass[n];
  if (!s) continue;
  lines.push(`${n}: replace edits ${s.replace}, re-derived ${s.rederived}, not ${s.notRederived.length}; ${round(s.rederiveMs)} ms re-deriving`);
  lines.push(`  weakest strength per edit: ${JSON.stringify(s.weakest)}`);
  lines.push(`  firings: ${JSON.stringify(s.firings)}`);
  for (const x of s.notRederived.slice(0, 10)) lines.push(`  NOT: ${x}`);
}
lines.push('pipeline   apps chg  edits  ent.chg   pass ms  check ms');
for (const [n, s] of Object.entries(byPipeline))
  lines.push(`${n.padEnd(9)}${pad(s.applications, 5)}${pad(s.changed, 4)}${pad(s.edits, 7)}${pad(s.entityChanges, 9)}${pad(Math.round(s.passMs), 10)}${pad(Math.round(s.checkMs), 10)}`);
console.log(lines.join('\n'));
