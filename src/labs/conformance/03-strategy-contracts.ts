/** Run: npm run build && node dist/labs/conformance/03-strategy-contracts.js */
import assert from 'node:assert/strict';
import type { Artifact } from '../../framework/core/types.js';
import {
  AnalysisManager,
  FiniteNumber,
  Integer,
  MemoryResources,
  createArtifact,
  defineAnalysis,
  defineEffect,
  defineInvariant,
  defineTransformation,
  validateArtifact,
  type Correspondence,
} from '../../framework/contracts/index.js';
import {
  AlgorithmRegistry,
  algorithm,
  apply,
  binding,
  checkpoint,
  deserialize,
  diff,
  executeOrThrow,
  find,
  insertAfter,
  plan,
  ref,
  require as requireAnalysis,
  sequence,
  serialize,
  verify,
  walk,
} from '../../framework/strategy/index.js';
import { openIR } from '../../framework/ir/index.js';
import { saturate } from '../rewrites.js';
import type { EditAcceptance, TransformationResult } from '../../framework/ir/types.js';
import {
  ExpressionIR,
  expressionAdapter,
  exampleExpression,
  type ExpressionProgram,
} from '../expressions.js';
import { expressionContract, expressionEquivalent, expressionValid } from '../contracts.js';
import { expressionCSE, expressionDouble } from '../rules.js';

// This guide composes the reusable layers without a compiler runtime host.
// src/ir-examples/lab.ts adds real compiler invocations and cache policies.
const manager = new AnalysisManager();
const arithmeticCost = defineAnalysis<ExpressionProgram, number>({
  id: 'guide.arithmetic-cost',
  version: '1',
  description: 'Count actual addition and multiplication operations',
  input: ExpressionIR,
  output: FiniteNumber,
  run(_ctx, artifact) {
    return Object.values(artifact.value.nodes).filter(node => node.op === 'add' || node.op === 'mul').length;
  },
});

function expression(value: unknown): Artifact<ExpressionProgram> {
  validateArtifact(ExpressionIR, value);
  return value;
}

function correspondence(result: TransformationResult<ExpressionProgram>): Correspondence {
  const map = result.correspondence;
  return {
    id: 'entities',
    from: map.from,
    to: map.to,
    relation: 'generic-ir-edit',
    entities: map.entries.map(entry => ({
      from: entry.from,
      to: entry.to,
    })),
    evidence: { relations: map.entries.map(entry => entry.relation) },
  };
}

// Return prepared acceptance. The IR edit commits it only after its own
// validation and exact-base revision check have also succeeded.
async function acceptEdit(
  result: TransformationResult<ExpressionProgram>,
  before: Artifact<ExpressionProgram>,
): Promise<EditAcceptance> {
  const transaction = await manager.beginTransformation(expressionContract, { input: before });
  return transaction.verify({ output: result.artifact }, [correspondence(result)]);
}

let rewriteApplications = 0;
const registry = new AlgorithmRegistry()
  .register({
    id: 'guide.cost',
    version: '1',
    kind: 'analysis',
    description: 'Bridge a semantic analysis into a strategy binding',
    async run(_ctx, input) {
      return (await manager.analyse(arithmeticCost, expression(input))).value;
    },
  })
  .register({
    id: 'guide.normalize',
    version: '1',
    kind: 'transform',
    description: 'Run bounded generic rewrites with semantic acceptance',
    async run(ctx, input) {
      const before = expression(input);
      const result = await saturate(openIR(before, expressionAdapter), [expressionCSE, expressionDouble], {
        budget: 32,
        verify: acceptEdit,
      });
      if (result.status !== 'converged' && result.status !== 'no-match') {
        throw new Error(`Normalization stopped with ${result.status}`);
      }
      rewriteApplications += result.applications;
      ctx.record('checked rewrites', {
        status: result.status,
        applications: result.applications,
        before: before.revision,
        after: result.artifact.revision,
        steps: result.steps,
      });
      return result.artifact;
    },
  })
  .register({
    id: 'guide.equivalent',
    version: '1',
    kind: 'invariant',
    description: 'Bridge an input/output semantic invariant into strategy',
    async run(_ctx, input, args) {
      const before = expression((args as { before: unknown }).before);
      const checked = await manager.checkInvariant(expressionEquivalent, {
        before,
        after: expression(input),
      });
      return {
        ok: checked.ok,
        reason: checked.reason,
        evidence: checked.evidence,
      };
    },
  });

const original = plan(
  'guide.checked-normalization',
  sequence(
    'pipeline',
    requireAnalysis('count.before', algorithm('guide.cost'), 'before'),
    apply('normalize', algorithm('guide.normalize')),
    requireAnalysis('count.after', algorithm('guide.cost'), 'after'),
    verify('equivalence', algorithm('guide.equivalent'), {
      args: { before: ref('input') },
    }),
    checkpoint('cost.report', 'Arithmetic cost', {
      before: binding('before'),
      after: binding('after'),
    }),
  ),
);

const edited = insertAfter(
  original,
  'normalize',
  checkpoint('revision.report', 'Accepted revision', ref('current', ['revision'])),
);
assert.equal(find(original, 'revision.report'), undefined);
assert.ok(find(edited, 'revision.report'));
assert.ok(diff(original, edited).some(change => change.type === 'added'));
const loaded = deserialize(serialize(edited), registry);
const input = createArtifact(ExpressionIR, 'guide/input', exampleExpression());
const capturedInput = JSON.stringify(input);
const execution = await executeOrThrow(loaded, registry, input, {
  id: 'guide/strategy-contracts',
  maxSteps: 50,
  maxDepth: 12,
  maxConcurrency: 2,
});
const output = expression(execution.value);
const beforeCost = await manager.analyse(arithmeticCost, input);
const afterCost = await manager.analyse(arithmeticCost, output);
assert.equal(beforeCost.value, 5);
assert.equal(afterCost.value, 4);
assert.equal(JSON.stringify(input), capturedInput);
assert.ok(manager.hasAnalysis(arithmeticCost, output));
assert.equal((await manager.analyse(arithmeticCost, output)).id, afterCost.id);

