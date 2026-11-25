/**
 * RV32IMF encoding and decoding, and the machine instructions the backend works on.
 *
 * The format encoders are reused unchanged from ds-js-os `compiler/rv32/00-encoding.js`, and the disassembler from
 * its `tools/typed-inspect/rv32.mjs` (Espressif PIE words dropped), as in Compiler Workbench's backend.js. Only
 * `lui` and the fixed words for `ret` and `ebreak` are written here. The listing of an image is the disassembler's
 * reading of the encoded words, so it shows what the bytes say, not what the selector meant.
 *
 * Registers are numbers: x_n is n and f_n is 32 + n, as in the reference compiler (typed-rv32.js registers.js), so
 * `r >> 5` is a physical register's class; 64 and up are virtual. The RV32F words follow the reference compiler's
 * instruction table (typed-rv32.js instructions.js, its RV32F rows): OP-FP (0x53) with funct7, rs2 and the rounding
 * mode in funct3, flw (0x07) and fsw (0x27).
 */
import { fail } from './errors.js';

// ---------- reused: encoders (unchanged) ----------
export const instruction = {
  r: (op: number, rd: number, f3: number, a: number, b: number, f7 = 0): number =>
    (f7 << 25) | (b << 20) | (a << 15) | (f3 << 12) | (rd << 7) | op,
  i: (op: number, rd: number, f3: number, a: number, imm: number): number =>
    (imm << 20) | (a << 15) | (f3 << 12) | (rd << 7) | op,
  s: (f3: number, a: number, b: number, imm: number): number =>
    ((imm >> 5) << 25) | (b << 20) | (a << 15) | (f3 << 12) | ((imm & 31) << 7) | 0x23,
  b: (f3: number, a: number, b: number, imm: number): number =>
    ((imm & 0x1000) << 19) |
    ((imm & 0x7e0) << 20) |
    (b << 20) |
    (a << 15) |
    (f3 << 12) |
    ((imm & 0x1e) << 7) |
    ((imm & 0x800) >> 4) |
    0x63,
  j: (rd: number, imm: number): number =>
    ((imm & 0x100000) << 11) |
    ((imm & 0x7fe) << 20) |
    ((imm & 0x800) << 9) |
    (imm & 0xff000) |
    (rd << 7) |
    0x6f,
};

/** Signed division by a constant d in [3, 2^31) that is not a power of two (Hacker's Delight 10-1). */
export function divisionMagic(d: number): { magic: number; shift: number } {
  const two31 = 2147483648,
    anc = two31 - 1 - (two31 % d);
  let p = 31,
    q1 = Math.floor(two31 / anc),
    r1 = two31 - q1 * anc;
  let q2 = Math.floor(two31 / d),
    r2 = two31 - q2 * d,
    delta: number;
  do {
    p++;
    q1 *= 2;
    r1 *= 2;
    if (r1 >= anc) {
      q1++;
      r1 -= anc;
    }
    q2 *= 2;
    r2 *= 2;
    if (r2 >= d) {
      q2++;
      r2 -= d;
    }
    delta = d - r2;
  } while (q1 < delta || (q1 === delta && r1 === 0));
  return { magic: (q2 + 1) | 0, shift: p - 32 };
}

// ---------- reused: disassembler (PIE words dropped) ----------
/** ABI names of x0-x31, then of f0-f31 (index 32 + n). */
export const REGS: readonly string[] = (
  'zero ra sp gp tp t0 t1 t2 s0 s1 a0 a1 a2 a3 a4 a5 a6 a7 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 t3 t4 t5 t6 ' +
  'ft0 ft1 ft2 ft3 ft4 ft5 ft6 ft7 fs0 fs1 fa0 fa1 fa2 fa3 fa4 fa5 fa6 fa7 fs2 fs3 fs4 fs5 fs6 fs7 fs8 fs9 fs10 fs11 ft8 ft9 ft10 ft11'
).split(' ');
const sext = (n: number, bits: number) => (n << (32 - bits)) >> (32 - bits);
const hex = (n: number) => '0x' + n.toString(16);
/** Rounding modes by funct3 (7, dynamic, is not written, as GNU as and objdump do). */
const ROUNDING_NAMES = ['rne', 'rtz', 'rdn', 'rup', 'rmm'];

