import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAllFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { createArtifact } = await import('../../dist/framework/contracts/index.js');
const { lowerToImage, runImage } = await import('../../dist/typed/backend/index.js');
const { benchCase, casesFrom, evaluate } = await import('../../dist/typed/evaluate.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { referenceCompile, referenceRun } = await import('../../dist/typed/reference.js');
const { BindingsIR } = await import('../../dist/typed/specialize.js');
const { createWb } = await import('../../dist/workbench/index.js');

const id = 'f32-dsp';
const files = projectAllFiles(id);
const project = projectSource(id, files);
const backend = { chains: true, coalesce: true, homes: true };
const sampling = { count: 40, seed: 7 };
const statementCap = 20_000;
const maxErrorDb = -100;
const kernels = ['fft', 'biquadBank'];

function freshProgram() {
  const program = Program.fromProject(project);
  assert.equal(program.status, 'ok', JSON.stringify(program.error));
  return program;
}

function generated(program, fn) {
  return casesFrom(storeOf(program.origin.value), fn, { ...sampling, inputs: program.inputs[fn] });
}

function packFloats(values) {
  const word = new DataView(new ArrayBuffer(4));
  return values.flatMap(value => {
    word.setFloat32(0, value, true);
    return [word.getUint16(0, true), word.getUint16(2, true)];
  });
}

function unpackFloats(bytes, buffer, count) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: count }, (_, i) => data.getFloat32(buffer + 4 + 4 * i, true));
}

function directedCases(origin) {
  const cases = [];
  const st = storeOf(origin.value);
  for (const n of [8, 16]) {
    for (const impulse of [true, false]) {
      const work = Array(32).fill(0);
      if (impulse) {
        work[6] = 1;
        work[7] = -0.5;
      }
      // A nonzero tail makes overwrites beyond the size-8 transform observable.
      for (let i = 2 * n; i < work.length; i++) work[i] = (i % 2 ? -1 : 1) / 4;
      cases.push(benchCase(st, 'fft', {
        ...project.meta.inputs.fft,
        work: { cells: packFloats(work) },
        n,
      }));
    }
  }
  for (const impulse of [true, false]) {
    const samples = Array(16).fill(0);
    if (impulse) samples[0] = 1;
    cases.push(benchCase(st, 'biquadBank', {
      ...project.meta.inputs.biquadBank,
      samples: { cells: packFloats(samples) },
    }));
  }
  return cases;
}

function dft(samples, n) {
  const output = [];
  for (let k = 0; k < n; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const angle = -2 * Math.PI * k * t / n;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      re += samples[2 * t] * cos - samples[2 * t + 1] * sin;
      im += samples[2 * t] * sin + samples[2 * t + 1] * cos;
    }
    output.push(re, im);
  }
  return output;
}

function filterBands(samples, coefficients) {
  return [0, 1].map(band => {
    const [b0, b1, b2, a1, a2] = coefficients.slice(5 * band, 5 * band + 5);
    const y = [];
    for (let i = 0; i < samples.length; i++) {
      y.push(b0 * samples[i] + b1 * (samples[i - 1] ?? 0) + b2 * (samples[i - 2] ?? 0)
        - a1 * (y[i - 1] ?? 0) - a2 * (y[i - 2] ?? 0));
    }
    return y;
  });
}

function numericalOracle({ fn, args, memory }) {
  if (fn === 'fft') {
    const [work, , n] = args;
    return { result: n, buffer: work, blocks: [dft(unpackFloats(memory, work, 2 * n), n)] };
  }
  const [samples, coefficients, output] = args;
  const blocks = filterBands(unpackFloats(memory, samples, 16), unpackFloats(memory, coefficients, 10));
  return { result: 16, buffer: output, blocks };
}

function checkNumerics(c, oracle, actual, label) {
  assert.equal(actual.result, oracle.result, label);
  assert.equal(actual.bytes.length, c.memory.length, label);
  const start = oracle.buffer + 4;
  assert.deepEqual(actual.bytes.subarray(0, start), c.memory.subarray(0, start), label);
  let offset = 0;
  const errors = oracle.blocks.map(expected => {
    const lanes = unpackFloats(actual.bytes, oracle.buffer + offset, expected.length);
    offset += 4 * expected.length;
    assert.ok(lanes.every(Number.isFinite), label);
    const rms = values => Math.sqrt(values.reduce((sum, x) => sum + x * x, 0) / values.length);
    const db = 20 * Math.log10(rms(lanes.map((x, i) => x - expected[i])) / Math.max(rms(expected), 1e-6));
    assert.ok(db <= maxErrorDb, `${label}: ${db} dB`);
    return db;
  });
  assert.deepEqual(actual.bytes.subarray(start + offset), c.memory.subarray(start + offset), label);
  return Math.max(...errors);
}

function checkCompleted(run, label) {
  assert.equal(run.trap, false, label);
  assert.equal(run.limit, false, label);
  assert.ok(!run.fault, label);
}

function checkExact(expected, actual, label) {
  checkCompleted(actual, label);
  assert.deepEqual(actual.result, expected.result, label);
  assert.deepEqual(actual.bytes, expected.bytes, label);
}

