/**
 * Rules as data, and the one strategy both clients share (IRWB-060-B): rules indexed by the operator of their
 * pattern's root, tried in table order, the first whose pattern matches and whose guards hold.
 *
 * A rule is a name, a pattern (its left-hand side), a list of guards and a template (its right-hand side). Guards
 * are the domain's objects: the library only calls the domain's predicate with a guard, the bindings and the matched
 * node. The node is passed because a guard may be about something that is not a subtree — Tix's `split-sum` requires
 * the matched reduction to have exactly one axis of kind `dim`, and the axis is not a child term.
 *
 * What is *not* here is a traversal. Typed rewrites inside an edit transaction that allocates value ids and records
 * derivation steps; Tix rewrites with `mapExpr`, which knows where its binders are. A library walker would duplicate
 * both, so the shared part stops at first-match, and each domain keeps its walk (see the ticket's design note §1).
 */
import { match, patternOp, type Bindings, type Pattern, type Template } from './pattern.js';
import type { Signature } from './signature.js';

export interface Rule<T, G = unknown> {
  readonly name: string;
  readonly lhs: Pattern<T>;
  readonly where?: readonly G[];
  readonly rhs: Template<T>;
}

/** Rules by the operator of their pattern's root: the only index either client needs. */
export type RuleIndex<T, G = unknown> = ReadonlyMap<string, readonly Rule<T, G>[]>;

export interface MatchResult<T, G> {
  readonly rule: Rule<T, G>;
  readonly bindings: Bindings<T>;
  /** The term the rule matched: the site a derivation step and a correspondence entry are about. */
  readonly node: T;
}

export interface MatchOptions<T, G> {
  /** The domain's guards, on one guard, the bindings and the matched node (default: every guard holds). */
  readonly guard?: (g: G, bindings: Bindings<T>, node: T) => boolean;
  /** The equality `{ same: x }` compares with (default: structural equality over the signature). */
  readonly equal?: (a: T, b: T) => boolean;
}

export function indexRules<T, G = unknown>(rules: readonly Rule<T, G>[]): RuleIndex<T, G> {
  const index = new Map<string, Rule<T, G>[]>();
  for (const r of rules) {
    const key = patternOp(r.lhs),
      list = index.get(key);
    if (list) list.push(r);
    else index.set(key, [r]);
  }
  return index;
}

/** The first rule of the index at `t`'s operator that matches `t` and whose guards hold, or undefined. */
export function firstMatch<T, G = unknown>(
  index: RuleIndex<T, G>,
  sig: Signature<T>,
  t: T,
  options: MatchOptions<T, G> = {},
): MatchResult<T, G> | undefined {
  const list = index.get(sig.op(t));
  if (!list) return undefined;
  for (const rule of list) {
    const b = new Map<string, T>();
    if (!match(sig, rule.lhs, t, b, options.equal)) continue;
    const bindings: Bindings<T> = b;
    if (rule.where?.length) {
      // a guarded rule needs the domain's predicate: answering "it holds" without it would rewrite on a guess
      if (!options.guard)
        throw new Error(`firstMatch: rule ${rule.name} has guards and no guard function was given`);
      if (!rule.where.every(g => options.guard!(g, bindings, t))) continue;
    }
    return { rule, bindings, node: t };
  }
  return undefined;
}
