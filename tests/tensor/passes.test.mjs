import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../dist/tensor/index.js';
import { checkMeaning, samples } from '../../dist/tensor/contract.js';
import { inline, splitSum, runSteps } from '../../dist/tensor/passes.js';
import { applyNativePassSync } from '../../dist/framework/passes/index.js';
import { seededRandom } from '../../dist/framework/contracts/index.js';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';

const sum='fn f(x:f32[M,K]):f32[M]{y[i]=sum(k) x[i,k]; return y;}';
const tmp='fn g(x:f32[N]):f32[N]{t[i]=-x[i];y[i]=t[i]+1;return y;}';
const step=(pass,relation)=>({name:pass.id,pass,relation});
const shapeData=(shape,data)=>({shape,data:Float32Array.from(data)});
const words=data=>[...new Uint32Array(data.buffer,data.byteOffset,data.length)];
const motif=shapeData([1,8],[1,0,0,0,2**-24,2**-24,0,0]);

test('fixed synchronous API, two-level IR and both verdicts on the same changed candidate',()=>{
  assert.deepEqual(Object.keys(api).sort(),['compileTix','optimizeTix','runTix']);
  const p=compileTix(sum), optimized=optimizeTix(p,['split-sum']);
  assert.deepEqual(optimized.steps,[{pass:'split-sum',accepted:true}]);
  const after=optimized.program.current, {body}=after.value.functions[0].definitions[0];
  assert.equal(body.axes[0].kind,'blocks');
  assert.equal(body.body.axes[0].outer,body.axes[0].id);
  const exact=checkMeaning('exact',p.origin,p.current,after);
  assert.equal(exact.ok,false);
  assert.match(exact.reason,/3f800000 vs 0x3f800001/);
  assert.equal(checkMeaning('tolerance',p.origin,p.current,after).ok,true);
  assert.deepEqual(words(runTix(p,'f',{x:motif}).data),[0x3f800000]);
  assert.deepEqual(words(runTix(optimized.program,'f',{x:motif}).data),[0x3f800001]);
  assert.equal(runSteps(p,[step(splitSum,'exact')]).program,p);
  assert.equal(optimizeTix(optimized.program,['split-sum']).program,optimized.program);
});

test('inline substitutes affine tuples simultaneously under a reduction, preserves multi-use and return uses',()=>{
  const src='fn f(x:f32[M,N]):f32[N]{t[i,j]=-x[i,j]; y[i]=sum(j) t[j,i]; return y;}';
  const p=compileTix(src),q=optimizeTix(p,['inline']);
  assert.equal(q.steps[0].accepted,true);
  assert.deepEqual(q.program.current.value.functions[0].definitions.map(d=>d.name),['y']);
  assert.deepEqual([...runTix(q.program,'f',{x:shapeData([2,3],[1,2,3,4,5,6])}).data],[-5,-7,-9]);
  const affine=compileTix('fn f(x:f32[N]):f32[N-2]{a[i]:f32[N-1]=x[i+1]; b[i]:f32[N-2]=a[i+1]; return b;}');
  assert.deepEqual([...runTix(optimizeTix(affine,['inline']).program,'f',{x:shapeData([4],[2,4,6,8])}).data],[6,8]);
  for(const use of ['return t;', 'return y;']){
    const uses=use==='return t;'?'y[i]=t[i]+1;':'y[i]=t[i]+t[i];';
    const r=compileTix('fn f(x:f32[N]):f32[N]{t[i]=-x[i];'+uses+use+'}');
    assert.equal(optimizeTix(r,['inline']).program,r);
  }
});

test('wrong native kernels are rejected by meaning, including a mismatch in a second callable function',()=>{
  const p=compileTix(sum+tmp);
  const wrongInline={...inline,run(ctx){
    const change=inline.run(ctx), f=change.native.functions[1], [d]=f.definitions;
    assert.equal(d.body.left.kind,'neg');
    return {...change,native:{functions:[change.native.functions[0],{...f,definitions:[{...d,body:{...d.body,left:d.body.left.arg}}]}]}};
  }};
  assert.throws(()=>applyNativePassSync(wrongInline,p.current,(b,c)=>checkMeaning('exact',p.origin,b,c)),
    e=>e.code==='contractRejected'&&e.evidence.counterexamples[0].case.fn==='g');
  const attempt=runSteps(p,[step(wrongInline,'exact'),step(inline,'exact')]);
  assert.deepEqual(attempt.steps.map(s=>s.accepted),[false,true]);
  assert.equal(attempt.program.current.revision,optimizeTix(p,['inline']).program.current.revision);

  const tail=compileTix('fn f(x:f32[M,9]):f32[M]{y[i]=sum(k) x[i,k]; return y;}');
  const dropTail={...splitSum,run(ctx){
    const change=splitSum.run(ctx), native=structuredClone(change.native);
    const fold=native.functions[0].definitions[0].body;
    for(const r of [fold.axes[0],fold.body.axes[0]]) r.extent={constant:8,terms:[]};
    return {...change,native};
  }};
  assert.throws(()=>applyNativePassSync(dropTail,tail.current,(b,c)=>checkMeaning('tolerance',tail.origin,b,c)),
    e=>e.code==='contractRejected' && /reference 9, candidate 8/.test(e.evidence.counterexamples[0].reason));
  assert.equal(runSteps(tail,[step(dropTail,'tolerance')]).program,tail);
});

test('a subsequent exact pass checks its immediate input on the same origin-derived cases',()=>{
  const p=compileTix('fn f(x:f32[M,K]):f32[M]{a[i,k]=x[i,k]*1; b[i]=sum(k) a[i,k];return b;}');
  for(const names of [['split-sum','inline'],['inline','split-sum']]){
    const a=optimizeTix(p,names),b=optimizeTix(optimizeTix(p,[names[0]]).program,[names[1]]);
    assert.deepEqual(a.steps.map(s=>s.accepted),[true,true]);
    assert.equal(a.program.current.revision,b.program.current.revision);
    assert.equal(b.program.origin,p.origin);
    assert.deepEqual(words(runTix(b.program,'f',{x:motif}).data),[0x3f800001]);
  }
});

test('origin sampler schedule, signed data, epsilon values and per-function nonempty coverage',()=>{
  const p=compileTix('fn f(x:f32[N,M,D],eps:f32[1]):f32[N,M,D]{return x;}');
  const cases=samples(p.origin.value,seededRandom(20));
  assert.deepEqual(cases.filter(c=>c.fill==='ones').map(c=>c.dims),[[1,1,1],[8,8,8],[9,9,9],[3,5,9]]);
  assert.deepEqual(cases.slice(0,3).map(c=>c.inputs.eps.data[0]),[1,2**-10,2**-5]);
  assert.deepEqual([...cases[4].inputs.x.data.slice(0,8)],[...motif.data]);
  assert.ok(cases[5].inputs.x.data.some(x=>x<0));
  const illegal=compileTix('fn shifted(x:f32[N]):f32[1]{y[i]:f32[1]=x[6];return y;}');
  assert.deepEqual(samples(illegal.origin.value,seededRandom(20)).filter(c=>c.fill==='ones').map(c=>c.dims),[[8],[9]]);
  const missing=compileTix(tmp+'fn empty(x:f32[0]):f32[0]{return x;}');
  assert.equal(optimizeTix(missing,['inline']).steps[0].accepted,false);
  assert.equal(optimizeTix(missing,['split-sum']).steps[0].accepted,true);
});
