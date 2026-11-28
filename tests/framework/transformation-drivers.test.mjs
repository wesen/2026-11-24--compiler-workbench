// IRWB-051-C (phase 3 spike): one runner with a synchronous and an asynchronous driver, and `analyseSync`.
//   - the two ported passes (Tix inline, Typed strength) give the same revisions under both drivers and under
//     today's runners (applyNativePassSync, applyPass), on the corpus;
//   - the synchronous driver reads and writes the analysis manager's cache and records;
//   - it stops, leaving nothing behind, when a step answers with a promise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles, projectIds } from '../../tools/corpus.mjs';
import {
  AnalysisManager,
  createArtifact,
  defineAnalysis,
  defineType,
  differentialSpec,
  runDifferential,
} from '../../dist/framework/contracts/index.js';
import { IRStore } from '../../dist/framework/ir/index.js';
import {
  applyNativePassSync,
  applyPass,
  applyTransformation,
  applyTransformationSync,
  isTransformation,
  PassError,
  transformation,
} from '../../dist/framework/passes/index.js';
import { ExpressionIR, expressionAdapter, exampleExpression } from '../../dist/labs/expressions.js';
import { expressionContract } from '../../dist/labs/contracts.js';

await installVendor();
const T = await import('../../dist/tensor/index.js');
const { inlinePass } = await import('../../dist/tensor/passes.js');
const { meaningGate } = await import('../../dist/tensor/contract.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { Program } = await import('../../dist/typed/program.js');
const { strength, optimizationContract } = await import('../../dist/typed/passes.js');
const { meaningKept } = await import('../../dist/typed/evaluate.js');
const A = await import('../../dist/typed/analyses.js');

const canon = x => JSON.stringify(x);
/** What must agree between two runs of one pass on one input. */
const summary = r => ({
  changed: r.changed,
  revision: r.artifact.revision,
  edits: r.edits,
  preserved: r.preserved.map(p => [p.analysis, p.how]),
  correspondence: canon(r.correspondence?.entries ?? null),
  changes: [r.changes?.entities.length ?? 0, r.changes?.relations.length ?? 0],
});

test('Tix inline: the same revisions from both drivers, applyNativePassSync and optimizeTix, on corpus/tensor', async () => {
  assert.ok(isTransformation(inlinePass));
  assert.equal(inlinePass.relation, 'exact');
  const dir = new URL('../../corpus/tensor/', import.meta.url);
  let changed = 0;
  for (const name of readdirSync(dir)) {
    const p = T.compileTix(readFileSync(new URL(`${name}/main.tix`, dir), 'utf8'));
    const today = applyNativePassSync(inlinePass, p.current, meaningGate(p.origin, 'exact'));
    const sync = applyTransformationSync(inlinePass, p.current, { inputs: { origin: p.origin } });
    const async_ = await applyTransformation(inlinePass, p.current, { inputs: { origin: p.origin } });
    assert.deepEqual(summary(sync), summary(today), name);
    assert.deepEqual(summary(async_), summary(today), name);
    assert.equal(T.optimizeTix(p, ['inline']).program.current.revision, sync.artifact.revision, name);
    if (sync.changed) {
      changed++;
      // the gate ran, with the declared relation, and its evidence is in the result
      assert.equal(sync.relation, 'exact');
      assert.deepEqual(
        sync.obligations.map(o => [o.phase, o.id]),
        [['ensures', 'tix.meaning-gate']],
      );
      assert.equal(sync.obligations[0].evidence.status, 'agree');
    }
  }
  assert.equal(changed, 2, 'inline changes attention and mlp today');
});

test('Tix inline: the gate travels with the transformation, so a wrong candidate is rejected by both drivers', async () => {
  const p = T.compileTix(readFileSync(new URL('../../corpus/tensor/attention/main.tix', import.meta.url), 'utf8'));
  // a transformation with inline's obligations whose `prepare` drops the last statement's producer chain
  const wrong = transformation({
    ...inlinePass,
    id: 'tensor.inline-wrong',
    prepare: ({ before }) => ({
      native: {
        functions: before.value.functions.map(f => {
          const last = f.statements.at(-1);
          const neg = { kind: 'op', op: 'neg', args: [last.expr] };
          return { ...f, statements: [...f.statements.slice(0, -1), { ...last, expr: neg }] };
        }),
      },
    }),
  });
  const rejected = e => e instanceof PassError && e.code === 'contractRejected';
  assert.throws(() => applyTransformationSync(wrong, p.current, { inputs: { origin: p.origin } }), rejected);
  await assert.rejects(applyTransformation(wrong, p.current, { inputs: { origin: p.origin } }), rejected);
});

/** Typed's meaning check as a synchronous obligation: the specification of the contract's invariant, decided here. */
const typedMeaning = params => ({
  id: 'typed.meaning-kept',
  check({ candidate, inputs }) {
    const evidence = runDifferential(differentialSpec(meaningKept(params)), { origin: inputs.origin, candidate });
    return { ok: evidence.status === 'agree', reason: evidence.counterexamples[0]?.reason, evidence };
  },
});
/** The records a manager holds for the analyses `strength` needs and preserves. */
const NAMES = ['typed.ranges', 'typed.cfg', 'typed.dominators', 'typed.loops'];
const records = manager =>
  manager
    .snapshot()
    .analyses.filter(a => NAMES.includes(a.analysis.id))
    .map(a => [a.analysis.id, a.subject.revision, a.assurance, a.valid, a.assurance === 'checked' ? a.id : 'transfer'])
    .sort();

async function threeWays(p, input) {
  const params = { inputs: p.inputs, count: 40, seed: 7, ...(p.options.entries ? { roots: p.options.entries } : {}) };
  const contract = optimizationContract(params);
  const managers = [new AnalysisManager(), new AnalysisManager(), new AnalysisManager()];
  const today = await applyPass(strength, input, {
    manager: managers[0],
    contract,
    contractInputs: { origin: p.origin },
    auditPreservation: true,
  });
  const async_ = await applyTransformation(strength, input, {
    manager: managers[1],
    ensures: [contract],
    inputs: { origin: p.origin },
    auditPreservation: true,
  });
  const sync = applyTransformationSync(strength, input, {
    manager: managers[2],
    ensures: [typedMeaning(params)],
    inputs: { origin: p.origin },
    auditPreservation: true,
  });
  return { today, async_, sync, managers };
}

test('Typed strength: the same revisions, preservation outcomes and analysis records from both drivers and applyPass, at r0 of every corpus project', async () => {
  assert.ok(isTransformation(strength));
  assert.deepEqual(Object.keys(strength.needs), ['ranges']);
  assert.deepEqual(
    strength.obligations.preserves.map(d => d.id),
    ['typed.cfg', 'typed.dominators', 'typed.loops'],
  );
  const changed = [];
  for (const id of projectIds()) {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    if (p.status !== 'ok') continue;
    const { today, async_, sync, managers } = await threeWays(p, p.artifact());
    assert.deepEqual(summary(async_), summary(today), id);
    assert.deepEqual(summary(sync), summary(today), id);
    // the same records: `needs` computed once on the input; each claim transferred to the output
    assert.deepEqual(records(managers[1]), records(managers[0]), id);
    assert.deepEqual(records(managers[2]), records(managers[0]), id);
    if (today.changed) {
      changed.push(id);
      assert.deepEqual(
        sync.preserved.map(x => x.analysis),
        ['typed.cfg', 'typed.dominators', 'typed.loops'],
      );
      assert.equal(canon(sync.report), canon(today.report), id);
    }
  }
  assert.deepEqual(changed, ['chess-search', 'sha-chacha', 'strength']);
});

test('Typed strength inside O2: both drivers reproduce the revision the pipeline made with applyPass', async () => {
  for (const id of ['strength']) {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    await p.pipeline('O2');
    const steps = p.revisions.flatMap((r, i) => (r.pass === 'strength' ? [i] : []));
    assert.ok(steps.length, `${id}: O2 applies strength`);
    for (const i of steps) {
      const { async_, sync } = await threeWays(p, p.revisions[i - 1].artifact);
      assert.equal(async_.artifact.revision, p.revisions[i].artifact.revision, `${id} r${i}`);
      assert.equal(sync.artifact.revision, p.revisions[i].artifact.revision, `${id} r${i}`);
    }
  }
});

test('analyseSync and analyse share one cache and produce the same record', async () => {
  const p = Program.fromProject(projectSource('strength', projectFiles('strength')));
  const art = p.artifact();
  const a = new AnalysisManager(),
    b = new AnalysisManager();
  const viaSync = a.analyseSync(A.rangesAnalysis, art),
    viaAsync = await b.analyse(A.rangesAnalysis, art);
  assert.deepEqual(viaSync, viaAsync); // the same id (a fingerprint), key, value, dependencies, assurance
  // each reuses what the other computed
  assert.equal(await a.analyse(A.rangesAnalysis, art), viaSync);
  assert.equal(b.analyseSync(A.rangesAnalysis, art), viaAsync);
  const types = m => m.snapshot().events.map(e => e.type);
  assert.deepEqual(types(a), ['analysis.computed', 'analysis.reused']);
  assert.deepEqual(types(b), types(a));
  // invalidation is seen by the synchronous path
  a.invalidate(A.rangesAnalysis, art);
  assert.equal(a.hasAnalysis(A.rangesAnalysis, art), false);
  assert.equal(a.analyseSync(A.rangesAnalysis, art).generation, 2);
});

// ---- the drivers' limits, on the expression lab ----
const Count = defineType({
  id: 'test.count',
  version: '1',
  description: 'a count',
  validate(v) {
    if (!Number.isInteger(v)) throw new Error('int');
  },
});
const count = (id, run) =>
  defineAnalysis({ id, version: '1', description: id, input: ExpressionIR, output: Count, run });
const nodes = a => Object.keys(a.value.nodes).length;
const pureCount = count('test.nodes-pure', (_c, a) => nodes(a));
const asyncCount = count('test.nodes-async', async (_c, a) => nodes(a));
const nestedCount = count('test.nodes-nested', async (c, a) => (await c.analysis(pureCount, a)) + 0);
const unawaited = count('test.nodes-unawaited', (c, a) => (void c.analysis(pureCount, a), nodes(a)));
const variables = count(
  'test.variables',
  (_c, a) => Object.values(a.value.nodes).filter(n => n.op === 'variable').length,
);
const cse = extra =>
  transformation({
    id: 'test.cse',
    version: '1',
    description: 'merge squareCopy into square',
    ir: ExpressionIR,
    adapter: expressionAdapter,
    writes: { entities: ['expression.*'], relations: ['operand', 'contains'] },
    relation: 'exact',
    prepare({ before }) {
      const ns = structuredClone(before.value.nodes);
      if (!ns.squareCopy) return;
      delete ns.squareCopy;
      for (const n of Object.values(ns)) if (n.args) n.args = n.args.map(x => (x === 'squareCopy' ? 'square' : x));
      return {
        native: { root: before.value.root, nodes: ns },
        correspondence: [{ from: ['square', 'squareCopy'], to: ['square'], relation: 'cse' }],
      };
    },
    ...extra,
  });
const r0 = () => createArtifact(ExpressionIR, 'e', exampleExpression());
const asynchronous = /answered asynchronously; use the asynchronous driver/;

test('analyseSync refuses an analysis that is not pure and records nothing', async () => {
  const art = r0();
  for (const def of [asyncCount, nestedCount, unawaited]) {
    const manager = new AnalysisManager();
    assert.throws(() => manager.analyseSync(def, art), asynchronous, def.id);
    assert.equal(manager.hasAnalysis(def, art), false);
    assert.deepEqual(
      manager.snapshot().analyses.filter(a => a.analysis.id === def.id),
      [],
    );
  }
  // the asynchronous path still answers the first two (the third is an error under either: unawaited-analysis)
  const manager = new AnalysisManager();
  assert.equal((await manager.analyse(asyncCount, art)).value, nodes(art));
  assert.equal((await manager.analyse(nestedCount, art)).value, nodes(art));
  await assert.rejects(manager.analyse(unawaited, art), /must be awaited/);
});

test('the synchronous driver stops at an asynchronous need, prepare or contract; the asynchronous driver runs all three', async () => {
  const before = r0();
  const cases = [
    ['need', cse({ needs: { n: asyncCount } }), {}],
    ['prepare', cse({ prepare: async () => ({ native: before.value }) }), {}],
    ['contract', cse({}), { ensures: [expressionContract] }],
  ];
  for (const [what, t, extra] of cases) {
    const manager = new AnalysisManager(),
      store = new IRStore();
    store.retain(before);
    const options = { manager, store, ...extra };
    assert.throws(() => applyTransformationSync(t, before, options), asynchronous, what);
    // nothing was published, and no evidence about a candidate is held
    assert.equal(store.head(before.id).revision, before.revision, what);
    assert.ok(
      manager.snapshot().executions.every(x => x.status !== 'accepted'),
      what,
    );
    const r = await applyTransformation(t, before, options);
    assert.equal(store.head(before.id).revision, r.artifact.revision, what);
  }
});

test('requires and eligible refuse before prepare; eligible reads facts; preserves is checked by both drivers', async () => {
  let prepared = 0;
  const base = { needs: { n: pureCount } };
  const counted = extra => {
    const t = cse({ ...base, ...extra });
    return transformation({ ...t, prepare: ctx => (prepared++, t.prepare(ctx)) });
  };
  const illegal = message => e => e instanceof PassError && e.code === 'illegal' && message.test(e.message);
  const before = r0();
  const small = counted({ eligible: ({ facts }) => ({ ok: facts.n > 100, reason: `only ${facts.n} nodes` }) });
  const needsOrigin = counted({
    obligations: { requires: [{ id: 'has-origin', check: ({ inputs }) => ({ ok: !!inputs.origin, reason: 'no origin' }) }] },
  });
  for (const apply of [applyTransformationSync, applyTransformation]) {
    const manager = new AnalysisManager();
    await assert.rejects(async () => apply(small, before, { manager }), illegal(/only \d+ nodes/));
    await assert.rejects(async () => apply(needsOrigin, before, { manager }), illegal(/requires has-origin: no origin/));
    assert.equal(prepared, 0);
    const ok = await apply(needsOrigin, before, { manager, inputs: { origin: before } });
    assert.deepEqual(
      ok.obligations.map(o => [o.phase, o.id]),
      [['requires', 'has-origin']],
    );
    prepared = 0;
    // a true claim is confirmed (no transfer rule: by recomputing), a false one is preserveViolated
    const keeps = cse({ obligations: { preserves: [variables] } }),
      lies = cse({ obligations: { preserves: [pureCount] } });
    const kept = await apply(keeps, before, { manager, auditPreservation: true });
    assert.deepEqual(
      kept.preserved.map(x => [x.analysis, x.how]),
      [['test.variables', 'confirmed-by-recompute']],
    );
    await assert.rejects(
      async () => apply(lies, before, { manager, auditPreservation: true }),
      e => e instanceof PassError && e.code === 'preserveViolated',
    );
    // the rejected candidate's analysis is not held (IRWB-039 lane 0)
    assert.equal(manager.hasAnalysis(pureCount, kept.artifact), false);
  }
  // F33 on the new runner: a contract's deferred evidence is rolled back when a later claim fails
  {
    const manager = new AnalysisManager();
    const lies = cse({ obligations: { ensures: [expressionContract], preserves: [pureCount] } });
    await assert.rejects(applyTransformation(lies, before, { manager, auditPreservation: true }), {
      code: 'preserveViolated',
    });
    assert.deepEqual(
      manager.snapshot().executions.map(x => x.status),
      ['rolled-back'],
    );
  }
});

test('an edit-style prepare gives the same revision as a native one under both drivers', async () => {
  const native = cse({});
  const edit = cse({
    prepare({ edit, view }) {
      if (!view.entities().some(r => r.entity === 'squareCopy')) return;
      edit.redirectReferences('squareCopy', 'square', { because: ['squareCopy'] });
      edit.remove('squareCopy', { because: ['square'] });
      edit.correspond(['square', 'squareCopy'], ['square'], 'cse');
    },
  });
  const before = r0();
  const expected = applyTransformationSync(native, before).artifact.revision;
  const viaSync = applyTransformationSync(edit, before);
  assert.equal(viaSync.artifact.revision, expected);
  assert.equal((await applyTransformation(edit, before)).artifact.revision, expected);
  assert.equal(applyTransformationSync(edit, viaSync.artifact).changed, false);
  // and the pass view: today's runner accepts the transformation
  assert.equal((await applyPass(native, before, { manager: new AnalysisManager() })).artifact.revision, expected);
});
