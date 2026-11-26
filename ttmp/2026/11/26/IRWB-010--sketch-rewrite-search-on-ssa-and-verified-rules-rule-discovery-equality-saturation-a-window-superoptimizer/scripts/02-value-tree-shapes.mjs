// IRWB-010: the shapes of the value trees in noise3, fbm3 and their callees, at r0 and at the O2 head, and how
// often candidate rewrite patterns occur in them and in all of Candela.
//
//   node scripts/02-value-tree-shapes.mjs --dir <dir with r0.json, o2.json> [--json out.json] [--listing out.txt]
//
// Per function and revision: statements, values, calls, f32 constants (distinct and uses), the depth and size of
// every statement's trees, and the operator histogram. Pattern census (a pattern counts once per matching node):
//   exact candidates      fmul(x, 2.0) -> fadd(x, x); fneg(fneg x) -> x; fabs(fneg x) -> fabs x
//   payload-class         fmul(x, 1.0), fadd(x, -0.0), fdiv(x, 1.0) -> x: wrong only for a non-canonical NaN x
//   real-only identities  fadd(x, +0.0) -> x, fmul(x, 0.0) -> 0, fsub(x, x) -> 0: wrong on -0, NaN or infinity
//   contraction           fadd/fsub with an fmul operand: one fmadd/fmsub/fnmsub instead of two roundings
//   reassociation         fadd(fadd(x, c1), c2), fmul(fmul(x, c1), c2) with constants (f32: inexact);
//                         add(add(x, c1), c2), mul(mul(x, c1), c2) (i32: exact modulo 2^32)
//   reciprocal            fdiv(x, const c): c a power of two (exact) or not (inexact)
// This is a census of shapes only: no rule is applied, and no soundness claim is made here beyond the classes above,
// which follow from src/typed/f32.ts (canonical NaN results; -0 + +0 = +0).
//
// Loads the whole Candela program: run under the memory cap.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('../../../../../../', import.meta.url).pathname;
const { Store } = await import(root + 'dist/typed/model.js');
const { show, listing } = await import(root + 'dist/typed/listing.js');
const { formatF32, fromBits } = await import(root + 'dist/typed/f32.js');

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const dir = flag('--dir', '.');
const FOCUS = ['noise3', 'fbm3', 'gnoise', 'hash3', 'q_floor', 'q_fract', 'sq'];

const F32_ONE = 0x3f800000,
  F32_TWO = 0x40000000,
  NEG_ZERO = -0x80000000;
const isPow2F = bits => {
  const e = (bits >>> 23) & 255,
    m = bits & 0x7fffff;
  return m === 0 && e > 0 && e < 255; // a normal power of two, either sign
};

function patternsOf(st, v) {
  const out = [];
  const a = v.args.map(id => st.get(id));
  const isC = (x, bits) => x && x.op === 'const' && x.type === 'f32' && (bits === undefined || (x.imm | 0) === (bits | 0));
  const isCi = x => x && x.op === 'const' && x.type !== 'f32';
  // op(op(x, c1), c2) with the constants on either side of either node
  const nestedConst = (a, op, k) =>
    [0, 1].some(i => a[i]?.op === op && k(a[1 - i]) && a[i].args.some(id => k(st.get(id))));
  switch (v.op) {
    case 'fmul':
      if (isC(a[0], F32_TWO) || isC(a[1], F32_TWO)) out.push('exact: fmul(x, 2.0) -> fadd(x, x)');
      if (isC(a[0], F32_ONE) || isC(a[1], F32_ONE)) out.push('payload: fmul(x, 1.0) -> x');
      if (isC(a[0], 0) || isC(a[1], 0)) out.push('real-only: fmul(x, 0.0) -> 0');
      if (nestedConst(a, 'fmul', isC)) out.push('reassoc f32: fmul(fmul(x, c1), c2)');
      break;
    case 'fadd':
    case 'fsub': {
      const prod = a.map(x => x?.op === 'fmul');
      if (prod[0] || prod[1])
        out.push(
          v.op === 'fadd' ? 'contract: fadd(fmul(a, b), c) -> fmadd' : prod[0] ? 'contract: fsub(fmul(a, b), c) -> fmsub' : 'contract: fsub(c, fmul(a, b)) -> fnmsub',
        );
      if (v.op === 'fadd' && (isC(a[1], 0) || isC(a[0], 0))) out.push('real-only: fadd(x, +0.0) -> x');
      if (v.op === 'fadd' && (isC(a[1], NEG_ZERO) || isC(a[0], NEG_ZERO))) out.push('payload: fadd(x, -0.0) -> x');
      if (v.op === 'fsub' && a[0] && a[1] && show(st, a[0].id) === show(st, a[1].id)) out.push('real-only: fsub(x, x) -> 0');
      if (v.op === 'fadd' && nestedConst(a, 'fadd', isC)) out.push('reassoc f32: fadd(fadd(x, c1), c2)');
      if (v.op === 'fadd' && (a[0]?.op === 'fadd' || a[1]?.op === 'fadd')) out.push('reassoc f32: any fadd(fadd(a, b), c)');
      break;
    }
    case 'fdiv':
      if (isC(a[1])) out.push(isPow2F(a[1].imm | 0) ? 'reciprocal: fdiv(x, 2^k) -> fmul (exact)' : 'reciprocal: fdiv(x, c) -> fmul(x, 1/c) (inexact)');
      if (isC(a[1], F32_ONE)) out.push('payload: fdiv(x, 1.0) -> x');
      break;
    case 'fneg':
      if (a[0]?.op === 'fneg') out.push('exact: fneg(fneg x) -> x');
      break;
    case 'fabs':
      if (a[0]?.op === 'fneg') out.push('exact: fabs(fneg x) -> fabs x');
      break;
    case 'add':
      if (nestedConst(a, 'add', isCi)) out.push('reassoc i32: add(add(x, c1), c2)');
      break;
    case 'mul':
      if (nestedConst(a, 'mul', isCi)) out.push('reassoc i32: mul(mul(x, c1), c2)');
      break;
  }
  return out;
}

