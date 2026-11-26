import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnalysisManager } from '../../../../../../dist/framework/contracts/index.js';
import { artifact, propose, transform, verify } from './02-row-certificate-lib.mjs';
import { compileTix, cudaSource, runTix } from '../../../../../../dist/tensor/index.js';
import { cudaArtifact, createCudaLowering } from '../../../../../../dist/tensor/cuda-contract.js';
import { cudaCases, seed } from '../../../../../../dist/tensor/contract.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/differential.js';

const corpus = name => compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
const selected = (base, name) => base.value.functions.find(fn => fn.name === name);

for (const name of ['softmax', 'layernorm', 'attention']) {
  const base = corpus(name).current;
  const plan = propose(base, name);
  const direct = verify(base, plan);
  console.log(JSON.stringify({ test: name, direct }));
  if (name === 'attention') {
    assert.equal(direct.ok, false);
    continue;
  }
  const candidate = artifact(plan);
  const manager = new AnalysisManager();
  const accept = await manager.verifyTransformation({ source: base }, { schedule: candidate }, transform);
  assert.equal(accept.execution.status, 'accepted');
  const mutants = {
    stale: p => { p.base = 'different'; },
    barrier: p => { p.phases[0].after = false; },
    lastColumn: p => { p.phases[1].tail = 'drop-after-first-tile'; },
    address: p => { p.phases[1].expr = { kind: 'literal', text: '0' }; },
    writer: p => { p.phases[1].lane = 'scalar'; },
    sum: p => { p.phases[2].fold = 'max-join'; },
    resource: p => { p.cap = 65536; },
    topology: p => { [p.phases[0], p.phases[1]] = [p.phases[1], p.phases[0]]; },
  };
  const rejections = Object.fromEntries(Object.entries(mutants).map(([label, mutate]) => {
    const copy = structuredClone(plan);
    mutate(copy);
    const rejection = verify(base, copy);
    assert.equal(rejection.ok, false);
    return [label, rejection.reason];
  }));
  const invalid = structuredClone(plan);
  mutants.barrier(invalid);
  await assert.rejects(manager.verifyTransformation({ source: base }, { schedule: artifact(invalid) }, transform));

  const coldCalls = [];
  const directBatches = [];
  for (let batch = 0; batch < 40; batch++) {
    const start = performance.now();
    for (let j = 0; j < 100; j++) assert.equal(verify(base, plan).ok, true);
    directBatches.push((performance.now() - start) / 100);
    const wall = performance.now();
    const probe = await new AnalysisManager().verifyTransformation({ source: base }, { schedule: candidate }, transform);
    assert.equal(probe.execution.status, 'accepted');
    coldCalls.push(performance.now() - wall);
  }
  const distribution = array => {
    const sorted = array.toSorted((a, b) => a - b);
    return [sorted[19], sorted[37]];
  };
  console.log(JSON.stringify({ test: name, assurance: accept.execution.checks[0].assurance,
    directMsMedianP95: distribution(directBatches), managerMsMedianP95: distribution(coldCalls), rejections }));
}

const cancellation = compileTix('fn cancel(x: f32[N]): f32[N] { y[i] = (x[i] + 16777216) - 16777216; return y; }');
const signedZero = compileTix('fn zero(x: f32[N]): f32[N] { y[i] = x[i] - x[i]; return y; }');
const fake = (program, name, mutate) => createCudaLowering('research-tolerance/' + name,
  async (_source, _fn, inputs) => inputs.map(input => mutate(runTix(program, name, input))));
const validReject = await fake(cancellation, 'cancel', x => x)(cancellation.current, 'cancel');
const invalidAccept = await fake(signedZero, 'zero', out => ({ ...out,
  data: new Float32Array(out.data.length).fill(-0) }))(signedZero.current, 'zero');
assert.equal(validReject.accepted, false);
assert.equal(invalidAccept.accepted, true);
console.log(JSON.stringify({ test: 'lowering-relation', validReject, invalidAccept }));

const softmax = corpus('softmax');
const source = cudaSource(softmax, 'softmax');
const fn = selected(softmax.current, 'softmax');
let seen = 0, maxWidth = 0;
const evaluator = createCudaLowering('research-tail-sample',
  async (_source, _fn, batch) => batch.map(input => {
    seen++;
    maxWidth = Math.max(maxWidth, input.x.shape[1]);
    const shape = input.x.shape;
    if (shape[1] <= 128) return runTix(softmax, 'softmax', input);
    const output = runTix(softmax, 'softmax', input);
    for (let i = 0; i < output.data.length; i++) if (i % shape[1] >= 128) output.data[i] = 0;
    return output;
  }));
const observed = await evaluator(softmax.current, 'softmax', cudaArtifact('softmax', source + '\n// modeled tail mutant'));
assert.equal(observed.accepted, true);
assert.equal(seen, cudaCases(fn, seededRandom(seed)).length);
const uniform = runTix(softmax, 'softmax', { x: { shape: [1, 131], data: new Float32Array(131) } });
assert.notEqual(uniform.data[130], 0);
console.log(JSON.stringify({ test: 'conditional-omitted-tail', observed, seen, maxWidth,
  witness: { coordinate: [0, 130], expected: uniform.data[130], got: 0 } }));
