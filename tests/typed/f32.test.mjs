// IRWB-001 P4.2 (inventory steps 1, 3, 4): typed values and the validator, f32 evaluator semantics checked against
// the reference compiler on the reference interpreter, and float-safe passes with f32 counterexamples.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { F32_FIXTURE } from './f32-fixture.mjs';

await installVendor({ reference: true });
const { ingest } = await import('../../dist/typed/lift.js');
const { blocksAdapter, storeOf, validateBlocks } = await import('../../dist/typed/ir.js');
const { createIRArtifact } = await import('../../dist/framework/ir/index.js');
const { listing } = await import('../../dist/typed/listing.js');
const E = await import('../../dist/typed/evaluate.js');
const F = await import('../../dist/typed/f32.js');
const P = await import('../../dist/typed/passes.js');
const { runPipeline } = await import('../../dist/typed/project.js');
const { referenceCompile, referenceRun } = await import('../../dist/typed/reference.js');
const { applyPass, PassError } = await import('../../dist/framework/passes/index.js');
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');

const lifted = () => createIRArtifact(blocksAdapter, 'fixture', ingest('fixture', F32_FIXTURE, { tape: true }).toNative());
const b = F.toBits;

test('P4.2: f32 operations on bits follow RV32F', () => {
  const { F32_BINARY: B, F32_UNARY: U, CANONICAL_NAN: NAN } = F;
  const payload = 0x7fc00123;
  // min and max: the other operand for one NaN, the canonical NaN for two, -0 below +0
  assert.equal(B.fmin(payload, b(1)), b(1));
  assert.equal(B.fmax(b(2), payload), b(2));
  assert.equal(B.fmin(payload, payload), NAN);
  assert.equal(B.fmin(b(-0), b(0)), b(-0));
  assert.equal(B.fmax(b(-0), b(0)), b(0));
  // arithmetic: rounded to nearest even, a NaN result is canonical
  assert.equal(B.fadd(b(Infinity), b(-Infinity)), NAN);
  assert.equal(B.fadd(payload, b(1)), NAN);
  assert.equal(B.fadd(b(0.1), b(0.2)), b(Math.fround(Math.fround(0.1) + Math.fround(0.2))));
  assert.equal(B.fadd(b(16777216), b(1)), b(16777216)); // 2^24 + 1 rounds to even
  assert.equal(U.fsqrt(b(-1)), NAN);
  assert.equal(U.fsqrt(b(-0)), b(-0));
  // sign operations keep NaN payloads
  assert.equal(U.fneg(payload) >>> 0, 0xffc00123);
  assert.equal(U.fabs(U.fneg(payload)), payload);
  assert.equal(B.fcopysign(b(3), b(-0)), b(-3));
  // saturating conversions toward zero; NaN gives 2^31 - 1 and 2^32 - 1
  assert.equal(U.f2i(NAN), 0x7fffffff);
  assert.equal(U.f2i(b(-Infinity)), -0x80000000);
  assert.equal(U.f2i(b(3e9)), 0x7fffffff);
  assert.equal(U.f2i(b(-2.9)), -2);
  assert.equal(U.f2u(NAN), -1);
  assert.equal(U.f2u(b(-1.5)), 0);
  assert.equal(U.f2u(b(3e9)) >>> 0, 3e9);
  assert.equal(U.f2u(b(5e9)), -1);
  // floor, ceil, trunc: x itself from 2^23 on and for NaN; otherwise with x's sign
  assert.equal(U.ffloor(b(-0.5)), b(-1));
  assert.equal(U.fceil(b(-0.5)), b(-0));
  assert.equal(U.ftrunc(b(-0.7)), b(-0));
  assert.equal(U.ffloor(b(-0)), b(-0));
  assert.equal(U.ffloor(payload), payload);
  assert.equal(U.fceil(b(8388608.5 * 2)), b(16777217)); // already integral (rounded at the constant)
  // comparisons: false with a NaN, except ne
  assert.equal(F.F32_COMPARE.flt(NAN, b(1)), 0);
  assert.equal(F.F32_COMPARE.fge(NAN, b(1)), 0);
  assert.equal(F.F32_COMPARE.fne(NAN, NAN), 1);
  assert.equal(F.F32_COMPARE.feq(b(0), b(-0)), 1);
  assert.deepEqual(
    [b(1.5), b(-0), b(Infinity), NAN, payload, b(0.1), 1].map(F.formatF32),
    ['1.5', '-0', 'inf', 'nan', 'nan:0x7fc00123', '0.1', '1e-45'],
  );
});

