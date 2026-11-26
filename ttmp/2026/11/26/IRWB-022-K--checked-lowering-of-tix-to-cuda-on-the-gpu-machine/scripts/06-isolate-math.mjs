// One untimed GB10 job. Run from the worktree root after npm run build.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileTix, cudaSource, optimizeTix, runTix } from '../../../../../../dist/tensor/index.js';
import { encodeBatch, decodeBatch } from '../../../../../../dist/tensor/cuda-run.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

const dir = mkdtempSync(join(tmpdir(), 'tix-math-'));
const code = [],
  calls = [],
  checks = [];
try {
  for (const [name, op, shapes] of [
    ['softmax', 'exp', [[8, 19]]],
    [
      'attention',
      'exp',
      [
        [11, 7],
        [17, 7],
        [17, 13],
      ],
    ],
    ['mlp', 'tanh', [[12, 8], [8, 19], [19], [19, 7], [7]]],
  ]) {
    const p = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
    const fn = p.current.value.functions[0],
      random = seededRandom(20);
    const inputs = Object.fromEntries(
      fn.params.map(({ name }, i) => {
        const shape = shapes[i];
        return [
          name,
          {
            shape,
            data: Float32Array.from({ length: shape.reduce((a, b) => a * b) }, () => 2 * random() - 1),
          },
        ];
      }),
    );
    writeFileSync(join(dir, name + '.bin'), encodeBatch(fn, [inputs]));
    for (const [pass, program] of [
      ['original', p],
      ['optimized', optimizeTix(p, ['inline', 'split-sum']).program],
    ]) {
      const reference = runTix(program, name, inputs);
      const source = cudaSource(program, name),
        cut = source.indexOf('__global__');
      assert.ok(cut > 0);
      if (!code.length) code.push(source.slice(0, cut));
      for (const mode of ['stock', 'wide']) {
        const id = [name, pass, mode].join('_');
        let body = source
          .slice(cut)
          .replace('int main()', 'int run()')
          .replace('"in.bin"', JSON.stringify(name + '.bin'))
          .replace('"out/results.bin"', JSON.stringify('out/' + id));
        assert.ok(body.includes(op + 'f('));
        if (mode === 'wide') {
          body =
            `__device__ float wide(float x) { return __double2float_rn(::${op}((double)x)); }\n` +
            body.replaceAll(op + 'f(', 'wide(');
        }
        code.push(`namespace ${id} {\n${body}\n}`);
        calls.push(`if (${id}::run()) return 1;`);
        checks.push({ id, mode, reference });
      }
    }
  }
  code.push('int main() {', ...calls, 'return 0;', '}');
  writeFileSync(join(dir, 'main.cu'), code.join('\n'));
  const receipt = JSON.parse(
    execFileSync(process.execPath, ['tools/cuda-remote.mjs', dir, '--host', 'manuel@bling']),
  );
  console.log('job', receipt.hash, receipt.stdout.trim().split('\n').slice(0, 2).join(' / '));
  for (const { id, mode, reference } of checks) {
    const [got] = decodeBatch(readFileSync(join(dir, 'out', id)), reference.shape.length, 1);
    assert.deepEqual(got.shape, reference.shape);
    const expected = new Uint32Array(reference.data.buffer, reference.data.byteOffset, reference.data.length);
    const words = new Uint32Array(got.data.buffer);
    const different = words.reduce((n, word, i) => n + (word !== expected[i]), 0);
    console.log(id, different, 'different of', words.length);
    if (mode === 'wide') assert.equal(different, 0);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
