import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');
const source = projectSource('regex-nfa', projectAllFiles('regex-nfa'));
for (const pass of ['bce','bcm','lvn','constprop','simplify','cfg','subst','strength']) {
 const p = Program.fromProject(source);
 const call = benchCase(storeOf(p.origin.value), 'regexMatch', {pattern:{string:'[a-c]*[b-d]*a*d'},text:{string:'abccabbd'}});
 await p.pipeline('speed', {count:5});
 const steps = () => runImage(lowerToImage(p.head).image, 'regexMatch',call.args,call.memory).steps;
 const before = steps();
 const result = await p.apply(pass,{count:40});
 console.log(pass, before, steps(), JSON.stringify(result));
}
