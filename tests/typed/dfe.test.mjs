// dfe and field specialization: removing what no entry calls, under a contract that compares only the entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { BindingsIR } = await import('../../dist/typed/specialize.js');
const { createArtifact } = await import('../../dist/framework/contracts/index.js');

const SRC = `record Q { a: i32; mode: i32; }
function one(x: i32): i32 { return x + 1; }
function two(x: i32): i32 { return x * 2; }
function unused(x: i32): i32 { return x - 7; }
function pick(q: Q, x: i32): i32 {
    const m: i32 = q.mode;
    let r = 0;
    if (m < 1) { r = one(x); } else { r = two(x); }
    return r;
}
function entry(q: Q, x: i32): i32 { return pick(q, x) + q.a; }
`;
const inputs = { entry: { q: { record: { a: [0, 9], mode: { oneOf: [0, 1] } } }, x: [-50, 50] }, pick: { q: { record: { a: [0, 9], mode: { oneOf: [0, 1] } } }, x: [-50, 50] } };
const open = entries => new Program('fixture', SRC, { inputs, entries });
const bind = mode => createArtifact(BindingsIR, 'modes', { formatVersion: 1, source: 'test', bindings: [{ record: 'Q', field: 'mode', value: mode, entity: `mode/${mode}` }] });

test('dfe: removes functions no call reaches from the entries, and refuses to run without entries', async () => {
  const p = open(['entry']);
  const r = await p.apply('dfe', { params: { roots: ['entry'] } });
  assert.equal(r.changed, true);
  assert.deepEqual(p.fns().sort(), ['entry', 'one', 'pick', 'two']);
  await assert.rejects(p.apply('dfe', { params: {} }), /needs params.roots/);
});

test('specialize on a record field, then cfg and dfe: one branch and its callee remain, checked on the entry', async () => {
  const p = open(['entry']);
  await p.specialize(bind(1));
  assert.deepEqual(p.assumptions.entry, { 'q.mode': 1 });
  assert.equal(p.inputs.entry.q.record.mode.oneOf[0], 1);
  for (const x of ['constprop', 'fold', 'cfg', 'dce', 'cfg']) await p.apply(x);
  await p.apply('dfe', { params: { roots: ['entry'] } });
  assert.deepEqual(p.fns().sort(), ['entry', 'pick', 'two']);
  assert.equal(p.check().status, 'agree');
  assert.equal(p.check().fns.length, 1, 'only the entry is compared');
});

test('specialize refuses a field binding the program itself writes', async () => {
  const p = new Program('w', `record Q { mode: i32; }
function f(q: Q): i32 { q.mode = 3; return q.mode; }
`, { inputs: { f: { q: { record: { mode: { oneOf: [3] } } } } } });
  await assert.rejects(p.specialize(bind(3)), /writes Q.mode/);
});
