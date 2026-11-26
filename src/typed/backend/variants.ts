/**
 * Choosing, per function, among compilations with the IRWB-003 options (`chains`, `coalesce`, `homes`):
 * each is tried on top of the best so far, in that order, and kept only if the static cost estimate of the
 * finished code (frequency.ts) is lower. A tie keeps the variant without the option, so an option that changes
 * nothing leaves the function exactly as the default backend compiles it.
 *
 * Constant homes need two selections: the first records every constant built into a fresh register and the
 * frequency of its block; the keys whose uses add up to more than one execution per call get a home.
 */
import type { Store, WorkFn } from '../model.js';
import { blockFrequencies, estimateCost, type Frequencies } from './frequency.js';
import type { BackendOptions } from './options.js';

/** What one compilation of a function is asked to do beyond its options. */
export interface VariantHooks {
  /** Coalesce copies, ordering candidates by these frequencies. */
  readonly coalesce?: Frequencies;
  /** The constant homes to build. */
  readonly homes?: ReadonlySet<string>;
  /** Told of every constant built into a fresh register. */
  readonly onConst?: (key: string, block: string, value: string) => void;
}

export interface VariantChoice {
  readonly chains: boolean;
  readonly coalesce: boolean;
  readonly homes: readonly string[];
  /** The estimate of the plain compilation and of the chosen one. */
  readonly cost: { readonly plain: number; readonly chosen: number };
}

export function chooseVariant<C extends { fin: { code: readonly import('./encode.js').MInsn[] } }>(
  st: Store,
  f: WorkFn,
  o: BackendOptions,
  compile: (o: BackendOptions, hooks: VariantHooks) => C,
): { best: C; choice: VariantChoice } {
  const fr = blockFrequencies(st, f);
  const cost = (x: C) => estimateCost(x.fin.code, fr);
  const plain = { ...o, chains: false } as BackendOptions;
  let best = compile(plain, {}),
    opts = plain,
    hooks: VariantHooks = {};
  const plainCost = cost(best);
  let bestCost = plainCost;
  const consider = (o2: BackendOptions, h2: VariantHooks) => {
    const v = compile(o2, h2),
      c = cost(v);
    if (c < bestCost - 1e-9) {
      best = v;
      bestCost = c;
      opts = o2;
      hooks = h2;
    }
  };
  if (o.chains) consider({ ...plain, chains: true }, {});
  if (o.coalesce) consider(opts, { ...hooks, coalesce: fr });
  if (o.homes) {
    const uses = new Map<string, number>();
    compile(opts, {
      ...hooks,
      onConst: (k, b) => uses.set(k, (uses.get(k) ?? 0) + (fr.block.get(b) ?? 1)),
    });
    const chosen = new Set([...uses].filter(([, w]) => w > 1 + 1e-9).map(([k]) => k));
    if (chosen.size) consider(opts, { ...hooks, homes: chosen });
  }
  return {
    best,
    choice: {
      chains: !!opts.chains,
      coalesce: !!hooks.coalesce,
      homes: [...(hooks.homes ?? [])].sort(),
      cost: { plain: plainCost, chosen: bestCost },
    },
  };
}
