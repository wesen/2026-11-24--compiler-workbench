// The fusion ledger: what each corpus program's fused lowering actually consists of, and the fusions that were
// refused, with the rule that refused each one.
//
//   node <ticket>/scripts/07-fusion-ledger.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix } = await import(new URL('dist/tensor/index.js', root));
const { planFusion } = await import(new URL('dist/tensor/fusion.js', root));

const describe = kernel =>
  kernel.kind === 'flat'
    ? `flat, ${kernel.inline.length} inlined [${kernel.inline.map(s => s.name).join(',')}], writes ${kernel.anchor.name}`
    : `row, blocks over [${kernel.rows.map(a => a.id).join(',')}], ${kernel.threads} threads, ` +
      `${kernel.slots.length} shared slots [${kernel.slots.map((s, i) => `${i}:${s.kind}`).join(' ')}]\n` +
      kernel.phases
        .map(
          phase =>
            '      ' +
            (phase.kind === 'stage'
              ? `stage ${phase.tensor} -> slot ${phase.slot}`
              : `${phase.kind} ${phase.statement.name} -> ${phase.dest.kind}` +
                (phase.dest.kind === 'shared' ? ` ${phase.dest.slot}` : '')),
        )
        .join('\n');

for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = compileTix(await readFile('corpus/tensor/' + name + '/main.tix', 'utf8'));
  const fn = program.current.value.functions[0];
  console.log(`${name}: ${fn.statements.length} statements -> ${planFusion(fn).length} kernels`);
  planFusion(fn).forEach((kernel, i) => console.log(`  k${i}: ${describe(kernel)}`));
  const staged = new Set(planFusion(fn).flatMap(k => (k.kind === 'row' ? [...k.staged.keys()] : [])));
  if (staged.size) console.log(`  staged in shared memory: ${[...staged].join(', ')}`);
  const inlined = new Set(planFusion(fn).flatMap(k => (k.kind === 'flat' ? k.inline.map(s => s.name) : [])));
  if (inlined.size) console.log(`  inlined: ${[...inlined].join(', ')}`);
}

console.log(`
refused, with the rule that refused each one:
  * a rank-1 per-row value inlined into a rank-2 consumer (softmax m[i], layernorm mean/variance): the flat rule
    needs a bijection onto the consumer's free axes, and inlining here would re-evaluate the whole row per element.
    The row policy stages the value as a shared scalar instead.
  * a contraction's input inlined into the next contraction (mlp g inside y's sum(k)): the load sits at a reduction
    binder, so the map is not onto the consumer's free axes and the reduction would be re-evaluated H times per
    element. The row policy stages g's row instead.
  * a per-row value read at another row's coordinate (m[j] of a square program): no layout can serve it inside one
    block, so no fusion.
  * a transposed staged read (p[i,j] read as p[j,i] by the group): staging assumes the row's own coordinates, so the
    row policy declines; the flat policy declines too if the producer is read twice.
  * gamma[j], beta[j], eps[0], bias[j], w[d,j], v[k,c], k[j,d]: not staged, and not a fusion question. These are
    indexed by a constant, by a column, or by a reduction binder, so a row copy would not describe their addresses.
    They stay global loads, which is what stage 2 did and what the compiler can coalesce or hit in L2.
`);
