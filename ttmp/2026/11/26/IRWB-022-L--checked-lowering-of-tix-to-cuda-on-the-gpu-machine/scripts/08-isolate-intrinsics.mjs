// One untimed tool invocation. Compare two copies of each emitted function on identical inputs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileTix, cudaSource, optimizeTix, runTix } from '../../../../../../dist/tensor/index.js';
import { encodeCases, decodeResults } from '../../../../../../dist/tensor/cuda-run.js';
import { value } from '../../../../../../dist/tensor/model.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

const dims = new Map(Object.entries({ N: 11, C: 17, Q: 11, K: 17, D: 7, V: 13, H: 19, O: 13 }));
const dir = mkdtempSync('/tmp/irwb-022-l-diagnose-');
const headers = new Set(),
  units = [],
  calls = [],
  pairs = [];
const words = data => new Uint32Array(data.buffer, data.byteOffset, data.length);

try {
  for (const [name, op] of [
    ['softmax', 'exp'],
    ['attention', 'exp'],
    ['mlp', 'tanh'],
    ['logged', 'log'],
  ]) {
    const logWitness = name === 'logged';
    const source = logWitness
      ? 'fn logged(x:f32[N]):f32[N]{y[i]=log(x[i]);return y;}'
      : readFileSync('corpus/tensor/' + name + '/main.tix', 'utf8');
    const original = compileTix(source);
    const fn = original.current.value.functions[0];
    const random = seededRandom(22);
    const inputs = Object.fromEntries(
      fn.params.map(p => {
        const shape = p.shape.map(d => value(d, dims));
        const data = Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => 2 * random() - 1);
        if (logWitness) data.fill(new Float32Array(Uint32Array.of(0x3f908e2a).buffer)[0]);
        return [p.name, { shape, data }];
      }),
    );
    const cases = [{ id: 0, inputs }];
    writeFileSync(join(dir, name + '.bin'), encodeCases(fn, cases, 0));
    for (const optimized of logWitness ? [false] : [false, true]) {
      const program = optimized ? optimizeTix(original, ['inline', 'split-sum']).program : original;
      const emitted = cudaSource(program, name);
      const pattern = new RegExp('\\b' + op + 'f\\((v[0-9]+)\\)', 'g');
      const wide = emitted.replace(pattern, '__double2float_rn(' + op + '((double)$1))');
      assert.notEqual(wide, emitted);
      const files = [];
      for (const code of [emitted, wide]) {
        const ns = 'trial' + units.length;
        const file = 'out/' + ns + '.bin';
        files.push(file);
        // Put standard headers at file scope. Namespaces isolate identical generated symbol names.
        const body = code
          .replace(/^#include .*$/gm, h => {
            headers.add(h);
            return '';
          })
          .replace('int main()', 'int entry()')
          .replace('"cases.bin"', JSON.stringify(name + '.bin'))
          .replace('"out/results.bin"', JSON.stringify(file));
        units.push('namespace ' + ns + ' {\n' + body + '\n}');
        calls.push('if (' + ns + '::entry()) return 1;');
      }
      pairs.push({ name, optimized, fn, files, cases, ref: runTix(program, name, inputs) });
    }
  }
  writeFileSync(
    join(dir, 'main.cu'),
    [...headers, ...units, 'int main() {', ...calls, 'return 0; }'].join('\n'),
  );
  const receipt = JSON.parse(
    execFileSync(process.execPath, ['tools/cuda-remote.mjs', dir, '--host', 'manuel@bling'], {
      encoding: 'utf8',
    }),
  );
  assert.equal(receipt.exit, 0);
  const comparisons = pairs.map(({ name, optimized, fn, files, cases, ref }) => {
    const mismatches = files.map(file => {
      const [result] = decodeResults(readFileSync(join(dir, file)), fn, cases, 0);
      assert.deepEqual(result.shape, ref.shape);
      const expected = words(ref.data);
      return words(result.data).reduce((count, word, i) => count + Number(word !== expected[i]), 0);
    });
    assert.ok(mismatches[0] > 0);
    assert.equal(mismatches[1], 0);
    return {
      name,
      optimized,
      elements: ref.data.length,
      shippedDifferences: mismatches[0],
      wideDifferences: mismatches[1],
    };
  });
  console.log(JSON.stringify({ seed: 22, host: receipt.host, hash: receipt.hash, comparisons }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
