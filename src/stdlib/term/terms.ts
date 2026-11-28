/**
 * Terms over a signature (IRWB-039's library row `terms`; the v7 design's C7): the domain-independent
 * part of first-order term rewriting, stated in its standard terms.
 *
 * A **signature** tells the library how to read a domain's terms without knowing their types: the root
 * operator, the ordered children, and (for pattern matching) whether a term is a constant and with
 * what value. Everything that carries meaning stays with the domain: guards are domain data (`TermRule`
 * is generic in `G`), the value of a template's computed constant is a domain callback, and building
 * a term goes through a `Build` callback object — Typed builds through its transaction (`Tx`, which
 * allocates ids and records provenance), Tix through object literals, so building is a callback, not
 * a signature method. Structural hash and equality are the library's, from the same reads (`op`,
 * `attr`, `args`); a domain whose equality needs more than the signature can see (Typed's `sameTree`
 * compares a type the value handle does not expose) declares its own `equal`.
 *
 * The framework's older rewrite engine (`src/framework/ir/patterns.ts`, `rewrites.ts`) is not this
 * module's basis: its unit of work is a transaction on the projection, while a rule engine must run
 * inside a domain's own transaction, many applications per pass, and report steps — a different
 * interface (the R3 review's reason), and no compiler uses it.
 */
import type { Pattern, Template, TermRule } from './types.js';

export type { Pattern, Template, TermRule };

/** How to read a domain's terms without knowing their types. */
export interface Signature<T> {
  /** The root operator ('add', 'load:x', 'reduce:sum', …). */
  op(t: T): string;
  /** The ordered children (a reduction's child is its body; a load's indices are attributes, not children). */
  args(t: T): readonly T[];
  /** The term's constant value, if it is one; undefined for any other term. */
  constant?(t: T): number | undefined;
  /**
   * The term's own data beyond operator and children, as comparable text: an immediate, a name, a
   * reduction's axes. Structural hash and equality compare it; pattern matching does not (a pattern
   * states operator and children, and side conditions carry the rest).
   */
  attr?(t: T): string;
  /** The domain's structural equality for `{same}` repeats; absent: the library's `structuralEqual`. */
  equal?(a: T, b: T): boolean;
}

/** The bindings of one match, from the pattern's left-most variable onwards. */
export type Bindings<T> = ReadonlyMap<string, T>;

/** Match `p` against `t`, extending `b`; false if it does not match. */
export function match<T>(sig: Signature<T>, p: Pattern, t: T, b: Map<string, T>): boolean {
  if ('op' in p) {
    if (sig.op(t) !== p.op) return false;
    const args = sig.args(t);
    if (args.length !== p.args.length) return false;
    for (let i = 0; i < args.length; i++) if (!match(sig, p.args[i], args[i], b)) return false;
    return true;
  }
  if ('var' in p) {
    b.set(p.var, t);
    return true;
  }
  if ('constVar' in p) {
    if (sig.constant?.(t) === undefined) return false;
    b.set(p.constVar, t);
    return true;
  }
  if ('const' in p) return sig.constant?.(t) === p.const;
  // the one shape left is the repeat: the domain's (or the library's) structural equality
  const existing = b.get((p as { readonly same: string }).same)!;
  return sig.equal ? sig.equal(t, existing) : structuralEqual(sig, t, existing);
}

/** Rules indexed by the operator of their pattern's root, tried in table order. */
export type RuleIndex<G, C, T> = ReadonlyMap<string, readonly TermRule<G, C, T>[]>;

export function indexRules<G, C, T = unknown>(
  rules: readonly TermRule<G, C, T>[],
): Map<string, TermRule<G, C, T>[]> {
  const index = new Map<string, TermRule<G, C, T>[]>();
  for (const r of rules) {
    const list = index.get(r.lhs.op);
    if (list) list.push(r);
    else index.set(r.lhs.op, [r]);
  }
  return index;
}

export interface RuleMatch<T, G, C> {
  readonly rule: TermRule<G, C, T>;
  readonly bindings: Bindings<T>;
}

