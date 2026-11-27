// Claim (B, C): Tix passes do run in a strategy plan through `passAlgorithm`, and their meaning gate is silently
// dropped there. This contradicts BACKLOG F27 ("no Tix pass can appear in a strategy plan").
// Method:
//  1. F27's own test: a plan with fork + chooseBest over `inline` and `split-sum`, through the stock bridge.
//  2. A deliberately wrong pass (same signature, different values): optimizeTix's runner with the Tix meaning gate
//     rejects it; the stock bridge accepts it and returns the wrong program.
//  3. The fix without any framework change: the same meaning gate wrapped as a contract (an `ensures` invariant over
//     input, origin and output) and handed to the bridge's existing `contract` / `contractInputs` options.
import { dist } from './00-root.mjs';
const S = await dist('framework/strategy/index.js');
const C = await dist('framework/contracts/index.js');
const { applyNativePassSync, definePass, passAlgorithm } = await dist('framework/passes/index.js');
const { compileTix, runTix } = await dist('tensor/index.js');
const { inlinePass, splitPass } = await dist('tensor/passes.js');
const { meaningGate } = await dist('tensor/contract.js');
const { TixIR } = await dist('tensor/ir.js');
const { parse } = await dist('tensor/parser.js');

const src = 'fn f(x:f32[N,K]):f32[N] { a[i,k] = x[i,k] * 2; y[i] = sum(k) a[i,k]; return y; }';
const p = compileTix(src);
const metrics = { id: 'size', version: '1', kind: 'metrics', description: 'statements', run: (_c, art) => ({ statements: art.value.functions[0].statements.length }) };
const f27 = S.plan('f27', S.chooseBest('choose', S.fork('arms', [inlinePass, splitPass].map(q => ({ name: q.id, strategy: S.apply(q.id, S.algorithm(q.id)) }))),
  { metric: 'statements', direction: 'min' }, { metrics: S.algorithm('size') }));

// 1. stock bridge, F27's test
{
  const reg = new S.AlgorithmRegistry().register(metrics);
  for (const q of [inlinePass, splitPass]) reg.register(passAlgorithm(q, { manager: new C.AnalysisManager() }));
  const run = await S.execute(f27, reg, p.current);
  console.log('1. F27 test (fork + chooseBest over inline, split-sum) through the stock bridge:', run.status,
    '| chosen statements', run.value?.value.functions[0].statements.length);
}

// 2. a wrong pass: z = 3*sum instead of 2*sum
const wrong = definePass({ ...inlinePass, id: 'probe.wrong', description: 'inline, but multiplies by 3', run: () => ({ native: parse('fn f(x:f32[N,K]):f32[N] { y[i] = sum(k) x[i,k] * 3; return y; }') }) });
try {
  applyNativePassSync(wrong, p.current, meaningGate(p.origin, 'exact'));
  console.log('2a. optimizeTix-style runner with the meaning gate: ACCEPTED (unexpected)');
} catch (e) { console.log('2a. optimizeTix-style runner with the meaning gate:', e.code, '-', String(e.message).slice(0, 80)); }
{
  let captured;
  const reg = new S.AlgorithmRegistry().register(passAlgorithm(wrong, { manager: new C.AnalysisManager(), onResult: r => (captured = r) }));
  const run = await S.execute(S.plan('w', S.apply('wrong', S.algorithm('probe.wrong'))), reg, p.current);
  const inputs = { x: { shape: [1, 2], data: new Float32Array([1, 1]) } };
  console.log('2b. same pass through the stock bridge:', run.status, '| contract recorded:', captured?.contract !== undefined,
    '| y(origin)', runTix(p, 'f', inputs).data[0], 'y(result)', runTix({ ...p, current: run.value }, 'f', inputs).data[0]);
}

// 3. the gate as a contract, through the bridge's existing options
const gateContract = relation => {
  const invariant = C.defineInvariant({
    id: 'tix.meaning-gate.' + relation, version: '1', description: 'the Tix meaning gate as an invariant',
    inputs: { before: TixIR, origin: TixIR, after: TixIR },
    // the gate's evidence carries an `undefined` field, which the manager refuses ("IR data cannot contain
    // undefined"), so it is passed through a JSON round trip: the only adaptation the gate needed
    check: (_ctx, { before, origin, after }) => {
      const r = meaningGate(origin, relation)(before, after);
      return r.ok ? { ok: true, evidence: JSON.parse(JSON.stringify(r.evidence ?? null)) } : { ok: false, reason: r.reason };
    },
  });
  return C.defineTransformation({
    id: 'tix.gated.' + relation, version: '1', description: 'a Tix pass under its meaning gate',
    inputs: { input: TixIR, origin: TixIR }, outputs: { output: TixIR },
    ensures: [{ invariant, bindings: { before: { from: 'inputs', port: 'input' }, origin: { from: 'inputs', port: 'origin' }, after: { from: 'outputs', port: 'output' } } }],
  });
};
const gated = (q, relation, sink) => passAlgorithm(q, { manager: new C.AnalysisManager(), contract: gateContract(relation), contractInputs: () => ({ origin: p.origin }), onResult: sink });
{
  const reg = new S.AlgorithmRegistry().register(metrics).register(gated(inlinePass, 'exact')).register(gated(splitPass, 'tolerance'));
  const run = await S.execute(f27, reg, p.current);
  const chosen = run.value?.value.functions[0].statements.length;
  console.log('3a. F27 test with the gate as a bridge contract:', run.status, '| chosen statements', chosen, '|', String(run.error?.message ?? JSON.stringify(run.error ?? '')).slice(0, 300));
  let captured;
  const reg2 = new S.AlgorithmRegistry().register(gated(wrong, 'exact', r => (captured = r)));
  const run2 = await S.execute(S.plan('w', S.attempt('try', S.apply('wrong', S.algorithm('probe.wrong')), S.apply('keep', S.algorithm('keep')))),
    reg2.register({ id: 'keep', version: '1', kind: 'transform', description: 'identity', run: (_c, a) => a }), p.current);
  console.log('3b. wrong pass with the gate as a bridge contract, inside attempt/fallback:', run2.status,
    '| result is the input:', run2.value?.revision === p.current.revision, '(the fallback ran)');
}
