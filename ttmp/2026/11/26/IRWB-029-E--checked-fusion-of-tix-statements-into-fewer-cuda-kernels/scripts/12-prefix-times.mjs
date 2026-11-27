// Run from the worktree root after building. Where a fused kernel's time goes: benchmarks the prefixes of a
// corpus program (the function cut after each statement that has the result's rank, returning that statement),
// fused and unfused, at the brief's sizes.
//   node <ticket>/scripts/12-prefix-times.mjs attention|mlp|softmax|layernorm
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, runTixCuda } = await import(new URL('dist/tensor/index.js', root));
const { value } = await import(new URL('dist/tensor/model.js', root));
const { seededRandom } = await import(new URL('dist/framework/contracts/index.js', root));
const sizes = {
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
};
const name = process.argv[2];
const text = await readFile(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8');
const lines = text.split('\n');
const statements = lines.filter(l => /^\s+\w+\[.*=/.test(l));
const header = lines[0].replace(/\):.*\{/, '');
const types = { 1: m => `f32[${m[0]}]`, 2: m => `f32[${m[0]},${m[1]}]` };
for (let n = 1; n <= statements.length; n++) {
  const last = /^\s+(\w+)\[([\w,]+)\]/.exec(statements[n - 1]);
  const full = compileTix(text).current.value.functions[0];
  const shape = full.statements[n - 1].shape.map(d => d.terms[0][0]);
  const source = `${header}): f32[${shape}] {\n${statements.slice(0, n).join('\n')}\n  return ${last[1]};\n}`;
  const program = compileTix(source);
  const fn = program.current.value.functions[0];
  const dims = new Map(Object.entries(sizes[name]));
  const random = seededRandom(20);
  const inputs = Object.fromEntries(
    fn.params.map(p => {
      const s = p.shape.map(d => value(d, dims));
      return [p.name, { shape: s, data: Float32Array.from({ length: s.reduce((a, b) => a * b, 1) }, () => (p.name === 'eps' ? 1e-5 : 0.2 * random() - 0.1)) }];
    }),
  );
  const ms = {};
  for (const fuse of [false, true]) ms[fuse ? 'fused' : 'unfused'] = +(await runTixCuda(program, name, inputs, { fuse, benchmark: true })).gpuMs.toFixed(4);
  console.log(JSON.stringify({ through: last[1], ...ms }));
}
