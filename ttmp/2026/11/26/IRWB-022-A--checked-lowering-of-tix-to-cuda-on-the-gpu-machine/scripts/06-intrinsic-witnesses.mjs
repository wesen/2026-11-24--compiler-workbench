// Three independent scalar witnesses in one untimed run of the evaluated backend.
// Finite inputs and one-hot masks make the reported output exactly the selected call.
import assert from 'node:assert/strict';
import { compileTix, runTix, runTixCuda } from '../../../../../../dist/tensor/index.js';

const program = compileTix(`fn witness(x:f32[N], y:f32[N], z:f32[N], a:f32[N], b:f32[N], c:f32[N]):f32[N] {
  out[i] = a[i]*exp(x[i]) + b[i]*log(y[i]) + c[i]*tanh(z[i]);
  return out;
}`);
const vector = (...values) => ({ shape: [3], data: Float32Array.from(values) });
const inputs = {
  x: vector(-3.986328125, 0, 0),
  y: vector(1, 0.0751953125, 1),
  z: vector(0, 0, -3.6123046875),
  a: vector(1, 0, 0),
  b: vector(0, 1, 0),
  c: vector(0, 0, 1),
};
const cpu = runTix(program, 'witness', inputs);
const gpu = await runTixCuda(program, 'witness', inputs);
assert.deepEqual(gpu.shape, cpu.shape);
const words = array => new Uint32Array(array.buffer, array.byteOffset, array.length);
for (const [i, operation] of ['expf', 'logf', 'tanhf'].entries()) {
  const reference = words(cpu.data)[i], candidate = words(gpu.data)[i];
  console.log(operation, reference.toString(16), candidate.toString(16));
  assert.equal(Math.abs(reference - candidate), 1);
}
