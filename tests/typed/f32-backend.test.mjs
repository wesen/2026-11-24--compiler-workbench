// IRWB-001 P4.5: the f32 RV32F backend. F encodings, f32 tiles on NaN, -0, ±∞ and saturation, ilp32f record results
// with stack words, f32 arguments beyond fa7, callee-saved fs registers, frame arrays and checked buffers; images
// against the evaluator (rv32.image-agrees) and against the reference compiler's image; Candela at r0 (and, with
// IRWB_CANDELA=1, 100 cases per function, and the O2 head saved by tools/candela-o2.mjs if IRWB_CANDELA_HEAD names it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { installVendor } from '../../tools/node-vendor.mjs';
import { candelaInputs, candelaSource, MAX_SOURCE } from '../../tools/candela.mjs';
import { F32_FIXTURE } from './f32-fixture.mjs';
import { CONVENTION_FIXTURE } from './f32-backend-fixture.mjs';

await installVendor({ reference: true });
const { ingest } = await import('../../dist/typed/lift.js');
const { blocksAdapter, storeOf } = await import('../../dist/typed/ir.js');
const { createIRArtifact } = await import('../../dist/framework/ir/index.js');
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');
const E = await import('../../dist/typed/evaluate.js');
const F = await import('../../dist/typed/f32.js');
const B = await import('../../dist/typed/backend/index.js');
const { referenceCompile } = await import('../../dist/typed/reference.js');

const lift = (id, src) => createIRArtifact(blocksAdapter, id, ingest(id, src, { tape: true }).toNative());
const b = F.toBits;
const texts = (img, fn) => img.value.insns.filter(m => m.fn === fn).map(m => m.text);
const check = async (r0, image, params = {}) => {
  const ev = await new AnalysisManager().checkInvariant(B.imageAgrees({ count: 100, ...params }), { program: r0, image });
  return ev;
};

