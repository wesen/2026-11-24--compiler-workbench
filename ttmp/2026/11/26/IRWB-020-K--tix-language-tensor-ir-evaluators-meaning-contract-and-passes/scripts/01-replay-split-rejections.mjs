import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileTix, optimizeTix, runTix } from '../../../../../../dist/tensor/index.js';
import { checkMeaning } from '../../../../../../dist/tensor/meaning.js';
import { splitSumPass } from '../../../../../../dist/tensor/passes.js';
import { applyNativePassSync } from '../../../../../../dist/framework/passes/index.js';

// Run after npm run build. With arguments, diagnose additional .tix sources through the same gate.
const supplied = [
  {
    label: '31',
    source: `fn g(x: f32[N, C], u: f32[N], v: f32[C]): f32[C] {
  t0[i0, i1] = (sum(r2) x[i0, i1] + u[r2]);
  t1[i3] = min(1.25, v[i3]) + (max(r4) u[r4]) / (v[i3] * v[i3] + 1);
  return t1;
}`,
    n: 0,
    c: 8,
    value: -Infinity,
  },
  {
    label: '34',
    source: `fn g(x: f32[N, C], u: f32[N], v: f32[C]): f32[N] {
  t0[i0] = (max(r1) 0.5 * v[r1]) / (u[i0] * u[i0] + 1) / (u[i0] * u[i0] + 1);
  t1[i2] = -min(t0[i2], u[i2]) * ((sum(r3) 1.25 - u[r3]) / C);
  return t1;
}`,
    n: 9,
    c: 0,
    value: Infinity,
  },
];

const paths = process.argv.slice(2);
const cases = paths.length ? paths.map(label => ({ label, source: readFileSync(label, 'utf8') })) : supplied;
for (const { label, source, n, c, value } of cases) {
  const program = compileTix(source);
  const publicResult = optimizeTix(program, ['split-sum']);
  console.log(`${label}: public result ${JSON.stringify(publicResult.steps[0])}`);
  let candidate, verdict;
  try {
    applyNativePassSync(splitSumPass, program.artifact, {
      gate(before, after) {
        candidate = after; // Inspect the validated proposal without publishing it.
        verdict = checkMeaning('tolerant', program.origin, before, after);
        return verdict;
      },
    });
  } catch (error) {
    if (error.code !== 'contractRejected') throw error;
    assert.strictEqual(publicResult.program, program);
  }
  if (!verdict) {
    assert.equal(value, undefined, 'expected the supplied witness to produce a candidate');
    console.log('no changed candidate');
    continue;
  }
  assert.equal(verdict.ok, publicResult.steps[0].accepted);
  console.log(JSON.stringify(verdict, null, 2));
  if (value === undefined) continue;
  assert.equal(verdict.ok, false);
  assert.notEqual(candidate.revision, program.artifact.revision);
  const shape = (binding, symbol) => binding.find(([name]) => name === symbol)[1];
  assert.ok(
    verdict.evidence.counterexamples.some(
      ({ case: { binding, pattern }, reason }) =>
        shape(binding, 'N') === n &&
        shape(binding, 'C') === c &&
        pattern === 'ones' &&
        reason === `cell 0: nonfinite comparison (f64 ${value}, f32 ${value})`,
    ),
  );
  const exact = checkMeaning('exact', program.origin, program.artifact, candidate);
  console.log(`immediate f32 bit check: ${exact.reason}`);
  const ones = shape => ({ shape, data: new Float32Array(shape.reduce((a, b) => a * b, 1)).fill(1) });
  const inputs = { x: ones([n, c]), u: ones([n]), v: ones([c]) };
  for (const [name, p, precision] of [
    ['origin', program, 'f64'],
    ['origin', program, 'f32'],
    ['candidate', { ...program, artifact: candidate }, 'f32'],
  ]) {
    const { data } = runTix(p, 'g', inputs, { precision });
    assert.deepEqual([...data], Array(n || c).fill(value));
    console.log(`N=${n} C=${c} ones ${name} ${precision}: [${[...data].join(', ')}]`);
  }
}
