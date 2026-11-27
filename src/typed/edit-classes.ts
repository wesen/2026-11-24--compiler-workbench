/**
 * IRWB-035-F: classify the edits a pipeline makes as local rewrites, structural changes or other, and weigh each by
 * the instructions it affects.
 *
 * The unit is one edit record (`RevisionReport.edits`, one per `Tx` operation). The rules, tried in order (the design
 * in ttmp/2026/11/27/IRWB-035-F--…/design-doc/01-… gives their reasons):
 *
 *   D1   any record of an application of inline, rotate or licm                          structural
 *   D2   retarget, block, unreachable, merge, move; replaceStmt/remove/insert of a
 *        terminator (br, br_if, return, trap)                                           structural / control-flow
 *   D3a  replace whose new tree reads a local the input function lacks, or whose new
 *        values cite a statement the same application removes or inserts                other / coupled
 *   D3b  replace re-derived exactly by a verified rule table (simplify, then fold)       local / verified
 *   D3c  replace whose every window is a fact-guarded shape with its fact cited          local / fact-guarded
 *   D3d  any other replace                                                              other / unmatched-value
 *   D4   remove of a non-terminator                                                     other / remove
 *   D5   anything else                                                                  other / <kind>
 *
 * A replace's trees are T (rooted at edit.from in the input) and T' (at edit.to in the output); its windows are the
 * smallest subtree pairs that differ. Re-derivation uses the matcher the passes compile from the tables
 * (rules/compile.ts firstMatch), on plain trees.
 */
import type { Artifact } from '../framework/core/types.js';
import { IMPURE } from './analyses.js';
import { lowerToImage, runImage } from './backend/index.js';
import { casesFrom, type ProgramInputs } from './evaluate.js';
import { F32_RESULT } from './f32.js';
import { storeOf } from './ir.js';
import { COMPARE } from './listing.js';
import type { Origin, TypedBlocks, ValueRec } from './model.js';
import { firstMatch, indexRules, numOf, type Bindings } from './rules/compile.js';
import { RULE_EVIDENCE } from './rules/evidence.js';
import { FOLD_RULES } from './rules/fold.js';
import type { RuleSet, Tpl } from './rules/form.js';
import { SIMPLIFY_RULES } from './rules/simplify.js';
import type { Edit, ValueHandle } from './tx.js';

export type EditClass = 'local' | 'structural' | 'other';

export interface ClassifiedEdit {
  readonly rev: number;
  readonly pass: string;
  readonly fn: string;
  readonly edit: string;
  readonly kind: string;
  readonly class: EditClass;
  /** verified, fact-guarded; inline, rotate, licm, control-flow; coupled, unmatched-value, remove, <kind> */
  readonly sub: string;
  /** The deciding rule: D1 … D5. */
  readonly rule: string;
  /** local/verified: the table and the rules that fired, in firing order. */
  readonly table?: string;
  readonly rules?: readonly string[];
  /** local/verified: the weakest evidence strength among the rules that fired. */
  readonly strength?: string;
  /** The rules the edit record itself names (`rules`); no pass records them today (Tx has no citation). */
  readonly cites?: readonly string[];
  /** replace edits: the shape of each window (local/fact-guarded: the catalog names). */
  readonly shapes?: readonly string[];
  /** Statements of the input revision the edit changes or removes, else statements of the output it adds. */
  readonly sites: { readonly before: readonly string[]; readonly after: readonly string[] };
  readonly weight?: { readonly static: number; readonly executed: number };
}

// ---------- trees ----------
interface Tree {
  readonly op: string;
  readonly imm?: number | string;
  readonly type?: 'f32';
  readonly args: readonly Tree[];
  /** The value id and origin, for trees read from a revision (absent for a re-derived node). */
  readonly id?: string;
  readonly origin?: readonly Origin[];
}

const treeOf = (values: TypedBlocks['values'], id: string): Tree => {
  const v = values[id] as ValueRec;
  return {
    op: v.op,
    ...(v.imm !== undefined ? { imm: v.imm } : {}),
    ...(v.type ? { type: v.type } : {}),
    args: v.args.map(a => treeOf(values, a)),
    id,
    origin: v.origin,
  };
};

