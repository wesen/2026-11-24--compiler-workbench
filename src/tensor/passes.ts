/**
 * The tensor passes (IRWB-020): `inline` and `split-sum`, each with the relation it claims, and a deliberately
 * wrong variant of each (`WRONG_PASSES`, not in the public table) that the meaning contract must reject.
 *
 * A pass returns a native value. The framework diffs the projections, enforces the declared writes, and gates the
 * result with the check the host supplies (`applyChecked`: the meaning check, without a Promise).
 */
import type { Artifact } from '../framework/core/types.js';
import type { CorrespondenceEntry } from '../framework/ir/types.js';
import { applyPassSync, definePass, PassError, type Pass } from '../framework/passes/define-pass.js';
import { checkMeaning, type CheckParams, type Relation } from './contract.js';
import {
  aff,
  affAdd,
  affName,
  extAff,
  mapExpr,
  refsOf,
  substExpr,
  tensorId,
  tixAdapter,
  TixIRType,
  walkExpr,
  type Aff,
  type Expr,
  type Fn,
  type Stmt,
  type TixIR,
} from './ir.js';

export interface TensorPass {
  readonly name: string;
  /** The relation under which the pass claims to keep the meaning. */
  readonly relation: Relation;
  readonly pass: Pass<TixIR, {}, unknown>;
}

interface FnResult {
  readonly fn: Fn;
  readonly correspondence: CorrespondenceEntry[];
}
function tensorPass(
  name: string,
  relation: Relation,
  description: string,
  body: (fn: Fn) => FnResult,
): TensorPass {
  const pass = definePass<TixIR>({
    id: `tensor.${name}`,
    version: '1',
    description,
    ir: TixIRType,
    adapter: tixAdapter,
    // `returns` is never written: no pass changes what a function returns
    writes: { entities: ['stmt'], relations: ['reads', 'declares'] },
    run: ctx => {
      const fns: Record<string, Fn> = {},
        correspondence: CorrespondenceEntry[] = [];
      for (const [key, fn] of Object.entries(ctx.before.value.fns)) {
        const r = body(fn);
        fns[key] = r.fn;
        correspondence.push(...r.correspondence);
      }
      return { native: { fns }, correspondence };
    },
  });
  return Object.freeze({ name, relation, pass });
}

const hasReduce = (e: Expr): boolean => {
  let found = false;
  walkExpr(e, n => void (n.k === 'reduce' && (found = true)));
  return found;
};

/**
 * Inline every statement that is pointwise (no reduction), is not the result, and is referenced exactly once: the
 * reference `d[a1, ..., an]` becomes d's expression with d's k-th index replaced by `ak`. `reversed` is the wrong
 * variant: it binds d's indices to the subscripts in reverse order.
 */
function inlineFn(fn: Fn, reversed: boolean): FnResult {
  let stmts = [...fn.stmts];
  const merged = new Map<string, Set<string>>();
  for (;;) {
    const uses = new Map<string, number>();
    for (const s of stmts) for (const t of refsOf(s.expr)) uses.set(t, (uses.get(t) ?? 0) + 1);
    const d = stmts.find(s => s.name !== fn.result && uses.get(s.name) === 1 && !hasReduce(s.expr));
    if (!d) break;
    const consumer = stmts.find(s => refsOf(s.expr).includes(d.name))!;
    const expr = mapExpr(consumer.expr, n => {
      if (n.k !== 'ref' || n.tensor !== d.name) return n;
      const at = reversed ? [...n.at].reverse() : n.at;
      const map: Record<string, Aff> = {};
      d.indices.forEach((i, k) => (map[i.name] = at[k]));
      return substExpr(d.expr, map);
    });
    stmts = stmts.filter(s => s !== d).map(s => (s === consumer ? { ...s, expr } : s));
    // a statement inlined into one that is inlined later ends up in the last consumer
    const sources = merged.get(consumer.name) ?? new Set<string>();
    for (const n of [d.name, ...(merged.get(d.name) ?? [])]) sources.add(n);
    merged.delete(d.name);
    merged.set(consumer.name, sources);
  }
  const correspondence: CorrespondenceEntry[] = [...merged].map(([consumer, sources]) => ({
    from: [...[...sources].sort().map(n => `stmt:${fn.name}/${n}`), tensorId(fn, consumer)],
    to: [tensorId(fn, consumer)],
    relation: 'merge',
    note: `inlined ${[...sources].sort().join(', ')} into ${consumer}`,
  }));
  return { fn: stmts.length === fn.stmts.length ? fn : { ...fn, stmts }, correspondence };
}