async function checkedSpeed(program) {
  // Program.pipeline uses seed 7 for its ordinary per-pass gate.
  const run = await program.pipeline(project.meta.pipeline, { count: sampling.count });
  assert.deepEqual(run.steps.filter(step => step.rejected), []);
  return program.revisions.map(revision => [`r${revision.rev} ${revision.pass}`, storeOf(revision.artifact.value)]);
}

function evalCase(store, c, label) {
  const run = evaluate(store, c.fn, c.args, c.memory.slice(), { limit: statementCap });
  checkCompleted(run, label);
  assert.ok(run.steps <= statementCap, label);
  return run;
}

function imageCase(image, c) {
  return runImage(image, c.fn, c.args, c.memory.slice());
}

function workload(c) {
  return c.fn === 'fft' ? `fft(${c.args[2]})` : c.fn;
}

function recordMax(row, key, value) {
  row[key] = Math.max(row[key] ?? -Infinity, value);
}

test('f32 DSP agrees with the binary64 oracles and both RV32 compilers', async t => {
  const program = freshProgram();
  const revisions = await checkedSpeed(program);
  const reference = referenceCompile(project.source);
  const r0Image = lowerToImage(program.origin, backend).image;
  const speedImage = lowerToImage(program.head, backend).image;
  const fftCases = generated(program, 'fft');
  assert.deepEqual(new Set(fftCases.map(c => c.args[2])), new Set([8, 16]));
  const cases = [
    ...directedCases(program.origin),
    ...fftCases,
    ...generated(program, 'biquadBank'),
    ...generated(program, 'dot3'),
  ];
  const report = {};

  for (const [i, c] of cases.entries()) {
    const label = `${workload(c)} case ${i}`;
    const oracle = kernels.includes(c.fn) ? numericalOracle(c) : null;
    const baseline = evalCase(revisions[0][1], c, label + ' r0');
    checkExact(baseline, referenceRun(reference, c.fn, c.args, c.memory.slice()), label + ' stock reference');
    const r0 = imageCase(r0Image, c);
    const speed = imageCase(speedImage, c);
    checkExact(baseline, r0, label + ' r0 image');
    checkExact(baseline, speed, label + ' speed image');

    if (oracle) {
      const row = report[workload(c)] ??= {};
      recordMax(row, 'errorDb', checkNumerics(c, oracle, baseline, label));
      recordMax(row, 'r0Statements', baseline.steps);
      recordMax(row, 'r0Instructions', r0.steps);
      recordMax(row, 'speedInstructions', speed.steps);
    }
    for (const [revision, store] of revisions.slice(1)) {
      const optimized = evalCase(store, c, label + ' ' + revision);
      checkExact(baseline, optimized, label + ' ' + revision);
      if (oracle) recordMax(report[workload(c)], 'checkedStatements', optimized.steps);
    }
  }
  t.diagnostic(JSON.stringify(report));
});

test('binding FFT length preserves sampled results and measures the size-16 images on identical inputs', async t => {
  const general = freshProgram();
  await checkedSpeed(general);
  const specialized = freshProgram();
  const facts = createArtifact(BindingsIR, id, {
    formatVersion: 1,
    source: id,
    bindings: [{ fn: 'fft', param: 'n', value: 16, entity: 'f32-dsp#fft16' }],
  });
  assert.equal((await specialized.specialize(facts)).changed, true);
  assert.equal(specialized.inputs.fft.n, 16);
  const revisions = await checkedSpeed(specialized);
  const generalImage = lowerToImage(general.head, backend).image;
  const specializedImage = lowerToImage(specialized.head, backend).image;
  const fftCases = generated(specialized, 'fft');
  assert.equal(fftCases.length, sampling.count);
  assert.ok(fftCases.every(c => c.args[2] === 16));
  const measurements = {};

  for (const c of [...fftCases, ...generated(specialized, 'biquadBank'), ...generated(specialized, 'dot3')]) {
    const label = `${workload(c)} specialized case ${c.n}`;
    const baseline = evalCase(revisions[0][1], c, label + ' r0');
    for (const [revision, store] of revisions.slice(1)) {
      const optimized = evalCase(store, c, label + ' ' + revision);
      checkExact(baseline, optimized, label + ' ' + revision);
    }
    const specializedRun = imageCase(specializedImage, c);
    checkExact(baseline, specializedRun, label + ' specialized image');
    if (c.fn === 'fft') {
      const generalRun = imageCase(generalImage, c);
      checkExact(baseline, generalRun, label + ' general image');
      recordMax(measurements, 'generalInstructions', generalRun.steps);
      recordMax(measurements, 'specializedInstructions', specializedRun.steps);
    }
  }
  t.diagnostic(JSON.stringify(measurements));
});

test('the workbench comparison runs on a fresh copy', async t => {
  const wb = createWb({ projects: [{ id, files }] });
  const open = wb.projects.open(id);
  const before = open.program.rev;
  const rows = await open.run('compare');
  assert.deepEqual(rows.map(row => row.fn), kernels);
  for (const row of rows) {
    assert.ok(row.r0Instructions > 0);
    assert.ok(row.speedInstructions > 0);
  }
  assert.equal(open.program.rev, before);
  t.diagnostic(JSON.stringify(rows));
});
