// IRWB-041-C probe: where a Tix pass's meaning gate lives, before and after this step.
// Run from the repository root after `npm run build`:  node <this file>
//  1. optimizeTix's synchronous runner: the gate is a closure, so a wrong pass is rejected (this works today).
//  2. the stock bridge (passAlgorithm, no contract): a plan accepts the same wrong pass and publishes its output
//     (the defect F27 is about).
//  3. tixAlgorithm(pass, { origin }) (exported by this step): the same plan rejects it, and attempt/fallback runs the
//     fallback, so the plan's value is its input.
//  4. the declared relation: which relation each pass carries, and that optimizeTix takes it from the pass.
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../../../');
const dist = path => import(pathToFileURL(resolve(root, 'dist', path)).href);

const S = await dist('framework/strategy/index.js');
const C = await dist('framework/contracts/index.js');
const { applyNativePassSync, definePass, passAlgorithm } = await dist('framework/passes/index.js');
const T = await dist('tensor/index.js');
const { inlinePass, splitPass } = await dist('tensor/passes.js');
const { meaningGate } = await dist('tensor/contract.js');
const { parse } = await dist('tensor/parser.js');

const src = 'fn f(x:f32[N,K]):f32[N] { a[i,k] = x[i,k] * 2; y[i] = sum(k) a[i,k]; return y; }';
const p = T.compileTix(src);
const wrong = definePass({
  ...inlinePass,
  id: 'probe.wrong',
  description: 'inline, but multiplies by 3',
  run: () => ({ native: parse('fn f(x:f32[N,K]):f32[N] { y[i] = sum(k) x[i,k] * 3; return y; }') }),
});
const keep = { id: 'keep', version: '1', kind: 'transform', description: 'identity', run: (_c, a) => a };
const show = async (label, f) => {
  try {
    console.log(label, '->', await f());
  } catch (e) {
    console.log(label, '-> THROWS', `${e.constructor.name}${e.code ? '[' + e.code + ']' : ''}:`,
      String(e.message).slice(0, 120));
  }
};

console.log('0. declared relations:', [inlinePass, splitPass].map(q => `${q.id}=${q.relation ?? '(none)'}`).join(', '));

await show('1. optimizeTix runner with the store gate, wrong pass', () => {
  applyNativePassSync(wrong, p.current, meaningGate(p.origin, 'exact'));
  return 'ACCEPTED (unexpected)';
});

await show('2. stock bridge (no contract), wrong pass inside attempt/fallback', async () => {
  const reg = new S.AlgorithmRegistry().register(passAlgorithm(wrong, { manager: new C.AnalysisManager() })).register(keep);
  const run = await S.execute(
    S.plan('w', S.attempt('try', S.apply('wrong', S.algorithm('probe.wrong')), S.apply('keep', S.algorithm('keep')))),
    reg,
    p.current,
  );
  return `${run.status}, result is the input: ${run.value?.revision === p.current.revision}`;
});

if (typeof T.tixAlgorithm !== 'function') {
  console.log('3. tixAlgorithm -> not exported yet (the defect this step fixes)');
} else {
  await show('3. tixAlgorithm, wrong pass inside attempt/fallback', async () => {
    const reg = new S.AlgorithmRegistry()
      .register(T.tixAlgorithm(wrong, { origin: p.origin }))
      .register(keep);
    const run = await S.execute(
      S.plan('w', S.attempt('try', S.apply('wrong', S.algorithm('probe.wrong')), S.apply('keep', S.algorithm('keep')))),
      reg,
      p.current,
    );
    return `${run.status}, result is the input: ${run.value?.revision === p.current.revision} (the fallback ran)`;
  });
  await show('3b. tixAlgorithm, wrong pass alone (no fallback)', async () => {
    const reg = new S.AlgorithmRegistry().register(T.tixAlgorithm(wrong, { origin: p.origin }));
    const run = await S.execute(S.plan('w', S.apply('wrong', S.algorithm('probe.wrong'))), reg, p.current);
    return `${run.status}: ${String(run.error?.message ?? '').slice(0, 100)}`;
  });
  await show('4. correct passes in one plan vs optimizeTix', async () => {
    const reg = new S.AlgorithmRegistry()
      .register(T.tixAlgorithm(inlinePass, { origin: p.origin }))
      .register(T.tixAlgorithm(splitPass, { origin: p.origin }));
    const run = await S.execute(
      S.plan('s', S.sequence('main', S.apply('inline', S.algorithm(inlinePass.id)), S.apply('split', S.algorithm(splitPass.id)))),
      reg,
      p.current,
    );
    return `${run.status}, same revision as optimizeTix: ${run.value?.revision === T.optimizeTix(p, ['inline', 'split-sum']).program.current.revision}`;
  });
}
