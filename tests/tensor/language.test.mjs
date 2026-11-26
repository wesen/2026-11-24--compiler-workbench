import assert from 'node:assert/strict';
import test from 'node:test';
import { compileTix, runTix } from '../../dist/tensor/index.js';
import { openIR } from '../../dist/framework/ir/index.js';
import { tensorAdapter } from '../../dist/tensor/ir.js';

const tensor = (shape, values) => ({ shape, data: Float64Array.from(values) });

test('the compiled program is a v6 artifact with tensor definitions and dependencies', () => {
  const program = compileTix(`
    // First function in a reusable program.
    fn write(x: f32[M, N]): f32[M, N] {
      z[i,j] = x[i,j] - 2 * 3 + -1.5e+1 / 3;
      return z;
    }
    fn read(input: f32[2]): f32[2] { return input; }
  `);
  const graph = openIR(program.artifact, tensorAdapter).graph();
  assert.equal(program.artifact.kind, 'tensor.tix');
  assert.ok(Object.isFrozen(program.artifact.value.functions[0]));
  assert.deepEqual(graph.roots, ['fn:write', 'fn:read']);
  assert.ok(
    graph.relations.some(
      edge => edge.kind === 'use' && edge.from === 'tensor:write:x' && edge.to === 'tensor:write:z',
    ),
  );
  assert.deepEqual(runTix(program, 'write', { x: tensor([2, 3], [0, 1, 2, 3, 4, 5]) }), {
    shape: [2, 3],
    data: new Float32Array([-11, -10, -9, -8, -7, -6]),
  });
  assert.deepEqual(runTix(program, 'read', { input: tensor([2], [75, 80]) }), {
    shape: [2],
    data: new Float32Array([75, 80]),
  });
});

test('reduction bodies reach rightward, and reductions visit indices in lexical list order', () => {
  const program = compileTix(`
    fn inside(x: f32[1,D]): f32[1] {
      a[i] = sum(d) x[i,d] / D;
      return a;
    }
    fn outside(x: f32[1,D]): f32[1] {
      a[i] = (sum(d) x[i,d]) / D;
      return a;
    }
    fn order(x: f32[1,2,2]): f32[1] {
      a[i] = sum(row,col) x[i,row,col];
      return a;
    }
  `);
  const x = tensor([1, 3], [16777216, 1, -16777216]);
  const round = Math.fround;
  const inside = Array.from(x.data).reduce((a, b) => round(a + round(b / 3)), 0);
  assert.notEqual(inside, 0);
  assert.equal(runTix(program, 'inside', { x }).data[0], inside);
  assert.equal(runTix(program, 'outside', { x }).data[0], 0);
  assert.equal(runTix(program, 'order', { x: tensor([1, 2, 2], [1e10, 1, -1e10, 1]) }).data[0], 1);
});

test('max calls and reductions disambiguate, binders can shadow, and empty reductions have identities', () => {
  const program = compileTix(`
    fn functions(x: f32[A,B]): f32[A] {
      a[i] = (max(j) x[i,j]) + max(A,B) - min(A,B);
      return a;
    }
    fn nested(x: f32[1,2,3]): f32[1] {
      a[i] = (max(j,k) -x[i,j,k]) + (sum(k) x[i,0,k] + (sum(k) x[i,1,k]));
      return a;
    }
    fn empty(x: f32[1,0]): f32[2] {
      s[i] = sum(j) x[i,j];
      m[i] = max(j) x[i,j];
      out[i]: f32[2] = s[0] + m[0];
      return out;
    }
  `);
  assert.deepEqual(
    [...runTix(program, 'functions', { x: tensor([2, 3], [4, 8, 0, -12, -3, -9]) }).data],
    [9, -2],
  );
  assert.deepEqual([...runTix(program, 'nested', { x: tensor([1, 2, 3], [1, 2, 3, 4, 5, 6]) }).data], [50]);
  assert.deepEqual([...runTix(program, 'empty', { x: tensor([1, 0], []) }).data], [-Infinity, -Infinity]);
  const sum = compileTix('fn empty(x: f32[1,0]): f32[1] { s[i] = sum(j) x[i,j]; return s; }');
  assert.ok(Object.is(runTix(sum, 'empty', { x: tensor([1, 0], []) }).data[0], 0));
});

