/**
 * IRWB-035-D: classify the edits a Typed pass application makes, so a later stage can ask what share of the
 * optimizer's work is a value replaced by an equal one, what share is structural, and what share is neither.
 *
 * The unit is one edit record (`Edit`, src/typed/tx.ts) of one changed pass application, with the two revisions it
 * sits between. `replace` records of one (function, statement, field) are grouped into a chain: a field can be
 * replaced more than once in one application, and only the chain's endpoints exist as artifacts.
 *
 * A field change is a **local rewrite** when the produced tree is the consumed tree rewritten in place by
 *   - the pass's own rule table replayed bottom-up (`fold`: FOLD_RULES, `simplify`: SIMPLIFY_RULES), or
 *   - a fact-guarded rule shape whose premise the made value cites in its provenance:
 *       read -> constant      (all reaching definitions of the local assign it; the citation names one)
 *       divide/remainder by 2^k -> shift/mask  (the dividend is non-negative; the citation is a ranges fact)
 *       read -> copy of the local's single definition  (the citation is the defining statement)
 * Every other edit record is **structural** (control flow, statement insertion/removal/move, block merging, a
 * local, inlining, rotation, and a value replaced by a read of a local the same application created).
 * **Other** is the residual: a value replacement none of the above explains, reported with its unexplained shape.
 *
 * `classifySteps` adds the instruction weighting: for each edit, the executed instructions, on the workbench's
 * seeded cases, of the revision the application produced (consumed, for removals) whose `covers` name an entity
 * the edit changed, created or removed. The weight measures how much executed code an edit touches; it counts an
 * instruction once per edit that touches it, so it is an edit weight, not a partition of the program.
 *
 * `classifyPass` reads only the two artifacts and the edit records; no analysis, contract or clock is involved, so
 * the same inputs give the same classification.
 */
import type { Artifact } from '../framework/core/types.js';
import type { Rv32Image } from './backend/image.js';
import { lowerToImage, runImage } from './backend/index.js';
import { casesFrom } from './evaluate.js';
import { COMPARE } from './listing.js';
import { Store, type StmtRec, type TypedBlocks, type ValueRec } from './model.js';
import { guardHolds, isPow2, log2, matchPat, numOf } from './rules/compile.js';
import { RULE_EVIDENCE } from './rules/evidence.js';
import { FOLD_RULES } from './rules/fold.js';
import { SIMPLIFY_RULES } from './rules/simplify.js';
import type { Rule } from './rules/form.js';
import type { Edit } from './tx.js';
import type { ValueHandle } from './tx.js';

export type EditClass = 'local' | 'structural' | 'other';

/** One classified finding: a `replace` chain, or one edit record of any other kind. */
export interface ClassifiedEdit {
  readonly cls: EditClass;
  readonly kind: string;
  readonly pass: string;
  readonly fn: string;
  /** `rule-table`, `fact`, `motion`, `statement`, `no-op`, `unexplained` or `unexpected-edit-kind`. */
  readonly how: string;
  /** The rules that fired (rule table) or the shapes that matched (fact rules). */
  readonly rules?: readonly string[];
  /** For `other`: what could not be explained. */
  readonly reason?: string;
  /** The statement and field, for a `replace` chain. */
  readonly stmt?: string;
  readonly field?: string;
  /** How many edit records this finding covers (a chain can hold more than one). */
  readonly records: number;
  /** The edit's instruction weight, filled in by `classifySteps`. */
  instructions?: number;
}

/** A value tree read from a revision: `id` is the entity, the rest is the structure. */
export interface ValueTree {
  readonly op: string;
  readonly imm?: number | string;
  readonly type?: 'f32' | 'i32';
  readonly args: readonly ValueTree[];
  readonly id?: string;
}

const IMPURE = new Set(['call', 'load', 'load16u', 'div', 'rem', 'caddr', 'result']);
const typeOf = (t: ValueTree) => t.type ?? 'i32';

