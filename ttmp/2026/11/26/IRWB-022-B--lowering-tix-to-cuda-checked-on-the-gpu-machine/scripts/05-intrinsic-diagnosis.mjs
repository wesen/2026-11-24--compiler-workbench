import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { encodeCases, decodeResults } from '../../../../../../dist/tensor/cuda-io.js';
import { compileTix, cudaSource, optimizeTix, runTix } from '../../../../../../dist/tensor/index.js';
import { value } from '../../../../../../dist/tensor/model.js';

const targets = {
  softmax: { op: 'exp', dims: { N: 4, C: 19 } },
  attention: { op: 'exp', dims: { Q: 9, K: 7, D: 5, V: 8 } },
  mlp: { op: 'tanh', dims: { N: 4, D: 7, H: 11, O: 6 } },
};
const seed = 20;
const scales = [0.125, 0.25, 0.5, 1, 1.5, 2, 3, 4];
const dir = await mkdtemp('/tmp/irwb-022-b-cause-');
const entries = [];
const blocks = [];
const runtimeFiles = [];
let includes;

function inputsFor(fn, dims) {
  const dimsMap = new Map(Object.entries(dims));
  const random = seededRandom(seed);
  return scales.map(scale =>
    Object.fromEntries(
      fn.params.map(param => {
        const shape = param.shape.map(d => value(d, dimsMap));
        const length = shape.reduce((a, b) => a * b, 1);
        const data = Float32Array.from({ length }, () => (2 * random() - 1) * scale);
        return [param.name, { shape, data }];
      }),
    ),
  );
}

function mismatches(expected, actual) {
  let differences = 0;
  let maxAbs = 0;
  for (const [i, ref] of expected.entries()) {
    const got = actual[i];
    assert.deepEqual(got.shape, ref.shape);
    assert.equal(got.data.length, ref.data.length);
    const words = array => new Uint32Array(array.buffer, array.byteOffset, array.length);
    const a = words(ref.data);
    const b = words(got.data);
    for (let k = 0; k < a.length; k++) {
      assert.ok(Number.isFinite(ref.data[k]) && Number.isFinite(got.data[k]));
      if (a[k] !== b[k]) differences++;
      maxAbs = Math.max(maxAbs, Math.abs(ref.data[k] - got.data[k]));
    }
  }
  return { differences, maxAbs };
}

try {
  for (const [name, { op, dims }] of Object.entries(targets)) {
    const original = compileTix(await readFile(`corpus/tensor/${name}/main.tix`, 'utf8'));
    const optimized = optimizeTix(original, ['inline', 'split-sum']).program;
    for (const [stage, program] of [
      ['original', original],
      ['optimized', optimized],
    ]) {
      const [fn] = program.current.value.functions;
      const id = name + '_' + stage;
      const inputFile = id + '.bin';
      const inputs = inputsFor(fn, dims);
      const refs = inputs.map(data => runTix(program, name, data));
      await writeFile(join(dir, inputFile), encodeCases(fn, inputs));
      runtimeFiles.push(inputFile);
      const emitted = cudaSource(program, name);
      includes ??= emitted.match(/^#include[^\n]+/gm).join('\n');
      const source = emitted
        .replace(/^#include[^\n]+\n/gm, '')
        .replace('int main(', 'int run(')
        .replace('"cases.bin"', `"${inputFile}"`);
      const intrinsic = new RegExp(`\\b${op}f\\((value\\d+)\\)`, 'g');
      const calls = [...source.matchAll(intrinsic)].length;
      assert.equal(calls, 1);
      const patched = source.replace(intrinsic, (_, arg) => `__double2float_rn(${op}((double)${arg}))`);
      for (const [variant, code] of [
        ['float', source],
        ['double', patched],
      ]) {
        const label = id + '_' + variant;
        const unit = code.replace('out/results.bin', `out/${label}.bin`);
        blocks.push({ label, code: `namespace ${label} {\n${unit}\n}` });
      }
      entries.push({ name, op, stage, id, fn, refs });
    }
  }
  const main = [
    includes,
    ...blocks.map(b => b.code),
    'int main(int argc, char **argv) {',
    ...blocks.map(b => `  if (${b.label}::run(argc, argv) != 0) return 1;`),
    '  return 0;',
    '}',
  ].join('\n');
  await writeFile(join(dir, 'main.cu'), main);
  const { stdout } = await promisify(execFile)(process.execPath, [
    'tools/cuda-remote.mjs',
    dir,
    '--host',
    'manuel@bling',
    ...runtimeFiles.flatMap(file => ['--input', file]),
  ]);
  const remote = JSON.parse(stdout);
  const rows = [];
  for (const { name, op, stage, id, fn, refs } of entries) {
    const counts = {};
    for (const variant of ['float', 'double']) {
      const data = await readFile(join(dir, 'out', id + '_' + variant + '.bin'));
      counts[variant] = mismatches(refs, decodeResults(data, refs.length, fn.shape.length, 1));
    }
    assert.ok(counts.float.differences > 0, id + ' should reproduce a mismatch');
    assert.equal(counts.double.differences, 0, id + ' should agree after substituting the intrinsic');
    rows.push({
      name,
      stage,
      op,
      comparedElements: refs.reduce((n, ref) => n + ref.data.length, 0),
      ...counts,
    });
  }
  console.log(JSON.stringify({ node: process.version, seed, scales, targets, remote, rows }, null, 2));
} finally {
  await rm(dir, { recursive: true, force: true });
}
