import {readFileSync} from 'node:fs';
const rows = n => readFileSync(new URL('./'+n+'.jsonl',import.meta.url),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const median = x => x.toSorted((a,b)=>a-b)[Math.floor(x.length/2)];
for(const file of process.argv.slice(2)){
  const groups = new Map();
  for(const {round,ms,hash,gates,...fields} of rows(file)){
    const key=JSON.stringify(fields);
    const xs=groups.get(key) ?? [];
    xs.push(ms);groups.set(key,xs);
  }
  for(const [key,x] of groups) console.log(JSON.stringify({file,...JSON.parse(key),n:x.length,ms:median(x)}));
}
