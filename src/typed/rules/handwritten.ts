/**
 * The hand-written bodies of `fold` and `simplify`, verbatim from src/typed/passes.ts at 420d8e1 (Compiler
 * Workbench's passes.js). They are the reference the rule tables (fold.ts, simplify.ts) are compared with: a test
 * runs both on the corpus and requires identical revisions, edit lists and correspondences.
 */
import { binop } from '../evaluate.js';
import { F32_FOLDABLE, F32_OPERANDS, F32_RESULT, f32Op } from '../f32.js';
import { SYMBOL } from '../listing.js';
import type { ValueRec } from '../model.js';
import type { Tx } from '../tx.js';

const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
const log2 = (n: number) => 31 - Math.clz32(n);
const FOLDABLE = new Set([
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
]);

export const foldBody = ({ tx }: { tx: Tx }) =>
  tx.rewrite(v => {
    if (v.op === 'eqz' && v.args[0].isConst)
      return tx.const(+(v.args[0].imm === 0), { because: [v.args[0]] });
    if (F32_FOLDABLE.has(v.op) && v.args.every(a => a.isConst)) {
      const [a, b] = v.args.map(x => x.imm as number);
      return tx.const(f32Op(v.op, a, b)!, {
        because: v.args,
        ...(F32_RESULT.has(v.op) ? { type: 'f32' as const } : {}),
      });
    }
    if (!FOLDABLE.has(v.op) || !v.args.every(a => a.isConst)) return;
    const [a, b] = v.args.map(x => x.imm as number);
    if ((v.op === 'div' || v.op === 'rem') && (b === 0 || (a === -2147483648 && b === -1))) return; // keep the trap
    return tx.const(binop(v.op, a, b), { because: v.args });
  });

export const simplifyBody = ({ tx }: { tx: Tx }) =>
  tx.rewrite(v => {
    if (F32_OPERANDS.has(v.op) || F32_RESULT.has(v.op)) return;
    const [a, b] = v.args,
      k = b && b.isConst ? (b.imm as number) : null,
      ka = a && a.isConst ? (a.imm as number) : null;
    const note = (text: string) => ({ because: v.args.filter(x => x.isConst), note: text });
    switch (v.op) {
      case 'add':
        if (k === 0) return a.id;
        if (ka === 0) return b.id;
        break;
      case 'sub':
        if (k === 0) return a.id;
        if (a.isPure && a.same(b)) return tx.const(0, note('x - x'));
        break;
      case 'mul':
        if (k === 1) return a.id;
        if (ka === 1) return b.id;
        if (k === 0 && a.isPure) return tx.const(0, note('x * 0'));
        if (ka === 0 && b.isPure) return tx.const(0, note('0 * x'));
        if (k !== null && isPow2(k))
          return tx.make('shl', a.id, tx.const(log2(k)), note(`x * ${k} = x << ${log2(k)}`));
        if (ka !== null && isPow2(ka))
          return tx.make('shl', b.id, tx.const(log2(ka)), note(`${ka} * x = x << ${log2(ka)}`));
        break;
      case 'div':
        if (k === 1) return a.id;
        break;
      case 'or':
      case 'xor':
      case 'shl':
      case 'shr':
      case 'shru':
        if (k === 0) return a.id;
        break;
      case 'and':
        if (k === 0 && a.isPure) return tx.const(0, note('x & 0'));
        if (k === -1) return a.id;
        break;
      case 'eqz': {
        const inner = a;
        const inv: Record<string, string> = {
          lt: 'ge',
          ge: 'lt',
          gt: 'le',
          le: 'gt',
          eq: 'ne',
          ne: 'eq',
          ltu: 'geu',
          geu: 'ltu',
        };
        if (inv[inner.op])
          return tx.make(inv[inner.op] as ValueRec['op'], inner.args[0].id, inner.args[1].id, {
            note: `!(${SYMBOL[inner.op]}) is ${SYMBOL[inv[inner.op]]}`,
          });
        if (inner.op === 'eqz' && inner.args[0].isBoolean) return inner.args[0].id;
        break;
      }
    }
  });
