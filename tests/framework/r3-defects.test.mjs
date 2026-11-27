// IRWB-039 phase 1a: the R3 synthesis probes (ttmp/2026/11/26/IRWB-019-.../various/r3-synthesis/scripts/01-04) as
// tests of the CORRECT behaviour. Each is marked `todo` with the BACKLOG item that fixes it; the fix removes the
// `todo` in the same commit. A todo test that passes is reported by node as such: that is the signal to remove it.
import test from 'node:test';
import assert from 'node:assert/strict';

const C = await import('../../dist/framework/contracts/index.js');
const { assuranceOf } = await import('../../dist/framework/contracts/differential.js');
const { applyPass, applyNativePassSync, definePass, semanticCorrespondence } = await import(
  '../../dist/framework/passes/index.js'
);
const { IRStore } = await import('../../dist/framework/ir/index.js');
const { compileTix, optimizeTix } = await import('../../dist/tensor/index.js');
const { inlinePass } = await import('../../dist/tensor/passes.js');
const { meaningGate } = await import('../../dist/tensor/contract.js');
const { TixIR } = await import('../../dist/tensor/ir.js');

const desc = 'r3 defect test';

// ---------- F34 (probe 01): a sampled check and an exhaustive one must not record the same assurance ----------
test(
  'F34: sampled and exhaustive checks record different assurance; unknown evidence is never exact',
  { todo: 'F34' },
  async () => {
    const Fn = C.defineIR({ id: 'r3.fn', version: '1', description: desc, validate() {} });
    const table = { id: x => x, buggy: x => (x % 2 ? x : x | 1) }; // wrong on every even input
    const sampled = C.differential({
      id: 'r3.sampled',
      version: '1',
      description: desc,
      inputs: { baseline: Fn, subject: Fn },
      baseline: 'baseline',
      subject: 'subject',
      count: 5,
      seed: 1,
      cases: () => [1, 3, 5, 7, 9],
      run: (_side, art, x) => table[art.value](x),
      compare: (a, b) => a === b,
    });
    const exhaustive = C.defineInvariant({
      id: 'r3.exhaustive',
      version: '1',
      description: desc,
      inputs: { baseline: Fn, subject: Fn },
      check: (_ctx, { baseline, subject }) => {
        for (let x = 0; x < 256; x++)
          if (table[baseline.value](x) !== table[subject.value](x)) return { ok: false, reason: `x=${x}` };
        return { ok: true, evidence: { method: 'exhaustive', domain: 'u8', cases: 256 } };
      },
    });
    const m = new C.AnalysisManager();
    const a = await m.checkInvariant(sampled, {
      baseline: C.createArtifact(Fn, 'f', 'id'),
      subject: C.createArtifact(Fn, 'f', 'buggy'),
    });
    const b = await m.checkInvariant(exhaustive, {
      baseline: C.createArtifact(Fn, 'f', 'id'),
      subject: C.createArtifact(Fn, 'g', 'id'),
    });
    assert.notDeepEqual(
      a.assurance,
      b.assurance,
      'a 5-case sample and a 256-case exhaustion record the same assurance',
    );
    assert.notEqual(assuranceOf(undefined), 'checked-exact', 'no evidence must not count as exact');
    assert.notEqual(
      assuranceOf({ method: 'typo' }),
      'checked-exact',
      'an unknown method must not count as exact',
    );
  },
);

// ---------- F33 (probe 03): nothing about a rejected candidate is published ----------
test('F33: a candidate the contract rejects does not become a store head', async () => {
  const p = compileTix('fn f(x:f32[N]):f32[N] { y[i] = x[i] * 2; z[i] = y[i] + 1; return z; }');
  const no = C.defineInvariant({
    id: 'r3.no',
    version: '1',
    description: desc,
    inputs: { output: TixIR },
    check: () => ({ ok: false, reason: 'rejects every candidate' }),
  });
  const rejecting = C.defineTransformation({
    id: 'r3.rejecting',
    version: '1',
    description: desc,
    inputs: { input: TixIR },
    outputs: { output: TixIR },
    ensures: [{ invariant: no, bindings: { output: { from: 'outputs', port: 'output' } } }],
  });
  const store = new IRStore();
  await assert.rejects(
    applyPass(inlinePass, p.current, {
      manager: new C.AnalysisManager(),
      store,
      outputId: 'candidate',
      contract: rejecting,
    }),
    { code: 'contractRejected' },
  );
  let head;
  try {
    head = store.head('candidate');
  } catch {
    head = undefined;
  }
  assert.equal(head, undefined, 'the rejected candidate is the head of the caller-supplied store');
});

