// IRWB-030-G script 13: what staging a cheap body costs, to justify refusing it.
//
// The planner stages a reduction's terms only when the body has a division, a transcendental or an inner reduction.
// This script measures the other side of that rule: it writes a copy of the built planner next to it (`dist/tensor/
// fusion-stage-all.mjs`) whose cost rule returns 1 for every body, so every reduction with an addressable axis is
// staged, then times the same program under
//   - `plan`      the shipped planner,
//   - `stage-all` the patched one,
//   - `unfused`   stage 2,
// and compares the outputs word for word. Nothing but the copy is written, and the copy is rebuilt on every run.
//
//   node <ticket>/scripts/13-stage-everything.mjs <program> --sizes=K=V,... [--fn=<name>] [--runs=3]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runTixCuda } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion, unfusedPlan } from '../../../../../../dist/tensor/fusion.js';
import { inputsFor, load } from './01-bench.mjs';

const patched = fileURLToPath(new URL('../../../../../../dist/tensor/fusion-stage-all.mjs', import.meta.url));
const original = readFileSync(fileURLToPath(new URL('../../../../../../dist/tensor/fusion.js', import.meta.url)), 'utf8');
const marker = 'const costly = (e) => {\n    switch (e.kind) {';
if (!original.includes(marker)) throw Error('The built planner changed shape: update the patch in this script');
writeFileSync(patched, original.replace(marker, 'const costly = (e) => {\n    return 1;\n    switch (e.kind) {'));
const stageAll = await import(patched);

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

const plan = planFusion(f, sizes),
  unfused = unfusedPlan(f),
  everything = stageAll.planFusion(f, sizes);
for (const g of everything.groups)
  process.stderr.write(`// stage-all ${g.kernel} ${g.mapping} terms ${g.terms.map(t => t.member + ':' + t.reduction)}\n`);
process.stderr.write(
  `// plan terms ${plan.groups.flatMap(g => g.terms.map(t => t.member + ':' + t.reduction)).join(',') || 'none'}\n`,
);

const sources = {
  plan: emitCuda(f, plan),
  'stage-all': emitCuda(f, everything),
  unfused: emitCuda(f, unfused),
};
for (const [variant, source] of Object.entries(sources)) {
  const samples = [];
  let result;
  for (let i = 0; i < runs; i++) {
    result =
      variant === 'plan'
        ? await runTixCuda(p, fn, inputs, { benchmark: true })
        : (await runCudaBatch(source, f, [inputs], { benchmark: true }))[0];
    samples.push(result.gpuMs);
  }
  const ms = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  console.log(
    JSON.stringify({
      program: fn,
      sizes,
      variant,
      kernels: (source.match(/__global__ void/g) ?? []).length,
      ms: Math.round(ms * 10000) / 10000,
      samples: samples.map(x => Math.round(x * 10000) / 10000),
      sha: sha(result),
    }),
  );
}
