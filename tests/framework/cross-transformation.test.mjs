// IRWB-061 (IRWB-039 phase 4, item 4.2): a transformation from one IR to another on the one runner.
//   - a same-IR pass is unchanged: its result, its publication and its rejection are what they were;
//   - the cross form: the candidate is wrapped with the output IR's adapter, the producer's entries are completed
//     over both entity lists, and an accepted output opens its lineage in the store, or advances it;
//   - `ensures` (a check, or a contract whose ports `bind` names) rejects a wrong output and publishes nothing;
//   - a pending application runs no `ensures`, records each as owed and refuses a store;
//   - a contract's correspondence is restricted to the entities its port types declare.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalysisManager,
  createArtifact,
  defineIR,
  defineInvariant,
  defineTransformation,
  defineType,
} from '../../dist/framework/contracts/index.js';
import { composeCorrespondence, defineAdapter, IRStore } from '../../dist/framework/ir/index.js';
import {
  applyTransformation,
  applyTransformationSync,
  isCross,
  PassError,
  transformation,
} from '../../dist/framework/passes/index.js';
import {
  ExpressionIR,
  evaluateExpression,
  expressionAdapter,
  exampleExpression,
} from '../../dist/labs/expressions.js';

// ---- the output IR: stack code, one instruction per expression node, in postorder ----
const validate = value => {
  if (!Array.isArray(value?.code) || value.code.some(i => typeof i.id !== 'string' || !i.op))
    throw new Error('Invalid stack code');
};
const StackIR = defineIR({
  id: 'cross-test.stack',
  version: '1',
  description: 'stack code',
  validate,
  // the contract layer's entities: the operations only (pushes are not listed), fewer than the adapter's
  entities: v => v.code.filter(i => i.op === 'add' || i.op === 'mul').map(i => i.id),
});
const entities = v => v.code.map(({ id, op, ...attributes }) => ({ id, kind: 'insn.' + op, attributes }));
const stackAdapter = defineAdapter({
  id: 'cross-test.stack.adapter',
  version: '1',
  description: 'instructions in order',
  kind: StackIR.id,
  schemaVersion: StackIR.version,
  validate,
  relationKinds: {},
  entities,
  relations: () => [],
  resolve: (v, id) => entities(v).find(e => e.id === id),
  describe: (_, id) => ({ label: id }),
});
const run = (code, env) => {
  const stack = [];
  for (const i of code)
    if (i.op === 'const') stack.push(i.value);
    else if (i.op === 'load') stack.push(env[i.name]);
    else {
      const b = stack.pop(),
        a = stack.pop();
      stack.push(i.op === 'add' ? a + b : a * b);
    }
  return stack.pop();
};
/** Tree code for the root: a shared node is emitted once per use, so one node maps to several instructions. */
const lower = (v, wrong = false) => {
  const code = [],
    entries = new Map();
  const emit = id => {
    const n = v.nodes[id];
    if ('args' in n) n.args.forEach(emit);
    const insn =
      n.op === 'constant'
        ? { op: 'const', value: n.value }
        : n.op === 'variable'
          ? { op: 'load', name: n.name }
          : { op: wrong && id === v.root ? 'mul' : n.op };
    const name = `i${code.length}`;
    code.push({ id: name, ...insn });
    entries.set(id, [...(entries.get(id) ?? []), name]);
  };
  emit(v.root);
  return {
    output: { code },
    outputId: 'stack:e',
    correspondence: [...entries].map(([from, to]) => ({ from: [from], to, relation: 'compiled-to' })),
  };
};
const ENV = { x: 3, y: 5 };
const agrees = {
  id: 'cross-test.agrees',
  check: ({ before, candidate }) =>
    run(candidate.value.code, ENV) === evaluateExpression(before.value, ENV)
      ? { ok: true, evidence: { env: ENV } }
      : { ok: false, reason: 'the stack code computes another value', evidence: { env: ENV } },
};
const lowering = (extra = {}) =>
  transformation({
    id: 'cross-test.lower',
    version: '1',
    description: 'expression to stack code',
    from: { ir: ExpressionIR, adapter: expressionAdapter },
    to: { ir: StackIR, adapter: stackAdapter },
    relation: 'exact',
    prepare: ({ before, params }) => lower(before.value, params?.wrong),
    obligations: { ensures: [agrees] },
    ...extra,
  });
const r0 = () => createArtifact(ExpressionIR, 'e', exampleExpression());

