// Calibration and deployment share the same table generator and numerical expression as sweep 04.
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {compileTix,cudaSource} from '../../../../../../dist/tensor/index.js';
const read=f=>readFileSync(new URL(f,import.meta.url),'utf8');
const [action,...args]=process.argv.slice(2);
const deploy=action.startsWith('deploy-');
const mode=deploy?action.slice(7):action;
const dir=mkdtempSync(join(tmpdir(),'tix-calibrate-'));
try {
  const N=16384;
  const corrections=new Map();
  let tableBits=10,degree=3;
  if(mode!=='fit') {
    const sizes={'q4':[7,4],cubic:[10,3],quadratic:[14,2],q4096:[12,2]};
    [tableBits,degree]=sizes[args.shift()];
    if(deploy && !(tableBits===14 && degree===2)) throw Error('deployment uses the 16384-cell quadratic');
    const receipt=JSON.parse(read('10-fit.json'));
    const B=2**tableBits;
    const summary=receipt.stdout.split('\n').find(s=>s.startsWith('summary B='+B+' deg='+degree+' '));
    if(!summary?.includes('impossible=0 outside=0')) throw Error('no feasible table for '+B+' cells: '+summary);
    for(const line of receipt.stdout.split('\n')) {
      const fields=line.split(' ');
      if(fields[0]==='fix' && Number(fields[1])===B && Number(fields[2])===degree)
        corrections.set(Number(fields[3])*(N/B),Number(fields[4]));
    }
  }
  const view=new DataView(new ArrayBuffer(8));
  const entries=Array.from({length:mode==='fit'?N:2**tableBits},(_,i)=>{
    const t=mode==='fit'?i:i*(N/2**tableBits);
    view.setFloat64(0,2**(t/N));
    return '0x'+(view.getBigUint64(0)+BigInt(corrections.get(t)??0)).toString(16)+'ull';
  });
  const powers='__device__ const unsigned long long powerBits['+entries.length+']={'+entries.join(',')+'};\n';
  writeFileSync(join(dir,'power.cuh'),powers);
  let body=read('04-exp.cuh').replace('1024/B',entries.length+'/B');
  if(mode==='fit') body=body.replace('shortExp(float x)','shortExp(float x,int adjustment)')
    .replace(']+(static_cast<unsigned long long>(j)',']+static_cast<unsigned long long>(adjustment)+(static_cast<unsigned long long>(j)');
  writeFileSync(join(dir,'exp.cuh'),body);
  if(mode==='fit') writeFileSync(join(dir,'main.cu'),read('10-calibrate.cu'));
  else {
    const src=cudaSource(compileTix(readFileSync('corpus/tensor/softmax/main.tix','utf8')),'softmax');
    const harness=read('05-kernels.cu').replace(/struct Cubic \{[\s\S]*?struct NativeExp/, 
      'struct Cubic { __device__ __noinline__ static float eval(float x) { return shortExp<'+tableBits+','+degree+'>(x); } };\nusing Quartic=Cubic;\nstruct NativeExp');
    writeFileSync(join(dir,'main.cu'),src.slice(0,src.indexOf('static void run_case('))+
      '\n#include "power.cuh"\n#include "exp.cuh"\n#define TIX_KERNELS_ONLY\n'+read('02-kernels.cu')+(deploy?read('11-deploy.cu'):harness));
  }
  const out=JSON.parse(execFileSync('node',['tools/cuda-remote.mjs',dir,...(mode==='bench'?['--timed']:[]),'--',...(mode==='fit'?[]:[mode]),...args],{encoding:'utf8'}));
  console.log(JSON.stringify({...out,tableSha256:createHash('sha256').update(powers).digest('hex')}));
} finally { rmSync(dir,{recursive:true,force:true}); }