test('P4.5: RV32F encodings decode to their assembly, and a register of the wrong class is refused', () => {
  const enc = m => B.decode(B.encodeOne({ covers: [], ...m }, 0, new Map(), {}) >>> 0, 0).text;
  const [ft0, ft1, ft2, fs0, fa0, fa1, fs11, ft11] = [32, 33, 34, 40, 42, 43, 59, 63];
  assert.equal(B.encodeOne({ op: 'fadd.s', rd: ft0, rs1: ft1, rs2: ft2, rm: 0, covers: [] }, 0, new Map(), {}) >>> 0, 0x00208053);
  assert.equal(enc({ op: 'fadd.s', rd: ft0, rs1: ft1, rs2: ft2, rm: 0 }), 'fadd.s ft0, ft1, ft2, rne');
  assert.equal(enc({ op: 'fsub.s', rd: fa0, rs1: fa0, rs2: fa1, rm: 0 }), 'fsub.s fa0, fa0, fa1, rne');
  assert.equal(enc({ op: 'fmul.s', rd: fs0, rs1: fs11, rs2: ft11, rm: 0 }), 'fmul.s fs0, fs11, ft11, rne');
  assert.equal(enc({ op: 'fdiv.s', rd: ft0, rs1: ft1, rs2: ft2, rm: 0 }), 'fdiv.s ft0, ft1, ft2, rne');
  assert.equal(enc({ op: 'fsqrt.s', rd: fa0, rs1: fa1, rm: 0 }), 'fsqrt.s fa0, fa1, rne');
  assert.equal(enc({ op: 'fsgnj.s', rd: ft0, rs1: ft1, rs2: ft1 }), 'fmv.s ft0, ft1');
  assert.equal(enc({ op: 'fsgnj.s', rd: ft0, rs1: ft1, rs2: ft2 }), 'fsgnj.s ft0, ft1, ft2');
  assert.equal(enc({ op: 'fsgnjn.s', rd: ft0, rs1: ft1, rs2: ft1 }), 'fneg.s ft0, ft1');
  assert.equal(enc({ op: 'fsgnjx.s', rd: ft0, rs1: ft1, rs2: ft1 }), 'fabs.s ft0, ft1');
  assert.equal(enc({ op: 'fmin.s', rd: ft0, rs1: ft1, rs2: ft2 }), 'fmin.s ft0, ft1, ft2');
  assert.equal(enc({ op: 'fmax.s', rd: ft0, rs1: ft1, rs2: ft2 }), 'fmax.s ft0, ft1, ft2');
  assert.equal(enc({ op: 'feq.s', rd: 5, rs1: fa0, rs2: fa1 }), 'feq.s t0, fa0, fa1');
  assert.equal(enc({ op: 'flt.s', rd: 5, rs1: fa0, rs2: fa1 }), 'flt.s t0, fa0, fa1');
  assert.equal(enc({ op: 'fle.s', rd: 5, rs1: fa0, rs2: fa1 }), 'fle.s t0, fa0, fa1');
  assert.equal(enc({ op: 'fcvt.w.s', rd: 10, rs1: fa0, rm: 1 }), 'fcvt.w.s a0, fa0, rtz');
  assert.equal(enc({ op: 'fcvt.wu.s', rd: 10, rs1: fa0, rm: 1 }), 'fcvt.wu.s a0, fa0, rtz');
  assert.equal(enc({ op: 'fcvt.w.s', rd: 31, rs1: ft0, rm: 2 }), 'fcvt.w.s t6, ft0, rdn');
  assert.equal(enc({ op: 'fcvt.s.w', rd: ft11, rs1: 31, rm: 3 }), 'fcvt.s.w ft11, t6, rup');
  assert.equal(enc({ op: 'fcvt.s.wu', rd: fa0, rs1: 10, rm: 0 }), 'fcvt.s.wu fa0, a0, rne');
  assert.equal(enc({ op: 'fmv.x.w', rd: 10, rs1: fa0 }), 'fmv.x.w a0, fa0');
  assert.equal(enc({ op: 'fmv.w.x', rd: fa0, rs1: 0 }), 'fmv.w.x fa0, zero');
  assert.equal(enc({ op: 'flw', rd: fs0, rs1: 2, imm: 8 }), 'flw fs0, 8(sp)');
  assert.equal(enc({ op: 'fsw', rs1: 10, rs2: fs11, imm: -4 }), 'fsw fs11, -4(a0)');
  // the decoder's F words carry their memory operands like lw and sw
  const w = B.encodeOne({ op: 'flw', rd: fs0, rs1: 2, imm: 8, covers: [] }, 0, new Map(), {}) >>> 0;
  assert.deepEqual(B.decode(w, 0), { text: 'flw fs0, 8(sp)', memory: 'load', base: 'sp', offset: 8, reg: 'fs0' });
  const refuse = m => assert.throws(() => B.encodeOne({ covers: [], ...m }, 0, new Map(), {}), e => e.code === 'internal');
  refuse({ op: 'fadd.s', rd: 5, rs1: ft1, rs2: ft2, rm: 0 }); // an x register as an f destination
  refuse({ op: 'feq.s', rd: ft0, rs1: fa0, rs2: fa1 }); // an f register as an x destination
  refuse({ op: 'flw', rd: 10, rs1: 2, imm: 0 });
  refuse({ op: 'add', rd: 5, rs1: ft0, rs2: 6 }); // an f register in an integer instruction
  refuse({ op: 'addi', rd: 70, rs1: 2, imm: 0 }); // a virtual register left over
  refuse({ op: 'fadd.s', rd: ft0, rs1: ft1, rs2: ft2 }); // no static rounding mode
  assert.deepEqual([B.REGS[32], B.REGS[40], B.REGS[42], B.REGS[50], B.REGS[63]], ['ft0', 'fs0', 'fa0', 'fs2', 'ft11']);
});

