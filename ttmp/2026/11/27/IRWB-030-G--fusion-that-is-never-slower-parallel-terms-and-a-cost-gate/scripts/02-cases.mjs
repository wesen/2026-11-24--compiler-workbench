// IRWB-030-G script 02: the case table of the stage, measured fused and unfused.
//
// The first block is what the brief asks for (the six corpus programs and the two "inside" variants at the brief's
// sizes). The rest are probes: they look for programs where stage 3's fusion is slower than stage 2's lowering,
// which is what the cost gate has to decide about. Each case is one program at one set of shape values; a program
// is compiled once per lowering on the GPU machine and reused for every size, because the CUDA source depends on
// the Tix IR and not on the shape values.
//
//   node <ticket>/scripts/02-cases.mjs [--runs=3] [--only=<substring>] [--set=main|probe|all] [--json]
//
// Output: one JSON object per case, as script 01 prints them.
import { corpusSizes, inputsFor, load, measure } from './01-bench.mjs';

const here = new URL('./', import.meta.url).pathname;
const cases = [];
const add = (program, sizes, extra = {}) => cases.push({ program, sizes, ...extra });

for (const name of Object.keys(corpusSizes)) add(name, corpusSizes[name]);
add(here + '01-layernorm-inside.tix', { N: 4096, D: 1024 }, { fn: 'layernorm_inside' });
add(here + '01-attention-inside.tix', { Q: 1024, K: 1024, D: 64, V: 64 }, { fn: 'attention_inside' });
const main = cases.length;

// probes: where might fusion be slower than stage 2?
add(here + '01-softmax-exp-in-sum.tix', { N: 4096, C: 1024 }, { fn: 'softmax_exp_in_sum' });
// short rows: the same 2M elements in rows of 4 to 64
for (const c of [4, 8, 16, 32, 64]) add('softmax', { N: 2 ** 21 / c, C: c });
// short rows with an expensive term, which staging spreads over the block's lanes
for (const c of [4, 8, 16, 32]) add(here + '01-softmax-exp-in-sum.tix', { N: 2 ** 21 / c, C: c }, { fn: 'softmax_exp_in_sum' });
// short rows whose reduction is long enough to be staged, and whose row is not
for (const d of [8, 16, 32, 64]) add(here + '01-layernorm-inside.tix', { N: 2 ** 21 / d, D: d }, { fn: 'layernorm_inside' });
// few rows: the same 1024-wide rows, in 8 to 4096 of them
for (const n of [8, 64, 512]) add('softmax', { N: n, C: 1024 });
// one long row and a few long rows
add('softmax', { N: 1, C: 65536 });
add('softmax', { N: 64, C: 65536 });
// a long reduction with a costly term: 2 * 16384 staged floats per row, in 256 rows
add(here + '01-layernorm-inside.tix', { N: 256, D: 16384 }, { fn: 'layernorm_inside' });
// a short row whose staged reduction is long: the gate must measure the wider of the two
for (const c of [8, 16, 32]) add(here + '06-long-term.tix', { N: 2048, D: 1024, C: c }, { fn: 'longterm' });
// few rows of the attention-shaped program
add(here + '01-attention-inside.tix', { Q: 64, K: 1024, D: 64, V: 64 }, { fn: 'attention_inside' });
add('attention', { Q: 64, K: 1024, D: 64, V: 64 });
const probes = cases.length - main;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const runs = Number(flag('runs', 3));
const only = flag('only');
const set = flag('set', 'all');
const selected = cases.filter((c, i) => {
  const group = i < main ? 'main' : 'probe';
  if (set !== 'all' && set !== group) return false;
  return !only || c.program.includes(only);
});
const label = c => `${c.program.split('/').at(-1)}${c.fn ? '#' + c.fn : ''} ${JSON.stringify(c.sizes)}`;
let i = 0;
for (const c of selected) {
  const { program, fn } = load(c.program, c.fn);
  const inputs = inputsFor(program, fn, c.sizes);
  const row = await measure(program, fn, inputs, { runs });
  const tag = i < main ? 'main' : 'probe';
  console.log(
    JSON.stringify({
      case: label(c),
      set: tag,
      sizes: c.sizes,
      fused: row.fused && { kernels: row.fused.kernels, ms: round(row.fused.ms) },
      unfused: row.unfused && { kernels: row.unfused.kernels, ms: round(row.unfused.ms) },
      equal: row.equal,
      ratio: round(row.ratio),
      samples: row.fused && { fused: row.fused.samples.map(round), unfused: row.unfused.samples.map(round) },
    }),
  );
  i++;
}
function round(x) {
  return x === undefined ? x : Math.round(x * 10000) / 10000;
}
