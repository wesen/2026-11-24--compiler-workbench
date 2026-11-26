import assert from 'node:assert/strict';
import test from 'node:test';
import { cudaLowering, compareCuda, verifyCudaLowering } from '../../dist/tensor/cuda-contract.js';
import { decodeCudaResults, encodeCudaCases } from '../../dist/tensor/cuda-run.js';
import { compileTix, cudaSource, optimizeTix, runTix } from '../../dist/tensor/index.js';

const input = (shape, data) => ({ shape, data: Float32Array.from(data) });
const sum = compileTix('fn f(x: f32[N,K]): f32[N] { y[i] = sum(j) x[i,j]; return y; }');

test('emits deterministic statement kernels and split bounds for the current revision', () => {
  const original = cudaSource(sum, 'f');
  const optimized = optimizeTix(sum, ['split-sum']);
  assert.equal(optimized.steps[0].accepted, true);
  const split = cudaSource(optimized.program, 'f');
  assert.notEqual(split, original);
  assert.equal(cudaSource(sum, 'f'), original);
  assert.equal((original.match(/__global__ void/g) ?? []).length, 1);
  assert.equal((split.match(/for \(long long/g) ?? []).length, 2);
  assert.match(split, /% 4LL/);
  assert.match(split, /tix_tail\(/);
  assert.ok(
    split.indexOf('cudaFuncGetAttributes(&attributes, statement_0)') < split.indexOf('cudaEventRecord(start'),
  );
});

test('CUDA batches preserve f32 words and reject invalid framing', () => {
  const p = compileTix('fn f(x: f32[N]): f32[N] { return x; }');
  const [fn] = p.current.value.functions;
  const cases = [{ id: 3, inputs: { x: input([2], [-0, 1]) } }];
  const request = encodeCudaCases(fn, cases);
  assert.equal(request.readUInt32LE(0), 1);
  assert.equal(request.readUInt32LE(4), 3);
  assert.equal(request.readBigUInt64LE(8), 2n);
  assert.equal(request.readUInt32LE(16), 0x80000000);
  const response = Buffer.alloc(request.length + 4);
  request.copy(response, 0, 0, 16);
  response.writeFloatLE(0.25, 16);
  request.copy(response, 20, 16);
  const [result] = decodeCudaResults(fn, cases, response, 1);
  assert.deepEqual([...result.data], [-0, 1]);
  assert.deepEqual(result.trials, [0.25]);
  assert.throws(() => decodeCudaResults(fn, cases, response.subarray(0, -1), 1), /truncated/i);
  assert.throws(() => decodeCudaResults(fn, [{ id: 4 }], response, 1), /result ID/);
  assert.throws(() => decodeCudaResults(fn, cases, Buffer.concat([response, Buffer.alloc(1)]), 1), /extra/i);
});

test('the two tolerance rules exhaust the coordinates and preserve nonfinite classes and zero sign', () => {
  const f64 = x => ({ shape: [1], data: Float64Array.of(x) });
  const compare = (s, r, gpu) => compareCuda(input([1], [s]), f64(r), input([1], [gpu]));
  assert.equal(compare(1, 1, 1 + 2e-5).v, 'agree');
  assert.match(compare(1, 1, 1.001).reason, /f64 rule/);
  assert.equal(compare(0, 1, 0).v, 'agree');
  assert.match(compare(0, 1, 1).reason, /f32 rule/);
  assert.equal(compare(Infinity, 1, Infinity).v, 'agree');
  assert.equal(compare(NaN, 0, NaN).v, 'agree');
  assert.equal(compare(-Infinity, -Infinity, Infinity).v, 'disagree');
  assert.equal(compare(-0, -0, 0).v, 'disagree');
});

test('the checked transformation batches, retries interrupted work and replays completed verdicts', async () => {
  const program = optimizeTix(sum, ['split-sum']).program;
  const batches = [];
  const runner = async (_source, _fn, cases) => {
    batches.push(cases.map(c => c.id));
    if (batches.length === 1) throw Error('simulated interrupted copy');
    return cases.map(c => ({ ...runTix(program, 'f', c.inputs), trials: [0] }));
  };
  const pass = cudaLowering(f => cudaSource(program, f.name) + '// local batch test', runner);
  const check = () => verifyCudaLowering(program.current, 'f', pass);
  assert.match((await check()).reason, /interrupted copy/);
  assert.deepEqual(await check(), { accepted: true, relation: 'tolerance' });
  assert.deepEqual(await check(), { accepted: true, relation: 'tolerance' });
  assert.equal(batches.length, 2);
  assert.ok(batches[0].length > 1);
  assert.deepEqual(batches[0], batches[1]);
});
