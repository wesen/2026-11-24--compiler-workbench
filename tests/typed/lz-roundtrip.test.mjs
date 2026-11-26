import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAllFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { createArtifact } = await import('../../dist/framework/contracts/index.js');
const { imageFromCode, lowerToImage, runImage } = await import('../../dist/typed/backend/index.js');
const { agrees, benchCase, casesFrom, evaluate, readBuffer } = await import('../../dist/typed/evaluate.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { BindingsIR } = await import('../../dist/typed/specialize.js');
const { createWb } = await import('../../dist/workbench/index.js');

const id = 'lz-roundtrip';
const files = projectAllFiles(id);
const source = projectSource(id, files);
const backendOptions = { chains: true, coalesce: true, homes: true };
const sample = { count: 100, seed: 7 };
const longMatch = Array(24).fill(65);
const collision = [65, 65, 66, 66, 65, 65, 66];
const longCollision = [...collision, ...collision, ...collision, 65, 65, 66];
const encodedRun = [65, 224, 224, 224, 192];
const scratch = { buffer: [24, 24], cell: [0, 0] };
const codecCase = (store, fn, input, chainLimit) =>
  benchCase(store, fn, { input: { cells: input }, packed: scratch, output: scratch, chainLimit });
const interpret = (store, c) => evaluate(store, c.fn, c.args, c.memory, { limit: 2e4 });
const emulate = (image, c) => runImage(image, c.fn, c.args, c.memory, { limit: 2e5 });

function assertCompletion(run, label) {
  assert.equal(run.limit, false, label);
  assert.equal(run.trap, false, label);
}

function assertPrefix(run, addr, expected, label) {
  assertCompletion(run, label);
  assert.equal(run.result, expected.length, label);
  assert.deepEqual(readBuffer(run.bytes, addr).slice(0, run.result), expected, label);
}

async function checkedSpeed(program, t, label) {
  const { steps } = await program.pipeline(source.meta.pipeline, { count: sample.count });
  assert.deepEqual(steps.filter(s => s.rejected), [], label);
  const changed = steps.filter(s => s.changed);
  assert.ok(changed.length > 0, label);
  const total = sample.count * Object.keys(source.meta.inputs).length;
  for (const step of changed) {
    assert.equal(step.check, `${total}/${total}`, `${label} ${step.pass} ${step.rev}`);
  }
  t.diagnostic(`${label} pass verdicts: ${changed.map(s => `${s.rev} ${s.pass} ${s.check}`).join(', ')}`);
}

test('LZ exact tokens, byte-for-byte round trips, and checked instruction measurements', async t => {
  const program = Program.fromProject(source);
  assert.equal(program.status, 'ok', program.error?.message);
  const base = storeOf(program.origin.value);
  const r0Image = lowerToImage(program.origin).image;
  const { image, entries } = globalThis.typedRv32.compile(source.source, [], undefined);
  const reference = imageFromCode(id, image, entries);
  await checkedSpeed(program, t, 'general speed');
  const head = storeOf(program.head.value);
  const speedImage = lowerToImage(program.head, backendOptions).image;
  const engines = {
    'r0 evaluator': c => interpret(base, c),
    'r0 RV32': c => emulate(r0Image, c),
    'speed RV32': c => emulate(speedImage, c),
    'reference RV32': c => emulate(reference, c),
  };

  const encodingFixtures = [
    ['empty', [], 3, []],
    ['literal boundaries', [0, 127], 3, [0, 127]],
    ['overlap and nearest tie', longMatch, 3, encodedRun],
    ['collision at limit 1', collision, 1, collision],
    ['collision at limit 2', collision, 2, [65, 65, 66, 66, 131]],
  ];
  const decode = benchCase(base, 'decompress', {
    ...source.meta.inputs.decompress,
    packed: { cells: [65, 224, 66, 192, 127, ...Array(19).fill(127)] },
  });
  const decodedFixture = [...Array(7).fill(65), ...Array(6).fill(66), 127];
  for (const [engine, run] of Object.entries(engines)) {
    for (const [name, input, limit, expected] of encodingFixtures) {
      const c = codecCase(base, 'compress', input, limit);
      assertPrefix(run(c), c.args[1], expected, `${engine} ${name}`);
    }
    assertPrefix(run(decode), decode.args[2], decodedFixture, `${engine} standalone decoder`);
  }

  const generated = fn => casesFrom(base, fn, { ...sample, inputs: source.meta.inputs[fn] });
  const roundTrips = generated('roundTrip');
  let maxBase = 0;
  let maxHead = 0;
  for (const fn of program.fns()) {
    for (const c of fn === 'roundTrip' ? roundTrips : generated(fn)) {
      const label = `${fn} seed-${sample.seed} case ${c.n}`;
      const expected = interpret(base, c);
      const actual = interpret(head, c);
      assertCompletion(expected, `r0 ${label}`);
      assertCompletion(actual, `speed ${label}`);
      assert.ok(agrees(expected, actual), label);
      maxBase = Math.max(maxBase, expected.steps);
      maxHead = Math.max(maxHead, actual.steps);
    }
  }
  t.diagnostic(`Maximum generated evaluator steps: r0 ${maxBase}, speed ${maxHead}`);
  const budgetFixtures = [
    ['24 A cells', longMatch],
    ['24 collision-heavy cells', longCollision],
  ];
  for (const [name, input] of budgetFixtures) {
    const c = codecCase(base, 'roundTrip', input, 3);
    const expected = readBuffer(c.memory, c.args[0]);
    const r0 = interpret(base, c);
    const speed = interpret(head, c);
    assertPrefix(r0, c.args[2], expected, `r0 ${name}`);
    assertPrefix(speed, c.args[2], expected, `speed ${name}`);
    t.diagnostic(`Evaluator steps for ${name}: r0 ${r0.steps}, speed ${speed.steps}`);
  }

  const specialized = Program.fromProject(source);
  const bindings = createArtifact(BindingsIR, 'lz-limit', {
    formatVersion: 1,
    source: 'fixed chain limit',
    bindings: ['compress', 'roundTrip'].map(fn => ({
      fn,
      param: 'chainLimit',
      value: 3,
      entity: 'lz/chainLimit',
    })),
  });
  const bindingResult = await specialized.specialize(bindings);
  assert.equal(bindingResult.changed, true);
  assert.equal(bindingResult.check, '160/160');
  t.diagnostic(`Scalar binding verdict: ${bindingResult.check}`);
  await checkedSpeed(specialized, t, 'specialized speed');
  const specializedImage = lowerToImage(specialized.head, backendOptions).image;

  const totals = { r0: 0, speed: 0, reference: 0 };
  let fixedCases = 0;
  let generalFixed = 0;
  let specializedFixed = 0;
  for (const c of roundTrips) {
    const input = readBuffer(c.memory, c.args[0]);
    const outputAt = c.args[2];
    assertPrefix(engines['r0 evaluator'](c), outputAt, input, `r0 evaluator case ${c.n}`);

    for (const [label, img] of [['r0', r0Image], ['speed', speedImage], ['reference', reference]]) {
      const run = emulate(img, c);
      assertPrefix(run, outputAt, input, `${label} RV32 case ${c.n}`);
      totals[label] += run.steps;
      if (label === 'speed' && c.args[3] === 3) generalFixed += run.steps;
    }
    if (c.args[3] === 3) {
      const run = emulate(specializedImage, c);
      assertPrefix(run, outputAt, input, `specialized speed RV32 case ${c.n}`);
      fixedCases++;
      specializedFixed += run.steps;
    }
  }
  assert.ok(fixedCases > 0 && fixedCases < roundTrips.length);
  t.diagnostic(`RV32 instructions over ${roundTrips.length} seed-${sample.seed} cases: ${JSON.stringify(totals)}`);
  t.diagnostic(`RV32 instructions over the same ${fixedCases} cases at limit 3: general ${generalFixed}, specialized ${specializedFixed}`);
});

test('LZ workbench opens the tape project and runs explore on a fresh program', async () => {
  const wb = createWb({ projects: [{ id, files }] });
  const project = wb.projects.open(id);
  assert.equal(project.program.status, 'ok');
  assert.equal(project.program.rev, 'r0');
  const result = await project.run('explore');
  assert.deepEqual(result.packed, encodedRun);
  assert.deepEqual(result.decoded, longMatch);
  assert.ok(result.instructions > 0);
  assert.equal(project.program.rev, 'r0');
});
