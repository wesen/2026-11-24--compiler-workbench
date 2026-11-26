// Diagnostic only: build first, then run from the repo root. One untimed GPU invocation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, optimizeTix, runTix } from '../../../../../../dist/tensor/index.js';
import { decodeResults, encodeCases } from '../../../../../../dist/tensor/cuda-run.js';
import { value } from '../../../../../../dist/tensor/model.js';

const suite = {
  softmax: { op: 'exp', dims: { N: 7, C: 13 } },
  attention: { op: 'exp', dims: { Q: 7, K: 11, D: 9, V: 5 } },
  mlp: { op: 'tanh', dims: { N: 7, D: 9, H: 13, O: 5 } },
};
const words = data => new Uint32Array(data.buffer, data.byteOffset, data.length);
const dir = mkdtempSync(join(tmpdir(), 'tix-isolate-'));
const units = [],
  launches = [],
  checks = [];
try {
  for (const [name, { op, dims }] of Object.entries(suite)) {
    const original = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
    const optimized = optimizeTix(original, ['inline', 'split-sum']);
    assert.ok(optimized.steps.every(s => s.accepted));
    const random = seededRandom(20);
    const env = new Map(Object.entries(dims));
    const inputs = Object.fromEntries(
      original.current.value.functions[0].params.map(p => {
        const shape = p.shape.map(d => value(d, env));
        return [
          p.name,
          {
            shape,
            data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => 2 * random() - 1),
          },
        ];
      }),
    );
    for (const [mode, program] of [
      ['original', original],
      ['optimized', optimized.program],
    ]) {
      const fn = program.current.value.functions[0];
      const src = cudaSource(program, name);
      const patched = src.replace(
        new RegExp(`\\b${op}f\\((v\\d+)\\)`, 'g'),
        `__double2float_rn(${op}((double)$1))`,
      );
      assert.notEqual(src, patched);
      const ref = runTix(program, name, inputs);
      const results = {};
      for (const [variant, source] of [
        ['stock', src],
        ['widened', patched],
      ]) {
        const id = `${name}_${mode}_${variant}`;
        writeFileSync(join(dir, `${id}.bin`), encodeCases(fn, [{ id: 0, inputs }]));
        units.push(
          `namespace ${id} {\n${source
            .replace(/^#include.*\n/gm, '')
            .replace('int main(', 'int entry(')
            .replace('"cases.bin"', `"${id}.bin"`)
            .replace('"out/results.bin"', `"out/${id}.bin"`)}\n#undef CK\n}`,
        );
        launches.push(`if (${id}::entry(1, nullptr)) return 1;`);
        results[variant] = id;
      }
      checks.push({ name, mode, ref, results });
    }
  }
  const headers = cudaSource(compileTix('fn f(x: f32[1]): f32[1] { return x; }'), 'f').match(
    /^#include.*$/gm,
  );
  writeFileSync(
    join(dir, 'main.cu'),
    [...headers, ...units, `int main() { ${launches.join('\n')} return 0; }`].join('\n'),
  );
  const status = JSON.parse(
    execFileSync(process.execPath, ['tools/cuda-remote.mjs', dir, '--standalone'], {
      encoding: 'utf8',
      timeout: 120_000,
    }),
  );
  assert.match(status.stdout, /NVIDIA GB10/);
  console.log(status.stdout.trim().split('\n')[0]);
  let reproduced = 0;
  for (const { name, mode, ref, results } of checks) {
    const counts = {};
    for (const [variant, id] of Object.entries(results)) {
      const [got] = decodeResults(readFileSync(join(dir, 'out', `${id}.bin`)), ref.shape.length, [0], 1);
      assert.deepEqual(got.shape, ref.shape);
      const expected = words(ref.data);
      counts[variant] = words(got.data).reduce((n, x, i) => n + Number(x !== expected[i]), 0);
    }
    reproduced += counts.stock;
    assert.equal(counts.widened, 0, `${name} ${mode}`);
    console.log(JSON.stringify({ name, mode, outputs: ref.data.length, ...counts }));
  }
  assert.ok(reproduced > 0);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
