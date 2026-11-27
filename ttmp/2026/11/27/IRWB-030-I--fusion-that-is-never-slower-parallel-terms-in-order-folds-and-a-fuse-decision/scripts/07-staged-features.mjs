// IRWB-030-I script 07: a battery of staged-reduction features through the exact relation. Each program has a
// row-scalar member whose reduction stages under the rules; the check runs the contract's full case battery
// (shape assignments including every-symbol-distinct and zeros, four input streams, NaN compared as a class).
//   node <ticket>/scripts/07-staged-features.mjs
import { corpusInputs } from './01-baseline.mjs';
import { checkLowering, compileTix, runTix, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { createHash } from 'node:crypto';

const digest = ({ data }) =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');

const features = {
  'exp-terms': [
    'fn f(x: f32[N,C]): f32[N,C] { s[i] = sum(j) exp(x[i,j]) / C; y[i,j] = x[i,j] - s[i]; return y; }',
    { N: 5, C: 7 },
    ['x'],
  ],
  'two-axes': [
    'fn f(x: f32[N,J,K]): f32[N,J,K] { s[i] = sum(j,k) (x[i,j,k] * x[i,j,k]) / J / K; y[i,j,k] = x[i,j,k] - s[i]; return y; }',
    { N: 3, J: 4, K: 5 },
    ['x'],
  ],
  'staged-max': [
    'fn f(x: f32[N,C], w: f32[C]): f32[N,C] { m[i] = max(j) x[i,j] * w[j]; y[i,j] = x[i,j] - m[i]; return y; }',
    { N: 4, C: 9 },
    ['x', 'w'],
  ],
  'staged-and-nested': [
    'fn f(x: f32[N,C], z: f32[N,C]): f32[N,C] { s[i] = sum(j) x[i,j] / C + max(k) z[i,k]; y[i,j] = x[i,j] - s[i]; return y; }',
    { N: 4, C: 6 },
    ['x', 'z'],
  ],
  'two-staged-one-member': [
    'fn f(x: f32[N,C]): f32[N,C] { t[i] = sum(j) x[i,j] / C + sum(k) x[i,k] / C; y[i,j] = x[i,j] - t[i]; return y; }',
    { N: 4, C: 6 },
    ['x'],
  ],
  'staged-max-feeds-row': [
    'fn f(x: f32[N,C]): f32[N,C] { m[i] = max(j) x[i,j] * 2; e[i,j] = exp(x[i,j] - m[i]); s[i] = sum(j) e[i,j] / C; y[i,j] = e[i,j] / s[i]; return y; }',
    { N: 3, C: 8 },
    ['x'],
  ],
};

for (const [name, [source, dims, params]] of Object.entries(features)) {
  const program = compileTix(source);
  const plan = planFusion(program.current.value.functions[0]);
  const staged = plan.groups.flatMap(g => g.terms.map(t => `${g.kernel}:${t.statement}`));
  const inputs = Object.fromEntries(
    params.map(p => {
      const shape = program.current.value.functions[0].params.find(q => q.name === p).shape.map(d =>
        Number(
          d.terms.reduce((v, [n, k]) => v + dims[n] * k, d.constant),
        ),
      );
      const data = Float32Array.from({ length: shape.reduce((n, dim) => n * dim, 1) }, (_, i) =>
        0.9 * Math.sin(1 + i * 0.37),
      );
      return [p, { shape, data }];
    }),
  );
  const fnName = program.current.value.functions[0].name;
  const verdict = await checkLowering(program, fnName);
  const fused = await runTixCuda(program, fnName, inputs);
  const interpreter = runTix(program, fnName, inputs, 'f32');
  const wordsEqual = digest(fused) === digest(interpreter);
  console.log(
    JSON.stringify({ feature: name, staged, accepted: verdict.accepted, reason: verdict.reason, wordsEqual }),
  );
}
