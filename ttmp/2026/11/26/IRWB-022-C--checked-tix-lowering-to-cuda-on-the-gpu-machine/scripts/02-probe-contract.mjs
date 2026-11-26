// Run npm run build first. Probes the existing framework; no CUDA or network needed.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AnalysisManager,
  createArtifact,
  defineEffect,
  defineIR,
  defineInvariant,
  defineTransformation,
  defineType,
  differentialStats,
  MemoryResources,
  runDifferentialAsync,
} from '../../../../../../dist/framework/contracts/index.js';

const ir = defineIR({ id: 'probe.tix', version: '1', description: 'input', validate: () => {} });
const text = defineType({
  id: 'probe.cuda',
  version: '1',
  description: 'scalar source',
  validate: v => {
    if (typeof v !== 'string') throw Error('not source');
  },
});
const effect = defineEffect({
  id: 'probe.engine-read',
  version: '1',
  description: 'engine profile',
  access: 'read',
  resource: 'engine-profile',
  type: text,
});
let batches = 0;
const ports = { input: ir, output: text };
const runChild = promisify(execFile);
const inv = defineInvariant({
  id: 'probe.async',
  version: '1',
  description: 'batched check',
  inputs: ports,
  effects: [effect],
  async check(ctx, inputs) {
    const profile = ctx.readResource(effect);
    const evidence = await runDifferentialAsync({
      id: 'probe.async',
      version: '1',
      description: 'batched check',
      inputs: ports,
      baseline: 'input',
      subject: 'output',
      count: 2,
      cases: () => [0, 1],
      run: () => {
        throw Error('unexpected local fallback');
      },
      compare: () => true,
      baselineKey: ({ input }) => input.revision,
      subjectKey: output => JSON.stringify([profile, output]),
      decide: async ({ output }, _cases, todo) => {
        batches++;
        const { stdout } = await runChild(process.execPath, ['-p', 'process.argv[1]', output]);
        return todo.map(() =>
          stdout.trim() === 'good' ? { v: 'agree' } : { v: 'disagree', reason: 'bad source' },
        );
      },
    }, inputs);
    return { ok: evidence.agree === evidence.total, reason: `${evidence.disagree}/${evidence.total} disagreed`, evidence };
  },
});
const t = defineTransformation({
  id: 'probe.lower',
  version: '1',
  description: 'lower to text',
  inputs: { input: ir },
  outputs: { output: text },
  cache: 'never',
  effects: [effect],
  ensures: [
    { invariant: inv, bindings: { input: { from: 'inputs', port: 'input' }, output: { from: 'outputs', port: 'output' } } },
  ],
  run: () => ({ outputs: { output: 'good' } }),
});
const m = new AnalysisManager(undefined, new MemoryResources({ 'engine-profile': 'local-node' }));
const input = createArtifact(ir, 'input', { n: 1 });
for (let i = 0; i < 2; i++) console.log((await m.execute(t, { input })).outputs);
try {
  await m.verifyTransformation({ input }, { output: 'wrong' }, t);
} catch (error) {
  console.log(error.message);
}
console.log({ batches, ...differentialStats(), statuses: m.snapshot().executions.map(e => e.status) });
