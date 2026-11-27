// IRWB-030-H script 10: random programs whose row reductions have costly bodies, through the exact contract.
//
// Stage 3 checked 40 random programs; this stage's risk is narrower — a staged term is computed by another thread
// than the folding one — so the generator draws from the families that stage: divisions, roots, transcendentals,
// global reads and nested reductions inside a row-scalar member, with random shapes and consumers.
//
//   node <ticket>/scripts/10-random-programs.mjs [count]
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { checkLowering, compileTix } from '../../../../../../dist/tensor/index.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';

const random = seededRandom(30);
const pick = list => list[Math.floor(random() * list.length)];

// Bodies that the price list stages, and one it does not (the last), whose row reduction stays serial.
const bodies = [
  'x[i,j] / D',
  'x[i,j] * x[i,j] / D',
  'sqrt(x[i,j])',
  'exp(x[i,j] - 1)',
  'log(x[i,j] + 2)',
  'tanh(x[i,j])',
  'x[i,j] * v[j]',
  '(x[i,j] - (sum(k) x[i,k] / D) / D) / D',
  'x[i,j] + (sum(k) x[i,k] / D) / D',
  'x[i,j] * 2',
];
const heads = [
  't[i]: f32[N] = sum(j) BODY / 2;',
  't[i]: f32[N] = (sum(j) BODY / 2) + (sum(k) x[i,k] / D);',
  't[i]: f32[N] = max(j) BODY / 2;',
];
const tails = [
  'y[i,j]: f32[N,D] = t[i] + x[i,j] * 2; return y;',
  'y[i,j]: f32[N,D] = t[i] / D + sqrt(x[i,j]); return y;',
  'y[i,j]: f32[N,D] = t[i] + x[i,j] * 2; z[i,j]: f32[N,D] = y[i,j] - t[i]; return z;',
];

const count = Number(process.argv[2] ?? 10);
let staged = 0,
  refusals = 0,
  accepted = 0;
for (let n = 0; n < count; n++) {
  const body = pick(bodies);
  const source = `fn f(x: f32[N,D], v: f32[D]): f32[N,D] { ${pick(heads).replace('BODY', body)} ${pick(tails)} }`;
  let program;
  try {
    program = compileTix(source);
  } catch (error) {
    console.log(JSON.stringify({ n, skipped: String(error), source }));
    continue;
  }
  const plan = planFusion(program.current.value.functions[0]);
  const stages = plan.groups.flatMap(g => g.terms).length;
  staged += stages;
  refusals += plan.groups.flatMap(g => g.serial).length;
  const verdict = await checkLowering(program, 'f');
  accepted += verdict.accepted ? 1 : 0;
  console.log(
    JSON.stringify({
      n,
      body,
      groups: plan.groups.length,
      mappings: plan.groups.map(g => g.mapping),
      stages,
      verdict,
      source: verdict.accepted ? undefined : source,
    }),
  );
}
console.log(JSON.stringify({ count, programsWithStagedTerms: staged > 0, stages: staged, refusals, accepted }));
