/**
 * simplify's algebraic identities as a rule table (IRWB-006, B1). The order inside each root operator is the order
 * of the return sites of the hand-written pass (handwritten.ts), which the compiled visitor tries first to last.
 * Every rule is an i32 identity; none holds for f32 (x + 0 is not x for x = -0; x * 0 is not 0 for NaN or ∞;
 * x - x is not 0 for ∞; !(a < b) is not a >= b for NaN), and the f32 operators have their own names, so no rule
 * has an f32 root operator.
 */
import { c, COMPARE_INVERSE, inversionNote, kv, op, rule, ruleSet, same, v } from './form.js';

const X = { x: 'i32' } as const;
const zeroRight = (o: 'or' | 'xor' | 'shl' | 'shr' | 'shru') =>
  rule(`${o}-zero`, X, op(o, v('x'), c(0)), v('x'));

export const SIMPLIFY_RULES = ruleSet(
  'simplify',
  'algebraic identities: x+0, x*1, x*2^k, x-x, !!x, inverted comparisons and a low-bit hash',
  [
    rule('add-zero', X, op('add', v('x'), c(0)), v('x')),
    rule('zero-add', X, op('add', c(0), v('x')), v('x')),
    rule('sub-zero', X, op('sub', v('x'), c(0)), v('x')),
    rule('sub-self', X, op('sub', v('x'), same('x')), c(0), {
      where: [{ pure: 'x' }],
      because: 'const-args',
      note: 'x - x',
    }),
    rule('mul-one', X, op('mul', v('x'), c(1)), v('x')),
    rule('one-mul', X, op('mul', c(1), v('x')), v('x')),
    rule('mul-zero', X, op('mul', v('x'), c(0)), c(0), {
      where: [{ pure: 'x' }],
      because: 'const-args',
      note: 'x * 0',
    }),
    rule('zero-mul', X, op('mul', c(0), v('x')), c(0), {
      where: [{ pure: 'x' }],
      because: 'const-args',
      note: '0 * x',
    }),
    rule(
      'mul-pow2',
      { x: 'i32', k: 'i32' },
      op('mul', v('x'), kv('k')),
      op('shl', v('x'), c({ log2: 'k' })),
      {
        where: [{ pow2: 'k' }],
        because: 'const-args',
        note: 'x * {k} = x << {log2 k}',
      },
    ),
    rule(
      'pow2-mul',
      { k: 'i32', x: 'i32' },
      op('mul', kv('k'), v('x')),
      op('shl', v('x'), c({ log2: 'k' })),
      {
        where: [{ pow2: 'k' }],
        because: 'const-args',
        note: '{k} * x = x << {log2 k}',
      },
    ),
    rule('div-one', X, op('div', v('x'), c(1)), v('x')),
    zeroRight('or'),
    zeroRight('xor'),
    zeroRight('shl'),
    zeroRight('shr'),
    zeroRight('shru'),
    rule('and-zero', X, op('and', v('x'), c(0)), c(0), {
      where: [{ pure: 'x' }],
      because: 'const-args',
      note: 'x & 0',
    }),
    rule('and-ones', X, op('and', v('x'), c(-1)), v('x')),
    rule(
      'horner31-mask15',
      { a: 'i32', b: 'i32', c: 'i32' },
      op(
        'and',
        op('add', op('mul', op('add', op('mul', v('a'), c(31)), v('b')), c(31)), v('c')),
        c(15),
      ),
      op('and', op('add', op('sub', v('a'), v('b')), v('c')), c(15)),
      { note: 'horner31-mask15: 31 ≡ −1 modulo 16' },
    ),
    ...COMPARE_INVERSE.map(([a, b]) =>
      rule(`not-${a}`, { a: 'i32', b: 'i32' }, op('eqz', op(a, v('a'), v('b'))), op(b, v('a'), v('b')), {
        note: inversionNote(a, b),
      }),
    ),
    rule('not-not', { x: 'bool' }, op('eqz', op('eqz', v('x'))), v('x'), { where: [{ boolean: 'x' }] }),
  ],
  { property: 'no rule has an f32 root operator (simplify leaves f32 operators alone)' },
);
