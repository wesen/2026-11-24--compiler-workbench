import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, runTix } from '../../dist/tensor/index.js';
import { openIR } from '../../dist/framework/ir/index.js';
import { tensorAdapter } from '../../dist/tensor/ir.js';

const input = (shape, values) => ({shape,data:Float64Array.from(values)});
const run = (source,inputs,precision) => runTix(compileTix(source),'f',inputs,{precision});
test('indexed artifact, row-major affine reads and shape values', () => {
  const p=compileTix('fn f(x:f32[H,W],scale:f32[2*H-1]):f32[W,H-1]{ y[j,i]:f32[W,H-1]=x[i+1,j] + H; return y; }');
  const view=openIR(p.current,tensorAdapter);
  assert.equal(p.current.kind,'tensor.indexed');
  assert.equal(view.resolve('f/y').kind,'definition');
  assert.ok(view.graph().relations.some(r=>r.kind==='read'&&r.to==='f/x'));
  const result=runTix(p,'f',{x:input([3,2],[0,1,2,3,4,5]),scale:input([5],Array(5).fill(1))});
  assert.deepEqual(result,{shape:[2,2],data:Float32Array.of(5,7,6,8)});
});

test('operation rounding, precision at input, signed zero, calls and associativity',()=>{
  const src='fn f(x:f32[N]):f32[N]{ y[i]=4097*4097-16785408 + x[i]; return y; }';
  const v={x:input([1],[2**-24])};
  assert.deepEqual(run(src,v).data,Float32Array.of(2**-24));
  assert.deepEqual(run(src,v,'f64').data,Float64Array.of(1+2**-24));
  const scalar='fn f(x:f32[N]):f32[N]{y[i]=-(x[i] - 3 - 1) / 2 / 2;return y;}';
  assert.ok(Object.is(run(scalar,{x:input([1],[4])}).data[0],-0));
  const intrinsic='fn f(x:f32[N]):f32[N]{y[i]=tanh(sqrt(max(min(exp(log(x[i])),4),1)));return y;}';
  assert.equal(run(intrinsic,{x:input([1],[4])}).data[0],Math.fround(Math.tanh(2)));
  const identity='fn f(x:f32[N]):f32[N]{return x;}';
  const fine={x:input([1],[1+2**-40])};
  assert.equal(run(identity,fine).data[0],1);
  assert.equal(run(identity,fine,'f64').data[0],1+2**-40);
});

test('reductions extend to the delimiter, float accumulators and empty identities',()=>{
  const make=rhs=>'fn f(x:f32[M,D]):f32[M]{y[i]='+rhs+';return y;}';
  const v={x:input([1,2],[3e38,3e38])};
  assert.equal(run(make('sum(d) x[i,d] / D'),v).data[0],Math.fround(3e38));
  assert.equal(run(make('(sum(d) x[i,d]) / D'),v).data[0],Infinity);
  assert.equal(run(make('sum(d) x[i,d]'),{x:input([1,0],[])}).data[0],0);
  assert.equal(run(make('max(d) x[i,d]'),{x:input([1,0],[])}).data[0],-Infinity);
  assert.equal(run(make('max(sum(d) x[i,d], 3)'),{x:input([1,2],[-2,1])}).data[0],3);
});

test('both meanings of max, nested lexical binders and lexicographic axis order',()=>{
  const v={x:input([2,2],[1,2**-24,-1,2**-24])};
  const make=rhs=>'fn f(x:f32[A,B]):f32[1]{y[i]:f32[1]='+rhs+';return y;}';
  assert.equal(run(make('sum(a,b) x[a,b]'),v).data[0],2**-24);
  assert.equal(run(make('sum(b,a) x[a,b]'),v).data[0],2**-23);
  assert.equal(run(make('max(A,B) - 1'),v).data[0],1);
  assert.equal(run(make('max(A,B) -x[A,B]'),v).data[0],1);
  assert.equal(run(make('sum(a) (max(a) x[a,0]) + x[a,0]'),v).data[0],2);
});

test('invalid sources identify a token by line and column',()=>{
  const statements=[
    ['y[i] = x[i+0];','infer'], ['y[i] = x[i] + z[i];','unknown tensor'],
    ['y[i] = x[i]; y[i] = x[i];','already defined'], ['y[i] = x[i,i];','indices'],
    ['y[i] = x[j];','unbound index'], ['y[i] = x[i] + x[i+1];','subscript'],
    ['y[i] = x[i] + (sum(j) x[j+1]);','infer'], ['y[i]:f32[N+1] = x[i];','extents'],
    ['y[i] = x[i] + x[i*i];','non-affine'], ['y[i]=x[i] @ 2;','unexpected character'],
  ];
  for(const [statement,why] of statements) assert.throws(()=>compileTix('fn f(x:f32[N]):f32[N]{\n// comment\n '+statement+'\nreturn y;}'),new RegExp('3:\\d+:.*'+why),statement);
  assert.throws(()=>compileTix('fn f(x:f32[N+1]):f32[N]{return x;}'),/1:\d+:.*bare input/);
  assert.throws(()=>compileTix('fn f(x:f32[N],z:f32[M]):f32[N]{y[i]=x[i]+z[i];return y;}'),/1:\d+:.*extents/);
  assert.throws(()=>compileTix('fn f(x:f32[N]):f32[N+1]{return x;}'),/1:\d+:.*return shape/);
  assert.throws(()=>compileTix('fn f(x:f32[N]):f32[N]{\n // comment\n  y[i] = ?; return y;}'),/3:10:/);
});