test('P4.5: f32 tiles compute RV32F bits: NaN, -0, ±∞, saturation and rounding direction', async () => {
  const r0 = lift('fixture', F32_FIXTURE),
    st = storeOf(r0.value);
  const { image } = B.lowerToImage(r0);
  const ev = await check(r0, image);
  assert.equal(ev.ok, true, ev.reason);
  assert.deepEqual([ev.evidence.disagree, ev.evidence.agree], [0, st.fns.size * 100]);
  // every pair of edge values on every one- and two-parameter function, image against evaluator
  const edges = E.F32_EDGES.concat([b(0.5), b(-0.5), b(2.5), b(-2.5), b(1e-40), b(-3.75), 0x7fc00123, 0xffc00000 | 0]);
  const ints = [0, 1, -1, 7, 0x7fffffff, -0x80000000, 16777217, 0x7fc00000];
  let n = 0;
  for (const fn of st.fns.keys()) {
    const f = st.fn(fn);
    if (f.params.length > 2 || f.params.some(t => t !== 'f32' && t !== 'i32' && t !== 'u32')) continue;
    const domain = t => (t === 'f32' ? edges : ints);
    const tuples = f.params.length === 0 ? [[]] : f.params.length === 1 ? domain(f.params[0]).map(x => [x]) : domain(f.params[0]).flatMap(x => domain(f.params[1]).map(y => [x, y]));
    for (const args of tuples) {
      const mem = new Uint8Array(1024);
      const want = E.evaluate(st, fn, args, mem), got = B.runImage(image, fn, args, mem);
      assert.ok(E.agrees(want, { ...got, counts: null }), `${fn}(${args}): evaluator ${want.trap || want.result}, image ${got.trap || got.result}`);
      n++;
    }
  }
  assert.ok(n > 4000, `${n} edge cases`);
  // the bits themselves
  const run = (fn, ...args) => B.runImage(image, fn, args, new Uint8Array(1024)).result;
  const NAN = F.CANONICAL_NAN;
  assert.equal(run('toInt', NAN), 0x7fffffff); // fcvt.w.s rtz saturates: NaN gives 2^31 - 1
  assert.equal(run('toInt', b(-Infinity)), -0x80000000);
  assert.equal(run('toInt', b(3e9)), 0x7fffffff);
  assert.equal(run('toInt', b(-2.9)), -2); // toward zero
  assert.equal(run('toUnsigned', b(-1.5)), 0);
  assert.equal(run('toUnsigned', NAN), -1);
  assert.equal(run('lo', NAN, b(1)), b(1)); // fmin.s: the other operand when one is a NaN
  assert.equal(run('hi', b(-0), b(0)), b(0)); // -0 < +0
  assert.equal(run('lo', b(-0), b(0)), b(-0));
  assert.equal(run('negate', 0x7fc00123) >>> 0, 0xffc00123); // fsgnjn.s keeps the payload
  assert.equal(run('magnitude', 0xffc00123 | 0), 0x7fc00123);
  assert.equal(run('addZero', b(-0)), b(0)); // -0 + 0 is +0 under RNE
  assert.equal(run('mulZero', b(-1)), b(-0));
  assert.equal(run('sum', b(Infinity), b(-Infinity)), NAN); // a NaN result is canonical
  assert.equal(run('sum', 0x7fc00123, b(1)), NAN);
  assert.equal(run('quot', b(1), b(0)), b(Infinity));
  assert.equal(run('up', b(-0.5)), b(-0)); // ceil keeps x's sign
  assert.equal(run('down', b(-0.5)), b(-1));
  assert.equal(run('chop', b(-0.7)), b(-0));
  assert.equal(run('down', b(16777217)), b(16777217)); // |x| ≥ 2^23: its own result
  assert.equal(run('down', 0x7fc00123), 0x7fc00123);
  assert.equal(run('root', b(-1)), NAN);
  assert.equal(run('eq', b(0), b(-0)), 1);
  assert.equal(run('ne', NAN, NAN), 1);
  assert.equal(run('le', NAN, b(1)), 0);
  assert.equal(run('notLess', NAN, b(1)), 1); // !(a < b) is not a >= b
  assert.equal(run('widenUnsigned', -1), b(4294967296)); // fcvt.s.wu rounds 2^32 - 1 to 2^32
  assert.equal(run('tenth'), b(Math.fround(Math.fround(0.1) + Math.fround(0.2))));
  // floor is the reference compiler's sequence
  assert.deepEqual(texts(image, 'down').slice(0, 8), [
    'fmv.s ft0, fa0',
    'fmv.x.w t0, fa0',
    'slli t0, t0, 1',
    'lui t1, 0x96000',
    texts(image, 'down')[4],
    'fcvt.w.s t0, fa0, rdn',
    'fcvt.s.w ft1, t0, rdn',
    'fsgnj.s ft0, ft1, fa0',
  ]);
  assert.match(texts(image, 'down')[4], /^bgeu t0, t1, 0x/);
  assert.deepEqual(image.value.fns.down.sig, { params: ['f32'], result: 'f32' });
  assert.equal(image.value.fns.bits.sig.result, 'i32');
});