/** An RV32F word (flw, fsw, OP-FP) as text, or undefined when it is not one the F extension defines. */
function decodeFloat(word: number): Decoded | undefined {
  const opcode = word & 127,
    rd = (word >>> 7) & 31,
    f3 = (word >>> 12) & 7,
    rs = (word >>> 15) & 31,
    rt = (word >>> 20) & 31,
    f7 = word >>> 25;
  const X = (r: number) => REGS[r],
    Fr = (r: number) => REGS[32 + r];
  const fmt = (mnemonic: string, ...args: (string | number)[]) => mnemonic + ' ' + args.join(', ');
  if (opcode === 0x07 && f3 === 2) {
    const offset = word >> 20;
    return {
      text: fmt('flw', Fr(rd), offset + '(' + X(rs) + ')'),
      memory: 'load',
      base: X(rs),
      offset,
      reg: Fr(rd),
    };
  }
  if (opcode === 0x27 && f3 === 2) {
    const offset = sext((f7 << 5) | rd, 12);
    return {
      text: fmt('fsw', Fr(rt), offset + '(' + X(rs) + ')'),
      memory: 'store',
      base: X(rs),
      offset,
      reg: Fr(rt),
    };
  }
  if (opcode !== 0x53) return undefined;
  const rounded = (mnemonic: string, ...args: string[]) =>
    f3 === 7 ? fmt(mnemonic, ...args) : f3 < 5 ? fmt(mnemonic, ...args, ROUNDING_NAMES[f3]) : undefined;
  let text: string | undefined;
  if (f7 === 0x00 || f7 === 0x04 || f7 === 0x08 || f7 === 0x0c)
    text = rounded(['fadd.s', 'fsub.s', 'fmul.s', 'fdiv.s'][f7 >> 2], Fr(rd), Fr(rs), Fr(rt));
  else if (f7 === 0x2c && rt === 0) text = rounded('fsqrt.s', Fr(rd), Fr(rs));
  else if (f7 === 0x10 && f3 < 3)
    // the pseudo-instructions fmv.s, fneg.s and fabs.s when both sources are one register
    text =
      rs === rt
        ? fmt(['fmv.s', 'fneg.s', 'fabs.s'][f3], Fr(rd), Fr(rs))
        : fmt(['fsgnj.s', 'fsgnjn.s', 'fsgnjx.s'][f3], Fr(rd), Fr(rs), Fr(rt));
  else if (f7 === 0x14 && f3 < 2) text = fmt(f3 ? 'fmax.s' : 'fmin.s', Fr(rd), Fr(rs), Fr(rt));
  else if (f7 === 0x60 && rt < 2) text = rounded(rt ? 'fcvt.wu.s' : 'fcvt.w.s', X(rd), Fr(rs));
  else if (f7 === 0x68 && rt < 2) text = rounded(rt ? 'fcvt.s.wu' : 'fcvt.s.w', Fr(rd), X(rs));
  else if (f7 === 0x70 && rt === 0 && f3 < 2) text = fmt(f3 ? 'fclass.s' : 'fmv.x.w', X(rd), Fr(rs));
  else if (f7 === 0x50 && f3 < 3) text = fmt(['fle.s', 'flt.s', 'feq.s'][f3], X(rd), Fr(rs), Fr(rt));
  else if (f7 === 0x78 && rt === 0 && f3 === 0) text = fmt('fmv.w.x', Fr(rd), X(rs));
  return text === undefined ? undefined : { text };
}

export interface Decoded {
  readonly text: string;
  readonly memory?: 'load' | 'store';
  readonly base?: string;
  readonly offset?: number;
  readonly reg?: string;
}