/** The block size of `split-sum`. */
export const SPLIT_BLOCK = 4;

/**
 * Rewrite every `sum` over one index `j` whose extent E is affine in the shape names into
 *   sum(jb) sum(ji) body[j := B*jb + ji],  jb in ceildiv(E, B),  ji in min(B, E - B*jb).
 * `dropTail` is the wrong variant: floor(E / B) blocks of B, so the partial last block is lost.
 */
function splitFn(fn: Fn, dropTail: boolean): FnResult {
  const B = SPLIT_BLOCK,
    shapes = new Set(fn.shapes);
  let changed = false;
  const stmts = fn.stmts.map((s): Stmt => {
    const names = new Set(s.indices.map(i => i.name));
    walkExpr(s.expr, n => void (n.k === 'reduce' && n.indices.forEach(i => names.add(i.name))));
    const fresh = (base: string) => {
      let name = base;
      while (names.has(name) || shapes.has(name)) name += '_';
      names.add(name);
      return name;
    };
    const expr = mapExpr(s.expr, n => {
      if (n.k !== 'reduce' || n.op !== 'sum' || n.indices.length !== 1) return n;
      const { name: j, extent } = n.indices[0];
      if (extent.k !== 'aff' || !Object.keys(extent.aff.terms).every(t => shapes.has(t))) return n;
      const E = extent.aff,
        jb = fresh(`${j}_b`),
        ji = fresh(`${j}_i`);
      const body = substExpr(n.body, { [j]: aff(0, { [jb]: B, [ji]: 1 }) });
      changed = true;
      return {
        k: 'reduce',
        op: 'sum',
        indices: [
          { name: jb, extent: { k: 'ceildiv', a: extAff(dropTail ? affAdd(E, aff(B - 1), -1) : E), by: B } },
        ],
        body: {
          k: 'reduce',
          op: 'sum',
          indices: [
            {
              name: ji,
              extent: dropTail
                ? extAff(aff(B))
                : { k: 'min', a: extAff(aff(B)), b: extAff(affAdd(E, affName(jb), -B)) },
            },
          ],
          body,
        },
      };
    });
    return expr === s.expr ? s : { ...s, expr };
  });
  return { fn: changed ? { ...fn, stmts } : fn, correspondence: [] };
}

export const inline = tensorPass(
  'inline',
  'exact',
  'substitute a pointwise statement with a single use into its consumer',
  fn => inlineFn(fn, false),
);
export const splitSum = tensorPass(
  'split-sum',
  'tolerance',
  `split a sum over one index into blocks of ${SPLIT_BLOCK}, then within blocks`,
  fn => splitFn(fn, false),
);
/** The public pass table. */
export const PASSES: Readonly<Record<string, TensorPass>> = Object.freeze({ inline, 'split-sum': splitSum });

/** Deliberately wrong variants, for showing that the contract rejects them. Not reachable through `optimizeTix`. */
export const WRONG_PASSES = Object.freeze({
  inline: tensorPass(
    'wrong-inline',
    'exact',
    'WRONG: inline with the subscripts bound in reverse order',
    fn => inlineFn(fn, true),
  ),
  splitSum: tensorPass(
    'wrong-split-sum',
    'tolerance',
    'WRONG: split a sum into blocks and drop the partial last block',
    fn => splitFn(fn, true),
  ),
});

export interface TixProgram {
  /** The program as compiled: the reference of the tolerance relation, and where cases come from. */
  readonly origin: Artifact<TixIR>;
  readonly current: Artifact<TixIR>;
}
export interface Step {
  pass: string;
  accepted: boolean;
  changed: boolean;
  relation: Relation;
  reason?: string;
}

/**
 * Apply one pass to a program and check it under `relation` (default: the relation the pass claims). A rejected
 * pass leaves the program as it was.
 */
export function applyChecked(
  program: TixProgram,
  entry: TensorPass,
  relation: Relation = entry.relation,
  params?: CheckParams,
): { program: TixProgram; step: Step } {
  try {
    const r = applyPassSync(entry.pass, program.current, {
      check: ({ input, output }) => checkMeaning(relation, { origin: program.origin, input, output }, params),
    });
    return {
      program: r.changed ? Object.freeze({ origin: program.origin, current: r.artifact }) : program,
      step: { pass: entry.name, accepted: true, changed: r.changed, relation },
    };
  } catch (e) {
    if (!(e instanceof PassError) || e.code !== 'contractRejected') throw e;
    return {
      program,
      step: { pass: entry.name, accepted: false, changed: false, relation, reason: e.message },
    };
  }
}
