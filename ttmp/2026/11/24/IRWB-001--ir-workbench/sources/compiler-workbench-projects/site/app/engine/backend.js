// backend.js: instruction selection by tiling value trees, linear-scan register allocation,
// frames, encoding with the reused RV32 encoders, the reused disassembler, images as
// entities whose instructions cover statements and values, and runs on the reused emulator.
(function (G) {
'use strict';
const WB = G.WB;

// ---------- reused: encoders, from compiler/rv32/00-encoding.js (unchanged) ----------
const instruction = {
  r: (op, rd, f3, a, b, f7 = 0) => (f7 << 25) | (b << 20) | (a << 15) | (f3 << 12) | (rd << 7) | op,
  i: (op, rd, f3, a, imm) => (imm << 20) | (a << 15) | (f3 << 12) | (rd << 7) | op,
  s: (f3, a, b, imm) => ((imm >> 5) << 25) | (b << 20) | (a << 15) | (f3 << 12) | ((imm & 31) << 7) | 0x23,
  b: (f3, a, b, imm) => ((imm & 0x1000) << 19) | ((imm & 0x7e0) << 20) | (b << 20) |
    (a << 15) | (f3 << 12) | ((imm & 0x1e) << 7) | ((imm & 0x800) >> 4) | 0x63,
  j: (rd, imm) => ((imm & 0x100000) << 11) | ((imm & 0x7fe) << 20) | ((imm & 0x800) << 9) |
    (imm & 0xff000) | (rd << 7) | 0x6f,
};
// Signed division by a constant d in [3, 2^31) that is not a power of two (Hacker's Delight 10-1).
function divisionMagic(d) {
  const two31 = 2147483648, anc = two31 - 1 - two31 % d;
  let p = 31, q1 = Math.floor(two31 / anc), r1 = two31 - q1 * anc;
  let q2 = Math.floor(two31 / d), r2 = two31 - q2 * d, delta;
  do {
    p++;
    q1 *= 2; r1 *= 2;
    if (r1 >= anc) { q1++; r1 -= anc; }
    q2 *= 2; r2 *= 2;
    if (r2 >= d) { q2++; r2 -= d; }
    delta = d - r2;
  } while (q1 < delta || (q1 === delta && r1 === 0));
  return { magic: (q2 + 1) | 0, shift: p - 32 };
}
WB.divisionMagic = divisionMagic;

// ---------- reused: disassembler, from tools/typed-inspect/rv32.mjs (PIE words dropped) ----------
const REGS = 'zero ra sp gp tp t0 t1 t2 s0 s1 a0 a1 a2 a3 a4 a5 a6 a7 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 t3 t4 t5 t6'.split(' ');
const sext = (n, bits) => (n << (32 - bits)) >> (32 - bits);
const hex = n => '0x' + n.toString(16);
function decode(word, pc) {
  const opcode = word & 127, rd = (word >>> 7) & 31, f = (word >>> 12) & 7, rs = (word >>> 15) & 31;
  const rt = (word >>> 20) & 31, top = word >>> 25, imm = word >> 20;
  const [d, a, b] = [rd, rs, rt].map(i => REGS[i]);
  const fmt = (mnemonic, ...args) => mnemonic + ' ' + args.join(', ');
  if (word === 0x00100073) return { text: 'ebreak' };
  if (opcode === 3 || opcode === 35) {
    const load = opcode === 3;
    const offset = load ? imm : sext((top << 5) | rd, 12);
    const op = (load ? ['lb', 'lh', 'lw', null, 'lbu', 'lhu'] : ['sb', 'sh', 'sw'])[f];
    if (op) return { text: fmt(op, load ? d : b, offset + '(' + a + ')'), memory: load ? 'load' : 'store', base: a, offset, reg: load ? d : b };
  }
  let text;
  if (opcode === 0x37) text = fmt('lui', d, hex(word >>> 12));
  if (opcode === 0x13) {
    const op = ['addi', 'slli', 'slti', 'sltiu', 'xori', top === 32 ? 'srai' : 'srli', 'ori', 'andi'][f];
    text = fmt(op, d, a, f === 1 || f === 5 ? rt : imm);
  }
  if (opcode === 0x33) {
    const op = top === 1 ? ['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu'][f] :
      [top === 32 ? 'sub' : 'add', 'sll', 'slt', 'sltu', 'xor', top === 32 ? 'sra' : 'srl', 'or', 'and'][f];
    text = fmt(op, d, a, b);
  }
  if (opcode === 0x63) {
    const delta = sext(((word >>> 31) << 12) | (((word >>> 7) & 1) << 11) | (((word >>> 25) & 63) << 5) | (((word >>> 8) & 15) << 1), 13);
    const name = ['beq', 'bne', null, null, 'blt', 'bge', 'bltu', 'bgeu'][f];
    if (name) text = fmt(name, a, b, hex(pc + delta));
  }
  if (opcode === 0x6f) {
    const delta = sext(((word >>> 31) << 20) | (word & 0xff000) | (((word >>> 20) & 1) << 11) | (((word >>> 21) & 1023) << 1), 21);
    text = fmt('jal', d, hex(pc + delta));
  }
  if (opcode === 0x67) text = word === 0x00008067 ? 'ret' : fmt('jalr', d, imm + '(' + a + ')');
  return { text: text ?? ('.word ' + hex(word)) };
}
WB.decode = decode;
WB.REGS = REGS;

// ---------- machine instructions ----------
// A machine instruction is { op, rd, rs1, rs2, imm, target, callee, covers }. Registers below
// 64 are physical; 64 and up are virtual. Labels are { op: 'label', name } and take no bytes.
const R3 = { add: [0, 0], sub: [0, 32], sll: [1, 0], slt: [2, 0], sltu: [3, 0], xor: [4, 0], srl: [5, 0], sra: [5, 32], or: [6, 0], and: [7, 0], mul: [0, 1], mulh: [1, 1], div: [4, 1], rem: [6, 1] };
const I3 = { addi: 0, slti: 2, sltiu: 3, xori: 4, ori: 6, andi: 7, slli: 1, srli: 5, srai: 5 };
const BR = { beq: 0, bne: 1, blt: 4, bge: 5, bltu: 6, bgeu: 7 };
const INVERT = { beq: 'bne', bne: 'beq', blt: 'bge', bge: 'blt', bltu: 'bgeu', bgeu: 'bltu' };
const ZERO = 0, RA = 1, SP = 2, A0 = 10, T5 = 30, T6 = 31;
const CALLER = [5, 6, 7, 28, 29], ARGS = [11, 12, 13, 14, 15, 16, 17, 10], CALLEE = [9, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
const fits12 = n => n >= -2048 && n <= 2047;
const log2 = n => n > 0 && (n & (n - 1)) === 0 ? 31 - Math.clz32(n) : -1;
const isTerminal = op => op === 'j' || op === 'ret' || op === 'ebreak' || op === 'jexit';
const isBranch = op => op in BR;

WB.backendDefaults = { registers: 'all', fuse: true, immediates: true, divmagic: true, useRanges: true, order: 'caller', spill: 'furthest', hints: true, layout: 'source' };

// ---------- instruction selection: tile each statement's value tree ----------
function select(p, f, o) {
  const st = p.store, code = [];
  let nv = 64, stmt = null;
  const fresh = () => nv++;
  const localReg = f.locals.map(() => fresh());
  const hints = new Map();
  const ranges = o.useRanges ? WB.factOf(p, 'ranges', f.name).value : null;
  const emit = (op, fields = {}, value) => { code.push({ op, ...fields, covers: [value, stmt].filter(Boolean) }); };
  const li = (rd, c, v) => {
    c |= 0;
    if (fits12(c)) return emit('addi', { rd, rs1: ZERO, imm: c }, v);
    let hi = ((c + 0x800) >>> 12) & 0xfffff, lo = c - ((hi << 12) | 0); lo = (lo << 20) >> 20;
    emit('lui', { rd, imm: hi }, v);
    if (lo) emit('addi', { rd, rs1: rd, imm: lo }, v);
  };
  const isConst = id => st.get(id).op === 'const';
  const cval = id => st.get(id).imm | 0;
  const rangeOf = id => ranges && stmt ? ranges.of(stmt, id) : [WB.lattice.MIN, WB.lattice.MAX];
  let labels = 0;
  const newLabel = () => `L${labels++}`;
  // base + offset folding for loads and stores
  const address = (id, extra) => {
    const v = st.get(id);
    if (o.immediates && v.op === 'add' && isConst(v.args[1]) && fits12(cval(v.args[1]) + extra)) return [val(v.args[0]), cval(v.args[1]) + extra];
    if (o.immediates && v.op === 'add' && isConst(v.args[0]) && fits12(cval(v.args[0]) + extra)) return [val(v.args[1]), cval(v.args[0]) + extra];
    if (fits12(extra)) return [val(id), extra];
    const r = fresh(); li(r, extra, id); const s = fresh(); emit('add', { rd: s, rs1: val(id), rs2: r }, id); return [s, 0];
  };
  function compare(op, a, b, rd, id) {
    const A = val(a);
    if (o.immediates && isConst(b)) {
      const c = cval(b);
      if (op === 'lt' && fits12(c)) return emit('slti', { rd, rs1: A, imm: c }, id);
      if (op === 'ltu' && fits12(c)) return emit('sltiu', { rd, rs1: A, imm: c }, id);
      if (op === 'ge' && fits12(c)) { emit('slti', { rd, rs1: A, imm: c }, id); return emit('xori', { rd, rs1: rd, imm: 1 }, id); }
      if (op === 'geu' && fits12(c)) { emit('sltiu', { rd, rs1: A, imm: c }, id); return emit('xori', { rd, rs1: rd, imm: 1 }, id); }
      if (op === 'le' && fits12(c + 1) && c !== WB.lattice.MAX) return emit('slti', { rd, rs1: A, imm: c + 1 }, id);
      if (op === 'gt' && fits12(c + 1) && c !== WB.lattice.MAX) { emit('slti', { rd, rs1: A, imm: c + 1 }, id); return emit('xori', { rd, rs1: rd, imm: 1 }, id); }
      if (op === 'eq' && fits12(c)) { if (c) { emit('xori', { rd, rs1: A, imm: c }, id); return emit('sltiu', { rd, rs1: rd, imm: 1 }, id); } return emit('sltiu', { rd, rs1: A, imm: 1 }, id); }
      if (op === 'ne' && fits12(c)) { if (c) { emit('xori', { rd, rs1: A, imm: c }, id); return emit('sltu', { rd, rs1: ZERO, rs2: rd }, id); } return emit('sltu', { rd, rs1: ZERO, rs2: A }, id); }
    }
    const B = val(b);
    switch (op) {
      case 'lt': return emit('slt', { rd, rs1: A, rs2: B }, id);
      case 'ltu': return emit('sltu', { rd, rs1: A, rs2: B }, id);
      case 'gt': return emit('slt', { rd, rs1: B, rs2: A }, id);
      case 'gtu': return emit('sltu', { rd, rs1: B, rs2: A }, id);
      case 'ge': emit('slt', { rd, rs1: A, rs2: B }, id); return emit('xori', { rd, rs1: rd, imm: 1 }, id);
      case 'geu': emit('sltu', { rd, rs1: A, rs2: B }, id); return emit('xori', { rd, rs1: rd, imm: 1 }, id);
      case 'le': emit('slt', { rd, rs1: B, rs2: A }, id); return emit('xori', { rd, rs1: rd, imm: 1 }, id);
      case 'leu': emit('sltu', { rd, rs1: B, rs2: A }, id); return emit('xori', { rd, rs1: rd, imm: 1 }, id);
      case 'eq': emit('xor', { rd, rs1: A, rs2: B }, id); return emit('sltiu', { rd, rs1: rd, imm: 1 }, id);
      case 'ne': emit('xor', { rd, rs1: A, rs2: B }, id); return emit('sltu', { rd, rs1: ZERO, rs2: rd }, id);
    }
  }
  function divide(op, a, b, rd, id) {
    const rb = rangeOf(b), ra = rangeOf(a);
    if (isConst(b) && cval(b) !== 0 && cval(b) !== -1 && o.divmagic && op === 'div') {
      const d = cval(b), n = val(a), k = log2(Math.abs(d));
      if (k > 0) { // n / 2^k rounds toward zero: add 2^k - 1 to negative n before the shift
        const t = fresh();
        if (ra[0] >= 0) emit('srai', { rd, rs1: n, imm: k }, id);
        else {
          emit('srai', { rd: t, rs1: n, imm: 31 }, id); emit('srli', { rd: t, rs1: t, imm: 32 - k }, id);
          emit('add', { rd: t, rs1: n, rs2: t }, id); emit('srai', { rd, rs1: t, imm: k }, id);
        }
        if (d < 0) emit('sub', { rd, rs1: ZERO, rs2: rd }, id);
        return;
      }
      if (Math.abs(d) >= 3) {
        const { magic, shift } = divisionMagic(Math.abs(d)), m = fresh(), q = fresh(), s = fresh();
        li(m, magic, id); emit('mulh', { rd: q, rs1: n, rs2: m }, id);
        if (magic < 0) emit('add', { rd: q, rs1: q, rs2: n }, id);
        if (shift) emit('srai', { rd: q, rs1: q, imm: shift }, id);
        emit('srli', { rd: s, rs1: n, imm: 31 }, id);
        emit('add', { rd, rs1: q, rs2: s }, id);
        if (d < 0) emit('sub', { rd, rs1: ZERO, rs2: rd }, id);
        return;
      }
    }
    const A = val(a), B = isConst(b) && cval(b) === 0 ? ZERO : val(b);
    const zeroFree = isConst(b) ? cval(b) !== 0 : (rb[0] > 0 || rb[1] < 0);
    if (!zeroFree) { const L = newLabel(); emit('bne', { rs1: B, rs2: ZERO, target: L, why: 'division by zero' }, id); emit('ebreak', { why: 'division by zero' }, id); emit('label', { name: L }); }
    const overflowFree = op === 'rem' || (isConst(b) ? cval(b) !== -1 : (rb[0] > -1 || rb[1] < -1)) || (isConst(a) ? cval(a) !== WB.lattice.MIN : ra[0] > WB.lattice.MIN);
    if (!overflowFree) {
      const L = newLabel(), k = fresh(), m = fresh();
      li(k, -1, id); emit('bne', { rs1: B, rs2: k, target: L, why: 'overflow' }, id);
      li(m, WB.lattice.MIN, id); emit('bne', { rs1: A, rs2: m, target: L, why: 'overflow' }, id);
      emit('ebreak', { why: 'integer overflow' }, id); emit('label', { name: L });
    }
    emit(op, { rd, rs1: A, rs2: B }, id);
  }
  function val(id, want) {
    const v = st.get(id), out = () => want ?? fresh();
    switch (v.op) {
      case 'const': { if (v.imm === 0 && want === undefined && o.immediates) return ZERO; const rd = out(); li(rd, v.imm, id); return rd; }
      case 'get': { const r = localReg[v.imm]; if (want !== undefined && want !== r) { emit('addi', { rd: want, rs1: r, imm: 0, mv: true }, id); return want; } return r; }
      case 'load': case 'load16u': { const [base, off] = address(v.args[0], v.imm || 0); const rd = out(); emit(v.op === 'load' ? 'lw' : 'lhu', { rd, rs1: base, imm: off }, id); return rd; }
      case 'eqz': { const a = val(v.args[0]), rd = out(); emit('sltiu', { rd, rs1: a, imm: 1 }, id); return rd; }
      case 'call': {
        if (v.args.length > 8) WB.fail('unsupported', `${f.name}: calls with more than 8 arguments`);
        const regs = v.args.map(a => val(a));
        regs.forEach((r, i) => emit('addi', { rd: A0 + i, rs1: r, imm: 0, mv: true }, id));
        emit('call', { callee: v.imm, argc: regs.length }, id);
        const rd = out(); emit('addi', { rd, rs1: A0, imm: 0, mv: true }, id); return rd;
      }
    }
    const [a, b] = v.args, rd = out();
    if (WB.COMPARE.has(v.op) || v.op === 'gtu' || v.op === 'leu') { compare(v.op, a, b, rd, id); return rd; }
    if (v.op === 'div' || v.op === 'rem') { divide(v.op, a, b, rd, id); return rd; }
    if (o.immediates && isConst(b)) {
      const c = cval(b), I = { add: 'addi', and: 'andi', or: 'ori', xor: 'xori' }[v.op];
      if (I && fits12(c)) { emit(I, { rd, rs1: val(a), imm: c }, id); return rd; }
      if (v.op === 'sub' && fits12(-c)) { emit('addi', { rd, rs1: val(a), imm: -c }, id); return rd; }
      const S = { shl: 'slli', shr: 'srai', shru: 'srli' }[v.op];
      if (S) { emit(S, { rd, rs1: val(a), imm: c & 31 }, id); return rd; }
      if (v.op === 'mul' && log2(c) >= 0) { emit('slli', { rd, rs1: val(a), imm: log2(c) }, id); return rd; }
    }
    if (o.immediates && isConst(a) && ['add', 'and', 'or', 'xor', 'mul'].includes(v.op)) {
      const c = cval(a), I = { add: 'addi', and: 'andi', or: 'ori', xor: 'xori' }[v.op];
      if (I && fits12(c)) { emit(I, { rd, rs1: val(b), imm: c }, id); return rd; }
      if (v.op === 'mul' && log2(c) >= 0) { emit('slli', { rd, rs1: val(b), imm: log2(c) }, id); return rd; }
    }
    const R = { add: 'add', sub: 'sub', mul: 'mul', and: 'and', or: 'or', xor: 'xor', shl: 'sll', shr: 'sra', shru: 'srl' }[v.op];
    if (!R) WB.fail('unsupported', `the backend has no tile for "${v.op}" (${id})`);
    const A = val(a), B = val(b);
    emit(R, { rd, rs1: A, rs2: B }, id);
    return rd;
  }
  // branches: fuse the comparison into the branch when the condition is one
  function branch(condId, then, els, next) {
    let c = st.get(condId), br, A, B;
    let negate = false;
    while (o.fuse && c.op === 'eqz') { negate = !negate; condId = c.args[0]; c = st.get(condId); }
    const FUSE = { lt: ['blt', 0], ge: ['bge', 0], gt: ['blt', 1], le: ['bge', 1], ltu: ['bltu', 0], geu: ['bgeu', 0], gtu: ['bltu', 1], leu: ['bgeu', 1], eq: ['beq', 0], ne: ['bne', 0] };
    if (o.fuse && FUSE[c.op]) {
      const [name, swap] = FUSE[c.op];
      const x = isConst(c.args[0]) && cval(c.args[0]) === 0 ? ZERO : val(c.args[0]);
      const y = isConst(c.args[1]) && cval(c.args[1]) === 0 ? ZERO : val(c.args[1]);
      [A, B] = swap ? [y, x] : [x, y]; br = name;
    } else { A = val(condId); B = ZERO; br = 'bne'; }
    if (negate) br = INVERT[br];
    if (then === next) emit(INVERT[br], { rs1: A, rs2: B, target: els }, condId);
    else { emit(br, { rs1: A, rs2: B, target: then }, condId); if (els !== next) emit('j', { target: els }, condId); }
  }

  // entry: copy parameters out of a0..a7, zero the locals read before they are written
  emit('label', { name: 'entry' });
  if (f.params.length > 8) WB.fail('unsupported', `${f.name}: more than 8 parameters`);
  f.params.forEach((_, i) => { emit('addi', { rd: localReg[i], rs1: A0 + i, imm: 0, mv: true, param: i }); hints.set(localReg[i], A0 + i); });
  const live = WB.factOf(p, 'liveness', f.name).value;
  const liveIn = live.in.get(f.blocks[0].id) || new Set();
  for (const l of liveIn) if (!f.locals[l].param) emit('addi', { rd: localReg[l], rs1: ZERO, imm: 0, zero: l });
  const order = f.blocks.map(b => b.id);
  order.forEach((bid, k) => {
    const b = st.get(bid), next = order[k + 1] ?? null;
    emit('label', { name: bid, block: bid });
    for (const sid of b.stmts) {
      stmt = sid;
      const s = st.get(sid);
      switch (s.op) {
        case 'set': val(s.value, localReg[s.local]); break;
        case 'eval': val(s.value); break;
        case 'store': { const [base, off] = address(s.addr, s.offset || 0); const v = isConst(s.value) && cval(s.value) === 0 ? ZERO : val(s.value); emit(s.width === 16 ? 'sh' : 'sw', { rs1: base, rs2: v, imm: off }, s.value); break; }
        case 'br': if (s.to !== next) emit('j', { target: s.to }); break;
        case 'br_if': branch(s.cond, s.then, s.else, next); break;
        case 'return': { if (s.value) { const r = val(s.value); hints.set(r, A0); emit('addi', { rd: A0, rs1: r, imm: 0, mv: true }, s.value); } else emit('addi', { rd: A0, rs1: ZERO, imm: 0 }); emit('jexit', {}); break; }
        case 'trap': emit('ebreak', { why: s.why || 'unreachable' }); break;
        default: WB.fail('unsupported', `the backend has no tile for statement "${s.op}" (${sid})`);
      }
    }
    stmt = null;
  });
  return { code, localReg, hints, vregs: nv - 64 };
}

// ---------- liveness over machine code, intervals, linear scan ----------
const uses = m => [m.rs1, m.rs2].filter(r => r !== undefined && r >= 64);
const defs = m => (m.rd !== undefined && m.rd >= 64 && m.op !== 'label') ? [m.rd] : [];
function machineBlocks(code) {
  const blocks = [], at = new Map();
  let cur = null;
  code.forEach((m, i) => {
    if (m.op === 'label' || !cur) { cur = { start: i, end: i, labels: [], succ: [] }; blocks.push(cur); }
    if (m.op === 'label') { cur.labels.push(m.name); at.set(m.name, blocks.length - 1); }
    cur.end = i;
    if (isBranch(m.op) || isTerminal(m.op)) cur = null;
  });
  blocks.forEach((b, k) => {
    const last = code[b.end];
    if (isBranch(last.op)) b.succ.push(at.get(last.target));
    if (last.op === 'j') b.succ.push(at.get(last.target));
    if (!isTerminal(last.op) && k + 1 < blocks.length) b.succ.push(k + 1);
  });
  return blocks;
}
function intervals(code) {
  const blocks = machineBlocks(code);
  const use = blocks.map(() => new Set()), def = blocks.map(() => new Set());
  blocks.forEach((b, k) => { for (let i = b.start; i <= b.end; i++) { for (const r of uses(code[i])) if (!def[k].has(r)) use[k].add(r); for (const r of defs(code[i])) def[k].add(r); } });
  const IN = blocks.map(() => new Set()), OUT = blocks.map(() => new Set());
  for (let changed = true; changed;) {
    changed = false;
    for (let k = blocks.length - 1; k >= 0; k--) {
      const out = new Set(); for (const s of blocks[k].succ) for (const r of IN[s]) out.add(r);
      const inn = new Set(use[k]); for (const r of out) if (!def[k].has(r)) inn.add(r);
      if (inn.size !== IN[k].size || out.size !== OUT[k].size) { IN[k] = inn; OUT[k] = out; changed = true; }
    }
  }
  const iv = new Map();
  const touch = (r, i) => { const x = iv.get(r); if (!x) iv.set(r, { reg: r, start: i, end: i, uses: 1 }); else { x.start = Math.min(x.start, i); x.end = Math.max(x.end, i); x.uses++; } };
  blocks.forEach((b, k) => {
    for (const r of IN[k]) touch(r, b.start);
    for (const r of OUT[k]) touch(r, b.end + 0.5);
    for (let i = b.start; i <= b.end; i++) { for (const r of uses(code[i])) touch(r, i); for (const r of defs(code[i])) touch(r, i); }
  });
  const calls = code.map((m, i) => m.op === 'call' ? i : -1).filter(i => i >= 0);
  for (const x of iv.values()) x.crossesCall = calls.some(c => x.start < c && x.end > c);
  return { list: [...iv.values()].sort((a, b) => a.start - b.start || a.reg - b.reg), blocks, liveOut: OUT };
}
function allocate(code, hints, o, leaf) {
  const { list } = intervals(code);
  // caller-saved first; a0..a7 only in leaf functions (a call would clobber them); callee-saved last
  let pool = leaf ? [...CALLER, ...ARGS, ...CALLEE] : [...CALLER, ...CALLEE];
  if (o.order === 'callee') pool = [...CALLEE, ...pool.filter(r => !CALLEE.includes(r))]; // s-registers first: every one used is saved and restored
  if (o.registers !== 'all') pool = pool.slice(0, Math.max(1, +o.registers));
  if (!o.hints) hints = new Map();
  // a0..a7 hold the parameters until each is copied: reserve them until then
  const fixed = new Map();
  code.forEach((m, i) => { if (m.param !== undefined) fixed.set(A0 + m.param, i); });
  const assign = new Map(), spilled = new Set();
  let active = [];
  const free = new Set(pool);
  const okFor = (r, x) => (!x.crossesCall || CALLEE.includes(r)) && !(fixed.has(r) && x.start < fixed.get(r));
  for (const x of list) {
    active = active.filter(a => { if (a.end <= x.start) { free.add(assign.get(a.reg)); return false; } return true; });
    const hint = hints.get(x.reg);
    let r = hint !== undefined && free.has(hint) && okFor(hint, x) ? hint : pool.find(q => free.has(q) && okFor(q, x));
    if (r === undefined) {
      // spill 'furthest': whichever of x and the active intervals it could take a register from ends last
      // spill 'current': always x, the interval that found no register
      const cand = o.spill === 'current' ? null : active.filter(a => okFor(assign.get(a.reg), x)).sort((a, b) => b.end - a.end)[0];
      if (cand && cand.end > x.end) { r = assign.get(cand.reg); assign.delete(cand.reg); spilled.add(cand.reg); active = active.filter(a => a !== cand); }
      else { spilled.add(x.reg); continue; }
    }
    free.delete(r); assign.set(x.reg, r); active.push(x);
  }
  return { assign, spilled, intervals: list };
}

// ---------- rewriting, frames, encoding ----------
function finish(f, code, alloc, leaf) {
  const { assign, spilled } = alloc;
  const slots = new Map([...spilled].map((r, i) => [r, 4 * i]));
  const usedCallee = [...new Set([...assign.values()].filter(r => CALLEE.includes(r)))].sort((a, b) => a - b);
  const saved = (leaf ? [] : [RA]).concat(usedCallee);
  const frame = (slots.size * 4 + saved.length * 4 + 15) & ~15;
  if (frame > 2032) WB.fail('frameTooLarge', `${f.name}: a frame of ${frame} bytes does not fit 12-bit offsets`);
  const saveAt = new Map(saved.map((r, i) => [r, frame - 4 - 4 * i]));
  const out = [];
  const phys = (r, scratch, m) => r === undefined || r < 64 ? r : spilled.has(r) ? (out.push({ op: 'lw', rd: scratch, rs1: SP, imm: slots.get(r), covers: m.covers, spill: 'reload' }), scratch) : assign.get(r);
  for (const m of code) {
    if (m.op === 'label') { out.push(m); if (m.name === 'entry' && frame) { out.push({ op: 'addi', rd: SP, rs1: SP, imm: -frame, covers: [f.id], note: 'frame' }); for (const r of saved) out.push({ op: 'sw', rs1: SP, rs2: r, imm: saveAt.get(r), covers: [f.id], note: 'save ' + REGS[r] }); } continue; }
    const n = { ...m };
    n.rs1 = phys(m.rs1, T5, m); n.rs2 = phys(m.rs2, T6, m);
    let spillDef = null;
    if (m.rd !== undefined && m.rd >= 64) { if (spilled.has(m.rd)) { spillDef = m.rd; n.rd = T5; } else n.rd = assign.get(m.rd); }
    if (n.mv && n.rd === n.rs1) { // coalesced; a spilled destination still needs its store
      if (spillDef !== null) out.push({ op: 'sw', rs1: SP, rs2: T5, imm: slots.get(spillDef), covers: m.covers, spill: 'store' });
      continue;
    }
    if (n.rd === undefined && m.rd !== undefined) n.rd = ZERO; // dead definition with no register
    out.push(n);
    if (spillDef !== null) out.push({ op: 'sw', rs1: SP, rs2: T5, imm: slots.get(spillDef), covers: m.covers, spill: 'store' });
  }
  // the exit sequence, and jumps to the next label removed
  out.push({ op: 'label', name: 'exit' });
  for (const r of saved) out.push({ op: 'lw', rd: r, rs1: SP, imm: saveAt.get(r), covers: [f.id], note: 'restore ' + REGS[r] });
  if (frame) out.push({ op: 'addi', rd: SP, rs1: SP, imm: frame, covers: [f.id], note: 'frame' });
  out.push({ op: 'ret', covers: [f.id] });
  const final = [];
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    const target = m.op === 'jexit' ? 'exit' : m.op === 'j' ? m.target : null;
    if (target) {
      let k = i + 1, falls = false;
      while (k < out.length && out[k].op === 'label') { if (out[k].name === target) falls = true; k++; }
      if (falls) continue;
      if (target === 'exit' && !frame) { final.push({ ...m, op: 'ret', note: 'return (no frame to pop)' }); continue; }
      final.push({ ...m, op: 'j', target }); continue;
    }
    final.push(m);
  }
  // an exit nobody reaches (every return already ended in ret) is dropped
  const exitAt = final.findIndex(m => m.op === 'label' && m.name === 'exit');
  const before = final[exitAt - 1]; // a label just before exit could be a jump target that falls into it
  if (!final.some(m => m.target === 'exit') && before && ['ret', 'j', 'ebreak'].includes(before.op)) final.length = exitAt;
  return { code: final, frame, saved, spills: slots.size, regs: [...new Set(assign.values())].sort((a, b) => a - b) };
}
function encodeOne(m, pc, labelAt, entries) {
  const rel = name => { const t = labelAt.get(name); if (t === undefined) WB.fail('internal', `no label ${name}`); return t - pc; };
  if (m.op in R3) { const [f3, f7] = R3[m.op]; return instruction.r(0x33, m.rd, f3, m.rs1, m.rs2, f7); }
  if (m.op in I3) { let imm = m.imm; if (m.op === 'srai') imm = 0x400 | (imm & 31); if (m.op === 'slli' || m.op === 'srli') imm &= 31; return instruction.i(0x13, m.rd, I3[m.op], m.rs1, imm); }
  if (m.op === 'lw') return instruction.i(0x03, m.rd, 2, m.rs1, m.imm);
  if (m.op === 'lhu') return instruction.i(0x03, m.rd, 5, m.rs1, m.imm);
  if (m.op === 'sw') return instruction.s(2, m.rs1, m.rs2, m.imm);
  if (m.op === 'sh') return instruction.s(1, m.rs1, m.rs2, m.imm);
  if (m.op === 'lui') return ((m.imm & 0xfffff) << 12) | (m.rd << 7) | 0x37;
  if (m.op in BR) { const d = rel(m.target); if (d < -4096 || d > 4094) WB.fail('branchRange', `branch of ${d} bytes is out of range`); return instruction.b(BR[m.op], m.rs1, m.rs2, d); }
  if (m.op === 'j') return instruction.j(ZERO, rel(m.target));
  if (m.op === 'call') { const t = entries[m.callee]; if (t === undefined) WB.fail('internal', `no entry ${m.callee}`); return instruction.j(RA, t - pc); }
  if (m.op === 'ret') return 0x00008067;
  if (m.op === 'ebreak') return 0x00100073;
  WB.fail('internal', `cannot encode ${m.op}`);
}

// ---------- compile: the head revision to an image entity ----------
let imageCounter = 0;
WB.checkBackendOptions = function checkBackendOptions(opts) {
  for (const k of Object.keys(opts)) if (!(k in WB.backendDefaults)) WB.fail('unknownOption', `the backend has no option "${k}".` + (WB.didYouMean(k, Object.keys(WB.backendDefaults)) ? ` Did you mean "${WB.didYouMean(k, Object.keys(WB.backendDefaults))}"?` : ''), { fix: `options: ${Object.keys(WB.backendDefaults).join(', ')}` });
  const o = { ...WB.backendDefaults, ...opts };
  if (o.registers !== 'all' && !(+o.registers >= 1)) WB.fail('badArgument', `registers is 'all' or a number from 1, not ${o.registers}`);
  if (!['caller', 'callee'].includes(o.order)) WB.fail('badArgument', `order is 'caller' or 'callee', not ${o.order}`);
  if (!['furthest', 'current'].includes(o.spill)) WB.fail('badArgument', `spill is 'furthest' or 'current', not ${o.spill}`);
  return o;
};
// Compile the head revision, or an earlier one: the program is set to that revision's
// snapshot for the duration and put back after, so nothing about the head changes.
WB.compile = function compile(p, opts = {}, rev = p.rev) {
  if (p.status !== 'ok') WB.fail('notCompilable', `${p.id} did not pass the front end: ${p.error && p.error.message}`);
  if (!(rev >= 0 && rev <= p.rev)) WB.fail('noRevision', `${p.id} has revisions r0 to r${p.rev}`);
  if (rev !== p.rev) {
    p.restore(p.revisions[rev].snapshot);
    try { return compileAt(p, opts, rev); } finally { p.restore(p.revisions[p.rev].snapshot); }
  }
  return compileAt(p, opts, rev);
};
function compileAt(p, opts, rev) {
  const o = WB.checkBackendOptions(opts);
  const t0 = WB.now();
  const fns = [...p.fns.values()];
  const perFn = fns.map(f => {
    const sel = select(p, f, o);
    const leaf = !sel.code.some(m => m.op === 'call');
    const alloc = allocate(sel.code, sel.hints, o, leaf);
    const fin = finish(f, sel.code, alloc, leaf);
    return { f, sel, alloc, fin, leaf };
  });
  // lay out functions in order, then encode with every label known
  let pc = 0;
  const entries = {}, labelAts = new Map();
  for (const x of perFn) {
    entries[x.f.name] = pc;
    const at = new Map();
    for (const m of x.fin.code) { if (m.op === 'label') at.set(m.name, pc); else { m.pc = pc; pc += 4; } }
    labelAts.set(x.f.name, at);
  }
  const bytes = new Uint8Array(pc), view = new DataView(bytes.buffer);
  const n = imageCounter++;
  const sameRev = [...p.store.ents.values()].filter(e => e.kind === 'image' && e.program === p.id && e.rev === rev).length;
  const tag = `r${rev}` + (sameRev ? `.${sameRev}` : '');
  const id = `img:${p.name}@${tag}`;
  const insns = [], fnStats = {};
  for (const x of perFn) {
    const at = labelAts.get(x.f.name);
    let count = 0;
    for (const m of x.fin.code) {
      if (m.op === 'label') continue;
      const word = encodeOne(m, m.pc, at, entries) >>> 0;
      view.setUint32(m.pc, word, true);
      const iid = `insn:${x.f.name}+0x${(m.pc - entries[x.f.name]).toString(16)}@${tag}`;
      const covers = (m.covers || []).filter(c => c && p.store.has(c));
      const why = m.spill ? `spill ${m.spill}` : m.note || m.why || (m.mv ? 'copy' : m.zero !== undefined ? 'zero a local' : undefined);
      const text = decode(word, m.pc).text;
      // the same instruction with its target named instead of addressed, so diffs line up
      const sym = m.op === 'call' ? `call ${m.callee}` : m.target ? text.replace(/0x[0-9a-f]+$/, m.target.replace(/^bb:[^.]+/, 'bb')) : text;
      p.store.add({ id: iid, kind: 'insn', image: id, fn: x.f.name, offset: m.pc, word, text, sym, covers, why, origin: [{ from: covers[0] || x.f.id, via: 'backend', kind: 'recorded', because: covers.slice(1) }] });
      insns.push(iid); count++;
    }
    fnStats[x.f.name] = { entry: entries[x.f.name], bytes: count * 4, insns: count, frame: x.fin.frame, saved: x.fin.saved.map(r => REGS[r]), spills: x.fin.spills, regs: x.fin.regs.map(r => REGS[r]), vregs: x.sel.vregs, leaf: x.leaf };
  }
  const program = { image: bytes, entries, relocations: [], imports: [] };
  const img = p.store.add({ id, kind: 'image', program: p.id, rev, snapshot: p.revisions[rev].snapshot, options: o, bytes: pc, insns, fns: fnStats, ms: +(WB.now() - t0).toFixed(2), code: program, origin: [{ from: p.id, via: 'backend', kind: 'recorded', note: `compiled at r${p.rev}` }] });
  if (rev === p.rev) p._image = id;
  return img;
}
// Instruction-level diff of two images, one function: a longest common subsequence over the
// instructions with branch targets named, so code that only moved does not count as changed.
WB.diffImages = function diffImages(p, A, B, fname) {
  const rows = img => img.insns.map(i => p.store.get(i)).filter(e => e.fn === fname);
  const a = rows(A), b = rows(B), n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i].sym === b[j].sym ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i].sym === b[j].sym) { out.push({ op: '=', a: a[i], b: b[j] }); i++; j++; }
    else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { out.push({ op: '-', a: a[i] }); i++; }
    else { out.push({ op: '+', b: b[j] }); j++; }
  }
  return { rows: out, same: out.filter(r => r.op === '=').length, removed: out.filter(r => r.op === '-').length, added: out.filter(r => r.op === '+').length };
};
WB.imageStatus = (p, img) => img.snapshot === (p.revisions[img.rev] && p.revisions[img.rev].snapshot) ? (img.rev === p.rev ? 'current' : `older (r${img.rev})`) : 'stale';
WB.machineCode = function machineCode(p, fname, opts = {}) { // the stages, for teaching: vregs, intervals, allocation
  const o = WB.checkBackendOptions(opts), f = p.fn(fname);
  const sel = select(p, f, o), leaf = !sel.code.some(m => m.op === 'call');
  const alloc = allocate(sel.code, sel.hints, o, leaf);
  const name = r => r === undefined ? '' : r < 64 ? REGS[r] : `v${r - 64}`;
  const show = m => m.op === 'label' ? `${m.name}:` : `  ${m.op} ${[m.rd, m.rs1, m.rs2].filter(r => r !== undefined).map(name).concat(m.imm !== undefined ? [m.imm] : [], m.target ? [m.target] : [], m.callee ? [m.callee] : []).join(', ')}`;
  return {
    selected: sel.code.map(show),
    intervals: alloc.intervals.map(x => ({ vreg: name(x.reg), start: x.start, end: x.end, crossesCall: x.crossesCall, reg: alloc.spilled.has(x.reg) ? 'spilled' : REGS[alloc.assign.get(x.reg)] })),
    spilled: [...alloc.spilled].map(name), leaf,
  };
};

