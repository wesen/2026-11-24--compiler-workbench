// IRWB-039 phase 1a: R3 synthesis probe 02 as a test of the CORRECT behaviour (BACKLOG F27, restated).
// Tix passes run in strategy plans through the bridge, but today their meaning gate is a closure handed to
// applyNativePassSync, so a plan drops it. The fix exports `tixAlgorithm(pass, { origin })` from src/tensor: a
// strategy algorithm that carries the pass's meaning gate as a contract (relation declared by the pass, not chosen
// by its name), and `optimizeTix` runs its sequence as a plan of these. Remove `todo` in the fixing commit.
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../dist/framework/strategy/index.js');
const { definePass } = await import('../../dist/framework/passes/index.js');
const T = await import('../../dist/tensor/index.js');
const { inlinePass, splitPass } = await import('../../dist/tensor/passes.js');
const { parse } = await import('../../dist/tensor/parser.js');

const src = 'fn f(x:f32[N,K]):f32[N] { a[i,k] = x[i,k] * 2; y[i] = sum(k) a[i,k]; return y; }';
const wrong = definePass({
  ...inlinePass,
  id: 'r3.wrong',
  description: 'inline, but multiplies by 3',
  run: () => ({ native: parse('fn f(x:f32[N,K]):f32[N] { y[i] = sum(k) x[i,k] * 3; return y; }') }),
});

test('F27: a wrong Tix pass is rejected inside a strategy plan; correct passes are accepted', async () => {
    assert.equal(typeof T.tixAlgorithm, 'function', 'src/tensor exports tixAlgorithm(pass, { origin })');
    const p = T.compileTix(src);
    const keep = { id: 'keep', version: '1', kind: 'transform', description: 'identity', run: (_c, a) => a };
    const reg = new S.AlgorithmRegistry()
      .register(T.tixAlgorithm(wrong, { origin: p.origin }))
      .register(T.tixAlgorithm(inlinePass, { origin: p.origin }))
      .register(T.tixAlgorithm(splitPass, { origin: p.origin }))
      .register(keep);
    // the wrong pass alone: the plan must not succeed with its output
    const bad = await S.execute(S.plan('w', S.apply('wrong', S.algorithm('r3.wrong'))), reg, p.current);
    assert.ok(
      bad.status !== 'succeeded' || bad.value.revision === p.current.revision,
      'the wrong pass was accepted in a plan',
    );
    // inside attempt/fallback: the fallback runs and the result is the input
    const tried = await S.execute(
      S.plan(
        't',
        S.attempt('try', S.apply('wrong', S.algorithm('r3.wrong')), S.apply('keep', S.algorithm('keep'))),
      ),
      reg,
      p.current,
    );
    assert.equal(tried.status, 'succeeded');
    assert.equal(tried.value.revision, p.current.revision);
    // a correct sequence through plans gives the same revision as optimizeTix
    const seq = await S.execute(
      S.plan(
        's',
        S.sequence(
          'main',
          S.apply('inline', S.algorithm(inlinePass.id)),
          S.apply('split', S.algorithm(splitPass.id)),
        ),
      ),
      reg,
      p.current,
    );
    assert.equal(seq.status, 'succeeded');
    assert.equal(seq.value.revision, T.optimizeTix(p, ['inline', 'split-sum']).program.current.revision);
  },
);
