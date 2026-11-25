/**
 * Instruction selection: tile each statement's value tree, largest tile first, onto virtual registers.
 *
 *   x + c, c fits 12 bits        addi                      load32[x + c]     lw with the offset folded in
 *   x * 2^k                      slli                      i < n -> branch   fused: blt i, n, ...
 *   x / c, c a constant          mulh and shifts (divmagic), or a shift for a power of two
 *   a / b                        div behind the zero and overflow tests (dropped when ranges prove them)
 *   f(x, y)                      moves to a0, a1, jal ra, a move from a0
 *   a constant that does not fit lui and addi
 *
 * Assignments are target-directed: `s = s + x` computes straight into `s`'s register. Locals that are live on
 * entry, other than parameters, are zeroed, because the language zero-initializes and the IR may read a local
 * before an assignment on some path. A port of Compiler Workbench's backend.js `select`.
 */
import { MAX, MIN, type LiveView, type RangeView } from '../analyses.js';
import { COMPARE } from '../listing.js';
import type { StmtRec, Store, ValueRec, WorkFn } from '../model.js';
import type { BackendOptions } from './options.js';
import { fail } from './errors.js';
import { A0, INVERT, ZERO, divisionMagic, fits12, log2, type MInsn } from './encode.js';

export interface Selection {
  readonly code: MInsn[];
  /** The virtual register of each local. */
  readonly localReg: readonly number[];
  /** Allocation hints: a parameter prefers its argument register, a returned value a0. */
  readonly hints: Map<number, number>;
  /** How many virtual registers were made. */
  readonly vregs: number;
}

export interface SelectContext {
  readonly st: Store;
  readonly f: WorkFn;
  readonly o: BackendOptions;
  /** Liveness of the function (for the locals live into the entry block). */
  readonly live: LiveView;
  /** Ranges of the function, when `useRanges` is on (to drop division checks). */
  readonly ranges: RangeView | null;
}

type Fields = Omit<MInsn, 'op' | 'covers'>;
const FUSE: Readonly<Record<string, readonly [string, number]>> = {
  lt: ['blt', 0],
  ge: ['bge', 0],
  gt: ['blt', 1],
  le: ['bge', 1],
  ltu: ['bltu', 0],
  geu: ['bgeu', 0],
  gtu: ['bltu', 1],
  leu: ['bgeu', 1],
  eq: ['beq', 0],
  ne: ['bne', 0],
};
const IMMEDIATE: Readonly<Record<string, string>> = { add: 'addi', and: 'andi', or: 'ori', xor: 'xori' };
const SHIFT_IMMEDIATE: Readonly<Record<string, string>> = { shl: 'slli', shr: 'srai', shru: 'srli' };
const REGISTER: Readonly<Record<string, string>> = {
  add: 'add',
  sub: 'sub',
  mul: 'mul',
  and: 'and',
  or: 'or',
  xor: 'xor',
  shl: 'sll',
  shr: 'sra',
  shru: 'srl',
};

