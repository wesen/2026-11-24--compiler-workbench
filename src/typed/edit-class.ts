/**
 * IRWB-035-E (A0): the edit classifier. Classifies every edit record of a pass application of the Typed pipelines
 * into `local` (a value replaced by an equal one, citing or matching a rule), `structural` (control flow, code
 * motion, inlining) and `other`, with a reproducible reason per edit, and re-derives the rule-backed ones from the
 * verified rule tables. Pure: a function of the pass name, the application's edit records and the two revisions
 * (all published data), with no `Tx`, no pass code and no matcher shared with `compile.ts`, so a bug in a pass's
 * matcher cannot hide here (the design is the ticket's design-doc/01; the matcher follows IRWB-008 guide §12).
 *
 * The decision procedure, per edit record:
 *   - `replace` of a value field (`value`, `cond`, `addr`), on a statement that exists in both revisions with the
 *     same operation, and whose new tree reads no local this application created (the motion test) → **local**.
 *     Its justification is `rule` when the edit re-derives from a verified rule table (the fired rules and their
 *     recorded evidence strength are returned), `fact` for the passes whose recorded argument is a local
 *     hypothesis (constprop's reaching-definitions constant, strength's non-negativity range, subst's single-use
 *     copy), and `none` otherwise.
 *   - The `replace` edits that fail the motion test (licm's hoisted reads, lvn's numbered reads, inline's rebuilt
 *     record-leaf reads) are bookkeeping of code motion → **structural**, like `retarget`, `replaceStmt`, `insert`,
 *     `move`, `merge`, `unreachable`, `block`, `local` and the `inline` record, and the `remove` edits of `cfg` (a
 *     jump a merge absorbed) and `inline` (the call the body replaces).
 *   - The `remove` edits of `dce` and `subst` (a statement whose value is unused, or a definition substituted
 *     into its only reader) are neither value rewrites nor any listed structural transformation → **other**.
 *   - Anything the procedure cannot place is `other` with its reason, so drift is visible, never fatal.
 */
import { COMPARE } from './listing.js';
import { RULE_EVIDENCE } from './rules/evidence.js';
import { FOLD_RULES } from './rules/fold.js';
import { SIMPLIFY_RULES } from './rules/simplify.js';
import { evalOp } from './rules/compile.js';
import type { Rule, RuleSet } from './rules/form.js';
import type { Edit } from './tx.js';
import type { TypedBlocks, ValueRec } from './model.js';

export type EditClass = 'local' | 'structural' | 'other';

export interface LocalJustification {
  readonly kind: 'rule' | 'fact' | 'none';
  /** The verified table the edit re-derives from (for `rule`). */
  readonly ruleSet?: 'simplify' | 'fold';
  /** The rules fired, in firing order (for `rule`). */
  readonly rules?: readonly string[];
  /** The weakest recorded evidence strength of the fired rules (for `rule`). */
  readonly strength?: string;
  /** The pass's local hypothesis, by pass name (for `fact`). */
  readonly fact?: string;
}

export interface EditClassification {
  readonly cls: EditClass;
  /** Why, reproducibly: the clause of the decision procedure that decided the edit. */
  readonly reason: string;
  /** Present when the edit is a local rewrite. */
  readonly local?: LocalJustification;
}

export interface PassApplication {
  readonly pass: string;
  readonly edits: readonly Edit[];
  readonly before: TypedBlocks;
  readonly after: TypedBlocks;
}

// ---------- the rule re-derivation (IRWB-008 guide §12, independent of the passes) ----------
/** A value tree as plain data: ids are gone, so structural equality ignores them. */
interface Tree {
  readonly op: string;
  readonly imm?: number | string;
  readonly type?: 'f32';
  readonly args: readonly Tree[];
}

const treeOf = (values: Readonly<Record<string, ValueRec>>, id: string): Tree => {
  const v = values[id];
  if (!v) throw new Error(`edit-class: no value ${id}`);
  return {
    op: v.op,
    ...(v.imm !== undefined ? { imm: v.imm } : {}),
    ...(v.type ? { type: v.type } : {}),
    args: v.args.map(a => treeOf(values, a)),
  };
};
const idsOf = (
  values: Readonly<Record<string, ValueRec>>,
  id: string,
  out: Set<string> = new Set(),
): Set<string> => {
  out.add(id);
  for (const a of values[id].args) idsOf(values, a, out);
  return out;
};