const sameTree = (x: Tree, y: Tree): boolean =>
  x.op === y.op &&
  x.imm === y.imm &&
  x.type === y.type &&
  x.args.length === y.args.length &&
  x.args.every((a, i) => sameTree(a, y.args[i]));

const pureTree = (t: Tree): boolean => !IMPURE.has(t.op) && t.args.every(pureTree);
const nodes = (t: Tree, out: Tree[] = []): Tree[] => {
  out.push(t);
  t.args.forEach(a => nodes(a, out));
  return out;
};

type TreeHandle = ValueHandle & { readonly tree: Tree };
/** A read-only value handle over a plain tree, for the rule matcher (matchPat, guardHolds). */
function handle(t: Tree): TreeHandle {
  return {
    tree: t,
    id: t.id ?? '',
    op: t.op as ValueHandle['op'],
    imm: t.imm,
    get args() {
      return t.args.map(handle);
    },
    isConst: t.op === 'const',
    isLeaf: !t.args.length,
    get isPure() {
      return pureTree(t);
    },
    get hasEffect() {
      return !pureTree(t);
    },
    isBoolean: COMPARE.has(t.op),
    statement: null,
    text: '',
    same: other => sameTree(t, (other as TreeHandle).tree),
    size: () => nodes(t).length,
  };
}

/** A rule's replacement as a tree (rules/compile.ts instantiate, without a transaction). */
function instantiate(t: Tpl, b: Bindings): Tree {
  if ('var' in t) return (b[t.var] as TreeHandle).tree;
  if ('const' in t)
    return {
      op: 'const',
      imm: numOf(t.const, x => b[x].imm as number) | 0,
      ...(t.type ? { type: t.type } : {}),
      args: [],
    };
  return {
    op: t.op,
    ...(F32_RESULT.has(t.op) ? { type: 'f32' as const } : {}),
    args: t.args.map(a => instantiate(a, b)),
  };
}

const TABLES: readonly RuleSet[] = [SIMPLIFY_RULES, FOLD_RULES];
const INDEX = new Map(TABLES.map(t => [t.name, indexRules(t.rules)]));

/** Bottom-up, the first matching rule per node, its replacement not revisited (as Tx.rewrite does). */
function normalize(t: Tree, table: string, fired: string[]): Tree {
  const args = t.args.map(a => normalize(a, table, fired));
  const n: Tree = args.some((a, i) => a !== t.args[i]) ? { ...t, args, id: undefined } : t;
  const m = firstMatch(INDEX.get(table)!, handle(n));
  if (!m) return n;
  fired.push(m.rule.name);
  return instantiate(m.rule.rhs, m.bindings);
}

const STRENGTHS = ['proof', 'exhaustive', 'by-construction', 'reduced-width+argument', 'sampled'];
/** The table that re-derives T' from T, with the rules that fired, when each has sound evidence. */
export function rederive(
  before: Tree,
  after: Tree,
): { table: string; rules: string[]; strength: string } | undefined {
  for (const t of TABLES) {
    const fired: string[] = [];
    if (!sameTree(normalize(before, t.name, fired), after) || !fired.length) continue;
    const evidence = fired.map(n => RULE_EVIDENCE[n]);
    const version = (n: string) => t.rules.find(r => r.name === n)!.version;
    if (evidence.some((e, i) => !e || e.verdict !== 'sound' || e.version !== version(fired[i]))) continue;
    const strength = evidence
      .map(e => e!.strength ?? 'sampled')
      .reduce((w, s) => (STRENGTHS.indexOf(s) > STRENGTHS.indexOf(w) ? s : w), 'proof');
    return { table: t.name, rules: fired, strength };
  }
  return undefined;
}

/** The smallest differing subtree pairs of two trees. */
export function windows(x: Tree, y: Tree): [Tree, Tree][] {
  if (sameTree(x, y)) return [];
  if (x.op === y.op && x.imm === y.imm && x.type === y.type && x.args.length === y.args.length)
    return x.args.flatMap((a, i) => windows(a, y.args[i]));
  return [[x, y]];
}

