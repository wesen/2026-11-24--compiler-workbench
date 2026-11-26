// IRWB-019 stage-1 hidden acceptance suite: the fixed Tix core and API, checked against hand-written JavaScript.
// Usage: TIX_ROOT=<worktree> node --test acceptance.test.mjs
// f32 references follow the brief literally: every literal, shape value, operation and function result is rounded
// with Math.fround; sum starts at 0 and max at -Infinity, accumulating in lexicographic order of the listed indices
// (first outermost), rounding after each step. Exact tests compare bit patterns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = process.env.TIX_ROOT;
if (!root) throw new Error('set TIX_ROOT to the worktree');
const { compileTix, runTix, optimizeTix } = await import(pathToFileURL(join(root, 'dist/tensor/index.js')).href);

const f = Math.fround;
let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;
const tensor = (shape, gen = rnd) => {
  const n = shape.reduce((a, b) => a * b, 1), data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = gen(i);
  return { shape, data };
};
const at = (t, ...ix) => t.data[ix.reduce((o, x, d) => o * t.shape[d] + x, 0)];
const bits = a => Array.from(new Uint32Array(Float32Array.from(a).buffer));
const sameBits = (got, want, label) => {
  assert.deepEqual(got.shape, want.shape, `${label}: shape`);
  const g = bits(got.data), w = bits(want.data);
  const bad = g.findIndex((x, i) => x !== w[i]);
  assert.equal(bad, -1, `${label}: first differing element ${bad}: got ${got.data[bad]}, want ${want.data[bad]}`);
};
const close = (got, want, tol, label) => {
  assert.deepEqual(got.shape, want.shape, `${label}: shape`);
  for (let i = 0; i < want.data.length; i++) {
    const e = Math.abs(got.data[i] - want.data[i]), s = Math.max(1, Math.abs(want.data[i]));
    assert.ok(e <= tol * s, `${label}: element ${i}: got ${got.data[i]}, want ${want.data[i]}`);
  }
};
const out = (shape, fn, r = f) => {
  const n = shape.reduce((a, b) => a * b, 1), data = new Float64Array(n);
  const idx = new Array(shape.length).fill(0);
  for (let i = 0; i < n; i++) {
    data[i] = fn(...idx);
    for (let d = shape.length - 1; d >= 0 && ++idx[d] === shape[d]; d--) idx[d] = 0;
  }
  return { shape, data: r === f ? Float32Array.from(data) : data };
};
// one precision's arithmetic: r rounds (Math.fround for f32, identity for f64)
const ops = r => ({
  r,
  add: (a, b) => r(a + b), sub: (a, b) => r(a - b), mul: (a, b) => r(a * b), div: (a, b) => r(a / b),
  exp: a => r(Math.exp(a)), sqrt: a => r(Math.sqrt(a)), tanh: a => r(Math.tanh(a)),
  sum: (n, body) => { let acc = 0; for (let k = 0; k < n; k++) acc = r(acc + body(k)); return acc; },
  max: (n, body) => { let acc = -Infinity; for (let k = 0; k < n; k++) acc = r(Math.max(acc, body(k))); return acc; },
});
const F32 = ops(f), F64 = ops(x => x);

const SRC = {
  matmul: `fn matmul(a: f32[M, K], b: f32[K, N]): f32[M, N] {
  c[i, j] = sum(k) a[i, k] * b[k, j];
  return c;
}`,
  softmax: `fn softmax(x: f32[N, C]): f32[N, C] {
  m[i] = max(j) x[i, j];
  e[i, j] = exp(x[i, j] - m[i]);
  s[i] = sum(j) e[i, j];
  y[i, j] = e[i, j] / s[i];
  return y;
}`,
  layernorm: `fn layernorm(x: f32[N, D], g: f32[D], b: f32[D]): f32[N, D] {
  mu[i] = sum(d) x[i, d] / D;
  xc[i, d] = x[i, d] - mu[i];
  vr[i] = sum(d) xc[i, d] * xc[i, d] / D;
  y[i, d] = xc[i, d] / sqrt(vr[i] + 0.00001) * g[d] + b[d];
  return y;
}`,
  attention: `fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
  m[i] = max(j) s[i, j];
  e[i, j] = exp(s[i, j] - m[i]);
  l[i] = sum(j) e[i, j];
  o[i, x] = sum(j) e[i, j] * v[j, x] / l[i];
  return o;
}`,
  mlp: `// two contractions with biases and tanh-GELU between them
fn mlp(x: f32[N, D], w1: f32[D, F], b1: f32[F], w2: f32[F, D], b2: f32[D]): f32[N, D] {
  h[i, f] = (sum(d) x[i, d] * w1[d, f]) + b1[f];
  g[i, f] = 0.5 * h[i, f] * (1 + tanh(0.7978845608 * (h[i, f] + 0.044715 * h[i, f] * h[i, f] * h[i, f])));
  y[i, x] = (sum(f) g[i, f] * w2[f, x]) + b2[x];
  return y;
}`,
  conv: `fn conv(a: f32[N, C, H, W], w: f32[K, C, R, R]): f32[N, K, H - R + 1, W - R + 1] {
  o[n, k, y, x]: f32[N, K, H - R + 1, W - R + 1] = sum(c, dy, dx) a[n, c, y + dy, x + dx] * w[k, c, dy, dx];
  return o;
}`,
};

