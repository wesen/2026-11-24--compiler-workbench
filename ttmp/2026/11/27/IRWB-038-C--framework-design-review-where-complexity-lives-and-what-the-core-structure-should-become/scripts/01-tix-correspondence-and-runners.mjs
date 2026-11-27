// IRWB-038-C probe 01. Run from the worktree root after `npm run build`:
//   node ttmp/2026/11/27/IRWB-038-C--*/scripts/01-tix-correspondence-and-runners.mjs
// Questions:
//  (a) how fine is the correspondence a Tix pass records (inline removes a statement)?
//  (b) does applyNativePassSync refuse a pass with `preserves`?
//  (c) can a Tix pass run through the async applyPass / passAlgorithm (F27), and what blocks it?
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { inlinePass, splitPass } from '../../../../../../dist/tensor/passes.js';
import { meaningGate } from '../../../../../../dist/tensor/contract.js';
import { applyNativePassSync, applyPass, definePass } from '../../../../../../dist/framework/passes/index.js';
import { passAlgorithm } from '../../../../../../dist/framework/passes/bridge.js';
import { AnalysisManager } from '../../../../../../dist/framework/contracts/index.js';
import * as S from '../../../../../../dist/framework/strategy/index.js';

const p = compileTix('fn f(x:f32[N]):f32[N]{a[i]=x[i]*2;b[i]=a[i]+1;return b;}');
const r = applyNativePassSync(inlinePass, p.current, meaningGate(p.origin, 'exact'));
console.log('(a) inline changed:', r.changed, 'edits:', r.edits);
console.log('    source entities:', r.correspondence.sourceEntities);
console.log('    target entities:', r.correspondence.targetEntities);
console.log('    entries:', JSON.stringify(r.correspondence.entries));
console.log('    entity changes:', r.changes.entities.map(c => `${c.kind}:${c.entity}`).join(', '));

const withPreserves = definePass({ ...inlinePass, id: 'probe.inline-preserves', preserves: [{ id: 'x', version: '1' }] });
try {
  applyNativePassSync(withPreserves, p.current, () => ({ ok: true }));
  console.log('(b) accepted a pass with preserves');
} catch (e) {
  console.log('(b) applyNativePassSync:', e.code, '-', e.message);
}

const manager = new AnalysisManager();
try {
  const a = await applyPass(inlinePass, p.current, { manager });
  console.log('(c1) applyPass on a Tix pass without contract: changed', a.changed, '(no meaning check ran: inlinePass has no contract)');
} catch (e) {
  console.log('(c1) applyPass failed:', e.message);
}
const registry = new S.AlgorithmRegistry()
  .register(passAlgorithm(inlinePass, { manager }))
  .register(passAlgorithm(splitPass, { manager }));
const plan = S.plan('tix', S.sequence('main',
  S.apply('inline', S.algorithm('tensor.inline', '1')),
  S.apply('split', S.algorithm('tensor.split-sum', '1'))));
const ex = await S.execute(plan, registry, p.current, { maxSteps: 100 });
console.log('(c2) strategy plan over Tix passes via passAlgorithm:', ex.status, ex.error?.message ?? '');