// ---- a same-IR pass, as tests/framework/one-runner.test.mjs builds it ----
const cse = transformation({
  id: 'cross-test.cse',
  version: '1',
  description: 'merge squareCopy into square',
  ir: ExpressionIR,
  adapter: expressionAdapter,
  writes: { entities: ['expression.*'], relations: ['operand', 'contains'] },
  relation: 'exact',
  prepare({ before }) {
    const ns = structuredClone(before.value.nodes);
    if (!ns.squareCopy) return { native: before.value };
    delete ns.squareCopy;
    for (const n of Object.values(ns))
      if (n.args) n.args = n.args.map(x => (x === 'squareCopy' ? 'square' : x));
    return {
      native: { root: before.value.root, nodes: ns },
      correspondence: [{ from: ['square', 'squareCopy'], to: ['square'], relation: 'cse' }],
    };
  },
});

test('a same-IR pass is unchanged: the result, the head it advances and the rejection', () => {
  assert.equal(isCross(cse), false);
  assert.equal(cse.category, 'pass');
  const before = r0(),
    store = new IRStore();
  store.retain(before);
  const result = applyTransformationSync(cse, before, { store });
  // exactly the fields a pass result had before the cross form existed
  assert.deepEqual(Object.keys(result).sort(), [
    'artifact',
    'before',
    'changed',
    'changes',
    'contract',
    'correspondence',
    'edits',
    'obligations',
    'pass',
    'preserved',
    'relation',
    'report',
  ]);
  assert.equal(result.changed, true);
  assert.equal(result.artifact.kind, before.kind);
  assert.equal(result.artifact.id, before.id);
  assert.equal(result.edits, result.changes.entities.length);
  assert.equal(store.head('e').revision, result.artifact.revision);
  assert.equal(store.generation('e'), 1);
  // a second application has nothing to merge: unchanged, and the head stays
  const again = applyTransformationSync(cse, result.artifact, { store });
  assert.equal(again.changed, false);
  assert.equal(again.artifact, result.artifact);
  assert.equal(store.generation('e'), 1);
  // an undeclared write is still refused, and a rejected candidate still publishes nothing
  const fresh = new IRStore();
  fresh.retain(before);
  assert.throws(
    () =>
      applyTransformationSync({ ...cse, writes: { entities: [], relations: [] } }, before, { store: fresh }),
    e => e instanceof PassError && e.code === 'undeclaredWrite',
  );
  assert.throws(
    () =>
      applyTransformationSync(cse, before, {
        store: fresh,
        ensures: [{ id: 'no', check: () => ({ ok: false, reason: 'no' }) }],
      }),
    e => e instanceof PassError && e.code === 'contractRejected',
  );
  assert.equal(fresh.head('e').revision, before.revision);
  assert.equal(fresh.generation('e'), 0);
});

test('a cross-IR transformation: the output is another kind, with a completed correspondence, published in its own lineage', () => {
  const t = lowering();
  assert.equal(isCross(t), true);
  assert.equal(t.category, 'cross');
  const before = r0(),
    store = new IRStore();
  store.retain(before);
  const result = applyTransformationSync(t, before, { store });
  assert.equal(result.changed, true);
  assert.equal(result.artifact.kind, 'cross-test.stack');
  assert.equal(result.artifact.id, 'stack:e');
  assert.equal(result.changes, undefined);
  assert.equal(result.pending, undefined);
  assert.equal(run(result.artifact.value.code, ENV), evaluateExpression(before.value, ENV));
  // the correspondence: the producer's entries, completed over the two projections' entity lists
  const c = result.correspondence;
  assert.deepEqual(c.from, { artifact: 'e', revision: before.revision });
  assert.deepEqual(c.to, { artifact: 'stack:e', revision: result.artifact.revision });
  assert.deepEqual(c.targetEntities, result.artifact.value.code.map(i => i.id).sort());
  assert.ok(c.sourceEntities.includes('$expression'));
  const entry = id => c.entries.find(e => e.from.includes(id));
  assert.equal(entry('x').to.length, 4); // x is read four times in tree code
  assert.equal(entry('sum').relation, 'compiled-to');
  assert.equal(entry('$expression').relation, 'removed'); // the arena has no instruction
  assert.deepEqual(result.obligations, [
    { phase: 'ensures', id: 'cross-test.agrees', evidence: { env: ENV } },
  ]);
  // publication: the input's head is untouched and the output opened its own lineage
  assert.equal(store.head('e').revision, before.revision);
  assert.equal(store.generation('e'), 0);
  assert.equal(store.head('stack:e').revision, result.artifact.revision);
  assert.equal(store.generation('stack:e'), 0);
  // it composes with a pass's correspondence: r0 -> cse -> stack code
  const merged = applyTransformationSync(cse, before, { store });
  const second = applyTransformationSync(t, merged.artifact, { store });
  assert.equal(store.head('stack:e').revision, second.artifact.revision);
  assert.equal(store.generation('stack:e'), 1); // advanced from its own head
  const chain = composeCorrespondence(merged.correspondence, second.correspondence);
  assert.deepEqual(chain.from, c.from);
  assert.deepEqual(chain.to, second.correspondence.to);
  // both copies of the square reach the square's instructions
  const squareInsns = second.correspondence.entries.find(e => e.from.includes('square')).to;
  for (const id of ['square', 'squareCopy']) {
    const reached = new Set(chain.entries.filter(e => e.from.includes(id)).flatMap(e => e.to));
    assert.ok(squareInsns.length > 0 && squareInsns.every(i => reached.has(i)));
  }
});

