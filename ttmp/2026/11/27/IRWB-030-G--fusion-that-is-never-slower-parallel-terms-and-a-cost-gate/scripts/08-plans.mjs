// IRWB-030-G script 08: the plan of every program of the stage, as a markdown table: which kernels a lowering
// emits, the mapping of each, which reductions compute their terms in parallel, which stayed serial and why, and
// which groups the cost gate kept out of block mode.
//
//   node <ticket>/scripts/08-plans.mjs [--json]   (markdown to stdout; the committed copy is 08-plans.out.txt)
import { planFusion, unfusedPlan } from '../../../../../../dist/tensor/fusion.js';
import { corpusSizes, load } from './01-bench.mjs';

const here = new URL('./', import.meta.url).pathname;
const cases = [];
const add = (program, sizes, fn) => cases.push({ program, sizes, fn });
for (const name of Object.keys(corpusSizes)) add(name, corpusSizes[name]);
add(here + '01-layernorm-inside.tix', { N: 4096, D: 1024 }, 'layernorm_inside');
add(here + '01-attention-inside.tix', { Q: 1024, K: 1024, D: 64, V: 64 }, 'attention_inside');
add(here + '01-softmax-exp-in-sum.tix', { N: 4096, C: 1024 }, 'softmax_exp_in_sum');
add(here + '06-long-term.tix', { N: 2048, D: 1024, C: 8 }, 'longterm');
for (const c of [4, 8, 16, 32, 64]) add('softmax', { N: 2 ** 21 / c, C: c });

const markdown = !process.argv.includes('--json');
const rows = [];
for (const c of cases) {
  const { program, fn } = load(c.program, c.fn);
  const f = program.current.value.functions.find(x => x.name === fn);
  const fused = planFusion(f, c.sizes);
  const unfused = unfusedPlan(f);
  rows.push({
    program: fn,
    sizes: c.sizes,
    fused: fused.groups.map(g => ({
      kernel: g.kernel,
      mapping: g.mapping,
      depth: g.depth,
      statements: g.statements,
      terms: g.terms.map(t => `${t.member}:${t.reduction}`),
      serial: g.serial.map(s => `${s.member}:${s.reduction}`),
      stored: g.stored,
      staged: g.staged,
    })),
    gate: fused.gate.map(g => ({ statements: g.statements, width: g.width })),
    unfusedKernels: unfused.groups.length,
  });
}
if (!markdown) console.log(JSON.stringify(rows, null, 1));
else {
  console.log('| Program (shape values) | Kernels fused / stage 2 | Block-mode kernels and their reductions |');
  console.log('| --- | ---: | --- |');
  for (const r of rows) {
    const detail = r.fused
      .map(g => {
        if (g.mapping !== 'block') return `${g.kernel} thread ${g.statements.join(',')}`;
        const terms = g.terms.length ? `parallel terms ${g.terms.join(' ')}` : 'no parallel terms';
        const serial = g.serial.length ? `; serial ${g.serial.join(' ')}` : '';
        return `${g.kernel} block[${g.depth}] ${g.statements.join(',')}: ${terms}${serial}`;
      })
      .join('<br>');
    const gate = r.gate.length
      ? ` — **gated** (${r.gate.map(g => `width ${g.width}`).join(', ')}): ${r.gate.flatMap(g => g.statements).join(',')}`
      : '';
    console.log(
      `| ${r.program} (${Object.entries(r.sizes).map(([k, v]) => `${k}=${v}`).join(', ')}) | ` +
        `${r.fused.length} / ${r.unfusedKernels} | ${detail}${gate} |`,
    );
  }
}
