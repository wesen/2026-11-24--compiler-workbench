// Reconstruct report tables from successful calls and reject incomplete or unequal series.
import {readFileSync} from 'node:fs';
const read=n=>readFileSync(new URL('./'+n+'.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse);
const b=read('01-base'),q=read('16-qualification'),ph=read('11-final');
const median=(r,fuse)=>{
  const s=r.filter(x=>x.fuse===fuse);
  if(s.length!==5||new Set(s.map(x=>x.round)).size!==5)throw Error('Incomplete pair '+JSON.stringify(s[0]));
  return s.map(x=>x.ms).toSorted((a,b)=>a-b)[2];
};
const xs=(data,label,phase)=>data.filter(x=>x.label===label && (!phase||x.phase[0]===phase));
const pair=(data,label,phase)=>{
  const r=xs(data,label,phase);
  if(new Set(r.map(x=>x.hash)).size!==1)throw Error('Outputs differ '+label);
  return [median(r,true),median(r,false)];
};
const fmt=p=>p.map(x=>x.toFixed(4)).join(' / ');
console.log('| Function | Base F / U ms | Stage 6 F / U ms | F speedup over base F | Definitions F / U | Launches F / U |');
console.log('|---|---:|---:|---:|---:|---:|');
for(const [name,defs,launch] of [['matmul','1 / 1','1 / 1'],['large','1 / 1','1 / 1'],['attention','1 / 6','3 / 6'],['mlp','1 / 3','2 / 3'],['conv2d','1 / 1','1 / 1'],['softmax','1 / 4','1 / 4'],['layernorm','1 / 4','1 / 4']]){
  const old=pair(b,name),latest=pair(q,name);
  if(xs(b,name)[0].hash!==xs(q,name)[0].hash)throw Error('Base words differ: '+name);
  console.log(`| ${name==='large'?'matmul 4096³':name==='matmul'?'matmul 512³':name} | ${fmt(old)} | ${fmt(latest)} | ${(old[0]/latest[0]).toFixed(2)}× | ${defs} | ${launch} |`);
}
console.log('\n| Contraction | F / U ms | F / U TFLOP/s | F / U fraction of cuBLAS throughput |');
console.log('|---|---:|---:|---:|');
for(const [name,phase,label,ops,ref] of [
  ['matmul',null,'matmul 512³',2*512**3,.0329],['large',null,'matmul 4096³',2*4096**3,2*4096**3/(19.2e9)],
  ['attention','score','attention score',2*1024*1024*64,.0177],['attention','out','attention value',2*1024*64*1024,.0216],
  ['mlp','h','MLP hidden',2*1024*1024*256,.0423],['mlp','y','MLP output',2*1024*256*1024,.0475],
  ['conv2d',null,'conv2d',2*8*32*62*62*16*3*3,null]
]){
  const p=pair(phase?ph:q,name,phase);
  if(phase && xs(ph,name,phase)[0].hash!==xs(q,name)[0].hash)throw Error('Isolated launch output differs: '+label);
  console.log(`| ${label} | ${fmt(p)} | ${p.map(t=>(ops/(t*1e9)).toFixed(2)).join(' / ')} | ${ref?p.map(t=>(ref/t).toFixed(2)+'×').join(' / '):'—'} |`);
}
