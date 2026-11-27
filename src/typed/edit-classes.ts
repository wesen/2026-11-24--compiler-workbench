/**
 * IRWB-035-G: a classifier for the edits of one pass application.
 *
 * Input: the revision before, the revision after and the application's edit records (a `Revision` of a `Program`
 * holds all three). Output: one class per edit record, decided from the records and the two revisions alone, never
 * from the pass's name, so a user pass or a new pass is classified by the same rules.
 *
 *   local        a `replace` edit (a statement keeps its place and one of its value trees A becomes B) where B
 *                reads only locals the input revision already defines: B reads no local this application created
 *                and no local this application inserted a `set` for. The claim "A = B at this statement" is then
 *                a statement about the input revision alone.
 *                  local/rule      B is A normalized by one verified rule table (re-derived here from the rule
 *                                  data, bottom-up, first matching rule, as `Tx.rewrite` applies a table)
 *                  local/fact      not re-derived; the made value's origin names what it holds by (`because`)
 *                  local/uncited   not re-derived and no `because`
 *   structural   an edit of the control-flow graph or of where a computation is placed: `block`, `retarget`,
 *                `replaceStmt`, `merge`, `move`, `unreachable`, `insert`, `local`, `inline`, the removal of a
 *                terminator or of an inlined call's statement, and a `replace` whose B reads a local this
 *                application created or inserted a `set` for (the value now comes from a statement placed elsewhere).
 *                Every such edit in a function that has an `inline` edit has the reason `inline`.
 *   other        the removal of a statement that is not a terminator (dead code), `note`, kinds not listed here,
 *                and a `replace` whose trees are in neither revision.
 *
 * Several `replace` edits of one statement field in one application form a chain (the intermediate trees are in
 * neither revision); every member gets the class of the chain's net change, first `from` to last `to`.
 *
 * `instructionWeights` gives each edit the RV32 instructions it affects: the instructions of the image lowered from
 * the revision before that implement entities the edit removed, plus those of the image after that implement
 * entities it added (a moved or retargeted statement: its own instructions in the image after).
 */
import { IMPURE } from './analyses.js';
import type { Rv32Image } from './backend/image.js';
import { F32_RESULT } from './f32.js';
import { COMPARE } from './listing.js';
import type { StmtRec, TypedBlocks, ValueOp, ValueRec } from './model.js';
import { firstMatch, indexRules, numOf, type Bindings } from './rules/compile.js';
import { RULE_EVIDENCE } from './rules/evidence.js';
import { FOLD_RULES } from './rules/fold.js';
import type { Rule, RuleSet, Tpl } from './rules/form.js';
import { SIMPLIFY_RULES } from './rules/simplify.js';
import type { Edit, ValueHandle } from './tx.js';

export type EditClass = 'local' | 'structural' | 'other';

export interface Application {
  readonly pass: string;
  readonly before: TypedBlocks;
  readonly after: TypedBlocks;
  readonly edits: readonly Edit[];
}

export interface RuleMatch {
  /** The verified table that re-derives the edit. */
  readonly table: string;
  /** The rules fired, in firing order. */
  readonly fired: readonly string[];
  /** The weakest recorded evidence strength among the fired rules. */
  readonly weakest: string;
}

export interface ClassifiedEdit {
  readonly id: string;
  readonly pass: string;
  readonly fn: string;
  readonly kind: string;
  readonly class: EditClass;
  /** The reason within the class, e.g. `rule`, `fact`, `cfg`, `motion`, `inline`, `dead-statement`. */
  readonly sub: string;
  /** local/rule: the table and rules that re-derive it. */
  readonly rule?: RuleMatch;
  /** A `replace` that is not re-derived: the subtrees where A and B part, one operator deep, and the `because`. */
  readonly shape?: string;
  /** Entities of the revision before that this edit removed, and of the revision after that it added. */
  readonly removed: readonly string[];
  readonly added: readonly string[];
  /** Statements that stay but whose instructions the edit touches (retarget, move). */
  readonly touched: readonly string[];
}

// ---------- plain trees, and the rule tables applied to them ----------
/** A value tree without ids; what a rule matches and what two revisions are compared by. */
export interface Tree {
  readonly op: ValueOp;
  readonly imm: number | string | undefined;
  readonly type: 'f32' | undefined;
  readonly args: readonly Tree[];
}

export function treeOf(values: Readonly<Record<string, ValueRec>>, id: string): Tree {
  const v = values[id];
  return { op: v.op, imm: v.imm, type: v.type, args: v.args.map(a => treeOf(values, a)) };
}
export const sameTree = (x: Tree, y: Tree): boolean =>
  x.op === y.op &&
  x.imm === y.imm &&
  x.type === y.type &&
  x.args.length === y.args.length &&
  x.args.every((a, i) => sameTree(a, y.args[i]));