/** A window as text: subtrees on both sides become a, b, …; constants #; other reads get. */
export function shapeOf([x, y]: [Tree, Tree]): string {
  // the maximal subtrees of x that y also contains, in pre-order
  const shared: Tree[] = [];
  const inY = nodes(y);
  const find = (n: Tree): void => {
    if (n.op !== 'const' && inY.some(m => sameTree(n, m))) {
      if (!shared.some(s => sameTree(s, n))) shared.push(n);
    } else n.args.forEach(find);
  };
  find(x);
  const show = (t: Tree): string => {
    const i = shared.findIndex(s => sameTree(s, t));
    if (i >= 0) return String.fromCharCode(97 + (i % 26)) + (i >= 26 ? i : '');
    if (t.op === 'const') return '#';
    if (!t.args.length) return t.op;
    return `${t.op}(${t.args.map(show).join(', ')})`;
  };
  return `${show(x)} → ${show(y)}`;
}

const isPow2 = (n: unknown) => typeof n === 'number' && n > 0 && (n & (n - 1)) === 0;
const becauseOf = (t: Tree): readonly string[] => t.origin?.[0]?.because ?? [];
const citesRange = (t: Tree) => becauseOf(t).some(b => b.startsWith('fact:ranges'));

/**
 * The fact-guarded catalog: the shapes that rewrite the window, outermost first, or undefined. A shape's operand may
 * itself be rewritten by a catalog shape (strength rewrites `(x / 2^j) % 2^k` in one tree: rem-pow2 over div-pow2).
 */
export function factShape([x, y]: [Tree, Tree]): string[] | undefined {
  if (x.op === 'get' && y.op === 'const' && becauseOf(y).length) return ['const-read'];
  if (
    (x.op === 'div' || x.op === 'rem') &&
    x.args[1].op === 'const' &&
    isPow2(x.args[1].imm) &&
    y.args.length === 2 &&
    y.args[1].op === 'const' &&
    citesRange(y)
  ) {
    const inner = sameTree(y.args[0], x.args[0]) ? [] : factShape([x.args[0], y.args[0]]);
    if (!inner) return undefined;
    const k = x.args[1].imm as number;
    if (x.op === 'div' && y.op === 'shr' && y.args[1].imm === 31 - Math.clz32(k))
      return ['div-pow2', ...inner];
    if (x.op === 'rem' && y.op === 'and' && y.args[1].imm === k - 1) return ['rem-pow2', ...inner];
  }
  return undefined;
}

// ---------- classification ----------
const TERMINATORS = new Set(['br', 'br_if', 'return', 'trap']);
const STRUCTURAL_PASSES = new Set(['inline', 'rotate', 'licm']);
const CONTROL_KINDS = new Set(['retarget', 'block', 'unreachable', 'merge', 'move']);

/** The statements an edit names in the input revision (changed or removed) and in the output (added). */
function sitesOf(before: TypedBlocks, after: TypedBlocks, e: Edit): ClassifiedEdit['sites'] {
  const inB = (s: unknown): s is string => typeof s === 'string' && s in before.stmts;
  switch (e.kind) {
    case 'replace':
    case 'retarget':
    case 'move':
    case 'remove':
      return { before: inB(e.stmt) ? [e.stmt] : [], after: [] };
    case 'replaceStmt':
      return { before: inB(e.from) ? [e.from] : [], after: [] };
    case 'unreachable': {
      const b = before.blocks[e.block as string];
      return { before: b ? [...b.stmts] : [], after: [] };
    }
    case 'insert':
      return { before: [], after: typeof e.stmt === 'string' && e.stmt in after.stmts ? [e.stmt] : [] };
    default:
      return { before: [], after: [] };
  }
}

