// 04: per-trip cost: run each image at n = 0..12 and fit instructions = overhead + trips * perTrip.
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { BindingsIR } = await import('../../../../../../dist/typed/bindings.js');
import { createArtifact } from '../../../../../../dist/framework/contracts/index.js';
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');

const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const inputs = project.meta.inputs.runVm;
const cells = inputs.code.cells;
const facts = createArtifact(BindingsIR, 'f', {
  formatVersion: 1,
  source: 'fixture',
  bindings: [{ fn: 'runVm', param: 'code', cells, entity: 'x#code' }],
});

const p = Program.fromProject(project);
await p.apply('peval', { params: { bindings: facts, inputs: p.inputs } });
await p.pipeline('speed');
const pevalImage = lowerToImage(p.head, { coalesce: true }).image;

const r = Program.fromProject(project);
await r.pipeline('speed');
const speedImage = lowerToImage(r.head, { coalesce: true }).image;

const specializedSource = `
function seededFib(n: i32, seed: i32): i32 {
    let a = 0;
    let b = seed;
    for (let remaining = n; remaining > 0; remaining = remaining - 1) {
        const next = a + b;
        a = b;
        b = next;
    }
    return a;
}
function rollingChecksum(n: i32, seed: i32): i32 {
    let h = seed;
    for (let remaining = n; remaining > 0; remaining = remaining - 1) {
        h = h * 33 + remaining;
    }
    return h;
}
`;
const hand = Program.fromProject(
  projectSource('hand', { 'main.typed': specializedSource, 'project.json': JSON.stringify({ pipeline: 'speed' }) }),
);
await hand.pipeline('speed');
const handImage = lowerToImage(hand.head, { coalesce: true }).image;
const handStore = storeOf(hand.head.value);

const base = storeOf(r.artifact(0).value);
const rows = [];
for (const entry of [0, 34]) {
  const counts = { peval: [], speed: [], hand: [] };
  for (let n = 0; n <= 12; n++) {
    const c = benchCase(base, 'runVm', { code: { cells }, entry, n, seed: 8 });
    counts.peval.push(runImage(pevalImage, 'runVm', c.args, c.memory).steps);
    counts.speed.push(runImage(speedImage, 'runVm', c.args, c.memory).steps);
    const hc = benchCase(handStore, entry === 0 ? 'seededFib' : 'rollingChecksum', { n, seed: 8 });
    counts.hand.push(runImage(handImage, hc.fn, hc.args, hc.memory).steps);
  }
  // least squares fit over n = 0..12: steps = a + b*n (b is the per-trip cost)
  const fit = ys => {
    const N = 13;
    let sx = (N * (N - 1)) / 2,
      sxx = ((N - 1) * N * (2 * N - 1)) / 6;
    const sy = ys.reduce((x, y) => x + y, 0);
    const sxy = ys.reduce((x, y, i) => x + y * i, 0);
    const b = (N * sxy - sx * sy) / (N * sxx - sx * sx);
    return { overhead: (sy - b * sx) / N, perTrip: b, at12: ys[12] };
  };
  rows.push({
    entry,
    guestPerTrip: entry === 0 ? 15 : 13,
    speed: fit(counts.speed),
    peval: fit(counts.peval),
    hand: fit(counts.hand),
  });
}
console.table(
  rows.map(({ entry, guestPerTrip, speed, peval, hand }) => ({
    entry,
    guestPerTrip,
    'speed at12': speed.at12,
    'peval at12': peval.at12,
    'peval overhead': +peval.overhead.toFixed(1),
    'peval perTrip': +peval.perTrip.toFixed(2),
    'hand at12': hand.at12,
    'hand overhead': +hand.overhead.toFixed(1),
    'hand perTrip': +hand.perTrip.toFixed(2),
  })),
);
