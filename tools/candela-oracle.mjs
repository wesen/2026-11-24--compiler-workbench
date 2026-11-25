// The evaluator at r0 against the reference: Candela compiled by the repository's own RV32 compiler (typed-rv32.js,
// policy stock) and run on the reference interpreter, on the evaluator's generated cases.
//   node tools/candela-oracle.mjs [--count N] [--seed S] [--scalar] [--json] [fn...]
// --scalar: only functions whose parameters are all scalars (i32, u32, bool, f32). --random: K and buffer parameters
// as the evaluator generates them by default (random words: mostly traps), not candelaInputs' row buffers.
import { installVendor } from './node-vendor.mjs';
import { candelaInputs, candelaSource, MAX_SOURCE } from './candela.mjs';

await installVendor({ reference: true });
const { ingest } = await import('../dist/typed/lift.js');
const { casesFrom, evaluate, agrees } = await import('../dist/typed/evaluate.js');
const { referenceCompile, referenceRun } = await import('../dist/typed/reference.js');

const args = process.argv.slice(2);
const flag = (name, d) => (args.includes(name) ? +args[args.indexOf(name) + 1] : d);
const count = flag('--count', 40), seed = flag('--seed', 7), json = args.includes('--json'), scalar = args.includes('--scalar');
const only = args.filter((a, i) => !a.startsWith('--') && !['--count', '--seed'].includes(args[i - 1]));

/** Compare one function over generated cases; returns per-function tallies and the first disagreements. */
export function compareFunction(st, program, fn, { count, seed, inputs = {} }) {
  const row = { fn, cases: 0, values: 0, traps: 0, agree: 0, disagree: 0, inconclusive: 0, faults: 0, examples: [] };
  for (const c of casesFrom(st, fn, { count, seed, inputs: inputs[fn] ?? {} })) {
    row.cases++;
    const ours = evaluate(st, fn, c.args, c.memory, { limit: 2e5 });
    const ref = referenceRun(program, fn, c.args, c.memory, { limit: 2e7 });
    if (ours.limit || ref.limit) {
      row.inconclusive++;
      continue;
    }
    if (ref.fault) row.faults++;
    const ok = agrees(ref, ours);
    if (ok) {
      row.agree++;
      if (ref.trap) row.traps++;
      else row.values++;
    } else {
      row.disagree++;
      if (row.examples.length < 3)
        row.examples.push({ n: c.n, args: c.args, ours: ours.trap || ours.result, ref: ref.trap || ref.result });
    }
  }
  return row;
}

const scalarTypes = new Set(['i32', 'u32', 'bool', 'f32']);
const source = candelaSource();
const t0 = performance.now();
const st = ingest('candela', source, { tape: true, maxSourceLength: MAX_SOURCE });
const program = referenceCompile(source, { maxSourceLength: MAX_SOURCE, policy: 'stock' });
const names = only.length ? only : [...st.fns.keys()].filter(n => !scalar || st.fn(n).params.every(t => scalarTypes.has(t)));
const inputs = args.includes('--random') ? {} : candelaInputs(st);
const rows = names.map(fn => compareFunction(st, program, fn, { count, seed, inputs }));
const total = rows.reduce(
  (s, r) => {
    for (const k of ['cases', 'values', 'traps', 'agree', 'disagree', 'inconclusive', 'faults']) s[k] += r[k];
    return s;
  },
  { functions: rows.length, cases: 0, values: 0, traps: 0, agree: 0, disagree: 0, inconclusive: 0, faults: 0 },
);
total.allValueFunctions = rows.filter(r => r.values > 0).length;
total.ms = Math.round(performance.now() - t0);
if (json) console.log(JSON.stringify({ total, rows }, null, 2));
else {
  for (const r of rows.filter(r => r.disagree)) console.log(r.fn, JSON.stringify(r.examples));
  console.log(JSON.stringify(total));
}
