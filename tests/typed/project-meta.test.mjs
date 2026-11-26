// project.json's `ingest` and `entries` reach the Node loaders (Program.fromProject, ingestProject, runPipeline):
// a project with a frame array ingests from the tape, and its checks generate cases for the entries only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource, ingestProject, runPipeline } = await import('../../dist/typed/project.js');
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');

// A frame array makes the default (Wasm inspection) ingest fail with "unknown tape opcode 252".
const MAIN = `function sumTo(n: i32): i32 {
    const a = new Int32Array(8);
    for (let i = 0; i < 8; i = i + 1) { a[i] = i * n; }
    let s = 0;
    for (let i = 0; i < 8; i = i + 1) { s = s + a[i]; }
    return s;
}
function helper(x: i32): i32 { return 100 / x; }
function entry(n: i32): i32 { return sumTo(n) + helper(n + 101); }
`;
const files = meta => ({ 'main.typed': MAIN, 'project.json': JSON.stringify({ title: 'meta fixture', pipeline: 'O2', inputs: { entry: { n: [-20, 20] } }, ...meta }) });

test('without ingest metadata the frame array fails the default ingest', () => {
  assert.throws(() => ingestProject(projectSource('meta-fixture', files({}))), /tape opcode/);
});

test('ingest from project.json reaches ingestProject and Program.fromProject', () => {
  const ps = projectSource('meta-fixture', files({ ingest: { tape: true } }));
  const r0 = ingestProject(ps);
  assert.ok(r0.value.fns.sumTo && r0.value.fns.entry);
  const p = Program.fromProject(ps);
  assert.equal(p.status, 'ok');
  assert.equal(p.exec('entry', [3]).result, 3 * 28 + 0, 'sum of 3*i for i<8, plus 100/104 = 0');
});

test('entries from project.json limit the checked functions', () => {
  const all = Program.fromProject(projectSource('meta-fixture', files({ ingest: { tape: true } })));
  const scoped = Program.fromProject(projectSource('meta-fixture', files({ ingest: { tape: true }, entries: ['entry'] })));
  assert.deepEqual(scoped.check().fns.map(r => r.fn), ['entry']);
  assert.ok(all.check().fns.length >= 3);
});

test('runPipeline checks from the given roots', async () => {
  const ps = projectSource('meta-fixture', files({ ingest: { tape: true }, entries: ['entry'] }));
  const r0 = ingestProject(ps);
  const run = await runPipeline(r0, 'O2', { manager: new AnalysisManager(), inputs: ps.meta.inputs, roots: ps.meta.entries });
  assert.deepEqual(run.steps.filter(s => s.rejected).map(s => s.pass), []);
});
