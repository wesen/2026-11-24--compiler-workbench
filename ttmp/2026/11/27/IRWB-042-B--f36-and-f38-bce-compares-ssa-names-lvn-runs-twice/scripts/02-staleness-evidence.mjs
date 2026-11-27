// Evidence for the F38 fix: how often the second lvn (before rotate, regex-nfa) meets a `seen` entry whose value
// an earlier merge of the same run rebuilt away. Run against an instrumented build that logs `STALE` at the
// refresh (that logging is NOT in the committed source); various/06-staleness.log is what it printed.
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const { projectFiles } = await import('../../../../../../tools/corpus.mjs');
const { measure } = await import(D + 'typed/strategies.js');
const speed = [...PIPELINES.speed];
speed.splice(speed.indexOf('rotate'), 0, 'lvn');
const withSecond = Program.fromProject(projectSource('regex-nfa', projectFiles('regex-nfa')));
const r = await withSecond.pipeline(speed, { count: 3 });
console.log('rejected steps:', r.steps.filter(s => s.rejected).map(s => s.pass));
const secondLvn = r.steps.filter(s => s.pass === 'lvn').pop();
console.log('the second lvn:', secondLvn.changed ? `${secondLvn.edits} edits` : 'no change');
const plain = Program.fromProject(projectSource('regex-nfa', projectFiles('regex-nfa')));
await plain.pipeline('speed', { count: 3 });
const m = p => measure(p, p.artifact(), { count: 10, seed: 7 }).instructions;
console.log('speed instructions:', m(plain), ' with the second lvn:', m(withSecond));