export function select({ st, f, o, live, ranges }: SelectContext): Selection {
  const code: MInsn[] = [];
  let nv = 64,
    stmt: string | null = null;
  const fresh = () => nv++;
  const localReg = f.locals.map(() => fresh());
  const hints = new Map<number, number>();
  const emit = (op: string, fields: Fields = {}, value?: string): void => {
    code.push({ op, ...fields, covers: [value, stmt].filter((x): x is string => !!x) });
  };
  const li = (rd: number, c: number, v: string): void => {
    c |= 0;
    if (fits12(c)) return emit('addi', { rd, rs1: ZERO, imm: c }, v);
    const hi = ((c + 0x800) >>> 12) & 0xfffff;
    let lo = c - ((hi << 12) | 0);
    lo = (lo << 20) >> 20;
    emit('lui', { rd, imm: hi }, v);
    if (lo) emit('addi', { rd, rs1: rd, imm: lo }, v);
  };
  const value = (id: string) => st.get(id) as ValueRec;
  const isConst = (id: string) => value(id).op === 'const';
  const cval = (id: string) => (value(id).imm as number) | 0;
  const rangeOf = (id: string): [number, number] => (ranges && stmt ? ranges.of(stmt, id) : [MIN, MAX]);
  let labels = 0;
  const newLabel = () => `L${labels++}`;

  // base + offset folding for loads and stores
  const address = (id: string, extra: number): [number, number] => {
    const v = value(id);
    if (o.immediates && v.op === 'add' && isConst(v.args[1]) && fits12(cval(v.args[1]) + extra))
      return [val(v.args[0]), cval(v.args[1]) + extra];
    if (o.immediates && v.op === 'add' && isConst(v.args[0]) && fits12(cval(v.args[0]) + extra))
      return [val(v.args[1]), cval(v.args[0]) + extra];
    if (fits12(extra)) return [val(id), extra];
    const r = fresh();
    li(r, extra, id);
    const s = fresh();
    emit('add', { rd: s, rs1: val(id), rs2: r }, id);
    return [s, 0];
  };

  function compare(op: string, a: string, b: string, rd: number, id: string): void {
    const A = val(a);
    if (o.immediates && isConst(b)) {
      const c = cval(b);
      if (op === 'lt' && fits12(c)) return emit('slti', { rd, rs1: A, imm: c }, id);
      if (op === 'ltu' && fits12(c)) return emit('sltiu', { rd, rs1: A, imm: c }, id);
      if (op === 'ge' && fits12(c)) {
        emit('slti', { rd, rs1: A, imm: c }, id);
        return emit('xori', { rd, rs1: rd, imm: 1 }, id);
      }
      if (op === 'geu' && fits12(c)) {
        emit('sltiu', { rd, rs1: A, imm: c }, id);
        return emit('xori', { rd, rs1: rd, imm: 1 }, id);
      }
      if (op === 'le' && fits12(c + 1) && c !== MAX) return emit('slti', { rd, rs1: A, imm: c + 1 }, id);
      if (op === 'gt' && fits12(c + 1) && c !== MAX) {
        emit('slti', { rd, rs1: A, imm: c + 1 }, id);
        return emit('xori', { rd, rs1: rd, imm: 1 }, id);
      }
      if (op === 'eq' && fits12(c)) {
        if (c) {
          emit('xori', { rd, rs1: A, imm: c }, id);
          return emit('sltiu', { rd, rs1: rd, imm: 1 }, id);
        }
        return emit('sltiu', { rd, rs1: A, imm: 1 }, id);
      }
      if (op === 'ne' && fits12(c)) {
        if (c) {
          emit('xori', { rd, rs1: A, imm: c }, id);
          return emit('sltu', { rd, rs1: ZERO, rs2: rd }, id);
        }
        return emit('sltu', { rd, rs1: ZERO, rs2: A }, id);
      }
    }
    const B = val(b);
    switch (op) {
      case 'lt':
        return emit('slt', { rd, rs1: A, rs2: B }, id);
      case 'ltu':
        return emit('sltu', { rd, rs1: A, rs2: B }, id);
      case 'gt':
        return emit('slt', { rd, rs1: B, rs2: A }, id);
      case 'gtu':
        return emit('sltu', { rd, rs1: B, rs2: A }, id);
      case 'ge':
        emit('slt', { rd, rs1: A, rs2: B }, id);
        return emit('xori', { rd, rs1: rd, imm: 1 }, id);
      case 'geu':
        emit('sltu', { rd, rs1: A, rs2: B }, id);
        return emit('xori', { rd, rs1: rd, imm: 1 }, id);
      case 'le':
        emit('slt', { rd, rs1: B, rs2: A }, id);
        return emit('xori', { rd, rs1: rd, imm: 1 }, id);
      case 'leu':
        emit('sltu', { rd, rs1: B, rs2: A }, id);
        return emit('xori', { rd, rs1: rd, imm: 1 }, id);
      case 'eq':
        emit('xor', { rd, rs1: A, rs2: B }, id);
        return emit('sltiu', { rd, rs1: rd, imm: 1 }, id);
      case 'ne':
        emit('xor', { rd, rs1: A, rs2: B }, id);
        return emit('sltu', { rd, rs1: ZERO, rs2: rd }, id);
    }
  }

  function divide(op: 'div' | 'rem', a: string, b: string, rd: number, id: string): void {
    const rb = rangeOf(b),
      ra = rangeOf(a);
    if (isConst(b) && cval(b) !== 0 && cval(b) !== -1 && o.divmagic && op === 'div') {
      const d = cval(b),
        n = val(a),
        k = log2(Math.abs(d));
      if (k > 0) {
        // n / 2^k rounds toward zero: add 2^k - 1 to negative n before the shift
        const t = fresh();
        if (ra[0] >= 0) emit('srai', { rd, rs1: n, imm: k }, id);
        else {
          emit('srai', { rd: t, rs1: n, imm: 31 }, id);
          emit('srli', { rd: t, rs1: t, imm: 32 - k }, id);
          emit('add', { rd: t, rs1: n, rs2: t }, id);
          emit('srai', { rd, rs1: t, imm: k }, id);
        }
        if (d < 0) emit('sub', { rd, rs1: ZERO, rs2: rd }, id);
        return;
      }
      if (Math.abs(d) >= 3) {
        const { magic, shift } = divisionMagic(Math.abs(d)),
          m = fresh(),
          q = fresh(),
          s = fresh();
        li(m, magic, id);
        emit('mulh', { rd: q, rs1: n, rs2: m }, id);
        if (magic < 0) emit('add', { rd: q, rs1: q, rs2: n }, id);
        if (shift) emit('srai', { rd: q, rs1: q, imm: shift }, id);
        emit('srli', { rd: s, rs1: n, imm: 31 }, id);
        emit('add', { rd, rs1: q, rs2: s }, id);
        if (d < 0) emit('sub', { rd, rs1: ZERO, rs2: rd }, id);
        return;
      }
    }
    const A = val(a),
      B = isConst(b) && cval(b) === 0 ? ZERO : val(b);
    const zeroFree = isConst(b) ? cval(b) !== 0 : rb[0] > 0 || rb[1] < 0;
    if (!zeroFree) {
      const L = newLabel();
      emit('bne', { rs1: B, rs2: ZERO, target: L, why: 'division by zero' }, id);
      emit('ebreak', { why: 'division by zero' }, id);
      emit('label', { name: L });
    }
    const overflowFree =
      op === 'rem' ||
      (isConst(b) ? cval(b) !== -1 : rb[0] > -1 || rb[1] < -1) ||
      (isConst(a) ? cval(a) !== MIN : ra[0] > MIN);
    if (!overflowFree) {
      const L = newLabel(),
        k = fresh(),
        m = fresh();
      li(k, -1, id);
      emit('bne', { rs1: B, rs2: k, target: L, why: 'overflow' }, id);
      li(m, MIN, id);
      emit('bne', { rs1: A, rs2: m, target: L, why: 'overflow' }, id);
      emit('ebreak', { why: 'integer overflow' }, id);
      emit('label', { name: L });
    }
    emit(op, { rd, rs1: A, rs2: B }, id);
  }

  /** The register holding value `id`, computed into `want` when given (target-directed assignment). */
  function val(id: string, want?: number): number {
    const v = value(id),
      out = () => want ?? fresh();
    switch (v.op) {
      case 'const': {
        if (v.imm === 0 && want === undefined && o.immediates) return ZERO;
        const rd = out();
        li(rd, v.imm as number, id);
        return rd;
      }
      case 'get': {
        const r = localReg[v.imm as number];
        if (want !== undefined && want !== r) {
          emit('addi', { rd: want, rs1: r, imm: 0, mv: true }, id);
          return want;
        }
        return r;
      }
      case 'load':
      case 'load16u': {
        const [base, off] = address(v.args[0], (v.imm as number) || 0);
        const rd = out();
        emit(v.op === 'load' ? 'lw' : 'lhu', { rd, rs1: base, imm: off }, id);
        return rd;
      }
      case 'eqz': {
        const a = val(v.args[0]),
          rd = out();
        emit('sltiu', { rd, rs1: a, imm: 1 }, id);
        return rd;
      }
      case 'call': {
        if (v.args.length > 8) fail('unsupported', `${f.name}: calls with more than 8 arguments`);
        const regs = v.args.map(a => val(a));
        regs.forEach((r, i) => emit('addi', { rd: A0 + i, rs1: r, imm: 0, mv: true }, id));
        emit('call', { callee: v.imm as string, argc: regs.length }, id);
        const rd = out();
        emit('addi', { rd, rs1: A0, imm: 0, mv: true }, id);
        return rd;
      }
    }
    const [a, b] = v.args,
      rd = out();
    const op = v.op as string;
    if (COMPARE.has(op) || op === 'gtu' || op === 'leu') {
      compare(op, a, b, rd, id);
      return rd;
    }
    if (op === 'div' || op === 'rem') {
      divide(op, a, b, rd, id);
      return rd;
    }
    if (o.immediates && isConst(b)) {
      const c = cval(b),
        I = IMMEDIATE[op];
      if (I && fits12(c)) {
        emit(I, { rd, rs1: val(a), imm: c }, id);
        return rd;
      }
      if (op === 'sub' && fits12(-c)) {
        emit('addi', { rd, rs1: val(a), imm: -c }, id);
        return rd;
      }
      const S = SHIFT_IMMEDIATE[op];
      if (S) {
        emit(S, { rd, rs1: val(a), imm: c & 31 }, id);
        return rd;
      }
      if (op === 'mul' && log2(c) >= 0) {
        emit('slli', { rd, rs1: val(a), imm: log2(c) }, id);
        return rd;
      }
    }
    if (o.immediates && isConst(a) && ['add', 'and', 'or', 'xor', 'mul'].includes(op)) {
      const c = cval(a),
        I = IMMEDIATE[op];
      if (I && fits12(c)) {
        emit(I, { rd, rs1: val(b), imm: c }, id);
        return rd;
      }
      if (op === 'mul' && log2(c) >= 0) {
        emit('slli', { rd, rs1: val(b), imm: log2(c) }, id);
        return rd;
      }
    }
    const R = REGISTER[op];
    if (!R) fail('unsupported', `the backend has no tile for "${op}" (${id})`);
    const A = val(a),
      B = val(b);
    emit(R, { rd, rs1: A, rs2: B }, id);
    return rd;
  }

  // branches: fuse the comparison into the branch when the condition is one
  function branch(condId: string, then: string, els: string, next: string | null): void {
    let c = value(condId),
      br: string,
      A: number,
      B: number;
    let negate = false;
    while (o.fuse && c.op === 'eqz') {
      negate = !negate;
      condId = c.args[0];
      c = value(condId);
    }
    const fused = o.fuse ? FUSE[c.op] : undefined;
    if (fused) {
      const [name, swap] = fused;
      const x = isConst(c.args[0]) && cval(c.args[0]) === 0 ? ZERO : val(c.args[0]);
      const y = isConst(c.args[1]) && cval(c.args[1]) === 0 ? ZERO : val(c.args[1]);
      [A, B] = swap ? [y, x] : [x, y];
      br = name;
    } else {
      A = val(condId);
      B = ZERO;
      br = 'bne';
    }
    if (negate) br = INVERT[br];
    if (then === next) emit(INVERT[br], { rs1: A, rs2: B, target: els }, condId);
    else {
      emit(br, { rs1: A, rs2: B, target: then }, condId);
      if (els !== next) emit('j', { target: els }, condId);
    }
  }

  // entry: copy parameters out of a0..a7, zero the locals read before they are written
  emit('label', { name: 'entry' });
  if (f.params.length > 8) fail('unsupported', `${f.name}: more than 8 parameters`);
  f.params.forEach((_, i) => {
    emit('addi', { rd: localReg[i], rs1: A0 + i, imm: 0, mv: true, param: i });
    hints.set(localReg[i], A0 + i);
  });
  for (const l of live.liveIn(f.blocks[0].id))
    if (!f.locals[l].param) emit('addi', { rd: localReg[l], rs1: ZERO, imm: 0, zero: l });
  const order = f.blocks.map(b => b.id);
  order.forEach((bid, k) => {
    const b = f.blocks[k],
      next = order[k + 1] ?? null;
    emit('label', { name: bid, block: bid });
    for (const sid of b.stmts) {
      stmt = sid;
      const s = st.get(sid) as StmtRec;
      switch (s.op) {
        case 'set':
          val(s.value!, localReg[s.local!]);
          break;
        case 'eval':
          val(s.value!);
          break;
        case 'store': {
          const [base, off] = address(s.addr!, s.offset || 0);
          const v = isConst(s.value!) && cval(s.value!) === 0 ? ZERO : val(s.value!);
          emit(s.width === 16 ? 'sh' : 'sw', { rs1: base, rs2: v, imm: off }, s.value);
          break;
        }
        case 'br':
          if (s.to !== next) emit('j', { target: s.to });
          break;
        case 'br_if':
          branch(s.cond!, s.then!, s.else!, next);
          break;
        case 'return': {
          if (s.value) {
            const r = val(s.value);
            hints.set(r, A0);
            emit('addi', { rd: A0, rs1: r, imm: 0, mv: true }, s.value);
          } else emit('addi', { rd: A0, rs1: ZERO, imm: 0 });
          emit('jexit', {});
          break;
        }
        case 'trap':
          emit('ebreak', { why: s.why || 'unreachable' });
          break;
        default:
          fail('unsupported', `the backend has no tile for statement "${s.op}" (${sid})`);
      }
    }
    stmt = null;
  });
  return { code, localReg, hints, vregs: nv - 64 };
}