/** Classify the edit records of one pass application, `before` → `after`, in record order. */
export function classifyApplication(
  before: TypedBlocks,
  after: TypedBlocks,
  pass: string,
  edits: readonly Edit[],
): ClassifiedEdit[] {
  const removed = new Set(edits.filter(e => e.kind === 'remove').map(e => e.stmt as string));
  const inserted = new Set(edits.filter(e => e.kind === 'insert').map(e => e.stmt as string));
  const terminator = (id: unknown, rev: TypedBlocks) =>
    typeof id === 'string' && !!rev.stmts[id] && TERMINATORS.has(rev.stmts[id].op);
  return edits.map(e => {
    const base = {
      rev: e.rev,
      pass,
      fn: e.fn,
      edit: e.id,
      kind: e.kind,
      sites: sitesOf(before, after, e),
      ...(Array.isArray(e.rules) ? { cites: e.rules as string[] } : {}),
    };
    const row = (cls: EditClass, sub: string, rule: string, extra: Partial<ClassifiedEdit> = {}) => ({
      ...base,
      class: cls,
      sub,
      rule,
      ...extra,
    });
    if (STRUCTURAL_PASSES.has(pass)) return row('structural', pass, 'D1');
    const touchesTerminator =
      terminator(e.stmt, before) ||
      terminator(e.stmt, after) ||
      terminator(e.from, before) ||
      terminator(e.to, after);
    if (
      CONTROL_KINDS.has(e.kind) ||
      ((e.kind === 'replaceStmt' || e.kind === 'remove' || e.kind === 'insert') && touchesTerminator)
    )
      return row('structural', 'control-flow', 'D2');
    if (e.kind === 'replace' && typeof e.from === 'string' && typeof e.to === 'string') {
      // a value made by an earlier record of the same application (a second replace of one field), or one a later
      // record replaced again, is part of a multi-record change
      if (!(e.from in before.values) || !(e.to in after.values)) return row('other', 'coupled', 'D3a');
      const t = treeOf(before.values, e.from),
        u = treeOf(after.values, e.to);
      const ws = windows(t, u);
      const shapes = ws.map(shapeOf);
      const locals = before.fns[e.fn]?.locals.length ?? 0;
      const fresh = nodes(u).filter(n => n.id && !(n.id in before.values));
      if (
        fresh.some(n => n.op === 'get' && (n.imm as number) >= locals) ||
        fresh.some(n => becauseOf(n).some(b => removed.has(b) || inserted.has(b)))
      )
        return row('other', 'coupled', 'D3a', { shapes });
      const r = rederive(t, u);
      if (r) return row('local', 'verified', 'D3b', { ...r, shapes });
      const facts = ws.map(factShape);
      if (ws.length && facts.every(Boolean))
        return row('local', 'fact-guarded', 'D3c', { shapes: facts.flatMap(f => f!) });
      return row('other', 'unmatched-value', 'D3d', { shapes });
    }
    if (e.kind === 'remove') return row('other', 'remove', 'D4');
    return row('other', e.kind, 'D5');
  });
}

// ---------- weights ----------
export interface StatementWeights {
  readonly static: ReadonlyMap<string, number>;
  readonly executed: ReadonlyMap<string, number>;
}

/** The weight-measurement parameters: `typed.metrics`'s (strategies.ts measure). */
export const WEIGHT_CASES = { count: 10, seed: 7, limit: 2e5 } as const;

/**
 * Per statement of a revision: the image instructions that cover it (default backend options), and their executions
 * over the seeded cases of every function.
 */
export function statementWeights(art: Artifact<TypedBlocks>, inputs: ProgramInputs = {}): StatementWeights {
  const { image } = lowerToImage(art);
  const st = storeOf(art.value);
  const img = image.value;
  const words = new Float64Array(img.bytes >>> 2);
  for (const fn of art.value.fnOrder)
    for (const c of casesFrom(st, fn, {
      count: WEIGHT_CASES.count,
      seed: WEIGHT_CASES.seed,
      inputs: inputs[fn] ?? {},
    })) {
      const r = runImage(image, fn, c.args, c.memory, { limit: WEIGHT_CASES.limit });
      if (r.counts) for (let i = 0; i < words.length; i++) words[i] += r.counts[i] ?? 0;
    }
  const stat = new Map<string, number>(),
    exec = new Map<string, number>();
  for (const insn of img.insns)
    for (const c of insn.covers)
      if (c in art.value.stmts) {
        stat.set(c, (stat.get(c) ?? 0) + 1);
        exec.set(c, (exec.get(c) ?? 0) + words[insn.offset >>> 2]);
      }
  return { static: stat, executed: exec };
}

/**
 * Weigh classified edits: an edit's sites in the input revision weigh by its weights, else its sites in the output by
 * the output's. Statements the output adds that no edit names (inline copies a callee's body without insert records)
 * go to the application's first `inline` record of their function; the rest are returned as unattributed.
 */
