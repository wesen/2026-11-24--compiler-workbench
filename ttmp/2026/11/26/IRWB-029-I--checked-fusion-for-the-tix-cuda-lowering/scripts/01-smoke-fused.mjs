// IRWB-029-I script 01: smoke-check the fused lowering on the GB10.
// Runs one small case of every corpus function, fused and unfused, and compares the f32 words
// against each other and against the local f32 interpreter.
import { readFile } from 'node:fs/promises';
import { compileTix, runTix, runTixCuda } from '../../../../../../dist/tensor/index.js';

const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const sizes = {
  matmul: { M: 8, K: 8, N: 8 },
  softmax: { N: 4, C: 7 },
  layernorm: { N: 4, D: 7 },
  attention: { Q: 5, K: 7, D: 6, V: 4 },
  mlp: { N: 4, D: 6, H: 8, O: 5 },
  conv2d: { N: 2, C: 3, H: 6, W: 6, O: 4 },
};

for (const [name, symbols] of Object.entries(sizes)) {
  const source = await readFile(
    new URL('../../../../../../corpus/tensor/' + name + '/main.tix', import.meta.url),
    'utf8',
  );
  const program = compileTix(source);
  const fn = program.current.value.functions[0];
  // deterministic pseudo-random small values
  let state = name.length * 7919 + 17;
  const random = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const caseInputs = {};
  for (const p of fn.params) {
    const shape = p.shape.map(a => a.constant + a.terms.reduce((n, [k, c]) => n + c * symbols[k], 0));
    caseInputs[p.name] = {
      shape,
      data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, random),
    };
  }
  const reference = runTix(program, name, caseInputs);
  const unfused = await runTixCuda(program, name, caseInputs, { fuse: false });
  const fused = await runTixCuda(program, name, caseInputs, { fuse: true });
  const same = (a, b) => a.shape.join() === b.shape.join() && words(a).every((w, i) => w === words(b)[i]);
  console.log(
    name,
    'gpu-vs-meaning:', same(reference, fused),
    'fused-vs-unfused:', same(unfused, fused),
    'gpuMs u/f:', unfused.gpuMs.toFixed(4), fused.gpuMs.toFixed(4),
  );
  if (!same(reference, fused)) {
    console.log('  reference', reference.data.slice(0, 4), 'fused', fused.data.slice(0, 4));
    process.exitCode = 1;
  }
}
