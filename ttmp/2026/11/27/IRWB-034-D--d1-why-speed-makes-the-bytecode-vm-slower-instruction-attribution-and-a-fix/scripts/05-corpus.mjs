// IRWB-034-D probe 5: RV32 instructions per corpus project under O2 and under speed, on the pipelines' own
// generated cases (10 per function, seed 7, the measure() defaults), with every pass's meaning check recorded.
// Usage: node ttmp/2026/11/27/IRWB-034-D--*/scripts/05-corpus.mjs [--out FILE] [--only a,b,c] [--count N]
// Writes JSON to --out (default: the ticket's scripts/corpus-<timestamp>.json) and a markdown table to stdout.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const { projectIds, projectFiles } = await import(join(root, 'tools/corpus.mjs'));
const { installVendor } = await import(join(root, 'tools/node-vendor.mjs'));

await installVendor();
const { Program } = await import(join(root, 'dist/typed/program.js'));
const { projectSource } = await import(join(root, 'dist/typed/project.js'));
const S = await import(join(root, 'dist/typed/strategies.js'));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const only = arg('only', '')
  ? new Set(arg('only', '').split(','))
  : undefined;
const count = Number(arg('count', '40'));
const out = arg('out', join(root, 'ttmp/2026/11/27', 'corpus.json'));

const ids = projectIds().filter(id => !only || only.has(id));
const rows = [];
const t0 = Date.now();
for (const id of ids) {
  const ps = projectSource(id, projectFiles(id));
  const row = { id, status: {}, instructions: {}, bytes: {}, rejected: {} };
  for (const pipeline of ['O2', 'speed']) {
    const p = Program.fromProject(ps);
    const steps = await p.pipeline(pipeline, { count });
    row.status[pipeline] = p.status;
    row.rejected[pipeline] = steps.steps
      .filter(s => s.rejected)
      .map(s => `${s.pass}: ${s.rejected}`);
    const m = S.measure(p, p.head);
    row.instructions[pipeline] = m.instructions;
    row.bytes[pipeline] = m.bytes;
  }
  const r0 = Program.fromProject(ps);
  const m0 = S.measure(r0, r0.head);
  row.instructions.r0 = m0.instructions;
  row.bytes.r0 = m0.bytes;
  rows.push(row);
  console.error(
    `${id.padEnd(18)} r0 ${String(row.instructions.r0).padStart(7)}  O2 ${String(row.instructions.O2).padStart(7)}  speed ${String(row.instructions.speed).padStart(7)}  ${Object.values(row.rejected).flat().length ? 'REJECTED' : ''}`,
  );
}
const sum = k => rows.reduce((n, r) => n + r.instructions[k], 0);
const total = { r0: sum('r0'), O2: sum('O2'), speed: sum('speed'), projects: rows.length, ms: Date.now() - t0 };
writeFileSync(out, JSON.stringify({ total, rows }, null, 1));
console.log(
  `\n${rows.length} projects: r0 ${total.r0}, O2 ${total.O2}, speed ${total.speed} instructions (${total.ms} ms)`,
);
console.log(`\n| project | r0 | O2 | speed | speed − O2 |`);
console.log(`| --- | ---: | ---: | ---: | ---: |`);
for (const r of rows)
  console.log(
    `| ${r.id} | ${r.instructions.r0} | ${r.instructions.O2} | ${r.instructions.speed} | ${r.instructions.speed - r.instructions.O2} |`,
  );
console.log(`| **total** | ${total.r0} | ${total.O2} | ${total.speed} | ${total.speed - total.O2} |`);
console.log(`\nwrote ${out}`);
