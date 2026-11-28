// IRWB-050-A probe 01: the Tix evaluator's speed before and after the stdlib/num extraction.
// The evaluator runs inside every meaning check, so its per-element operations (here: the `max`
// reduction of `attention`, today `Math.max`, after the change the library's `maximum`) must not
// slow down. One corpus program (attention), f32 precision, one fixed input set; the run reports
// the median of BATCHES batches of RUNS evaluate() calls, as µs per run, so before/after numbers
// are comparable on this shared machine.
//
// Usage: node 01-evaluator-speed.mjs          (prints one line: median µs/run, plus batch detail)
import { hrtime } from 'node:process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const { compileTix, runTix } = await import(root + 'dist/tensor/index.js');

const source = readFileSync(root + 'corpus/tensor/attention/main.tix', 'utf8');
const program = compileTix(source);
const Q = 32,
  K = 32,
  D = 32,
  V = 32;
const fill = (shape, f) => ({
  shape,
  data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, (_, i) => f(i)),
});
const inputs = {
  q: fill([Q, D], i => ((i * 37) % 31) / 31 - 0.5),
  k: fill([K, D], i => ((i * 17) % 13) / 13 - 0.5),
  v: fill([K, V], i => ((i * 11) % 7) / 7 - 0.5),
};

// Warm up (JIT) and a correctness smoke test: the value must not be NaN.
const one = runTix(program, 'attention', inputs, { precision: 'f32' });
if (!one.data.every(Number.isFinite)) throw Error('attention produced a non-finite value');
for (let i = 0; i < 3; i++) runTix(program, 'attention', inputs, { precision: 'f32' });

const RUNS = 5,
  BATCHES = 9;
const batches = [];
for (let b = 0; b < BATCHES; b++) {
  const t0 = hrtime.bigint();
  for (let r = 0; r < RUNS; r++) runTix(program, 'attention', inputs, { precision: 'f32' });
  batches.push(Number(hrtime.bigint() - t0) / 1e3 / RUNS); // µs per evaluate()
}
batches.sort((a, b) => a - b);
const median = batches[(BATCHES - 1) >> 1];
// The machine is shared, so the minimum batch is the least contaminated estimate; both are printed.
console.log(
  `attention f32 evaluate: median ${median.toFixed(0)} µs/run, best ${batches[0].toFixed(0)} µs/run over ${BATCHES} batches of ${RUNS}`,
);
console.log('batches (µs/run): ' + batches.map(x => x.toFixed(0)).join(' '));