test('F33: no accepted execution or fact survives a later preservation failure', async () => {
  const p = compileTix('fn f(x:f32[N]):f32[N] { y[i] = x[i] * 2; z[i] = y[i] + 1; return z; }');
  const candidate = optimizeTix(p, ['inline']).program.current;
  const count = C.defineAnalysis({
    id: 'r3.count',
    version: '1',
    description: desc,
    input: TixIR,
    output: C.Integer,
    run: (_c, a) => a.value.functions[0].statements.length,
  });
  const one = C.defineAnalysis({
    id: 'r3.one',
    version: '1',
    description: desc,
    input: TixIR,
    output: C.Check,
    run: (_c, a) => ({ ok: a.value.functions[0].statements.length === 1 }),
  });
  const property = C.defineProperty({
    id: 'r3.single-statement',
    version: '1',
    description: desc,
    subject: TixIR,
    check: one,
  });
  const establishes = C.defineTransformation({
    id: 'r3.establishes',
    version: '1',
    description: desc,
    inputs: { input: TixIR },
    outputs: { output: TixIR },
    establishes: [{ property, subject: { from: 'outputs', port: 'output' } }],
  });
  const m = new C.AnalysisManager();
  const falseClaim = definePass({
    ...inlinePass,
    id: 'r3.false-claim',
    contract: establishes,
    preserves: [count],
  });
  await assert.rejects(applyPass(falseClaim, p.current, { manager: m, auditPreservation: true }), {
    code: 'preserveViolated',
  });
  assert.equal(m.properties(candidate).length, 0, 'a fact about the rejected candidate is visible');
  assert.notEqual(
    m.snapshot().executions.at(-1)?.status,
    'accepted',
    'the rejected application is recorded as accepted',
  );
});

// ---------- F35 (probe 04): a required mapping must cover what it claims, and be consistent with the diff ----------
test(
  'F35: zero mapping groups and a false group are rejected; the honest mapping is accepted',
  { todo: 'F35' },
  async () => {
    const q = compileTix('fn f(x:f32[N,N]):f32[N,N] { p[i,j] = x[i,j] + 1; y[i,j] = p[j,i]; return y; }');
    const inline = applyNativePassSync(inlinePass, q.current, meaningGate(q.origin, 'exact'));
    const mappingOnly = C.defineTransformation({
      id: 'r3.mapping',
      version: '1',
      description: desc,
      inputs: { input: TixIR },
      outputs: { output: TixIR },
      correspondence: [{ id: 'entities', from: 'input', to: 'output', relation: 'generic-ir-edit' }],
    });
    const lists = {
      sourceEntities: TixIR.entities(q.current.value),
      targetEntities: TixIR.entities(inline.artifact.value),
    };
    const verify = entities =>
      new C.AnalysisManager().verifyTransformation(
        { input: q.current },
        { output: inline.artifact },
        mappingOnly,
        [{ ...semanticCorrespondence(inline.correspondence), ...lists, entities }],
      );
    const src = re => lists.sourceEntities.filter(e => re.test(e)),
      dst = re => lists.targetEntities.filter(e => re.test(e));
    await verify([{ from: src(/\/(p|y)$/), to: dst(/\/y$/) }]); // honest: p and y were merged into y
    await assert.rejects(verify([]), 'zero mapping groups were accepted');
    await assert.rejects(
      verify([{ from: src(/\/y$/), to: [] }]),
      'a group saying the surviving y was deleted was accepted',
    );
  },
);
