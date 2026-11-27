// IRWB-030-H script 06: the per-term price list behind stageTerms — staged terms against serial terms for the same
// program. Each program is one block-mode group with a row-scalar reduction; `planFusion` decides whether to stage
// it, and the same plan with `terms` cleared is the stage-3 lowering of that group. The two sources differ only in
// where the terms are computed; their outputs must be equal bit for bit.
//
//   node <ticket>/scripts/06-term-price.mjs [--runs=1]
import { createHash } from 'node:crypto';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { plain } from '../../../../../../dist/tensor/model.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

const N = 4096,
  C = 1024;
// One row-scalar reduction per program; y keeps the reduction live so the group is not dead code.
const programs = {
  // a term is a load of a staged row
  load: `fn f(x: f32[N,C]): f32[N,C] { t[i]: f32[N] = sum(j) x[i,j]; y[i,j]: f32[N,C] = t[i] / C; return y; }`,
  // a term is a product of two staged rows
  mul: `fn f(x: f32[N,C], z: f32[N,C]): f32[N,C] { t[i]: f32[N] = sum(j) x[i,j] * z[i,j]; y[i,j]: f32[N,C] = t[i] / C; return y; }`,
  // a term divides
  div: `fn f(x: f32[N,C]): f32[N,C] { t[i]: f32[N] = sum(j) x[i,j] / C; y[i,j]: f32[N,C] = t[i]; return y; }`,
  // a term takes a double exp
  exp: `fn f(x: f32[N,C]): f32[N,C] { t[i]: f32[N] = sum(j) exp(x[i,j]); y[i,j]: f32[N,C] = t[i] / C; return y; }`,
  // a term multiplies a staged row by a global vector at the reduction index
  global: `fn f(x: f32[N,C], v: f32[C]): f32[N,C] { t[i]: f32[N] = sum(j) x[i,j] * v[j]; y[i,j]: f32[N,C] = t[i]; return y; }`,
  // two staged reductions in one member: one shared region, reused
  twice: `fn f(x: f32[N,C]): f32[N,C] { t[i]: f32[N] = sum(j) x[i,j] / C + sum(j) x[i,j] * x[i,j] / C; y[i,j]: f32[N,C] = t[i]; return y; }`,
  // a max fold whose term is a row-buffer load: nothing on the price list
  maxbody: `fn f(x: f32[N,C]): f32[N,C] { m[i]: f32[N] = max(j) x[i,j]; y[i,j]: f32[N,C] = m[i] + x[i,j]; return y; }`,
};
const args = process.argv.slice(2);
const runs = Number(args.find(a => a.startsWith('--runs='))?.slice(7) ?? 1);
const digest = ({ data }) =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
const kernels = source => (source.match(/__global__ void/g) ?? []).length;

for (const name of Object.keys(programs)) {
  const program = compileTix(programs[name]);
  const fn = program.current.value.functions[0];
  const plan = planFusion(fn);
  const group = plan.groups[0];
  const random = seededRandom(20);
  const inputs = Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => (plain(d) === 'C' ? C : N));
      const size = shape.reduce((a, b) => a * b, 1);
      return [p.name, { shape, data: Float32Array.from({ length: size }, () => random()) }];
    }),
  );
  const row = {
    name,
    mapping: group.mapping,
    rows: group.staged.length,
    terms: group.terms.map(t => `${t.member}#${t.reduction}`),
    serial: [],
    why: group.terms.length ? group.terms[0].reason : group.serial[0]?.reason,
  };
  for (const staged of [true, false]) {
    const p = staged ? plan : { ...plan, groups: [{ ...group, terms: [] }] };
    const source = emitCuda(fn, p);
    const times = [];
    let result;
    for (let i = 0; i < runs; i++) {
      [result] = await runCudaBatch(source, fn, [inputs], { benchmark: true });
      times.push(result.gpuMs);
    }
    times.sort((a, b) => a - b);
    row[staged ? 'staged' : 'serial'] = { kernels: kernels(source), gpuMs: +times[times.length >> 1].toFixed(4) };
    row[staged ? 'stagedDigest' : 'serialDigest'] = digest(result);
  }
  row.equal = row.stagedDigest === row.serialDigest;
  row.serialOverStaged = +(row.serial.gpuMs / row.staged.gpuMs).toFixed(3);
  delete row.serialDigest;
  delete row.stagedDigest;
  console.log(JSON.stringify(row));
}
