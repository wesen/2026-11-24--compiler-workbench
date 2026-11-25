// P2.1: typed.blocks — the reused front end, lifting, the native model and its v6 adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor();
const { ingest, LiftError } = await import('../../dist/typed/lift.js');
const { listing, lineage, linesOf } = await import('../../dist/typed/listing.js');
const { Store } = await import('../../dist/typed/model.js');
const { BlocksIR, blocksAdapter, rebuildBlocks, validateBlocks } = await import('../../dist/typed/ir.js');
const { project, createIRArtifact, openIR, diff } = await import('../../dist/framework/ir/index.js');
const { canonical } = await import('../../dist/framework/core/data.js');

const source = id => readFileSync(`corpus/projects/${id}/main.typed`, 'utf8');
const projects = readdirSync('corpus/projects').filter(id => existsSync(`corpus/projects/${id}/main.typed`));

test('P2.1: Blend lifts to the book\'s r0 shape (7 blocks, 13 statements)', () => {
  const st = ingest('blend', source('blend'));
  const f = st.fn('blend');
  assert.equal(f.blocks.length, 7);
  assert.equal(f.blocks.reduce((n, b) => n + b.stmts.length, 0), 13);
  assert.deepEqual(f.params, ['buffer', 'i32', 'i32', 'i32']);
  const text = listing(st, 'blend');
  assert.match(text, /scale = \(4 \* 16\)/);
  assert.match(text, /if \(t7 >=u load32\[work\+0\]\) goto \.4 else \.5/);
});

test('P2.1: provenance reaches front-end ops and source lines', () => {
  const st = ingest('blend', source('blend'));
  const first = st.fn('blend').blocks[0].stmts[0]; // scale = 4 * 16
  const ops = lineage(id => st.get(id), first);
  assert.ok(ops.length >= 3 && ops.every(o => o.startsWith('op:blend#')));
  assert.deepEqual(linesOf(id => st.get(id), first), [2]); // const scale = 4 * 16;
});

test('P2.1: the native value round-trips through Store and through the v6 projection', () => {
  for (const id of projects) {
    let st;
    try {
      st = ingest(id, source(id));
    } catch (e) {
      if (e instanceof LiftError) continue; // projects that are meant not to compile
      throw e;
    }
    const nat = st.toNative();
    validateBlocks(nat);
    assert.equal(canonical(Store.from(nat).toNative()), canonical(nat), `${id}: Store round trip`);
    assert.equal(canonical(rebuildBlocks(nat, project(blocksAdapter, nat))), canonical(nat), `${id}: projection round trip`);
  }
});

test('P2.1: a v6 IREdit on the projection rebuilds into valid native tables', () => {
  const r0 = createIRArtifact(blocksAdapter, 'blend', ingest('blend', source('blend')).toNative());
  const view = openIR(r0, blocksAdapter);
  const edit = view.beginEdit();
  // drop the dead `goto .7` block's statement chain is structural; here: retarget `s = 0` to read the constant 1
  const setS = Object.values(r0.value.stmts).find(s => s.op === 'set' && s.local === 5);
  edit.update(setS.value, { imm: 1 }, { because: ['test'] });
  const prepared = edit.prepare();
  assert.equal(prepared.artifact.value.values[setS.value].imm, 1);
  assert.equal(diff(view, openIR(prepared.artifact, blocksAdapter)).entities.length, 1);
  edit.rollback('test');
});

test('P2.1: the validator refuses broken tables', () => {
  const nat = ingest('blend', source('blend')).toNative();
  const broken = structuredClone(nat);
  const b = broken.blocks['bb:blend.0'];
  b.succ = ['bb:nowhere'];
  assert.throws(() => validateBlocks(broken), /successor bb:nowhere/);
  const cyclic = structuredClone(nat);
  const v = Object.values(cyclic.values).find(x => x.args.length === 2);
  v.args[0] = v.id;
  assert.throws(() => validateBlocks(cyclic), /cycle/);
  assert.equal(BlocksIR.id, 'typed.blocks');
});

test('P2.1: front-end errors carry positions', () => {
  assert.throws(() => ingest('bad', 'function f(): i32 { return x; }'), e => e instanceof LiftError && e.code === 'frontEndError' && e.at?.line === 1);
});
