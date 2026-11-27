import {readFileSync} from 'node:fs';
const [base,ref]=process.argv.slice(2).map(p=>JSON.parse(readFileSync(p,'utf8')));
let a=0,b=0,c=0;
console.log('| Project | O2 | speed | reference | limited (ours/reference) |');
console.log('| --- | ---: | ---: | ---: | ---: |');
for(const [id,row] of Object.entries(base)) {
 const r=ref[id]; if(row.error || !r || r.error) {console.log(`| ${id} | ${row.error ?? r?.error ?? 'missing'} | | | |`); continue;}
 a+=row.O2.default; b+=row.speed.default; c+=r.n;
 console.log(`| ${id} | ${row.O2.default} | ${row.speed.default} | ${r.n} | ${row.speed.limited}/${r.limited} |`);
}
console.log(`| **total** | **${a}** | **${b}** | **${c}** | |`);
