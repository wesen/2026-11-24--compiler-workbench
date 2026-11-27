// IRWB-038-C probe 02: what assurance does the analysis manager record for a sampled differential check?
// A deliberately wrong "optimization" (x -> x | 1 instead of x) that agrees on the sampled cases must not be
// recorded with the same assurance as an exact check. Run from the worktree root after `npm run build`.
import * as C from '../../../../../../dist/framework/contracts/index.js';
const Fn = C.defineIR({ id: 'probe.fn', version: '1', description: 'a unary i32 function by name', validate() {} });
const table = { id: x => x, buggy: x => (x % 2 ? x : x | 1) }; // differs on every even input
const inv = C.differential({
  id: 'probe.same', version: '1', description: 'same results on sampled inputs',
  inputs: { baseline: Fn, subject: Fn }, baseline: 'baseline', subject: 'subject',
  count: 5, seed: 1,
  cases: () => [1, 3, 5, 7, 9], // the generator only produces odd inputs
  run: (_side, art, x) => table[art.value](x),
  compare: (a, b) => a === b,
});
const m = new C.AnalysisManager();
const ev = await m.checkInvariant(inv, {
  baseline: C.createArtifact(Fn, 'f', 'id'),
  subject: C.createArtifact(Fn, 'f', 'buggy'),
});
console.log('ok:', ev.ok, '| recorded assurance:', ev.assurance, '| evidence.method:', ev.evidence?.method,
  '| assuranceOf(evidence):', C.assuranceOf ? C.assuranceOf(ev.evidence) : '(not exported from contracts/index)');
