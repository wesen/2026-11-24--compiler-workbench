// IRWB-029-F script 02: first GB10 smoke probe - the fused corpus lowering is bit-identical to the f32
// meaning, checkLowering accepts it as exact, and the fused kernel count is 1 where fusion applies.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../../../');
const { compileTix, runTix, runTixCuda, checkLowering, cudaSource } = await import(
  join(root, 'dist/tensor/index.js')
);

const words = d => new Uint32Array(d.buffer, d.byteOffset, d.length);
const buf = (shape, data) => ({ shape, data: Float32Array.from(data) });
const sizes = {
  matmul: { M: 64, K: 64, N: 64 },
  softmax: { N: 512, C: 256 },
  layernorm: { N: 512, D: 256 },
  attention: { Q: 128, K: 128, D: 32, V: 32 },
  mlp: { N: 128, D: 64, H: 128, O: 64 },
  conv2d: { N: 2, C: 4, H: 16, W: 16, O: 4 },
};

for (const name of Object.keys(sizes)) {
  const program = compileTix(readFileSync(join(root, 'corpus/tensor', name, 'main.tix'), 'utf8'));
  const fn = program.current.value.functions[0];
  const dims = new Map();
  const inputs = {};
  let seed = 20;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const p of fn.params) {
    const shape = p.shape.map(d => {
      const plain = d.terms.length === 1 && d.terms[0][1] === 1 && d.constant === 0 ? d.terms[0][0] : null;
      return plain ? (plain in sizes[name] ? sizes[name][plain] : dims.get(plain)) : d.constant;
    });
    shape.forEach((v, i) => {
      const plain = p.shape[i].terms[0]?.[0];
      if (plain && dims.get(plain) === undefined && !(plain in sizes[name])) dims.set(plain, v);
    });
    inputs[p.name] = buf(
      shape,
      Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => 2 * random() - 1),
    );
  }
  const reference = runTix(program, name, inputs);
  const result = await runTixCuda(program, name, inputs);
  const equal =
    JSON.stringify(reference.shape) === JSON.stringify(result.shape) &&
    words(reference.data).every(
      (w, i) =>
        w === words(result.data)[i] || (Number.isNaN(reference.data[i]) && Number.isNaN(result.data[i])),
    );
  const verdict = await checkLowering(program, name);
  console.log(
    name.padEnd(10),
    'bit-identical:',
    equal,
    'kernels:',
    (cudaSource(program, name).match(/__global__ void/g) ?? []).length,
    'check:',
    verdict.accepted,
    verdict.relation,
    verdict.reason ?? '',
  );
  if (!equal) {
    const bad = words(reference.data).findIndex(
      (w, i) =>
        w !== words(result.data)[i] && !(Number.isNaN(reference.data[i]) && Number.isNaN(result.data[i])),
    );
    console.log('  first mismatch at', bad, reference.data[bad], result.data[bad]);
  }
}
