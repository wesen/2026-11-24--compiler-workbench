// Exact GPU differential checks on randomized variants of three distinct load patterns.
import assert from 'node:assert/strict';
import { compileTix, cudaSource, checkLowering } from '../../../../../../dist/tensor/index.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

const random = seededRandom(29);
const forms = [
  (arithmetic, intrinsic) => `fn f(x:f32[N,C], w:f32[C,D]):f32[N,D] {
    a[i,j] = sum(k) x[i,k] * w[k,j];
    b[i,j] = ${intrinsic}(a[i,j]) ${arithmetic} a[i,j];
    y[i,j] = min(a[i,j], b[i,j]);
    return y;
  }`,
  (arithmetic, intrinsic) => `fn f(x:f32[N,C], w:f32[N,C-1]):f32[N,C] {
    a[i,j] = ${intrinsic}(x[i,j]);
    b[i] = sum(k) a[i,k+1] ${arithmetic} w[i,k];
    y[i,j] = max(a[i,j], b[i]);
    return y;
  }`,
  (arithmetic, intrinsic) => `fn f(x:f32[N,N]):f32[N,N] {
    a[i,j] = ${intrinsic}(x[i,j]);
    b[i,j] = a[j,i] ${arithmetic} x[i,j];
    y[i,j] = b[i,j] * b[i,j];
    return y;
  }`,
];
const operators = ['+', '-', '*', '/'];
const intrinsics = ['exp', 'log', 'sqrt', 'tanh'];
const choose = items => items[Math.floor(random() * items.length)];
for (const [family, makeSource] of forms.entries()) {
  for (let trial = 0; trial < intrinsics.length; trial++) {
    const text = makeSource(choose(operators), intrinsics[trial]);
    const p = compileTix(text);
    const kernels = [...cudaSource(p, 'f').matchAll(/^__global__ void /gm)].length;
    assert.equal(kernels, family === 2 ? 2 : 1, text);
    const verdict = await checkLowering(p, 'f');
    assert.deepEqual(verdict, { accepted: true, relation: 'exact' }, text);
    console.log(JSON.stringify({ family, trial, kernels, verdict }));
  }
}