test('affine anchors, mixed dimensions and affine-only output indices', () => {
  const program = compileTix(`
    fn reversed(x: f32[H-2], meta: f32[H+W], extra: f32[W+1]): f32[H-2] {
      y[i] : f32[H-2] = x[1+i-1] + extra[0] + (H - W);
      return y;
    }
    fn affine(x: f32[5]): f32[3] {
      y[i] : f32[3] = x[4-2*i];
      return y;
    }
  `);
  const inputs = {
    x: tensor([3], [6, 7, 8]),
    meta: tensor([8], Array(8).fill(0)),
    extra: tensor([4], [1, 2, 3, 4]),
  };
  assert.deepEqual([...runTix(program, 'reversed', inputs).data], [9, 10, 11]);
  assert.deepEqual([...runTix(program, 'affine', { x: tensor([5], [1, 2, 3, 4, 5]) }).data], [5, 3, 1]);
  assert.throws(
    () => runTix(program, 'reversed', { ...inputs, meta: tensor([7], Array(7).fill(0)) }),
    /inconsistent shape/,
  );
});

test('f32 rounds all scalar operations and shape values, and f64 reads row-major doubles', () => {
  const program = compileTix(`
    fn rounding(x: f32[2], empty: f32[D,0]): f32[2] {
      a[i] = x[i] + 1 - x[i] + (D - 16777216);
      return a;
    }
    fn sign(x: f32[2]): f32[2] {
      a[i] = min(-0, x[i]);
      return a;
    }
  `);
  const input = { x: tensor([2], [16777216, -16777216]), empty: tensor([16777217, 0], []) };
  assert.deepEqual(runTix(program, 'rounding', input).data, new Float32Array([0, 1]));
  assert.deepEqual(runTix(program, 'rounding', input, { precision: 'f64' }).data, new Float64Array([2, 2]));
  const result = runTix(program, 'sign', { x: tensor([2], [0, -0]) });
  assert.deepEqual([...new Uint32Array(result.data.buffer)], [0x80000000, 0x80000000]);
});

test('syntax and static shape errors include their source location', () => {
  const examples = [
    ['a[i] = x[i] + .5; return a;', /unexpected character/],
    ['a[i] = x[i] + 0x10; return a;', /expected/],
    ['a[i] = x[i] + 1_0; return a;', /expected/],
    ['a[i] = x[i] + 1e400; return a;', /finite number/],
    ['a[i] = x[i]; a[i] = x[i]; return a;', /already defined/],
    ['a[i] = x[j]; return a;', /unbound index/],
    ['a[i] = x[i+j-j]; return a;', /unbound index/],
    ['a[i] = x[0]; return a;', /cannot infer extent/],
    ['a[i] = x[i] + (sum(j) x[i]); return a;', /cannot infer extent/],
    ['a[i]: f32[2] = x[i]; return a;', /inconsistent extents/],
    ['a[i] = x[i,0]; return a;', /rank mismatch/],
    ['a[i]: f32[3] = x[i+1]; return a;', /establish bounds/],
    ['a[i] = x[i] + W; return a;', /unbound shape/],
    ['a[i] = x[i]; return missing;', /unknown tensor/],
  ];
  for (const [body, reason] of examples)
    assert.throws(
      () => compileTix(`fn f(x: f32[3]): f32[3] {\n  ${body}\n}`),
      error => /^2:\d+: /.test(error.message) && reason.test(error.message),
      body,
    );
  assert.throws(() => compileTix('fn f(x: f32[A+B]): f32[A+B] { return x; }'), /1:\d+:.*single-name/);
  assert.throws(() => compileTix('fn f(x: f32[3]): f32[4] { return x; }'), /1:\d+:.*declared type/);
  assert.throws(() => compileTix(''), /1:1:/);
});
