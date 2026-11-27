/**
 * Bitwise identities with one operator fewer (IRWB-037-F), found by the shape census of executed code: SHA-256's
 * choice `(e & f) ^ (~e & g)` and majority `(a & b) ^ (a & c) ^ (b & c)`. Each result bit depends only on the same
 * bit of the operands, so the verifier proves them at width 1. The right sides read an operand twice or in
 * another order, so every operand must be pure.
 */
import { c, op, rule, ruleSet, same, v } from './form.js';

const XYZ = { x: 'i32', y: 'i32', z: 'i32' } as const;
const pure = [{ pure: 'x' }, { pure: 'y' }, { pure: 'z' }] as const;

export const BITWISE_RULES = ruleSet('bitwise', 'choice and majority with one operator fewer', [
  rule(
    'choice',
    XYZ,
    op('xor', op('and', v('x'), v('y')), op('and', op('xor', same('x'), c(-1)), v('z'))),
    op('xor', v('z'), op('and', v('x'), op('xor', v('y'), v('z')))),
    { where: [...pure], note: '(x & y) ^ (~x & z)' },
  ),
  rule(
    'majority',
    XYZ,
    op(
      'xor',
      op('xor', op('and', v('x'), v('y')), op('and', same('x'), v('z'))),
      op('and', same('y'), same('z')),
    ),
    op('or', op('and', v('x'), v('y')), op('and', v('z'), op('or', v('x'), v('y')))),
    { where: [...pure], note: '(x & y) ^ (x & z) ^ (y & z)' },
  ),
]);
