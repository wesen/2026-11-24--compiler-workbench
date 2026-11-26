import { size } from './evaluate.js';
import { value, type Fn } from './model.js';
import type { CudaInputs } from './cuda-run.js';

export type SampleStream = 'signed' | 'positive' | 'half-ulp' | 'zero' | 'subnormal';
const half = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];
const subnormal = [2 ** -149, -(2 ** -149), 2 ** -127, -(2 ** -127)];

export function sampleInputs(fn: Fn, dims: Map<string, number>, stream: SampleStream, random: () => number) {
  const shapes = fn.params.map(p => p.shape.map(d => value(d, dims)));
  if (shapes.some(s => s.some(x => x < 0) || size(s) > 4096)) return undefined;
  const inputs: CudaInputs = Object.create(null);
  fn.params.forEach((p, j) => {
    const shape = shapes[j];
    const data = Float32Array.from({ length: size(shape) }, (_, i) => {
      switch (stream) {
        case 'signed':
          return 2 * random() - 1;
        case 'positive':
          return 0.25 + 0.75 * random();
        case 'zero':
          return i % 2 ? -0 : 0;
        case 'subnormal':
          return subnormal[i % subnormal.length];
        case 'half-ulp':
          return half[i % half.length];
      }
    });
    inputs[p.name] = { shape, data };
  });
  return inputs;
}
