// A surviving-mutant class reported by IRWB-006: a float rewrite that is wrong only on NaNs with a non-canonical
// payload. `x + (-0) -> x` is the example: every f32 operation of the evaluator returns the canonical NaN
// 0x7fc00000, so `x + (-0)` turns x = 0x7fc00001 (or a negative or signalling NaN) into 0x7fc00000 while `x` keeps
// its bits. The default generator's F32_EDGES holds only the canonical NaN.
//
// Two functions: `addNegZero(x) = x + (-0)`, where x is a parameter (its NaN can carry any payload), and
// `scaled(x, k) = (x * k) + (-0)`, where the operand is computed (its NaN is always canonical, so the rewrite is
// equivalent on every input). The rewrite is applied as a pass and judged by Program.apply (version 1) and by
// version 2; then both revisions are run on explicit NaN payloads.
//   node ttmp/2026/11/25/IRWB-005--*/scripts/19-nan-payload.mjs
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { Program } = await import(root + 'dist/typed/program.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const { typedPass } = await import(root + 'dist/typed/passes.js');
const { evaluate, casesFrom, F32_EDGES } = await import(root + 'dist/typed/evaluate.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const S = await import(root + 'dist/typed/cases-strong.js');

const src = 'function addNegZero(x: f32): f32 { return x + (-0.0); }\nfunction scaled(x: f32, k: f32): f32 { return (x * k) + (-0.0); }\n';
const dropNegZero = fname =>
  typedPass({
    name: 'fadd-neg-zero',
    about: 'the unsound rule x + (-0) -> x (IRWB-006 UNSOUND_CANDIDATES), as a mutant',
    writes: ['values'],
    preserves: [],
    body({ st, f, tx }) {
      if (f.name !== fname) return;
      tx.rewrite(h => {
        const v = st.get(h.id);
        if (v.op !== 'fadd') return;
        const c = st.get(v.args[1]);
        if (c.op === 'const' && c.imm === -0x80000000) return v.args[0];
      });
    },
  });
const PAYLOADS = { canonical: 0x7fc00000, 'quiet, payload 1': 0x7fc00001, 'negative quiet': 0xffc00000 | 0, signalling: 0x7fa00000, 'signalling, payload 1': 0x7f800001 };
const hex = x => '0x' + (x >>> 0).toString(16).padStart(8, '0');
const nanPayload = x => (x & 0x7f800000) === 0x7f800000 && (x & 0x7fffff) !== 0 && x !== 0x7fc00000;
const out = {};
for (const fname of ['addNegZero', 'scaled']) {
  const p = new Program('nan-payload', src, {});
  const st0 = storeOf(p.origin.value);
  const v1cases = casesFrom(st0, fname, { count: 40, seed: 7, inputs: {} });
  const v2cases = S.strongCasesFrom(st0, fname, { count: 40, extra: 40, seed: 7, inputs: {} });
  let v1;
  try {
    const step = await p.apply(dropNegZero(fname));
    v1 = { accepted: step.changed, check: step.check ?? null };
  } catch (e) {
    v1 = { accepted: false, reason: String(e.message).split('\n')[0].slice(0, 200) };
  }
  const cand = (await applyPass(dropNegZero(fname), p.origin, { manager: p.manager })).artifact;
  const ev = await p.manager.checkInvariant(S.meaningKeptStrong({ inputs: {}, count: 40, extra: 40, seed: 7 }), { origin: p.origin, candidate: cand });
  const st1 = storeOf(cand.value);
  const runs = Object.fromEntries(
    Object.entries(PAYLOADS).map(([name, x]) => {
      const args = fname === 'scaled' ? [x, 0x3f800000] : [x];
      const a = evaluate(st0, fname, args, new Uint8Array(1024)), b = evaluate(st1, fname, args, new Uint8Array(1024));
      return [name, `${hex(x)}: r0 ${hex(a.result)}, rewritten ${hex(b.result)}${a.result === b.result ? '' : '  DIFFERS'}`];
    }),
  );
  out[fname] = {
    'version 1 (Program.apply)': v1,
    'version 2': { ok: ev.ok, reason: ev.reason },
    'non-canonical NaN arguments in the cases': {
      v1: v1cases.filter(c => c.args.some(nanPayload)).length,
      v2: v2cases.filter(c => c.args.some(nanPayload)).length,
    },
    runs,
  };
}
console.log(`F32_EDGES NaNs: ${F32_EDGES.filter(x => (x & 0x7f800000) === 0x7f800000 && x & 0x7fffff).map(hex).join(', ')}`);
console.log(`F32_EXTRA NaNs: ${S.F32_EXTRA.filter(x => (x & 0x7f800000) === 0x7f800000 && x & 0x7fffff).map(hex).join(', ')}`);
console.log(JSON.stringify(out, null, 1));
