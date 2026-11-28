// IRWB-052 (IRWB-039 phase 3, the migration): one pass runner for every pass.
//   - the cleanup rule: a rejected synchronous application leaves the manager and the store as the asynchronous one
//     does, and so does one the synchronous driver abandons at an asynchronous step;
//   - the synchronous driver records a contract execution and its facts, as the asynchronous one does;
//   - `optimizeTix` is a strategy plan under the synchronous driver and gives the revisions the pass-by-pass loop
//     it replaced gives, on every corpus program;
//   - `executeSync` runs the interpreter's own steps, and every pass is a transformation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';
import {
  AnalysisManager,
  createArtifact,
  defineAnalysis,
  defineInvariant,
  defineTransformation,
  defineType,
} from '../../dist/framework/contracts/index.js';
import { IRStore } from '../../dist/framework/ir/index.js';
import {
  applyTransformation,
  applyTransformationSync,
  isTransformation,
  PassError,
  transformation,
} from '../../dist/framework/passes/index.js';
import * as S from '../../dist/framework/strategy/index.js';
import { ExpressionIR, expressionAdapter, exampleExpression } from '../../dist/labs/expressions.js';
import { expressionContract } from '../../dist/labs/contracts.js';

await installVendor();
const T = await import('../../dist/tensor/index.js');
const { inlinePass, splitPass } = await import('../../dist/tensor/passes.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { Program } = await import('../../dist/typed/program.js');
const { PASSES, strength, optimizationContract } = await import('../../dist/typed/passes.js');

// ---- a pass on the expression lab: merge `squareCopy` into `square` ----
const Count = defineType({
  id: 'one-runner.count',
  version: '1',
  description: 'a count',
  validate(v) {
    if (!Number.isInteger(v)) throw new Error('int');
  },
});
const nodeCount = defineAnalysis({
  id: 'one-runner.nodes',
  version: '1',
  description: 'the number of nodes',
  input: ExpressionIR,
  output: Count,
  run: (_c, a) => Object.keys(a.value.nodes).length,
});
const cse = extra =>
  transformation({
    id: 'one-runner.cse',
    version: '1',
    description: 'merge squareCopy into square',
    ir: ExpressionIR,
    adapter: expressionAdapter,
    writes: { entities: ['expression.*'], relations: ['operand', 'contains'] },
    relation: 'exact',
    prepare({ before }) {
      const ns = structuredClone(before.value.nodes);
      delete ns.squareCopy;
      for (const n of Object.values(ns))
        if (n.args) n.args = n.args.map(x => (x === 'squareCopy' ? 'square' : x));
      return {
        native: { root: before.value.root, nodes: ns },
        correspondence: [{ from: ['square', 'squareCopy'], to: ['square'], relation: 'cse' }],
      };
    },
    ...extra,
  });
const contractWith = (id, check) =>
  defineTransformation({
    id,
    version: '1',
    description: id,
    inputs: { input: ExpressionIR },
    outputs: { output: ExpressionIR },
    ensures: [
      {
        invariant: defineInvariant({
          id: id + '.condition',
          version: '1',
          description: id,
          inputs: { output: ExpressionIR },
          check,
        }),
        bindings: { output: { from: 'outputs', port: 'output' } },
      },
    ],
  });
const rejecting = contractWith('one-runner.rejecting', () => ({
  ok: false,
  reason: 'rejects every candidate',
}));
const answersLater = contractWith('one-runner.later', async () => ({ ok: true }));
const r0 = () => createArtifact(ExpressionIR, 'e', exampleExpression());

/** Everything a caller can observe of a manager and a store after an application. */
const observe = (manager, store, before) => ({
  manager: JSON.parse(JSON.stringify(manager.snapshot())),
  head: store.head(before.id).revision,
  generation: store.generation(before.id),
  revisions: store.revisions(before.id).map(a => a.revision),
});
async function applied(apply, t, options = {}) {
  const before = r0(),
    manager = new AnalysisManager(),
    store = new IRStore();
  store.retain(before);
  let result, error;
  try {
    result = await apply(t, before, { manager, store, ...options });
  } catch (e) {
    error = e;
  }
  return { before, manager, store, result, error, seen: observe(manager, store, before) };
}

test('the cleanup rule: a rejected synchronous application leaves the manager and the store as the asynchronous one does', async () => {
  const cases = [
    // the contract rejects the candidate
    ['contract', cse({}), { ensures: [rejecting] }, 'contractRejected'],
    // the contract accepts and its evidence is deferred; then a preservation claim fails
    [
      'preservation after an accepted contract',
      cse({ obligations: { ensures: [expressionContract], preserves: [nodeCount] } }),
      { auditPreservation: true },
      'preserveViolated',
    ],
    // a check obligation rejects after the contract accepted
    [
      'a check after an accepted contract',
      cse({
        obligations: {
          ensures: [expressionContract, { id: 'no', check: () => ({ ok: false, reason: 'no' }) }],
        },
      }),
      {},
      'contractRejected',
    ],
    // a change outside the declared kinds
    [
      'writes',
      cse({ writes: { entities: [], relations: [] } }),
      { ensures: [expressionContract] },
      'undeclaredWrite',
    ],
  ];
  for (const [what, t, options, code] of cases) {
    const sync = await applied(applyTransformationSync, t, options),
      async_ = await applied(applyTransformation, t, options);
    for (const run of [sync, async_]) {
      assert.ok(run.error instanceof PassError, `${what}: ${run.error}`);
      assert.equal(run.error.code, code, what);
      // nothing about the candidate: the head did not move, no execution is accepted, no fact is held
      assert.equal(run.seen.head, run.before.revision, what);
      assert.ok(
        run.seen.manager.executions.every(x => x.status !== 'accepted'),
        what,
      );
      assert.ok(
        run.seen.manager.facts.every(f => f.subject.revision === run.before.revision || !f.valid),
        what,
      );
    }
    assert.equal(sync.error.message, async_.error.message, what);
    // the manager's whole snapshot (definitions, analyses, facts, executions, events) and the store are equal
    assert.deepEqual(sync.seen, async_.seen, what);
  }
});

test('the cleanup rule: an application the synchronous driver abandons leaves nothing prepared, and the manager still works', async () => {
  const abandoned = await applied(applyTransformationSync, cse({}), { ensures: [answersLater] });
  assert.match(abandoned.error.message, /answered asynchronously; use the asynchronous driver/);
  assert.equal(abandoned.seen.head, abandoned.before.revision);
  // `return()` ran no `catch`: the execution is closed by the `finally` blocks, not left `prepared` with a live frame
  assert.deepEqual(
    abandoned.seen.manager.executions.map(x => [x.status, x.error?.code]),
    [['rolled-back', 'rolled-back']],
  );
  assert.equal(abandoned.seen.manager.facts.filter(f => f.valid).length, 0);
  // the same manager and store then accept the asynchronous application
  const { manager, store, before } = abandoned;
  const later = await applyTransformation(cse({}), before, { manager, store, ensures: [answersLater] });
  assert.equal(store.head(before.id).revision, later.artifact.revision);
  assert.deepEqual(
    manager.snapshot().executions.map(x => x.status),
    ['rolled-back', 'accepted'],
  );
  // an abandoned preservation check leaves no analysis of the candidate either
  const slow = defineAnalysis({
    id: 'one-runner.slow-on-candidate',
    version: '1',
    description: 'answers later on the candidate only',
    input: ExpressionIR,
    output: Count,
    run: (_c, a) => (a.value.nodes.squareCopy ? 1 : Promise.resolve(1)),
  });
  const claim = await applied(
    applyTransformationSync,
    cse({ obligations: { ensures: [expressionContract], preserves: [slow] } }),
    { auditPreservation: true },
  );
  assert.match(claim.error.message, /answered asynchronously/);
  assert.equal(claim.seen.head, claim.before.revision);
  assert.deepEqual(
    claim.seen.manager.executions.map(x => x.status),
    ['rolled-back'],
  );
  assert.ok(claim.seen.manager.analyses.every(a => a.subject.revision === claim.before.revision || !a.valid));
});

test('the synchronous driver records a contract execution and its facts, exactly as the asynchronous one', async () => {
  const sync = await applied(applyTransformationSync, cse({}), { ensures: [expressionContract] }),
    async_ = await applied(applyTransformation, cse({}), { ensures: [expressionContract] });
  assert.equal(sync.error, undefined);
  assert.equal(sync.result.changed, true);
  const [execution] = sync.manager.snapshot().executions;
  assert.equal(execution.status, 'accepted');
  assert.equal(execution.transformation.id, expressionContract.id);
  assert.deepEqual(
    execution.checks.map(c => [c.phase, c.ok]),
    [
      ['requires', true],
      ['correspondence', true],
      ['preserves', true],
      ['ensures', true],
    ],
  );
  // the facts of the contract were committed with the publication, and are held for the new head
  assert.ok(sync.manager.properties(sync.result.artifact).length > 0);
  assert.equal(sync.seen.head, sync.result.artifact.revision);
  assert.deepEqual(sync.result.obligations, async_.result.obligations);
  assert.deepEqual(sync.seen, async_.seen);
});

test('Typed: the optimization contract runs under the synchronous driver and is recorded as under the asynchronous one', async () => {
  const p = Program.fromProject(projectSource('strength', projectFiles('strength')));
  const contract = optimizationContract({ inputs: p.inputs, count: 40, seed: 7 });
  const run = async apply => {
    const manager = new AnalysisManager();
    const result = await apply(strength, p.artifact(), {
      manager,
      ensures: [contract],
      inputs: { origin: p.origin },
      auditPreservation: true,
    });
    return { result, snapshot: JSON.parse(JSON.stringify(manager.snapshot())) };
  };
  const sync = await run(applyTransformationSync),
    async_ = await run(applyTransformation);
  assert.equal(sync.result.changed, true);
  assert.equal(sync.result.artifact.revision, async_.result.artifact.revision);
  const [execution] = sync.snapshot.executions;
  assert.equal(execution.status, 'accepted');
  const ensures = execution.checks.find(c => c.phase === 'ensures');
  assert.equal(ensures.evidence.method, 'sampled');
  assert.equal(ensures.evidence.status, 'agree');
  assert.deepEqual(sync.snapshot.executions, async_.snapshot.executions);
  assert.deepEqual(sync.snapshot.facts, async_.snapshot.facts);
});

// ---- optimizeTix as a plan ----
/** The loop `optimizeTix` was before IRWB-052: each pass on the runner, a rejected candidate keeps the program. */
function passByPass(program, names) {
  let { current } = program;
  const steps = names.map(pass => {
    try {
      const r = applyTransformationSync(pass === 'inline' ? inlinePass : splitPass, current, {
        inputs: { origin: program.origin },
      });
      current = r.artifact;
      return { pass, accepted: true, changed: r.changed };
    } catch (e) {
      if (!(e instanceof PassError && e.code === 'contractRejected')) throw e;
      return {
        pass,
        accepted: false,
        changed: false,
        reason: e.evidence?.counterexamples[0]?.reason ?? e.message,
      };
    }
  });
  return { revision: current.revision, steps };
}
test('optimizeTix, a plan under the synchronous driver, gives the pass-by-pass revisions and steps on every corpus program', () => {
  const dir = new URL('../../corpus/tensor/', import.meta.url);
  const lists = [
    ['inline'],
    ['inline', 'split-sum'],
    ['split-sum', 'inline'],
    ['split-sum', 'split-sum'],
    [],
  ];
  let programs = 0,
    changed = 0;
  for (const name of readdirSync(dir)) {
    const p = T.compileTix(readFileSync(new URL(`${name}/main.tix`, dir), 'utf8'));
    programs++;
    for (const list of lists) {
      const got = T.optimizeTix(p, list); // not awaited: the plan ran under the synchronous driver
      assert.equal(typeof got.then, 'undefined');
      const want = passByPass(p, list);
      assert.equal(got.program.current.revision, want.revision, `${name} ${list}`);
      assert.deepEqual(got.steps, want.steps, `${name} ${list}`);
      assert.equal(got.program.origin, p.origin);
      changed += got.steps.filter(s => s.changed).length;
    }
  }
  assert.ok(programs >= 6 && changed > 0);
  // a rejected step keeps the program and reports the gate's first counterexample
  const cancel = T.compileTix('fn f(x:f32[1,K]):f32[1]{y[i]=sum(k)((16777216+x[i,k])-16777216);return y;}');
  const kept = T.optimizeTix(cancel, ['split-sum', 'inline']);
  assert.equal(kept.program.current, cancel.current);
  assert.deepEqual(kept.steps, passByPass(cancel, ['split-sum', 'inline']).steps);
  assert.equal(kept.steps[0].accepted, false);
  assert.match(kept.steps[0].reason, /expected .* got /);
  assert.throws(() => T.optimizeTix(cancel, ['no-such-pass']), /Unknown pass/);
});

test('executeSync runs the interpreter that execute runs, in order, and stops at an asynchronous algorithm', async () => {
  const transform = (id, run) => ({ id, version: '1', kind: 'transform', description: id, run });
  const registry = new S.AlgorithmRegistry()
    .register(transform('inc', (_c, n) => n + 1))
    .register(transform('double', (_c, n) => n * 2))
    .register(transform('no', c => c.reject('no', 'refused')))
    .register(transform('length', (_c, xs) => xs.length))
    .register(transform('total', (_c, xs) => xs.reduce((a, b) => a + b, 0)))
    .register(transform('later', async (_c, n) => n))
    .register({
      id: 'cost',
      version: '1',
      kind: 'metrics',
      description: 'cost',
      run: (_c, n) => ({ cost: n }),
    })
    .register({
      id: 'items',
      version: '1',
      kind: 'selector',
      description: 'items',
      run: (_c, n) => [n, n + 1],
    });
  const A = id => S.algorithm(id, '1');
  const plan = S.plan(
    'p',
    S.sequence(
      'main',
      S.apply('a', A('inc')),
      S.attempt('try', S.apply('refuse', A('no')), S.apply('keep', A('double')), { codes: ['no'] }),
      S.chooseBest(
        'best',
        S.fork('f', [
          { name: 'x', strategy: S.apply('x', A('inc')) },
          { name: 'y', strategy: S.apply('y', A('double')) },
        ]),
        { metric: 'cost', direction: 'min' },
        { metrics: A('cost') },
      ),
      S.forEach('each', S.apply('e', A('inc')), { selector: A('items'), maxItems: 4 }),
      S.parallel('par', [S.apply('p1', A('length')), S.apply('p2', A('total'))]),
    ),
  );
  const sync = S.executeSync(plan, registry, 1),
    async_ = await S.execute(plan, registry, 1, { maxConcurrency: 1 });
  assert.equal(sync.status, 'succeeded');
  assert.deepEqual(sync.value, async_.value);
  assert.deepEqual(sync.value, [2, 13]); // 1; inc 2; refused, so doubled 4; best of 5 and 8 is 5; [5, 6] each inc
  const shape = x => x.records.map(r => [r.nodeId, r.status, r.path]);
  assert.deepEqual(shape(sync), shape(async_));
  assert.deepEqual(
    sync.events.map(e => [e.type, e.nodeId]),
    async_.events.map(e => [e.type, e.nodeId]),
  );
  // more workers change only the scheduling: the value is the same
  assert.deepEqual((await S.execute(plan, registry, 1)).value, sync.value);
  assert.throws(
    () => S.executeSync(S.plan('q', S.apply('l', A('later'))), registry, 1),
    /Plan q: a step answered asynchronously; use the asynchronous driver/,
  );
  assert.equal((await S.execute(S.plan('q', S.apply('l', A('later'))), registry, 1)).value, 1);
});

test('every Typed and Tix pass is a transformation that declares its relation; the earlier fields are gone', () => {
  const passes = [...Object.values(PASSES), inlinePass, splitPass];
  assert.ok(passes.length > 20);
  for (const pass of passes) {
    assert.ok(isTransformation(pass), pass.id);
    for (const earlier of ['run', 'legal', 'preserves', 'contract'])
      assert.ok(!(earlier in pass), `${pass.id}.${earlier}`);
  }
  assert.deepEqual(
    [inlinePass.relation, splitPass.relation, ...new Set(Object.values(PASSES).map(p => p.relation))],
    ['exact', 'tolerance', 'exact'],
  );
  // both Tix passes carry the one meaning gate
  for (const pass of [inlinePass, splitPass])
    assert.deepEqual(
      pass.obligations.ensures.map(e => e.id),
      ['tix.meaning-gate'],
    );
});
