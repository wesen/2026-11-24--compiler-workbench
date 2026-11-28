import test from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from '../../dist/labs/runtime.js';
import { task } from '../../dist/framework/core/types.js';

function compiler() {
  const c = new Compiler();
  c.registerKind({ id: 'number', version: '1', description: 'Finite scalar', validate(v) { assert.equal(typeof v, 'number'); assert.ok(Number.isFinite(v)); } });
  c.registerKind({ id: 'record', version: '1', description: 'Object record', validate(v) { assert.ok(v !== null && typeof v === 'object' && !Array.isArray(v)); } });
  return c;
}

test('cache validation stops before replaying a child parameterized by a changed artifact', async () => {
  const c = compiler(); c.setInput('n', 1);
  c.register({ id: 'source', version: '1', kind: 'number', description: 'Source', run: ctx => ctx.read('n') });
  c.register({ id: 'literal', version: '1', kind: 'number', description: 'Literal', run: (_ctx, p) => p.value });
  c.register({ id: 'parent', version: '1', kind: 'number', description: 'Dynamic task definition', async run(ctx) {
    const config = await ctx.require(task('config', 'source', {}));
    return (await ctx.require(task('child', 'literal', { value: config.value }))).value;
  } });
  const root = task('parent', 'parent', {});
  const a = await c.run('one', run => run.require(root)); assert.equal(a.value.value, 1);
  c.setInput('n', 2);
  const b = await c.run('two', run => run.require(root)); assert.equal(b.value.value, 2);
  const child = b.run.query.invocations('child');
  assert.equal(child.length, 1); assert.deepEqual(child[0].params, { value: 2 });
});

test('run failure drains concurrent work, preserves the original error, and closes the registry', async () => {
  const c = compiler(); let slowCompleted = false;
  c.register({ id: 'bad', version: '1', kind: 'number', description: 'Fails', run() { throw new Error('deliberate failure'); } });
  c.register({ id: 'slow', version: '1', kind: 'number', description: 'In-flight work', async run() {
    await new Promise(resolve => setTimeout(resolve, 15)); slowCompleted = true; return 1;
  } });
  await assert.rejects(c.run('parallel failure', run => Promise.all([
    run.require(task('bad', 'bad', {})), run.require(task('slow', 'slow', {})),
  ])), /deliberate failure/);
  assert.equal(slowCompleted, true);
  assert.equal(c.snapshot().runs[0].status, 'failed');
  assert.doesNotThrow(() => c.register({ id: 'after', version: '1', kind: 'number', description: 'After failure', run: () => 2 }));
});

test('a fallback after a failed dependency cannot remain cached after the dependency is repaired', async () => {
  const c = compiler(); c.setInput('n', -1);
  c.register({ id: 'child', version: '1', kind: 'number', description: 'Requires positive input', run(ctx) {
    const n = ctx.read('n'); if (n < 0) throw new Error('negative input'); return n;
  } });
  c.register({ id: 'fallback', version: '1', kind: 'number', description: 'Fallback', async run(ctx) {
    try { return (await ctx.require(task('child', 'child', {}))).value; }
    catch { return 0; }
  } });
  const root = task('fallback', 'fallback', {});
  const a = await c.run('broken', run => run.require(root)); assert.equal(a.value.value, 0);
  c.setInput('n', 7);
  const b = await c.run('repaired', run => run.require(root)); assert.equal(b.value.value, 7);
});

test('a fallback after an absent input cannot hide a subsequently supplied value', async () => {
  const c = compiler();
  c.register({ id: 'optional', version: '1', kind: 'number', description: 'Absent input fallback', run(ctx) {
    try { return ctx.read('optional'); } catch { return 0; }
  } });
  const root = task('optional', 'optional', {});
  const a = await c.run('absent', run => run.require(root)); assert.equal(a.value.value, 0);
  c.setInput('optional', 7);
  const b = await c.run('present', run => run.require(root)); assert.equal(b.value.value, 7);
});