test('P4.2: the evaluator agrees with the reference compiler on every pair of f32 edge values', () => {
  const st = storeOf(lifted().value);
  const program = referenceCompile(F32_FIXTURE);
  const edges = E.F32_EDGES.concat([b(0.5), b(-0.5), b(2.5), b(-2.5), b(1e-40), b(-3.75)]);
  const ints = [0, 1, -1, 7, 0x7fffffff, -0x80000000, 16777217, 0x7fc00000, 0x7f800001];
  let n = 0;
  for (const fn of st.fns.keys()) {
    const f = st.fn(fn);
    if (f.params.length > 2 || f.params.some(t => t !== 'f32' && t !== 'i32' && t !== 'u32')) continue;
    const domain = t => (t === 'f32' ? edges : ints);
    const tuples = f.params.reduce((acc, t) => acc.flatMap(a => domain(t).map(x => [...a, x])), [[]]);
    const memory = new Uint8Array(1024);
    for (const args of tuples) {
      const ours = E.evaluate(st, fn, args, memory),
        ref = referenceRun(program, fn, args, memory);
      assert.ok(E.agrees(ref, ours), `${fn}(${args.map(F.formatF32)}): reference ${ref.trap || ref.result}, evaluator ${ours.trap || ours.result}`);
      n++;
    }
    for (const c of E.casesFrom(st, fn, { count: 100 })) {
      const ours = E.evaluate(st, fn, c.args, c.memory),
        ref = referenceRun(program, fn, c.args, c.memory);
      assert.ok(E.agrees(ref, ours), `${fn}#${c.n}`);
      n++;
    }
  }
  assert.ok(n > 5000, `${n} cases`);
});

test('P4.2: values carry their type; a mistyped table is refused', () => {
  const nat = lifted().value;
  const st = storeOf(nat);
  assert.match(listing(st, 'addZero'), /return \(x \+\. 0f\)/);
  assert.match(listing(st, 'tenth'), /return \(0\.1f \+\. 0\.2f\)/);
  assert.match(listing(st, 'toInt'), /return f2i\(x\)/);
  const fadd = Object.values(nat.values).find(v => v.op === 'fadd' && v.fn === 'fn:addZero');
  assert.equal(fadd.type, 'f32');
  assert.equal(Object.values(nat.values).find(v => v.op === 'f2i').type, undefined); // absent means i32
  // an i32 constant where fadd wants an f32
  const a = structuredClone(nat);
  delete a.values[fadd.args[1]].type;
  assert.throws(() => validateBlocks(a), /operand 1 of fadd must be f32, not i32/);
  // an f32 value set into an i32 local
  const c = structuredClone(nat);
  const set = Object.values(c.stmts).find(s => s.op === 'set' && s.fn === 'fn:scale' && c.fns.scale.locals[s.local].type === 'f32');
  c.fns.scale.locals[set.local].type = 'i32';
  assert.throws(() => validateBlocks(c), /set into i32 local|get of i32 local/);
  // a function returning the wrong class
  const d = structuredClone(nat);
  d.fns.toInt.result = 'f32';
  assert.throws(() => validateBlocks(d), /toInt returns f32, not i32/);
  // an f32 comparison is an i32
  const e = structuredClone(nat);
  const flt = Object.values(e.values).find(v => v.op === 'flt');
  flt.type = 'f32';
  assert.throws(() => validateBlocks(e), /flt must have type i32/);
});