const sameT = (x: Tree, y: Tree): boolean =>
  x.op === y.op &&
  x.imm === y.imm &&
  x.type === y.type &&
  x.args.length === y.args.length &&
  x.args.every((a, i) => sameT(a, y.args[i]));

/** The operators a tree cannot be evaluated or dropped without effect (analyses.ts's IMPURE). */
const IMPURE = new Set(['call', 'load', 'load16u', 'div', 'rem', 'caddr', 'result']);
const pureT = (t: Tree): boolean => !IMPURE.has(t.op) && t.args.every(pureT);
const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
const log2 = (n: number) => 31 - Math.clz32(n);
const MIN = -2147483648;

type Bindings = Record<string, Tree>;

function match(p: unknown, t: Tree, b: Bindings): boolean {
  const p0 = p as Record<string, unknown>;
  if ('var' in p0) return ((b[p0.var as string] = t), true);
  if ('constVar' in p0) return t.op === 'const' ? ((b[p0.constVar as string] = t), true) : false;
  if ('const' in p0) return t.op === 'const' && t.imm === p0.const;
  if ('same' in p0) return sameT(t, b[p0.same as string]);
  if (t.op !== p0.op || t.args.length !== (p0.args as unknown[]).length) return false;
  return (p0.args as unknown[]).every((q, i) => match(q, t.args[i], b));
}

function guard(g: Record<string, unknown>, b: Bindings): boolean {
  if ('pure' in g) return pureT(b[g.pure as string]);
  if ('pow2' in g) return isPow2(b[g.pow2 as string].imm as number);
  if ('boolean' in g) return COMPARE.has(b[g.boolean as string].op);
  const x = b[(g.noTrap as readonly string[])[0]].imm as number,
    y = b[(g.noTrap as readonly string[])[1]].imm as number;
  return !(y === 0 || (x === MIN && y === -1));
}

function num(n: unknown, b: Bindings): number {
  if (typeof n === 'number') return n;
  const n0 = n as Record<string, unknown>;
  if ('log2' in n0) return log2(b[n0.log2 as string].imm as number);
  return evalOp(
    n0.eval as string,
    (n0.args as readonly string[]).map(a => b[a].imm as number),
  );
}

function inst(t: unknown, b: Bindings): Tree {
  const t0 = t as Record<string, unknown>;
  if ('var' in t0) return b[t0.var as string];
  if ('const' in t0)
    return {
      op: 'const',
      imm: num(t0.const, b) | 0,
      ...(t0.type ? { type: 'f32' as const } : {}),
      args: [],
    };
  return { op: t0.op as string, args: (t0.args as unknown[]).map(a => inst(a, b)) };
}

/** One table indexed by the root operator of its rules, in table order. */
const indexOf = (rules: readonly Rule[]): ReadonlyMap<string, readonly Rule[]> => {
  const m = new Map<string, Rule[]>();
  for (const r of rules) {
    const list = m.get(r.lhs.op);
    if (list) list.push(r);
    else m.set(r.lhs.op, [r]);
  }
  return m;
};
const TABLES: readonly { name: 'simplify' | 'fold'; index: ReadonlyMap<string, readonly Rule[]> }[] = [
  { name: 'simplify', index: indexOf(SIMPLIFY_RULES.rules) },
  { name: 'fold', index: indexOf(FOLD_RULES.rules) },
];

/** Normalize a tree bottom-up with a table: the first rule per node that matches fires, as `Tx.rewrite` does. */
function normalize(t: Tree, index: ReadonlyMap<string, readonly Rule[]>, fired: string[]): Tree {
  const n: Tree = { ...t, args: t.args.map(a => normalize(a, index, fired)) };
  for (const r of index.get(n.op) ?? []) {
    const b: Bindings = {};
    if (!match(r.lhs, n, b)) continue;
    if (r.where && !r.where.every(g => guard(g as Record<string, unknown>, b))) continue;
    fired.push(r.name);
    return inst(r.rhs, b);
  }
  return n;
}

