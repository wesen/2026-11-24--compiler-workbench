// From this worktree, after npm run build. No edits to evaluated sources.
import assert from 'node:assert/strict';
import { compileTix, optimizeTix, runTix } from '../../../../../../dist/tensor/index.js';
import { passes } from '../../../../../../dist/tensor/passes.js';
import { verify } from '../../../../../../dist/tensor/contract.js';
import { applyNativePassSync } from '../../../../../../dist/framework/passes/index.js';

const source = `fn g(x: f32[N, C], u: f32[N], v: f32[C]): f32[C] {
  t0[i0] = (sum(r1, r2) -(v[i0] / (v[i0] * v[i0] + 1)) * u[r1] - u[r2]);
  t1[i3, i4] = (sqrt(v[i4] * v[i4] + 0.5) - (sum(r5) v[i4] + v[r5])) / C - u[i3];
  t2[i6] = u[i6] - -u[i6];
  t3[i7] = (sum(r8) (sum(r9) C - v[r9]) + (t0[i7] - x[r8, i7]));
  return t3;
}`;
const p = compileTix(source);
const { program, steps } = optimizeTix(p, ['split-sum']);
console.log('public result:', steps, 'retained input:', program.current === p.current);
assert.equal(steps[0].accepted, false);
let candidate;
assert.throws(() => applyNativePassSync(passes.get('split-sum'), p.current, c => {
  candidate = { origin: p.origin, current: c }; // inspection only; not the accepted revision
  return verify('tolerance', p.origin, p.current, c);
}), e => {
  if (e.code !== 'contractRejected') return false;
  console.log('candidate check:', JSON.stringify(e.evidence, null, 2));
  return true;
});
console.log('origin checked against itself:', JSON.stringify(verify('tolerance', p.origin, p.current, p.current).evidence, null, 2));

// Reconstruct the one failing coordinate assignment (signature order x, u, v).
const inputs = Object.fromEntries([['x', [5, 4]], ['u', [5]], ['v', [4]]].map(([name, shape], j) =>
  [name, {shape, data: Float32Array.from({length: shape.reduce((a,b)=>a*b)}, (_,i)=>(1+(17*i+7*j)%61)/64)}]));
const intermediate = compileTix(source.replace('return t3;', 'return t0;'));
for (const precision of ['f32', 'f64']) {
  const lane = prog => runTix(prog, 'g', inputs, {precision}).data[0];
  console.log(precision, {t0: lane(intermediate), origin: lane(p), split: lane(candidate)});
  assert.equal(lane(p), lane(candidate));
}
console.log('inner sum:', inputs.v.data.reduce((a,v)=>a+(4-v),0));
