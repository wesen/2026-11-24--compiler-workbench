// Modes: sweep [hex-start hex-end], bench rows cols spread repeats, audit start end.
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {compileTix,cudaSource} from '../../../../../../dist/tensor/index.js';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const dir=mkdtempSync(join(tmpdir(),'tix-exp-'));
try {
  const [mode,...args]=process.argv.slice(2);
  const buf=new ArrayBuffer(8), view=new DataView(buf);
  const entries=Array.from({length:1024},(_,t)=>{
    view.setFloat64(0,2**(t/1024));
    return '0x'+view.getBigUint64(0).toString(16)+'ull';
  });
  const powers='__device__ const unsigned long long powerBits[1024]={'+entries.join(',')+'};\n';
  writeFileSync(join(dir,'power.cuh'),powers);
  writeFileSync(join(dir,'exp.cuh'),read('04-exp.cuh'));
  if (mode==='sweep') writeFileSync(join(dir,'main.cu'),read('04-sweep.cu'));
  else {
    if (mode!=='bench' && mode!=='audit') throw Error('expected sweep, bench, or audit');
    const src=cudaSource(compileTix(readFileSync('corpus/tensor/softmax/main.tix','utf8')),'softmax');
    writeFileSync(join(dir,'main.cu'),src.slice(0,src.indexOf('static void run_case('))+
      '\n#include "power.cuh"\n#include "exp.cuh"\n#define TIX_KERNELS_ONLY\n'+read('02-kernels.cu')+read('05-kernels.cu'));
  }
  const result=JSON.parse(execFileSync('node',['tools/cuda-remote.mjs',dir,...(mode==='bench'?['--timed']:[]),'--',...(mode==='sweep'?[]:[mode]),...args],{encoding:'utf8'}));
  console.log(JSON.stringify({...result,tableSha256:createHash('sha256').update(powers).digest('hex')}));
} finally { rmSync(dir,{recursive:true,force:true}); }
