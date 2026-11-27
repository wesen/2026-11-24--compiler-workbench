/**
 * Identities found from hot shapes (IRWB-037-G): rules written from the node patterns that `tools/missed.mjs` ranks
 * highest once `guards` has turned `x / 8` and `x % 16` into a shift and a mask, each verified (verify.ts; recorded
 * in evidence-identities.ts) and each measured to lower an instruction count on the corpus
 * (ttmp/…/IRWB-037-G…/scripts/16-rules-after-guards.mjs).
 *
 * They are a table of their own, run by the pass `identities` in `speed`: simplify's table is the book's and runs
 * before `guards`, where these shapes do not exist yet.
 *
 * Each rule is one instance of a family (`(x >> k) << k`, `(x & (2^(j+1) - 1)) < 2^j`, `(x << a) << b`). The family
 * cannot be written yet: a template number is a literal, `log2 k` or an operator over constant variables, so
 * `-1 << k` has no form. The instances are the ones the corpus runs.
 */
import { c, op, rule, ruleSet, v } from './form.js';

const X = { x: 'i32' } as const;

export const IDENTITY_RULES = ruleSet(
  'identities',
  'identities found from hot shapes: masks for shift pairs and for a bit test written as a comparison',
  [
    rule('shl-shr3-mask', X, op('shl', op('shr', v('x'), c(3)), c(3)), op('and', v('x'), c(-8)), {
      note: '(x >> 3) << 3 clears the low three bits',
    }),
    rule('lt-and15-8', X, op('lt', op('and', v('x'), c(15)), c(8)), op('eqz', op('and', v('x'), c(8))), {
      note: '(x & 15) < 8 says bit 3 is clear',
    }),
    rule('shl-shl-one', X, op('shl', op('shl', v('x'), c(1)), c(1)), op('shl', v('x'), c(2)), {
      note: '(x << 1) << 1',
    }),
  ],
  { property: 'every rule has one i32 variable and constant literals only' },
);