export function weigh(
  rows: readonly ClassifiedEdit[],
  before: TypedBlocks,
  after: TypedBlocks,
  wb: StatementWeights,
  wa: StatementWeights,
  edits: readonly Edit[],
): { rows: ClassifiedEdit[]; unattributed: { static: number; executed: number } } {
  const named = new Set<string>();
  for (const e of edits)
    for (const k of ['stmt', 'from', 'to']) if (typeof e[k] === 'string') named.add(e[k] as string);
  const sum = (w: StatementWeights, ids: readonly string[]) => ({
    static: ids.reduce((n, s) => n + (w.static.get(s) ?? 0), 0),
    executed: ids.reduce((n, s) => n + (w.executed.get(s) ?? 0), 0),
  });
  const extra = new Map<string, string[]>(); // fn name -> unnamed new statements
  const fnName = new Map(Object.values(after.fns).map(f => [f.id, f.name]));
  for (const [id, s] of Object.entries(after.stmts))
    if (!(id in before.stmts) && !named.has(id)) {
      const fn = fnName.get(s.fn) ?? s.fn;
      (extra.get(fn) ?? extra.set(fn, []).get(fn)!).push(id);
    }
  const out = rows.map(r => {
    let w = r.sites.before.length ? sum(wb, r.sites.before) : sum(wa, r.sites.after);
    if (r.kind === 'inline' && extra.has(r.fn)) {
      const more = sum(wa, extra.get(r.fn)!);
      extra.delete(r.fn);
      w = { static: w.static + more.static, executed: w.executed + more.executed };
    }
    return { ...r, weight: w };
  });
  const rest = sum(wa, [...extra.values()].flat());
  return { rows: out, unattributed: rest };
}

/** The revisions of a program the classifier needs: each revision's artifact, pass and edit records. */
export interface RevisionLike {
  readonly pass: string;
  readonly artifact: Artifact<TypedBlocks>;
  readonly edits: readonly Edit[];
}

/**
 * Classify (and optionally weigh) every revision after the first: revision i is the application of its pass to
 * revision i - 1. `weights: true` lowers and runs each revision once.
 */
export function classifyRevisions(
  revisions: readonly RevisionLike[],
  opts: { weights?: boolean; inputs?: ProgramInputs } = {},
): { rows: ClassifiedEdit[]; unattributed: Record<string, { static: number; executed: number }> } {
  const rows: ClassifiedEdit[] = [];
  const unattributed: Record<string, { static: number; executed: number }> = {};
  const cache = new Map<string, StatementWeights>();
  const weightsOf = (a: Artifact<TypedBlocks>) => {
    let w = cache.get(a.revision);
    if (!w) cache.set(a.revision, (w = statementWeights(a, opts.inputs)));
    return w;
  };
  for (let i = 1; i < revisions.length; i++) {
    const b = revisions[i - 1].artifact,
      a = revisions[i].artifact,
      { pass, edits } = revisions[i];
    const cls = classifyApplication(b.value, a.value, pass, edits);
    if (!opts.weights) {
      rows.push(...cls);
      continue;
    }
    const w = weigh(cls, b.value, a.value, weightsOf(b), weightsOf(a), edits);
    rows.push(...w.rows);
    const u = (unattributed[pass] ??= { static: 0, executed: 0 });
    u.static += w.unattributed.static;
    u.executed += w.unattributed.executed;
  }
  return { rows, unattributed };
}

// ---------- summaries ----------
export interface Tally {
  edits: number;
  static: number;
  executed: number;
}
export type Summary = Record<string, Record<string, Tally>>;

/** Rows tallied by a key (pass, sub-class, …) and then by class (local, structural, other) or another key. */
export function tally(
  rows: readonly ClassifiedEdit[],
  by: (r: ClassifiedEdit) => string,
  col: (r: ClassifiedEdit) => string = r => r.class,
): Summary {
  const out: Summary = {};
  for (const r of rows) {
    const t = ((out[by(r)] ??= {})[col(r)] ??= { edits: 0, static: 0, executed: 0 });
    t.edits++;
    t.static += r.weight?.static ?? 0;
    t.executed += r.weight?.executed ?? 0;
  }
  return out;
}