// the references, one per program, in both precisions
const REF = {
  matmul: (P, a, b) => out([a.shape[0], b.shape[1]], (i, j) => P.sum(a.shape[1], k => P.mul(at(a, i, k), at(b, k, j))), P.r),
  softmax: (P, x) => {
    const [N, C] = x.shape;
    const m = i => P.max(C, j => at(x, i, j)), e = (i, j, mi) => P.exp(P.sub(at(x, i, j), mi));
    return out([N, C], (i, j) => { const mi = m(i); return P.div(e(i, j, mi), P.sum(C, jj => e(i, jj, mi))); }, P.r);
  },
  layernorm: (P, x, g, b) => {
    const [N, D] = x.shape, Dv = P.r(D), eps = P.r(0.00001);
    const mu = i => P.sum(D, d => P.div(at(x, i, d), Dv));
    const vr = (i, m) => P.sum(D, d => { const c = P.sub(at(x, i, d), m); return P.div(P.mul(c, c), Dv); });
    return out([N, D], (i, d) => {
      const m = mu(i), c = P.sub(at(x, i, d), m);
      return P.add(P.mul(P.div(c, P.sqrt(P.add(vr(i, m), eps))), at(g, d)), at(b, d));
    }, P.r);
  },
  attention: (P, q, k, v) => {
    const [N, D] = q.shape, sq = P.sqrt(P.r(D));
    const s = (i, j) => P.sum(D, d => P.div(P.mul(at(q, i, d), at(k, j, d)), sq));
    return out([N, D], (i, x) => {
      const si = Array.from({ length: N }, (_, j) => s(i, j)), m = P.max(N, j => si[j]);
      const e = si.map(t => P.exp(P.sub(t, m))), l = P.sum(N, j => e[j]);
      return P.sum(N, j => P.div(P.mul(e[j], at(v, j, x)), l));
    }, P.r);
  },
  mlp: (P, x, w1, b1, w2, b2) => {
    const [N, D] = x.shape, F = w1.shape[1];
    const c05 = P.r(0.5), c1 = P.r(1), cA = P.r(0.7978845608), cB = P.r(0.044715);
    const h = (i, ff) => P.add(P.sum(D, d => P.mul(at(x, i, d), at(w1, d, ff))), at(b1, ff));
    const gelu = t => P.mul(P.mul(c05, t), P.add(c1, P.tanh(P.mul(cA, P.add(t, P.mul(P.mul(P.mul(cB, t), t), t))))));
    return out([N, D], (i, xx) => {
      const g = Array.from({ length: F }, (_, ff) => gelu(h(i, ff)));
      return P.add(P.sum(F, ff => P.mul(g[ff], at(w2, ff, xx))), at(b2, xx));
    }, P.r);
  },
};
// conv: one accumulator over (c, dy, dx), lexicographic
REF.conv = (P, a, w) => {
  const [N, C, H, W] = a.shape, [K, , R] = w.shape;
  return out([N, K, H - R + 1, W - R + 1], (n, k, y, x) => {
    let acc = 0;
    for (let c = 0; c < C; c++) for (let dy = 0; dy < R; dy++) for (let dx = 0; dx < R; dx++)
      acc = P.r(acc + P.mul(at(a, n, c, y + dy, x + dx), at(w, k, c, dy, dx)));
    return acc;
  }, P.r);
};

