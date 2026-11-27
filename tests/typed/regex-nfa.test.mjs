import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAllFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');
const { benchCase, casesFrom, evaluate, readBuffer } = await import('../../dist/typed/evaluate.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { imageFromCode, lowerToImage, runImage } = await import('../../dist/typed/backend/index.js');
const { ingestProject, projectSource, runPipeline } = await import('../../dist/typed/project.js');
const { createWb } = await import('../../dist/workbench/index.js');

const id = 'regex-nfa';
const entry = 'regexMatch';
const maxPattern = '[a-d]*[a-d]*[a-d]*[a-d]*';
const benchmark = '[a-c]*[b-d]*a*d';
const files = projectAllFiles(id);
const project = projectSource(id, files);
const inputs = project.meta.inputs[entry];

function fixture(store, pattern, text) {
  return benchCase(store, entry, { pattern: { string: pattern }, text: { string: text } });
}

function decode(k) {
  return k.args.map(at => String.fromCharCode(...readBuffer(k.memory, at)));
}

function assertRun(run, expected, initialMemory, label) {
  assert.equal(run.limit, false, label);
  assert.equal(run.trap, false, label);
  assert.equal(run.result, expected, label);
  assert.deepEqual(run.bytes.subarray(0, initialMemory.length), initialMemory, label);
}

test('Thompson NFA agrees with RegExp in the evaluator and both RV32 backends', async t => {
  const r0 = ingestProject(project);
  const store = storeOf(r0.value);
  const manager = new AnalysisManager();
  const run = await runPipeline(r0, project.meta.pipeline, {
    manager,
    inputs: project.meta.inputs,
    roots: project.meta.entries,
  });
  assert.deepEqual(project.meta.entries, [entry]);
  assert.deepEqual(run.steps.filter(step => step.rejected), []);
  const changed = run.steps.filter(step => step.changed);
  assert.ok(changed.some(step => step.pass === 'inline'));
  for (const step of changed) {
    const check = step.result.contract.execution.checks.find(
      c => c.phase === 'ensures' && c.evidence?.method === 'sampled',
    );
    assert.equal(check?.evidence.total, 40, step.pass);
    assert.equal(check.evidence.agree, 40, step.pass);
    assert.equal(check.evidence.inconclusive, 0, step.pass);
  }

  const optimized = storeOf(run.artifact.value);
  const baseImage = lowerToImage(r0).image;
  const speedImage = lowerToImage(run.artifact).image;
  const ref = globalThis.typedRv32.compile(project.source, [], undefined);
  const referenceImage = imageFromCode(id, ref.image, ref.entries, ref.signatures);

  const checkAgainstOracle = (k, explicit) => {
    const [pattern, text] = decode(k);
    const label = `/${pattern}/ on ${JSON.stringify(text)}`;
    const expected = Number(new RegExp(`^(?:${pattern})$`).test(text));
    if (explicit !== undefined) assert.equal(expected, explicit, label);
    const initialMemory = k.memory.slice();
    assertRun(evaluate(store, entry, k.args, k.memory, { limit: 20_000 }), expected, initialMemory, `r0 IR: ${label}`);
    assertRun(runImage(speedImage, entry, k.args, k.memory), expected, initialMemory, `speed RV32: ${label}`);
    assertRun(runImage(referenceImage, entry, k.args, k.memory), expected, initialMemory, `reference RV32: ${label}`);
    assert.deepEqual(k.memory, initialMemory, label);
  };

  // The project generator accepts one fixed string at a time. Split 100 cases
  // over the designed pattern list so each topology receives generated texts.
  const patterns = ['', 'a', 'ab', 'a*b', '[a-c]*', '[a-c]*d', benchmark, maxPattern];
  for (const [i, pattern] of patterns.entries()) {
    const generated = casesFrom(store, entry, {
      count: i < 4 ? 13 : 12,
      seed: 7 + i,
      inputs: { ...inputs, pattern: { string: pattern } },
    });
    for (const k of generated) checkAgainstOracle(k);
  }

  for (const [pattern, text, expected] of [
    ['', '', 1],
    ['', 'a', 0],
    ['a*b', 'b', 1],
    ['a*b', 'aaab', 1],
    ['[a-c]', 'a', 1],
    ['[a-c]', 'c', 1],
    ['[a-c]', 'd', 0],
    ['[b-b]', 'b', 1],
    ['ab', 'aba', 0],
    [maxPattern, 'aaaaaaaa', 1],
  ]) {
    checkAgainstOracle(fixture(store, pattern, text), expected);
  }

  const full = fixture(store, maxPattern, 'aaaaaaaa');
  const baseIR = evaluate(store, entry, full.args, full.memory, { limit: 20_000 });
  const speedIR = evaluate(optimized, entry, full.args, full.memory, { limit: 20_000 });
  assertRun(baseIR, 1, full.memory, 'maximal active set at r0');
  assertRun(speedIR, 1, full.memory, 'maximal active set after speed');
  t.diagnostic(`Maximal active-set IR statements: r0 ${baseIR.steps}, speed ${speedIR.steps}`);

  const bench = fixture(store, benchmark, 'abccabbd');
  for (const [name, image] of [
    ['r0', baseImage],
    ['speed', speedImage],
    ['reference', referenceImage],
  ]) {
    const result = runImage(image, entry, bench.args, bench.memory);
    assertRun(result, 1, bench.memory, name);
    t.diagnostic(`Benchmark ${name}: ${result.steps} RV32 instructions`);
  }
});

test('the workbench opens the project and runs the exploration script on a fresh copy', async () => {
  const wb = createWb({ projects: [{ id, files }] });
  const opened = wb.projects.open(id);
  assert.equal(opened.program.status, 'ok');
  assert.match(files['main.typed'].split('\n')[project.meta.focus - 1], /if \(inRange\(/);
  const result = await opened.run('explore');
  assert.deepEqual(result.rejected, []);
  for (const row of [result.r0, result.speed]) {
    assert.equal(row.trap, false);
    assert.equal(row.result, 1);
    assert.ok(row.instructions > 0);
  }
  assert.equal(opened.program.revisions().length, 1);
});
