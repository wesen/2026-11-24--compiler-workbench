// IRWB-020-N turn 3: reproduce the hidden-suite failure. An index that shares its name with a parameter (or an
// earlier statement tensor) is rejected by the checker, although Tix's grammar keeps the two apart: tensor names
// occur only before '[', index names only inside brackets and reduction lists.
// Usage: node 04-repro-index-named-like-a-tensor.mjs <worktree>   (after npm run build)
const W = process.argv[2];
const { compileTix } = await import(W + '/dist/tensor/index.js');
const mlp = (out) => `fn mlp(x: f32[N, D], w1: f32[D, F], b1: f32[F], w2: f32[F, D], b2: f32[D]): f32[N, D] {
  h[i, f] = (sum(d) x[i, d] * w1[d, f]) + b1[f];
  g[i, f] = 0.5 * h[i, f] * (1 + tanh(0.7978845608 * (h[i, f] + 0.044715 * h[i, f] * h[i, f] * h[i, f])));
  y[i, ${out}] = (sum(f) g[i, f] * w2[f, ${out}]) + b2[${out}];
  return y;
}`;
const cases = {
  'output index x (also the input tensor)': mlp('x'),
  'output index e (renamed)': mlp('e'),
  'reduction index named like a parameter': 'fn f(x: f32[N], k: f32[N]): f32[N] {\n  y[i] = sum(k) x[k] * k[i];\n  return y;\n}',
  'index named like an earlier statement tensor': 'fn f(x: f32[N]): f32[N] {\n  t[i] = x[i];\n  y[t] = t[t];\n  return y;\n}',
  'index named like a shape (kept on purpose)': 'fn f(x: f32[N]): f32[N] {\n  y[N] = x[N];\n  return y;\n}',
};
for (const [what, src] of Object.entries(cases)) {
  try { compileTix(src); console.log(`ok       ${what}`); }
  catch (e) { console.log(`REJECTED ${what}: ${e.message}`); }
}