const CASES = {
  matmul: () => [tensor([5, 33]), tensor([33, 7])],
  softmax: () => [tensor([4, 19], () => rnd() * 6)],
  layernorm: () => [tensor([3, 24], () => rnd() * 3 + 0.5), tensor([24]), tensor([24])],
  attention: () => [tensor([9, 8]), tensor([9, 8]), tensor([9, 8])],
  mlp: () => [tensor([3, 8]), tensor([8, 12]), tensor([12]), tensor([12, 8]), tensor([8])],
  conv: () => [tensor([2, 3, 7, 6]), tensor([4, 3, 3, 3])],
};
const PARAMS = {
  matmul: ['a', 'b'], softmax: ['x'], layernorm: ['x', 'g', 'b'], attention: ['q', 'k', 'v'],
  mlp: ['x', 'w1', 'b1', 'w2', 'b2'], conv: ['a', 'w'],
};
const named = (name, ts) => Object.fromEntries(PARAMS[name].map((p, i) => [p, ts[i]]));

for (const name of Object.keys(SRC)) {
  test(`f32 meaning, bit-exact: ${name}`, () => {
    const ts = CASES[name]();
    sameBits(runTix(compileTix(SRC[name]), name, named(name, ts)), REF[name](F32, ...ts), name);
  });
  test(`f64 precision against an f64 reference: ${name}`, () => {
    const ts = CASES[name]();
    close(runTix(compileTix(SRC[name]), name, named(name, ts), { precision: 'f64' }), REF[name](F64, ...ts), 1e-12, name);
  });
}

test('a reduction body extends to the end of the statement; parentheses end it', () => {
  const p = compileTix(`fn a(x: f32[N, C]): f32[N] {
  y[i] = sum(j) x[i, j] / C;
  return y;
}
fn b(x: f32[N, C]): f32[N] {
  y[i] = (sum(j) x[i, j]) / C;
  return y;
}`);
  const x = tensor([3, 11], () => rnd() * 1e3), C = f(11);
  sameBits(runTix(p, 'a', { x }), out([3], i => F32.sum(11, j => F32.div(at(x, i, j), C))), 'body extends');
  sameBits(runTix(p, 'b', { x }), out([3], i => F32.div(F32.sum(11, j => at(x, i, j)), C)), 'parenthesized');
});

test('unary minus, precedence and left associativity; max(a, b) as a call (relu)', () => {
  const p = compileTix(`fn g(x: f32[N]): f32[N] {
  y[i] = -x[i] * 2 - 3 / x[i] - 1;
  z[i] = max(y[i], 0);
  return z;
}`);
  const x = tensor([17], () => rnd() * 4 + 0.25);
  const want = out([17], i => {
    const xi = at(x, i), y = F32.sub(F32.sub(F32.mul(-xi, f(2)), F32.div(f(3), xi)), f(1));
    return f(Math.max(y, 0));
  });
  sameBits(runTix(p, 'g', { x }), want, 'expression');
});

test('log and min calls', () => {
  const p = compileTix(`fn h(x: f32[N]): f32[N] {
  y[i] = min(log(x[i]), 0.5) - 1;
  return y;
}`);
  const x = tensor([13], () => rnd() * 2 + 2.5);
  sameBits(runTix(p, 'h', { x }), out([13], i => F32.sub(f(Math.min(f(Math.log(at(x, i))), f(0.5))), f(1))), 'log/min');
});

test('a two-index reduction accumulates lexicographically, first index outermost', () => {
  const p = compileTix(`fn t(x: f32[A, B], w: f32[Q]): f32[Q] {
  y[q] = sum(i, j) x[i, j] * w[q];
  return y;
}`);
  // magnitudes chosen so that the order of accumulation changes the f32 result; w is exact (+-1, 0.5)
  const x = tensor([6, 5], i => (i % 3 === 0 ? 1e7 : 0.37) * (i % 2 ? -1 : 1));
  const w = tensor([3], i => [1, -1, 0.5][i]);
  const want = out([3], q => {
    let acc = 0;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) acc = f(acc + f(at(x, i, j) * at(w, q)));
    return acc;
  });
  const colMajor = out([3], q => {
    let acc = 0;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) acc = f(acc + f(at(x, i, j) * at(w, q)));
    return acc;
  });
  assert.notDeepEqual(bits(want.data), bits(colMajor.data), 'the test data must distinguish the two orders');
  sameBits(runTix(p, 't', { x, w }), want, 'lexicographic');
});

