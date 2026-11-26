// From repo root after build. One untimed tool invocation. Only diagnostic TU bytes change.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileTix, cudaSource, optimizeTix, runTix } from '../../../../../../dist/tensor/index.js';
import { encodeBatch, decodeBatch } from '../../../../../../dist/tensor/cuda-run.js';
import { value } from '../../../../../../dist/tensor/model.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

const dir = mkdtempSync(join(tmpdir(), 'tix-isolate-'));
const includes = new Set(),
  units = [],
  runs = [];
try {
  for (const [name, dims, op] of [
    ['softmax', { N: 9, C: 31 }, 'exp'],
    ['attention', { Q: 19, K: 17, D: 8, V: 7 }, 'exp'],
    ['mlp', { N: 17, D: 13, H: 31, O: 17 }, 'tanh'],
  ]) {
    const p = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
    const fn = p.current.value.functions[0],
      rand = seededRandom(22);
    const inputs = Object.fromEntries(
      fn.params.map(param => {
        const shape = param.shape.map(d => value(d, new Map(Object.entries(dims))));
        return [
          param.name,
          { shape, data: Float32Array.from({ length: shape.reduce((x, y) => x * y) }, () => 2 * rand() - 1) },
        ];
      }),
    );
    const { bytes, shapes } = encodeBatch(fn, [inputs]);
    writeFileSync(join(dir, `${name}.bin`), bytes);
    for (const [rev, program] of [
      ['original', p],
      ['optimized', optimizeTix(p, ['inline', 'split-sum']).program],
    ]) {
      const ref = runTix(program, name, inputs).data;
      const source = cudaSource(program, name);
      for (const variant of ['shipped', 'widened']) {
        const id = `u${units.length}`;
        const body = source
          .replace(/^#include .*$/gm, line => {
            includes.add(line);
            return '';
          })
          .replace('int main()', 'int run()')
          .replace('"input.bin"', `"${name}.bin"`)
          .replace('"out/result.bin"', `"out/${id}.bin"`);
        const wide = body.replaceAll(
          new RegExp(`\\b${op}f\\((v\\d+)\\)`, 'g'),
          `__double2float_rn(${op}((double)$1))`,
        );
        if (wide === body) throw Error(`No call to replace in ${id}`);
        units.push(`namespace ${id} {\n${variant === 'shipped' ? body : wide}\n}`);
        runs.push({ id, name, rev, variant, ref, shapes });
      }
    }
  }
  writeFileSync(
    join(dir, 'main.cu'),
    [
      ...includes,
      ...units,
      'int main(){',
      ...runs.map(({ id }) => `if(${id}::run()) return 1;`),
      'return 0; }',
    ].join('\n'),
  );
  execFileSync(process.execPath, ['tools/cuda-remote.mjs', dir], { encoding: 'utf8' });
  for (const { id, name, rev, variant, ref, shapes } of runs) {
    const [got] = decodeBatch(readFileSync(join(dir, `out/${id}.bin`)), shapes);
    const words = a => new Uint32Array(a.buffer, a.byteOffset, a.length);
    const a = words(ref),
      b = words(got.data);
    console.log(name, rev, variant, `${a.filter((v, i) => v !== b[i]).length}/${a.length} different words`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
