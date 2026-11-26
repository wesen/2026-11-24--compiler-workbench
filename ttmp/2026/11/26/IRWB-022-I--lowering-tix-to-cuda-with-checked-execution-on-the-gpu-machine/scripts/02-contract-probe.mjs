// Run from the worktree root after npm run build.
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';

const C = await import(new URL('dist/framework/contracts/index.js', `file://${process.cwd()}/`));
const ir = id =>
  C.defineIR({
    id,
    version: '1',
    description: 'Probe artifact',
    validate(value) {
      assert.equal(typeof value, 'string');
    },
  });
const input = ir('probe.source'),
  output = ir('probe.cuda-source');
const engine = C.defineEffect({
  id: 'probe.engine',
  version: '1',
  description: 'Read pinned executor profile',
  resource: 'engine',
  access: 'read',
  type: C.JsonValue,
});
const ports = { input, output };
let checks = 0;
const invariant = C.defineInvariant({
  id: 'probe.meaning',
  version: '1',
  description: 'Await external evidence',
  inputs: ports,
  effects: [engine],
  async check(ctx, values) {
    assert.deepEqual(ctx.readResource(engine), { arch: 'sm_121' });
    checks++;
    await setImmediate();
    return { ok: values.input.value === values.output.value, reason: 'Probe meaning differs' };
  },
});
const spec = C.defineTransformation({
  id: 'probe.lower',
  version: '1',
  description: 'Cross-kind checked lowering',
  inputs: { input },
  outputs: { output },
  cache: 'never',
  effects: [engine],
  ensures: [
    {
      invariant,
      bindings: { input: { from: 'inputs', port: 'input' }, output: { from: 'outputs', port: 'output' } },
    },
  ],
  run(_ctx, { input }) {
    return { outputs: { output: C.createArtifact(output, input.id, input.value) } };
  },
});
const manager = new C.AnalysisManager(undefined, new C.MemoryResources({ engine: { arch: 'sm_121' } }));
const source = C.createArtifact(input, 'probe', 'meaning');
const pending = manager.execute(spec, { input: source });
assert.equal(manager.snapshot().executions.filter(e => e.status === 'accepted').length, 0);
const accepted = await pending;
assert.equal(accepted.outputs.output.kind, 'probe.cuda-source');
assert.equal(accepted.execution.status, 'accepted');
await assert.rejects(
  manager.verifyTransformation(
    { input: source },
    { output: C.createArtifact(output, 'probe', 'mutant') },
    spec,
  ),
  /Probe meaning differs/,
);
await manager.execute(spec, { input: source });
assert.equal(checks, 3);
assert.equal(manager.snapshot().executions.filter(e => e.status === 'rejected').length, 1);
console.log('Async cross-kind check accepted, mutant rejected, repeat re-evaluated the invariant');
