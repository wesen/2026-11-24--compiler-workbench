const buf = (shape, data) => ({ shape, data: Float32Array.from(data) });
const gelu = x => 0.5 * x * (1 + Math.tanh(0.79788456 * (x + 0.044715 * x ** 3)));
export const oracles = [];
const check = (name, inputs, shape, expected) => oracles.push({ name, inputs, shape, expected });

check(
  'matmul',
  { a: buf([2, 3], [1, 2, 3, 4, 5, 6]), b: buf([3, 2], [1, 0, 0, 2, -1, 1]) },
  [2, 2],
  [-2, 7, -2, 16],
);
const p = 1 / (1 + Math.exp(-1));
check('softmax', { x: buf([2, 2], [1000, 999, 0, 1]) }, [2, 2], [p, 1 - p, 1 - p, p]);
check(
  'layernorm',
  { x: buf([2, 2], [3, 3, 2, 4]), gamma: buf([2], [2, 3]), beta: buf([2], [1, -2]), eps: buf([1], [3]) },
  [2, 2],
  [1, -2, 0, -0.5],
);
check(
  'attention',
  { q: buf([1, 1], [1]), k: buf([2, 1], [0, 1]), v: buf([2, 2], [1, 0, 0, 2]) },
  [1, 2],
  [1 - p, 2 * p],
);
check(
  'mlp',
  {
    x: buf([1, 1], [2]),
    w: buf([1, 2], [-1, 2]),
    bias: buf([2], [1, -2]),
    v: buf([2, 1], [2, 3]),
    outBias: buf([1], [-2]),
  },
  [1, 1],
  [2 * gelu(-1) + 3 * gelu(2) - 2],
);
const image = Array.from({ length: 24 }, (_, i) => i + 1);
check(
  'conv2d',
  {
    x: buf([1, 2, 3, 4], image),
    kernel: buf([1, 2, 3, 3], [1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, 0, 0, 0, 0]),
  },
  [1, 1, 1, 2],
  [1 + 2 * 11 - 18, 2 + 2 * 12 - 19],
);
