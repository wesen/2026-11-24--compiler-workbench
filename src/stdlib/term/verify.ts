/**
 * Rule verification: a rule L → R with guards G claims that, for every assignment of values to its variables that
 * satisfies G, R has the same outcome as L. This module is the Alive-style half of that check (Alive, PLDI 2015:
 * a rewrite rule is validated by evaluating both sides on generated inputs and reporting a counterexample when they
 * disagree), stated over a domain's terms, its semantics and its case generator. The half that is a *proof* (a
 * side condition on effects and types, a normal form, a reduced-width exhaustive argument) is the domain's, because
 * it is an argument about the domain's operators and widths.
 *
 *   cases()      the assignments to try, and their order; the generator owns it (boundary values crossed, then
 *                seeded random draws, or an enumeration over a small domain)
 *   holds()      the domain's guards, on one assignment
 *   evaluate()   one side of the rule under an assignment, in the domain's value algebra; a trap is the domain's
 *                own marker value, since only the domain knows what a trap is
 *   agrees()     whether two outcomes agree
 *
 * The library owns the loop, the case count, the guard filter and the counterexample: the first assignment on which
 * the two sides disagree, with its bindings. It also checks the one law the interface can check: the generator's
 * variables are the rule's pattern variables, in order, so an assignment's slots name the rule's names and a
 * counterexample can be read.
 */
import { patternVariables, type Bindings } from './pattern.js';
import type { Rule } from './rules.js';

/** The assignments to try for a rule, in the order their generator yields them. */
export interface CaseGenerator<V> {
  /** The rule's pattern variables, in slot order (the library checks this against the rule). */
  readonly variables: readonly string[];
  cases(): Iterable<readonly V[]>;
  /** Whether the rule's guards hold on an assignment; absent: they always do. */
  holds?(assignment: readonly V[]): boolean;
}

/** The domain's value algebra, for the two sides of a rule. */
export interface RuleSemantics<V> {
  evaluate(side: 'lhs' | 'rhs', assignment: readonly V[]): V;
  agrees(left: V, right: V): boolean;
}

export interface Counterexample<V> {
  readonly bindings: Bindings<V>;
  readonly lhs: V;
  readonly rhs: V;
}

export interface RuleVerdict<V> {
  readonly verdict: 'sound' | 'unsound';
  /** How many assignments were evaluated (those on which the guards held). */
  readonly cases: number;
  readonly variables: readonly string[];
  readonly counterexample?: Counterexample<V>;
}

export interface VerifyModel<T, V, G = unknown> {
  readonly rule: Rule<T, G>;
  readonly cases: CaseGenerator<V>;
  readonly semantics: RuleSemantics<V>;
}

export function verifyRule<T, V, G = unknown>(model: VerifyModel<T, V, G>): RuleVerdict<V> {
  const { rule, cases, semantics } = model;
  const variables = patternVariables(rule.lhs).binds;
  if (cases.variables.length !== variables.length || cases.variables.some((x, i) => x !== variables[i]))
    throw new Error(
      `verifyRule(${rule.name}): the case generator's variables [${cases.variables.join(', ')}] are not the rule's ` +
        `pattern variables [${variables.join(', ')}], in order`,
    );
  let tried = 0;
  for (const assignment of cases.cases()) {
    if (assignment.length !== variables.length)
      throw new Error(
        `verifyRule(${rule.name}): an assignment has ${assignment.length} values for ${variables.length} variables`,
      );
    if (cases.holds && !cases.holds(assignment)) continue;
    tried++;
    const left = semantics.evaluate('lhs', assignment),
      right = semantics.evaluate('rhs', assignment);
    if (!semantics.agrees(left, right))
      return {
        verdict: 'unsound',
        cases: tried,
        variables,
        counterexample: { bindings: bindingsOf(variables, assignment), lhs: left, rhs: right },
      };
  }
  return { verdict: 'sound', cases: tried, variables };
}

/** An assignment as the named bindings a report and an error print. */
export function bindingsOf<V>(variables: readonly string[], assignment: readonly V[]): Bindings<V> {
  return new Map(variables.map((v, i) => [v, assignment[i]]));
}
