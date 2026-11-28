/**
 * Rule verification by evaluation on generated cases (IRWB-039's library row `terms`; Alive-style
 * validation), stated in its standard terms: a rule L → R with side conditions G is validated by
 * evaluating both sides on generated assignments to its variables and comparing the outcomes; a
 * disagreement is a counterexample that refutes the rule.
 *
 * The division of labour: the **domain supplies the semantics** — for each variable the values it
 * takes, the meaning of the side conditions, the value of each side on an assignment, and when two
 * outcomes agree (a value, or a trap, as the domain's meaning says) — and the **library owns the
 * campaigns** and their order: exhaustive enumeration over the variables' domains, the crossing of
 * boundary (or special) value sets followed by random sampling, and the full-width enumeration with
 * at most one unbounded variable. `w`, the campaigns' level parameter, is the domain's to define
 * (Typed: a bit width; a domain without widths ignores it).
 *
 * The seeded generator (`Rng`) is part of the interface: a domain's recorded evidence must reproduce.
 */
import { patternVars, templateVars } from './terms.js';
import type { Pattern, Template, TermRule } from './types.js';

/** Typed's generator (verify.ts), moved verbatim: xorshift32, seeded, first value usable. */
export class Rng {
  constructor(private s: number) {
    if (!this.s) this.s = 0x2545f491;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (this.s = x | 0);
  }
}

/** One variable of the rule, and the values generated for it. */
export interface CaseVar<V> {
  readonly name: string;
  /** The values the variable takes when cases are enumerated, or null: every value of the level's width. */
  domain(w: number): readonly V[] | null;
  /** The boundary (or special) values crossed before random sampling. */
  values(w: number): readonly V[];
  /** One random draw at the level. */
  draw(w: number, rng: Rng): V;
  /**
   * The value at index i of the unbounded range at level w — `exhaustiveCases`' inner loop. A domain whose
   * values are not the indices (Typed's are sign-extended) supplies this; default: the index itself.
   */
  ofIndex?(i: number, w: number): V;
}

/** The semantics of a rule's cases: what the domain supplies, everything the campaigns need. */
export interface CaseSemantics<V, O> {
  readonly variables: readonly CaseVar<V>[];
  /** Do the rule's side conditions hold on this assignment? (A case that fails is not counted.) */
  holds(env: readonly V[], w: number): boolean;
  /** The outcome of the rule's left-hand side on an assignment. */
  lhs(env: readonly V[], w: number): O;
  /** The outcome of the rule's right-hand side on the same assignment. */
  rhs(env: readonly V[], w: number): O;
  /** Do the two outcomes agree, as the domain's meaning says (a value, or a trap)? */
  agree(l: O, r: O, w: number): boolean;
}

export interface Counterexample<V, O> {
  readonly env: readonly V[];
  readonly lhs: O;
  readonly rhs: O;
  readonly w: number;
}

export interface CaseResult<V, O> {
  readonly verdict: 'pass' | 'fail';
  readonly cases: number;
  readonly counterexample?: Counterexample<V, O>;
}

/** The product of the domains, in the variables' order (the last variable varies fastest). */
function product<V>(doms: readonly (readonly V[])[]): V[][] {
  let out: V[][] = [[]];
  for (const d of doms) out = out.flatMap(p => d.map(x => [...p, x]));
  return out;
}

/** Every case in the product of the variables' domains (all must be given), side conditions first. */
export function enumerateCases<V, O>(sem: CaseSemantics<V, O>, w: number): CaseResult<V, O> {
  const doms = sem.variables.map(x => x.domain(w));
  if (doms.some(d => d === null))
    throw new Error('term.enumerateCases: a variable has no enumerable domain at this width');
  let cases = 0;
  for (const env of product(doms as readonly (readonly V[])[])) {
    if (!sem.holds(env, w)) continue;
    cases++;
    const l = sem.lhs(env, w),
      r = sem.rhs(env, w);
    if (!sem.agree(l, r, w)) return { verdict: 'fail', cases, counterexample: { env, lhs: l, rhs: r, w } };
  }
  return { verdict: 'pass', cases };
}

/**
 * The boundary sets crossed — every combination while their product fits `cross` (default 200000),
 * else that many random picks from them — and then `random` random draws. Side conditions are checked
 * before a case is counted, in both loops.
 */
