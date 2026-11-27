// Specialize runVm on the project's bytecode image and measure each stage (n = 12, seed = 8, coalesce: true).
//   node 03-specialize.mjs [--listing] [--budget N]
import { fresh, bindings, measure, rejected, specializeBuffer, frameSlots } from './lib.mjs';
const arg = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const budget = arg('--budget') === undefined ? undefined : +arg('--budget');
const rows = [];
const general = fresh();
rows.push(measure(general, 'general r0'));
console.log('speed rejected:', rejected(await general.pipeline('speed')));
rows.push(measure(general, 'general speed'));

const p = fresh();
const r = await p.specializeBuffer(bindings(), { budget });
console.log('specialize-buffer:', JSON.stringify(r));
console.log(JSON.stringify(p.edits().find(e => e.kind === 'specialized')));
rows.push(measure(p, 'specialized'));
// forward the address temporaries into their stores before promotion (licm and lvn would hoist them into locals)
const PRE = (arg('--pre') ?? 'subst,subst,dce').split(',');
console.log('pre rejected:', rejected(await p.pipeline(PRE)));
rows.push(measure(p, '+ ' + PRE.join(' ')));
console.log('frame-slots:', JSON.stringify(await p.apply(frameSlots)));
rows.push(measure(p, '+ frame-slots'));
console.log('speed rejected:', rejected(await p.pipeline('speed')));
rows.push(measure(p, '+ speed'));
console.table(rows);
console.log('check vs r0 under the assumptions:', p.check({ fn: 'runVm' }).status, JSON.stringify(p.assumptions).slice(0, 80));
if (process.argv.includes('--listing')) console.log(p.listing('runVm'));