/**
 * The first rule that rewrites `t`, with its bindings, or undefined. `holds` evaluates a rule's
 * guards; it receives the bindings and the matched term, because a side condition may read the
 * matched node itself (Tix's "exactly one axis, a `dim` extent").
 */
export function firstMatch<T, G, C = number>(
  index: RuleIndex<G, C, T>,
  sig: Signature<T>,
  t: T,
  holds: (g: G, b: Bindings<T>, t: T) => boolean,
): RuleMatch<T, G, C> | undefined {
  const list = index.get(sig.op(t));
  if (!list) return undefined;
  for (const r of list) {
    const b = new Map<string, T>();
    if (!match(sig, r.lhs, t, b)) continue;
    if (r.where && !r.where.every(g => holds(g, b, t))) continue;
    return { rule: r, bindings: b };
  }
  return undefined;
}

/** How a domain builds the terms a template stands for (`B` may differ from `T`: Typed builds ids). */
export interface Build<T, C, B> {
  /** The replacement of a variable bound to `t`. */
  ref(t: T): B;
  /** The value of a computed constant, from the domain's description `C` and the bindings. */
  value(c: C, b: Bindings<T>): number;
  /** Build a constant leaf of the computed value (the template's declared type, if it has one). */
  constant(value: number, root: boolean, type?: string): B;
  /** Build an operator node over already-built children. */
  make(op: string, args: readonly B[], root: boolean): B;
}

/**
 * Instantiate a template: children first, left to right, then the node — the order Typed's id
 * allocation requires (ids must not change), and the natural order of any bottom-up build.
 */
export function instantiate<T, C, B>(
  tpl: Template<C>,
  b: Bindings<T>,
  build: Build<T, C, B>,
  root = true,
): B {
  if ('var' in tpl) return build.ref(b.get(tpl.var)!);
  if ('const' in tpl) return build.constant(build.value(tpl.const, b), root, tpl.type);
  return build.make(
    tpl.op,
    tpl.args.map(a => instantiate(a, b, build, false)),
    root,
  );
}

// ---------- structural hash and equality ----------
const own = <T>(sig: Signature<T>, t: T): string => sig.attr?.(t) ?? String(sig.constant?.(t) ?? '');

/** A canonical text of the term's shape: operator, own data, children in order. */
export function structuralHash<T>(sig: Signature<T>, t: T): string {
  const args = sig.args(t);
  return `${sig.op(t)} ${own(sig, t)}(${args.map(a => structuralHash(sig, a)).join(',')})`;
}

/** Structural equality: same operator, same own data, equal children in order. */
export function structuralEqual<T>(sig: Signature<T>, a: T, b: T): boolean {
  if (sig.op(a) !== sig.op(b) || own(sig, a) !== own(sig, b)) return false;
  const as = sig.args(a),
    bs = sig.args(b);
  if (as.length !== bs.length) return false;
  for (let i = 0; i < as.length; i++) if (!structuralEqual(sig, as[i], bs[i])) return false;
  return true;
}

// ---------- well-formedness queries ----------
/** The variables a pattern binds (var, constVar), in left-to-right order, and the repeats (same). */
export function patternVars(
  p: Pattern,
  out: { binds: string[]; repeats: string[] } = { binds: [], repeats: [] },
) {
  if ('var' in p) out.binds.push(p.var);
  else if ('constVar' in p) out.binds.push(p.constVar);
  else if ('same' in p) out.repeats.push(p.same);
  else if ('op' in p) for (const a of p.args) patternVars(a, out);
  return out;
}
/** The variables a template uses, in left-to-right order (with repetition), and the constants it reads. */
export function templateVars<C>(
  t: Template<C>,
  out: { uses: string[]; consts: string[] } = { uses: [], consts: [] },
) {
  if ('var' in t) out.uses.push(t.var);
  else if ('const' in t) {
    const n = t.const as unknown;
    if (typeof n === 'object' && n !== null) {
      if ('log2' in n) out.consts.push((n as { readonly log2: string }).log2);
      else out.consts.push(...(n as { readonly args: readonly string[] }).args);
    }
  } else for (const a of t.args) templateVars(a, out);
  return out;
}
