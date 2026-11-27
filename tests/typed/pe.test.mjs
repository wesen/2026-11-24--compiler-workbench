// IRWB-036-F: specializing the bytecode VM on its bytecode (buffer bindings, binding times, pe, promote, webs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAllFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { agrees, benchCase, evaluate } = await import('../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../dist/typed/backend/index.js');
const { BindingsIR, factRef } = await import('../../dist/typed/specialize.js');
const { pe, bindingTimes, RESIDUAL_PIPELINE } = await import('../../dist/typed/pe.js');
const { ANALYSES, liveView } = await import('../../dist/typed/analyses.js');
const { createArtifact } = await import('../../dist/framework/contracts/index.js');

const files = projectAllFiles('bytecode-vm');
const project = projectSource('bytecode-vm', files);
const inputs = project.meta.inputs.runVm;
const cells = inputs.code.cells;
const bindingsFor = (entry, extra = []) =>
  createArtifact(BindingsIR, `bytecode-vm@${entry}`, {
    formatVersion: 1,
    source: 'bytecode-vm',
    bindings: [
      { fn: 'runVm', param: 'code', cells, entity: 'bytecode-vm:project.json#inputs.runVm.code' },
      ...(entry === null ? [] : [{ fn: 'runVm', param: 'entry', value: entry, entity: `bytecode-vm:entry/${entry}` }]),
      ...extra,
    ],
  });
const names = (f, ls) => [...ls].map(l => f.locals[l].name).sort();

test('binding times: the code image and the entry make pc, sp and the decoded instruction static', async () => {
  const p = Program.fromProject(project);
  const st = storeOf(p.origin.value), f = st.fn('runVm');
  const live = liveView((await p.manager.analyse(ANALYSES.liveness, p.origin)).value, st, 'runVm');
  const bt = bindingTimes(st, f, bindingsFor(0).value.bindings, live.liveIn(f.blocks[0].id));
  const kinds = Object.fromEntries([...bt.static].map(([l, k]) => [f.locals[l].name, k]));
  for (const x of ['pc', 'sp', 'opcode', 'operand', 'entry']) assert.equal(kinds[x], 'n', x);
  for (const x of ['t17', 't18']) assert.equal(kinds[x], 'f', x); // frame + static offset
  for (const x of ['left', 'right', 'n', 'seed', 'code']) assert.equal(kinds[x], undefined, x);
  // without the entry, the program counter is dynamic and so is the dispatch
  const loose = bindingTimes(st, f, bindingsFor(null).value.bindings, live.liveIn(f.blocks[0].id));
  assert.deepEqual(names(f, loose.static.keys()), ['sp', 't10', 't17']);
});

const measured = { 0: { instructions: 74, bytes: 36, variants: 20 }, 34: { instructions: 74, bytes: 36, variants: 18 } };
for (const entry of [0, 34])
  test(`pe: the VM specialized on entry ${entry} is a checked loop over scalars and agrees on every valid call`, async () => {
    const p = Program.fromProject(project), bindings = bindingsFor(entry);
    assert.equal((await p.specialize(bindings)).check, '40/40');
    assert.deepEqual(p.assumptions.runVm, { code: { cells }, entry });
    const r = await p.apply(pe, { params: { bindings } });
    assert.equal(r.check, '40/40');
    const peRev = p.revisions.at(-1);
    const record = peRev.edits.find(e => e.kind === 'pe');
    assert.equal(record.variants, measured[entry].variants);
    // every residual statement cites the facts it was made from
    const facts = bindings.value.bindings.map(b => factRef(bindings, b));
    for (const e of peRev.edits.filter(e => e.kind === 'insert')) assert.deepEqual(e.because, facts);
    const pl = await p.pipeline(RESIDUAL_PIPELINE);
    assert.deepEqual(pl.steps.filter(s => s.rejected), []);
    const st = storeOf(p.head.value), f = st.fn('runVm');
    assert.equal(f.arrayBytes, undefined, 'the frame arrays were promoted');
    assert.equal(f.blocks.length, 3);
    // every valid call, against r0 on the evaluator and on RV32
    const base = storeOf(p.origin.value);
    const image = lowerToImage(p.head, { coalesce: true }).image;
    let calls = 0;
    for (let n = inputs.n[0]; n <= inputs.n[1]; n++)
      for (let seed = inputs.seed[0]; seed <= inputs.seed[1]; seed++) {
        const c = benchCase(base, 'runVm', { code: { cells }, entry, n, seed });
        const want = evaluate(base, 'runVm', c.args, c.memory);
        assert.equal(want.trap, false);
        assert.ok(agrees(want, evaluate(st, 'runVm', c.args, c.memory)), `evaluator n=${n} seed=${seed}`);
        const run = runImage(image, 'runVm', c.args, c.memory, { counts: false });
        assert.equal(run.result, want.result, `RV32 n=${n} seed=${seed}`);
        if (n === 12 && seed === 8) {
          assert.equal(run.steps, measured[entry].instructions);
          assert.equal(image.value.fns.runVm.bytes, measured[entry].bytes);
        }
        calls++;
      }
    assert.equal(calls, 221);
  });

