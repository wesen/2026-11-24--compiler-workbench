// IRWB-060-B, the decision point: the library's rule path against the matcher Typed had before this step, on the O2
// corpus, interleaved in one process.
//
// Both paths run the same three table-driven pass specs (fold, simplify, identities) over the same r0 revision of
// every corpus project, under the same meaning contract, so the difference between them is the matcher and the
// instantiator and nothing else. "Today's" path is a verbatim copy of the pre-IRWB-060-B compile.ts (matchPat,
// indexRules, firstMatch, instantiate) below; the library's path is the real passes in dist/.
//
//   node ttmp/2026/11/28/IRWB-060-B--…/scripts/01-rule-path-measurement.mjs [rounds]
//
// The machine is shared, so each round measures both paths (the order alternating per round and per project) and the
// report takes the minimum over rounds for each path. Two numbers come out: the rule passes' cost, and O2's total
// compile cost per corpus project (measured on the library's path, the only path complete enough to run the whole
// pipeline), which is what the ratio is taken against.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// run from the repository root (the worktree), after `npm run build`
const at = p => pathToFileURL(join(process.cwd(), p)).href;
const { installVendor } = await import(at('tools/node-vendor.mjs'));
const { projectIds, projectFiles } = await import(at('tools/corpus.mjs'));

await installVendor();
const { Program } = await import(at('dist/typed/program.js'));
const { projectSource } = await import(at('dist/typed/project.js'));
const { fold, simplify, typedPass } = await import(at('dist/typed/passes.js'));
const { isPow2, log2, numOf, tableBody } = await import(at('dist/typed/rules/compile.js'));
const { SIMPLIFY_RULES } = await import(at('dist/typed/rules/simplify.js'));
const { FOLD_RULES } = await import(at('dist/typed/rules/fold.js'));
const { IDENTITY_RULES } = await import(at('dist/typed/rules/identities.js'));
const { AnalysisManager } = await import(at('dist/framework/contracts/index.js'));
const { applyTransformationSync } = await import(at('dist/framework/passes/index.js'));

// ---------- the pre-IRWB-060-B matcher, verbatim (compile.ts at e01f5cb) ----------
function matchPat(p, h, b) {
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
}
const MIN = -2147483648;
function guardHolds(g, b) {
  if ('pure' in g) return b[g.pure].isPure;
  if ('pow2' in g) return isPow2(b[g.pow2].imm);
  if ('boolean' in g) return b[g.boolean].isBoolean;
  const x = b[g.noTrap[0]].imm,
    y = b[g.noTrap[1]].imm;
  return !(y === 0 || (x === MIN && y === -1));
}
const noteOf = (text, b) =>
  text.replace(/\{(log2 )?([a-z]\w*)\}/g, (_m, l, x) => {
    const n = b[x].imm;
    return String(l ? log2(n) : n);
  });
function guardPremises(r, b) {
  return (r.where ?? []).map(g =>
    'pure' in g
      ? `guard:pure(${b[g.pure].id})`
      : 'pow2' in g
        ? `guard:pow2(${b[g.pow2].id})`
        : 'boolean' in g
          ? `guard:boolean(${b[g.boolean].id})`
          : `guard:noTrap(${g.noTrap[1]} at ${b[g.noTrap[0]].id})`,
  );
}
const becauseEntities = (r, v) =>
  (r.because === 'const-args' ? v.args.filter(x => x.isConst) : r.because === 'args' ? v.args : []).map(x => x.id);
const subtree = v => [v.id, ...v.args.flatMap(subtree)];
function provenance(r, v, b) {
  const because =
    r.because === 'const-args' ? v.args.filter(x => x.isConst) : r.because === 'args' ? v.args : undefined;
  return { ...(because ? { because } : {}), ...(r.note ? { note: noteOf(r.note, b) } : {}) };
}
function instantiateOld(t, b, tx, prov) {
  if ('var' in t) return b[t.var].id;
  if ('const' in t)
    return tx.const(numOf(t.const, x => b[x].imm), t.type ? { ...prov, type: t.type } : prov);
  const ids = t.args.map(a => instantiateOld(a, b, tx, {}));
  return tx.make(t.op, ...ids, prov);
}
function indexRulesOld(rules) {
  const index = new Map();
  for (const r of rules) {
    const list = index.get(r.lhs.op);
    if (list) list.push(r);
    else index.set(r.lhs.op, [r]);
  }
  return index;
}
function firstMatchOld(index, v) {
  const list = index.get(v.op);
  if (!list) return undefined;
  for (const r of list) {
    const b = {};
    if (!matchPat(r.lhs, v, b)) continue;
    if (r.where && !r.where.every(g => guardHolds(g, b))) continue;
    return { rule: r, bindings: b };
  }
  return undefined;
}
function compileRulesOld(rules, table) {
  const index = indexRulesOld(rules);
  return tx => v => {
    const m = firstMatchOld(index, v);
    if (!m) return undefined;
    const by = { rule: m.rule.name, ...(table ? { table } : {}) };
    const premises = [...guardPremises(m.rule, m.bindings), ...becauseEntities(m.rule, v)];
    const note = m.rule.note ? noteOf(m.rule.note, m.bindings) : undefined;
    const site = subtree(v);
    const active = { by, premises, site, ...(note ? { note } : {}) };
    return tx.withRule(active, () => {
      const made = tx.steps.length;
      const out = instantiateOld(m.rule.rhs, m.bindings, tx, provenance(m.rule, v, m.bindings));
      if (tx.steps.length === made) tx.inPlace(active, site, typeof out === 'string' ? out : out.id);
      return out;
    });
  };
}
const tableBodyOld = (rules, table) => {
  const visitor = compileRulesOld(rules, table);
  return ({ tx }) => tx.rewrite(visitor(tx));
};