const pure = (t: Tree): boolean => !IMPURE.has(t.op) && t.args.every(pure);

/** The part of a value handle the matcher and the guards of rules/compile.ts read, over a plain tree. */
interface TreeHandle {
  readonly tree: Tree;
  readonly op: ValueOp;
  readonly imm: number | string | undefined;
  readonly args: TreeHandle[];
  readonly isConst: boolean;
  readonly isPure: boolean;
  readonly isBoolean: boolean;
  same(other: TreeHandle): boolean;
}
const handle = (t: Tree): TreeHandle => ({
  tree: t,
  op: t.op,
  imm: t.imm,
  get args() {
    return t.args.map(handle);
  },
  isConst: t.op === 'const',
  get isPure() {
    return pure(t);
  },
  isBoolean: COMPARE.has(t.op),
  same: other => sameTree(t, other.tree),
});
const treeBound = (b: Bindings, x: string): Tree => (b[x] as unknown as TreeHandle).tree;

/** A rule's right-hand side as a tree, with the types `Tx.const` and `Tx.make` give. */
function instantiate(t: Tpl, b: Bindings): Tree {
  if ('var' in t) return treeBound(b, t.var);
  if ('const' in t)
    return {
      op: 'const',
      imm: numOf(t.const, x => treeBound(b, x).imm as number) | 0,
      type: t.type,
      args: [],
    };
  return {
    op: t.op,
    imm: undefined,
    type: F32_RESULT.has(t.op) ? 'f32' : undefined,
    args: t.args.map(a => instantiate(a, b)),
  };
}

/** `t` rewritten bottom-up by a table: operands first, then the first matching rule at the root, not revisited. */
export function normalize(t: Tree, index: ReadonlyMap<string, readonly Rule[]>, fired: string[]): Tree {
  const args = t.args.map(a => normalize(a, index, fired));
  const n: Tree = args.some((a, i) => a !== t.args[i]) ? { ...t, args } : t;
  const m = firstMatch(index, handle(n) as unknown as ValueHandle);
  if (!m) return n;
  fired.push(m.rule.name);
  return instantiate(m.rule.rhs, m.bindings);
}

/** The verified tables an edit may be an instance of. */
export const VERIFIED_TABLES: readonly RuleSet[] = [SIMPLIFY_RULES, FOLD_RULES];
const STRENGTHS = ['proof', 'exhaustive', 'by-construction', 'reduced-width+argument', 'sampled', 'none'];
const INDEXES = new Map<RuleSet, Map<string, Rule[]>>();

/** The first table that rewrites `a` into `b`, with the rules it fired; undefined when none does. */
export function rederive(a: Tree, b: Tree, tables: readonly RuleSet[] = VERIFIED_TABLES): RuleMatch | undefined {
  for (const table of tables) {
    let index = INDEXES.get(table);
    if (!index) INDEXES.set(table, (index = indexRules(table.rules)));
    const fired: string[] = [];
    if (!sameTree(normalize(a, index, fired), b) || !fired.length) continue;
    const weakest = fired
      .map(n => RULE_EVIDENCE[n]?.strength ?? 'none')
      .reduce((w, s) => (STRENGTHS.indexOf(s) > STRENGTHS.indexOf(w) ? s : w), 'proof');
    return { table: table.name, fired, weakest };
  }
  return undefined;
}

// ---------- shapes of the rewrites no table re-derives ----------
const brief = (t: Tree): string =>
  t.op === 'const'
    ? '#'
    : t.op === 'get'
      ? 'get'
      : `${t.op}(${t.args.map(a => (a.op === 'const' ? '#' : a.op === 'get' ? 'get' : '_')).join(',')})`;
/** The pairs of subtrees where two trees part (roots that differ, below equal ancestors), one operator deep. */
function shapeOf(a: Tree, b: Tree, out = new Set<string>()): string {
  if (a.op !== b.op || a.imm !== b.imm || a.type !== b.type || a.args.length !== b.args.length)
    out.add(`${brief(a)} -> ${brief(b)}`);
  else a.args.forEach((x, i) => sameTree(x, b.args[i]) || shapeOf(x, b.args[i], out));
  return [...out].sort().join('; ');
}
const becauseKind = (because: readonly string[]): string =>
  [
    ...new Set(
      because.map(x =>
        x.startsWith('fact:')
          ? `fact:${/^fact:(\w+)/.exec(x)![1]}`
          : x.startsWith('local:')
            ? 'initial-value'
            : x.startsWith('s:')
              ? 'definition'
              : x.startsWith('v:')
                ? 'value'
                : 'text',
      ),
    ),
  ]
    .sort()
    .join('+');