test('P4.5: ilp32f record results, stack words and f32 arguments beyond fa7; the reference image agrees', async () => {
  const r0 = lift('conv', CONVENTION_FIXTURE),
    st = storeOf(r0.value);
  const { image } = B.lowerToImage(r0);
  const inputs = { at: { b: { floats: [0, 6], range: [-4, 4] }, i: [-2, 8] }, scaleBuffer: { b: { floats: [4, 12] }, n: [0, 14] } };
  const ev = await check(r0, image, { inputs });
  assert.equal(ev.ok, true, ev.reason);
  assert.equal(ev.evidence.disagree, 0);
  const fns = image.value.fns;
  // big returns ten f32 leaves (fa0-fa7, then the caller's stack words 0 and 1) and two integers (a0, a1)
  assert.deepEqual(fns.big.sig.results, ['f32', 'f32', 'f32', 'f32', 'f32', 'f32', 'f32', 'f32', 'f32', 'f32', 'i32', 'i32']);
  const bigText = texts(image, 'big');
  assert.ok(bigText.some(t => /^fsw f\w+, 0\(sp\)$/.test(t)) && bigText.some(t => /^fsw f\w+, 4\(sp\)$/.test(t)), bigText.join('\n'));
  // bigSum reads leaves 8 and 9 from its outgoing words, the others from fa0-fa7 and a0, a1 where they returned (at
  // r0 the lifter stores each leaf into a temporary, so each is one copy)
  const sumText = texts(image, 'bigSum');
  assert.ok(sumText.some(t => /^flw f\w+, 0\(sp\)$/.test(t)) && sumText.some(t => /^flw f\w+, 4\(sp\)$/.test(t)), sumText.join('\n'));
  for (let k = 0; k < 8; k++) assert.ok(sumText.some(t => new RegExp(`^fmv\\.s f\\w+, fa${k}$`).test(t)), sumText.join('\n'));
  assert.ok(sumText.some(t => /^addi \w+, a1, 0$/.test(t)), sumText.join('\n'));
  // passBig passes big's leaves through: registers stay, stack words are copied to the caller's (sp + frame)
  const pass = texts(image, 'passBig');
  assert.equal(pass.filter(t => /^fmv\.s fa\d, f/.test(t) && !/^fmv\.s fa\d, fa/.test(t)).length, 1, pass.join('\n')); // only x + 1 for the call
  assert.ok(pass.includes(`fsw ft0, ${fns.passBig.frame}(sp)`) || pass.some(t => new RegExp(`^fsw f\\w+, ${fns.passBig.frame}\\(sp\\)$`).test(t)), pass.join('\n'));
  // many: a-h in fa0-fa7, i, j, k as bits in a0-a2, n and m in a3 and a4
  const manyText = texts(image, 'many');
  for (const r of ['a0', 'a1', 'a2']) assert.ok(manyText.some(t => new RegExp(`^fmv\\.w\\.x f\\w+, ${r}$`).test(t)), manyText.join('\n'));
  assert.ok(texts(image, 'manyCall').some(t => /^fmv\.x\.w a2, f\w+$/.test(t)));
  // wide: nine integers (the ninth on the stack) and ten f32 (fa0-fa7, then no x register is left: the stack)
  const wideText = texts(image, 'wide');
  assert.ok(wideText.some(t => /^lw \w+, \d+\(sp\)$/.test(t)) && wideText.some(t => /^flw f\w+, \d+\(sp\)$/.test(t)), wideText.join('\n'));
  assert.ok(texts(image, 'wideCall').some(t => /^sw \w+, 0\(sp\)$/.test(t)));
  // keep holds x * y and x + y across two calls in callee-saved fs registers, saved and restored in its frame
  assert.ok(fns.keep.saved.some(r => r.startsWith('fs')), JSON.stringify(fns.keep));
  for (const r of fns.keep.saved.filter(r => r.startsWith('fs'))) {
    assert.ok(texts(image, 'keep').some(t => new RegExp(`^fsw ${r}, \\d+\\(sp\\)$`).test(t)));
    assert.ok(texts(image, 'keep').some(t => new RegExp(`^flw ${r}, \\d+\\(sp\\)$`).test(t)));
  }
  // frame arrays: 8 words zeroed by eight sw zero, 40 words by a loop; checked buffer reads trap out of range
  assert.equal(texts(image, 'sumArray').filter(t => /^sw zero, \d+\(sp\)$/.test(t)).length >= 8, true);
  assert.ok(texts(image, 'sumBigArray').some(t => /^sw zero, 0\(\w+\)$/.test(t)));
  assert.ok(image.value.insns.some(m => m.fn === 'at' && m.why === 'checked address out of range'));
  const c = E.benchCase(st, 'at', { b: { cells: [0, 0x3fc0, 0, 0x4000] }, i: 5 });
  assert.equal(B.runImage(image, 'at', c.args, c.memory).trap, 'ebreak');
  assert.equal(B.runImage(image, 'at', [c.args[0], 1], c.memory).result, b(2));
  // the reference compiler's image (stock) gives the same results and memory on the same cases
  const ref = referenceCompile(CONVENTION_FIXTURE);
  const refImage = B.imageFromCode('conv', ref.image, ref.entries, ref.signatures);
  assert.deepEqual(refImage.fns.big.sig, fns.big.sig);
  let compared = 0;
  for (const fn of st.fns.keys())
    for (const k of E.casesFrom(st, fn, { count: 40, inputs: inputs[fn] ?? {} })) {
      const a = B.runImage(image, fn, k.args, k.memory), r = B.runImage(refImage, fn, k.args, k.memory);
      assert.ok(E.agrees({ ...r, counts: null }, { ...a, counts: null }), `${fn}#${k.n}: reference ${r.trap || r.result}, ours ${a.trap || a.result}`);
      compared++;
    }
  assert.equal(compared, st.fns.size * 40);
  // the reference image agrees with the evaluator through rv32.image-agrees as well
  const refArt = createIRArtifact(B.imageAdapter, 'ref:conv', refImage);
  assert.equal((await check(r0, refArt, { inputs, count: 40 })).ok, true);
});

