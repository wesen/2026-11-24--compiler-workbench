// Sample clocks during an independent reproduction of the 4096^3 runs on resident zero inputs.
// Captures before, during, and after the warmup/three measured launches under the GPU lock.
import { readFileSync,writeFileSync,mkdtempSync,rmSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { compileTix,cudaSource } from '../../../../../../dist/tensor/index.js';
const p=compileTix(readFileSync('corpus/tensor/matmul/main.tix','utf8'));
for (const fuse of [true,false]) {
  let code=cudaSource(p,'matmul',{fuse});
  code = '#include <sys/wait.h>\n#include <unistd.h>\n#include <signal.h>\n'+code.slice(0,code.indexOf('int main(int argc'));
  code=code.replace('Event start, stop;',`Event start, stop;
    const pid_t monitor = fork();
    if (!monitor) {
      freopen("out/clock.csv","w",stdout);
      execlp("stdbuf","stdbuf","-oL","nvidia-smi","--query-gpu=timestamp,clocks.current.sm,temperature.gpu","--format=csv,noheader,nounits","-lms","10",(char*)nullptr);
      _exit(127);
    }
    usleep(120000);`).replace('return ms[repeats / 2];',`kill(monitor,SIGTERM); waitpid(monitor,nullptr,0);
    printf("median %.6f ms\\n",ms[repeats / 2]); return ms[repeats / 2];`);
  code+=`int main() {
    FILE *input=tmpfile(), *output=tmpfile();
    const I dims[]={4096,4096};
    std::vector<float> v(4096*4096);
    for(int i=0;i<2;++i) { write(input,dims,2); write(input,v.data(),v.size()); }
    rewind(input); run_case(input,output,true);
    fclose(input); fclose(output);
  }`;
  const dir=mkdtempSync(join(dirname(fileURLToPath(import.meta.url)),'07-job-'));
  try {
    writeFileSync(join(dir,'main.cu'),code);
    const meta=JSON.parse(execFileSync(process.execPath,['tools/cuda-remote.mjs',dir,'--timed'],{encoding:'utf8'}));
    console.log(JSON.stringify({fuse,time:meta.stdout.trim(),samples:readFileSync(join(dir,'out/clock.csv'),'utf8').trim().split('\n')}));
  } finally { rmSync(dir,{recursive:true,force:true}); }
}
