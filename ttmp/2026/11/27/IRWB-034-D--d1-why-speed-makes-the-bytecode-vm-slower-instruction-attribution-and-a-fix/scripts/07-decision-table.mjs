// IRWB-034-D probe 7: the report's tables, from the JSON that 04-attribution.mjs dumps.
//   * one row per licm decision: the hoisted statement, the instructions it is charged with, the r0 statement it
//     was taken from (the opcode arm), that statement's instructions at r0 and at the head, and the difference;
//   * the per-pass roll-up of the difference against r0.
// Usage: node ttmp/2026/11/27/IRWB-034-D--*/scripts/07-decision-table.mjs scripts/out/attribution-before.json [...more]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const here = fileURLToPath(new URL('.', import.meta.url));
const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node 07-decision-table.mjs <attribution.json> [...]');
  process.exit(2);
}
for (const f of files) {
  const d = JSON.parse(readFileSync(f.startsWith('/') ? f : join(here, f), 'utf8'));
  console.log(`\n### ${d.project} / ${d.pipeline} (${f})`);
  for (const run of d.runs) {
    const byRoot = new Map(run.deltas.map(x => [x.root, x]));
    const rows = run.aN.credits.filter(c => c.pass === 'licm');
    console.log(
      `\nentry ${run.entry}: r0 ${run.r0} -> head ${run.head} (${run.head - run.r0 >= 0 ? '+' : ''}${run.head - run.r0}); credited ${run.aN.total}; by pass ${run.aN.byPass.map(p => `${p.pass} ${p.insns}`).join(', ')}`,
    );
    if (!rows.length) {
      console.log('  licm hoisted nothing: no instruction is credited to it');
    } else {
      console.log(`\n| hoisted statement | insns at the head | from (r0 statement) | r0 | head | Δ |`);
      console.log(`| --- | ---: | --- | ---: | ---: | ---: |`);
      for (const c of rows) {
        const root = c.roots[0];
        const delta = byRoot.get(root);
        console.log(
          `| ${c.statement} (\`${c.note ?? ''}\`) | ${c.insns} | ${root} | ${delta?.base ?? 0} | ${delta?.next ?? 0} | ${delta ? (delta.delta >= 0 ? '+' : '') + delta.delta : '?'} |`,
        );
      }
    }
    const rolled = new Map();
    for (const x of run.deltas) rolled.set(x.pass, (rolled.get(x.pass) ?? 0) + x.delta);
    console.log(
      `\ndifference against r0 by pass: ${[...rolled]
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(([p, n]) => `${p} ${n >= 0 ? '+' : ''}${n}`)
        .join(', ')} (sum ${run.deltas.reduce((n, x) => n + x.delta, 0)})`,
    );
  }
}
