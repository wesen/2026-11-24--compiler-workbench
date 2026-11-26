import { readFileSync } from 'node:fs';
import { compileTix, optimizeTix } from '../../../../../../dist/tensor/index.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { evaluate, OutsideSample, size } from '../../../../../../dist/tensor/evaluate.js';
import { plain, value } from '../../../../../../dist/tensor/model.js';

function* samples(fn) {
  const symbols = [...new Set(fn.params.flatMap(p => p.shape.map(plain)).filter(Boolean))].sort();
  const random = seededRandom(20);
  const seen = new Set();
  const half = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];
  for (const n of [1, 3, 4, 7, 'mixed', 0]) {
    const shapeValues = symbols.map((_, i) => (n === 'mixed' ? [3, 5, 7][i % 3] : n));
    if (seen.has(String(shapeValues))) continue;
    seen.add(String(shapeValues));
    const dims = new Map(symbols.map((s, i) => [s, shapeValues[i]]));
    const shapes = fn.params.map(p => p.shape.map(d => value(d, dims)));
    if (shapes.some(shape => shape.some(x => !Number.isSafeInteger(x) || x < 0) || size(shape) > 4096)) continue;
    for (const stream of ['signed', 'positive', 'half-ulp', 'zero']) {
      const inputs = Object.fromEntries(
        fn.params.map((p, j) => {
          const shape = shapes[j];
          const data = Float32Array.from({ length: size(shape) }, (_, i) => {
            if (stream === 'signed') return 2 * random() - 1;
            if (stream === 'positive') return 0.25 + 0.75 * random();
            if (stream === 'zero') return i % 2 ? -0 : 0;
            return half[i % half.length];
          });
          return [p.name, { shape, data }];
        }),
      );
      try {
        const reference = evaluate(fn, inputs, 'f64', true);
        if (reference.data.every(Number.isFinite)) yield { inputs, reference };
      } catch (error) {
        if (!(error instanceof OutsideSample)) throw error;
      }
    }
  }
}

for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const original = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  for (const passes of [[], ['inline'], ['split-sum'], ['inline', 'split-sum'], ['split-sum', 'inline']]) {
    const { program } = optimizeTix(original, passes);
    const [fn] = program.current.value.functions;
    let worst = 0;
    let cases = 0;
    for (const { inputs, reference } of samples(fn)) {
      cases++;
      const rounded = evaluate(fn, inputs, 'f32');
      for (let i = 0; i < reference.data.length; i++) {
        const r = reference.data[i];
        worst = Math.max(worst, Math.abs(rounded.data[i] - r) / (2e-6 + 2e-5 * Math.abs(r)));
      }
    }
    console.log(JSON.stringify({ name, passes, cases, worst }));
  }
}