// A structurally legal edit may still change the program's meaning.
// Change the multiplier introduced by x + x -> 2 * x, then reject it.
const checkedView = openIR(output, expressionAdapter);
const constant = checkedView.find(
  entity => entity.kind === 'expression.constant' && entity.attributes.value === 2,
)[0];
assert.ok(constant);
const invalidEdit = checkedView.beginEdit({ verify: acceptEdit });
invalidEdit.update(constant, { value: 3 });
let rejected = '';
try {
  await invalidEdit.commit();
  assert.fail('Changing the polynomial must be rejected');
} catch (error) {
  rejected = (error as { code?: string }).code ?? 'unexpected-error';
  assert.equal(rejected, 'postcondition');
}
assert.equal(checkedView.resolve(constant).attributes.value, 2);
assert.equal(invalidEdit.state, 'failed');
const snapshot = manager.snapshot();
assert.ok(snapshot.executions.some(record => record.status === 'rejected'));
assert.ok(snapshot.executions.some(record => record.status === 'accepted'));

// Resource dependencies decide body reuse. Staged writes commit only after
// output guarantees pass; this manager is independent from the rewrite demo.
const resources = new MemoryResources({
  'guide:factor': 2,
  'guide:accepted': 0,
});
const effectManager = new AnalysisManager(undefined, resources);
const readFactor = defineEffect({
  id: 'guide.factor.read',
  version: '1',
  description: 'Scaling factor',
  resource: 'guide:factor',
  access: 'read',
  type: Integer,
});
const readCount = defineEffect({
  id: 'guide.count.read',
  version: '1',
  description: 'Accepted export count',
  resource: 'guide:accepted',
  access: 'read',
  type: Integer,
});
const writeCount = defineEffect({
  id: 'guide.count.write',
  version: '1',
  description: 'Update export count',
  resource: 'guide:accepted',
  access: 'write',
  type: Integer,
});
const scale = defineTransformation({
  id: 'guide.scale',
  version: '1',
  description: 'Resource-driven scaling',
  inputs: { input: ExpressionIR },
  outputs: { output: ExpressionIR },
  effects: [readFactor],
  cache: 'tracked',
  ensures: [
    {
      property: expressionValid,
      subject: { from: 'outputs', port: 'output' },
    },
  ],
  run(ctx, { input: source }) {
    const factor = ctx.readResource(readFactor);
    ctx.record('Applied scaling factor', { factor });
    const value: ExpressionProgram = {
      root: '$scaled',
      nodes: {
        ...source.value.nodes,
        $factor: { op: 'constant', value: factor },
        $scaled: { op: 'mul', args: [source.value.root, '$factor'] },
      },
    };
    return {
      outputs: { output: createArtifact(ExpressionIR, 'guide/scaled', value) },
    };
  },
});
const scaled = await effectManager.execute(scale, { input });
const reused = await effectManager.execute(scale, { input });
assert.equal(reused.execution.cached, true);
resources.set('guide:factor', 3);
const recomputed = await effectManager.execute(scale, { input });
assert.equal(recomputed.execution.cached, false);
assert.notEqual(scaled.outputs.output.revision, recomputed.outputs.output.revision);

const nonnegative = defineInvariant({
  id: 'guide.nonnegative',
  version: '1',
  description: 'Nonnegative result',
  inputs: { result: Integer },
  check(_ctx, { result }) {
    return { ok: result >= 0, reason: 'The result must be nonnegative' };
  },
});
const countAccepted = defineTransformation({
  id: 'guide.count-accepted',
  version: '1',
  description: 'Stage a counter update while checking the proposed result',
  inputs: { proposed: Integer },
  outputs: { result: Integer },
  effects: [readCount, writeCount],
  cache: 'never',
  ensures: [
    {
      invariant: nonnegative,
      bindings: { result: { from: 'outputs', port: 'result' } },
    },
  ],
  run(ctx, { proposed }) {
    ctx.writeResource(writeCount, ctx.readResource(readCount) + 1);
    return { outputs: { result: proposed } };
  },
});
await assert.rejects(
  effectManager.execute(countAccepted, { proposed: -1 }),
  (error: unknown) => (error as { code?: string }).code === 'postcondition',
);
assert.equal(resources.read('guide:accepted')!.value, 0);
await effectManager.execute(countAccepted, { proposed: 7 });
assert.equal(resources.read('guide:accepted')!.value, 1);

console.log(
  JSON.stringify(
    {
      strategyStatus: execution.status,
      originalPlanNodes: walk(original).length,
      editedPlanNodes: walk(loaded).length,
      arithmeticBefore: beforeCost.value,
      arithmeticAfter: afterCost.value,
      rewriteApplications,
      reusedAnalysisRecord: afterCost.id === (await manager.analyse(arithmeticCost, output)).id,
      acceptedTransactions: snapshot.executions.filter(record => record.status === 'accepted').length,
      rejectedTransactions: snapshot.executions.filter(record => record.status === 'rejected').length,
      rejectedEdit: rejected,
      originalInputUnchanged: JSON.stringify(input) === capturedInput,
      resourceDemo: {
        unchangedFactorReusesBody: reused.execution.cached,
        changedFactorRecomputesBody: !recomputed.execution.cached,
        rejectedWriteWasRolledBack: true,
        finalAcceptedCount: resources.read('guide:accepted')!.value,
      },
    },
    null,
    2,
  ),
);
