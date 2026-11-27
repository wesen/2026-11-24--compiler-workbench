import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAllFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { Program } = await import('../../dist/typed/program.js');
const { ingestProject, projectSource } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { benchCase, casesFrom, evaluate, readBuffer } = await import('../../dist/typed/evaluate.js');
const { imageFromCode, lowerToImage, runImage } = await import('../../dist/typed/backend/index.js');
const { createWb } = await import('../../dist/workbench/index.js');

const id = 'bytecode-vm';
const files = projectAllFiles(id);
const project = projectSource(id, files);
const inputs = project.meta.inputs.runVm;
const cells = Object.freeze(inputs.code.cells);
const entries = [0, 34];
const passLimit = 20_000; // The default used by meaningKept.
const backendOptions = { coalesce: true };

function referenceVm(code, entry, n, seed) {
  const stack = [];
  const locals = [n, seed, 0, 0];
  let pc = entry;
  // A broken fixture must fail the test instead of hanging the oracle.
  for (let dispatches = 1; dispatches <= 184; dispatches++) {
    const opcode = code[pc];
    const operand = code[pc + 1];
    pc += 2;
    switch (opcode) {
      case 0:
        assert.equal(stack.length, 1, 'stack at HALT');
        return { result: stack.pop(), dispatches };
      case 1:
        stack.push(operand);
        break;
      case 2:
        stack.push(locals[operand]);
        break;
      case 3:
        locals[operand] = stack.pop();
        break;
      case 4: {
        const right = stack.pop();
        stack.push((stack.pop() + right) | 0);
        break;
      }
      case 5: {
        const right = stack.pop();
        stack.push((stack.pop() - right) | 0);
        break;
      }
      case 6: {
        const right = stack.pop();
        stack.push(Math.imul(stack.pop(), right));
        break;
      }
      case 7:
        if (stack.pop() === 0) pc = operand;
        break;
      case 8:
        pc = operand;
        break;
      default:
        assert.fail(`unexpected opcode ${opcode} at ${pc - 2}`);
    }
  }
  assert.fail('fixture did not reach HALT in 184 dispatches');
}

test('bytecode fixtures match independent results and dispatch counts', () => {
  assert.equal(cells.length, 64);
  assert.deepEqual(inputs.entry.oneOf, entries);
  for (const [n, fib] of [[0, 0], [1, 1], [12, 144]]) {
    for (const seed of [-8, 0, 8]) {
      // Keep full precision until the final signed i32 reduction.
      let checksum = BigInt(seed);
      for (let remaining = n; remaining > 0; remaining--) {
        checksum = checksum * 33n + BigInt(remaining);
      }
      assert.deepEqual(referenceVm(cells, 0, n, seed), {
        result: (fib * seed) | 0,
        dispatches: 15 * n + 4,
      });
      assert.deepEqual(referenceVm(cells, 34, n, seed), {
        result: Number(BigInt.asIntN(32, checksum)),
        dispatches: 13 * n + 4,
      });
    }
  }
  assert.equal(referenceVm(cells, 0, 12, 8).result, 1_152);
  assert.equal(referenceVm(cells, 34, 12, 8).result, 1_298_667_478);
});

const specializedSource = `
function seededFib(n: i32, seed: i32): i32 {
    let a = 0;
    let b = seed;
    for (let remaining = n; remaining > 0; remaining = remaining - 1) {
        const next = a + b;
        a = b;
        b = next;
    }
    return a;
}

function rollingChecksum(n: i32, seed: i32): i32 {
    let h = seed;
    for (let remaining = n; remaining > 0; remaining = remaining - 1) {
        h = h * 33 + remaining;
    }
    return h;
}
`;
const specializedEntries = { 0: 'seededFib', 34: 'rollingChecksum' };

function checkRun(run, result, bytes, label) {
  assert.equal(run.limit, false, `${label}: step limit`);
  assert.equal(run.trap, false, `${label}: trap`);
  assert.ok(!run.fault, `${label}: fault`);
  assert.equal(run.result, result, `${label}: signed result`);
  assert.deepEqual(run.bytes, bytes, `${label}: guest input memory`);
}

