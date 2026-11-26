// Reproduce the hidden suite's three failures (IRWB-020-P, turn 3): an index whose name is also a tensor's.
// Run from the worktree root after `npm run build`: node <this file>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { compileTix, runTix } = await import(pathToFileURL(path.resolve('dist/tensor/index.js')).href);
const mlp = last => `fn mlp(x: f32[B, I], w1: f32[I, H], b1: f32[H], w2: f32[H, O], b2: f32[O]): f32[B, O] {
  h[i, j] = (sum(k) x[i, k] * w1[k, j]) + b1[j];
  g[i, j] = 0.5 * h[i, j] * (1 + tanh(0.7978845608 * (h[i, j] + 0.044715 * h[i, j] * h[i, j] * h[i, j])));
  ${last}
  return y;
}`;
for (const [label, last] of [
  ['index named x (also the input tensor)', 'y[i, x] = (sum(f) g[i, f] * w2[f, x]) + b2[x];'],
  ['index renamed to e', 'y[i, e] = (sum(f) g[i, f] * w2[f, e]) + b2[e];'],
]) {
  try {
    const p = compileTix(mlp(last));
    const t = (shape, v) => ({ shape, data: new Float32Array(shape.reduce((a, b) => a * b, 1)).fill(v) });
    const r = runTix(p, 'mlp', { x: t([1, 2], 1), w1: t([2, 2], 0.5), b1: t([2], 0), w2: t([2, 1], 1), b2: t([1], 0) });
    console.log(`${label}: compiles; result ${Array.from(r.data)}`);
  } catch (e) {
    console.log(`${label}: ${e.message}`);
  }
}
// the other half of the same rule: a statement's own name as one of its indices
for (const src of ['fn f(a: f32[N]): f32[N] { y[y] = a[y]; return y; }', 'fn f(a: f32[N]): f32[N] { y[i] = sum(a) a[a] * 0 + a[i]; return y; }']) {
  try { compileTix(src); console.log('compiles:', src); } catch (e) { console.log(`${e.message}   <- ${src}`); }
}