export function sampleCases<V, O>(
  sem: CaseSemantics<V, O>,
  w: number,
  opts: { readonly cross?: number; readonly random: number; readonly seed?: number },
): CaseResult<V, O> {
  const rng = new Rng(opts.seed ?? 7);
  const values = sem.variables.map(x => x.values(w));
  const crossed = values.reduce((n, vs) => n * vs.length, 1);
  const cap = opts.cross ?? 200000;
  let cases = 0,
    failed: Counterexample<V, O> | undefined;
  const test = (env: readonly V[]): boolean => {
    if (!sem.holds(env, w)) return true;
    cases++;
    const l = sem.lhs(env, w),
      r = sem.rhs(env, w);
    if (!sem.agree(l, r, w)) {
      failed = { env, lhs: l, rhs: r, w };
      return false;
    }
    return true;
  };
  if (crossed <= cap) {
    for (const env of product(values))
      if (!test(env)) return { verdict: 'fail', cases, counterexample: failed };
  } else
    for (let i = 0; i < cap; i++) {
      const env = values.map(vs => vs[(rng.next() >>> 0) % vs.length]);
      if (!test(env)) return { verdict: 'fail', cases, counterexample: failed };
    }
  for (let i = 0; i < opts.random; i++) {
    const env = sem.variables.map(x => x.draw(w, rng));
    if (!test(env)) return { verdict: 'fail', cases, counterexample: failed };
  }
  return { verdict: 'pass', cases };
}

/**
 * The full-width enumeration: the product of the bounded domains, with the one unbounded variable
 * (at most one; `domain` null) enumerated as the inner loop over every value of the width. Cases are
 * counted per bounded combination, not per inner value; side conditions are checked only when there
 * is no unbounded variable, as the bounded domains then fix every input a condition could read.
 */
export function exhaustiveCases<V, O>(sem: CaseSemantics<V, O>, w: number): CaseResult<V, O> {
  const vars = sem.variables;
  const full = vars.findIndex(x => x.domain(w) === null);
  const doms = vars.map(x => x.domain(w));
  const rest = product(doms.map((d, i) => (i === full ? ([0 as unknown as V] as readonly V[]) : d!)));
  const env = new Array<V>(vars.length).fill(0 as unknown as V);
  let cases = 0;
  for (const fixed of rest) {
    for (let i = 0; i < vars.length; i++) env[i] = fixed[i];
    if (full < 0) {
      if (!sem.holds(env, w)) continue;
      cases++;
      const l = sem.lhs(env, w),
        r = sem.rhs(env, w);
      if (!sem.agree(l, r, w))
        return { verdict: 'fail', cases, counterexample: { env: [...env], lhs: l, rhs: r, w } };
      continue;
    }
    for (let x = 0; x < 2 ** w; x++) {
      env[full] = vars[full].ofIndex?.(x, w) ?? (x as unknown as V);
      const l = sem.lhs(env, w),
        r = sem.rhs(env, w);
      if (!sem.agree(l, r, w))
        return {
          verdict: 'fail',
          cases: cases + x,
          counterexample: { env: [...env], lhs: l, rhs: r, w },
        };
    }
    cases += 2 ** w;
  }
  return { verdict: 'pass', cases };
}

// ---------- the rule-level entry: a rule, an interpretation, a case generator ----------
/** An interpretation of an operator signature: the standard structure that makes terms have values. */
export interface Interpretation<V> {
  /** The value of a pattern's constant in the domain. */
  literal(n: number): V;
  /** The value of an operator on its arguments' values. */
  value(op: string, args: readonly V[]): V;
}

/** The generated values of one variable: enumerated, crossed, and drawn. */
export interface CaseSet<V> {
  /** Every value the variable takes, or null: the campaign's own full range. */
  readonly domain: readonly V[] | null;
  /** The boundary (or special) values crossed before random sampling. */
  readonly values: readonly V[];
  draw(rng: Rng): V;
}

/** A rule, its interpretation, its side conditions, and the cases generated for its variables. */
export interface RuleSemantics<V> {
  readonly interpretation: Interpretation<V>;
  /** The generated values of each variable the pattern binds. */
  readonly cases: Readonly<Record<string, CaseSet<V>>>;
  /** Does a side condition hold on an assignment (by variable name)? Default: nothing to check. */
  holds?(g: unknown, env: Readonly<Record<string, V>>): boolean;
  /** Do the two outcomes agree? Default: the domain's equality on the values. */
  agree?(l: V, r: V): boolean;
}

export interface RuleVerdict<V> {
  readonly rule: string;
  readonly verdict: 'sound' | 'unsound';
  /** The campaigns that ran, in order, with their case counts. */
  readonly methods: readonly {
    readonly method: string;
    readonly verdict: 'pass' | 'fail';
    readonly cases: number;
  }[];
  readonly counterexample?: {
    readonly bindings: Readonly<Record<string, V>>;
    readonly lhs: V;
    readonly rhs: V;
  };
  readonly reason?: string;
}

