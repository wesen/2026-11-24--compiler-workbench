/**
 * IRWB-035-G: a classifier for the edits of one pass application.
 *
 * Input: the revision before, the revision after, the application's edit records and its derivation (a `Revision`
 * of a `Program` holds all four). Output: one class per edit record, decided from the records and the two revisions
 * alone, never from the pass's name, so a user pass or a new pass is classified by the same rules.
 *
 * IRWB-065-A: the class is a query over the records the producer wrote (R3 K2: no class field, no second account
 * re-derived from the trees). A `replace` edit is classified by the chain of replaces of one statement field, and
 * the chain's class is read off the derivation steps its edits cite (`Edit.steps`, the same records
 * `locality` in `src/framework/ir/derivation.ts` answers its two policies from):
 *
 *   local        every step the chain cites is local under the *in-place* policy (G's reading, IRWB-056-B's query:
 *                the step needs nothing this application placed into the program — a local it created, a statement
 *                it inserted, a value it made outside a rule chain; the intermediates of the application's own
 *                rewrite chains count as part of the chain's net change, `inPlaceInput`).
 *                  local/rule      a cited step is a rule step: the table and rules that actually fired, in firing
 *                                  order, with the weakest recorded evidence among them
 *                  local/fact      no rule step, and a step cites a premise (a fact or an entity of the input)
 *                  local/uncited   no rule step and no premise
 *   structural   an edit of the control-flow graph or of where a computation is placed: `block`, `retarget`,
 *                `replaceStmt`, `merge`, `move`, `unreachable`, `insert`, `local`, `inline`, the removal of a
 *                terminator or of an inlined call's statement, and a `replace` some cited step of which is not
 *                local under the in-place policy (the value now comes from a statement placed elsewhere).
 *                Every such edit in a function that has an `inline` edit has the reason `inline`.
 *   other        the removal of a statement that is not a terminator (dead code), `note`, kinds not listed here,
 *                a `replace` whose trees are in neither revision, and a `replace` of an application that records
 *                no derivation (its edits cite no steps, so no query over records can classify them).
 *
 * Several `replace` edits of one statement field in one application form a chain (the intermediate trees are in
 * neither revision); every member gets the class of the chain's net change, first `from` to last `to`.
 *
 * What still walks the trees is not classification: `parts`/`shapeOf` describe *what* changed (the entities an edit
 * removed and added, the shape of a rewrite no rule licensed) for `instructionWeights` and the shape label. The
 * rule tables themselves are re-run only by `rederive`, kept below as an *audit*: a check that the derivation's
 * rule names agree with what the tables do to the trees. Since IRWB-060-A the matcher is the standard library's
 * (`src/stdlib/term`); since IRWB-065-A the template instantiation is too (`instantiate` with a `Build` over
 * plain trees), so this file holds no rule semantics of its own.
 *
 * `instructionWeights` gives each edit the RV32 instructions it affects: the instructions of the image lowered from
 * the revision before that implement entities the edit removed, plus those of the image after that implement
 * entities it added (a moved or retargeted statement: its own instructions in the image after). For a `replace`
 * the entities are those of the subtrees where A and B part; the operators above them, which `Tx.rewrite` makes
 * again around a changed operand, are listed apart as `rebuilt` and counted only on request.
 */
import { IMPURE } from './analyses.js';
import type { Rv32Image } from './backend/image.js';
import { F32_RESULT } from './f32.js';
import { COMPARE } from './listing.js';
import { entityIdSet } from './ir.js';
import type { StmtRec, TypedBlocks, ValueOp, ValueRec } from './model.js';
import { firstMatch, indexRules, numOf } from './rules/compile.js';
import { IDENTITY_RULES } from './rules/identities.js';
import { ALL_EVIDENCE } from './rules/listing.js';
import { FOLD_RULES } from './rules/fold.js';
import type { Num, Rule, RuleSet } from './rules/form.js';
import { SIMPLIFY_RULES } from './rules/simplify.js';
import type { Edit, ValueHandle } from './tx.js';
import { inPlaceInput, locality } from '../framework/ir/derivation.js';
import type { Derivation, DerivationStep } from '../framework/ir/derivation.js';
import { instantiate, type Build } from '../stdlib/term/terms.js';

export type EditClass = 'local' | 'structural' | 'other';