test('ensures rejects a wrong output of a cross-IR transformation and nothing is published', async () => {
  const before = r0(),
    store = new IRStore();
  store.retain(before);
  for (const apply of [applyTransformation, async (...a) => applyTransformationSync(...a)])
    await assert.rejects(
      apply(lowering(), before, { store, params: { wrong: true } }),
      e =>
        e instanceof PassError &&
        e.code === 'contractRejected' &&
        /computes another value/.test(e.message) &&
        e.evidence.env === ENV,
    );
  assert.deepEqual(store.revisions('stack:e'), []);
  assert.throws(() => store.head('stack:e'), /not retained/);
  // an asynchronous check runs under the asynchronous driver, and stops the synchronous one
  const later = lowering({
    obligations: { ensures: [{ id: 'later', check: async c => agrees.check(c) }] },
  });
  assert.equal((await applyTransformation(later, before, { store })).changed, true);
  assert.throws(() => applyTransformationSync(later, before), /asynchronous|promise/i);
});

test('a pending application records its ensures as owed, runs none of them and publishes nothing', () => {
  let ran = 0;
  const t = lowering({
    obligations: { ensures: [{ id: 'counted', check: () => (ran++, { ok: false, reason: 'never run' }) }] },
  });
  const before = r0();
  const result = applyTransformationSync(t, before, {
    params: { wrong: true },
    pending: { reason: 'the code only' },
  });
  assert.equal(ran, 0);
  assert.equal(result.pending, 'the code only');
  assert.deepEqual(result.obligations, [
    { phase: 'ensures', id: 'counted', evidence: { pending: 'the code only' }, status: 'pending' },
  ]);
  assert.equal(result.artifact.kind, 'cross-test.stack');
  assert.ok(result.correspondence.entries.length > 0);
  // F33: a candidate whose checks are owed is not visible in a store
  const store = new IRStore();
  store.retain(before);
  assert.throws(
    () => applyTransformationSync(t, before, { store, pending: { reason: 'x' } }),
    e => e instanceof PassError && e.code === 'badResult' && /publishes nothing/.test(e.message),
  );
  // the same option on a same-IR pass
  const pass = applyTransformationSync(cse, before, {
    ensures: [{ id: 'counted', check: () => (ran++, { ok: false }) }],
    pending: { reason: 'later' },
  });
  assert.equal(ran, 0);
  assert.equal(pass.pending, 'later');
  assert.equal(pass.obligations[0].status, 'pending');
});

test('the cross form is checked: from and to, no writes or preserves, a correspondence from prepare', () => {
  const spec = {
    id: 'cross-test.bad',
    version: '1',
    description: 'x',
    from: { ir: ExpressionIR, adapter: expressionAdapter },
    to: { ir: StackIR, adapter: stackAdapter },
    relation: 'exact',
    prepare: ({ before }) => lower(before.value),
  };
  assert.throws(() => transformation({ ...spec, to: undefined }), /must declare from and to/);
  assert.throws(
    () => transformation({ ...spec, writes: { entities: [], relations: [] } }),
    /does not declare writes/,
  );
  assert.throws(
    () => transformation({ ...spec, obligations: { preserves: [{}] } }),
    /cannot preserve an analysis/,
  );
  assert.throws(() => transformation({ ...spec, relation: undefined }), /must declare its relation/);
  const noEntries = transformation({
    ...spec,
    prepare: ({ before }) => ({ output: lower(before.value).output, outputId: 'stack:e' }),
  });
  assert.throws(
    () => applyTransformationSync(noEntries, r0()),
    e =>
      e instanceof PassError &&
      e.code === 'badResult' &&
      /needs correspondence entries or a derivation/.test(e.message),
  );
  // an entry that names an entity neither side has is refused when the correspondence is completed
  const unknown = transformation({
    ...spec,
    prepare: ({ before }) => ({
      ...lower(before.value),
      correspondence: [{ from: ['nowhere'], to: ['i0'], relation: 'compiled-to' }],
    }),
  });
  assert.throws(() => applyTransformationSync(unknown, r0()), /nowhere/);
  // `outputId` of the application replaces the producer's
  assert.equal(
    applyTransformationSync(transformation(spec), r0(), { outputId: 'elsewhere' }).artifact.id,
    'elsewhere',
  );
});