test('P4.5: f registers spill through ft10 and ft11; the options apply per class; fs0-fs11 are checked', async () => {
  const r0 = lift('conv', CONVENTION_FIXTURE);
  const inputs = { at: { b: { floats: [0, 6] }, i: [-2, 8] }, scaleBuffer: { b: { floats: [4, 12] }, n: [0, 14] } };
  for (const options of [{ registers: 1 }, { registers: 2, spill: 'current' }, { order: 'callee' }, { hints: false }]) {
    const { image } = B.lowerToImage(r0, options);
    const ev = await check(r0, image, { inputs, count: 40 });
    assert.equal(ev.ok, true, `${JSON.stringify(options)}: ${ev.reason}`);
    if (options.registers === 1) {
      const fspill = image.value.insns.filter(m => /^f(lw|sw) /.test(m.text) && m.why?.startsWith('spill'));
      assert.ok(fspill.some(m => m.why === 'spill reload') && fspill.some(m => m.why === 'spill store'));
      assert.ok(fspill.every(m => /ft1[01]|, -?\d+\(sp\)/.test(m.text)));
    }
    if (options.order === 'callee') assert.ok(Object.values(image.value.fns).some(f => f.saved?.some(r => r.startsWith('fs'))));
  }
  // the stages name f virtual registers vfN
  const mc = B.machineCode(r0, 'keep');
  assert.ok(mc.selected.some(l => /\bvf\d+/.test(l)), mc.selected.join('\n'));
  // hand-assembled: fmv.w.x fs0, zero; ret: an f32 function that changes a callee-saved f register
  const words = [B.encodeOne({ op: 'fmv.w.x', rd: 40, rs1: 0, covers: [] }, 0, new Map(), {}) >>> 0, 0x00008067];
  const bytes = new Uint8Array(8);
  words.forEach((w, i) => new DataView(bytes.buffer).setUint32(4 * i, w, true));
  const bad = B.imageFromCode('bad', bytes, { f: 0 }, [{ name: 'f', params: ['f32'], result: 'f32' }]);
  const run = B.runImage(bad, 'f', [b(1)], new Uint8Array(1024));
  assert.equal(run.fault, true);
  assert.match(run.trap, /callee-saved f8 \(fs0\) changed/);
});

