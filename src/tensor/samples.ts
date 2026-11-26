import { size } from './evaluate.js';
import { plain, value, type Fn } from './model.js';

export const sampleSeed = 20;
export const tolerance = (reference: number) => 2e-6 + 2e-5 * Math.abs(reference);
export type F32Inputs = Record<string, { shape: number[]; data: Float32Array }>;

const half = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];

export function* sampleInputs(
  fn: Fn,
  random: () => number,
  options: { signedZero: boolean; zeroShape?: boolean },
) {
  const symbols = [
    ...new Set(fn.params.flatMap(p => p.shape.map(plain).filter((n): n is string => !!n))),
  ].sort();
  const seen = new Set<string>();
  const assignments = [1, 3, 4, 7, 'mixed', ...(options.zeroShape ? [0] : [])] as const;
  const streams = ['signed', 'positive', 'half-ulp', ...(options.signedZero ? ['zero'] : [])];
  for (const n of assignments) {
    const shapeValues = symbols.map((_, i) => (n === 'mixed' ? [3, 5, 7][i % 3] : n));
    const key = JSON.stringify(shapeValues);
    if (seen.has(key)) continue;
    seen.add(key);
    const dims = new Map(symbols.map((s, i) => [s, shapeValues[i]]));
    const shapes = fn.params.map(p => p.shape.map(d => value(d, dims)));
    if (shapes.some(shape => shape.some(x => x < 0) || size(shape) > 4096)) continue;
    for (const stream of streams) {
      const inputs: F32Inputs = Object.create(null);
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
            default:
              return half[i % half.length];
          }
        });
        inputs[p.name] = { shape, data };
      });
      yield { fn: fn.name, shapeValues, stream, inputs };
    }
  }
}
