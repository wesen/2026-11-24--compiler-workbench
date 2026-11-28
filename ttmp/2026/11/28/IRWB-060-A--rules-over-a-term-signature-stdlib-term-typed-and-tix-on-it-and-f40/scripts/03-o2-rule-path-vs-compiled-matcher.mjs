// IRWB-060-A decision point: the library rule path against today's compiled matcher, on the O2 corpus,
// interleaved in one process (the machine is loaded; interleaving cancels drift).
//
//   library path  today's PASSES, whose fold/simplify bodies match and instantiate through stdlib/term
//   direct path   the same bodies with the pre-IRWB-060-A matcher, copied verbatim from the compile.ts
//                 of commit 5d52199 (matchPat / firstMatch / instantiate over a plain-object bindings)
//
// Both run the whole O2 pipeline under the meaning contract, alternating the order each round; the
// revision after each run must be the same for both paths (printed once, first round).
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { PIPELINES, PASSES, typedPass } = await import('../../../../../../dist/typed/passes.js');
const { FOLD_RULES } = await import('../../../../../../dist/typed/rules/fold.js');
const { SIMPLIFY_RULES } = await import('../../../../../../dist/typed/rules/simplify.js');
const { isPow2, log2, evalOp, numOf } = await import('../../../../../../dist/typed/rules/compile.js');

// ---------- today's (pre-060-A) compiled matcher, verbatim ----------
const MIN = -2147483648;
const matchPat = (p, h, b) => {
  if ('var' in p) {
    b[p.var] = h;
    return true;
  }
  if ('constVar' in p) {
    if (!h.isConst) return false;
    b[p.constVar] = h;
    return true;
  }
  if ('const' in p) return h.isConst && h.imm === p.const;
  if ('same' in p) return h.same(b[p.same]);
  if (h.op !== p.op) return false;
  const args = h.args;
  if (args.length !== p.args.length) return false;
  for (let i = 0; i < args.length; i++) if (!matchPat(p.args[i], args[i], b)) return false;
  return true;
};
const guardHolds = (g, b) => {
  if ('pure' in g) return b[g.pure].isPure;
  if ('pow2' in g) return isPow2(b[g.pow2].imm);
  if ('boolean' in g) return b[g.boolean].isBoolean;
  const x = b[g.noTrap[0]].imm,
    y = b[g.noTrap[1]].imm;
  return !(y === 0 || (x === MIN && y === -1));
};
const noteOf = (text, b) =>
  text.replace(/\{(log2 )?([a-z]\w*)\}/g, (_m, l, x) => String(l ? log2(b[x].imm) : b[x].imm));
const guardPremises = (r, b) =>
  (r.where ?? []).map(g =>
    'pure' in g
      ? `guard:pure(${b[g.pure].id})`
      : 'pow2' in g
        ? `guard:pow2(${b[g.pow2].id})`
        : 'boolean' in g
          ? `guard:boolean(${b[g.boolean].id})`
          : `guard:noTrap(${g.noTrap[1]} at ${b[g.noTrap[0]].id})`,
  );
const becauseEntities = (r, v) =>
  (r.because === 'const-args' ? v.args.filter(x => x.isConst) : r.because === 'args' ? v.args : []).map(
    x => x.id,
  );
