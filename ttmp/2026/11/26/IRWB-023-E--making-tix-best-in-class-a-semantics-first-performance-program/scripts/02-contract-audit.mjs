// IRWB-023-E experiment 02: audit the meaning contract's sample domain and its
// 2e-6 + 2e-5|r| budget against the f32 meaning it is supposed to judge.
//
//   1. For each corpus function, list the CUDA check cases the gate actually
//      generates: extents, residues mod 4 (the split/tail block width), tensor
//      element counts, value streams. This is what a candidate is judged on.
//   2. Measure, with the real f32 evaluator, the error of a corpus-sized
//      reduction against the f64 reference, as a fraction of the contract budget.
//   3. Compare observed error with (a) the classical forward-error bound
//      gamma_{n-1} * sum|a| and (b) the constant budget.
//
// Run from the worktree root after `npm run build`.
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.cwd() + '/');
const { compileTix, runTix } = await import(new URL('dist/tensor/index.js', root));
const { cudaCases, seed } = await import(new URL('dist/tensor/contract.js', root));
const { seededRandom } = await import(new URL('dist/framework/contracts/index.js', root));

const corpus = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------- 1. case audit
console.log('== 1. case domain of the checked lowering ==');
const audit = [];
for (const name of corpus) {
  const program = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const fn = program.current.value.functions[0];
  const cases = cudaCases(fn, seededRandom(seed));
  const extents = new Set();
  let maxElements = 0,
    maxReduce = 0;
  for (const c of cases) {
    for (const t of Object.values(c.inputs)) {
      maxElements = Math.max(maxElements, t.data.length);
      for (const d of t.shape) extents.add(d);
    }
  }
  // reduction lengths reachable in one case: inspect the reference work instead
  const covered = [...extents].sort((a, b) => a - b);
  const residues = [...new Set(covered.map(n => n % 4))].sort();
  audit.push({
    fn: name,
    cases: cases.length,
    shapes: cases.map(c => c.shapeValues.join('/')),
    distinctExtents: covered.join(','),
    residuesMod4: residues.join(','),
    maxTensorElements: maxElements,
    streams: [...new Set(cases.map(c => c.stream))].join(','),
    paramCount: fn.params.length,
  });
  maxReduce = 0;
}
for (const a of audit)
  console.log(
    `${a.fn.padEnd(10)} cases=${String(a.cases).padEnd(3)} extents={${a.distinctExtents}} ` +
      `mod4={${a.residuesMod4}} maxElems=${a.maxTensorElements} params=${a.paramCount} streams=${a.streams}`,
  );
console.log('sampled shapes: ' + audit.map(a => `${a.fn}: ${a.shapes.join(' ')}`).join('\n               '));

// --------------------------------------------- 2. budget accounting at full size
// A reduction of length n, as the corpus uses it. Two spellings of the same sum
// are compared against the current revision's f64 reference, exactly as the
// tolerance relation does: |candidate - reference| <= 2e-6 + 2e-5|reference|.
console.log('\n== 2. one f32 sum of length 1024 against the contract budget ==');
function sumCase(n, values) {
  const source = 'fn f(x: f32[1,N]): f32[1] {\n  y[i] = sum(j) x[i,j];\n  return y;\n}';
  const program = compileTix(source);
  const input = { x: { shape: [1, n], data: Float32Array.from(values) } };
  const f32 = runTix(program, 'f', input, { precision: 'f32' }).data[0];
  const f64 = runTix(program, 'f', input, { precision: 'f64' }).data[0];
  const budget = 2e-6 + 2e-5 * Math.abs(f64);
  return { f32, f64, err: Math.abs(f32 - f64), budget, fraction: Math.abs(f32 - f64) / budget };
}
const n = 1024;
const rng = seededRandom(7);
const patterns = {
  'positive in [0.25,1]': Array.from({ length: n }, () => 0.25 + 0.75 * rng()),
  'signed in [-1,1]': Array.from({ length: n }, () => 2 * rng() - 1),
  'alternating +-1': Array.from({ length: n }, (_, i) => (i % 2 ? -1 : 1)),
  'alternating +-1, one 2^-12 after': Array.from({ length: n }, (_, i) =>
    i === n - 1 ? 2 ** -12 : i % 2 ? -1 : 1,
  ),
  'scaled 1e3 alternating': Array.from({ length: n }, (_, i) => (i % 2 ? -1e3 : 1e3)),
  // Ill-conditioned but entirely ordinary: a large leading term, many unit
  // terms, and a cancelling trailing term. The f32 fold is *correct* here; the
  // contract's f64 distance is what grows.
  'big, 1022 ones, big negative': Array.from({ length: n }, (_, i) =>
    i === 0 ? 1e7 : i === n - 1 ? -1e7 : 1,
  ),
  'same, at 1e3 scale': Array.from({ length: n }, (_, i) =>
    i === 0 ? 1e3 : i === n - 1 ? -1e3 : 1e-3,
  ),
};
for (const [label, values] of Object.entries(patterns)) {
  const r = sumCase(n, values);
  console.log(
    `${label.padEnd(30)} f64=${r.f64.toExponential(6)} f32-f64=${r.err.toExponential(3)} ` +
      `budget=${r.budget.toExponential(3)} used=${(100 * r.fraction).toFixed(1)}%`,
  );
}

// ------------------------------------- 3. observed error vs the classical bound
console.log('\n== 3. observed error vs gamma_{n-1} * sum|a| ==');
const u = 2 ** -24;
const gamma = k => (k * u) / (1 - k * u);
const examples = {
  n: [16, 256, 1024, 4096],
};
for (const k of examples.n) {
  const values = Array.from({ length: k }, () => 2 * rng() - 1);
  const r = sumCase(k, values);
  const sumAbs = values.reduce((a, b) => a + Math.abs(b), 0);
  const bound = gamma(k - 1) * sumAbs;
  console.log(
    `n=${String(k).padEnd(5)} sum|a|=${sumAbs.toFixed(2).padStart(8)} observed=${r.err.toExponential(3)} ` +
      `gamma_bound=${bound.toExponential(3)} contract_budget=${r.budget.toExponential(3)} ` +
      `observed/bound=${(r.err / bound).toExponential(2)}`,
  );
}
