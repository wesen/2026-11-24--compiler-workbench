// IRWB-034-D probe 4: the attribution table for the bytecode VM under the speed pipeline.
//   * executed RV32 instructions credited to the pass that placed each statement (and to the r0 statements it
//     descends from), for both fixtures;
//   * the difference against r0, per r0 root and per pass.
// Usage: node ttmp/2026/11/27/IRWB-034-D--*/scripts/04-attribution.mjs [project] [pipeline] [top rows, 0 = all]
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const { projectAllFiles } = await import(join(root, 'tools/corpus.mjs'));
const { installVendor } = await import(join(root, 'tools/node-vendor.mjs'));

await installVendor({ reference: true });
const { Program } = await import(join(root, 'dist/typed/program.js'));
const { projectSource } = await import(join(root, 'dist/typed/project.js'));
const { benchCase } = await import(join(root, 'dist/typed/evaluate.js'));
const { storeOf } = await import(join(root, 'dist/typed/ir.js'));
const { lowerToImage, runImage } = await import(join(root, 'dist/typed/backend/index.js'));
const A = await import(join(root, 'dist/typed/attribution.js'));

const id = process.argv[2] ?? 'bytecode-vm';
const pipelineName = process.argv[3] ?? 'speed';
const top = Number(process.argv[4] ?? 16);
const jsonPath = process.argv[5];
const project = projectSource(id, projectAllFiles(id));
const inputs = project.meta.inputs.runVm;
const p = Program.fromProject(project);
const steps = await p.pipeline(pipelineName, { count: 40 });
console.log(
  `${id} / ${pipelineName} -> ${steps.rev}; changed: ${p
    .revisionList()
    .slice(1)
    .map(r => r.pass)
    .join(' ')}`,
);
const chain = A.chainOf(p);
const lineage = A.lineageOf(chain);
console.log(`lineage: ${chain.length} steps, gaps ${lineage.gaps}`);

const images = new Map();
const imageAt = at => {
  if (!images.has(at)) images.set(at, lowerToImage(chain[at].artifact, { coalesce: true }).image);
  return images.get(at);
};

const dump = [];
for (const entry of [0, 34]) {
  const call = benchCase(storeOf(p.origin.value), 'runVm', { code: inputs.code, entry, n: 12, seed: 8 });
  const base = runImage(imageAt(0), 'runVm', call.args, call.memory);
  const head = runImage(imageAt(chain.length - 1), 'runVm', call.args, call.memory);
  const a0 = A.attributeRun(lineage, 0, { image: imageAt(0), counts: base.counts });
  const aN = A.attributeRun(lineage, chain.length - 1, {
    image: imageAt(chain.length - 1),
    counts: head.counts,
  });
  const ok = a0.total === base.steps && aN.total === head.steps;
  console.log(
    `\n=== entry ${entry}: r0 ${base.steps} (attributed ${a0.total}) head ${head.steps} (attributed ${aN.total}) ${ok ? 'ok' : 'MISMATCH'}, unattributed ${a0.unattributed}/${aN.unattributed}`,
  );
  console.log(`instructions by pass at the head: ${aN.byPass.map(r => `${r.pass} ${r.insns}`).join(', ')}`);
  console.log(`top credits (${top || 'all'}):`);
  for (const c of aN.credits.slice(0, top || aN.credits.length))
    console.log(
      `  ${String(c.insns).padStart(5)} ${c.statement.padEnd(16)} ${c.pass.padEnd(8)} roots=${c.roots.join(',')}${c.note ? ` — ${c.note}` : ''}`,
    );
  const deltas = A.deltaBetween(a0, aN);
  dump.push({ entry, r0: base.steps, head: head.steps, a0, aN, deltas });
  const sum = deltas.reduce((n, d) => n + d.delta, 0);
  console.log(`delta vs r0: ${sum} (expected ${head.steps - base.steps})`);
  console.log(
    `delta by pass: ${A.deltaByPass(deltas)
      .map(r => `${r.pass} ${r.delta >= 0 ? '+' : ''}${r.delta} (${r.rows} rows)`)
      .join(', ')}`,
  );
  for (const d of deltas.slice(0, top || deltas.length))
    console.log(
      `  ${d.delta >= 0 ? '+' : ''}${d.delta} ${d.root.padEnd(16)} ${d.pass.padEnd(8)} r0 ${d.base} -> head ${d.next}`,
    );
}

if (jsonPath) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(jsonPath, JSON.stringify({ project: id, pipeline: pipelineName, runs: dump }, null, 1));
  console.log(`wrote ${jsonPath}`);
}
