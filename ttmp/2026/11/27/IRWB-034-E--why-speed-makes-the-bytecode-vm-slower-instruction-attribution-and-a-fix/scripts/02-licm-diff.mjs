/**
 * 02 — What did the licm revision (r4) change? Image diff r3 -> r4 for runVm, kinds of added/removed
 * instructions, their `why` provenance, and the backend's spill/frame facts.
 */
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { lowerToImage, runImage, heat } = await import('../../../../../../dist/typed/backend/index.js');

const id = 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const backendOptions = { coalesce: true };

const p = Program.fromProject(project);
await p.pipeline('speed');
const base = storeOf(p.origin.value);

const images = {};
for (const i of [3, 4]) images[i] = lowerToImage(p.artifact(i), backendOptions).image;

// spills/frame facts
for (const i of [3, 4]) {
  const f = images[i].value.fns["runVm"];
  console.log(`r${i}: bytes=${images[i].value.bytes} insns=${f.insns} frame=${f.frame} spills=${f.spills} vregs=${f.vregs} regs=${f.regs?.length}`);
}

const { diffImages } = await import('../../../../../../dist/typed/backend/index.js');
const d = diffImages(images[3], images[4], 'runVm');
console.log(`diff r3->r4: same=${d.same} removed=${d.removed} added=${d.added}`);
const removedKinds = {}, addedKinds = {};
for (const r of d.rows) {
  if (r.op === '-') removedKinds[r.a.op] = (removedKinds[r.a.op] || 0) + 1;
  if (r.op === '+') addedKinds[r.b.op] = (addedKinds[r.b.op] || 0) + 1;
}
console.log('removed kinds:', removedKinds);
console.log('added kinds:', addedKinds);

// why of added instructions
const whys = {};
for (const r of d.rows) if (r.op === '+' && r.b.why) whys[r.b.why] = (whys[r.b.why] || 0) + 1;
console.log('added whys:', whys);

// heat delta per statement: run both fixtures, attribute counts through covers
for (const [entry, label] of [[0, 'fib'], [34, 'checksum']]) {
  const c = benchCase(base, 'runVm', { code: project.meta.inputs.runVm.code, entry, n: 12, seed: 8 });
  const heats = {};
  for (const i of [3, 4]) {
    const run = runImage(images[i], 'runVm', c.args, c.memory, {});
    const h = heat(storeOf(p.artifact(i).value), images[i], run.counts);
    heats[i] = h;
    const covered = [...h.byStmt.values()].reduce((a, b) => a + b, 0);
    console.log(`r${i} ${label}: steps=${run.steps} covered-by-stmts=${covered} uncovered=${run.steps - covered} spills-execd=?`);
  }
  // statements that gained or lost executions
  const gains = [];
  const map = new Map(heats[4].byStmt);
  for (const [sid, n] of map) {
    const old = heats[3].byStmt.get(sid) ?? 0;
    if (n - old !== 0) gains.push({ sid, old, new: n, delta: n - old });
  }
  const removedHeat = [...heats[3].byStmt].filter(([sid]) => !map.has(sid));
  gains.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log(`--- ${label}: statements with changed executions (top 25 of ${gains.length})`);
  for (const g of gains.slice(0, 25)) console.log(`  ${g.sid}  ${g.old} -> ${g.new}  (${g.delta >= 0 ? '+' : ''}${g.delta})`);
  const lost = removedHeat.reduce((a, [, n]) => a + n, 0);
  console.log(`  heat on statements removed by licm: ${lost}`);
}
