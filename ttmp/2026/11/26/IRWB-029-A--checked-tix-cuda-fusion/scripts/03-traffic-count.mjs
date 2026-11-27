// Counts scheduled f32 loads, distinct f32 input addresses per kernel, and output stores.
const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};

// Tuples are kernel label, read references after scalar reuse, distinct addresses, and writes.
const rowStats = (name, n, c) => [name, n * c, n * c, n];
const rowMap = (name, n, c) => [name, 2 * n * c, n * c + n, n * c];
const { M, K, N } = sizes.matmul;
const matmul = [['y', 2 * M * N * K, M * K + K * N, M * N]];
const { N: softRows, C } = sizes.softmax;
const softmax = [
  rowStats('m', softRows, C),
  rowMap('e', softRows, C),
  rowStats('s', softRows, C),
  rowMap('y', softRows, C),
];
const { N: normRows, D } = sizes.layernorm;
const norm = normRows * D;
const layernorm = [
  rowStats('mean', normRows, D),
  rowMap('centered', normRows, D),
  rowStats('variance', normRows, D),
  ['y', 5 * norm, norm + normRows + 2 * D + 1, norm],
];
const { Q, K: keys, D: features, V } = sizes.attention;
const attention = [
  ['score', 2 * Q * keys * features, (Q + keys) * features, Q * keys],
  rowStats('shift', Q, keys),
  rowMap('e', Q, keys),
  rowStats('z', Q, keys),
  rowMap('weight', Q, keys),
  ['out', 2 * Q * V * keys, (Q + V) * keys, Q * V],
];
const { N: batch, D: input, H: hidden, O: output } = sizes.mlp;
const mlp = [
  ['h', (2 * input + 1) * batch * hidden, batch * input + input * hidden + hidden, batch * hidden],
  ['g', batch * hidden, batch * hidden, batch * hidden],
  ['y', (2 * hidden + 1) * batch * output, batch * hidden + hidden * output + output, batch * output],
];
const { N: images, C: channels, H, W, O } = sizes.conv2d;
const pixels = images * O * (H - 2) * (W - 2);
const conv2d = [['out', 2 * channels * 3 * 3 * pixels, images * channels * H * W + O * channels * 3 * 3, pixels]];

const programs = {
  matmul: [matmul, matmul],
  softmax: [softmax, [['m,e,s,y', softRows * C, softRows * C, softRows * C]]],
  layernorm: [layernorm, [['mean,centered,variance,y', 4 * norm, norm + 2 * D + 1, norm]]],
  attention: [attention, [['score,shift,e,z,weight', ...attention[0].slice(1)], attention[5]]],
  mlp: [mlp, [['h,g', ...mlp[0].slice(1)], mlp[2]]],
  conv2d: [conv2d, conv2d],
};

console.log('| Program | Mode | Kernel | Read bytes | Distinct read bytes | Write bytes | All refs ms | Distinct ms |');
console.log('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |');
for (const [name, modes] of Object.entries(programs)) {
  for (const [i, kernels] of modes.entries()) {
    for (const [label, read, distinct, write] of kernels) {
      const ms = loads => ((loads + write) * 4 / 244e6).toFixed(5);
      console.log(`| ${name} | ${i ? 'fused' : 'unfused'} | ${label} | ${read * 4} | ${distinct * 4} | ${write * 4} | ${ms(read)} | ${ms(distinct)} |`);
    }
  }
}
