import assert from 'node:assert/strict';
import test from 'node:test';
import { projectFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor();
const { createArtifact } = await import('../../dist/framework/contracts/index.js');
const { meaningKept } = await import('../../dist/typed/evaluate.js');
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { BindingsIR, factRef } = await import('../../dist/typed/specialize.js');

function facts(bindings) {
  return createArtifact(BindingsIR, 'host', { formatVersion: 1, source: 'test', bindings });
}

const buffer = (fn, cells) => ({ fn, param: 'code', cells, entity: 'host/code' });
const tape = { ingest: { tape: true } };

test('buffer facts fix u16 cells independently of the project generator and carry IR origins', async () => {
  const p = new Program('constant-cell', `
    function read(code: buffer, index: i32, x: i32): i32 {
      const alias = code;
      return alias.charCodeAt(index) + x;
    }
  `, { ...tape, inputs: { read: { code: { cells: [0, 3] }, index: 1, x: [-5, 5] } } });
  const art = facts([buffer('read', [0, 65535]), { fn: 'read', param: 'index', value: 1, entity: 'host/index' }]);
  assert.equal((await p.specialize(art)).check, '40/40');
  assert.deepEqual(p.assumptions, { read: { code: { cells: [0, 65535] }, index: 1 } });
  assert.equal(p.check().status, 'agree');
  const loaded = Object.values(p.head.value.values).find(v => v.op === 'const' && v.imm === 65535);
  assert.equal(p.origin.value.values[loaded.origin[0].from].op, 'load16u');
  assert.ok(loaded.origin[0].because.includes(factRef(art, art.value.bindings[0])));
  assert.ok(p.revisions[1].correspondence.entries.some(e => e.to.includes(loaded.id)));

  const unrestricted = await p.manager.checkInvariant(meaningKept({ inputs: p.options.inputs }),
    { origin: p.origin, candidate: p.head });
  assert.equal(unrestricted.ok, false);
  await assert.rejects(p.specialize(facts([buffer('read', [0, 3])])), /conflicting assumptions/);
  await p.pipeline('O1');
  assert.equal(p.check().status, 'agree');
  p.checkout('r0');
  assert.deepEqual(p.assumptions, {});
  assert.deepEqual(p.inputs, p.options.inputs);
});

test('unsupported dispatch states preserve the original revision and its generated inputs', async () => {
  const p = new Program('unknown-index', 'function read(code: buffer, x: i32): i32 { return code.charCodeAt(x); }',
    { ...tape, inputs: { read: { code: { cells: [1] }, x: 0 } } });
  const code = facts([buffer('read', [7])]);
  await assert.rejects(p.specialize(code), /no static buffer and index/);
  await assert.rejects(p.specialize(facts([buffer('read', []), { fn: 'read', param: 'x', value: 0, entity: 'x' }])),
    /checked address out of range/);
  await assert.rejects(p.specialize(code, { maxVariants: 0 }), /maxVariants must be a positive integer/);
  assert.deepEqual(p.assumptions, {});
  assert.equal(p.rev, 0);
  assert.equal(p.exec('read', [[7], 0]).result, 7);
  assert.throws(() => facts([buffer('read', [65536])]), /malformed binding/);

  const caller = new Program('internal-caller', `
    function read(code: buffer): i32 { return code.charCodeAt(0); }
    function use(code: buffer): i32 { return read(code); }
  `, tape);
  await assert.rejects(caller.specialize(code), /internal caller/);
});

test('VM dispatch becomes guest control flow, with both dynamic branch outcomes', async () => {
  const ps = projectSource('bytecode-vm', projectFiles('bytecode-vm'));
  const { code, n, seed } = ps.meta.inputs.runVm;
  for (const entry of [0, 34]) {
    const p = Program.fromProject(ps);
    const art = facts([buffer('runVm', code.cells), { fn: 'runVm', param: 'entry', value: entry, entity: 'entry' }]);
    await assert.rejects(p.specialize(art, { maxVariants: 1 }), /block budget/);
    assert.deepEqual(p.assumptions, {});
    assert.equal(p.rev, 0);
    assert.equal((await p.specialize(art)).check, '40/40');
    const residual = Object.values(p.head.value.values);
    assert.ok(residual.every(v => v.op !== 'load16u' && v.op !== 'caddr'));
    assert.ok(Object.values(p.head.value.stmts).some(s => s.op === 'br_if'));

    const cleaned = await p.pipeline(['dce', 'cfg']);
    assert.deepEqual(cleaned.steps.filter(s => s.rejected), []);
    assert.equal((await p.apply('promote-frame')).check, '40/40');
    assert.ok(!p.head.value.fns.runVm.arrayBytes);
    assert.equal(p.check().status, 'agree');
    const r0 = Program.fromProject(ps);
    for (const count of n) for (const initial of seed) {
      const args = [code.cells, entry, count, initial];
      assert.equal(p.exec('runVm', args).result, r0.exec('runVm', args).result);
    }
  }
});