/** One word at byte address `pc`, as assembly text (branch and jump targets as absolute addresses). */
export function decode(word: number, pc: number): Decoded {
  const opcode = word & 127,
    rd = (word >>> 7) & 31,
    f = (word >>> 12) & 7,
    rs = (word >>> 15) & 31;
  const rt = (word >>> 20) & 31,
    top = word >>> 25,
    imm = word >> 20;
  const [d, a, b] = [rd, rs, rt].map(i => REGS[i]);
  const fmt = (mnemonic: string, ...args: (string | number)[]) => mnemonic + ' ' + args.join(', ');
  if (word >>> 0 === 0x00100073) return { text: 'ebreak' };
  if (opcode === 0x07 || opcode === 0x27 || opcode === 0x53) {
    const fl = decodeFloat(word);
    if (fl) return fl;
  }
  if (opcode === 3 || opcode === 35) {
    const load = opcode === 3;
    const offset = load ? imm : sext((top << 5) | rd, 12);
    const op = (load ? ['lb', 'lh', 'lw', null, 'lbu', 'lhu'] : ['sb', 'sh', 'sw'])[f];
    if (op)
      return {
        text: fmt(op, load ? d : b, offset + '(' + a + ')'),
        memory: load ? 'load' : 'store',
        base: a,
        offset,
        reg: load ? d : b,
      };
  }
  let text: string | undefined;
  if (opcode === 0x37) text = fmt('lui', d, hex(word >>> 12));
  if (opcode === 0x13) {
    const op = ['addi', 'slli', 'slti', 'sltiu', 'xori', top === 32 ? 'srai' : 'srli', 'ori', 'andi'][f];
    text = fmt(op, d, a, f === 1 || f === 5 ? rt : imm);
  }
  if (opcode === 0x33) {
    const op =
      top === 1
        ? ['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu'][f]
        : [top === 32 ? 'sub' : 'add', 'sll', 'slt', 'sltu', 'xor', top === 32 ? 'sra' : 'srl', 'or', 'and'][
            f
          ];
    text = fmt(op, d, a, b);
  }
  if (opcode === 0x63) {
    const delta = sext(
      ((word >>> 31) << 12) |
        (((word >>> 7) & 1) << 11) |
        (((word >>> 25) & 63) << 5) |
        (((word >>> 8) & 15) << 1),
      13,
    );
    const name = ['beq', 'bne', null, null, 'blt', 'bge', 'bltu', 'bgeu'][f];
    if (name) text = fmt(name, a, b, hex(pc + delta));
  }
  if (opcode === 0x6f) {
    const delta = sext(
      ((word >>> 31) << 20) | (word & 0xff000) | (((word >>> 20) & 1) << 11) | (((word >>> 21) & 1023) << 1),
      21,
    );
    text = fmt('jal', d, hex(pc + delta));
  }
  if (opcode === 0x67) text = word >>> 0 === 0x00008067 ? 'ret' : fmt('jalr', d, imm + '(' + a + ')');
  return { text: text ?? '.word ' + hex(word >>> 0) };
}

// ---------- machine instructions ----------
/**
 * A machine instruction: `{ op, rd, rs1, rs2, imm, target, callee, covers }`. Registers below 64 are physical;
 * 64 and up are virtual. Labels are `{ op: 'label', name }` and take no bytes. `covers` lists the value and the
 * statement (or the function, for frame code) the instruction implements; the rest explains why it exists.
 */
export interface MInsn {
  op: string;
  rd?: number;
  rs1?: number;
  rs2?: number;
  imm?: number;
  /** A label: a block id, `exit`, or a local `Ln`. */
  target?: string;
  callee?: string;
  argc?: number;
  covers: string[];
  /** Labels: the label's name, and the block it starts. */
  name?: string;
  block?: string;
  /** A register copy (`addi rd, rs1, 0`), removed when allocation gives both sides one register. */
  mv?: boolean;
  /** The entry copy of parameter `param` out of its argument register. */
  param?: number;
  /** The entry zeroing of local `zero`, live on entry and not a parameter. */
  zero?: number;
  why?: string;
  note?: string;
  spill?: 'reload' | 'store';
  /** RV32F: the rounding mode the instruction names (RNE, RTZ, RDN, RUP); never dynamic. */
  rm?: number;
  /**
   * A load or store at the caller's sp (an incoming stack argument, a result leaf the callee writes): `imm` is the
   * word's offset from the caller's sp, and finishing adds the frame size.
   */
  caller?: boolean;
  /** A write of a physical result register in a record return: no value live across it may be given that register. */
  pins?: boolean;
}