// ---------- classification ----------
const TERMINATORS = new Set(['br', 'br_if', 'return', 'trap']);
const nodes = (values: Readonly<Record<string, ValueRec>>, id: string | undefined, out: string[] = []) => {
  if (id && values[id]) {
    out.push(id);
    for (const a of values[id].args) nodes(values, a, out);
  }
  return out;
};
const stmtNodes = (v: TypedBlocks, sid: string): string[] => {
  const s = v.stmts[sid];
  if (!s) return [];
  return [sid, ...nodes(v.values, s.value), ...nodes(v.values, s.cond), ...nodes(v.values, s.addr)];
};
const reads = (t: Tree, out = new Set<number>()): Set<number> => {
  if (t.op === 'get') out.add(t.imm as number);
  t.args.forEach(a => reads(a, out));
  return out;
};
const STRUCTURAL: Readonly<Record<string, string>> = {
  block: 'cfg',
  retarget: 'cfg',
  merge: 'cfg',
  move: 'cfg',
  unreachable: 'cfg',
  insert: 'motion',
  local: 'new-local',
  inline: 'inline',
};

function branchShape(a: StmtRec | undefined, b: StmtRec | undefined, v: TypedBlocks): string {
  if (!a || !b) return 'cfg';
  if (a.op === 'br_if' && b.op === 'br')
    return v.values[a.cond!]?.op === 'const'
      ? 'cfg/branch-on-constant'
      : a.then === a.else
        ? 'cfg/same-arms'
        : 'cfg/branch-by-fact';
  if (a.op === 'br' && b.op === 'br_if') return 'cfg/test-duplicated';
  return 'cfg';
}

/** One class per edit record of an application, in the order of `app.edits`. */
export function classifyApplication(app: Application): ClassifiedEdit[] {
  const { before, after, edits } = app;
  const isNew = (id: string) => !(id in before.values) && !(id in before.stmts);
  const isGone = (id: string) => !(id in after.values) && !(id in after.stmts);
  const claimed = new Set<string>();
  const claim = (ids: readonly string[], keep: (id: string) => boolean) =>
    ids.filter(id => keep(id) && !claimed.has(id) && (claimed.add(id), true));
  // per function: the locals this application created or inserted a `set` for, and the inlined statements
  const placed = new Map<string, Set<number>>(),
    inlined = new Set<string>(),
    inlining = new Set<string>();
  const placedIn = (fn: string) => placed.get(fn) ?? placed.set(fn, new Set()).get(fn)!;
  for (const e of edits) {
    if (e.kind === 'local') {
      const i = after.fns[e.fn]?.locals.findIndex(l => l.name === e.name) ?? -1;
      if (i >= 0) placedIn(e.fn).add(i);
    } else if (e.kind === 'insert') {
      const s = after.stmts[e.stmt as string];
      if (s?.op === 'set') placedIn(e.fn).add(s.local!);
    } else if (e.kind === 'inline') {
      inlined.add(`${e.fn} ${e.stmt}`);
      inlining.add(e.fn);
    }
  }
  // chains of `replace` edits of one statement field: first `from`, last `to`
  const chains = new Map<string, Edit[]>();
  for (const e of edits)
    if (e.kind === 'replace') {
      const k = `${e.stmt}.${e.field}`;
      (chains.get(k) ?? chains.set(k, []).get(k)!).push(e);
    }
  const base = (e: Edit) => ({ id: e.id, pass: e.pass, fn: e.fn, kind: e.kind });
  const none = { removed: [], added: [], touched: [] };
  return edits.map((e): ClassifiedEdit => {
    switch (e.kind) {
      case 'replace': {
        const chain = chains.get(`${e.stmt}.${e.field}`)!;
        const from = chain[0].from as string,
          to = chain.at(-1)!.to as string;
        if (!(from in before.values) || !(to in after.values))
          return { ...base(e), class: 'other', sub: 'unresolved', ...none };
        const a = treeOf(before.values, from),
          b = treeOf(after.values, to);
        const first = chain[0] === e;
        const removed = first ? claim(nodes(before.values, from), isGone) : [],
          added = first ? claim(nodes(after.values, to), isNew) : [];
        const io = { removed, added, touched: [] };
        const p = placed.get(e.fn);
        if (p && [...reads(b)].some(l => p.has(l)))
          return { ...base(e), class: 'structural', sub: inlining.has(e.fn) ? 'inline' : 'motion', ...io };
        const rule = rederive(a, b);
        if (rule) return { ...base(e), class: 'local', sub: 'rule', rule, ...io };
        // what the made values say they hold by: the `because` of the new values of B
        const because = nodes(after.values, to)
          .filter(isNew)
          .flatMap(id => after.values[id].origin[0]?.because ?? []);
        return {
          ...base(e),
          class: 'local',
          sub: because.length ? 'fact' : 'uncited',
          shape: `${shapeOf(a, b)}${because.length ? ` by ${becauseKind(because)}` : ''}`,
          ...io,
        };
      }
      case 'remove': {
        const sid = e.stmt as string,
          s = before.stmts[sid];
        const removed = claim(stmtNodes(before, sid), isGone);
        const io = { removed, added: [], touched: [] };
        if (inlined.has(`${e.fn} ${sid}`)) return { ...base(e), class: 'structural', sub: 'inline', ...io };
        if (s && TERMINATORS.has(s.op)) return { ...base(e), class: 'structural', sub: 'cfg', ...io };
        return { ...base(e), class: 'other', sub: 'dead-statement', ...io };
      }
      case 'replaceStmt': {
        const from = e.from as string,
          to = e.to as string;
        return {
          ...base(e),
          class: 'structural',
          sub: branchShape(before.stmts[from], after.stmts[to], before),
          removed: claim(stmtNodes(before, from), isGone),
          added: claim(stmtNodes(after, to), isNew),
          touched: [],
        };
      }
      case 'insert':
        return {
          ...base(e),
          class: 'structural',
          sub: 'motion',
          removed: [],
          added: claim(stmtNodes(after, e.stmt as string), isNew),
          touched: [],
        };
      case 'unreachable': {
        const stmts = before.blocks[e.block as string]?.stmts ?? [];
        return {
          ...base(e),
          class: 'structural',
          sub: 'cfg',
          removed: claim(
            stmts.flatMap(s => stmtNodes(before, s)),
            isGone,
          ),
          added: [],
          touched: [],
        };
      }
      case 'retarget':
      case 'move':
        return {
          ...base(e),
          class: 'structural',
          sub: 'cfg',
          removed: [],
          added: [],
          touched: (e.stmt as string) in after.stmts ? [e.stmt as string] : [],
        };
      case 'inline': {
        // what the copy added: new entities of this function made because of this call or from it
        const call = (e.because as string[])[0],
          sid = e.stmt as string;
        const mine = (x: { id: string; fn: string; origin: ValueRec['origin'] }) => {
          const o = x.origin[0];
          return x.fn === `fn:${e.fn}` && !!o && (o.from === call || o.from === sid || !!o.because?.includes(call));
        };
        const added = claim(
          [...Object.values(after.stmts).filter(mine), ...Object.values(after.values).filter(mine)].map(x => x.id),
          isNew,
        );
        return { ...base(e), class: 'structural', sub: 'inline', removed: [], added, touched: [] };
      }
      default: {
        const sub = STRUCTURAL[e.kind];
        return sub
          ? { ...base(e), class: 'structural', sub: inlining.has(e.fn) ? 'inline' : sub, ...none }
          : { ...base(e), class: 'other', sub: e.kind === 'note' ? 'note' : 'unknown-kind', ...none };
      }
    }
  });
}