/** The evidence-strength order of IRWB-008 guide §19; the weakest of a set is the one furthest down. */
const STRENGTH_ORDER = ['proof', 'exhaustive', 'by-construction', 'reduced-width+argument', 'sampled'];
const weakest = (names: readonly string[]): string =>
  names.reduce((w, n) => {
    const s = RULE_EVIDENCE[n]?.strength ?? 'sampled';
    return STRENGTH_ORDER.indexOf(s) > STRENGTH_ORDER.indexOf(w) ? s : w;
  }, 'proof');

export interface Rederivation {
  readonly ok: boolean;
  /** The table the edit re-derives from, and the rules fired, when it does. */
  readonly ruleSet?: 'simplify' | 'fold';
  readonly rules?: readonly string[];
  /** The weakest recorded strength of the fired rules, when it does. */
  readonly strength?: string;
}

/**
 * Whether one value-field replace is an instance of a verified rule table: the before-tree normalized with the
 * table is the after-tree. Any table is tried; matching one means the edit cites verified rules.
 */
export function rederive(before: TypedBlocks, after: TypedBlocks, from: string, to: string): Rederivation {
  const b = treeOf(before.values, from),
    a = treeOf(after.values, to);
  for (const { name, index } of TABLES) {
    const fired: string[] = [];
    if (sameT(normalize(b, index, fired), a))
      return { ok: true, ruleSet: name, rules: fired, strength: weakest(fired) };
  }
  return { ok: false };
}

// ---------- the classification ----------
/** The passes whose local rewrites rest on a recorded local hypothesis (IRWB-008 guide §25's rule shapes). */
const FACTS: Readonly<Record<string, string>> = {
  constprop: 'constprop: every reaching definition of the read assigns this constant',
  strength: 'strength: a range fact proves the operand non-negative',
  subst: 'subst: the read has one definition, this pure tree, and this is its only read',
};

/** The passes whose `remove` edits are control-flow or inlining bookkeeping rather than dead-code elimination. */
const REMOVAL_STRUCTURE = new Set(['cfg', 'inline']);

/** Classify one pass application's edits. Pure; never throws for a well-formed application. */
export function classifyApplication(app: PassApplication): readonly EditClassification[] {
  const { pass, edits, before, after } = app;
  // the locals this application created, by function: a new tree reading one is code-motion bookkeeping
  const created = new Map<string, Set<number>>();
  for (const e of edits)
    if (e.kind === 'local') {
      const name = (e.name as string) ?? /\/([^/]+)$/.exec(e.local as string)?.[1];
      const f = after.fns[e.fn];
      const idx = f?.locals.findIndex(l => l.name === name);
      if (idx !== undefined && idx >= 0) {
        let s = created.get(e.fn);
        if (!s) created.set(e.fn, (s = new Set()));
        s.add(idx);
      }
    }
  const readsCreated = (root: string): boolean => {
    const seen = new Set<string>();
    const walk = (id: string): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      const v = after.values[id];
      if (!v) return false;
      if (v.op === 'get' && created.get(e_of(v))?.has(v.imm as number)) return true;
      return v.args.some(walk);
    };
    return walk(root);
  };
  // a value's fn is `fn:NAME`; the edit's fn is the name
  const e_of = (v: ValueRec): string => v.fn.slice(3);
  return edits.map(e => classifyEdit(e, { pass, edits, before, after, created, readsCreated }));
}

interface EditContext {
  readonly pass: string;
  readonly edits: readonly Edit[];
  readonly before: TypedBlocks;
  readonly after: TypedBlocks;
  readonly created: ReadonlyMap<string, Set<number>>;
  readonly readsCreated: (root: string) => boolean;
}

