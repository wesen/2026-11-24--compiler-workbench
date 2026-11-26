// From the worktree root: npm run build; node ttmp/*/*/*/IRWB-020-H*/scripts/01-replay-program-39.mjs
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const built = name => import(pathToFileURL(resolve('dist', name + '.js')).href);
const { compileTix, optimizeTix, runTix } = await built('tensor/index');
const { gates } = await built('tensor/contract');
const { differentialSpec, seededRandom } = await built('framework/contracts/differential');
const p = compileTix(`fn g(x: f32[N, C], u: f32[N], v: f32[C]): f32[C] {
  t0[i0] = (sum(r1, r2) -(v[i0] / (v[i0] * v[i0] + 1)) * u[r1] - u[r2]);
  t1[i3, i4] = (sqrt(v[i4] * v[i4] + 0.5) - (sum(r5) v[i4] + v[r5])) / C - u[i3];
  t2[i6] = u[i6] - -u[i6];
  t3[i7] = (sum(r8) (sum(r9) C - v[r9]) + (t0[i7] - x[r8, i7]));
  return t3;
}`);
const original = optimizeTix(p, ['split-sum']);
assert.deepEqual(original.steps, [{ pass: 'split-sum', accepted: false }]);
assert.equal(original.program, p);
// The public API deliberately discards rejected proposals. Observe the ordinary
// gate call in this process only. Delegate to the real checker and keep its verdict.
const gate = gates.tolerant, check = gate.check;
let candidate, evidence;
try {
  gate.check = (...args) => { candidate = args[2]; return evidence = check(...args); };
  assert.deepEqual(optimizeTix(p, ['split-sum']).steps, original.steps);
} finally { gate.check = check; }
console.log(JSON.stringify(evidence, null, 2));
const spec = differentialSpec(gate.contract.ensures[0].invariant);
const portValues = { origin: p.origin, baseline: p.origin, candidate };
const cases = spec.cases(portValues, seededRandom(spec.seed), spec.count);
const mismatches = [];
let baseViolations = 0, changedElements = 0;
for (const c of cases) {
  const ref = runTix(p, 'g', c.inputs, { precision: 'f64' }).data;
  const base = runTix(p, 'g', c.inputs).data;
  const prop = { origin: p.origin, current: candidate };
  const split = runTix(prop, 'g', c.inputs).data;
  for (let i = 0; i < ref.length; i++) {
    const bound = 2e-6 + 2e-5 * Math.abs(ref[i]);
    if (Math.abs(base[i] - ref[i]) > bound) baseViolations++;
    if (!Object.is(split[i], base[i])) changedElements++;
    if (Math.abs(split[i] - ref[i]) <= bound) continue;
    mismatches.push([c.sizes, c.pattern, i]);
    assert.equal(split[i], base[i]);
    const x = c.inputs.x, u = c.inputs.u, v = c.inputs.v;
    const [N, C] = x.shape;
    // Independent scalar replay of only the statements on the return dependency path.
    function terms(round) {
      const a = -round(v.data[i] / round(round(v.data[i] * v.data[i]) + 1));
      let t0 = 0;
      for (let r1 = 0; r1 < N; r1++) for (let r2 = 0; r2 < N; r2++)
        t0 = round(t0 + round(round(a * u.data[r1]) - u.data[r2]));
      const sum = xs => xs.reduce((s, x) => round(s + x), 0);
      const blocked = xs => sum(Array.from({ length: Math.ceil(xs.length / 4) },
        (_, b) => sum(xs.slice(b * 4, b * 4 + 4))));
      const inner = Array.from(v.data, z => round(C - z));
      const outer = s => Array.from(u.data, (_, r8) => round(s + round(t0 - x.data[r8 * C + i])));
      return { t0, inner: sum(inner), innerBlocked: blocked(inner), serial: sum(outer(sum(inner))),
        grouped: blocked(outer(blocked(inner))) };
    }
    const f32 = terms(Math.fround), f64 = terms(x => x);
    assert.equal(f64.serial, ref[i]); assert.equal(f32.serial, base[i]); assert.equal(f32.grouped, split[i]);
    console.log({ caseIndex: cases.indexOf(c), N, C, pattern: c.pattern, i, ref: ref[i], base: base[i], split: split[i],
      bound, baseError: Math.abs(base[i] - ref[i]), splitError: Math.abs(split[i] - ref[i]), f32, f64 });
  }
}
assert.equal(cases.length, 24);
assert.deepEqual(mismatches, [[[5, 5], 'positive', 4], [[9, 9], 'positive', 4]]);
console.log({baseViolations, changedElements});
