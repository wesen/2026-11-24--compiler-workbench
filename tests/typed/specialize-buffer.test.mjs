// IRWB-036-G: specialization of the bytecode VM on its bytecode (a constant buffer), frame-slot promotion and
// block-local copy propagation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAllFiles, projectFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { benchCase, evaluate } = await import('../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../dist/typed/backend/index.js');
const { BindingsIR } = await import('../../dist/typed/specialize.js');
const { specializeBuffer, specializeInterpreter } = await import('../../dist/typed/specialize-buffer.js');
const { bindingTimes } = await import('../../dist/typed/bta.js');
const { frameSlots } = await import('../../dist/typed/frame-slots.js');
const { copyprop, copyback } = await import('../../dist/typed/copyprop.js');
const { createArtifact } = await import('../../dist/framework/contracts/index.js');

const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const inputs = project.meta.inputs.runVm;
const cells = inputs.code.cells;
const entries = [0, 34];
const fresh = () => Program.fromProject(project);
const bindings = ({ cells: c = cells, withEntry = true } = {}) =>
  createArtifact(BindingsIR, 'bytecode-vm-image', {
    formatVersion: 1,
    source: 'bytecode-vm/project.json',
    bindings: [
      { fn: 'runVm', param: 'code', cells: c, entity: 'inputs.runVm.code' },
      ...(withEntry ? [{ fn: 'runVm', param: 'entry', oneOf: entries, entity: 'inputs.runVm.entry' }] : []),
    ],
  });
const rejected = steps => steps.filter(s => s.rejected).map(s => s.pass);
const specializedEdit = p => p.revisions.flatMap(r => r.edits).find(e => e.kind === 'specialized');
const rv32 = (p, code, entry, n, seed) => {
  const c = benchCase(storeOf(p.head.value), 'runVm', { code, entry, n, seed });
  return runImage(lowerToImage(p.head, { coalesce: true }).image, c.fn, c.args, c.memory, { counts: false });
};

test('binding times: the buffer alone leaves pc dynamic; with the entry candidates the fetch is static', () => {
  const st = storeOf(fresh().head.value),
    f = st.fn('runVm');
  const index = name => f.locals.findIndex(l => l.name === name);
  const names = set => [...set].map(l => f.locals[l].name);
  const alone = bindingTimes(st, f, new Set([index('code')]), new Set());
  assert.ok(!names(alone.static).includes('pc'));
  assert.deepEqual([alone.staticLoads.length, alone.dynamicLoads.length], [0, 2]);
  const both = bindingTimes(st, f, new Set([index('code')]), new Set([index('entry')]));
  for (const l of ['entry', 'pc', 'sp', 'opcode', 'operand']) assert.ok(names(both.static).includes(l), l);
  for (const l of ['left', 'right', 'n', 'seed', 'code']) assert.ok(!names(both.static).includes(l), l);
  assert.deepEqual([both.staticLoads.length, both.dynamicLoads.length], [2, 0]);
});

test('the VM specialized on its bytecode: checked steps, no general loop, every fixture agrees on RV32', async () => {
  const general = fresh(),
    p = fresh();
  const steps = await specializeInterpreter(p, bindings());
  assert.deepEqual(rejected(steps), []);
  for (const s of steps.filter(s => s.changed)) assert.equal(s.check, '40/40', s.pass);
  assert.deepEqual(p.assumptions, { runVm: { code: { cells }, entry: { oneOf: entries } } });
  assert.equal(p.check({ fn: 'runVm' }).status, 'agree');
  const e = specializedEdit(p);
  assert.equal(e.overBudget, 0);
  assert.equal(e.variants, 38);
  // no load from the buffer and no frame access is left
  assert.doesNotMatch(p.listing('runVm'), /load|store|frame|caddr/);
  const g = lowerToImage(general.head, { coalesce: true }).image,
    s = lowerToImage(p.head, { coalesce: true }).image;
  for (const entry of entries)
    for (let n = inputs.n[0]; n <= inputs.n[1]; n++)
      for (let seed = inputs.seed[0]; seed <= inputs.seed[1]; seed++) {
        const c = benchCase(storeOf(general.head.value), 'runVm', { code: inputs.code, entry, n, seed });
        const a = runImage(g, c.fn, c.args, c.memory, { counts: false }),
          b = runImage(s, c.fn, c.args, c.memory, { counts: false });
        assert.equal(b.trap, false);
        assert.equal(b.result, a.result, `entry=${entry} n=${n} seed=${seed}`);
      }
  // the measurement of the report (n = 12, seed = 8): general 7,678 and 6,874; hand-written 75 and 74
  const fib = rv32(p, inputs.code, 0, 12, 8).steps,
    sum = rv32(p, inputs.code, 34, 12, 8).steps;
  assert.ok(fib <= 79 && sum <= 79, `specialized: ${fib} and ${sum} instructions`);
  assert.ok(s.value.bytes <= 96, `${s.value.bytes} code bytes`);
});