test('a dependency failure during cache validation lets the current parent execute its fallback', async () => {
  const c = compiler(); c.setInput('n', 1);
  c.register({ id: 'child', version: '1', kind: 'number', description: 'May fail after an edit', run(ctx) {
    const value = ctx.read('n'); if (value < 0) throw new Error('edited input is invalid'); return value;
  } });
  c.register({ id: 'parent', version: '1', kind: 'number', description: 'Explicit fallback', async run(ctx) {
    try { return (await ctx.require(task('child', 'child', {}))).value; } catch { return 0; }
  } });
  const root = task('parent', 'parent', {});
  await c.run('valid first', run => run.require(root));
  c.setInput('n', -1);
  const { value, run } = await c.run('now invalid', run => run.require(root));
  assert.equal(value.value, 0);
  assert.equal(run.query.invocations('child').length, 1, 'one failed task is not run twice during validation and actual execution');
  assert.equal(run.query.invocations('parent')[0].cache.status, 'disabled');
});

test('a rejected run callback is recorded as a failed run even after successful tasks', async () => {
  const c = compiler();
  c.register({ id: 'ok', version: '1', kind: 'number', description: 'Succeeds', run: () => 1 });
  await assert.rejects(c.run('callback failure', async run => {
    await run.require(task('ok', 'ok', {}));
    throw new Error('review condition failed');
  }), /review condition failed/);
  assert.equal(c.snapshot().runs[0].status, 'failed');
});

test('an unawaited failed requirement is reported without an orphaned promise rejection', async () => {
  const c = compiler();
  c.register({ id: 'bad', version: '1', kind: 'number', description: 'Child fails', async run() {
    await new Promise(resolve => setTimeout(resolve, 3)); throw new Error('child failure');
  } });
  c.register({ id: 'forgetful', version: '1', kind: 'number', description: 'Incorrectly ignores its dependency', run(ctx) {
    void ctx.require(task('bad', 'bad', {})); return 1;
  } });
  await assert.rejects(c.run('unawaited', run => run.require(task('forgetful', 'forgetful', {}))), /await every|before its required|child failure/);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(c.snapshot().runs[0].status, 'failed');
  assert.doesNotThrow(() => c.register({ id: 'after', version: '1', kind: 'number', description: 'Registry released', run: () => 0 }));
});

test('task dependency manifests snapshot the request at require time', async () => {
  const c = compiler();
  c.register({ id: 'literal', version: '1', kind: 'number', description: 'Literal', run: (_ctx, p) => p.value });
  c.register({ id: 'parent', version: '1', kind: 'number', description: 'Locally constructed request', async run(ctx) {
    const child = task('child', 'literal', { value: 1 });
    const pending = ctx.require(child);
    child.params.value = 2;
    return (await pending).value;
  } });
  const root = task('parent', 'parent', {});
  const a = await c.run('first', run => run.require(root)); assert.equal(a.value.value, 1);
  const dependency = a.run.query.invocations('parent')[0].dependencies.find(d => d.type === 'task');
  assert.deepEqual(dependency.task.params, { value: 1 });
  const b = await c.run('second', run => run.require(root)); assert.equal(b.value.value, 1);
});

test('query differences distinguish absent fields and inputs from explicit null', async () => {
  const c = compiler(); c.setInput('state', {});
  c.register({ id: 'copy', version: '1', kind: 'record', description: 'Copy', run: ctx => ctx.read('state') });
  const root = task('copy', 'copy', {});
  const a = await c.run('empty', run => run.require(root));
  c.setInput('state', { field: null }); c.setInput('new-null-input', null);
  const b = await c.run('with null', run => run.require(root));
  const diff = c.query.diff(a.value, b.value);
  assert.equal(diff.length, 1); assert.equal(diff[0].path, '/field');
  assert.ok(b.run.compare(a.run).inputs.some(i => i.key === 'new-null-input'));
});

test('an exposed run record cannot replace the immutable input snapshot', async () => {
  const c = compiler(); c.setInput('n', 1);
  c.register({ id: 'read', version: '1', kind: 'number', description: 'Read snapshot', run: ctx => ctx.read('n') });
  const run = c.beginRun('read-only record');
  try { run.record.inputs = { n: 999 }; } catch { /* Rejection is also a valid read-only interface. */ }
  const result = await run.require(task('read', 'read', {})); run.finish();
  assert.equal(result.value, 1);
  assert.equal(c.snapshot().runs[0].inputs.n, 1);
});