export function valueTree(st: Store, id: string): ValueTree {
  const v = st.get(id) as ValueRec;
  return {
    op: v.op,
    ...(v.imm === undefined ? {} : { imm: v.imm }),
    ...(v.type ? { type: v.type } : {}),
    args: v.args.map(a => valueTree(st, a)),
    id,
  };
}

/** Structural equality of two trees (ids and undefined-vs-i32 types ignored). */
export function sameValueTree(a: ValueTree, b: ValueTree): boolean {
  return (
    a.op === b.op &&
    a.imm === b.imm &&
    typeOf(a) === typeOf(b) &&
    a.args.length === b.args.length &&
    a.args.every((x, i) => sameValueTree(x, b.args[i]))
  );
}

const sizeOf = (t: ValueTree): number => 1 + t.args.reduce((n, a) => n + sizeOf(a), 0);
const isPureTree = (t: ValueTree): boolean => !IMPURE.has(t.op) && t.args.every(isPureTree);

/** The part of `ValueHandle` that the rule matcher and the guards read, over a plain tree. */
function handleOf(t: ValueTree): ValueHandle {
  const h = {
    id: t.id ?? '',
    op: t.op,
    imm: t.imm,
    get args() {
      return t.args.map(handleOf);
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
    get statement() {
      return null;
    },
    get text() {
      return '';
    },
    same(other: unknown) {
      const o = other && typeof other === 'object' ? (other as { tree?: ValueTree }) : undefined;
      const tree = o?.tree ?? (other as ValueTree | undefined);
      return !!tree && typeof tree === 'object' && sameValueTree(t, tree);
    },
    size: () => sizeOf(t),
  };
  return Object.assign(h, { tree: t }) as unknown as ValueHandle;
}

/** A template instantiated over plain trees (compile.ts's instantiate, without the transaction). */
function instantiate(tpl: unknown, b: Record<string, ValueHandle>): ValueTree {
  const t = tpl as { var?: string; const?: unknown; op?: string; args?: unknown[]; type?: 'f32' };
  if (t.var !== undefined) return (b[t.var] as unknown as { tree: ValueTree }).tree;
  if ('const' in t)
    return {
      op: 'const',
      imm: numOf(t.const as never, n => (b[n].imm as number) | 0) | 0,
      ...(t.type ? { type: t.type } : {}),
      args: [],
    };
  return {
    op: t.op!,
    ...(t.type ? { type: t.type } : {}),
    args: t.args!.map(a => instantiate(a, b)),
  };
}

/** One bottom-up replay of a rule table: children first, then the first rule whose pattern and guards match. */
export function deriveWith(rules: readonly Rule[], tree: ValueTree): { tree: ValueTree; rules: string[] } {
  const fired: string[] = [];
  const walk = (t: ValueTree): ValueTree => {
    const node: ValueTree = { ...t, args: t.args.map(walk) };
    const h = handleOf(node);
    for (const r of rules) {
      const b: Record<string, ValueHandle> = {};
      if (!matchPat(r.lhs, h, b)) continue;
      if ((r.where ?? []).some(g => !guardHolds(g, b))) continue;
      fired.push(r.name);
      return instantiate(r.rhs, b);
    }
    return node;
  };
  return { tree: walk(tree), rules: fired };
}

/** The rule tables a pass's body is written as; a pass not listed here has no table. */
export const PASS_RULES: Readonly<Record<string, readonly Rule[]>> = Object.freeze({
  fold: FOLD_RULES.rules,
  simplify: SIMPLIFY_RULES.rules,
});

/** The recorded evidence for a rule name, if the tables have one. */
export const ruleStrength = (name: string) => RULE_EVIDENCE[name]?.strength;

/** What a classification needs to read from the two revisions. */
interface Context {
  readonly before: Store;
  readonly after: Store;
  /** Locals each pass application created, by function. */
  readonly madeLocals: ReadonlyMap<string, ReadonlySet<string>>;
  /** `set` statements by function and local name, in either revision. */
  readonly definitions: (fn: string, local: string) => readonly string[];
  readonly citations: (tree: ValueTree) => readonly string[];
}

const localName = (st: Store, fn: string, index: number) => st.fn(fn).locals[index]?.name ?? `l${index}`;
const stmtValuesOf = (s: StmtRec) => [s.value, s.cond, s.addr].filter((x): x is string => !!x);

function contextOf(before: Store, after: Store, edits: readonly Edit[]): Context {
  const madeLocals = new Map<string, Set<string>>();
  for (const e of edits)
    if (e.kind === 'local') {
      const fn = String(e.fn);
      const name = String(e.local).replace(/^local:[^/]+\//, '');
      const set = madeLocals.get(fn) ?? new Set<string>();
      set.add(name);
      madeLocals.set(fn, set);
    }
  const index = new Map<string, string[]>();
  for (const st of [before, after])
    for (const f of st.fns.values())
      for (const b of f.blocks)
        for (const sid of b.stmts) {
          const s = st.get(sid) as StmtRec;
          if (s.op !== 'set' || s.value === undefined) continue;
          const key = `${f.name}\u0000${f.locals[s.local!].name}`;
          const list = index.get(key) ?? [];
          if (!list.includes(sid)) list.push(sid);
          index.set(key, list);
        }
  return {
    before,
    after,
    madeLocals,
    definitions: (fn, local) => index.get(`${fn}\u0000${local}`) ?? [],
    citations: tree => {
      if (!tree.id) return [];
      const rec = after.has(tree.id) ? (after.get(tree.id) as ValueRec) : null;
      return rec?.origin?.[0]?.because ?? [];
    },
  };
}

/** Is `sid` a `set` of `local` whose value is the tree `tree`? */
function definesAs(ctx: Context, sid: string, fn: string, local: string, tree: ValueTree): boolean {
  for (const st of [ctx.before, ctx.after]) {
    if (!st.has(sid)) continue;
    const s = st.get(sid) as StmtRec;
    if (s.kind !== 'stmt' || s.op !== 'set' || s.value === undefined) continue;
    if (st.get(s.fn).locals[s.local!]?.name !== local) continue;
    if (sameValueTree(valueTree(st, s.value), tree)) return true;
  }
  return false;
}

/**
 * The fact-guarded rule shapes, checked recursively: the produced tree must be the consumed tree rewritten at
 * positions the shapes explain, and every made value must cite its premise. Returns the shape names, or a reason.
 */
function explainFact(
  ctx: Context,
  fn: string,
  before: ValueTree,
  after: ValueTree,
):
  | { shapes: string[] }
  | {
      reason: string;
    } {
  const shapes: string[] = [];
  const walk = (b: ValueTree, a: ValueTree): string | null => {
    if (sameValueTree(b, a)) return null; // untouched subtree
    // read -> constant: the citation names a definition of that local that assigns this constant
    if (b.op === 'get' && a.op === 'const') {
      const local = localName(ctx.before, fn, Number(b.imm));
      const cited = ctx.citations(a).some(c => c.startsWith('local:') || definesAs(ctx, c, fn, local, a));
      if (cited) shapes.push('read-to-constant');
      return cited ? null : `read-to-constant without a constant definition of ${local}`;
    }
    // divide or remainder by 2^k -> shift or mask, when a ranges fact proves the dividend non-negative
    if ((b.op === 'div' || b.op === 'rem') && (a.op === 'shr' || a.op === 'and')) {
      const k = Number(b.args[1]?.op === 'const' ? b.args[1].imm : NaN);
      if (!isPow2(k)) return `${b.op} by a non-power of two replaced by ${a.op}`;
      const want = b.op === 'div' ? { op: 'shr', imm: log2(k) } : { op: 'and', imm: k - 1 };
      const ok =
        a.op === want.op &&
        a.args.length === 2 &&
        a.args[1]?.op === 'const' &&
        Number(a.args[1].imm) === want.imm &&
        ctx.citations(a).some(c => c.startsWith('fact:ranges('));
      if (!ok) return `${b.op} by ${k} without a ranges fact`;
      shapes.push(`${b.op}-pow2-to-${want.op}`);
      const inner = walk(b.args[0], a.args[0]);
      return inner;
    }
    // read -> a copy of the local's single definition
    if (b.op === 'get') {
      const local = localName(ctx.before, fn, Number(b.imm));
      const copy = ctx.definitions(fn, local).some(sid => definesAs(ctx, sid, fn, local, a));
      if (copy) {
        shapes.push('read-to-single-definition');
        return null;
      }
      return `read of ${local} replaced by a tree that is not its definition`;
    }
    if (b.op === a.op && b.imm === a.imm && typeOf(b) === typeOf(a) && b.args.length === a.args.length) {
      for (let i = 0; i < b.args.length; i++) {
        const bad = walk(b.args[i], a.args[i]);
        if (bad) return bad;
      }
      return null;
    }
    return `${b.op} replaced by ${a.op}`;
  };
  const bad = walk(before, after);
  return bad ? { reason: bad } : { shapes: [...new Set(shapes)] };
}

interface Chain {
  readonly pass: string;
  readonly fn: string;
  readonly stmt: string;
  readonly field: string;
  readonly from: string;
  readonly to: string;
  readonly records: number;
  readonly at: number;
}

function chainsOf(edits: readonly Edit[]): Chain[] {
  const out = new Map<string, Chain>();
  edits.forEach((e, at) => {
    if (e.kind !== 'replace') return;
    const key = `${e.fn}\u0000${e.stmt}\u0000${e.field}`;
    const prev = out.get(key);
    out.set(key, {
      pass: String(e.pass),
      fn: String(e.fn),
      stmt: String(e.stmt),
      field: String(e.field),
      from: prev ? prev.from : String(e.from),
      to: String(e.to),
      records: (prev?.records ?? 0) + 1,
      at: prev ? prev.at : at,
    });
  });
  return [...out.values()].sort((a, b) => a.at - b.at);
}

/** The class of one `replace` chain. */
function classifyChain(ctx: Context, c: Chain): ClassifiedEdit {
  const base = { kind: 'replace', pass: c.pass, fn: c.fn, stmt: c.stmt, field: c.field, records: c.records };
  if (!ctx.before.has(c.from) || !ctx.after.has(c.to))
    return { ...base, cls: 'other', how: 'unexplained', reason: 'chain endpoint not in its revision' };
  const before = valueTree(ctx.before, c.from);
  const after = valueTree(ctx.after, c.to);
  if (sameValueTree(before, after))
    return { ...base, cls: 'other', how: 'no-op', reason: 'rebuilt, same tree' };
  const table = PASS_RULES[c.pass];
  if (table) {
    const derived = deriveWith(table, before);
    if (sameValueTree(derived.tree, after))
      return { ...base, cls: 'local', how: 'rule-table', rules: [...new Set(derived.rules)].sort() };
  }
  const explained = explainFact(ctx, c.fn, before, after);
  if ('shapes' in explained) return { ...base, cls: 'local', how: 'fact', rules: explained.shapes.sort() };
  // a changed position that reads a local this application made: hoisting, value numbering, inlining
  const made = ctx.madeLocals.get(c.fn) ?? new Set<string>();
  const readsMadeAtChange = (b: ValueTree, a: ValueTree): boolean => {
    if (sameValueTree(b, a)) return false;
    if (a.op === 'get' && made.has(localName(ctx.after, c.fn, Number(a.imm)))) return true;
    return (
      b.op === a.op &&
      b.args.length === a.args.length &&
      b.args.some((x, i) => readsMadeAtChange(x, a.args[i]))
    );
  };
  if (readsMadeAtChange(before, after)) return { ...base, cls: 'structural', how: 'motion' };
  return { ...base, cls: 'other', how: 'unexplained', reason: explained.reason };
}

/** The classification of every edit record of one changed pass application. */
export function classifyPass(
  before: Artifact<TypedBlocks>,
  after: Artifact<TypedBlocks>,
  edits: readonly Edit[],
): readonly ClassifiedEdit[] {
  const stBefore = Store.from(before.value),
    stAfter = Store.from(after.value);
  const ctx = contextOf(stBefore, stAfter, edits);
  const chains = chainsOf(edits);
  const chainAt = new Map(chains.map(c => [`${c.fn}\u0000${c.stmt}\u0000${c.field}`, c]));
  const out: (ClassifiedEdit | null)[] = edits.map(() => null);
  edits.forEach((e, at) => {
    if (e.kind === 'replace') {
      const c = chainAt.get(`${e.fn}\u0000${e.stmt}\u0000${e.field}`)!;
      if (out[at] === null) out[at] = at === c.at ? classifyChain(ctx, c) : null;
      return;
    }
    out[at] = {
      cls: 'structural',
      kind: String(e.kind),
      pass: String(e.pass),
      fn: String(e.fn),
      how: 'statement',
      records: 1,
    };
  });
  return out.filter((x): x is ClassifiedEdit => x !== null);
}

// ---------- instruction weighting ----------
export interface WeightOptions {
  /** Cases per function for the executed counts (the workbench's metrics use 10). */
  readonly count?: number;
  readonly seed?: number;
  /** The emulator's step limit per run; a run that hits it contributes no counts. */
  readonly limit?: number;
}

interface RevisionHeat {
  readonly image: Rv32Image;
  readonly counts: Float64Array;
  readonly steps: number;
}

const heatOf = (art: Artifact<TypedBlocks>, opts: WeightOptions): RevisionHeat => {
  const { image } = lowerToImage(art);
  const st = Store.from(art.value);
  const counts = new Float64Array(image.value.bytes / 4);
  let steps = 0;
  for (const fn of art.value.fnOrder)
    for (const c of casesFrom(st, fn, {
      count: opts.count ?? 10,
      seed: opts.seed ?? 7,
      inputs: {},
    })) {
      const r = runImage(image, fn, c.args, c.memory, { limit: opts.limit ?? 2e5, counts: true });
      if (r.limit || !r.counts) continue;
      steps += r.steps;
      for (let i = 0; i < counts.length; i++) counts[i] += r.counts[i];
    }
  return { image: image.value, counts, steps };
};

const subtreeOf = (st: Store, id: string | undefined, out = new Set<string>()): Set<string> => {
  if (!id || !st.has(id)) return out;
  out.add(id);
  const rec = st.get(id);
  if (rec.kind === 'value') for (const a of (rec as ValueRec).args) subtreeOf(st, a, out);
  else for (const v of stmtValuesOf(rec as StmtRec)) subtreeOf(st, v, out);
  return out;
};

/** The entities whose instructions an edit affects, read from the revision that holds them. */
export function affectedEntities(
  edit: Edit,
  stBefore: Store,
  stAfter: Store,
): { readonly side: 'before' | 'after'; readonly entities: ReadonlySet<string> } {
  const after = new Set<string>();
  switch (String(edit.kind)) {
    case 'replace':
      return { side: 'after', entities: subtreeOf(stAfter, String(edit.to)) };
    case 'insert':
    case 'move':
    case 'retarget':
      return { side: 'after', entities: subtreeOf(stAfter, String(edit.stmt)) };
    case 'replaceStmt':
      return { side: 'after', entities: subtreeOf(stAfter, String(edit.to)) };
    case 'remove':
    case 'removeFn':
      return { side: 'before', entities: subtreeOf(stBefore, String(edit.stmt)) };
    case 'block':
    case 'merge':
    case 'unreachable':
      after.add(String(edit.block ?? edit.to));
      return { side: 'after', entities: after };
    default:
      // `local`, `note`, `inline`: no machine instruction names the entity itself
      return { side: 'after', entities: after };
  }
}

/** Executed instructions of one revision whose `covers` intersect `entities` (each instruction once). */
function weightOf(heat: RevisionHeat, entities: ReadonlySet<string>): number {
  if (!entities.size) return 0;
  let n = 0;
  for (const ins of heat.image.insns)
    if (ins.covers.some(c => entities.has(c))) n += heat.counts[ins.offset >>> 2];
  return n;
}

export interface StepClassification {
  readonly pass: string;
  readonly rev: number;
  readonly edits: readonly ClassifiedEdit[];
  /** Executed instructions of each revision the step touched: the produced one, and the consumed one. */
  readonly instructions: { readonly after: number; readonly before: number };
}

/**
 * Classify one changed pass application and weight its edits. `step` is a `PipelineStep` from `runPipeline`
 * (`{pass, changed, report, result}`); unchanged steps classify to no edits.
 */
export function classifyStep(
  step: {
    readonly pass: string;
    readonly rev: number;
    readonly changed: boolean;
    readonly report?: { readonly edits: readonly Edit[] };
    readonly result?: { readonly before: Artifact<TypedBlocks>; readonly artifact: Artifact<TypedBlocks> };
  },
  opts: WeightOptions = {},
): StepClassification {
  if (!step.changed || !step.report?.edits?.length || !step.result)
    return { pass: step.pass, rev: step.rev, edits: [], instructions: { after: 0, before: 0 } };
  const classified = classifyPass(step.result.before, step.result.artifact, step.report.edits);
  // weight every edit record, then sum the records a finding covers
  const stBefore = Store.from(step.result.before.value),
    stAfter = Store.from(step.result.artifact.value);
  const heatAfter = heatOf(step.result.artifact, opts),
    heatBefore = heatOf(step.result.before, opts);
  const weights = new Map<string, number>();
  const key = (e: ClassifiedEdit) =>
    `${e.kind}\u0000${e.pass}\u0000${e.fn}\u0000${e.stmt ?? ''}\u0000${e.field ?? ''}`;
  for (const edit of step.report.edits) {
    const { side, entities } = affectedEntities(edit, stBefore, stAfter);
    const w = weightOf(side === 'before' ? heatBefore : heatAfter, entities);
    const k = `${String(edit.kind)}\u0000${String(edit.pass)}\u0000${String(edit.fn)}\u0000${edit.kind === 'replace' ? String(edit.stmt) : ''}\u0000${edit.kind === 'replace' ? String(edit.field) : ''}`;
    weights.set(k, (weights.get(k) ?? 0) + w);
  }
  return {
    pass: step.pass,
    rev: step.rev,
    edits: classified.map(e => ({ ...e, instructions: weights.get(key(e)) ?? 0 })),
    instructions: { after: heatAfter.steps, before: heatBefore.steps },
  };
}

/** Classify and weight every changed step of a pipeline run, in order. */
export function classifySteps(
  steps: readonly Parameters<typeof classifyStep>[0][],
  opts: WeightOptions = {},
): readonly StepClassification[] {
  return steps.filter(s => s.changed).map(s => classifyStep(s, opts));
}

/** The classes' edit-record counts and instruction weights, per class. */
export function totals(
  edits: readonly ClassifiedEdit[],
): Record<EditClass, { edits: number; records: number; instructions: number }> {
  const out = {
    local: { edits: 0, records: 0, instructions: 0 },
    structural: { edits: 0, records: 0, instructions: 0 },
    other: { edits: 0, records: 0, instructions: 0 },
  };
  for (const e of edits) {
    out[e.cls].edits += 1;
    out[e.cls].records += e.records;
    out[e.cls].instructions += e.instructions ?? 0;
  }
  return out;
}

/** The rules a set of local rewrites cited, with their recorded evidence strength. */
export function ruleCoverage(edits: readonly ClassifiedEdit[]): {
  readonly verified: number;
  readonly facts: number;
  readonly byRule: Record<string, number>;
} {
  let verified = 0,
    facts = 0;
  const byRule: Record<string, number> = {};
  for (const e of edits) {
    if (e.cls !== 'local') continue;
    if (e.how === 'rule-table') verified++;
    if (e.how === 'fact') facts++;
    for (const r of e.rules ?? []) byRule[r] = (byRule[r] ?? 0) + 1;
  }
  return { verified, facts, byRule };
}
