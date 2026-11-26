import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';
import { eachCorpusCase } from './corpus-cases.mjs';

eachCorpusCase((name, inputs, shape, expected) => {
  test(name + ' agrees with the numerical oracle before and after optimization', () => {
    const p = compileTix(
      readFileSync(new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url), 'utf8'),
    );
    const optimized = optimizeTix(p, ['inline', 'split-sum']);
    assert.ok(optimized.steps.every(s => s.accepted));
    for (const program of [p, optimized.program])
      for (const precision of ['f32', 'f64']) {
        const result = runTix(program, name, inputs, { precision });
        assert.deepEqual(result.shape, shape);
        assert.equal(result.data.length, expected.length);
        expected.forEach((v, i) =>
          assert.ok(
            Math.abs(result.data[i] - v) < (precision === 'f32' ? 2e-5 : 1e-12),
            `at ${i}: ${v} vs ${result.data[i]}`,
          ),
        );
      }
  });
});