// ---------- the two paths ----------
const paths = {
  today: {
    fold: typedPass({ ...fold.typed, body: tableBodyOld(FOLD_RULES.rules, 'fold') }),
    simplify: typedPass({ ...simplify.typed, body: tableBodyOld(SIMPLIFY_RULES.rules, 'simplify') }),
    identities: typedPass({ ...simplify.typed, body: tableBodyOld(IDENTITY_RULES.rules, 'identities') }),
  },
  library: {
    fold: typedPass({ ...fold.typed, body: tableBody(FOLD_RULES.rules, undefined, 'fold') }),
    simplify: typedPass({ ...simplify.typed, body: tableBody(SIMPLIFY_RULES.rules, undefined, 'simplify') }),
    identities: typedPass({ ...simplify.typed, body: tableBody(IDENTITY_RULES.rules, undefined, 'identities') }),
  },
};
const ORDER = ['fold', 'simplify', 'identities'];

const rounds = Number(process.argv[2] ?? 3);
const ids = projectIds().filter(id => Program.fromProject(projectSource(id, projectFiles(id))).status === 'ok');
const ruleMs = { today: new Map(), library: new Map() },
  revision = { today: new Map(), library: new Map() },
  o2Ms = new Map();

for (let round = 0; round < rounds; round++) {
  ids.forEach((id, i) => {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    const order = (round + i) % 2 ? ['today', 'library'] : ['library', 'today'];
    for (const path of order) {
      const t0 = performance.now();
      for (const name of ORDER)
        applyTransformationSync(paths[path][name], p.head, { manager: new AnalysisManager() });
      const ms = performance.now() - t0;
      ruleMs[path].set(id, Math.min(ruleMs[path].get(id) ?? Infinity, ms));
      // the two paths must compute the same program, or the timings compare different work
      let last = p.head;
      for (const name of ORDER) last = applyTransformationSync(paths[path][name], last, { manager: new AnalysisManager() }).artifact;
      revision[path].set(id, last.revision);
    }
  });
}
// O2's total, on the library's path (the only one that can run the whole pipeline): the denominator
for (let round = 0; round < Math.min(rounds, 2); round++)
  for (const id of ids) {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    const t0 = performance.now();
    await p.pipeline('O2');
    const ms = performance.now() - t0;
    o2Ms.set(id, Math.min(o2Ms.get(id) ?? Infinity, ms));
  }

const differing = ids.filter(id => revision.today.get(id) !== revision.library.get(id));
const sum = m => [...m.values()].reduce((a, b) => a + b, 0);
const base = sum(ruleMs.today),
  lib = sum(ruleMs.library),
  o2 = sum(o2Ms),
  delta = lib - base;
const fmt = n => n.toFixed(0).padStart(7);
console.log(`IRWB-060-B decision point: the library's rule path against the pre-change matcher`);
console.log(`corpus: ${ids.length} Typed projects, O2; ${rounds} interleaved rounds, minimum per project`);
console.log(`  rule passes (fold, simplify, identities), today's matcher   ${fmt(base)} ms`);
console.log(`  rule passes, the library (stdlib/term)                      ${fmt(lib)} ms`);
console.log(`  difference                                                  ${fmt(delta)} ms  (${((delta / base) * 100).toFixed(1)} % of the rule passes)`);
console.log(`  O2 compile time, whole pipeline                             ${fmt(o2)} ms`);
console.log(`  difference as a share of O2 compile time                    ${((delta / o2) * 100).toFixed(2)} %`);
console.log(`  threshold: more than about 10 % of compile time withdraws the Typed port`);
const worst = [...ruleMs.library]
  .map(([id, ms]) => [id, ms - ruleMs.today.get(id)])
  .sort((a, b) => b[1] - a[1])
  .slice(0, 3);
console.log(`  largest per-project differences: ${worst.map(([id, d]) => `${id} ${d.toFixed(1)} ms`).join(', ')}`);
console.log(
  `  the two paths give the same revision on ${ids.length - differing.length}/${ids.length} projects` +
    (differing.length ? ` (they differ on ${differing.join(', ')})` : ''),
);