/**
 * The instructions each classified edit affects, in the same order: instructions of `imageBefore` that implement
 * an entity the edit removed, and of `imageAfter` that implement one it added or touched. An instruction counts
 * once, for the edit owning the first of its `covers` that any edit claims.
 */
export function instructionWeights(
  classified: readonly ClassifiedEdit[],
  imageBefore: Rv32Image,
  imageAfter: Rv32Image,
): number[] {
  const weights = classified.map(() => 0);
  const side = (image: Rv32Image, pick: (c: ClassifiedEdit) => readonly string[]) => {
    const owner = new Map<string, number>();
    classified.forEach((c, i) => {
      for (const id of pick(c)) if (!owner.has(id)) owner.set(id, i);
    });
    for (const m of image.insns) {
      const hit = m.covers.find(c => owner.has(c));
      if (hit !== undefined) weights[owner.get(hit)!]++;
    }
  };
  side(imageBefore, c => c.removed);
  side(imageAfter, c => [...c.added, ...c.touched]);
  return weights;
}

/** Counts by class and by `class/sub`, by edits and (when weights are given) by instructions. */
export interface Tally {
  edits: number;
  instructions: number;
  byClass: Record<EditClass, { edits: number; instructions: number }>;
  bySub: Record<string, { edits: number; instructions: number }>;
}
export const emptyTally = (): Tally => ({
  edits: 0,
  instructions: 0,
  byClass: {
    local: { edits: 0, instructions: 0 },
    structural: { edits: 0, instructions: 0 },
    other: { edits: 0, instructions: 0 },
  },
  bySub: {},
});
export function tallyInto(t: Tally, classified: readonly ClassifiedEdit[], weights?: readonly number[]): Tally {
  classified.forEach((c, i) => {
    const w = weights?.[i] ?? 0;
    t.edits++;
    t.instructions += w;
    t.byClass[c.class].edits++;
    t.byClass[c.class].instructions += w;
    const s = (t.bySub[`${c.class}/${c.sub}`] ??= { edits: 0, instructions: 0 });
    s.edits++;
    s.instructions += w;
  });
  return t;
}
