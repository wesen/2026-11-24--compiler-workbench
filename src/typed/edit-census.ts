/** Observational classifier for the two built-in O2 and speed revision chains. */
import type { CorrespondenceEntry } from '../framework/ir/types.js';
import { Store, type TypedBlocks, type ValueRec } from './model.js';
import { Tx, valueHandle, type Edit } from './tx.js';
import { compileRules, isPow2, log2 } from './rules/compile.js';
import { RULE_EVIDENCE } from './rules/evidence.js';
import { FOLD_RULES } from './rules/fold.js';
import { SIMPLIFY_RULES } from './rules/simplify.js';
import type { Revision } from './program.js';

export type EditClass = 'local' | 'structural' | 'other';
export interface ClassifiedEdit {
  edit: Edit;
  category: EditClass;
  reason: string;
  /** Ordered firing names, including duplicates. */
  rules: string[];
  cited: boolean;
  beforeStatements: string[];
  afterStatements: string[];
}

function treeIds(ir: TypedBlocks, id: string): string[] {
  const node = ir.values[id];
  return node ? [id, ...node.args.flatMap(a => treeIds(ir, a))] : [];
}

function replay(st: Store, after: TypedBlocks, e: Edit): string[] {
  const table = e.pass === 'fold' ? FOLD_RULES : SIMPLIFY_RULES;
  const tx = new Tx(st, st.fn(e.fn), { name: table.name, writes: ['values'] }, e.rev);
  const fired: string[] = [];
  const counts = new Map<string, number>();
  const visit = compileRules(table.rules, counts)(tx);
  const walk = (id: string): string => {
    const node = st.get(id) as ValueRec;
    const args = node.args.map(walk);
    const root = args.some((a, i) => a !== node.args[i])
      ? tx.make(node.op, ...args, { imm: node.imm, type: node.type })
      : id;
    counts.clear();
    const replacement = visit(valueHandle(st, root));
    fired.push(...counts.keys());
    return replacement ?? root;
  };
  const same = (id: string, target: string): boolean => {
    const a = st.get(id) as ValueRec, b = after.values[target];
    return !!b && a.op === b.op && a.type === b.type && a.imm === b.imm &&
      a.args.length === b.args.length && a.args.every((x, i) => same(x, b.args[i]));
  };
  return same(walk(String(e.from)), String(e.to)) ? fired : [];
}

/** Compare in context and require the pass's recorded range premise at each changed division/remainder. */
function strengthShapes(before: TypedBlocks, after: TypedBlocks, e: Edit): string[] {
  const fired: string[] = [];
  const walk = (from: string, to: string): boolean => {
    if (from === to) return true;
    const a = before.values[from], b = after.values[to];
    if (!a || !b || a.type !== b.type) return false;
    if (a.op === b.op && a.imm === b.imm && a.args.length === b.args.length)
      return a.args.every((id, i) => walk(id, b.args[i]));
    const divide = a.op === 'div';
    if (!(divide || a.op === 'rem') || b.op !== (divide ? 'shr' : 'and')) return false;
    const k = before.values[a.args[1]], n = after.values[b.args[1]];
    if (k?.op !== 'const' || typeof k.imm !== 'number' || !isPow2(k.imm) ||
        n?.op !== 'const' || n.imm !== (divide ? log2(k.imm) : k.imm - 1)) return false;
    const range = b.origin.some(o => o.rev === e.rev && o.because?.some(s => {
      const m = / in \[(-?\d+), (-?\d+)\]$/.exec(s);
      return s.startsWith(`fact:ranges(${e.fn})@r${e.rev - 1}:`) && m && +m[1] >= 0 && +m[2] >= +m[1];
    }));
    if (!range || !walk(a.args[0], b.args[0])) return false;
    fired.push(divide ? 'nonnegative-div-pow2' : 'nonnegative-rem-pow2');
    return true;
  };
  return walk(String(e.from), String(e.to)) ? fired : [];
}

const structural = new Set(['cfg', 'bce', 'rotate', 'inline', 'licm']);
const contextual: Record<string, string> = {
  constprop: 'reaching constant', subst: 'forward substitution', lvn: 'reuse prior computation',
};

/** Every record in order, including summaries and records whose intermediate endpoints have disappeared. */
export function classifyRevision(beforeRevision: Revision, revision: Revision): ClassifiedEdit[] {
  const before = beforeRevision.artifact.value, after = revision.artifact.value;
  const entries = revision.correspondence?.entries ?? [];
  let replayStore: Store | undefined;
  return revision.edits.map(edit => {
    const source = String(edit.from), target = String(edit.to);
    let rules: string[] = [];
    let category: EditClass = 'other';
    let reason = `${edit.pass}/${edit.kind}`;
    if (structural.has(edit.pass)) category = 'structural';
    else if (edit.kind === 'replace') {
      if (before.values[source] && after.values[target]) {
        if (edit.pass === 'strength') rules = strengthShapes(before, after, edit);
        if (edit.pass === 'simplify' || edit.pass === 'fold')
          rules = replay(replayStore ??= Store.from(before), after, edit);
      }
      if (rules.length) {
        category = 'local';
        reason = edit.pass === 'strength' ? 'guarded arithmetic' : 'table replay';
      } else reason = contextual[edit.pass] ?? `unmatched ${edit.pass}`;
    }
    const ids = (ir: TypedBlocks) => {
      const out = new Set<string>();
      for (const id of [edit.stmt, edit.from, edit.to]) if (typeof id === 'string' && ir.stmts[id]) out.add(id);
      // A statement edit with a block position touches the statement, not its whole surrounding block.
      if (['merge', 'unreachable', 'block'].includes(edit.kind))
        for (const sid of ir.blocks[String(edit.block)]?.stmts ?? []) out.add(sid);
      return out;
    };
    const oldStmts = ids(before), newStmts = ids(after);
    // One hop across the boundary, only for statement peers (copying an expression is not editing its donor).
    const linked = entries.filter(c => c.from.some(s => oldStmts.has(s)) || c.to.some(s => newStmts.has(s)));
    for (const c of linked) {
      for (const s of c.from) if (before.stmts[s]) oldStmts.add(s);
      for (const s of c.to) if (after.stmts[s]) newStmts.add(s);
    }
    let cited = false;
    if (category === 'local') {
      const oldIds = new Set(treeIds(before, source)), newIds = new Set(treeIds(after, target));
      const related = (c: CorrespondenceEntry) => c.from.some(s => oldIds.has(s)) &&
        (!c.to.length || c.to.some(s => newIds.has(s)));
      const reasons = [
        ...(Array.isArray(edit.because) ? edit.because : []),
        ...entries.filter(related).flatMap(c => c.because ?? []),
        ...[...newIds].flatMap(id => after.values[id].origin.filter(o => o.rev === edit.rev).flatMap(o => o.because ?? [])),
      ];
      cited = rules.every(name => {
        const ev = RULE_EVIDENCE[name];
        return ev?.verdict === 'sound' && reasons.some(token => {
          const prefix = `rule:${edit.pass}/${name}@${ev.version}#`;
          return typeof token === 'string' && token.startsWith(prefix) && token.length > prefix.length &&
            ev.fingerprint.startsWith(token.slice(prefix.length));
        });
      });
    }
    return { edit, category, reason, rules, cited, beforeStatements: [...oldStmts], afterStatements: [...newStmts] };
  });
}
