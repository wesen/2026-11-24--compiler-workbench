// Probe: what do origins look like at the head of speed on regex-nfa? (how many entries, which `via`, per kind)
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const p = Program.fromProject(projectSource('regex-nfa', projectFiles('regex-nfa')));
await p.pipeline('speed', { count: 5 });
const n = p.head.value, tally = {};
for (const [kind, table] of [['value', n.values], ['stmt', n.stmts], ['block', n.blocks]])
  for (const e of Object.values(table)) {
    const k = `${kind} origins=${e.origin.length} via=${e.origin.map(o => `${o.via}/${o.kind}`).join('>')}`;
    tally[k] = (tally[k] ?? 0) + 1;
  }
console.log(Object.entries(tally).sort().map(([k, v]) => `${String(v).padStart(5)} ${k}`).join('\n'));
console.log(JSON.stringify(Object.values(n.stmts).find(s => s.origin[0].via === 'rotate'), null, 1));
console.log(JSON.stringify(p.revisions.at(-1).edits.slice(0, 3), null, 1));
console.log(p.revisions.map(r => `r${r.rev} ${r.pass} ${r.edits.length}`).join(', '));