test('a contract among ensures sees the application through bind, with the correspondence restricted to its port entities', async () => {
  const Flag = defineType({
    id: 'cross-test.flag',
    version: '1',
    description: 'a flag',
    validate(v) {
      if (typeof v !== 'boolean') throw new Error('flag');
    },
  });
  const seen = [];
  const contract = defineTransformation({
    id: 'cross-test.contract',
    version: '1',
    description: 'the stack code computes the expression',
    inputs: { program: ExpressionIR, strict: Flag },
    outputs: { code: StackIR },
    correspondence: [
      { id: 'compiled', from: 'program', to: 'code', relation: 'compiled-to', coverage: 'target' },
    ],
    ensures: [
      {
        invariant: defineInvariant({
          id: 'cross-test.same-value',
          version: '1',
          description: 'same value',
          inputs: { program: ExpressionIR, code: StackIR },
          check(_ctx, { program, code }) {
            seen.push([program.kind, code.kind]);
            return run(code.value.code, ENV) === evaluateExpression(program.value, ENV)
              ? { ok: true }
              : { ok: false, reason: 'another value' };
          },
        }),
        bindings: {
          program: { from: 'inputs', port: 'program' },
          code: { from: 'outputs', port: 'code' },
        },
      },
    ],
  });
  const t = lowering({
    bind: ({ before, candidate, params }) => ({
      inputs: { program: before, strict: params.strict },
      outputs: { code: candidate },
    }),
    obligations: { ensures: [contract] },
  });
  const before = r0(),
    manager = new AnalysisManager(),
    store = new IRStore();
  store.retain(before);
  assert.throws(() => applyTransformationSync(t, before, { params: { strict: true } }), /analysis manager/);
  const result = await applyTransformation(t, before, { manager, store, params: { strict: true } });
  assert.deepEqual(seen, [[ExpressionIR.id, 'cross-test.stack']]);
  const execution = manager.snapshot().executions.at(-1);
  assert.equal(execution.status, 'accepted');
  assert.equal(execution.transformation.id, 'cross-test.contract');
  assert.equal(store.head('stack:e').revision, result.artifact.revision);
  // the record the manager validated: only the operations (StackIR.entities) on the target side
  const record = execution.checks.find(c => c.phase === 'correspondence').evidence;
  const ops = result.artifact.value.code.filter(i => i.op === 'add' || i.op === 'mul').map(i => i.id);
  assert.deepEqual([...record.targetEntities].sort(), [...ops].sort());
  assert.ok(record.entities.every(e => e.to.every(id => ops.includes(id))));
  // x maps to pushes only, which this universe does not list: its entry has no target left
  assert.deepEqual(
    record.entities.filter(e => e.from.includes('x')).flatMap(e => e.to),
    [],
  );
  // the runner's own correspondence keeps every instruction
  assert.equal(result.correspondence.targetEntities.length, result.artifact.value.code.length);
  // a wrong output: rejected with the manager's error as the cause, nothing published, the execution not accepted
  const m2 = new AnalysisManager(),
    s2 = new IRStore();
  s2.retain(before);
  await assert.rejects(
    applyTransformation(t, before, { manager: m2, store: s2, params: { strict: true, wrong: true } }),
    e =>
      e instanceof PassError &&
      e.code === 'contractRejected' &&
      e.cause?.name === 'ContractError' &&
      e.cause.code === 'postcondition',
  );
  assert.deepEqual(s2.revisions('stack:e'), []);
  assert.notEqual(m2.snapshot().executions.at(-1).status, 'accepted');
  // a pending application of the same transformation needs no manager
  assert.equal(
    applyTransformationSync(t, before, { params: { strict: true }, pending: { reason: 'p' } }).obligations[0]
      .id,
    'cross-test.contract',
  );
});
