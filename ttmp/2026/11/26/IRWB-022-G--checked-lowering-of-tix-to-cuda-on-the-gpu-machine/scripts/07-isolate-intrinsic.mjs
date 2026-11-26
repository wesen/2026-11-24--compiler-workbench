// From worktree root after build. One untimed CUDA job, neither edits nor installs a backend.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const load = p => import(pathToFileURL(resolve('dist', p)));
const { compileTix, cudaSource, optimizeTix, runTix } = await load('tensor/index.js');
const { encodeBatch, decodeBatch } = await load('tensor/cuda-run.js');
const { cudaRuntime } = await load('tensor/cuda-runtime.js');
const { seededRandom } = await load('framework/contracts/index.js');
const { value } = await load('tensor/model.js');
const dir = mkdtempSync(join(tmpdir(), 'tix-attribution-'));
const units = [cudaRuntime], calls = [], comparisons = [];
try {
  for (const [fn, op, dims] of [['softmax','exp',{N:9,C:19}], ['attention','exp',{Q:9,K:19,D:7,V:13}],
    ['mlp','tanh',{N:13,D:7,H:19,O:11}], ['loggrid','log',{N:16385}]]) {
    const p = compileTix(fn === 'loggrid' ? 'fn loggrid(x:f32[N]):f32[N]{y[i]=log(x[i]);return y;}' :
      readFileSync(`corpus/tensor/${fn}/main.tix`, 'utf8'));
    const f = p.current.value.functions[0], rng = seededRandom(22), env = new Map(Object.entries(dims));
    const inputs = Object.fromEntries(f.params.map(t => {
      const shape=t.shape.map(d=>value(d,env));
      const data=Float32Array.from({length:shape.reduce((a,b)=>a*b)},(_,i)=>fn==='loggrid' ? 1+i/1024 : 4*rng()-2);
      return [t.name,{shape,data}];
    }));
    const {bytes,expected} = encodeBatch(f,[{id:0,inputs}]);
    writeFileSync(join(dir,fn+'.bin'),bytes);
    for (const opt of (fn === 'loggrid' ? [false] : [false,true])) {
      const program = opt ? optimizeTix(p,['inline','split-sum']).program : p;
      const source = cudaSource(program,fn);
      assert.ok(source.startsWith(cudaRuntime));
      const ref = runTix(program,fn,inputs).data;
      for(const wide of [false,true]) {
        const tag = fn+(opt?'_opt':'')+(wide?'_wide':'_stock');
        let body = source.slice(cudaRuntime.length).replace('int main(', 'int invoke(')
          .replace('"in.bin"',`"${fn}.bin"`).replace('"out/result.bin"',`"out/${tag}.bin"`);
        if(wide) {
          const call = new RegExp(`\\b${op}f\\((v\\d+)\\)`, 'g');
          assert.ok(body.match(call)); // The sole numerical intervention: change this libcall only.
          body = body.replace(call,`__double2float_rn(${op}((double)$1))`);
        }
        units.push(`namespace ${tag} {\n${body}\n}`);
        calls.push(`if (${tag}::invoke(argc,argv)) return 1;`);
        comparisons.push(()=>{
          const [{data}] = decodeBatch(readFileSync(join(dir,'out',tag+'.bin')),expected);
          const words=a=>new Uint32Array(a.buffer,a.byteOffset,a.length), a=words(ref), b=words(data);
          const n = b.reduce((count,word,i)=>count+Number(word!==a[i]),0);
          console.log(tag, n, 'different words /', a.length);
          assert.ok(wide ? n === 0 : n > 0, tag);
        });
      }
    }
  }
  units.push(`int main(int argc,char **argv){${calls.join('\n')}return 0;}`);
  writeFileSync(join(dir,'main.cu'),units.join('\n'));
  const job = JSON.parse(execFileSync(process.execPath,['tools/cuda-remote.mjs',dir],{encoding:'utf8'}));
  console.log(job.host,job.hash,job.exit);
  assert.equal(job.exit,0);
  comparisons.forEach(run=>run());
} finally { rmSync(dir,{force:true,recursive:true}); }