export interface Application {
  readonly pass: string;
  readonly before: TypedBlocks;
  readonly after: TypedBlocks;
  readonly edits: readonly Edit[];
  /** The application's own record of why (`Revision.derivation`); the class of an edit is a query over it. */
  readonly derivation?: Derivation;
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
  /** A `replace`: values above the changed subtrees, made again with the same operator (ids of either revision). */
  readonly rebuilt?: readonly string[];
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

/** A rule's right-hand side as a tree, built through the standard library's `instantiate` (IRWB-060-B's move). */
const treeBuild: Build<ValueHandle, Num, Tree> = {
  ref: h => (h as unknown as TreeHandle).tree,
  value: (n, b) => numOf(n, x => (b.get(x) as unknown as TreeHandle).tree.imm as number),
  constant: (value, _root, type) => ({
    op: 'const',
    imm: value | 0,
    type: (type as Tree['type']) ?? undefined,
    args: [],
  }),
  make: (op, args) => ({
    op: op as ValueOp,
    imm: undefined,
    type: F32_RESULT.has(op as ValueOp) ? 'f32' : undefined,
    args,
  }),
};

/** `t` rewritten bottom-up by a table: operands first, then the first matching rule at the root, not revisited. */
export function normalize(t: Tree, index: ReadonlyMap<string, readonly Rule[]>, fired: string[]): Tree {
  const args = t.args.map(a => normalize(a, index, fired));
  const n: Tree = args.some((a, i) => a !== t.args[i]) ? { ...t, args } : t;
  const m = firstMatch(index, handle(n) as unknown as ValueHandle);
  if (!m) return n;
  fired.push(m.rule.name);
  return instantiate(m.rule.rhs, m.bindings, treeBuild);
}

/** The verified tables an edit may be an instance of. */
export const VERIFIED_TABLES: readonly RuleSet[] = [SIMPLIFY_RULES, FOLD_RULES, IDENTITY_RULES];
const STRENGTHS = ['proof', 'exhaustive', 'by-construction', 'reduced-width+argument', 'sampled', 'none'];
const INDEXES = new Map<RuleSet, Map<string, Rule[]>>();
/** The weakest recorded evidence strength among the rules a rewrite fired. */
export const weakestEvidence = (fired: readonly string[]): string =>
  fired
    .map(n => ALL_EVIDENCE[n]?.strength ?? 'none')
    .reduce((w, s) => (STRENGTHS.indexOf(s) > STRENGTHS.indexOf(w) ? s : w), 'proof');

/**
 * The audit: the first table that rewrites `a` into `b`, with the rules it fired; undefined when none does. The
 * classifier does not use this — the derivation names the rules that fired. This is kept as the check that the
 * derivation's rule names agree with what the rule tables do to the trees (tests run it over the corpus).
 */
export function rederive(
  a: Tree,
  b: Tree,
  tables: readonly RuleSet[] = VERIFIED_TABLES,
): RuleMatch | undefined {
  for (const table of tables) {
    let index = INDEXES.get(table);
    if (!index) INDEXES.set(table, (index = indexRules(table.rules)));
    const fired: string[] = [];
    if (!sameTree(normalize(a, index, fired), b) || !fired.length) continue;
    return { table: table.name, fired, weakest: weakestEvidence(fired) };
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
/**
 * Where the trees rooted at `a` (before) and `b` (after) part: the roots of the differing subtrees on each side,
 * and the values above them that were made again with the same operator, immediate and type.
 */
function parts(
  av: Readonly<Record<string, ValueRec>>,
  a: string,
  bv: Readonly<Record<string, ValueRec>>,
  b: string,
  out: { a: string[]; b: string[]; rebuilt: string[] } = { a: [], b: [], rebuilt: [] },
) {
  if (a === b) return out;
  const x = av[a],
    y = bv[b];
  if (x.op !== y.op || x.imm !== y.imm || x.type !== y.type || x.args.length !== y.args.length) {
    out.a.push(a);
    out.b.push(b);
  } else {
    out.rebuilt.push(a, b);
    x.args.forEach((u, i) => parts(av, u, bv, y.args[i], out));
  }
  return out;
}
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

/** The derivation steps an edit cites (`Edit.steps` index the application's derivation). */
const cited = (derivation: Derivation | undefined, e: Edit): readonly DerivationStep[] =>
  derivation ? (e.steps ?? []).map(i => derivation.steps[i]).filter(s => s !== undefined) : [];

/**
 * The rules a chain's cited steps fired, one name per firing, in firing order. One firing makes every entity its
 * right-hand side builds — the computed constants and the node over them — so it is a run of steps under the same
 * rule at the same site (`consumes`, the matched tree): a later firing, even of the same rule at another node,
 * reads another site. This is the record-side spelling of what `normalize`'s `fired` list re-derives.
 */
export function firedRules(steps: readonly DerivationStep[]): readonly string[] {
  const fired: string[] = [];
  let prev = '';
  for (const s of steps) {
    if (!('rule' in s.by)) {
      prev = '';
      continue;
    }
    const run = `${s.by.table ?? ''}/${s.by.rule}|${s.consumes.join(',')}`;
    if (run !== prev) fired.push(s.by.rule);
    prev = run;
  }
  return fired;
}

/** One class per edit record of an application, in the order of `app.edits`. */
export function classifyApplication(app: Application): ClassifiedEdit[] {
  const { before, after, edits } = app;
  const isNew = (id: string) => !(id in before.values) && !(id in before.stmts);
  const isGone = (id: string) => !(id in after.values) && !(id in after.stmts);
  const claimed = new Set<string>();
  const claim = (ids: readonly string[], keep: (id: string) => boolean) =>
    ids.filter(id => keep(id) && !claimed.has(id) && (claimed.add(id), true));
  // per function: the statements of an inlined call, and the functions that have one
  const inlined = new Set<string>(),
    inlining = new Set<string>();
  for (const e of edits)
    if (e.kind === 'inline') {
      inlined.add(`${e.fn} ${e.stmt}`);
      inlining.add(e.fn);
    }
  // chains of `replace` edits of one statement field: first `from`, last `to`
  const chains = new Map<string, Edit[]>();
  for (const e of edits)
    if (e.kind === 'replace') {
      const k = `${e.stmt}.${e.field}`;
      (chains.get(k) ?? chains.set(k, []).get(k)!).push(e);
    }
  // the class query's input: the entities an in-place claim may rest on (IRWB-065-A's settled reading)
  const input = app.derivation ? inPlaceInput(app.derivation, [...entityIdSet(before)]) : undefined;
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
        // the chain's first edit owns the entities: the subtrees where A and B part, and apart the rebuilt values
        const first = chain[0] === e,
          d = first ? parts(before.values, from, after.values, to) : { a: [], b: [], rebuilt: [] };
        const io = {
          removed: claim(
            d.a.flatMap(id => nodes(before.values, id)),
            isGone,
          ),
          added: claim(
            d.b.flatMap(id => nodes(after.values, id)),
            isNew,
          ),
          touched: [],
          rebuilt: d.rebuilt.filter(id => (id in before.values ? isGone(id) : isNew(id))),
        };
        // the chain's class, read off the derivation steps its edits cite — or off the trees, for its shape
        const steps = chain.flatMap(x => cited(app.derivation, x));
        if (!steps.length)
          return {
            ...base(e),
            class: 'other',
            sub: 'unrecorded',
            ...io,
          };
        if (!input || steps.some(s => locality(s, input, 'in-place') !== 'local'))
          return { ...base(e), class: 'structural', sub: inlining.has(e.fn) ? 'inline' : 'motion', ...io };
        const by = steps.flatMap(s => ('rule' in s.by ? [s.by] : []));
        if (by.length) {
          const fired = firedRules(steps);
          return {
            ...base(e),
            class: 'local',
            sub: 'rule',
            rule: { table: by[0].table ?? e.pass, fired, weakest: weakestEvidence(fired) },
            ...io,
          };
        }
        // what the cited steps say they hold by: a premise that is not one of the rule guards
        const because = steps.flatMap(s => s.premises.filter(p => !p.startsWith('guard:')));
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
        // a statement in neither revision: this application made it by `replaceStmt` (a terminator) and removed it
        if (!s) {
          const made = edits.some(x => x.kind === 'replaceStmt' && x.to === sid);
          return {
            ...base(e),
            class: made ? 'structural' : 'other',
            sub: made ? 'cfg' : 'unresolved',
            ...io,
          };
        }
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
          return (
            x.fn === `fn:${e.fn}` && !!o && (o.from === call || o.from === sid || !!o.because?.includes(call))
          );
        };
        const added = claim(
          [...Object.values(after.stmts).filter(mine), ...Object.values(after.values).filter(mine)].map(
            x => x.id,
          ),
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
 * once, for the edit owning the first of its `covers` that any edit claims. With `rebuilt`, the values a `replace`
 * made again above its changed subtrees count too (an upper bound: those instructions compute what they did).
 */
export function instructionWeights(
  classified: readonly ClassifiedEdit[],
  imageBefore: Rv32Image,
  imageAfter: Rv32Image,
  opts: { readonly rebuilt?: boolean } = {},
): number[] {
  const extra = (c: ClassifiedEdit) => (opts.rebuilt ? (c.rebuilt ?? []) : []);
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
  side(imageBefore, c => [...c.removed, ...extra(c)]);
  side(imageAfter, c => [...c.added, ...c.touched, ...extra(c)]);
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
export function tallyInto(
  t: Tally,
  classified: readonly ClassifiedEdit[],
  weights?: readonly number[],
): Tally {
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