const subtree = v => [v.id, ...v.args.flatMap(subtree)];
const provenance = (r, v, b) => ({
  ...{
    ...(r.because === 'const-args'
      ? { because: v.args.filter(x => x.isConst) }
      : r.because === 'args'
        ? { because: v.args }
        : {}),
  },
  ...(r.note ? { note: noteOf(r.note, b) } : {}),
});
const instantiateDirect = (t, b, tx, prov) => {
  if ('var' in t) return b[t.var].id;
  if ('const' in t)
    return tx.const(numOf(t.const, x => b[x].imm), t.type ? { ...prov, type: t.type } : prov);
  const ids = t.args.map(a => instantiateDirect(a, b, tx, {}));
  return tx.make(t.op, ...ids, prov);
};
const firstMatchDirect = (index, v) => {
  const list = index.get(v.op);
  if (!list) return undefined;
  for (const r of list) {
    const b = {};
    if (!matchPat(r.lhs, v, b)) continue;
    if (r.where && !r.where.every(g => guardHolds(g, b))) continue;
    return { rule: r, bindings: b };
  }
  return undefined;
};
const indexRulesDirect = rules => {
  const index = new Map();
  for (const r of rules) {
    const list = index.get(r.lhs.op);
    if (list) list.push(r);
    else index.set(r.lhs.op, [r]);
  }
  return index;
};
const idOf = value => (typeof value === 'string' ? value : value.id);
const compileRulesDirect = (rules, table) => {
  const index = indexRulesDirect(rules);
  return tx => v => {
    const m = firstMatchDirect(index, v);
    if (!m) return undefined;
    const by = { rule: m.rule.name, ...(table ? { table } : {}) };
    const premises = [...guardPremises(m.rule, m.bindings), ...becauseEntities(m.rule, v)];
    const note = m.rule.note ? noteOf(m.rule.note, m.bindings) : undefined;
    const site = subtree(v);
    const active = { by, premises, site, ...(note ? { note } : {}) };
    return tx.withRule(active, () => {
      const made = tx.steps.length;
      const out = instantiateDirect(m.rule.rhs, m.bindings, tx, provenance(m.rule, v, m.bindings));
      if (tx.steps.length === made) tx.inPlace(active, site, idOf(out));
      return out;
    });
  };
};
const tableBodyDirect = (rules, table) => {
  const visitor = compileRulesDirect(rules, table);
  return ({ tx }) => tx.rewrite(visitor(tx));
};

// ---------- the two pass sets ----------
const variant = (name, body) => typedPass({ ...PASSES[name].typed, body });
const DIRECT = { ...PASSES, fold: variant('fold', tableBodyDirect(FOLD_RULES.rules, 'fold')), simplify: variant('simplify', tableBodyDirect(SIMPLIFY_RULES.rules, 'simplify')) };

/** One O2 compile of `id` under `passes`; returns {ms, ruleMs, revision, ruleEdits}. */
async function o2(id, passes) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  if (p.status !== 'ok') return undefined;
  const t0 = performance.now();
  const steps = [];
  for (const name of PIPELINES.O2) steps.push(await p.apply(passes[name]));
  const ms = performance.now() - t0;
  const ruleMs = steps.filter(s => s.pass === 'fold' || s.pass === 'simplify').reduce((a, s) => a + s.ms, 0);
  const ruleEdits = steps.filter(s => s.pass === 'fold' || s.pass === 'simplify').reduce((a, s) => a + (s.edits ?? 0), 0);
  return { ms, ruleMs, ruleEdits, revision: p.head.revision };
}

const ROUNDS = 5;
const ids = projectIds().filter(id => {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  return p.status === 'ok';
});
console.log(`${ids.length} projects, O2 has ${PIPELINES.O2.length} steps, ${ROUNDS} interleaved rounds`);
const totals = { library: 0, direct: 0, libraryRules: 0, directRules: 0 };
let differ = 0;
for (let round = 0; round < ROUNDS; round++) {
  for (const id of ids) {
    // alternate the order each round: load and cache warmth cannot favour one path
    const first = round % 2 === 0 ? ['library', PASSES] : ['direct', DIRECT];
    const second = round % 2 === 0 ? ['direct', DIRECT] : ['library', PASSES];
    const a = await o2(id, first[1]);
    const b = await o2(id, second[1]);
    if (round === 0 && a.revision !== b.revision) {
      differ++;
      console.log(`REVISION DIFFERS on ${id}`);
    }
    totals[first[0]] += a.ms;
    totals[second[0]] += b.ms;
    totals[first[0] + 'Rules'] += a.ruleMs;
    totals[second[0] + 'Rules'] += b.ruleMs;
  }
}
const pct = (x, y) => {
  const d = ((x - y) / y) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(2)}% (${d >= 0 ? 'slower' : 'faster'})`;
};
console.log(`revision differences: ${differ}`);
console.log(
  `O2 compile time, whole corpus x ${ROUNDS}: library ${totals.library.toFixed(0)} ms, direct ${totals.direct.toFixed(0)} ms`,
);
console.log(`  whole-pipeline: the library path is ${pct(totals.library, totals.direct)} than today's matcher`);
console.log(`  (the per-pass ms include the meaning contract, which dominates and jitters; the whole-pipeline
   ratio is the decision number, and both orderings were run alternately)`);
console.log(`fold+simplify only:     library ${totals.libraryRules.toFixed(0)} ms, direct ${totals.directRules.toFixed(0)} ms`);
console.log(`  fold+simplify only: the library path is ${pct(totals.libraryRules, totals.directRules)} than today's matcher`);