test('cells that are not the ones the program is run with are rejected by the meaning contract', async () => {
  const p = fresh();
  const wrong = cells.slice();
  wrong[41] = 34; // PUSH 33 -> PUSH 34 in the checksum
  // applied without `assume`: the contract still generates the project's cells
  await assert.rejects(p.apply(specializeBuffer, { params: { bindings: bindings({ cells: wrong }) } }), e => e.code === 'contractRejected');
  assert.equal(p.rev, 0);
});

test('a function that could write the buffer is refused; a bad parameter restores the assumptions', async () => {
  const source = `
function helper(code: buffer, i: i32): i32 { return code.charCodeAt(i); }
function run(code: buffer, i: i32): i32 { return helper(code, i) + code.charCodeAt(0); }
`;
  const p = Program.fromProject(projectSource('calls-with-buffer', { 'main.typed': source, 'project.json': '{}' }));
  const b = createArtifact(BindingsIR, 'x', {
    formatVersion: 1,
    source: 'test',
    bindings: [{ fn: 'run', param: 'code', cells: [1, 2, 3], entity: 'x' }],
  });
  await assert.rejects(p.specializeBuffer(b), /run calls helper/);
  assert.deepEqual(p.assumptions, {});
  const q = fresh();
  const bad = createArtifact(BindingsIR, 'y', {
    formatVersion: 1,
    source: 'test',
    bindings: [{ fn: 'runVm', param: 'nope', cells: [1], entity: 'y' }],
  });
  await assert.rejects(q.specializeBuffer(bad), /no parameter "nope"/);
  assert.deepEqual(q.assumptions, {});
  assert.throws(() => createArtifact(BindingsIR, 'z', { formatVersion: 1, source: 't', bindings: [{ fn: 'f', param: 'p', cells: [70000], entity: 'z' }] }), /malformed/);
});

test('a budget too small leaves the rest to the general loop and keeps the meaning', async () => {
  for (const budget of [0, 8, 37]) {
    const p = fresh();
    const steps = await specializeInterpreter(p, bindings(), { budget });
    assert.deepEqual(rejected(steps), [], `budget ${budget}`);
    const e = specializedEdit(p);
    assert.equal(e.variants, budget);
    assert.ok(e.overBudget > 0);
    assert.equal(p.check({ fn: 'runVm' }).status, 'agree');
    assert.match(p.listing('runVm'), /caddr/); // the general fetch is still there
  }
});

test('guarded: nothing is assumed, other bytecode runs the general loop, the bound bytecode the residual one', async () => {
  const general = fresh(),
    p = fresh();
  const steps = await specializeInterpreter(p, bindings(), { guard: true });
  assert.deepEqual(rejected(steps), []);
  assert.deepEqual(p.assumptions, {});
  const other = cells.slice();
  other[41] = 34;
  const short = cells.slice(0, 34); // the Fibonacci program alone: another length
  for (const code of [cells, other, short])
    for (const entry of code.length > 34 ? [0, 34] : [0])
      for (const [n, seed] of [[0, 3], [5, -2], [12, 8]]) {
        const c = benchCase(storeOf(general.head.value), 'runVm', { code: { cells: code }, entry, n, seed });
        const a = evaluate(storeOf(general.head.value), c.fn, c.args, c.memory),
          b = evaluate(storeOf(p.head.value), c.fn, c.args, c.memory),
          r = rv32(p, { cells: code }, entry, n, seed);
        assert.equal(a.trap, false);
        assert.equal(b.result, a.result, `evaluator, ${code.length} cells, entry=${entry} n=${n}`);
        assert.equal(r.result, a.result, `RV32, ${code.length} cells, entry=${entry} n=${n}`);
      }
  const bound = rv32(p, inputs.code, 0, 12, 8).steps,
    unbound = rv32(p, { cells: other }, 0, 12, 8).steps;
  assert.ok(bound < 1300 && unbound > 7000, `bound ${bound}, other bytecode ${unbound}`);
});

