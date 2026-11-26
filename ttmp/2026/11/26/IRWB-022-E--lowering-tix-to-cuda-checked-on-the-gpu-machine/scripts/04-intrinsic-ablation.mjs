// From the repository root after npm run build. One untimed GPU invocation. No source files are edited.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileTix, cudaSource, optimizeTix, runTix } from '../../../../../../dist/tensor/index.js';
import { encodeCudaCases, decodeCudaResults } from '../../../../../../dist/tensor/cuda-run.js';
import { value } from '../../../../../../dist/tensor/model.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

const plan = [
  ['softmax', { N: 4, C: 19 }, 'exp'],
  ['attention', { Q: 8, K: 13, D: 7, V: 9 }, 'exp'],
  ['mlp', { N: 6, D: 15, H: 17, O: 11 }, 'tanh'],
  ['probeLog', { N: 1 }, 'log'],
];
const jobs = [];
for (const [name, bindings, op] of plan) {
  const scalar = name === 'probeLog';
  const source = scalar
    ? 'fn probeLog(x: f32[N]): f32[N] { y[i] = log(x[i]); return y; }'
    : readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8');
  const original = compileTix(source),
    env = new Map(Object.entries(bindings));
  const random = seededRandom(22);
  const inputs = Object.fromEntries(
    original.current.value.functions[0].params.map(p => {
      const shape = p.shape.map(a => value(a, env));
      const length = shape.reduce((a, b) => a * b, 1);
      const data = Float32Array.from({ length }, () => (scalar ? 3.243557929992676 : 2 * random() - 1));
      return [p.name, { shape, data }];
    }),
  );
  for (const optimized of scalar ? [false] : [false, true]) {
    const opt = optimized ? optimizeTix(original, ['inline', 'split-sum']) : undefined;
    assert.ok(!opt || opt.steps.every(step => step.accepted));
    const program = opt?.program ?? original;
    const emitted = cudaSource(program, name);
    const pattern = new RegExp(`\\b${op}f\\((v\\d+)\\)`, 'g');
    assert.equal(Array.from(emitted.matchAll(pattern)).length, 1, `${name}: expected one site`);
    jobs.push({ name, optimized, inputs, program, emitted, pattern, op });
  }
}

const dir = mkdtempSync(join(tmpdir(), 'irwb-intrinsic-ablation-'));
const units = [],
  calls = [];
let headers;
try {
  mkdirSync(join(dir, 'inputs'));
  for (const [i, { inputs, program, emitted, pattern, op }] of jobs.entries()) {
    const fn = program.current.value.functions[0];
    writeFileSync(join(dir, 'inputs', `${i}.bin`), encodeCudaCases(fn, [inputs]));
    const start = emitted.indexOf('using U =');
    headers ??= emitted.slice(0, start);
    for (const [suffix, unit] of [
      ['f', emitted],
      ['d', emitted.replace(pattern, `__double2float_rn(${op}(static_cast<double>($1)))`)],
    ]) {
      const ns = `job${i}${suffix}`;
      const body = unit
        .slice(start)
        .replace('int main(', 'static int run(')
        .replace('"inputs/cases.bin"', `"inputs/${i}.bin"`)
        .replace('"out/results.bin"', `"out/${i}${suffix}.bin"`)
        .replace(/\n}\s*$/, '\n  return 0;\n}\n');
      units.push(`namespace ${ns} {\n${body}\n}`);
      calls.push(`  if (${ns}::run(1, argv)) return 1;`);
    }
  }
  writeFileSync(
    join(dir, 'main.cu'),
    `${headers}\n${units.join('\n')}\nint main(int, char **argv) {\n${calls.join('\n')}\n}\n`,
  );
  const remote = execFileSync(process.execPath, ['tools/cuda-remote.mjs', dir, '--runtime-dir', 'inputs'], {
    encoding: 'utf8',
  });
  console.log(remote.trim());
  for (const [i, { name, optimized, program, inputs }] of jobs.entries()) {
    const ref = runTix(program, name, inputs);
    const bits = data => new Uint32Array(data.buffer, data.byteOffset, data.length);
    const expected = bits(ref.data);
    const result = suffix => {
      const bytes = readFileSync(join(dir, 'out', `${i}${suffix}.bin`));
      const [got] = decodeCudaResults(bytes, ref.shape.length, 1);
      assert.deepEqual(got.shape, ref.shape);
      return bits(got.data);
    };
    const gpu = result('f'),
      ablated = result('d');
    const mismatch = got => [...got].filter((word, j) => word !== expected[j]).length;
    const first = gpu.findIndex((word, j) => word !== expected[j]);
    const hex = n => `0x${n.toString(16).padStart(8, '0')}`;
    const left = mismatch(gpu),
      right = mismatch(ablated);
    console.log(
      JSON.stringify({
        name,
        optimized,
        size: gpu.length,
        shippedMismatches: left,
        widenedMismatches: right,
        first:
          first < 0 ? null : { offset: first, shipped: hex(gpu[first]), reference: hex(expected[first]) },
      }),
    );
    assert.ok(left > 0 && right === 0, `${name}: no isolated difference`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
