/**
 * Instruction selection: tile each statement's value tree, largest tile first, onto virtual registers.
 *
 *   x + c, c fits 12 bits        addi                      load32[x + c]     lw with the offset folded in
 *   x * 2^k                      slli                      i < n -> branch   fused: blt i, n, ...
 *   x / c, c a constant          mulh and shifts (divmagic), or a shift for a power of two
 *   a / b                        div behind the zero and overflow tests (dropped when ranges prove them)
 *   f(x, y)                      moves to the argument registers (ilp32f), jal ra, a move from a0 or fa0
 *   a constant that does not fit lui and addi
 *
 * f32 values live in f registers (a second class of virtual registers):
 *
 *   a +. b, -. *. /. sqrt        fadd.s … fsqrt.s, rounding to nearest even named in the instruction
 *   fneg fabs fcopysign          fsgnjn.s, fsgnjx.s, fsgnj.s;   fmin fmax: fmin.s, fmax.s
 *   feq flt fle (fgt fge)        feq.s, flt.s, fle.s into an x register (operands swapped); fne is feq.s, xori 1
 *   f2i f2u                      fcvt.w.s, fcvt.wu.s, rtz (they saturate);   i2f u2f: fcvt.s.w, fcvt.s.wu, rne
 *   floor ceil trunc             the reference compiler's round: |x| ≥ 2^23, ∞ and NaN are their own result,
 *                                otherwise fcvt.w.s and fcvt.s.w in the direction, with x's sign (fsgnj.s)
 *   f2bits bits2f                fmv.x.w, fmv.w.x;   an f32 constant: its bits into an x register, fmv.w.x
 *   loadf32[a + c], f32 stores   flw, fsw with the offset folded in
 *   caddr(r, p)                  lw the capacity, bltu p over an ebreak, r + (p << 1)
 *   aaddr c, zero c n            sp + (outgoing area) + c; sw zero per word up to 16 words, else a loop
 *   eval f(…), result#k          a record result's leaves stay where ilp32f returns them (a0-a7, fa0-fa7, the
 *                                outgoing stack words) and are read there, before the next call
 *   return (v, w, …)             the leaves into their registers and the caller's stack words
 *
 * Assignments are target-directed: `s = s + x` computes straight into `s`'s register. Locals that are live on
 * entry, other than parameters, are zeroed, because the language zero-initializes and the IR may read a local
 * before an assignment on some path. A port of Compiler Workbench's backend.js `select`, extended with the f32
 * lowering of the reference compiler (typed-rv32.js emit/floats.js, emit/calls.js, emit/addresses.js).
 */
import { MAX, MIN, type LiveView, type RangeView } from '../analyses.js';
import { argumentLocations, resultLocations, stackWords, type Location } from '../ilp32f.js';
import { COMPARE } from '../listing.js';
import { typeClass, type StmtRec, type Store, type ValueRec, type WorkFn } from '../model.js';
import type { BackendOptions } from './options.js';
import { fail } from './errors.js';
import {
  A0,
  FA0,
  INVERT,
  RDN,
  RNE,
  RTZ,
  RUP,
  SP,
  ZERO,
  divisionMagic,
  fits12,
  log2,
  physClass,
  type MInsn,
} from './encode.js';

