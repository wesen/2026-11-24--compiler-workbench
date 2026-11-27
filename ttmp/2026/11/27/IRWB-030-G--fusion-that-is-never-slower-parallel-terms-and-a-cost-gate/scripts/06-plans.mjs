// IRWB-030-G script 06: the same program under several lowerings, to choose the cost gate's rule.
//
//   node <ticket>/scripts/06-plans.mjs <program> --sizes=K=V,... [--fn=<name>] [--runs=3] [--variants=a,b,c]
//
// variants (default: all):
//   api       the fixed API's fused lowering, `runTixCuda(..., { benchmark: true })`, which plans with the launch's
//             shape values, so the cost gate can fire
//   ungated   the same planner with no shape values, which never gates (stage 3's plan plus parallel terms)
//   unfused   stage 2, `fuse: false`
//
// Every variant is timed with one warm-up launch and the median of three CUDA-event intervals per call; the median
// and every sample are printed, and each output's SHA-256, so the variants can be compared word for word.
import { createHash } from 'node:crypto';
import { runTixCuda } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion, unfusedPlan } from '../../../../../../dist/tensor/fusion.js';
import { inputsFor, load } from './01-bench.mjs';

const args = process.argv.slice(2);
const program = args.find(a => !a.startsWith('--'));
const flag = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const runs = Number(flag('runs', 3));
const { program: p, fn } = load(program, flag('fn'));
const f = p.current.value.functions.find(x => x.name === fn);
const sizes = Object.fromEntries(
  flag('sizes', '')
    .split(',')
    .filter(Boolean)
    .map(s => s.split('=').map((x, i) => (i ? Number(x) : x))),
);
const inputs = inputsFor(p, fn, sizes);
const sha = ({ data }) =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex').slice(0, 16);
const kernels = source => (source.match(/__global__ void/g) ?? []).length;

const plans = {
  api: () => ({ source: emitCuda(f, planFusion(f, sizes)), run: () => runTixCuda(p, fn, inputs, { benchmark: true }) }),
  ungated: () => {
    const source = emitCuda(f, planFusion(f));
    return { source, run: async () => (await runCudaBatch(source, f, [inputs], { benchmark: true }))[0] };
  },
  unfused: () => ({ source: emitCuda(f, unfusedPlan(f)), run: () => runTixCuda(p, fn, inputs, { fuse: false, benchmark: true }) }),
};
const wanted = flag('variants', Object.keys(plans).join(',')).split(',');
for (const name of wanted) {
  const { source, run } = plans[name]();
  const samples = [];
  let result;
  for (let i = 0; i < runs; i++) {
    result = await run();
    samples.push(result.gpuMs);
  }
  const ms = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  console.log(
    JSON.stringify({
      program: fn,
      sizes,
      variant: name,
      kernels: kernels(source),
      ms: Math.round(ms * 10000) / 10000,
      samples: samples.map(x => Math.round(x * 10000) / 10000),
      sha: sha(result),
    }),
  );
}
