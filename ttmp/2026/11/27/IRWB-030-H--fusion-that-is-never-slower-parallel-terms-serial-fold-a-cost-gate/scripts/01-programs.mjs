// IRWB-030-H script 01: the programs measured in this stage — the corpus programs at the brief's sizes, the two
// "inside" division placements of the brief, and the stress variants used to justify the fuse gate.
//
// "outside" divides the reduced value (the corpus form, corpus/tensor/<name>/main.tix). "inside" divides every term:
// a different f32 program, each kept exact. Sizes are in the corpus programs' shape names.
export const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};

const softmax = `fn softmax(x: f32[N,C]): f32[N,C] {
  m[i] = max(j) x[i,j];
  e[i,j] = exp(x[i,j] - m[i]);
  s[i] = sum(j) e[i,j];
  y[i,j] = e[i,j] / s[i];
  return y;
}`;

// Programs that are not in corpus/tensor/, as source text. `sizes` overrides the brief's size for a variant.
export const variants = {
  'layernorm-inside': {
    sizes: sizes.layernorm,
    program: `fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
  mean[i] = sum(j) x[i,j] / D;
  centered[i,j] = x[i,j] - mean[i];
  variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
  y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
  return y;
}`,
  },
  'attention-inside': {
    sizes: sizes.attention,
    program: `fn attention(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
  score[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
  shift[i] = max(j) score[i,j];
  e[i,j] = exp(score[i,j] - shift[i]);
  z[i] = sum(j) e[i,j];
  out[i,c] = sum(j) e[i,j] * v[j,c] / z[i];
  return out;
}`,
  },
  // The row-scalar term is a bare load of a buffered row: staging it adds a store, a barrier and a load.
  'softmax-serialize-terms': { sizes: sizes.softmax, program: softmax },
  // A row reduction whose term is a product of two buffered rows (no division, no transcendental).
  'row-mul': {
    sizes: sizes.layernorm,
    program: `fn variancesum(x: f32[N,D], y: f32[N,D]): f32[N] {
  a[i] = sum(j) x[i,j];
  b[i] = sum(j) x[i,j] * y[i,j];
  c[i] = a[i] + b[i];
  return c;
}`,
  },
  // A transcendental inside a row reduction: thread 0 would run N double exp calls.
  'row-exp': {
    sizes: { N: 4096, C: 1024 },
    program: `fn rowsumexp(x: f32[N,C]): f32[N] {
  t[i] = sum(j) exp(x[i,j]);
  y[i] = t[i] / C;
  return y;
}`,
  },
  // Few rows, long: one block per row leaves 47 of 48 SMs idle during the parallel phases.
  'softmax-1row': { sizes: { N: 1, C: 4194304 }, program: softmax },
  'softmax-8rows': { sizes: { N: 8, C: 524288 }, program: softmax },
  // The brief's softmax element count in many short rows: a block per row has fewer active lanes than a warp.
  'softmax-short-rows': { sizes: { N: 262144, C: 16 }, program: softmax },
  // The brief's layernorm element count in many short rows.
  'layernorm-short-rows': {
    sizes: { N: 262144, D: 16 },
    program: `fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
  mean[i] = (sum(j) x[i,j]) / D;
  centered[i,j] = x[i,j] - mean[i];
  variance[i] = (sum(j) centered[i,j] * centered[i,j]) / D;
  y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
  return y;
}`,
  },
  // Many rows, long: more rows than block-mode blocks resident on the GPU.
  'layernorm-many-rows': {
    sizes: { N: 65536, D: 256 },
    program: `fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
  mean[i] = sum(j) x[i,j] / D;
  centered[i,j] = x[i,j] - mean[i];
  variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
  y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
  return y;
}`,
  },
};
