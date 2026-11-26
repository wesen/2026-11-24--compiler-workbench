// Generates the baseline anew from current product code. Source and binaries are not vendored.
import {cudaSource,compileTix} from '../../../../../../dist/tensor/index.js';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const dir=mkdtempSync(join(tmpdir(),'tix-fold-'));
try {
  const generated=cudaSource(compileTix(readFileSync('corpus/tensor/softmax/main.tix','utf8')),'softmax');
  if (!generated.includes('static void run_case(') || !generated.includes('__global__ void k3')) throw Error('unexpected emitter');
  const variant=readFileSync(new URL('02-kernels.cu',import.meta.url),'utf8');
  writeFileSync(join(dir,'main.cu'),generated.slice(0,generated.indexOf('static void run_case('))+variant);
  const args=process.argv.slice(2);
  console.log(execFileSync('node',['tools/cuda-remote.mjs',dir,'--timed','--',...args],{encoding:'utf8'}).trim());
} finally { rmSync(dir,{recursive:true,force:true}); }
