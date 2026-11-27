// For each corpus program (and its optimized revisions), generate the stage-1 tolerance cases and measure how much of
// the stage-1 budget (2e-6 + 2e-5|r|) the f32 meaning itself uses against the origin f64 reference.
import { readFileSync } from 'node:fs';
const D = process.argv[2], REPO = process.argv[3];
const { compileTix, optimizeTix } = await import(D + '/tensor/index.js');
const { evaluate, OutsideSample, size } = await import(D + '/tensor/evaluate.js');
const { seededRandom } = await import(D + '/framework/contracts/index.js');
const { plain, value } = await import(D + '/tensor/model.js');
const half = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];
function cases(fn, random, streams) {
  const symbols = [...new Set(fn.params.flatMap(p => p.shape.map(plain).filter(n => !!n)))].sort();
  const seen = new Set(), out = [];
  for (const n of [1, 3, 4, 7, 'mixed']) {
    const sv = symbols.map((_, i) => (n === 'mixed' ? [3, 5, 7][i % 3] : n));
    const key = JSON.stringify(sv); if (seen.has(key)) continue; seen.add(key);
    const dims = new Map(symbols.map((s, i) => [s, sv[i]]));
    const shapes = fn.params.map(p => p.shape.map(d => value(d, dims)));
    if (shapes.some(s => s.some(x => x < 0) || size(s) > 4096)) continue;
    for (const stream of streams) {
      const inputs = Object.create(null);
      fn.params.forEach((p, j) => {
        const shape = shapes[j];
        inputs[p.name] = { shape, data: Float32Array.from({ length: size(shape) }, (_, i) =>
          stream === 'signed' ? 2 * random() - 1 : stream === 'positive' ? 0.25 + 0.75 * random() : stream === 'zero' ? (i % 2 ? -0 : 0) : half[i % half.length]) };
      });
      try { const ref = evaluate(fn, inputs, 'f64', true); if (!ref.data.every(Number.isFinite)) continue; out.push({ sv, stream, inputs, ref }); }
      catch (e) { if (!(e instanceof OutsideSample)) throw e; }
    }
  }
  return out;
}
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const p0 = compileTix(readFileSync(`${REPO}/corpus/tensor/${name}/main.tix`, 'utf8'));
  const variants = { origin: p0 };
  for (const passes of [['inline'], ['split-sum'], ['inline', 'split-sum']]) {
    const r = optimizeTix(p0, passes); variants[passes.join('+') + ':' + r.steps.map(s => s.accepted ? 'ok' : 'rej').join(',')] = r.program;
  }
  const fnO = p0.origin.value.functions[0];
  const cs = cases(fnO, seededRandom(20), ['signed', 'positive', 'half-ulp']);
  for (const [label, prog] of Object.entries(variants)) {
    const fn = prog.current.value.functions[0];
    let worst = 0, where = '', fails = 0, n = 0;
    for (const c of cs) {
      const got = evaluate(fn, c.inputs, 'f32');
      for (let i = 0; i < c.ref.data.length; i++) {
        const r = c.ref.data[i], g = got.data[i], allowed = 2e-6 + 2e-5 * Math.abs(r);
        const f = Math.abs(g - r) / allowed; n++;
        if (f > 1) fails++;
        if (f > worst) { worst = f; where = `${c.stream} ${JSON.stringify(c.sv)} [${i}] r=${r} f32=${g}`; }
      }
    }
    console.log(`${name.padEnd(9)} ${label.padEnd(26)} cases=${cs.length} elems=${n} f32-over-budget=${fails} worst=${worst.toFixed(4)} ${where}`);
  }
}
