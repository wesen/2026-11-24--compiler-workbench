import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import {
  AnalysisManager, createArtifact, defineInvariant, defineIR, defineTransformation,
} from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTix } from '../../../../../../dist/tensor/index.js';
import { cudaArtifact, createCudaLowering } from '../../../../../../dist/tensor/cuda-contract.js';
import { cudaCases, seed } from '../../../../../../dist/tensor/contract.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/differential.js';
import { TixIR } from '../../../../../../dist/tensor/ir.js';
import { plain } from '../../../../../../dist/tensor/model.js';

const corpus = name => compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
const selected = (base, name) => base.value.functions.find(fn => fn.name === name);
const same = isDeepStrictEqual;
const foldMode = expr => {
  if (expr.kind === 'reduce') return expr.op === 'max' ? 'max-join' : 'lex';
  return expr.kind === 'op' ? expr.args.map(foldMode).find(Boolean) : undefined;
};

// Deliberately modest proposal generator. The validator derives the facts afresh.
function propose(base, name) {
  const fn = selected(base, name);
  return {
    base: base.revision, fn: name, lanes: 128, cap: 2048,
    phases: fn.statements.map(st => ({
      tensor: st.name, lane: st.shape.length === 1 ? 'scalar' : 'cyclic',
      tail: 'guarded', fold: foldMode(st.expr) ?? 'none',
      after: st.name !== fn.result, expr: st.expr,
    })),
  };
}

function verify(base, plan) {
  const reject = reason => ({ ok: false, reason });
  if (plan.base !== base.revision) return reject('stale revision');
  const fn = selected(base, plan.fn);
  if (!fn || fn.params[0]?.shape.length !== 2) return reject('missing rank-two row source');
  const [rows, cols] = fn.params[0].shape.map(plain);
  if (!rows || !cols || rows === cols) return reject('need distinct symbolic row and column dimensions');
  if (![32, 64, 128, 256].includes(plan.lanes) || !Number.isSafeInteger(plan.cap) || plan.cap < 1)
    return reject('unsupported launch geometry');

  const dimensions = tensor => tensor.shape.map(a => plain(a) ?? (a.terms.length ? null : a.constant));
  const statements = new Map(fn.statements.map(st => [st.name, st]));
  const output = statements.get(fn.result);
  if (!output || !same(dimensions(output), [rows, cols])) return reject('need row-shaped output');
  if (plan.phases.length !== statements.size) return reject('wrong phase count');

  const prior = new Map();
  let shapeOnlyVisits = 0, scalarSlots = 0, vectorSlots = 0;
  for (const phase of plan.phases) {
    const st = statements.get(phase.tensor);
    if (!st || prior.has(phase.tensor)) return reject('unknown or duplicate phase');
    const dims = dimensions(st);
    const scalar = same(dims, [rows]);
    if (!scalar && !same(dims, [rows, cols])) return reject('unsupported phase shape');
    const row = st.axes[0].id;
    const column = st.axes[1]?.id;
    if (phase.lane !== (scalar ? 'scalar' : 'cyclic')) return reject('nonunique writer mapping');
    if (phase.tail !== 'guarded') return reject('column coverage is not exact for partial blocks');
    if (!same(phase.expr, st.expr)) return reject('scalar tree or address differs from source');
    if (typeof phase.after !== 'boolean') return reject('barrier mode must be block-uniform');
    if (st.name !== fn.result) {
      if (scalar) scalarSlots++;
      else vectorSlots++;
    }

    let verifiedFold = 'none';
    function expression(e, col, reduceAllowed) {
      shapeOnlyVisits++;
      if (e.kind === 'reduce') {
        if (!reduceAllowed || !scalar || verifiedFold !== 'none' || e.axes.length !== 1 ||
            e.axes[0].extent.kind !== 'dim' || plain(e.axes[0].extent.dim) !== cols)
          return 'unsupported reduction domain';
        verifiedFold = e.op === 'max' && phase.fold === 'max-join' ? 'max-join' : 'lex';
        return expression(e.body, e.axes[0].id, false);
      }
      if (e.kind === 'op') {
        for (const child of e.args) {
          const error = expression(child, col, reduceAllowed);
          if (error) return error;
        }
      }
      if (e.kind !== 'load') return undefined;
      const param = fn.params.find(p => p.name === e.name);
      const target = param ?? statements.get(e.name);
      if (!target) return 'unknown tensor';
      if (!param) {
        const writer = prior.get(e.name);
        if (!writer || e.name === fn.result) return 'read before a shared producer';
        if (!writer.after) return 'missing barrier after ' + e.name;
      }
      const got = e.indices.map(plain);
      const targetShape = dimensions(target);
      if (same(targetShape, [rows, cols]) && col && same(got, [row, col])) return undefined;
      if (same(targetShape, [rows]) && same(got, [row])) return undefined;
      if (param && same(targetShape, [cols]) && col && same(got, [col])) return undefined;
      if (param && same(targetShape, [1]) && same(e.indices, [{ constant: 0, terms: [] }]))
        return undefined;
      return 'load is outside its proved row or parameter domain';
    }

    const error = expression(st.expr, column, true);
    if (error) return reject(phase.tensor + ': ' + error);
    if (phase.fold !== verifiedFold) return reject('rounding recurrence differs');
    prior.set(phase.tensor, phase);
  }
  // Conservative distinct slots, three scalars of implementation overhead and per-lane maximum scratch.
  const sharedBytes = 4 * (scalarSlots + vectorSlots * plan.cap + plan.lanes + 3);
  if (!Number.isSafeInteger(sharedBytes) || sharedBytes > 49152) return reject('shared-memory guard insufficient');
  return {
    ok: true,
    evidence: { method: 'row-schedule-certificate', version: '1', relation: 'f32-nan-class',
      sourceRevision: base.revision, shapeOnlyVisits, sharedBytes },
  };
}

const Schedule = defineIR({
  id: 'research.tix-row-schedule', version: '1', description: 'Restricted row schedule',
  validate(plan) {
    if (!plan || !Array.isArray(plan.phases)) throw Error('Expected phases');
  },
});
const ports = { source: TixIR, schedule: Schedule };
const certificate = defineInvariant({
  id: 'research.tix-row-schedule-certificate', version: '1', description: 'Check schedule structure',
  inputs: ports, check(_ctx, { source, schedule }) { return verify(source, schedule.value); },
});
const transform = defineTransformation({
  id: 'research.tix-resident', version: '1', description: 'Select row schedule',
  inputs: { source: TixIR }, outputs: { schedule: Schedule },
  ensures: [{ invariant: certificate, bindings: {
    source: { from: 'inputs', port: 'source' }, schedule: { from: 'outputs', port: 'schedule' },
  } }],
});
const artifact = plan => createArtifact(Schedule, 'tix-row/' + plan.fn, plan);

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
