// Run from the worktree root after `npm run build`.
//
// Two measurements about Tix's tolerance contract, both using the product API unchanged.
//
// A. The identity transformation through the real gate. `meaningGate(origin,'tolerance')` compares a
//    candidate's f32 result with the origin's f64 result on the gate's own case list. Called with the
//    origin as candidate, it measures the error of *not transforming at all*. A rejection here means the
//    gate's verdict is about the program's conditioning, not about the rewrite.
//
// B. Budget utilisation of a real rewrite (split-sum) on the same cases: how much of the allowed error a
//    genuine reassociation spends. Small numbers mean the relation is insensitive.
//
// Usage: node <ticket>/scripts/01-gate-on-identity.mjs [--all]
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, optimizeTix, runTix } = await import(new URL('dist/tensor/index.js', root));
const { meaningGate } = await import(new URL('dist/tensor/contract.js', root));
const { evaluate } = await import(new URL('dist/tensor/evaluate.js', root));
const { value } = await import(new URL('dist/tensor/model.js', root));

// The gate's own sample domain, rebuilt so we can inspect per-case numbers. This mirrors
// src/tensor/contract.ts `cases()` for relation='tolerance': origin f64 is the reference.
const { seededRandom } = await import(new URL('dist/framework/contracts/index.js', root));

const corpus = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
const names = process.argv.includes('--all') ? corpus : corpus;
const rows = [];
for (const name of names) {
  const source = await readFile(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8');
  const program = compileTix(source);
  const fn = program.current.value.functions.find(f => f.name === name);
  const gate = meaningGate(program.origin, 'tolerance');
  const identity = gate(program.origin, program.origin);
  // Same cases as the gate uses, evaluated three ways: f64 (the reference), origin f32 (the no-op
  // candidate) and split-sum f32 (a real candidate).
  const split = optimizeTix(program, ['split-sum']).program;
  const random = seededRandom(20);
  const symbols = [
    ...new Set(fn.params.flatMap(p => p.shape.map(a => (a.constant === 0 && a.terms.length === 1 && a.terms[0][1] === 1 ? a.terms[0][0] : undefined)).filter(Boolean))),
  ].sort();
  const assignments = [1, 3, 4, 7, 'mixed'].map(n =>
    symbols.map((_, i) => (typeof n === 'number' ? n : [3, 5, 7][i % 3])),
  );
  let worstIdentity = 0, worstSplit = 0, cases = 0;
  for (const shapeValues of assignments) {
    const dims = new Map(symbols.map((s, i) => [s, shapeValues[i]]));
    const shapes = fn.params.map(p => p.shape.map(d => value(d, dims)));
    if (shapes.some(s => s.some(x => x < 0) || s.reduce((a, b) => a * b, 1) > 4096)) continue;
    for (const stream of ['signed', 'positive', 'half-ulp']) {
      const inputs = Object.create(null);
      fn.params.forEach((p, j) => {
        const shape = shapes[j];
        const n = shape.reduce((a, b) => a * b, 1);
        inputs[p.name] = {
          shape,
          data: Float32Array.from({ length: n }, (_, i) =>
            stream === 'signed' ? 2 * random() - 1 : stream === 'positive' ? 0.25 + 0.75 * random() : [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24][i % 7],
          ),
        };
      });
      let ref;
      try {
        ref = evaluate(fn, inputs, 'f64', true);
      } catch {
        continue;
      }
      if (!ref.data.every(Number.isFinite)) continue;
      cases++;
      const budget = i => 2e-6 + 2e-5 * Math.abs(ref.data[i]);
      for (const [label, prog] of [['identity', program], ['split', split]]) {
        const got = evaluate(prog.current.value.functions.find(f => f.name === name), inputs, 'f32');
        let w = 0;
        for (let i = 0; i < ref.data.length; i++) {
          const frac = Math.abs(got.data[i] - ref.data[i]) / budget(i);
          if (!Number.isFinite(frac)) { w = Infinity; break; }
          if (frac > w) w = frac;
        }
        if (label === 'identity') worstIdentity = Math.max(worstIdentity, w);
        else worstSplit = Math.max(worstSplit, w);
      }
    }
  }
  rows.push({
    program: name,
    cases,
    'identity verdict': identity.ok ? 'agree' : 'REJECT',
    'identity max budget': worstIdentity.toExponential(2),
    'split max budget': worstSplit.toExponential(2),
    'split accepted': String(optimizeTix(program, ['split-sum']).steps[0].accepted),
  });
}
console.log('Tolerance gate: 1.0 = the budget boundary. Semantics: |candidate_f32 - origin_f64| <= 2e-6 + 2e-5|r|.');
console.table(rows);
