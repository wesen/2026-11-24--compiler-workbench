// IRWB-030-G script 01: one benchmark harness for the whole stage.
//
// Times a Tix function at given shape values through the fixed API, fused (the default lowering) and unfused
// (stage 2), reports the kernel count of each source, the SHA-256 of each output, and whether the two outputs are
// bit-identical. `benchmark: true` is one warm-up launch and the median of three CUDA-event intervals under the
// runner's --timed lock; `--runs N` repeats that whole call N times and reports every sample and the median, so
// run-to-run noise is visible instead of hidden.
//
//   node <ticket>/scripts/01-bench.mjs <program> --sizes=N=4096,D=1024 [--runs=5] [--only=fused|unfused]
//   <program> is a corpus name (corpus/tensor/<name>/main.tix, function <name>) or a path to a .tix file
//   [--fn=<function name>]  selects the function inside a .tix file (default: the corpus name, else the first)
//   [--eps=<value>]         the value of a parameter called `eps` (default 1e-5, as IRWB-029-D script 04)
//   [--seed=<n>]            input seed (default 20, f32 values in [-0.1, 0.1])
//   [--json]                one JSON object per line (default: a compact text line)
//
// Every line also carries the timing of a `--timed`-free correctness pairing: the two outputs are compared word by
// word, and the unfused output is the reference for it (the interpreter at these sizes takes minutes).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { plain, value } from '../../../../../../dist/tensor/model.js';

export const corpusSizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};

export function load(program, fnName) {
  const path = program.endsWith('.tix') ? program : `corpus/tensor/${program}/main.tix`;
  const source = readFileSync(path, 'utf8');
  const compiled = compileTix(source);
  const fn = fnName ?? (program.endsWith('.tix') ? compiled.current.value.functions[0].name : program);
  return { program: compiled, fn };
}

export function inputsFor(program, fn, sizes, { seed = 20, eps = 1e-5 } = {}) {
  const f = program.current.value.functions.find(x => x.name === fn);
  const dims = new Map(Object.entries(sizes));
  const random = seededRandom(seed);
  return Object.fromEntries(
    f.params.map(p => {
      const shape = p.shape.map(d => value(d, dims));
      const n = shape.reduce((a, b) => a * b, 1);
      const data = Float32Array.from({ length: n }, () =>
        p.name === 'eps' ? eps : 0.2 * random() - 0.1,
      );
      return [p.name, { shape, data }];
    }),
  );
}

const digest = ({ data }) =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const kernels = source => (source.match(/__global__ void/g) ?? []).length;

/** The shape symbol values the inputs fix, so the source counted here is the plan `runTixCuda` runs. */
export function sizesOf(program, fn, inputs) {
  const f = program.current.value.functions.find(x => x.name === fn);
  const values = {};
  for (const p of f.params)
    for (const [i, dim] of p.shape.entries()) {
      const key = plain(dim);
      if (key !== undefined && inputs[p.name]) values[key] = inputs[p.name].shape[i];
    }
  return values;
}

/** Times `runs` benchmark calls of one lowering; each call is a warm-up plus the median of three launches. */
export async function bench(program, fn, inputs, fuse, runs) {
  const source = cudaSource(program, fn, { fuse, sizes: sizesOf(program, fn, inputs) });
  const samples = [];
  let result;
  for (let i = 0; i < runs; i++) {
    result = await runTixCuda(program, fn, inputs, { fuse, benchmark: true });
    samples.push(result.gpuMs);
  }
  return { kernels: kernels(source), samples, ms: median(samples), sha: digest(result), source };
}

export async function measure(program, fn, inputs, { runs = 5, only } = {}) {
  const out = { program: fn };
  for (const fuse of only ? [only === 'fused'] : [true, false]) {
    const r = await bench(program, fn, inputs, fuse, runs);
    out[fuse ? 'fused' : 'unfused'] = { kernels: r.kernels, ms: r.ms, samples: r.samples, sha: r.sha };
  }
  if (out.fused && out.unfused) out.equal = out.fused.sha === out.unfused.sha;
  if (out.fused && out.unfused) out.ratio = out.unfused.ms / out.fused.ms;
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const program = args.find(a => !a.startsWith('--'));
  const flag = (name, fallback) => {
    const hit = args.find(a => a.startsWith(`--${name}=`));
    return hit === undefined ? fallback : hit.slice(name.length + 3);
  };
  if (!program) throw Error('usage: node 01-bench.mjs <program> --sizes=K=V,... [--runs=5] [--only=fused]');
  const name = program.endsWith('.tix') ? program.split('/').at(-1) : program;
  const sizesText = flag('sizes');
  const sizes = sizesText
    ? Object.fromEntries(sizesText.split(',').map(s => s.split('=').map((x, i) => (i ? Number(x) : x))))
    : corpusSizes[name];
  if (!sizes) throw Error('no sizes for ' + name + '; pass --sizes');
  const { program: compiled, fn } = load(program, flag('fn'));
  const inputs = inputsFor(compiled, fn, sizes, { seed: Number(flag('seed', 20)), eps: Number(flag('eps', 1e-5)) });
  const row = await measure(compiled, fn, inputs, {
    runs: Number(flag('runs', 5)),
    only: flag('only'),
  });
  const text = {
    ...row,
    sizes,
    shape: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.shape.join('x')])),
  };
  console.log(args.includes('--json') ? JSON.stringify(text) : JSON.stringify(text));
}
