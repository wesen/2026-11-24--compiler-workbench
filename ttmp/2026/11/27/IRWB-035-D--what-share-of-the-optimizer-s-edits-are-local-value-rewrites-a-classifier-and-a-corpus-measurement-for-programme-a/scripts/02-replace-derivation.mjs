// IRWB-035-D probe 2: can a `replace` edit be re-derived from the before-field's tree, either by the pass's own
// rule table or by a fact-guarded rule shape whose citation the pass recorded? Prototypes the classifier's tests
// before they move into src/typed/edit-classes.ts.
//
// For every changed pass application of O2 and speed on the corpus, one `replace` chain per (fn, stmt, field) —
// a field can be replaced more than once in one application, so its records are collapsed to the chain's first
// `from` and last `to` — and then:
//   1. `derived`: one bottom-up replay of the pass's rule table (fold, simplify) over the before tree equals the
//      after tree, recording which rules fired;
//   2. `fact rule`: every differing site is a shape with a premise and the made value's provenance cites it —
//      read->constant (constprop), div/rem by 2^k -> shr/and (strength), read->copy of its single definition (subst);
//   3. `made local`: the after tree reads a local the same application created (licm, lvn) — not equal by itself;
//   4. `other`: what none of the above explains.
//
//   node scripts/02-replace-derivation.mjs [--samples N] [--count N] [projects...]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const root = new URL('../../../../../../', import.meta.url).pathname;
const { projectSource, ingestProject, runPipeline } = await import(root + 'dist/typed/project.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { Store } = await import(root + 'dist/typed/model.js');
const { show, COMPARE } = await import(root + 'dist/typed/listing.js');
const { matchPat, guardHolds, numOf } = await import(root + 'dist/typed/rules/compile.js');
const { FOLD_RULES } = await import(root + 'dist/typed/rules/fold.js');
const { SIMPLIFY_RULES } = await import(root + 'dist/typed/rules/simplify.js');

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const nSamples = +flag('--samples', 5);
const count = +flag('--count', 8);
const only = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

const IMPURE = new Set(['call', 'load', 'load16u', 'div', 'rem', 'caddr', 'result']);
const TABLE = { fold: FOLD_RULES.rules, simplify: SIMPLIFY_RULES.rules };
const typeOf = t => t.type ?? 'i32';

/** A plain tree: {op, imm, type, args, id} (id only where the node exists in a store). */
function treeOf(st, id) {
  const v = st.get(id);
  return { op: v.op, imm: v.imm, type: v.type, args: v.args.map(a => treeOf(st, a)), id };
}
const eq = (a, b) =>
  a.op === b.op &&
  a.imm === b.imm &&
  typeOf(a) === typeOf(b) &&
  a.args.length === b.args.length &&
  a.args.every((x, i) => eq(x, b.args[i]));
const size = t => 1 + t.args.reduce((n, a) => n + size(a), 0);
const isPureTree = t => !IMPURE.has(t.op) && t.args.every(isPureTree);
const handle = t => ({
  id: null,
  op: t.op,
  imm: t.imm,
  get args() {
    return t.args.map(handle);
  },
  get isConst() {
    return t.op === 'const';
  },
  get isLeaf() {
    return t.args.length === 0;
  },
  get isPure() {
    return isPureTree(t);
  },
  get hasEffect() {
    return !isPureTree(t);
  },
  get isBoolean() {
    return COMPARE.has(t.op);
  },
  statement: null,
  text: '',
  same(other) {
    return eq(t, other && other.__tree ? other.__tree : other);
  },
  size: () => size(t),
  __tree: t,
});
const inst = (tpl, b) => {
  if ('var' in tpl) return b[tpl.var].__tree;
  if ('const' in tpl)
    return { op: 'const', imm: numOf(tpl.const, n => b[n].imm) | 0, type: tpl.type, args: [] };
  return { op: tpl.op, args: tpl.args.map(a => inst(a, b)), ...(tpl.type ? { type: tpl.type } : {}) };
};
function derive(t, rules, fired) {
  const node = { ...t, args: t.args.map(a => derive(a, rules, fired)) };
  const h = handle(node);
  for (const r of rules) {
    const b = {};
    if (!matchPat(r.lhs, h, b)) continue;
    if ((r.where ?? []).some(g => !guardHolds(g, b))) continue;
    fired.push(r.name);
    return inst(r.rhs, b);
  }
  return node;
}
/** Positions where two trees diverge; a node whose op/imm/type/arity differ stops the descent there. */
function sites(a, b, path = [], out = []) {
  if (a.op !== b.op || a.imm !== b.imm || typeOf(a) !== typeOf(b) || a.args.length !== b.args.length) {
    out.push({ before: a, after: b });
    return out;
  }
  a.args.forEach((x, i) => sites(x, b.args[i], [...path, i], out));
  return out;
}
const strip = t => JSON.stringify(t, (k, v) => (k === 'id' || k.startsWith('__') ? undefined : v));
const shape = t => (t.op === 'get' ? `get(${t.imm})` : t.op === 'const' ? `const(${t.imm})` : t.op);
const isPow2 = n => n > 0 && (n & (n - 1)) === 0;
const log2 = n => 31 - Math.clz32(n);

/** Does the made node cite a premise? Entries of its origin, for a node that exists in the after revision. */
const citations = (stAfter, node) => {
  const rec = node.id && stAfter.has(node.id) ? stAfter.get(node.id) : null;
  return rec && rec.origin ? rec.origin[0]?.because ?? [] : [];
};
/** Is `c` a definition of local `name` whose value is the tree `a`? The definition may be in either revision: a
 * pass application that propagates a constant into one statement and then reads it in the next has rewritten the
 * definition in its working copy, so the value a citation names is the one in the revision it produced. */
const definesAs = (st, c, name, a) => {
  if (!st.has(c)) return false;
  const s = st.get(c);
  if (s.kind !== 'stmt' || s.op !== 'set' || !s.value) return false;
  if (st.get(s.fn).locals[s.local].name !== name) return false;
  return eq(treeOf(st, s.value), a);
};

const buckets = new Map();
const bump = (key, sample) => {
  const cur = buckets.get(key) ?? { n: 0, samples: [] };
  cur.n++;
  if (cur.samples.length < nSamples) cur.samples.push(sample);
  buckets.set(key, cur);
};
let chains = 0,
  records = 0;

for (const id of only.length ? only : projectIds()) {
  const p = projectSource(id, projectFiles(id));
  const r0 = ingestProject(p);
  for (const pipeline of ['O2', 'speed']) {
    const manager = new AnalysisManager();
    const roots = p.meta.entries ? { roots: p.meta.entries } : {};
    const run = await runPipeline(r0, pipeline, { manager, inputs: p.meta.inputs, count, ...roots });
    for (const step of run.steps) {
      const report = step.report;
      if (!report || !report.edits) continue;
      const stBefore = Store.from(step.result.before.value);
      const stAfter = Store.from(step.result.artifact.value);
      const madeLocals = new Map();
      for (const e of report.edits)
        if (e.kind === 'local') madeLocals.set(e.local.replace(/^local:[^/]+\//, ''), e.pass);
      const sets = [];
      for (const f of stBefore.fns.values())
        for (const b of f.blocks)
          for (const sid of b.stmts) {
            const s = stBefore.get(sid);
            if (s.op === 'set' && s.value) sets.push({ local: f.locals[s.local].name, value: treeOf(stBefore, s.value) });
          }
      const chainMap = new Map();
      for (const e of report.edits) {
        if (e.kind !== 'replace') continue;
        records++;
        const k = `${e.fn}|${e.stmt}|${e.field}`;
        const c = chainMap.get(k) ?? { pass: e.pass, fn: e.fn, field: e.field, from: e.from, to: e.to };
        c.to = e.to;
        chainMap.set(k, c);
      }
      for (const e of chainMap.values()) {
        chains++;
        const where = `${id}/${e.fn} ${e.field}`;
        const key = (bucket, sample = where) => bump(`${e.pass}\t${bucket}`, sample);
        if (!stBefore.has(e.from) || !stAfter.has(e.to)) {
          key('chain endpoint absent');
          continue;
        }
        const before = treeOf(stBefore, e.from),
          after = treeOf(stAfter, e.to);
        const text = `${where}: ${show(stBefore, e.from)}  ->  ${show(stAfter, e.to)}`;
        if (eq(before, after)) {
          key('rebuilt, same tree');
          continue;
        }
        // 1. the pass's own rule table, replayed bottom-up
        const rules = TABLE[e.pass];
        if (rules) {
          const fired = [];
          if (strip(derive(before, rules, fired)) === strip(after)) {
            key(`derived:${[...new Set(fired)].join('+')}`, text);
            continue;
          }
        }
        // 2. every differing site is a fact rule with its citation
        const diff = sites(before, after);
        const factSite = s => {
          const b = s.before,
            a = s.after;
          if (b.op === 'get' && a.op === 'const') {
            const name = stBefore.fn(e.fn).locals[b.imm].name;
            const cited = citations(stAfter, a).filter(
              c => c.startsWith('local:') || definesAs(stBefore, c, name, a) || definesAs(stAfter, c, name, a),
            );
            return { ok: cited.length > 0, rule: 'read-to-constant', name };
          }
          if ((b.op === 'div' || b.op === 'rem') && b.args[1].op === 'const' && isPow2(b.args[1].imm)) {
            const k = b.args[1].imm;
            const want = b.op === 'div' ? { op: 'shr', imm: log2(k) } : { op: 'and', imm: k - 1 };
            const cited = citations(stAfter, a).some(c => c.startsWith('fact:ranges('));
            return {
              ok: a.op === want.op && eq(b.args[0], a.args[0]) && a.args[1].op === 'const' && a.args[1].imm === want.imm && cited,
              rule: `${b.op}-pow2-to-${want.op}`,
              name: `k=${k}`,
            };
          }
          if (b.op === 'get') {
            const name = stBefore.fn(e.fn).locals[b.imm].name;
            const copy = sets.some(s => s.local === name && eq(s.value, a));
            return { ok: copy, rule: 'read-to-single-definition', name };
          }
          return { ok: false };
        };
        const facts = diff.map(factSite);
        if (facts.every(r => r.ok)) {
          key(`fact:${[...new Set(facts.map(r => r.rule))].join('+')}`, text);
          continue;
        }
        // 3. the after tree reads a local this application created (hoisting, value numbering)
        const made = diff.filter(s => s.after.op === 'get' && madeLocals.has(stAfter.fn(e.fn).locals[s.after.imm].name));
        if (made.length) {
          key(`made-local:${[...new Set(diff.map(s => `${shape(s.before)}->get`))].join('+')}`, text);
          continue;
        }
        // 4. everything else, with what was not explained
        const why = diff
          .map((s, i) => `${shape(s.before)}->${shape(s.after)}${facts[i].rule ? `(${facts[i].rule}: ${facts[i].ok})` : ''}`)
          .join(',');
        key(`other:${why}`, text);
      }
    }
  }
}

console.log(`# replace chains: ${chains} of ${records} records\n`);
for (const [k, v] of [...buckets].sort()) {
  console.log(`${k}\t${v.n}`);
  for (const s of v.samples) console.log(`\t${s}`);
}
