// Run from the worktree root after `npm run build`.
//
// Where does the tolerance gate stop tolerating the *identity* transformation? Generate a family of legal
// Tix programs with longer and longer reductions (C is bound by a bare parameter axis, the second axis is
// k*C) and ask the real gate to compare the origin with itself. Any rejection is caused by the program's
// own f32 rounding, not by a rewrite.
//
// Also reports the worst budget fraction so a near miss is visible.
//
// Usage: node <ticket>/scripts/02-reduction-length.mjs
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix } = await import(new URL('dist/tensor/index.js', root));
const { meaningGate } = await import(new URL('dist/tensor/contract.js', root));
const { evaluate } = await import(new URL('dist/tensor/evaluate.js', root));
const { value } = await import(new URL('dist/tensor/model.js', root));
const { seededRandom } = await import(new URL('dist/framework/contracts/index.js', root));

const program = k => `fn longred(x: f32[N,C], w: f32[N,${k}*C]): f32[N] {
  y[i] = sum(j) w[i,j];
  return y;
}`;

// Rebuild the gate's case list for a one-function module to attribute the verdict to a number.
function worstFraction(p, name) {
  const fn = p.current.value.functions.find(f => f.name === name);
  const symbols = [...new Set(fn.params.flatMap(t => t.shape.map(a => (a.constant === 0 && a.terms.length === 1 && a.terms[0][1] === 1 ? a.terms[0][0] : undefined)).filter(Boolean)))].sort();
  const random = seededRandom(20);
  let worst = 0, cases = 0;
  for (const assignment of [1, 3, 4, 7, 'mixed']) {
    const shapeValues = symbols.map((_, i) => (typeof assignment === 'number' ? assignment : [3, 5, 7][i % 3]));
    const dims = new Map(symbols.map((s, i) => [s, shapeValues[i]]));
    const shapes = fn.params.map(t => t.shape.map(d => value(d, dims)));
    if (shapes.some(s => s.some(x => x < 0) || s.reduce((a, b) => a * b, 1) > 4096)) continue;
    for (const stream of ['signed', 'positive', 'half-ulp']) {
      const inputs = Object.create(null);
      fn.params.forEach((t, j) => {
        const shape = shapes[j];
        inputs[t.name] = {
          shape,
          data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, (_, i) =>
            stream === 'signed' ? 2 * random() - 1 : stream === 'positive' ? 0.25 + 0.75 * random() : [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24][i % 7],
          ),
        };
      });
      let ref;
      try { ref = evaluate(fn, inputs, 'f64', true); } catch { continue; }
      if (!ref.data.every(Number.isFinite)) continue;
      const got = evaluate(fn, inputs, 'f32');
      cases++;
      for (let i = 0; i < ref.data.length; i++)
        worst = Math.max(worst, Math.abs(got.data[i] - ref.data[i]) / (2e-6 + 2e-5 * Math.abs(ref.data[i])));
    }
  }
  return { worst, cases };
}
const rows = [];
for (const k of [1, 2, 4, 8, 16, 32, 64]) {
  const p = compileTix(program(k));
  const result = meaningGate(p.origin, 'tolerance')(p.origin, p.origin);
  const { worst, cases } = worstFraction(p, 'longred');
  rows.push({
    'reduction terms at C=7': 7 * k,
    cases,
    'identity max budget': worst.toExponential(2),
    verdict: result.ok ? 'agree' : 'REJECT',
    'first counterexample': result.ok ? '' : (result.reason ?? '').slice(0, 72),
  });
}
console.log('The real tolerance gate applied to the identity transformation (candidate == origin).');
console.log('1.0 = the budget boundary of |candidate_f32 - origin_f64| <= 2e-6 + 2e-5|r|.');
console.table(rows);