/**
 * Validate one rule by evaluation on generated cases: the pattern's variables get their values from
 * the case generator, both sides are evaluated under the interpretation, and every assignment on
 * which the side conditions hold must give agreeing outcomes. Cases are enumerated exhaustively
 * while the product of the enumerated domains fits `enumerate` (default 2^16, the size at which a
 * crossing loop is still a complete check rather than a sampled one), then sampled (`random` draws,
 * default 1e5, seeded). A rule whose template uses a variable the pattern does not bind is refused
 * before any case is run.
 */
export function verifyRule<V>(
  rule: TermRule<unknown, number>,
  sem: RuleSemantics<V>,
  opts: { readonly enumerate?: number; readonly random?: number; readonly seed?: number } = {},
): RuleVerdict<V> {
  if (typeof rule.rhs === 'function')
    return {
      rule: rule.name,
      verdict: 'unsound',
      methods: [],
      reason:
        "the rule-level entry verifies template right-hand sides only; a rule over binders is the domain's to check",
    };
  const { binds } = patternVars(rule.lhs);
  const { uses, consts } = templateVars<number>(rule.rhs);
  const unbound = [...uses, ...consts].filter(x => !binds.includes(x));
  if (unbound.length)
    return {
      rule: rule.name,
      verdict: 'unsound',
      methods: [],
      reason: `the replacement uses ${[...new Set(unbound)].join(', ')}, which the pattern does not bind`,
    };
  const slot = new Map(binds.map((name, i) => [name, i]));
  const evalPattern = (p: Pattern): ((env: readonly V[]) => V) => {
    if ('var' in p || 'constVar' in p || 'same' in p) {
      const i = slot.get('var' in p ? p.var : 'constVar' in p ? p.constVar : p.same)!;
      return env => env[i];
    }
    if ('const' in p) {
      const v = sem.interpretation.literal(p.const);
      return () => v;
    }
    const kids = p.args.map(evalPattern);
    return env =>
      sem.interpretation.value(
        p.op,
        kids.map(k => k(env)),
      );
  };
  const evalTemplate = (t: Template<number>): ((env: readonly V[]) => V) => {
    if ('var' in t) {
      const i = slot.get(t.var)!;
      return env => env[i];
    }
    if ('const' in t) {
      const v = sem.interpretation.literal(t.const);
      return () => v;
    }
    const kids = t.args.map(evalTemplate);
    return env =>
      sem.interpretation.value(
        t.op,
        kids.map(k => k(env)),
      );
  };
  const L = evalPattern(rule.lhs),
    R = evalTemplate(rule.rhs);
  const agree = sem.agree ?? ((l: V, r: V) => l === r);
  const byName = (env: readonly V[]) => Object.fromEntries(binds.map((name, i) => [name, env[i]]));
  const campaigns: CaseSemantics<V, V> = {
    variables: binds.map(name => {
      const set = sem.cases[name];
      if (!set) throw new Error(`term.verifyRule: no cases for ${name}`);
      return {
        name,
        domain: () => set.domain,
        values: () => set.values,
        draw: (_w, rng) => set.draw(rng),
      };
    }),
    holds: (env, _w) => (rule.where ?? []).every(g => sem.holds?.(g, byName(env)) ?? true),
    lhs: (env, _w) => L(env),
    rhs: (env, _w) => R(env),
    agree: (l, r, _w) => agree(l, r),
  };
  const methods: { method: string; verdict: 'pass' | 'fail'; cases: number }[] = [];
  const fail = (r: CaseResult<V, V>): RuleVerdict<V> => ({
    rule: rule.name,
    verdict: 'unsound',
    methods,
    counterexample: {
      bindings: byName(r.counterexample!.env),
      lhs: r.counterexample!.lhs,
      rhs: r.counterexample!.rhs,
    },
  });
  const enumerated = campaigns.variables.every(x => x.domain(0) !== null);
  const total = campaigns.variables.reduce((n, x) => n * (x.domain(0)?.length ?? 0), 1);
  if (enumerated && total <= (opts.enumerate ?? 2 ** 16)) {
    const r = enumerateCases(campaigns, 0);
    methods.push({ method: 'exhaustive', verdict: r.verdict, cases: r.cases });
    if (r.verdict === 'fail') return fail(r);
  }
  const s = sampleCases(campaigns, 0, {
    random: opts.random ?? 1e5,
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
  });
  methods.push({ method: 'sampled', verdict: s.verdict, cases: s.cases });
  if (s.verdict === 'fail') return fail(s);
  return { rule: rule.name, verdict: 'sound', methods };
}
