import { solveFor } from '../flow/solve-for.js';
import { BOT, TOP, flatLattice, type Flat } from '../lattice/lattices.js';

/**
 * Find the greatest static subset of a finite candidate division. Congruence is a
 * monotone predicate under removal of candidates: an expression that needs a
 * dynamic operand must remain dynamic as more operands become dynamic.
 */
export function divide<K, Kind extends string>(
  candidates: ReadonlyMap<K, Kind>,
  congruent: (key: K, kind: Kind, bindingOf: (operand: K) => Kind | undefined) => boolean,
): ReadonlyMap<K, Kind> {
  const solved = solveFor<K, Flat<never>>(
    {
      lattice: flatLattice<never>(),
      rhs(key, get) {
        const kind = candidates.get(key)!;
        const compatible = congruent(key, kind, operand =>
          candidates.has(operand) && get(operand) === BOT ? candidates.get(operand) : undefined,
        );
        return compatible ? BOT : TOP;
      },
    },
    [...candidates.keys()],
    { evaluations: Infinity },
  );
  return new Map([...candidates].filter(([key]) => solved.values.get(key) === BOT));
}

interface Variant<P, E, H> {
  readonly point: P;
  readonly env: E;
  readonly handle: H;
}

type Policy<P, E, H> =
  | { readonly kind: 'refuse' }
  | { readonly kind: 'generalize'; env(point: P, env: E): E }
  | { readonly kind: 'fall-back'; target(point: P, env: E): H };

interface Unfolding<P, E, H> {
  project(point: P, env: E): string;
  allocate(point: P, env: E): H;
  snapshot(env: E): E;
  step(variant: Variant<P, E, H>, follow: (point: P, env: E) => H): void;
  readonly variants: number;
  readonly onExhaustion: Policy<P, E, H>;
}

/**
 * Intern before visiting so a residual loop can refer to its own label. A
 * generalized environment must cover the requested one and already have a
 * variant at that point. A fallback target must handle the requested
 * environment. The caller controls publication of residual code.
 */
export function unfold<P, E, H>(
  model: Unfolding<P, E, H>,
  entry: P,
  initial: E,
): { status: 'complete'; entry: H; variants: number } | { status: 'refused' } {
  const memo = new Map<P, Map<string, Variant<P, E, H>>>();
  const queue: Variant<P, E, H>[] = [];
  const exhausted = Symbol('variant budget');

  const follow = (point: P, env: E): H => {
    const variants = memo.get(point) ?? new Map<string, Variant<P, E, H>>();
    const key = model.project(point, env);
    const previous = variants.get(key);
    if (previous) return previous.handle;
    if (queue.length >= model.variants) {
      const policy = model.onExhaustion;
      if (policy.kind === 'fall-back') return policy.target(point, env);
      if (policy.kind === 'generalize') {
        const general = variants.get(model.project(point, policy.env(point, env)));
        if (general) return general.handle;
      }
      throw exhausted;
    }
    const variant = { point, env: model.snapshot(env), handle: model.allocate(point, env) };
    variants.set(key, variant);
    memo.set(point, variants);
    queue.push(variant);
    return variant.handle;
  };

  try {
    const handle = follow(entry, initial);
    for (const variant of queue) model.step(variant, follow);
    return { status: 'complete', entry: handle, variants: queue.length };
  } catch (error) {
    if (error !== exhausted) throw error;
    return { status: 'refused' };
  }
}