export interface Selection {
  readonly code: MInsn[];
  /** The virtual register of each local. */
  readonly localReg: readonly number[];
  /** Allocation hints: a parameter prefers its argument register, a returned value a0 (fa0). */
  readonly hints: Map<number, number>;
  /** How many virtual registers were made. */
  readonly vregs: number;
  /** The virtual registers of class f (f32 values); every other virtual register is of class x. */
  readonly fregs: ReadonlySet<number>;
  /** Words of the outgoing stack area at the bottom of the frame (the calls' stack arguments and results). */
  readonly outgoing: number;
  /** Bytes of the frame array area, above the outgoing area. */
  readonly arrays: number;
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
/** f32 → f32 binary operators: the instruction and its rounding mode (none for sign injection, min and max). */
const F_BINARY: Readonly<Record<string, readonly [string, number?]>> = {
  fadd: ['fadd.s', RNE],
  fsub: ['fsub.s', RNE],
  fmul: ['fmul.s', RNE],
  fdiv: ['fdiv.s', RNE],
  fmin: ['fmin.s'],
  fmax: ['fmax.s'],
  fcopysign: ['fsgnj.s'],
};
/** f32 comparisons: the instruction and whether the operands are swapped (a > b is b < a). fne is feq negated. */
const F_COMPARE: Readonly<Record<string, readonly [string, boolean]>> = {
  feq: ['feq.s', false],
  fne: ['feq.s', false],
  flt: ['flt.s', false],
  fgt: ['flt.s', true],
  fle: ['fle.s', false],
  fge: ['fle.s', true],
};
const F_ROUND: Readonly<Record<string, number>> = { ffloor: RDN, fceil: RUP, ftrunc: RTZ };

/** The physical register of an ilp32f register location (x10.. or f10.. = 32 + 10..). */
const physOf = (l: Location): number => (l.cls === 'f' ? 32 + l.reg : l.cls === 'x' ? l.reg : -1);

export function select({ st, f, o, live, ranges }: SelectContext): Selection {
  const code: MInsn[] = [];
  let nv = 64,
    stmt: string | null = null;
  const fregs = new Set<number>();
  const fresh = () => nv++;
  const freshF = () => {
    const r = nv++;
    fregs.add(r);
    return r;
  };
  const localReg = f.locals.map(l => (typeClass(l.type) === 'f32' ? freshF() : fresh()));
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
  const isF = (id: string) => value(id).type === 'f32';
  const classOf = (r: number): 'x' | 'f' => (r >= 64 ? (fregs.has(r) ? 'f' : 'x') : physClass(r));
  /** A register copy of either class: `addi rd, rs, 0` or `fsgnj.s rd, rs, rs` (fmv.s). */
  const move = (rd: number, rs: number, v?: string, extra: Fields = {}): void =>
    classOf(rd) === 'f'
      ? emit('fsgnj.s', { rd, rs1: rs, rs2: rs, mv: true, ...extra }, v)
      : emit('addi', { rd, rs1: rs, imm: 0, mv: true, ...extra }, v);
  const rangeOf = (id: string): [number, number] => (ranges && stmt ? ranges.of(stmt, id) : [MIN, MAX]);
  let labels = 0;
  const newLabel = () => `L${labels++}`;

  // the outgoing stack area: the most stack words any call of this function needs (ilp32f)
  const signature = (name: string) => {
    const callee = st.fn(name);
    return { params: callee.params, result: callee.result, results: callee.results };
  };
  let outgoing = 0;
  {
    const walk = (id: string | undefined): void => {
      if (!id) return;
      const v = value(id);
      if (v.op === 'call') outgoing = Math.max(outgoing, stackWords(signature(v.imm as string)));
      for (const a of v.args) walk(a);
    };
    for (const b of f.blocks)
      for (const sid of b.stmts) {
        const s = st.get(sid) as StmtRec;
        walk(s.value);
        walk(s.cond);
        walk(s.addr);
      }
  }
  const arrays = f.arrayBytes ?? 0;
  /** The frame array area starts above the outgoing area. */
  const arrayBase = 4 * outgoing;
  if (arrayBase + arrays > 2047)
    fail('frameTooLarge', `${f.name}: ${arrays} bytes of arrays above ${arrayBase} outgoing bytes`);

  // the record result of the latest call with one: its leaves' locations, the block it is in and the calls since
  let calls = 0;
  let leaves: { locs: Location[]; block: string; calls: number; id: string } | null = null;
  let block = '';

  // base + offset folding for loads and stores
  const address = (id: string, extra: number): [number, number] => {
    const v = value(id);
    if (o.immediates && v.op === 'add' && isConst(v.args[1]) && fits12(cval(v.args[1]) + extra))
      return [val(v.args[0]), cval(v.args[1]) + extra];
    if (o.immediates && v.op === 'add' && isConst(v.args[0]) && fits12(cval(v.args[0]) + extra))
      return [val(v.args[1]), cval(v.args[0]) + extra];
    // a frame array element: sp-relative
    if (v.op === 'aaddr' && fits12(arrayBase + (v.imm as number) + extra))
      return [SP, arrayBase + (v.imm as number) + extra];
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

  /** A register a value read from a physical register (a result leaf) can be clobbered from: a copy of it. */
  const owned = (r: number, id: string): number => {
    if (r >= 64 || r === ZERO) return r;
    const c = classOf(r) === 'f' ? freshF() : fresh();
    move(c, r, id);
    return c;
  };

  /** A call under ilp32f: arguments into a0-a7, fa0-fa7 and the outgoing stack words; its result in `out`. */
  function call(v: ValueRec, id: string, want: number | undefined): number {
    const name = v.imm as string,
      sig = signature(name);
    const locs = argumentLocations(sig.params);
    const zeroWord = (i: number) => locs[i].cls === 'stack' && isConst(v.args[i]) && cval(v.args[i]) === 0;
    const regs = v.args.map((a, i) => (zeroWord(i) ? ZERO : owned(val(a), a)));
    regs.forEach((r, i) => {
      const l = locs[i];
      if (l.cls === 'stack')
        emit(classOf(r) === 'x' ? 'sw' : 'fsw', { rs1: SP, rs2: r, imm: 4 * l.word, why: 'stack argument' }, id);
      else if (classOf(r) === l.cls) move(physOf(l), r, id);
      else emit('fmv.x.w', { rd: physOf(l), rs1: r }, id); // an f32 beyond fa7, as its bits in an x register
    });
    emit('call', { callee: name, argc: regs.length, uses: locs.filter(l => l.cls !== 'stack').map(physOf) }, id);
    calls++;
    if (sig.results) {
      // the leaves stay where they return, until result#k reads them (before the next call, in this block)
      leaves = { locs: resultLocations(sig.results), block, calls, id };
      return ZERO;
    }
    const f32 = typeClass(sig.result) === 'f32';
    const rd = want ?? (f32 ? freshF() : fresh());
    move(rd, f32 ? FA0 : A0, id);
    return rd;
  }

  /** Leaf k of the latest record result: its register itself, or a load from its outgoing stack word. */
  function leaf(v: ValueRec, id: string, want: number | undefined): number {
    if (!leaves || leaves.block !== block || leaves.calls !== calls)
      fail(
        'unsupported',
        `${f.name}: ${id} reads a result leaf ${leaves ? 'after another call or in another block than' : 'without'} its call`,
      );
    const l = leaves.locs[v.imm as number];
    if (!l) fail('internal', `${f.name}: ${id} reads leaf ${v.imm} of a result with ${leaves.locs.length}`);
    if (l.cls === 'stack') {
      const rd = want ?? (v.type === 'f32' ? freshF() : fresh());
      emit(v.type === 'f32' ? 'flw' : 'lw', { rd, rs1: SP, imm: 4 * l.word }, id);
      return rd;
    }
    const r = physOf(l);
    if (want !== undefined) {
      move(want, r, id);
      return want;
    }
    return r;
  }

  /** floor, ceil, trunc (typed-rv32.js FloatMethods.round), in rounding mode rm. */
  function round(a: number, rd: number, rm: number, id: string): void {
    if (rd !== a) move(rd, a, id);
    const t = fresh(),
      k = fresh(),
      i = fresh(),
      g = freshF(),
      L = newLabel();
    emit('fmv.x.w', { rd: t, rs1: a }, id);
    emit('slli', { rd: t, rs1: t, imm: 1 }, id);
    emit('lui', { rd: k, imm: 0x96000 }, id);
    emit('bgeu', { rs1: t, rs2: k, target: L, why: '|x| ≥ 2^23, ∞ or NaN: its own result' }, id);
    emit('fcvt.w.s', { rd: i, rs1: a, rm }, id);
    emit('fcvt.s.w', { rd: g, rs1: i, rm }, id);
    emit('fsgnj.s', { rd, rs1: g, rs2: a }, id);
    emit('label', { name: L });
  }

  /** The value of an f32 operator (or an f32 comparison or conversion), computed into `want` when given. */
  function float(v: ValueRec, id: string, want: number | undefined): number {
    const op = v.op as string;
    const outF = () => want ?? freshF(),
      outX = () => want ?? fresh();
    const bin = F_BINARY[op];
    if (bin) {
      const A = val(v.args[0]),
        B = val(v.args[1]),
        rd = outF();
      emit(bin[0], { rd, rs1: A, rs2: B, ...(bin[1] === undefined ? {} : { rm: bin[1] }) }, id);
      return rd;
    }
    const cmp = F_COMPARE[op];
    if (cmp) {
      const A = val(v.args[0]),
        B = val(v.args[1]),
        rd = outX();
      emit(cmp[0], cmp[1] ? { rd, rs1: B, rs2: A } : { rd, rs1: A, rs2: B }, id);
      if (op === 'fne') emit('xori', { rd, rs1: rd, imm: 1 }, id);
      return rd;
    }
    if (op in F_ROUND) {
      const A = val(v.args[0]),
        rd = outF();
      round(A, rd, F_ROUND[op], id);
      return rd;
    }
    const A = val(v.args[0]);
    switch (op) {
      case 'fneg':
      case 'fabs': {
        const rd = outF();
        emit(op === 'fneg' ? 'fsgnjn.s' : 'fsgnjx.s', { rd, rs1: A, rs2: A }, id);
        return rd;
      }
      case 'fsqrt': {
        const rd = outF();
        emit('fsqrt.s', { rd, rs1: A, rm: RNE }, id);
        return rd;
      }
      case 'f2i':
      case 'f2u': {
        const rd = outX();
        emit(op === 'f2i' ? 'fcvt.w.s' : 'fcvt.wu.s', { rd, rs1: A, rm: RTZ }, id);
        return rd;
      }
      case 'i2f':
      case 'u2f': {
        const rd = outF();
        emit(op === 'i2f' ? 'fcvt.s.w' : 'fcvt.s.wu', { rd, rs1: A, rm: RNE }, id);
        return rd;
      }
      case 'f2bits': {
        const rd = outX();
        emit('fmv.x.w', { rd, rs1: A }, id);
        return rd;
      }
      case 'bits2f': {
        const rd = outF();
        emit('fmv.w.x', { rd, rs1: A }, id);
        return rd;
      }
    }
    return fail('unsupported', `the backend has no tile for "${op}" (${id})`);
  }

  /** The register holding value `id`, computed into `want` when given (target-directed assignment). */
  function val(id: string, want?: number): number {
    const v = value(id),
      out = () => want ?? fresh();
    switch (v.op) {
      case 'const': {
        if (v.type === 'f32') {
          // its bits into an x register, then fmv.w.x (+0 from x0)
          const bits = (v.imm as number) | 0,
            rd = want ?? freshF();
          if (bits === 0) emit('fmv.w.x', { rd, rs1: ZERO }, id);
          else {
            const t = fresh();
            li(t, bits, id);
            emit('fmv.w.x', { rd, rs1: t }, id);
          }
          return rd;
        }
        if (v.imm === 0 && want === undefined && o.immediates) return ZERO;
        const rd = out();
        li(rd, v.imm as number, id);
        return rd;
      }
      case 'get': {
        const r = localReg[v.imm as number];
        if (want !== undefined && want !== r) {
          move(want, r, id);
          return want;
        }
        return r;
      }
      case 'load':
      case 'load16u': {
        const [base, off] = address(v.args[0], (v.imm as number) || 0);
        const f32 = v.type === 'f32',
          rd = want ?? (f32 ? freshF() : fresh());
        emit(v.op === 'load16u' ? 'lhu' : f32 ? 'flw' : 'lw', { rd, rs1: base, imm: off }, id);
        return rd;
      }
      case 'eqz': {
        const a = val(v.args[0]),
          rd = out();
        emit('sltiu', { rd, rs1: a, imm: 1 }, id);
        return rd;
      }
      case 'call':
        return call(v, id, want);
      case 'result':
        return leaf(v, id, want);
      case 'caddr': {
        // text.checked_address: trap unless position <u load32[receiver], then receiver + (position << 1)
        const R = val(v.args[0]),
          P = val(v.args[1]),
          cap = fresh(),
          L = newLabel();
        emit('lw', { rd: cap, rs1: R, imm: 0, why: 'capacity' }, id);
        emit('bltu', { rs1: P, rs2: cap, target: L, why: 'checked address' }, id);
        emit('ebreak', { why: 'checked address out of range' }, id);
        emit('label', { name: L });
        const rd = out();
        if (o.immediates && isConst(v.args[1]) && fits12(2 * cval(v.args[1])))
          emit('addi', { rd, rs1: R, imm: 2 * cval(v.args[1]) }, id);
        else {
          const t = fresh();
          emit('slli', { rd: t, rs1: P, imm: 1 }, id);
          emit('add', { rd, rs1: R, rs2: t }, id);
        }
        return rd;
      }
      case 'aaddr': {
        const rd = out();
        emit('addi', { rd, rs1: SP, imm: arrayBase + (v.imm as number), why: 'frame array' }, id);
        return rd;
      }
      case 'tuple':
        return fail('unsupported', `${f.name}: a tuple (${id}) is only a returned value`);
    }
    if (v.type === 'f32' || F_COMPARE[v.op] || v.op === 'f2i' || v.op === 'f2u' || v.op === 'f2bits')
      return float(v, id, want);
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
    const fcmp = o.fuse ? F_COMPARE[c.op] : undefined;
    if (fused) {
      const [name, swap] = fused;
      const x = isConst(c.args[0]) && cval(c.args[0]) === 0 ? ZERO : val(c.args[0]);
      const y = isConst(c.args[1]) && cval(c.args[1]) === 0 ? ZERO : val(c.args[1]);
      [A, B] = swap ? [y, x] : [x, y];
      br = name;
    } else if (fcmp) {
      // an f32 comparison into an x register, then a branch on it; fne branches when feq gives 0
      const x = val(c.args[0]),
        y = val(c.args[1]),
        t = fresh();
      emit(fcmp[0], fcmp[1] ? { rd: t, rs1: y, rs2: x } : { rd: t, rs1: x, rs2: y }, condId);
      [A, B] = [t, ZERO];
      br = c.op === 'fne' ? 'beq' : 'bne';
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

  /** A record return: every leaf into its register or the caller's stack word (ilp32f result locations). */
  function returnTuple(tuple: ValueRec, id: string): void {
    const locs = resultLocations(f.results!);
    if (tuple.args.length !== locs.length)
      fail('internal', `${f.name}: ${id} returns ${tuple.args.length} leaves, not ${locs.length}`);
    const zeroWord = (i: number) =>
      locs[i].cls === 'stack' && isConst(tuple.args[i]) && cval(tuple.args[i]) === 0;
    let srcs = tuple.args.map((a, i) => (zeroWord(i) ? ZERO : val(a)));
    // a leaf read from a register another leaf's move writes (a result of a call) is copied first
    const dests = new Set(locs.map(physOf).filter(r => r >= 0));
    srcs = srcs.map((r, i) =>
      r < 64 && r !== ZERO && dests.has(r) && r !== physOf(locs[i]) ? owned(r, tuple.args[i]) : r,
    );
    locs.forEach((l, i) => {
      if (l.cls !== 'stack') return;
      emit(
        classOf(srcs[i]) === 'x' ? 'sw' : 'fsw',
        { rs1: SP, rs2: srcs[i], imm: 4 * l.word, caller: true, why: 'result leaf' },
        tuple.args[i],
      );
    });
    locs.forEach((l, i) => {
      if (l.cls === 'stack') return;
      const d = physOf(l);
      if (srcs[i] === d) return;
      if (srcs[i] >= 64) hints.set(srcs[i], d);
      move(d, srcs[i], tuple.args[i], { pins: true });
    });
  }

  // the registers a return reads: a0 or fa0, or a record result's leaf registers
  const returned = f.results
    ? resultLocations(f.results)
        .filter(l => l.cls !== 'stack')
        .map(physOf)
    : [typeClass(f.result) === 'f32' ? FA0 : A0];

  // entry: copy parameters out of their ilp32f locations, zero the locals read before they are written
  emit('label', { name: 'entry' });
  const incoming = argumentLocations(f.params);
  f.params.forEach((t, i) => {
    const l = incoming[i],
      rd = localReg[i];
    if (l.cls === 'stack') {
      emit(classOf(rd) === 'f' ? 'flw' : 'lw', { rd, rs1: SP, imm: 4 * l.word, caller: true, why: 'stack argument' });
      return;
    }
    const r = physOf(l);
    if (classOf(rd) === l.cls) {
      move(rd, r, undefined, { param: i });
      hints.set(rd, r);
    } else emit('fmv.w.x', { rd, rs1: r, param: i }); // an f32 beyond fa7 arrives as bits in an x register
    void t;
  });
  for (const l of live.liveIn(f.blocks[0].id))
    if (!f.locals[l].param)
      emit(classOf(localReg[l]) === 'f' ? 'fmv.w.x' : 'addi', {
        rd: localReg[l],
        rs1: ZERO,
        ...(classOf(localReg[l]) === 'f' ? {} : { imm: 0 }),
        zero: l,
      });
  const order = f.blocks.map(b => b.id);
  order.forEach((bid, k) => {
    const b = f.blocks[k],
      next = order[k + 1] ?? null;
    block = bid;
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
          emit(s.width === 16 ? 'sh' : classOf(v) === 'f' ? 'fsw' : 'sw', { rs1: base, rs2: v, imm: off }, s.value);
          break;
        }
        case 'zero': {
          // array.zero: one sw zero per word up to 16 words, else a loop over the words
          const at = arrayBase + (s.offset ?? 0),
            n = s.bytes ?? 0;
          if (n % 4 || at % 4) fail('unsupported', `${f.name}: zero of ${n} bytes at ${at} is not whole words`);
          if (n <= 64 && fits12(at + n)) {
            for (let k = 0; k < n; k += 4) emit('sw', { rs1: SP, rs2: ZERO, imm: at + k });
            break;
          }
          const p = fresh(),
            e = fresh(),
            L = newLabel();
          emit('addi', { rd: p, rs1: SP, imm: at, why: 'frame array' });
          if (fits12(n)) emit('addi', { rd: e, rs1: p, imm: n });
          else {
            li(e, n, sid);
            emit('add', { rd: e, rs1: e, rs2: p });
          }
          emit('label', { name: L });
          emit('sw', { rs1: p, rs2: ZERO, imm: 0 });
          emit('addi', { rd: p, rs1: p, imm: 4 });
          emit('bne', { rs1: p, rs2: e, target: L, why: 'zero the next word' });
          break;
        }
        case 'br':
          if (s.to !== next) emit('j', { target: s.to });
          break;
        case 'br_if':
          branch(s.cond!, s.then!, s.else!, next);
          break;
        case 'return': {
          const rv = s.value ? value(s.value) : null;
          if (rv && rv.op === 'tuple') returnTuple(rv, s.value!);
          else if (s.value) {
            const r = val(s.value),
              ret = classOf(r) === 'f' ? FA0 : A0;
            hints.set(r, ret);
            move(ret, r, s.value);
          } else emit('addi', { rd: A0, rs1: ZERO, imm: 0 });
          emit('jexit', { uses: returned });
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
  return { code, localReg, hints, vregs: nv - 64, fregs, outgoing, arrays };
}
