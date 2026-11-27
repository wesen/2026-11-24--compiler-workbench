// Classify Typed revision edit records. Rule matches are re-derived, not citations or proofs.
import { SIMPLIFY_RULES } from '../dist/typed/rules/simplify.js';
import { FOLD_RULES } from '../dist/typed/rules/fold.js';
import { RULE_EVIDENCE } from '../dist/typed/rules/evidence.js';
import { ruleFingerprint } from '../dist/typed/rules/verify.js';
import { evalOp } from '../dist/typed/rules/compile.js';
import { COMPARE } from '../dist/typed/listing.js';
import { F32_RESULT } from '../dist/typed/f32.js';
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

const rules = [...SIMPLIFY_RULES.rules, ...FOLD_RULES.rules];
const current = name => {
  const r = rules.find(x => x.name === name), e = RULE_EVIDENCE[name];
  return !!(r && e && e.fingerprint === ruleFingerprint(r));
};
const structuralPasses = new Set(['cfg', 'licm', 'inline', 'rotate', 'bce']);
const localPasses = new Set(['fold', 'simplify', 'constprop', 'strength', 'lvn']);
const structuralKinds = new Set(['retarget', 'unreachable', 'move', 'merge', 'replaceStmt', 'block', 'inline']);

/** One result per input edit. Weight is the count of old/new value nodes in the replaced field;
 * other edits count the old/new statement and its value nodes when resolvable. Overlaps are intentional. */
export function classifyEdits(before, after, edits, correspondence, images) {
  const count = (ir, id) => {
    if (!id || !ir.values[id]) return 0;
    return 1 + ir.values[id].args.reduce((n, x) => n + count(ir, x), 0);
  };
  const stmtCount = (ir, id) => {
    const s = ir.stmts[id];
    return s ? 1 + ['value', 'cond', 'addr'].reduce((n, f) => n + count(ir, s[f]), 0) : 0;
  };
  return edits.map(e => {
    const related = (correspondence?.entries ?? []).filter(c => c.from.includes(e.from) || c.to.includes(e.to));
    let category = 'other', reason = 'no local or structural classification', matchedRules = [];
    if (structuralPasses.has(e.pass) || structuralKinds.has(e.kind)) {
      category = 'structural'; reason = 'control flow or code motion';
    } else if (e.kind === 'replace' && localPasses.has(e.pass)) {
      category = 'local'; reason = e.pass === 'constprop' || e.pass === 'lvn' ? 'dataflow value substitution' : 'value rewrite';
      if (INDEX[e.pass] && before.values[e.from] && after.values[e.to]) {
        const fired = [], got = normalize(treeOf(before.values, e.from), INDEX[e.pass], fired);
        if (fired.length && sameT(got, treeOf(after.values, e.to))) matchedRules = fired;
        else { category = 'other'; reason = 'rule table did not re-derive replacement'; }
      }
    }
    const weight = e.kind === 'replace'
      ? count(before, e.from) + count(after, e.to)
      : stmtCount(before, e.stmt ?? e.from) + stmtCount(after, e.stmt ?? e.to);
    // An instruction may belong to several edits, so these weights must not be read as unique image size.
    const machineCount = (ir, image, ids) => {
      if (!image) return 0;
      const entities = new Set(ids.filter(x => typeof x === 'string'));
      for (const id of [...entities]) {
        const block = ir.blocks[id];
        if (block) for (const sid of block.stmts) entities.add(sid);
      }
      return image.insns.filter(insn => insn.covers.some(id => entities.has(id))).length;
    };
    const machineInstructions = machineCount(before, images?.before, [e.stmt, e.from, e.block]) +
      machineCount(after, images?.after, [e.stmt, e.to, e.block, e.into]);
    return { edit: e, category, reason, matchedRules, matchedEvidence: matchedRules.length > 0 && matchedRules.every(current), cited: false, weight, machineInstructions, correspondenceEntries: related.length };
  });
}
