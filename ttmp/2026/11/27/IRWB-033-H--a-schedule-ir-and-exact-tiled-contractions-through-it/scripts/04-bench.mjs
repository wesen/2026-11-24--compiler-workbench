// IRWB-033-H script 04: the timing harness of this stage.
//
//   node 04-bench.mjs [--calls 5] [--only matmul,attention] [--out <file.jsonl>]
//
// For every (program, shape) it runs `runTixCuda(..., { benchmark: true })` alternately fused and unfused, `--calls`
// times per side, and prints the median of those calls per side plus the two output digests so that a "fast but
// different" result cannot pass unnoticed. `benchmark` already returns the median of three timed launches after a
// warm-up, under the runner's --timed lock.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { compileTix, runTixCuda } from '../../../../../../dist/tensor/index.js';

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
};
const calls = Number(value('--calls', '5'));
const only = value('--only', '')
  .split(',')
  .filter(Boolean);
const out = value('--out', '');

// The brief's sizes, in each program's shape names.
const programs = {
  matmul: [
    { M: 512, K: 512, N: 512 },
    { M: 4096, K: 4096, N: 4096 },
    { M: 1024, K: 1024, N: 1024 },
    { M: 300, K: 200, N: 100 },
    { M: 128, K: 128, N: 128 },
    { M: 17, K: 4096, N: 33 },
  ],
  attention: [{ Q: 1024, K: 1024, D: 64, V: 64 }],
  mlp: [{ N: 1024, D: 256, H: 1024, O: 256 }],
  conv2d: [{ N: 8, C: 16, H: 64, W: 64, O: 32 }],
  softmax: [{ N: 4096, C: 1024 }],
  layernorm: [{ N: 4096, D: 1024 }],
};

// Deterministic f32 inputs in [-0.1, 0.1], the recipe stages 3 and 3b used (seed 20).
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function fill(n, rng) {
  return Float32Array.from({ length: n }, () => (2 * rng() - 1) * 0.1);
}
const digest = data => createHash('sha256').update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest('hex').slice(0, 16);

function inputsOf(name, env, rng) {
  const t = (shape, values) => ({ shape, data: values ?? fill(shape.reduce((a, b) => a * b, 1), rng) });
  switch (name) {
    case 'matmul':
      return { a: t([env.M, env.K]), b: t([env.K, env.N]) };
    case 'attention':
      return { q: t([env.Q, env.D]), k: t([env.K, env.D]), v: t([env.K, env.V]) };
    case 'mlp':
      return {
        x: t([env.N, env.D]),
        w: t([env.D, env.H]),
        bias: t([env.H]),
        v: t([env.H, env.O]),
        outBias: t([env.O]),
      };
    case 'conv2d':
      return { x: t([env.N, env.C, env.H, env.W]), kernel: t([env.O, env.C, 3, 3]) };
    case 'softmax':
      return { x: t([env.N, env.C]) };
    case 'layernorm':
      return { gamma: t([env.D]), beta: t([env.D]), x: t([env.N, env.D]), eps: t([1], Float32Array.of(1e-5)) };
    default:
      throw Error('unknown program ' + name);
  }
}

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rows = [];
for (const [name, shapes] of Object.entries(programs)) {
  if (only.length && !only.includes(name)) continue;
  const program = compileTix(readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
  const fn = program.current.value.functions.find(f => f.params.length >= 0 && true);
  void fn;
  for (const env of shapes) {
    const rng = random(20);
    const inputs = inputsOf(name, env, rng);
    const times = { fused: [], unfused: [] };
    let digests;
    for (let call = 0; call < calls; call++) {
      for (const side of call % 2 ? ['unfused', 'fused'] : ['fused', 'unfused']) {
        const result = await runTixCuda(program, name, inputs, { benchmark: true, fuse: side === 'fused' });
        times[side].push(result.gpuMs);
        digests = { ...digests, [side]: digest(result.data) };
      }
    }
    const flops = 2 * (name === 'matmul' ? env.M * env.K * env.N : 0);
    const row = {
      program: name,
      env,
      fused: median(times.fused),
      unfused: median(times.unfused),
      calls: { fused: times.fused, unfused: times.unfused },
      tflops: flops ? flops / (median(times.fused) * 1e9) : null,
      digest: digests,
    };
    rows.push(row);
    console.log(
      `${name.padEnd(9)} ${JSON.stringify(env).padEnd(38)} fused ${row.fused.toFixed(4)} ms  ` +
        `unfused ${row.unfused.toFixed(4)} ms  ratio ${(row.fused / row.unfused).toFixed(3)}` +
        (row.tflops ? `  ${row.tflops.toFixed(2)} TFLOP/s` : '') +
        (digests.fused === digests.unfused ? '' : '  DIGESTS DIFFER'),
    );
  }
}
if (out) writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
