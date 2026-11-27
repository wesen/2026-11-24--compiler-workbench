import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {projectIds} from '../../../../../../tools/corpus.mjs';
import {PIPELINES} from '../../../../../../dist/typed/passes.js';
import {RULE_EVIDENCE} from '../../../../../../dist/typed/rules/evidence.js';

const classes = ['local','structural','other'];
const presets = ['O2','speed'];
const projects = projectIds();
const data = projects.flatMap(project => {
  const result = JSON.parse(gunzipSync(readFileSync(new URL('../various/census/' + project + '.json.gz', import.meta.url))));
  return presets.map(pipeline => ({ project, pipeline, ...result[pipeline] }));
});
const number = x => Number(x.toFixed(2)).toLocaleString('en-US');
const sum = xs => xs.reduce((a,b) => a+b,0);
const percent = (x,n) => n ? (100*x/n).toFixed(1)+'%' : '—';
const lines = [];
const paragraph = s => lines.push(s,'');
const table = (cols, rows) => {
  const row = cells => '| '+cells.join(' | ')+' |';
  lines.push(row(cols),row(cols.map(()=>'---')),...rows.map(row),'');
};
function counts(runs, pass) {
  const revs = runs.flatMap(r => r.revisions).filter(r => !pass || pass === r.pass);
  const edits = revs.flatMap(r => r.edits);
  const byClass = classes.map(c => edits.filter(e => e.category === c).length);
  const metric = key => classes.map(c => sum(revs.map(r=>r[key][c])));
  return [byClass,metric('words'),metric('hits')];
}
function shares(values) {
  const total = sum(values);
  return number(total)+' · '+values.map(v=>percent(v,total)).join(' / ');
}
paragraph('## Measurement tables');
paragraph('Each cell gives the denominator followed by the local / structural / other shares. A dash denotes an empty denominator. The JSON ledgers preserve unrounded counts and every record in revision order. Each revision contributes the union of affected RV32 words on each side to its pass and project.');
const cols = ['Group','Edit records','Static RV32 words','Executed RV32 words'];
const row = (label,runs,pass) => [label,...counts(runs,pass).map(shares)];
table(cols,presets.map(p=>row(p,data.filter(r=>r.pipeline===p))));
for (const p of presets) {
  const runs = data.filter(r=>r.pipeline===p);
  paragraph('### '+p+' by pass');
  table(cols,[...new Set(PIPELINES[p])].map(pass=>row(pass,runs,pass)));
  paragraph('### '+p+' by project');
  table(cols,runs.map(r=>row(r.project+(r.status==='succeeded'?'':' ('+r.status+')'),[r])));
}

paragraph('## Rule coverage and sensitivity');
const detail = [];
for (const p of presets) {
  const runs = data.filter(r=>r.pipeline===p);
  const revs = runs.flatMap(r=>r.revisions);
  const edits = revs.flatMap(r=>r.edits);
  const locals = edits.filter(e=>e.category==='local');
  const n = pred => locals.filter(pred).length;
  const names = [...new Set(locals.flatMap(e=>e.rules))].sort();
  const contextual = edits.filter(e=>['forward substitution','reuse prior computation','reaching constant'].includes(e.reason));
  const firings = locals.flatMap(e=>e.rules);
  const key = e=>[...new Set(e.rules)].sort().join(' + ');
  const bundles = [...new Set(locals.map(key))].map(k=>[k,n(e=>key(e)===k)]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  const groups = revs.flatMap(r=>[...new Set(r.edits.map(e=>e.fn))].map(fn=>r.edits.filter(e=>e.fn===fn)));
  paragraph('### '+p);
  paragraph(`Of ${locals.length} local edits, ${n(e=>e.cited)} carry complete explicit citations, ${n(e=>e.rules.every(r=>RULE_EVIDENCE[r]?.verdict==='sound'))} replay entirely with recorded sound table evidence, and ${n(e=>e.reason==='guarded arithmetic')} require guarded arithmetic shapes. There are ${firings.length} individual firings or guarded shape matches. Among ${groups.length} changed function–revision pairs, ${groups.filter(g=>g.every(e=>e.category==='local')).length} have exclusively local recorded edits. This is an upper bound for discharging a whole function at that revision.`);
  const extra = contextual.length;
  paragraph(`If “local” included replacements that need a binding premise, it would gain ${extra} records (${['reaching constant','forward substitution','reuse prior computation'].map(reason=>reason+' '+contextual.filter(e=>e.reason===reason).length).join(', ')}). The local edit share would become ${percent(locals.length+extra,edits.length)}. Deletions and helper declarations stay in their original classes.`);
  table(['Rule or proposed shape','Evidence strength','Firings','Local edits using it'],names.map(name=>[name,RULE_EVIDENCE[name]?.strength??'range guard required',firings.filter(r=>r===name).length,n(e=>e.rules.includes(name))]).sort((a,b)=>b[3]-a[3]||a[0].localeCompare(b[0])));
  paragraph('Counting complete edit records instead gives the following disjoint rule sets. A record with several firings of one rule needs that rule only once in its set.');
  table(['Required rule set','Edits'],bundles);
  const prof = runs.flatMap(r=>r.profiles);
  const lost = {};
  for(const r of prof) for(const [key,v] of Object.entries(r.missing)) lost[key]=(lost[key]??0)+v;
  detail.push({p,counts:counts(runs),accepted:runs.filter(r=>r.status==='succeeded').length,
    rejected:runs.filter(r=>r.status!=='succeeded').map(r=>[r.project,r.error]),
    revisions:revs.length,profiles:prof.length,cases:sum(prof.map(r=>r.cases)),missing:lost,
    unmatched:edits.filter(e=>e.reason.startsWith('unmatched')).length});
}
writeFileSync(new URL('../analysis/02-measurement-tables.md',import.meta.url),lines.join('\n'));
console.log(JSON.stringify(detail,null,2));