test('pe stops: a budget below what the residual needs is refused, and nothing changes', async () => {
  const p = Program.fromProject(project), bindings = bindingsFor(0);
  await p.specialize(bindings);
  const rev = p.rev;
  await assert.rejects(p.apply(pe, { params: { bindings, budget: 41 } }), /needs more than 41 residual statements/);
  assert.equal(p.rev, rev);
  assert.equal((await p.apply(pe, { params: { bindings, budget: 42 } })).changed, true);
});

test('pe stops: a static counter under a dynamic exit never repeats its store and runs into the budget', async () => {
  const src = `function count(n: i32, k: i32): i32 {
    let i = 0;
    let s = 0;
    while (true) {
        s = s + n;
        i = i + k;
        if (s > 100) { break; }
    }
    return i;
}`;
  const p = Program.fromProject(projectSource('count', { 'main.typed': src, 'project.json': '{"inputs":{"count":{"n":[1,50]}}}' }));
  const b = createArtifact(BindingsIR, 'k', { formatVersion: 1, source: 'demo', bindings: [{ fn: 'count', param: 'k', value: 1, entity: 'k' }] });
  await p.specialize(b);
  await assert.rejects(p.apply(pe, { params: { bindings: b } }), /count needs more than \d+ residual statements/);
});

test('buffer binding: refused when the program may write the buffer, accepted and folded at constant positions', async () => {
  const src = `function poke(b: buffer): i32 { b.setCharCodeAt(0, 1); return 0; }
function read(b: buffer): i32 { return b.charCodeAt(0) + b.charCodeAt(1); }`;
  const mk = s => Program.fromProject(projectSource('poke', { 'main.typed': s, 'project.json': '{"inputs":{"read":{"b":{"cells":[5,6]}}}}' }));
  const b = createArtifact(BindingsIR, 'b', { formatVersion: 1, source: 'demo', bindings: [{ fn: 'read', param: 'b', cells: [5, 6], entity: 'b' }] });
  const p = mk(src);
  await assert.rejects(p.specialize(b), /poke stores outside its frame arrays/);
  assert.deepEqual(p.assumptions, {});
  // the default front end reads at a position local; after O1 the positions are constants, which specialize folds
  const q = mk(src.split('\n')[1]);
  await q.pipeline('O1');
  assert.equal((await q.specialize(b)).changed, true);
  await q.pipeline('O1');
  assert.match(q.listing('read'), /return 11/);
  assert.throws(() => createArtifact(BindingsIR, 'bad', { formatVersion: 1, source: 'demo', bindings: [{ fn: 'read', param: 'b', cells: [70000], entity: 'b' }] }), /malformed binding/);
});

test('promote leaves the general VM alone: its stack index is dynamic', async () => {
  const p = Program.fromProject(project);
  assert.equal((await p.apply('promote')).changed, false);
  assert.equal(storeOf(p.head.value).fn('runVm').arrayBytes, 32);
});