test('P4.2: O2 keeps the meaning of f32 code; f32 identities are not applied; fold rounds as the target does', async () => {
  const r0 = lifted(), manager = new AnalysisManager();
  const run = await runPipeline(r0, 'O2', { manager, count: 40 });
  assert.deepEqual(run.steps.filter(s => s.rejected), []);
  const ev = (await manager.checkInvariant(E.meaningKept({ count: 100 }), { origin: r0, candidate: run.artifact })).evidence;
  assert.equal(ev.disagree, 0);
  const text = listing(storeOf(run.artifact.value));
  assert.match(text, /return \(x \+\. 0f\)/); // -0 + 0 is +0
  assert.match(text, /return \(x \*\. 0f\)/); // NaN * 0 and ∞ * 0 are NaN
  assert.match(text, /return \(x -\. x\)/); // ∞ - ∞ is NaN
  assert.match(text, /if !\(\(a <\. b\)\)/); // !(NaN < 1) is not NaN >= 1
  // folded in f32, rounded to nearest even: 0.1f + 0.2f and 1f / 3f
  const consts = fn => Object.values(run.artifact.value.values).filter(v => v.fn === `fn:${fn}` && v.op === 'const' && v.type === 'f32').map(v => v.imm);
  assert.deepEqual(consts('tenth'), [b(Math.fround(Math.fround(0.1) + Math.fround(0.2)))]);
  assert.deepEqual(consts('third'), [b(1 / 3)]);
  assert.match(text, /ffloor\(2\.5f\)/); // rounding toward -∞ is left to run time
  // licm hoists a *. b out of scale's loop into an f32 local
  const scale = run.artifact.value.fns.scale;
  const inv = scale.locals.find(l => l.madeBy === 'licm');
  assert.equal(inv?.type, 'f32');
  assert.match(listing(storeOf(run.artifact.value), 'scale'), /inv = \(a \*\. b\)/);
});

test('P4.2: unsound f32 rewrites are rejected by the meaning check with NaN, -0 and ∞ counterexamples', async () => {
  const r0 = lifted();
  const isZero = h => h.isConst && h.imm === 0;
  const wrong = [
    ['addZero', 'x + 0 = x (false for -0)', ({ tx }) => tx.rewrite(v => (v.op === 'fadd' && isZero(v.args[1]) ? v.args[0].id : undefined))],
    ['mulZero', 'x * 0 = 0 (false for NaN and ∞)', ({ tx }) => tx.rewrite(v => (v.op === 'fmul' && isZero(v.args[1]) ? tx.const(0, { type: 'f32' }) : undefined))],
    ['subSelf', 'x - x = 0 (false for NaN and ∞)', ({ tx }) => tx.rewrite(v => (v.op === 'fsub' && v.args[0].same(v.args[1]) ? tx.const(0, { type: 'f32' }) : undefined))],
    ['notLess', '!(a < b) = a >= b (false for NaN)', ({ tx }) => tx.rewrite(v => (v.op === 'eqz' && v.args[0].op === 'flt' ? tx.make('fge', v.args[0].args[0].id, v.args[0].args[1].id) : undefined))],
  ];
  const contract = P.optimizationContract({ count: 40 });
  for (const [fn, about, body] of wrong) {
    const pass = P.typedPass({ name: `wrong-${fn}`, about, writes: ['values'], body });
    await assert.rejects(applyPass(pass, r0, { manager: new AnalysisManager(), contract, contractInputs: { origin: r0 } }), e => {
      assert.ok(e instanceof PassError && e.code === 'contractRejected', String(e));
      assert.match(e.message, /disagree/);
      return true;
    });
  }
  // the counterexample of x + 0 = x is x = -0: r0 gives +0 (bits 0), the rewrite -0
  const pass = P.typedPass({ name: 'wrong-add-zero', about: '', writes: ['values'], body: wrong[0][2] });
  const out = await applyPass(pass, r0, { manager: new AnalysisManager() });
  const ev = (await new AnalysisManager().checkInvariant(E.meaningKept({ count: 40 }), { origin: r0, candidate: out.artifact })).evidence;
  assert.ok(ev.counterexamples.some(c => c.case.fn === 'addZero' && c.case.args[0] === b(-0)), JSON.stringify(ev.counterexamples));
});
