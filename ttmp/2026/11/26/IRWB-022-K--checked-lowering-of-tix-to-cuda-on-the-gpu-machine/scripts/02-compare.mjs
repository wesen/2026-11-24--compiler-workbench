// Run from any directory after npm run build and the untimed GB10 probe.
import { readFileSync } from 'node:fs';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';

const file = readFileSync(new URL('./01-gb10/out/values.f32', import.meta.url));
const n = 32769;
const ops = ['exp', 'log', 'sqrt', 'tanh', 'fold', 'div'];
if (file.length !== n * ops.length * 4) throw Error('Unexpected probe output length');
const tensor = (shape, f) => ({ shape, data: Float32Array.from({ length: shape[0] }, (_, i) => f(i)) });
const inputs = {
  x: tensor([n], i => (i - 16384) / 4096),
  w: tensor([7], j => j - 2),
};
const exprs = [
  'exp(x[i])', 'log(p[i])', 'sqrt(p[i])', 'tanh(x[i])',
  'sum(j) x[i] * (w[j] / 7)', '(x[i] - p[i]) / p[i]',
];
for (const [op, name] of ops.entries()) {
  const program = compileTix(`fn f(x:f32[N],w:f32[K]):f32[N]{
    p[i] = max(x[i],-x[i]) + 0.125;
    y[i] = ${exprs[op]};
    return y;}`);
  const f32 = runTix(program, 'f', inputs).data;
  const words = new Uint32Array(f32.buffer, f32.byteOffset, f32.length);
  const f64 = runTix(program, 'f', inputs, { precision: 'f64' }).data;
  let different = 0, first, maxError = 0, maxFraction = 0;
  for (let i = 0; i < n; i++) {
    const at = (i * ops.length + op) * 4;
    const gpu = file.readUInt32LE(at);
    if (words[i] !== gpu) {
      different++;
      first ??= { x: inputs.x.data[i], cpu: words[i].toString(16), gpu: gpu.toString(16) };
    }
    const error = Math.abs(file.readFloatLE(at) - f64[i]);
    if (!Number.isFinite(error)) throw Error('Nonfinite probe output');
    maxError = Math.max(maxError, error);
    maxFraction = Math.max(maxFraction, error / (2e-6 + 2e-5 * Math.abs(f64[i])));
  }
  console.log(JSON.stringify({ name, different, first, maxError, maxFraction }));
}
