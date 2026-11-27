// IRWB-030-G script 04: exactness of the lowering on the GB10.
//
// For each program: `checkLowering` fused and unfused (the contract's cases, exact relation), then one full-size
// run of each and a word-by-word comparison of the two outputs, plus each output's SHA-256. The full-size run is
// what the timing harness uses, so this script ties the timed kernel to the checked one.
//
//   node <ticket>/scripts/04-check.mjs [--set=main|probe|all] [--only=<substring>] [--model=<path>]
//
// --model compares both GPU outputs against the f32 interpreter as well (minutes for the big programs).
import { createHash } from 'node:crypto';
import { checkLowering, runTix, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { corpusSizes, inputsFor, load } from './01-bench.mjs';

const here = new URL('./', import.meta.url).pathname;
const cases = [];
const add = (program, sizes, extra = {}) => cases.push({ program, sizes, ...extra });
for (const name of Object.keys(corpusSizes)) add(name, corpusSizes[name]);
add(here + '01-layernorm-inside.tix', { N: 4096, D: 1024 }, { fn: 'layernorm_inside' });
add(here + '01-attention-inside.tix', { Q: 1024, K: 1024, D: 64, V: 64 }, { fn: 'attention_inside' });
const main = cases.length;
add(here + '01-softmax-exp-in-sum.tix', { N: 4096, C: 1024 }, { fn: 'softmax_exp_in_sum' });
add(here + '03-multi-axis.tix', { N: 256, C: 64, D: 32 }, { fn: 'multi' });
add('softmax', { N: 2 ** 19, C: 4 });
add('softmax', { N: 1, C: 65536 });
add(here + '01-layernorm-inside.tix', { N: 64, D: 16384 }, { fn: 'layernorm_inside' });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const only = flag('only');
const set = flag('set', 'all');
const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const sha = ({ data }) => createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex').slice(0, 16);

let i = 0;
for (const c of cases) {
  const group = i++ < main ? 'main' : 'probe';
  if (set !== 'all' && set !== group) continue;
  if (only && !c.program.includes(only)) continue;
  const { program, fn } = load(c.program, c.fn);
  const inputs = inputsFor(program, fn, c.sizes);
  const label = `${c.program.split('/').at(-1)}${c.fn ? '#' + c.fn : ''} ${JSON.stringify(c.sizes)}`;
  const verdict = { case: label, set: group };
  for (const fuse of [true, false]) {
    verdict[fuse ? 'fused' : 'unfused'] = await checkLowering(program, fn, { fuse });
    if (!verdict[fuse ? 'fused' : 'unfused'].reason) delete verdict[fuse ? 'fused' : 'unfused'].reason;
  }
  const fused = await runTixCuda(program, fn, inputs);
  const unfused = await runTixCuda(program, fn, inputs, { fuse: false });
  const a = words(fused),
    b = words(unfused);
  verdict.equal = a.length === b.length && a.every((w, k) => w === b[k] || (Number.isNaN(w) && Number.isNaN(b[k])));
  verdict.sha = [sha(fused), sha(unfused)];
  if (args.some(a => a.startsWith('--model'))) {
    const model = runTix(program, fn, inputs);
    const m = words(model);
    verdict.model = m.length === a.length && m.every((w, k) => w === a[k] || (Number.isNaN(w) && Number.isNaN(a[k])));
  }
  console.log(JSON.stringify(verdict));
}