// ---------- running an image on the reused emulator ----------
WB.runImage = function runImage(img, fname, args, memBytes, opts = {}) {
  if (!G.typedRv32Interp) WB.fail('noEmulator', 'rv32-interp.js is not loaded');
  if (!(fname in img.code.entries)) WB.fail('unknownFunction', `${img.id} has no entry "${fname}"`, { fix: `entries: ${Object.keys(img.code.entries).join(', ')}` });
  try {
    const r = G.typedRv32Interp.run(img.code, fname, args, memBytes, { limit: opts.limit ?? 2e5 });
    return { kind: 'run', engine: 'rv32', image: img.id, trap: r.trap ? 'ebreak' : false, result: r.trap ? undefined : r.result, steps: r.steps, unit: 'instructions', counts: r.counts, bytes: r.bytes };
  } catch (e) {
    if (!(e instanceof G.typedRv32Interp.Rv32Fault)) throw e;
    const limit = /instruction limit/.test(e.message), memory = /outside guest memory/.test(e.message);
    return { kind: 'run', engine: 'rv32', image: img.id, trap: memory ? 'memory' : e.message, fault: !limit && !memory, limit, steps: NaN, unit: 'instructions' };
  }
};
// per-instruction execution counts, attributed to statements and source lines through covers
WB.heat = function heat(p, img, counts) {
  const byInsn = [], byStmt = new Map(), byLine = new Map();
  img.insns.forEach(iid => {
    const e = p.store.get(iid), n = counts ? counts[e.offset >>> 2] : 0;
    byInsn.push({ id: iid, n });
    if (!n) return;
    for (const c of e.covers) { const k = p.store.get(c); if (k && k.kind === 'stmt') byStmt.set(c, (byStmt.get(c) || 0) + n); }
    const lines = new Set(WB.linesOf(p, e.covers[0] || ''));
    for (const l of lines) byLine.set(l, (byLine.get(l) || 0) + n);
  });
  return { byInsn, byStmt, byLine };
};
})(globalThis);
