// IRWB-036-E: partial evaluation over a constant buffer (first Futamura projection) on the bytecode VM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAllFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { BindingsIR, factRef } = await import('../../dist/typed/bindings.js');
const { createArtifact } = await import('../../dist/framework/contracts/index.js');
const { meaningKept, benchCase, evaluate } = await import('../../dist/typed/evaluate.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { lowerToImage, runImage } = await import('../../dist/typed/backend/index.js');

const id = 'bytecode-vm';
const files = projectAllFiles(id);
const project = projectSource(id, files);
const inputs = project.meta.inputs.runVm;
const cells = Object.freeze([...inputs.code.cells]);
const entries = [...inputs.entry.oneOf];
const passLimit = 20_000;
const backendOptions = { coalesce: true };

const fixture = () =>
  createArtifact(BindingsIR, 'bytecode-vm-fixture', {
    formatVersion: 1,
    source: 'the corpus fixture',
    bindings: [{ fn: 'runVm', param: 'code', cells, entity: 'project/bytecode-vm#runVm.code' }],
  });

function referenceVm(code, entry, n, seed) {
  const stack = [];
  const locals = [n, seed, 0, 0];
  let pc = entry;
  for (let dispatches = 1; dispatches <= 184; dispatches++) {
    const opcode = code[pc];
    const operand = code[pc + 1];
    pc += 2;
    switch (opcode) {
      case 0:
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
        assert.fail(`unexpected opcode ${opcode}`);
    }
  }
  assert.fail('fixture did not reach HALT');
}

test('a buffer promise fixes the input spec, as a scalar binding fixes a parameter', () => {
  const p = Program.fromProject(project);
  const free = projectSource('bytecode-vm-free', {
    'main.typed': files['main.typed'],
    'project.json': JSON.stringify({
      pipeline: project.meta.pipeline,
      ingest: project.meta.ingest,
      inputs: { runVm: { entry: { oneOf: entries }, n: inputs.n, seed: inputs.seed } },
    }),
  });
  const q = Program.fromProject(free);
  assert.equal('code' in q.inputs.runVm, false, 'the fixture buffer starts free');
  q.assume([{ fn: 'runVm', param: 'code', cells }]);
  assert.deepEqual(q.inputs.runVm.code, { cells });
  // the cases the contract would now generate run the interpreter on the promised bytes
  const c = benchCase(storeOf(q.head.value), 'runVm', { code: { cells }, entry: 0, n: 1, seed: 1 });
  const r = evaluate(storeOf(q.head.value), 'runVm', c.args, c.memory, { limit: passLimit });
  assert.equal(r.result, referenceVm(cells, 0, 1, 1).result);
  void p;
});

test('peval specializes the VM on its bytecode under the meaning contract', async () => {
  const p = Program.fromProject(project);
  const facts = fixture();
  const r = await p.apply('peval', { params: { bindings: facts, inputs: p.inputs } });
  assert.equal(r.changed, true);
  assert.equal(r.check, '40/40', 'the gated pass agreed with r0 on the promised domain');
  const listing = p.listing('runVm');
  // the dispatch loop is gone: no opcode fetch, and one residual loop per fixture
  assert.equal(listing.includes('load16'), false);
  assert.equal(listing.includes('caddr'), false);
  for (const entry of entries) {
    assert.ok(
      listing.includes(`specialized for entry = ${entry}`) || (listing.match(/bb:runVm.n\d+/g) ?? []).length >= 10,
      'the residual carries the specialized entry arms',
    );
  }
  // the residual still means r0 on every input of the project's domain (evaluator, exhaustive)
  const base = storeOf(p.artifact(0).value);
  const resid = storeOf(p.head.value);
  let cases = 0;
  for (const entry of entries)
    for (let n = inputs.n[0]; n <= inputs.n[1]; n++)
      for (let seed = inputs.seed[0]; seed <= inputs.seed[1]; seed++) {
        const c = benchCase(base, 'runVm', { code: inputs.code, entry, n, seed });
        const oracle = referenceVm(cells, entry, n, seed);
        const before = evaluate(base, 'runVm', c.args, c.memory, { limit: passLimit });
        const after = evaluate(resid, 'runVm', c.args, c.memory, { limit: passLimit });
        assert.equal(after.result, oracle.result, `entry=${entry} n=${n} seed=${seed}`);
        assert.ok(after.steps < before.steps, 'the residual runs fewer evaluator statements than r0');
        cases++;
      }
  assert.equal(cases, 442);
  // and on the device: the specialized image agrees with the oracle on RV32
  const image = lowerToImage(p.head, backendOptions).image;
  for (const [entry, n, seed] of [[0, 12, 8], [34, 12, 8], [0, 0, 0], [34, 1, -3]]) {
    const c = benchCase(base, 'runVm', { code: inputs.code, entry, n, seed });
    const run = runImage(image, 'runVm', c.args, c.memory);
    assert.equal(run.trap, false);
    assert.equal(run.result, referenceVm(cells, entry, n, seed).result, `RV32 entry=${entry} n=${n}`);
  }
  // why: a residual loop statement's because-chain reaches the outer fact
  const fact = factRef(facts, facts.value.bindings[0]);
  const reaches = (node, seen = new Set()) => {
    if (typeof node === 'string') return node === fact;
    if (!node || seen.has(node)) return false;
    seen.add(node);
    return [node.from, ...(node.because ?? []), node.value].some(x => reaches(x, seen));
  };
  const e = p.revisions.at(-1).edits.find(x => x.kind === 'insert');
  assert.ok(e, 'the specialization made residual statements');
  assert.ok(reaches(p.why(e.stmt)), `no why tree reaches ${fact}`);
});

test('the specialization claims only the promised domain', async () => {
  const p = Program.fromProject(project);
  const facts = fixture();
  await p.apply('peval', { params: { bindings: facts, inputs: p.inputs } });
  // inside the promise (entry 0 or 34): r0 and the residual agree
  const kept = await p.manager.checkInvariant(
    meaningKept({ inputs: { runVm: { code: { cells }, entry: { oneOf: entries }, n: inputs.n, seed: inputs.seed } } }),
    { origin: p.origin, candidate: p.head },
  );
  assert.equal(kept.ok, true);
  // outside it (an entry the promise does not list): the residual traps where r0 still computes
  const broken = await p.manager.checkInvariant(
    meaningKept({ inputs: { runVm: { code: { cells }, entry: { oneOf: [30] }, n: [1, 3], seed: [1, 1] } } }),
    { origin: p.origin, candidate: p.head },
  );
  assert.equal(broken.ok, false, 'entry 30 (LOAD 2, HALT) returns 0 at r0 but traps in the residual');
});

test('a buffer binding names a parameter of the function it promises', async () => {
  const p = Program.fromProject(project);
  const bad = createArtifact(BindingsIR, 'bad', {
    formatVersion: 1,
    source: 'demo',
    bindings: [{ fn: 'runVm', param: 'nope', cells, entity: 'x' }],
  });
  await assert.rejects(p.apply('peval', { params: { bindings: bad, inputs: p.inputs } }), /no parameter "nope"/);
  assert.equal(p.rev, 0, 'a refused specialization changes nothing');
});

test('without a promised entry domain, the pass refuses and changes nothing', async () => {
  const free = projectSource('bytecode-vm-range', {
    'main.typed': files['main.typed'],
    'project.json': JSON.stringify({
      pipeline: project.meta.pipeline,
      ingest: project.meta.ingest,
      inputs: { runVm: { code: { cells }, entry: [0, 60], n: inputs.n, seed: inputs.seed } },
    }),
  });
  const p = Program.fromProject(free);
  // the dispatch stays dynamic (the entry is a range, not a promised set), the trace cannot close its loops
  // within the budgets, and the pass refuses: the program is left unchanged, whatever the reason
  await assert.rejects(
    p.apply('peval', { params: { bindings: fixture(), inputs: p.inputs } }),
    /peval: no function could be specialized/,
  );
  assert.equal(p.rev, 0);
});

test('the promise check refuses a store through the bound buffer', async () => {
  // no corpus program writes a buffer parameter, so the check is exercised on a lifted store directly:
  // a store through caddr(code, 0) added to runVm must be refused
  const { Store } = await import('../../dist/typed/model.js');
  const { checkBufferBinding } = await import('../../dist/typed/bindings.js');
  const p = Program.fromProject(project);
  const st = Store.from(p.artifact(0).value);
  const f = st.fn('runVm');
  // sanity: the fixture's promise holds (every store addresses the frame arrays)
  assert.deepEqual(checkBufferBinding(st, 'runVm', f.locals, 'code'), {
    index: 0,
    because: ['param:runVm/code'],
  });
  const recv = st.add({ id: 'v:bad.1', kind: 'value', fn: f.id, op: 'get', args: [], imm: 0, origin: [] }).id;
  const zero = st.add({ id: 'v:bad.2', kind: 'value', fn: f.id, op: 'const', args: [], imm: 0, origin: [] }).id;
  const caddr = st.add({ id: 'v:bad.0', kind: 'value', fn: f.id, op: 'caddr', args: [recv, zero], origin: [] }).id;
  st.add({
    id: 's:bad.0',
    kind: 'stmt',
    fn: f.id,
    op: 'store',
    width: 32,
    offset: 0,
    addr: caddr,
    value: zero,
    origin: [],
  });
  f.blocks[0].stmts.push('s:bad.0');
  assert.throws(() => checkBufferBinding(st, 'runVm', f.locals, 'code'), /stores through/);
});
