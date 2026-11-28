/**
 * Patterns, templates, matching and instantiation over a signature (IRWB-060-B): first-order rewriting's two
 * operations, with no domain type in sight.
 *
 *   pattern    { var }              any term, bound to the name (a later occurrence rebinds, as a rule's variables
 *                                   are distinct by well-formedness)
 *              { const: n }         a constant whose immediate is n
 *              { bindConst: k }     any constant, bound to k (a rule's constants it computes with)
 *              { same: x }          a term equal to the one already bound to x, under the caller's equality
 *              { op, args }         an operator applied to sub-patterns
 *   template   { var }              the bound term itself: no node is made
 *              { const }           a constant; the number may be computed from the bindings, which is what a rule
 *                                   like `x * 2^k → x << log2 k` needs
 *              { op, args }        an operator applied to sub-templates, made children first, left to right
 *              { build }           a domain function of the bindings and the matched node: a **binder** (Tix's
 *                                   reduction axes) or a substitution under one, which a first-order template
 *                                   cannot state
 *
 * Matching is first-order matching: variables on one side only, a pattern is linear or not by the domain's choice,
 * and there is no unification. Instantiation is the substitution, and it builds through a `Builder`, so a domain
 * that allocates its nodes (Typed's transaction) or tags them (an f32 constant) keeps doing so without the library
 * knowing. `outermost` is the one fact instantiation reports about the template's shape: the node being made is the
 * replacement's root. Provenance that a domain records only on the root is recorded from that flag.
 */
import type { Signature } from './signature.js';

export type Pattern<T> =
  | { readonly var: string }
  | { readonly const: number }
  | { readonly bindConst: string }
  | { readonly same: string }
  | OpPattern<T>;
export interface OpPattern<T> {
  readonly op: string;
  readonly args: readonly Pattern<T>[];
}

/**
 * A number a template constant has, or how to compute it from the bindings (with the variables it reads, so the
 * library can check well-formedness and name a counterexample).
 */
export type ConstantValue<T> =
  | number
  | { readonly compute: (bindings: Bindings<T>) => number; readonly reads: readonly string[] };

export type Template<T> =
  | { readonly var: string }
  | { readonly const: ConstantValue<T>; readonly attrs?: unknown }
  | { readonly op: string; readonly args: readonly Template<T>[]; readonly attrs?: unknown }
  | { readonly build: (bindings: Bindings<T>, node: T) => T };

/** What a pattern bound or a template read: a variable's name and the term it stands for. */
export type Bindings<T> = ReadonlyMap<string, T>;

/** How instantiation makes a node. The only hook into the domain besides the signature. */
export interface Builder<T> {
  /** A constant from a template's number; `attrs` is the template node's own (a domain may tag it). */
  constant(value: number, attrs: unknown, outermost: boolean): T;
  /** An operator applied to already-made children. */
  operator(op: string, args: readonly T[], attrs: unknown, outermost: boolean): T;
}

/**
 * Match `p` against `t`, extending `b`; false if it does not match (leaving `b` as it found it, except for the
 * bindings made before the failure, which the caller discards with the whole attempt).
 */
export function match<T>(
  sig: Signature<T>,
  p: Pattern<T>,
  t: T,
  b: Map<string, T>,
  equal: (a: T, b: T) => boolean = (x, y) => structuralEquality(sig, x, y),
): boolean {
  if ('var' in p) {
    b.set(p.var, t);
    return true;
  }
  if ('bindConst' in p) {
    if (sig.constant?.(t) === undefined) return false;
    b.set(p.bindConst, t);
    return true;
  }
  if ('const' in p) return sig.constant?.(t) === p.const;
  if ('same' in p) {
    const bound = b.get(p.same);
    return bound !== undefined && equal(bound, t);
  }
  if (sig.op(t) !== p.op) return false;
  const args = sig.args(t);
  if (args.length !== p.args.length) return false;
  for (let i = 0; i < args.length; i++) if (!match(sig, p.args[i], args[i], b, equal)) return false;
  return true;
}

const structuralEquality = <T>(sig: Signature<T>, a: T, b: T): boolean => {
  if (a === b) return true;
  if (sig.op(a) !== sig.op(b) || sig.constant?.(a) !== sig.constant?.(b)) return false;
  const x = sig.args(a),
    y = sig.args(b);
  return x.length === y.length && x.every((v, i) => structuralEquality(sig, v, y[i]));
};

/**
 * Build the template's term from the bindings. Children are made before their parent, left to right, and the
 * replacement's root is the last node made.
 */
export function instantiate<T>(tpl: Template<T>, b: Bindings<T>, build: Builder<T>, node?: T): T {
  const walk = (t: Template<T>, outermost: boolean): T => {
    if ('var' in t) {
      const bound = b.get(t.var);
      if (bound === undefined) throw new Error(`instantiate: ${t.var} is not bound`);
      return bound;
    }
    if ('const' in t)
      return build.constant(typeof t.const === 'number' ? t.const : t.const.compute(b), t.attrs, outermost);
    if ('build' in t) return t.build(b, node as T);
    return build.operator(
      t.op,
      t.args.map(a => walk(a, false)),
      t.attrs,
      outermost,
    );
  };
  return walk(tpl, true);
}

/** The variables a pattern binds (`var`, `bindConst`), in the order they appear, and the ones it repeats (`same`). */
export function patternVariables<T>(
  p: Pattern<T>,
  out: { binds: string[]; repeats: string[] } = { binds: [], repeats: [] },
): { binds: string[]; repeats: string[] } {
  if ('var' in p) out.binds.push(p.var);
  else if ('bindConst' in p) out.binds.push(p.bindConst);
  else if ('same' in p) out.repeats.push(p.same);
  else if ('op' in p) for (const a of p.args) patternVariables(a, out);
  return out;
}

/** The variables a template reads, in the order they appear (with repetition), and the constants it names. */
export function templateVariables<T>(
  t: Template<T>,
  out: { uses: string[]; constants: string[] } = { uses: [], constants: [] },
): { uses: string[]; constants: string[] } {
  if ('var' in t) out.uses.push(t.var);
  else if ('const' in t) {
    if (typeof t.const !== 'number') out.constants.push(...t.const.reads);
  } else if ('op' in t) for (const a of t.args) templateVariables(a, out);
  return out;
}

/** The operator a pattern's root names. */
export function patternOp<T>(p: Pattern<T>): string {
  if ('op' in p) return p.op;
  throw new Error('a rule pattern must be an operator over patterns');
}
