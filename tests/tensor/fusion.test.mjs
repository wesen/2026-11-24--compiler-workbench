import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, cudaSource } from '../../dist/tensor/index.js';

const count = source => (source.match(/__global__ void/g) ?? []).length;

test('fusion combines a reduction and its pointwise epilogue', () => {
  const p = compileTix(`fn f(x: f32[N,D]): f32[N] {
    s[i] = sum(k) x[i,k];
    y[i] = s[i] + 1;
    return y;
  }`);
  assert.equal(count(cudaSource(p, 'f', { fuse: false })), 2);
  assert.equal(count(cudaSource(p, 'f')), 1);
});

test('fusion refuses reduction reuse within another reduction', () => {
  const p = compileTix(`fn f(x: f32[N,D]): f32[N] {
    s[i] = sum(k) x[i,k];
    y[i] = sum(k) (x[i,k] + s[i]);
    return y;
  }`);
  assert.equal(count(cudaSource(p, 'f')), 2);
});