test('generated and exhaustive VM cases agree across evaluators and RV32 compilers', async t => {
  const p = Program.fromProject(project);
  assert.equal(p.status, 'ok');
  assert.deepEqual(p.fns(), ['runVm']);
  const r0 = ingestProject(project);
  const base = storeOf(r0.value);
  const r0Image = lowerToImage(r0, backendOptions).image;
  const pipeline = await p.pipeline(project.meta.pipeline);
  assert.deepEqual(pipeline.steps.filter(step => step.rejected), []);
  assert.notEqual(pipeline.rev, 'r0');
  for (const step of pipeline.steps.filter(step => step.changed)) {
    assert.equal(step.check, '40/40', step.pass);
  }
  const speed = storeOf(p.head.value);
  const speedImage = lowerToImage(p.head, backendOptions).image;

  const reference = globalThis.typedRv32.compile(project.source, [], undefined);
  const referenceImage = imageFromCode(id, reference.image, reference.entries, reference.signatures);

  const scalarInputs = { n: inputs.n, seed: inputs.seed };
  const specialized = Program.fromProject(projectSource('bytecode-vm-specialized', {
    'main.typed': specializedSource,
    'project.json': JSON.stringify({
      pipeline: project.meta.pipeline,
      inputs: { seededFib: scalarInputs, rollingChecksum: scalarInputs },
    }),
  }));
  assert.equal(specialized.status, 'ok');
  const specializedPipeline = await specialized.pipeline(project.meta.pipeline);
  assert.deepEqual(specializedPipeline.steps.filter(step => step.rejected), []);
  const scalarStore = storeOf(specialized.head.value);
  const scalarImage = lowerToImage(specialized.head, backendOptions).image;

  const maxSteps = { 0: { r0: 0, speed: 0 }, 34: { r0: 0, speed: 0 } };
  function checkVm(c) {
    const [codeAddress, entry, n, seed] = c.args;
    const label = `entry=${entry}, n=${n}, seed=${seed}`;
    const inputBytes = c.memory.slice();
    assert.deepEqual(readBuffer(inputBytes, codeAddress), cells, label);
    const oracle = referenceVm(cells, entry, n, seed);
    assert.equal(oracle.dispatches, (entry === 0 ? 15 : 13) * n + 4, label);

    const before = evaluate(base, c.fn, c.args, c.memory, { limit: passLimit });
    const after = evaluate(speed, c.fn, c.args, c.memory, { limit: passLimit });
    checkRun(before, oracle.result, inputBytes, `r0 evaluator, ${label}`);
    checkRun(after, oracle.result, inputBytes, `speed evaluator, ${label}`);
    assert.ok(before.steps < passLimit && after.steps < passLimit, label);
    maxSteps[entry].r0 = Math.max(maxSteps[entry].r0, before.steps);
    maxSteps[entry].speed = Math.max(maxSteps[entry].speed, after.steps);

    const r0Run = runImage(r0Image, c.fn, c.args, c.memory, { counts: false });
    const speedRun = runImage(speedImage, c.fn, c.args, c.memory, { counts: false });
    checkRun(r0Run, oracle.result, inputBytes, `r0 RV32, ${label}`);
    checkRun(speedRun, oracle.result, inputBytes, `speed RV32, ${label}`);
    checkRun(runImage(referenceImage, c.fn, c.args, c.memory, { counts: false }),
      oracle.result, inputBytes, `reference RV32, ${label}`);
    assert.deepEqual(c.memory, inputBytes, `caller memory, ${label}`);
    return { oracle, r0Run, speedRun };
  }

  const generated = casesFrom(base, 'runVm', { count: 100, seed: 7, inputs });
  assert.deepEqual([...new Set(generated.map(c => c.args[1]))].sort((a, b) => a - b), entries);
  for (const c of generated) checkVm(c);

  let cases = 0;
  for (const entry of entries) {
    for (let n = inputs.n[0]; n <= inputs.n[1]; n++) {
      for (let seed = inputs.seed[0]; seed <= inputs.seed[1]; seed++) {
        const call = benchCase(base, 'runVm', { code: inputs.code, entry, n, seed });
        const { oracle, r0Run, speedRun } = checkVm(call);
        const scalar = benchCase(scalarStore, specializedEntries[entry], { n, seed });
        const scalarRun = runImage(scalarImage, scalar.fn, scalar.args, scalar.memory, { counts: false });
        checkRun(scalarRun, r0Run.result, scalar.memory, `hand-specialized entry=${entry}, n=${n}, seed=${seed}`);
        cases++;

        if (n === 12 && seed === 8) {
          assert.ok(speedRun.steps <= r0Run.steps, `speed instruction regression at entry ${entry}`);
          const counts = [r0Run.steps, speedRun.steps, scalarRun.steps];
          const ratios = counts.map(steps => (steps / oracle.dispatches).toFixed(2));
          t.diagnostic(`entry ${entry}, ${oracle.dispatches} guest instructions. RV32 r0/speed/specialized: ${counts.join(' / ')} instructions, ${ratios.join(' / ')} per guest instruction`);
        }
      }
    }
  }
  assert.equal(cases, 442);
  t.diagnostic(`maximum evaluator statements by entry: ${JSON.stringify(maxSteps)}`);
});

test('the workbench opens the project and explores both entries on a fresh copy', async () => {
  const wb = createWb({ projects: [{ id, files }] });
  const opened = wb.projects.open(id);
  assert.equal(opened.program.rev, 'r0');
  const run = await opened.run('explore');
  assert.equal(opened.program.rev, 'r0');
  assert.notEqual(run.revision, 'r0');
  assert.deepEqual(run.rejected, []);
  assert.deepEqual(run.fixtures.map(row => row.entry), entries);
  for (const { entry, r0, speed } of run.fixtures) {
    const expected = referenceVm(cells, entry, run.n, run.seed).result;
    for (const result of [r0, speed]) {
      assert.equal(result.result, expected);
      assert.equal(result.trap, false);
      assert.ok(result.instructions > 0);
    }
  }
});