test('P4.5: a branch beyond ±4 KiB is relaxed into an inverted branch over a jump', async () => {
  // an if arm of about 8 KiB of code: the test's branch past the arm does not fit 13 bits (a loop's would not show
  // it, as the lifter places a loop's exit before its body and the back edge is a jal)
  const body = Array.from({ length: 300 }, (_, k) => `        s = s * 1.0001 + ${k}.5;`).join('\n');
  const src = `function long(n: i32, x: f32): f32 {\n    let s: f32 = x;\n    if (n > 0) {\n${body}\n    }\n    return s;\n}\n`;
  const r0 = lift('long', src);
  const { image } = B.lowerToImage(r0);
  assert.ok(image.value.bytes > 4096);
  assert.ok(image.value.insns.some(m => m.why === 'a branch target beyond ±4 KiB'));
  const ev = await check(r0, image, { inputs: { long: { n: [-1, 1] } }, count: 20 });
  assert.equal(ev.ok, true, ev.reason);
  // relaxBranches on its own: a branch 5000 bytes back becomes bge over a jal
  const code = [{ op: 'label', name: 'top', covers: [] }, ...Array.from({ length: 1250 }, () => ({ op: 'addi', rd: 5, rs1: 5, imm: 1, covers: [] })), { op: 'blt', rs1: 5, rs2: 6, target: 'top', covers: [] }];
  const relaxed = B.relaxBranches(code);
  assert.deepEqual(relaxed.slice(-3).map(m => [m.op, m.target ?? m.name]), [['bge', 'far0'], ['j', 'top'], ['label', 'far0']]);
  const near = [code[0], ...code.slice(1, 11), code.at(-1)];
  assert.deepEqual(B.relaxBranches(near), near); // in range: unchanged
});

// Candela: every function compiles at r0 and agrees on a few cases; IRWB_CANDELA=1 runs 100 cases per function.
const source = candelaSource();
const candela = createIRArtifact(blocksAdapter, 'candela', ingest('candela', source, { tape: true, maxSourceLength: MAX_SOURCE }).toNative());
const candelaCheck = async (program, count) => {
  const st = storeOf(program.value);
  const image = createIRArtifact(B.imageAdapter, 'img:candela', B.compileImage(program));
  const ev = await check(program, image, { count, inputs: candelaInputs(st), limit: 2e5, imageLimit: 2e7 });
  return { image, ev };
};

test('P4.5: every Candela function compiles at r0 and agrees with the evaluator', async () => {
  const { image, ev } = await candelaCheck(candela, 3);
  assert.equal(image.value.fnOrder.length, 332);
  assert.ok(image.value.bytes < 312740, `${image.value.bytes} bytes, the reference's stock image has 312740`);
  assert.equal(ev.evidence.disagree, 0, JSON.stringify(ev.evidence.counterexamples));
  assert.ok(ev.evidence.agree >= 332 * 3 - 10, JSON.stringify({ agree: ev.evidence.agree, inconclusive: ev.evidence.inconclusive }));
});

test('P4.5: Candela images agree on 100 cases per function at r0 and at the O2 head (IRWB_CANDELA=1)', { skip: process.env.IRWB_CANDELA !== '1', timeout: 4 * 3600e3 }, async () => {
  const r0 = await candelaCheck(candela, 100);
  assert.equal(r0.ev.evidence.disagree, 0, JSON.stringify(r0.ev.evidence.counterexamples));
  assert.ok(r0.ev.evidence.agree > 33000, JSON.stringify({ agree: r0.ev.evidence.agree, inconclusive: r0.ev.evidence.inconclusive }));
  const headFile = process.env.IRWB_CANDELA_HEAD;
  if (!headFile || !existsSync(headFile)) return;
  const head = createIRArtifact(blocksAdapter, 'candela', JSON.parse(readFileSync(headFile, 'utf8')));
  const o2 = await candelaCheck(head, 100);
  assert.equal(o2.ev.evidence.disagree, 0, JSON.stringify(o2.ev.evidence.counterexamples));
  assert.ok(o2.image.value.bytes < r0.image.value.bytes);
});
