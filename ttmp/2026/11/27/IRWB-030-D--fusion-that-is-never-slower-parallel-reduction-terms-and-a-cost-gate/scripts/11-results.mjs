// IRWB-030-D: the stage's results through the public API. For each corpus program and the "inside" variants at
// the brief's sizes, fused and unfused: kernel count (__global__ definitions in cudaSource), staged reductions per
// block-mode kernel (planFusion), and runTixCuda(..., { benchmark: true }) GPU ms (warm-up + median of 3 launches)
// with the output digest. Three rounds, one call per program, lowering and round. Writes JSON lines to stdout.
import { createHash } from 'node:crypto';
import { cudaSource, runTix, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { fnName, inputs, names, program } from './01-programs.mjs';

const all = [...names, 'softmax-inside'];
const digest = r =>
  createHash('sha256').update(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength)).digest('hex').slice(0, 16);
const rounds = Number(process.argv[2] ?? 3);
if (process.argv[3] === 'cpu')
  for (const name of all) {
    const t = performance.now();
    const r = runTix(program(name), fnName(name), inputs(name));
    console.log(JSON.stringify({ name, interpreter: true, sha: digest(r), ms: performance.now() - t }));
  }
else
  for (let round = 0; round < rounds; round++)
    for (const name of all)
      for (const fuse of [true, false]) {
        const p = program(name);
        const fn = fnName(name);
        const kernels = (cudaSource(p, fn, { fuse }).match(/__global__ void/g) ?? []).length;
        const plan = planFusion(p.current.value.functions[0]);
        const staged = fuse
          ? plan.groups
              .filter(g => g.mapping === 'block')
              .map(g => ({ kernel: g.kernel, staged: g.terms.filter(t => t.staged).map(t => `${t.statement}#${t.reduction}`) }))
          : [];
        const r = await runTixCuda(p, fn, inputs(name), { fuse, benchmark: true });
        console.log(JSON.stringify({ round, name, fuse, kernels, staged, gpuMs: r.gpuMs, sha: digest(r) }));
      }
