import test from 'node:test';
import assert from 'node:assert/strict';
import {Compiler} from '../../dist/labs/runtime.js';

test('execution-layer evidence is a captured immutable snapshot with a single-assignment namespace', async () => {
  const compiler = new Compiler();
  const evidence = {plan: {id: 'one'}, records: [{status: 'succeeded'}]};
  const {run} = await compiler.run('evidence', async run => {
    run.recordExtension('strategy.execution', evidence);
    evidence.records[0].status = 'changed after capture';
    assert.throws(() => run.recordExtension('strategy.execution', {}), /already recorded/);
    return null;
  });
  const snapshot = compiler.snapshot();
  assert.equal(snapshot.runs[0].extensions['strategy.execution'].records[0].status, 'succeeded');
  assert.ok(Object.isFrozen(snapshot.runs[0].extensions['strategy.execution'].records));
  assert.throws(() => run.recordExtension('late', {}), /closed/);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)).runs[0].extensions, snapshot.runs[0].extensions);
});

test('failure evidence survives a thrown callback and run closure', async () => {
  const compiler = new Compiler();
  await assert.rejects(compiler.run('failed strategy', async run => {
    run.recordExtension('strategy.execution', {status: 'rejected', error: {code: 'NO_FEASIBLE_CANDIDATE'}});
    throw new Error('No feasible candidate');
  }), /No feasible/);
  const run = compiler.snapshot().runs[0];
  assert.equal(run.status, 'failed');
  assert.equal(run.extensions['strategy.execution'].status, 'rejected');
});

test('evidence rejects executable data without consuming the namespace', async () => {
  const compiler = new Compiler();
  await compiler.run('invalid evidence', async run => {
    assert.throws(() => run.recordExtension('', {}), /namespace/);
    assert.throws(() => run.recordExtension('strategy.execution', {callback() {}}), /function/);
    run.recordExtension('strategy.execution', {status: 'succeeded'});
    return null;
  });
  assert.equal(compiler.snapshot().runs[0].extensions['strategy.execution'].status, 'succeeded');
});

test('narrow runtime inspection separates current registrations from historical artifact revisions', async () => {
  const compiler = new Compiler();
  compiler.registerKind({id:'n',version:'1',description:'scalar',validate(n){assert.equal(typeof n,'number');}});
  compiler.register({id:'number',version:'1',kind:'n',description:'first',run(){return 1;}});
  const first = await compiler.run('first', run => run.require({id:'same',pass:'number',params:{}}));
  compiler.replacePass({id:'number',version:'2',kind:'n',description:'second',run(){return 2;}});
  const second = await compiler.run('second', run => run.require({id:'same',pass:'number',params:{}}));
  assert.equal(compiler.passDescriptors().length,1);
  assert.equal(compiler.passDescriptors()[0].version,'2');
  assert.equal(compiler.snapshot().passes.length,2);
  assert.equal(first.run.artifact('same').value,1);
  assert.equal(second.run.artifact('same').value,2);
  assert.equal(compiler.artifact({artifact:'same',revision:first.value.revision}).value,1);
  assert.equal(first.run.invocation('same').passVersion,'1');
  assert.ok(Object.isFrozen(first.run.invocation('same')));
  assert.equal(second.run.artifact('missing'),undefined);
});
