// From the worktree root, after npm run build. Add --nan-gpu for one untimed launch.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, cudaSource, optimizeTix, runTix, runTixCuda } = await import(
  new URL('dist/tensor/index.js', root)
);
const { evaluate } = await import(new URL('dist/tensor/evaluate.js', root));
const buf = (shape, data) => ({ shape, data: Float32Array.from(data) });
const programs = new Map();
function program(name, optimized) {
  if (!programs.has(name))
    programs.set(
      name,
      compileTix(readFileSync(new URL('corpus/tensor/' + name + '/main.tix', root), 'utf8')),
    );
  const original = programs.get(name);
  if (!optimized) return original;
  const result = optimizeTix(original, ['inline', 'split-sum']);
  assert.ok(result.steps.every(step => step.accepted));
  assert.notEqual(result.program.current.revision, original.current.revision);
  return result.program;
}

const f = Math.fround;
const identity = x => x;
const small = 2 ** -24;
const a = 1 + 2 ** -23;
const b = 1 - 2 ** -23;

function check(name, optimized, inputs, token, inspect) {
  const p = program(name, optimized);
  assert.ok(cudaSource(p, name).includes(token));
  const [f32, f64] = ['f32', 'f64'].map(precision => [...runTix(p, name, inputs, { precision }).data]);
  assert.ok(f32.some((x, i) => x !== f64[i]));
  const fn = p.current.value.functions.find(fn => fn.name === name);
  function intermediate(tensor) {
    const i = fn.statements.findIndex(s => s.name === tensor);
    assert.ok(i >= 0, tensor);
    const { shape } = fn.statements[i];
    const prefix = { ...fn, statements: fn.statements.slice(0, i + 1), result: tensor, shape };
    return ['f32', 'f64'].map(precision => [...evaluate(prefix, inputs, precision).data]);
  }
  const witness = inspect(f32, f64, intermediate);
  console.log(JSON.stringify({ name, optimized, f32, f64, witness }));
}

function product(f32, f64) {
  assert.deepEqual([f32, f64], [[1], [1 - 2 ** -46]]);
  return { operation: '__fmul_rn', f32: f(a * b), f64: a * b };
}
check('matmul', false, { a: buf([1, 1], [a]), b: buf([1, 1], [b]) }, '__fmul_rn', product);
check(
  'matmul',
  true,
  { a: buf([1, 7], [1, 0, 0, 0, small, small, small]), b: buf([7, 1], Array(7).fill(1)) },
  '__fadd_rn',
  (f32, f64) => {
    assert.deepEqual([f32, f64], [[1 + 2 ** -22], [1 + 3 * small]]);
    return { operation: 'outer __fadd_rn', operands: [1, 3 * small] };
  },
);
check(
  'conv2d',
  false,
  { x: buf([1, 1, 3, 3], [a, ...Array(8).fill(0)]), kernel: buf([1, 1, 3, 3], [b, ...Array(8).fill(0)]) },
  '__fmul_rn',
  product,
);

function exponential(_f32, _f64, intermediate) {
  const e = Math.exp(-1);
  assert.deepEqual(intermediate('e'), [
    [1, f(e)],
    [1, e],
  ]);
  return { operation: '__double2float_rn(exp(...))', argument: -1, f32: f(e), f64: e };
}
for (const optimized of [false, true]) {
  check('softmax', optimized, { x: buf([1, 2], [0, -1]) }, '__double2float_rn(exp', exponential);
  check(
    'attention',
    optimized,
    { q: buf([1, 1], [1]), k: buf([2, 1], [1, 0]), v: buf([2, 1], [0, 1]) },
    '__double2float_rn(exp',
    exponential,
  );
}

if (process.argv.includes('--nan-gpu')) {
  const p = compileTix('fn root(x:f32[N]):f32[N] { y[i] = sqrt(x[i]); return y; }');
  const inputs = { x: buf([3], [-(2 ** -149), -0, 0]) };
  const cpu = runTix(p, 'root', inputs).data;
  const gpu = (await runTixCuda(p, 'root', inputs)).data;
  const words = data =>
    Array.from(new Uint32Array(data.buffer, data.byteOffset, data.length), x =>
      x.toString(16).padStart(8, '0'),
    );
  assert.ok(Number.isNaN(cpu[0]) && Number.isNaN(gpu[0]));
  assert.deepEqual(words(cpu).slice(1), ['80000000', '00000000']);
  assert.deepEqual(words(gpu).slice(1), ['80000000', '00000000']);
  console.log(JSON.stringify({ operation: '__fsqrt_rn', cpuWords: words(cpu), gpuWords: words(gpu) }));
}
check(
  'layernorm',
  false,
  { x: buf([1, 2], [0, 2]), gamma: buf([2], [1, 1]), beta: buf([2], [0, 0]), eps: buf([1], [1]) },
  '__fsqrt_rn',
  (f32, f64, intermediate) => {
    assert.deepEqual(intermediate('variance'), [[1], [1]]);
    const root = Math.sqrt(2);
    assert.deepEqual([f32[1], f64[1]], [f(1 / f(root)), 1 / root]);
    return { operation: '__fsqrt_rn', argument: 2, f32: f(root), f64: root };
  },
);
function geluAtOne(round) {
  const cubic = round(0.044715);
  const argument = round(round(0.79788456) * round(1 + cubic));
  return round(0.5 * round(1 + round(Math.tanh(argument))));
}
for (const optimized of [false, true]) {
  check(
    'mlp',
    optimized,
    {
      x: buf([1, 1], [1]),
      w: buf([1, 1], [1]),
      bias: buf([1], [0]),
      v: buf([1, 1], [1]),
      outBias: buf([1], [0]),
    },
    '__double2float_rn(tanh',
    (f32, f64, intermediate) => {
      assert.deepEqual(intermediate('h'), [[1], [1]]);
      assert.deepEqual([f32[0], f64[0]], [geluAtOne(f), geluAtOne(identity)]);
      return {
        operation: 'GELU literal conversion and rounded arithmetic',
        literal: 0.79788456,
        f32: f(0.79788456),
      };
    },
  );
}