function treeStats(st, id) {
  let size = 0;
  const walk = (vid, d) => {
    const v = st.get(vid);
    size++;
    let max = d;
    for (const c of v.args) max = Math.max(max, walk(c, d + 1));
    return max;
  };
  const depth = walk(id, 1);
  return { size, depth };
}

function census(st, fnames) {
  const per = {};
  const total = {};
  for (const name of fnames) {
    const f = st.fns.get(name);
    if (!f) continue;
    const ops = {},
      pats = {},
      consts = new Map();
    let stmts = 0,
      values = 0,
      calls = 0,
      maxDepth = 0,
      maxSize = 0;
    const depths = [];
    const visit = vid => {
      const v = st.get(vid);
      values++;
      ops[v.op] = (ops[v.op] || 0) + 1;
      if (v.op === 'call') calls++;
      if (v.op === 'const' && v.type === 'f32') consts.set(v.imm | 0, (consts.get(v.imm | 0) || 0) + 1);
      for (const p of patternsOf(st, v)) {
        pats[p] = (pats[p] || 0) + 1;
        total[p] = (total[p] || 0) + 1;
      }
      for (const c of v.args) visit(c);
    };
    for (const b of f.blocks)
      for (const sid of b.stmts) {
        stmts++;
        const s = st.get(sid);
        for (const field of ['addr', 'value', 'cond'])
          if (s[field]) {
            const t = treeStats(st, s[field]);
            depths.push(t.depth);
            maxDepth = Math.max(maxDepth, t.depth);
            maxSize = Math.max(maxSize, t.size);
            visit(s[field]);
          }
      }
    const hist = {};
    for (const d of depths) hist[d] = (hist[d] || 0) + 1;
    per[name] = {
      blocks: f.blocks.length,
      stmts,
      values,
      calls,
      f32Constants: { distinct: consts.size, uses: [...consts.values()].reduce((a, b) => a + b, 0), list: Object.fromEntries([...consts].map(([b, n]) => [formatF32(b), n])) },
      depth: { max: maxDepth, histogram: hist },
      maxTreeSize: maxSize,
      ops: Object.fromEntries(Object.entries(ops).sort((x, y) => y[1] - x[1])),
      patterns: pats,
    };
  }
  return { per, total };
}

const load = f => Store.from(JSON.parse(readFileSync(join(dir, f), 'utf8')));
const out = {};
let text = '';
for (const [rev, file] of [
  ['r0', 'r0.json'],
  ['O2', 'o2.json'],
]) {
  const st = load(file);
  const focus = census(st, FOCUS);
  const all = census(st, [...st.fns.keys()]);
  out[rev] = { focus: focus.per, focusPatterns: focus.total, candelaPatterns: all.total, candelaFns: st.fns.size };
  for (const name of ['noise3', 'fbm3', 'gnoise', 'hash3']) text += `==== ${name} at ${rev}\n${listing(st, name)}\n`;
  process.stderr.write(`${rev}: ${st.fns.size} functions\n`);
}
const jsonOut = flag('--json', null),
  listOut = flag('--listing', null);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
if (listOut) writeFileSync(listOut, text);
for (const rev of ['r0', 'O2']) {
  console.log(`--- ${rev}`);
  for (const [name, s] of Object.entries(out[rev].focus))
    console.log(
      `${name.padEnd(8)} blocks ${s.blocks} stmts ${s.stmts} values ${s.values} calls ${s.calls} f32 consts ${s.f32Constants.distinct}/${s.f32Constants.uses} depth max ${s.depth.max} size max ${s.maxTreeSize} patterns ${JSON.stringify(s.patterns)}`,
    );
  console.log('candela', JSON.stringify(out[rev].candelaPatterns));
}
