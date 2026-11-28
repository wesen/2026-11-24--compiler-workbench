/** The library's rule shapes, shared by `terms.ts` and `verify.ts` (and structurally by both domains). */

/** An operator applied to sub-patterns; a rule's left-hand side is always one (a bare variable rewrites nothing). */
export interface OpPattern {
  readonly op: string;
  readonly args: readonly Pattern[];
}

/**
 * A pattern: what a rule's left-hand side may be. Structurally Typed's `Pat` (`src/typed/rules/form.ts`)
 * and any first-order pattern language with variables, constants, constant variables and repeats.
 */
export type Pattern =
  | { readonly var: string }
  | { readonly const: number }
  | { readonly constVar: string }
  | { readonly same: string }
  | OpPattern;

/**
 * A template: what a rule's right-hand side may be. `C` is the domain's description of a computed
 * constant (Typed: a number, `{log2 k}` or `{eval op, args}`; a plain number elsewhere).
 */
export type Template<C> =
  | { readonly var: string }
  | { readonly const: C; readonly type?: string }
  | { readonly op: string; readonly args: readonly Template<C>[] };

/**
 * A rule's right-hand side: a template over the pattern's variables, or — for a rule over binders, which the
 * library knows nothing of (an index substitution) — a domain function that builds the replacement from the
 * bindings and the matched term.
 */
export type Rhs<T, C> = Template<C> | ((b: ReadonlyMap<string, T>, matched: T) => T);

/** A rule over a signature: guards `G` are domain data; the library never interprets them. */
export interface TermRule<G, C = number, T = unknown> {
  readonly name: string;
  readonly version?: string;
  readonly lhs: OpPattern;
  readonly where?: readonly G[];
  readonly rhs: Rhs<T, C>;
}