function classifyEdit(e: Edit, ctx: EditContext): EditClassification {
  const { pass, before, after } = ctx;
  if (e.kind === 'replace') {
    if (e.field !== 'value' && e.field !== 'cond' && e.field !== 'addr')
      return { cls: 'other', reason: `replace of field ${e.field} is not a value field` };
    const sb = before.stmts[e.stmt as string],
      sa = after.stmts[e.stmt as string];
    if (!sa) {
      // the same application's commit can prune the edited statement's block (licm hoists, then unreachable
      // blocks go): the edit is part of that pruning, proved by the application's own `unreachable` records
      const pruned = ctx.edits.some(
        x => x.kind === 'unreachable' && before.blocks[x.block as string]?.stmts.includes(e.stmt as string),
      );
      if (pruned)
        return {
          cls: 'structural',
          reason: 'motion bookkeeping inside a block the same application pruned as unreachable',
        };
      return { cls: 'other', reason: 'replace on a statement absent from the output revision' };
    }
    if (!sb) {
      // a value edit on a statement this application inserted (licm can hoist a hoist: the set it moved into an
      // outer loop's body is itself hoisted out of that loop): bookkeeping of what made the statement
      const inserted = ctx.edits.some(x => (x.kind === 'insert' || x.kind === 'inline') && x.stmt === e.stmt);
      if (inserted)
        return {
          cls: 'structural',
          reason: ctx.readsCreated(e.to as string)
            ? 'motion: a value edit on a statement this application inserted (a hoist of a hoist)'
            : 'a value edit on a statement this application inserted (bookkeeping of what made it)',
        };
      return { cls: 'other', reason: 'replace on a statement absent from the input revision' };
    }
    if (sb.op !== sa.op)
      return {
        cls: 'other',
        reason: 'replace on a statement that is not the same statement in both revisions',
      };
    // a chained replace (lvn numbers a field twice): this edit's own tree may have been replaced again later in
    // the same application, so the motion test runs on the chain's surviving tree
    let effTo: string | undefined = after.values[e.to as string] ? (e.to as string) : undefined;
    if (!effTo)
      for (let i = ctx.edits.length - 1; i >= 0; i--) {
        const x = ctx.edits[i];
        if (
          x !== e &&
          x.kind === 'replace' &&
          x.stmt === e.stmt &&
          x.field === e.field &&
          after.values[x.to as string]
        ) {
          effTo = x.to as string;
          break;
        }
      }
    if (!effTo)
      return {
        cls: 'other',
        reason: 'a replace whose result no later edit of the application published',
      };
    if (ctx.readsCreated(effTo))
      return {
        cls: 'structural',
        reason: 'motion: the new tree reads a local this application created (code-motion bookkeeping)',
      };
    if (!before.values[e.from as string] || !after.values[e.to as string])
      return {
        cls: 'local',
        reason:
          'a chained replace: one of its trees was made earlier in the same application, so the published revisions alone cannot re-derive it',
        local: { kind: 'none' },
      };
    const d = rederive(before, after, e.from as string, e.to as string);
    if (d.ok)
      return {
        cls: 'local',
        reason: `a value replaced by an equal one: re-derives from the verified ${d.ruleSet} table`,
        local: { kind: 'rule', ruleSet: d.ruleSet, rules: d.rules, strength: d.strength },
      };
    const fact = FACTS[pass];
    return fact
      ? {
          cls: 'local',
          reason: `a value replaced by an equal one on a local hypothesis`,
          local: { kind: 'fact', fact },
        }
      : {
          cls: 'local',
          reason: 'a value replaced by an equal one, but no verified rule or named hypothesis covers it',
          local: { kind: 'none' },
        };
  }
  if (e.kind === 'remove') {
    if (REMOVAL_STRUCTURE.has(pass))
      return {
        cls: 'structural',
        reason: pass === 'cfg' ? 'a jump a block merge absorbed' : 'the call, replaced by the inlined body',
      };
    return {
      cls: 'other',
      reason: 'a statement removed: no value replaced, no control flow changed, nothing moved',
    };
  }
  const structural: Readonly<Record<string, string>> = {
    replaceStmt: 'a statement replaced (a branch, in these pipelines)',
    retarget: 'a branch target changed',
    insert: 'a statement inserted',
    move: 'a statement moved to another block',
    merge: 'a block merged into its predecessor',
    unreachable: 'a block pruned as unreachable',
    block: 'a block created',
    local: 'a local created (bookkeeping of a motion or an inlining)',
    inline: 'a call site replaced by the callee body',
  };
  if (structural[e.kind]) return { cls: 'structural', reason: structural[e.kind] };
  return { cls: 'other', reason: `an edit kind the decision procedure does not place: ${e.kind}` };
}

/** The three-way counts of one application, by edit record. */
export function classCounts(cls: readonly EditClassification[]): Record<EditClass, number> {
  const out: Record<EditClass, number> = { local: 0, structural: 0, other: 0 };
  for (const c of cls) out[c.cls]++;
  return out;
}