export const R3: Readonly<Record<string, readonly [number, number]>> = {
  add: [0, 0],
  sub: [0, 32],
  sll: [1, 0],
  slt: [2, 0],
  sltu: [3, 0],
  xor: [4, 0],
  srl: [5, 0],
  sra: [5, 32],
  or: [6, 0],
  and: [7, 0],
  mul: [0, 1],
  mulh: [1, 1],
  div: [4, 1],
  rem: [6, 1],
};
export const I3: Readonly<Record<string, number>> = {
  addi: 0,
  slti: 2,
  sltiu: 3,
  xori: 4,
  ori: 6,
  andi: 7,
  slli: 1,
  srli: 5,
  srai: 5,
};
export const BR: Readonly<Record<string, number>> = { beq: 0, bne: 1, blt: 4, bge: 5, bltu: 6, bgeu: 7 };
export const INVERT: Readonly<Record<string, string>> = {
  beq: 'bne',
  bne: 'beq',
  blt: 'bge',
  bge: 'blt',
  bltu: 'bgeu',
  bgeu: 'bltu',
};
export const ZERO = 0,
  RA = 1,
  SP = 2,
  A0 = 10,
  T5 = 30,
  T6 = 31;
/** t0-t2, t3, t4 (t5 and t6 are kept back as spill scratch). */
export const CALLER: readonly number[] = [5, 6, 7, 28, 29];
/** a1-a7, then a0: allocatable only in leaf functions, where no call clobbers them. */
export const ARGS: readonly number[] = [11, 12, 13, 14, 15, 16, 17, 10];
/** s1-s11 (s0, sp, ra, gp and tp are never allocated). */
export const CALLEE: readonly number[] = [9, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];

// f registers (f_n = 32 + n)
export const F0 = 32,
  FA0 = 42,
  FT10 = 62,
  FT11 = 63;
/** ft0-ft7, ft8, ft9 (ft10 and ft11 are kept back as spill scratch). */
export const F_CALLER: readonly number[] = [32, 33, 34, 35, 36, 37, 38, 39, 60, 61];
/** fa1-fa7, then fa0: allocatable only in leaf functions. */
export const F_ARGS: readonly number[] = [43, 44, 45, 46, 47, 48, 49, 42];
/** fs0, fs1, fs2-fs11: a function that uses one saves and restores it. */
export const F_CALLEE: readonly number[] = [40, 41, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59];
/** Rounding modes named statically (funct3). */
export const RNE = 0,
  RTZ = 1,
  RDN = 2,
  RUP = 3;
/** The class of a physical register: 'f' for f0-f31, 'x' otherwise. */
export const physClass = (r: number): 'x' | 'f' => (r >= 32 && r < 64 ? 'f' : 'x');
export const fits12 = (n: number): boolean => n >= -2048 && n <= 2047;
export const log2 = (n: number): number => (n > 0 && (n & (n - 1)) === 0 ? 31 - Math.clz32(n) : -1);
export const isTerminal = (op: string): boolean =>
  op === 'j' || op === 'ret' || op === 'ebreak' || op === 'jexit';
export const isBranch = (op: string): boolean => op in BR;

export const RET_WORD = 0x00008067,
  EBREAK_WORD = 0x00100073;

/**
 * RV32F operations: [funct7, funct3 or 'rm' (the instruction's rounding mode), rs2 (a fixed field) or 'f' (an f
 * register), and the classes of rd and rs1].
 */
type FloatRow = readonly [number, number | 'rm', number | 'f', 'x' | 'f', 'x' | 'f'];
export const FLOAT_OPS: Readonly<Record<string, FloatRow>> = {
  'fadd.s': [0x00, 'rm', 'f', 'f', 'f'],
  'fsub.s': [0x04, 'rm', 'f', 'f', 'f'],
  'fmul.s': [0x08, 'rm', 'f', 'f', 'f'],
  'fdiv.s': [0x0c, 'rm', 'f', 'f', 'f'],
  'fsqrt.s': [0x2c, 'rm', 0, 'f', 'f'],
  'fsgnj.s': [0x10, 0, 'f', 'f', 'f'],
  'fsgnjn.s': [0x10, 1, 'f', 'f', 'f'],
  'fsgnjx.s': [0x10, 2, 'f', 'f', 'f'],
  'fmin.s': [0x14, 0, 'f', 'f', 'f'],
  'fmax.s': [0x14, 1, 'f', 'f', 'f'],
  'feq.s': [0x50, 2, 'f', 'x', 'f'],
  'flt.s': [0x50, 1, 'f', 'x', 'f'],
  'fle.s': [0x50, 0, 'f', 'x', 'f'],
  'fcvt.w.s': [0x60, 'rm', 0, 'x', 'f'],
  'fcvt.wu.s': [0x60, 'rm', 1, 'x', 'f'],
  'fcvt.s.w': [0x68, 'rm', 0, 'f', 'x'],
  'fcvt.s.wu': [0x68, 'rm', 1, 'f', 'x'],
  'fmv.x.w': [0x70, 0, 0, 'x', 'f'],
  'fmv.w.x': [0x78, 0, 0, 'f', 'x'],
};
/** The class of each register operand of a machine instruction: rd, rs1, rs2 (undefined when it has none). */
export function operandClasses(op: string): readonly ['x' | 'f' | undefined, 'x' | 'f' | undefined, 'x' | 'f' | undefined] {
  const row = FLOAT_OPS[op];
  if (row) return [row[3], row[4], row[2] === 'f' ? 'f' : undefined];
  if (op === 'flw') return ['f', 'x', undefined];
  if (op === 'fsw') return [undefined, 'x', 'f'];
  return ['x', 'x', 'x'];
}

