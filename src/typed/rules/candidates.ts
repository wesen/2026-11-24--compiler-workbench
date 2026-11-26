/**
 * Candidate rules for the verifier that no pass uses (IRWB-006, B2): rules that are wrong, each of which the
 * verifier must reject with a counterexample, and f32 rules that are right, which show what f32 evidence looks
 * like. The first unsound rule is the corpus's `div-to-shift`; the f32 ones are the four float rewrites IRWB-001
 * wrote as deliberately unsound passes, plus `x + (-0) → x`, which is false only for non-canonical NaNs.
 */
import { c, kv, op, rule, ruleSet, same, v } from './form.js';

const NEG_ZERO = -0x80000000; // the bits of -0
const F = { x: 'f32' } as const;

export const UNSOUND_CANDIDATES = ruleSet('unsound-candidates', 'rules the verifier must reject', [
  rule(
    'div-pow2-shr',
    { x: 'i32', k: 'i32' },
    op('div', v('x'), kv('k')),
    op('shr', v('x'), c({ log2: 'k' })),
    {
      where: [{ pow2: 'k' }],
      about: 'x / 2^j → x >> j: rounds toward -∞ for negative x (the corpus’s div-to-shift)',
    },
  ),
  rule('mul-zero-impure', { x: 'i32' }, op('mul', v('x'), c(0)), c(0), {
    about: 'x * 0 → 0 without pure(x): drops a subtree that may trap',
  }),
  rule('fadd-pos-zero', F, op('fadd', v('x'), c(0)), v('x'), { about: 'x + 0 → x: -0 + 0 is +0' }),
  rule('fmul-pos-zero', F, op('fmul', v('x'), c(0)), c(0, 'f32'), {
    where: [{ pure: 'x' }],
    about: 'x * 0 → 0: NaN * 0 and ∞ * 0 are NaN, -1 * 0 is -0',
  }),
  rule('fsub-self', F, op('fsub', v('x'), same('x')), c(0, 'f32'), {
    where: [{ pure: 'x' }],
    about: 'x - x → 0: ∞ - ∞ is NaN',
  }),
  rule('not-flt', { a: 'f32', b: 'f32' }, op('eqz', op('flt', v('a'), v('b'))), op('fge', v('a'), v('b')), {
    about: '!(a < b) → a >= b: both are false when a or b is NaN',
  }),
  rule('fadd-neg-zero', F, op('fadd', v('x'), c(NEG_ZERO)), v('x'), {
    about: 'x + (-0) → x: arithmetic returns the canonical NaN, so it fails for any other NaN',
  }),
]);

export const F32_SOUND_CANDIDATES = ruleSet('f32-candidates', 'f32 rules that hold on every bit pattern', [
  rule('fneg-fneg', F, op('fneg', op('fneg', v('x'))), v('x'), {
    about: '-(-x) → x: fneg flips the sign bit only, NaN payloads included',
  }),
  rule('fabs-fneg', F, op('fabs', op('fneg', v('x'))), op('fabs', v('x')), {
    about: '|-x| → |x|: both clear the sign bit',
  }),
]);
