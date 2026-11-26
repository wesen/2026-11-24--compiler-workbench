/**
 * fold's constant-folding cases as a rule table (IRWB-006, B1): one rule per operator. A folded constant is the
 * value the evaluator computes (`evalOp`: binop for i32, f32Op on bits for f32, rounded to nearest even), so it is
 * the value the program would compute. A division or remainder by zero, or of -2^31 by -1, is not folded, so the
 * program still traps (for rem(-2^31, -1), which does not trap, this is conservative). The f32 operators that round
 * in another direction (floor, ceil, trunc, the saturating conversions) are not folded. The three groups (eqz, f32,
 * i32) are disjoint by operator, so the rules are order-independent.
 */
import { F32_FOLDABLE, F32_OPERANDS, F32_RESULT } from '../f32.js';
import { VALUE_SIGNATURES } from '../ir.js';
import type { ValueOp } from '../model.js';
import { c, kv, op, rule, ruleSet, type Rule, type VarType } from './form.js';

/** fold's integer operators (passes.ts FOLDABLE), in its order. */
export const FOLD_I32: readonly ValueOp[] = [
  'add',
  'sub',
  'mul',
  'and',
  'or',
  'xor',
  'shl',
  'shr',
  'shru',
  'eq',
  'ne',
  'lt',
  'gt',
  'le',
  'ge',
  'ltu',
  'geu',
  'div',
  'rem',
];

const f32Rule = (o: ValueOp): Rule => {
  const arity = VALUE_SIGNATURES[o].args!.length,
    t: VarType = F32_OPERANDS.has(o) ? 'f32' : 'i32';
  const names = arity === 1 ? ['a'] : ['a', 'b'];
  return rule(
    `fold-${o}`,
    Object.fromEntries(names.map(n => [n, t])),
    op(o, ...names.map(kv)),
    c({ eval: o, args: names }, F32_RESULT.has(o) ? 'f32' : undefined),
    { because: 'args' },
  );
};
const i32Rule = (o: ValueOp): Rule =>
  rule(`fold-${o}`, { a: 'i32', b: 'i32' }, op(o, kv('a'), kv('b')), c({ eval: o, args: ['a', 'b'] }), {
    because: 'args',
    ...(o === 'div' || o === 'rem' ? { where: [{ noTrap: ['a', 'b'] as const, op: o }] } : {}),
  });

export const FOLD_RULES = ruleSet(
  'fold',
  'constant folding: an operator whose operands are constants becomes a constant',
  [
    rule('fold-eqz', { a: 'i32' }, op('eqz', kv('a')), c({ eval: 'eqz', args: ['a'] }), { because: 'args' }),
    ...[...F32_FOLDABLE].map(o => f32Rule(o as ValueOp)),
    ...FOLD_I32.map(i32Rule),
  ],
  { property: 'replacements are the evaluator’s own values (binop, f32Op); traps are kept' },
);
