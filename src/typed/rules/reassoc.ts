/**
 * Reassociation of constants (IRWB-037-F): i32 identities that move a constant outwards, so that the backend can
 * fold it into a load or store offset (it folds the outermost `+ c` of an address) or into another constant.
 * They are linear identities over Z/2^32, proved by the verifier's symbolic-linear method. Found from the hot
 * statements of lz-roundtrip after bcm: `caddr(input, ((p + 1) + -1)) + 2` and `input + ((p + 2) << 1)`.
 */
import { c, kv, op, rule, ruleSet, v } from './form.js';

export const REASSOC_RULES = ruleSet('reassoc', 'constants move outwards: (x+a)+b, (x+a)<<k and y+(x+c)', [
  rule(
    'add-add-const',
    { x: 'i32', a: 'i32', b: 'i32' },
    op('add', op('add', v('x'), kv('a')), kv('b')),
    op('add', v('x'), c({ eval: 'add', args: ['a', 'b'] })),
    { note: '(x + {a}) + {b}' },
  ),
  rule(
    'shl-add-const',
    { x: 'i32', a: 'i32', k: 'i32' },
    op('shl', op('add', v('x'), kv('a')), kv('k')),
    op('add', op('shl', v('x'), v('k')), c({ eval: 'shl', args: ['a', 'k'] })),
    { note: '(x + {a}) << {k}' },
  ),
  rule(
    'add-inner-const',
    { y: 'i32', x: 'i32', c: 'i32' },
    op('add', v('y'), op('add', v('x'), kv('c'))),
    op('add', op('add', v('y'), v('x')), v('c')),
    { note: 'y + (x + {c})' },
  ),
]);
