// IRWB-030-E script 03: which reduction bodies should have their terms staged? Times the fused source of a
// program with the plan's staged terms ("staged"), with none ("serial": stage 3's thread-0 loop), and with a
// chosen subset (--keep=statement,statement: only these statements' terms stay staged).
//   node <ticket>/scripts/03-staging-rule.mjs [--calls=N] [--keep=a,b] [--sizes=N=..,C=..] name ...
// Programs and inputs are script 01's. Each call is one `benchmark` run (warm-up, median of three, --timed).
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { digest, inputsFor, median, programs } from './01-benchmark.mjs';

const args = process.argv.slice(2);
const flag = n => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const calls = Number(flag('calls') ?? 3);
const keep = flag('keep')?.split(',');
const sizes = Object.fromEntries((flag('sizes') ?? '').split(',').filter(Boolean).map(kv => kv.split('=')).map(([k, v]) => [k, Number(v)]));
for (const name of args.filter(a => !a.startsWith('--'))) {
  const spec = programs[name];
  const program = compileTix(spec.source);
  const { fn, inputs } = inputsFor(program, spec.fn ?? name, { ...spec.sizes, ...sizes });
  const plan = planFusion(fn);
  const variants = {
    staged: plan,
    serial: { ...plan, groups: plan.groups.map(g => ({ ...g, terms: [] })) },
    ...(keep ? { keep: { ...plan, groups: plan.groups.map(g => ({ ...g, terms: g.terms.filter(t => keep.includes(t.statement)) })) } } : {}),
  };
  const row = { name, sizes: { ...spec.sizes, ...sizes }, terms: plan.groups.flatMap(g => g.terms.map(t => `${t.statement}/${t.reduction}`)) };
  for (const [label, p] of Object.entries(variants)) {
    const source = emitCuda(fn, p);
    const times = [];
    let sha;
    for (let c = 0; c < calls; c++) {
      const [result] = await runCudaBatch(source, fn, [inputs], { benchmark: true });
      times.push(+result.gpuMs.toFixed(4));
      sha = digest(result).slice(0, 12);
    }
    row[label] = { ms: median(times), times, sha };
  }
  row.equal = new Set(Object.values(variants).map((_, i) => row[Object.keys(variants)[i]].sha)).size === 1;
  console.log(JSON.stringify(row));
}
