/**
 * IRWB-005 C5: testing the facts themselves. `typed.ranges` claims, for each statement and each i32 local, an
 * interval the local's value lies in just before the statement, on every execution. `rangesHold` runs cases on the
 * evaluator with the `observe` hook and checks every claim at every executed statement; a value outside its
 * interval is a violation, reported with the statement, the local, the value and the case.
 *
 * A fact is checked only where it says something: an interval other than the full i32 range. The analysis is meant
 * to hold for every input, not only the specified ones, so unconstrained cases are as valid a test as specified ones.
 *
 * `perturbRanges` makes a deliberately wrong fact (one interval at one block entry narrowed by one), so the checker's
 * own strength can be measured the way the gate's is: a checker that never reports a narrowed fact is weak.
 */
import type { DataflowResult } from '../framework/dataflow/analysis.js';
import { MAX, MIN, rangeView, type RangeView } from './analyses.js';
import { evaluate, type Case } from './evaluate.js';
import type { Store } from './model.js';

export interface RangeViolation {
  readonly fn: string;
  readonly stmt: string;
  readonly local: string;
  readonly value: number;
  readonly range: readonly [number, number];
  readonly case: number;
}
export interface RangesHoldResult {
  /** Case runs. */
  readonly runs: number;
  /** (statement, local) claims checked, counted once per execution. */
  readonly checked: number;
  /** Distinct (statement, local) claims that were exercised at least once. */
  readonly claims: number;
  readonly violations: readonly RangeViolation[];
  /** Distinct (statement, local) pairs violated. */
  readonly violated: number;
}

/** Check the range facts of `result` (typed.ranges on the revision `st` holds) on `cases`. */
export function rangesHold(
  st: Store,
  result: DataflowResult,
  cases: readonly Case[],
  opts: {
    limit?: number;
    maxViolations?: number;
    /** Check only this claim (a statement and a local's index), e.g. a deliberately narrowed one. */
    only?: { stmt: string; local: number };
    /** Stop after the first case with a violation. */
    stopAtFirst?: boolean;
  } = {},
): RangesHoldResult {
  const views = new Map<string, RangeView>();
  const view = (fn: string) => {
    let v = views.get(fn);
    if (!v) views.set(fn, (v = rangeView(result, st, fn)));
    return v;
  };
  // per function, the i32 locals (a fact about an f32 local is always the full range)
  const ints = new Map<string, number[]>();
  const intsOf = (fn: string) => {
    let xs = ints.get(fn);
    if (!xs) {
      const f = st.fn(fn);
      ints.set(fn, (xs = f.locals.map((l, i) => (l.type === 'f32' ? -1 : i)).filter(i => i >= 0)));
    }
    return xs;
  };
  const violations: RangeViolation[] = [],
    seen = new Set<string>(),
    bad = new Set<string>();
  let checked = 0,
    runs = 0;
  const max = opts.maxViolations ?? 20,
    only = opts.only;
  for (const c of cases) {
    if (opts.stopAtFirst && bad.size) break;
    runs++;
    evaluate(st, c.fn, c.args, c.memory, {
      limit: opts.limit ?? 2e4,
      observe(fn, sid, L) {
        if (only && sid !== only.stmt) return;
        const v = view(fn);
        for (const l of only ? [only.local] : intsOf(fn)) {
          const [lo, hi] = v.at(sid, l);
          if (lo === MIN && hi === MAX) continue;
          checked++;
          const key = `${sid}#${l}`;
          seen.add(key);
          const x = L[l];
          if (x < lo || x > hi) {
            bad.add(key);
            if (violations.length < max)
              violations.push({
                fn,
                stmt: sid,
                local: st.fn(fn).locals[l].name,
                value: x,
                range: [lo, hi],
                case: c.n,
              });
          }
        }
      },
    });
  }
  return { runs, checked, claims: seen.size, violations, violated: bad.size };
}

/**
 * The finite intervals of a ranges result at block entries, as perturbation sites: [function, block, local, lo, hi].
 * The claim a perturbation changes is checked at the block's first statement (`rangesHold(..., { only })`).
 */
export function rangeSites(result: DataflowResult): [string, string, string, number, number][] {
  const out: [string, string, string, number, number][] = [];
  for (const [fn, region] of Object.entries(result.regions))
    for (const [block, env] of Object.entries(
      (region.in ?? {}) as Record<string, Record<string, [number, number]>>,
    ))
      for (const [local, [lo, hi]] of Object.entries(env ?? {}))
        if (!(lo === MIN && hi === MAX) && lo < hi) out.push([fn, block, local, lo, hi]);
  return out;
}

/** A copy of `result` with one interval at one block entry narrowed by one at its upper (or lower) end. */
export function perturbRanges(
  result: DataflowResult,
  [fn, block, local, lo, hi]: [string, string, string, number, number],
  end: 'hi' | 'lo' = 'hi',
): DataflowResult {
  const copy = JSON.parse(JSON.stringify(result)) as DataflowResult;
  const env = (copy.regions[fn].in as Record<string, Record<string, [number, number]>>)[block];
  env[local] = end === 'hi' ? [lo, hi - 1] : [lo + 1, hi];
  return copy;
}
