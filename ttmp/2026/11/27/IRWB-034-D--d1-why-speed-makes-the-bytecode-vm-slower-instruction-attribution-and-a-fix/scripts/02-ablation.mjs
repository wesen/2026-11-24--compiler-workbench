// IRWB-034-D probe 2: an ablation over the speed pipeline for the bytecode VM, and the licm decisions it made.
// Each row applies the pipeline with one pass left out (or a single pass alone) and measures RV32 instructions.
// Usage: node ttmp/2026/11/27/IRWB-034-D--*/scripts/02-ablation.mjs
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const { projectAllFiles } = await import(join(root, 'tools/corpus.mjs'));
const { installVendor } = await import(join(root, 'tools/node-vendor.mjs'));

await installVendor({ reference: true });
const { Program } = await import(join(root, 'dist/typed/program.js'));
const { projectSource } = await import(join(root, 'dist/typed/project.js'));
const { PIPELINES } = await import(join(root, 'dist/typed/passes.js'));
const { lowerToImage, runImage } = await import(join(root, 'dist/typed/backend/index.js'));
const { benchCase } = await import(join(root, 'dist/typed/evaluate.js'));
const { storeOf } = await import(join(root, 'dist/typed/ir.js'));

const id = 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const inputs = project.meta.inputs.runVm;
const speed = PIPELINES.speed;

function measureProgram(p) {
  const image = lowerToImage(p.head, { coalesce: true }).image;
  const st = storeOf(p.head.value);
  let total = 0;
  const per = {};
  for (const entry of [0, 34]) {
    const c = benchCase(st, 'runVm', { code: inputs.code, entry, n: 12, seed: 8 });
    const r = runImage(image, 'runVm', c.args, c.memory);
    per[entry] = r.steps;
    total += r.steps;
  }
  return { ...per, total };
}

async function runPasses(names) {
  const p = Program.fromProject(project);
  const steps = await p.pipeline(names, { count: 40 });
  const rejected = steps.steps.filter(s => s.rejected);
  if (rejected.length) throw new Error(`rejected: ${JSON.stringify(rejected)}`);
  return { p, measured: measureProgram(p), passes: p.revisionList().map(r => r.pass) };
}

const r0 = await runPasses([]);
console.log(`r0: fib ${r0.measured[0]} checksum ${r0.measured[34]} total ${r0.measured.total}`);
const full = await runPasses(speed);
console.log(`speed: fib ${full.measured[0]} checksum ${full.measured[34]} total ${full.measured.total}`);
console.log(`  passes that changed something: ${full.passes.slice(1).join(' ')}`);

// leave one changing pass out at a time
for (const pass of [...new Set(full.passes.slice(1))]) {
  const variant = await runPasses(speed.filter(n => n !== pass));
  console.log(
    `without ${pass.padEnd(9)}: fib ${variant.measured[0]} checksum ${variant.measured[34]} total ${variant.measured.total}`,
  );
}

// the single passes that changed something, applied alone to r0
for (const pass of ['cfg', 'fold', 'licm', 'subst', 'bce', 'rotate', 'lvn', 'strength']) {
  const one = await runPasses([pass]);
  console.log(
    `only ${pass.padEnd(9)}: fib ${one.measured[0]} checksum ${one.measured[34]} total ${one.measured.total}`,
  );
}

// licm's decisions, as the pass recorded them
{
  const p = Program.fromProject(project);
  await p.pipeline(speed, { count: 40 });
  const rev = p.revisionList().find(r => r.pass === 'licm');
  const licmRev = Number(rev.rev.replace('r', ''));
  const edits = p.edits(licmRev);
  const kinds = {};
  for (const e of edits) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  console.log(`\nlicm (r${licmRev}) edits by kind: ${JSON.stringify(kinds)}`);
  for (const e of edits.filter(e => e.kind === 'insert' || e.note))
    console.log(`  ${e.kind} ${JSON.stringify({ stmt: e.stmt, block: e.block, note: e.note, because: e.because })}`);
}