/** Encode one finished instruction at `pc`, with its function's labels and every function's entry known. */
export function encodeOne(
  m: MInsn,
  pc: number,
  labelAt: ReadonlyMap<string, number>,
  entries: Readonly<Record<string, number>>,
): number {
  const rel = (name: string | undefined) => {
    const t = name === undefined ? undefined : labelAt.get(name);
    if (t === undefined) fail('internal', `no label ${name}`);
    return t - pc;
  };
  const rd = m.rd!,
    rs1 = m.rs1!,
    rs2 = m.rs2!;
  // every register field must hold a physical register of the class the instruction reads it as
  const [cd, c1, c2] = operandClasses(m.op);
  const field = (r: number | undefined, cls: 'x' | 'f' | undefined, name: string): void => {
    if (cls === undefined || r === undefined) return;
    if (!(r >= 0 && r < 64) || physClass(r) !== cls)
      fail('internal', `${m.op}: ${name} ${r} is not an ${cls} register`);
  };
  field(m.rd, cd, 'rd');
  field(m.rs1, c1, 'rs1');
  field(m.rs2, c2, 'rs2');
  const frow = FLOAT_OPS[m.op];
  if (frow) {
    const [f7, f3, r2] = frow;
    const mode = f3 === 'rm' ? m.rm : f3;
    if (mode === undefined || mode < 0 || mode > 4) fail('internal', `${m.op} needs a static rounding mode`);
    return instruction.r(0x53, rd & 31, mode, rs1 & 31, r2 === 'f' ? rs2 & 31 : r2, f7);
  }
  if (m.op === 'flw') return instruction.i(0x07, rd & 31, 2, rs1, m.imm!);
  if (m.op === 'fsw') return (instruction.s(2, rs1, rs2 & 31, m.imm!) & ~0x7f) | 0x27;
  if (m.op in R3) {
    const [f3, f7] = R3[m.op];
    return instruction.r(0x33, rd, f3, rs1, rs2, f7);
  }
  if (m.op in I3) {
    let imm = m.imm!;
    if (m.op === 'srai') imm = 0x400 | (imm & 31);
    if (m.op === 'slli' || m.op === 'srli') imm &= 31;
    return instruction.i(0x13, rd, I3[m.op], rs1, imm);
  }
  if (m.op === 'lw') return instruction.i(0x03, rd, 2, rs1, m.imm!);
  if (m.op === 'lhu') return instruction.i(0x03, rd, 5, rs1, m.imm!);
  if (m.op === 'sw') return instruction.s(2, rs1, rs2, m.imm!);
  if (m.op === 'sh') return instruction.s(1, rs1, rs2, m.imm!);
  if (m.op === 'lui') return ((m.imm! & 0xfffff) << 12) | (rd << 7) | 0x37;
  if (m.op in BR) {
    const d = rel(m.target);
    if (d < -4096 || d > 4094) fail('branchRange', `branch of ${d} bytes is out of range`);
    return instruction.b(BR[m.op], rs1, rs2, d);
  }
  if (m.op === 'j') return instruction.j(ZERO, rel(m.target));
  if (m.op === 'call') {
    const t = entries[m.callee!];
    if (t === undefined) fail('internal', `no entry ${m.callee}`);
    return instruction.j(RA, t - pc);
  }
  if (m.op === 'ret') return RET_WORD;
  if (m.op === 'ebreak') return EBREAK_WORD;
  return fail('internal', `cannot encode ${m.op}`);
}
