// Run from the worktree root after building. Why did the "stride" mutant of fused softmax (a `break` after a
// thread's first element of e) fail on a case with rows of 2 elements, where no thread has a second element?
// Prints which outputs differ from the meaning for N=67, C=2 and N=2, C=67.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, cudaSource, runTix } = await import(new URL('dist/tensor/index.js', root));
const { runCudaBatch } = await import(new URL('dist/tensor/cuda-runtime.js', root));
const program = compileTix(await readFile(new URL('corpus/tensor/softmax/main.tix', root), 'utf8'));
const fn = program.current.value.functions[0];
const source = cudaSource(program, 'softmax');
const mutant = source.replace(/(exp\(static_cast<double>\(v\d+\)\)\);\n\s+staged\[0 \+ i\d+\] = v\d+;\n)/, '$1    break;\n');
console.log(mutant.slice(mutant.indexOf('__global__'), mutant.indexOf('static void run_case')));
for (const shape of [[67, 2], [2, 67]]) {
  const x = { x: { shape, data: Float32Array.from({ length: 134 }, (_, i) => Math.sin(i)) } };
  const want = runTix(program, 'softmax', x).data;
  for (const [name, text] of [['fused', source], ['mutant', mutant]]) {
    const [got] = await runCudaBatch(text, fn, [x]);
    const bad = [...want.keys()].filter(i => !Object.is(want[i], got.data[i]));
    console.log(JSON.stringify({ shape, name, differing: bad.length, first: bad.slice(0, 8) }));
  }
}
