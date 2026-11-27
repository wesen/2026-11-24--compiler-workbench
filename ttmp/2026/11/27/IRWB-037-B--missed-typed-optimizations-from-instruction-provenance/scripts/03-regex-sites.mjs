import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/typed/';
const { Program } = await import(D + 'program.js');
const { projectSource } = await import(D + 'project.js');
const { storeOf } = await import(D + 'ir.js');
const { attributeSteps } = await import(D + 'attribute.js');
const { showStmt } = await import(D + 'listing.js');
const { benchCase } = await import(D + 'evaluate.js');
const { lowerToImage, runImage } = await import(D + 'backend/index.js');
const p = Program.fromProject(projectSource('regex-nfa', projectFiles('regex-nfa')));
const fn = 'regexMatch';
const call = benchCase(storeOf(p.head.value), fn, {pattern:{string:'[a-c]*[b-d]*a*d'},text:{string:'abccabbd'}});
await p.pipeline('speed');
const a = attributeSteps(p.revisions, { ...call, fn });
const st = storeOf(p.head.value);
const {image} = lowerToImage(p.head);
const r = runImage(image, fn, call.args, call.memory);
const sites = new Map();
for (const m of image.value.insns) {
  const n = r.counts[m.offset >>> 2];
  if (!n) continue;
  const id = m.covers.find(id => st.has(id) && st.get(id).kind === 'stmt') ?? 'frame';
  const site = sites.get(id) ?? {id, text:id === 'frame' ? id : showStmt(st,id), count:0, insns:[]};
  site.count += n;
  site.insns.push([m.sym,n]);
  sites.set(id,site);
}
console.log(JSON.stringify(a.totals));
for (const site of [...sites.values()].sort((a,b)=>b.count-a.count)) {
  const history = a.rows.filter(r=>r.sites.some(s=>s.id===site.id)).map(r=>[r.pass,r.delta,r.decision]);
  console.log(JSON.stringify({...site,history}));
}
