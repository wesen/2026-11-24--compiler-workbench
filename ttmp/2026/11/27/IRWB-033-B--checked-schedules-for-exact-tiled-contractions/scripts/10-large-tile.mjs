// Is the extra input reuse from an 8x8 register patch worth its occupancy cost at 4096?
// These are event intervals on GPU-resident zero operands. Public-API timings use 01 instead.
import { readFileSync,writeFileSync,mkdtempSync,rmSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { scheduleFunction } from '../../../../../../dist/tensor/schedule.js';
import { printSchedule } from '../../../../../../dist/tensor/cuda-source.js';
const fn=compileTix(readFileSync('corpus/tensor/matmul/main.tix','utf8')).current.value.functions[0];
for(let round=0;round<5;round++) for(const registers of [4,8]) {
  const s=structuredClone(scheduleFunction(fn).steps.find(s=>s.pass.id.endsWith('pack-registers')).artifact.value);
  s.groups[0].tiles.y.registers=[registers,registers];
  let code=printSchedule(s);
  code=code.slice(0,code.indexOf('int main(int argc'))+`int main() {
    FILE *input=tmpfile(), *output=tmpfile(); const I dims[]={4096,4096};
    std::vector<float> v(4096*4096);
    for(int i=0;i<2;++i) {write(input,dims,2);write(input,v.data(),v.size());}
    rewind(input);run_case(input,output,true);
    fseek(output,2*sizeof(I)+4096LL*4096*sizeof(float),SEEK_SET); double ms;read(output,&ms,1);
    printf("%f",ms);
  }`;
  const dir=mkdtempSync(join(dirname(fileURLToPath(import.meta.url)),'10-job-'));
  try {
    writeFileSync(join(dir,'main.cu'),code);
    const meta=JSON.parse(execFileSync(process.execPath,['tools/cuda-remote.mjs',dir,'--timed'],{encoding:'utf8'}));
    console.log(JSON.stringify({round,registers,ms:Number(meta.stdout)}));
  } finally {rmSync(dir,{recursive:true,force:true});}
}