test('another bytecode image: seed plus the sum of squares becomes one loop', async () => {
  const squares = [2, 0, 7, 26, 2, 1, 2, 0, 2, 0, 6, 0, 4, 0, 3, 1, 2, 0, 1, 1, 5, 0, 3, 0, 8, 0, 2, 1, 0, 0];
  const meta = { ingest: { tape: true }, inputs: { runVm: { code: { cells: squares }, entry: 0, n: [0, 12], seed: [-8, 8] } } };
  const p = Program.fromProject(projectSource('bytecode-vm-squares', { 'main.typed': project.source, 'project.json': JSON.stringify(meta) }));
  const b = createArtifact(BindingsIR, 'squares', {
    formatVersion: 1,
    source: 'test',
    bindings: [
      { fn: 'runVm', param: 'code', cells: squares, entity: 'squares' },
      { fn: 'runVm', param: 'entry', oneOf: [0], entity: 'squares.entry' },
    ],
  });
  assert.deepEqual(rejected(await specializeInterpreter(p, b)), []);
  assert.doesNotMatch(p.listing('runVm'), /load|store|frame|caddr/);
  const r = rv32(p, { cells: squares }, 0, 12, 8);
  assert.equal(r.result, 8 + 650);
  assert.ok(r.steps <= 65, `${r.steps} instructions`);
});

test('bytecode that leaves the buffer or underflows the stack still traps where the general VM traps', async () => {
  for (const image of [[8, 100], [1, 5, 4, 0, 0, 0], [9, 0]]) {
    // JUMP 100: the fetch is out of bounds. PUSH 5; ADD: the stack underflows. Opcode 9: returns 0.
    const meta = { ingest: { tape: true }, inputs: { runVm: { code: { cells: image }, entry: 0, n: [0, 3], seed: [0, 3] } } };
    const src = () => projectSource('bytecode-vm-odd', { 'main.typed': project.source, 'project.json': JSON.stringify(meta) });
    const general = Program.fromProject(src()),
      p = Program.fromProject(src());
    const b = createArtifact(BindingsIR, 'odd', {
      formatVersion: 1,
      source: 'test',
      bindings: [
        { fn: 'runVm', param: 'code', cells: image, entity: 'odd' },
        { fn: 'runVm', param: 'entry', oneOf: [0], entity: 'odd.entry' },
      ],
    });
    assert.deepEqual(rejected(await specializeInterpreter(p, b)), [], JSON.stringify(image));
    const c = benchCase(storeOf(general.head.value), 'runVm', { code: { cells: image }, entry: 0, n: 1, seed: 1 });
    const a = evaluate(storeOf(general.head.value), c.fn, c.args, c.memory),
      z = evaluate(storeOf(p.head.value), c.fn, c.args, c.memory);
    assert.deepEqual([z.trap, z.result], [a.trap, a.result], JSON.stringify(image));
    assert.equal(!!a.trap, image[0] !== 9, JSON.stringify(image));
  }
});

test('frame-slots does nothing while an index is dynamic; copyprop and copyback keep the meaning on corpus programs', async () => {
  const p = fresh();
  assert.equal((await p.apply(frameSlots)).changed, false);
  for (const id of ['sort', 'histogram', 'records', 'gcd']) {
    const q = Program.fromProject(projectSource(id, projectFiles(id)));
    await q.pipeline('O1');
    for (const pass of [copyprop, copyback]) {
      const r = await q.apply(pass); // throws contractRejected if the meaning changed
      if (r.changed) assert.match(r.check, /^(\d+)\/\1$/, id);
    }
  }
});