test('several functions in one program; each is run by name', () => {
  const p = compileTix(SRC.matmul + '\n' + SRC.softmax);
  const x = tensor([2, 5]);
  sameBits(runTix(p, 'softmax', { x }), REF.softmax(F32, x), 'second function');
});

for (const [label, src] of Object.entries({
  'an undefined tensor': `fn u(x: f32[N]): f32[N] {
  y[i] = z[i] + x[i];
  return y;
}`,
  'a tensor assigned twice': `fn u(x: f32[N]): f32[N] {
  y[i] = x[i];
  y[i] = x[i] * 2;
  return y;
}`,
  'an extent that cannot be inferred': `fn u(x: f32[N]): f32[N] {
  y[i, j] = x[i] * 2;
  return y;
}`,
  'a syntax error': `fn u(x: f32[N]): f32[N] {
  y[i] = x[i] * ;
  return y;
}`,
}))
  test(`compile error with line:col: ${label}`, () => {
    assert.throws(() => compileTix(src), e => /\d+:\d+/.test(String(e?.message)), label);
  });

const INLINE = {
  chain: `fn chain(x: f32[N, C]): f32[N] {
  t[i, j] = x[i, j] * 2 + 1;
  u[i, j] = exp(t[i, j] / 4);
  s[i] = sum(j) u[i, j];
  return s;
}`,
  transpose: `fn transpose(x: f32[N, C]): f32[C, N] {
  t[i, j] = x[i, j] * 3 - 1;
  y[a, b] = t[b, a] / 7;
  return y;
}`,
};
test('optimizeTix inline where it applies (pointwise, single use; a transposed read): accepted, bit-identical', () => {
  for (const [name, src] of Object.entries(INLINE)) {
    const p = compileTix(src), x = tensor([5, 9], () => rnd() * 3);
    const r = optimizeTix(p, ['inline']);
    assert.ok(r.steps.length >= 1 && r.steps.every(s => s.pass === 'inline' && s.accepted === true), `${name}: ${JSON.stringify(r.steps)}`);
    sameBits(runTix(r.program, name, { x }), runTix(p, name, { x }), `${name} after inline`);
  }
});

test('optimizeTix inline on the corpus programs: accepted, and bit-identical f32 results', () => {
  for (const name of ['softmax', 'mlp', 'layernorm']) {
    const p = compileTix(SRC[name]), ts = CASES[name]();
    const r = optimizeTix(p, ['inline']);
    assert.ok(r.steps.length >= 1 && r.steps.every(s => s.pass === 'inline' && s.accepted === true), `${name}: ${JSON.stringify(r.steps)}`);
    sameBits(runTix(r.program, name, named(name, ts)), runTix(p, name, named(name, ts)), `${name} after inline`);
  }
});

test('optimizeTix split-sum: accepted, and within tolerance of the f64 reference', () => {
  const p = compileTix(SRC.matmul), r = optimizeTix(p, ['split-sum']);
  assert.ok(r.steps.length >= 1 && r.steps.every(s => s.pass === 'split-sum' && s.accepted === true), JSON.stringify(r.steps));
  for (const K of [256, 257, 7, 1]) {   // 257 and 7 leave a ragged last block for any block size > 1
    const a = tensor([4, K]), b = tensor([K, 3]);
    close(runTix(r.program, 'matmul', { a, b }), REF.matmul(F64, a, b), 1e-4, `matmul after split-sum, K = ${K}`);
  }
});

test('optimizeTix on attention, both passes: accepted, within tolerance, program still runs in f64', () => {
  const ts = CASES.attention(), p = compileTix(SRC.attention);
  const r = optimizeTix(p, ['inline', 'split-sum']);
  assert.ok(r.steps.every(s => s.accepted === true), JSON.stringify(r.steps));
  close(runTix(r.program, 'attention', named('attention', ts)), REF.attention(F64, ...ts), 1e-4, 'attention f32');
  close(runTix(r.program, 'attention', named('attention', ts), { precision: 'f64' }), REF.attention(F64, ...ts), 1e-9, 'attention f64');
});
