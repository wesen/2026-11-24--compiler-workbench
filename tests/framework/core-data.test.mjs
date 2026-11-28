import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonical, fingerprint, sha256 } from '../../dist/framework/core/index.js';

test('portable SHA-256 agrees with the platform for ASCII, Unicode and multi-block data', () => {
  for (const text of ['', 'abc', 'a'.repeat(1000), 'constraints ∂ and 模型'])
    assert.equal(sha256(text), createHash('sha256').update(text).digest('hex'));
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }));
  assert.throws(() => canonical({ a: undefined }), /undefined/);
  assert.throws(() => canonical({ x: NaN }), /finite/);
  assert.throws(() => canonical(() => 1), /function/);
  const cycle = {};
  cycle.a = cycle;
  assert.throws(() => canonical(cycle), /cycles/);
  assert.throws(() => canonical(new Map()), /plain/);
});

test('canonical arrays reject accessors, symbol keys, and sparse arrays with spoofed key counts', () => {
  let reads = 0;
  const accessor = [];
  Object.defineProperty(accessor, '0', {
    enumerable: true,
    configurable: true,
    get() {
      reads++;
      return 1;
    },
  });
  assert.throws(() => canonical(accessor), /accessor|plain|data/i);
  assert.equal(reads, 0);
  const sparse = new Array(1);
  sparse.extra = 'not an element';
  assert.throws(() => canonical(sparse), /sparse|properties|array/i);
  const symbol = [1];
  symbol[Symbol('extra')] = 2;
  assert.throws(() => canonical(symbol), /symbol|properties|array/i);
});
