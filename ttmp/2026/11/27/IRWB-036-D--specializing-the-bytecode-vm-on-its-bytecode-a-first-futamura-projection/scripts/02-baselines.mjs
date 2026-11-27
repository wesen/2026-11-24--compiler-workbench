// Baselines for IRWB-036-D: RV32 instructions and image bytes of the general VM (r0, speed) and of the two
// hand-specialized loops, at n = 12, seed = 8, for both fixtures. Same backend options as the project notes.
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');

const id = 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const inputs = project.meta.inputs.runVm;
const cells = inputs.code.cells;
const opts = { coalesce: true };

const handSource = `
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

function stats(art) {
  const st = storeOf(art.value);
  let stmts = 0, blocks = 0, fns = 0;
  for (const f of st.fns.values()) { fns++; blocks += f.blocks.length; for (const b of f.blocks) stmts += b.stmts.length; }
  return { fns, blocks, stmts };
}

const p = Program.fromProject(project);
const r0 = p.head;
const t0 = Date.now();
const pipeline = await p.pipeline(project.meta.pipeline);
const speedMs = Date.now() - t0;
const speed = p.head;
console.log('pipeline', project.meta.pipeline, 'rejected', pipeline.steps.filter(s => s.rejected).length, 'ms', speedMs);

const hand = Program.fromProject(projectSource('bytecode-vm-hand', {
  'main.typed': handSource,
  'project.json': JSON.stringify({ pipeline: project.meta.pipeline, inputs: { seededFib: { n: inputs.n, seed: inputs.seed }, rollingChecksum: { n: inputs.n, seed: inputs.seed } } }),
}));
await hand.pipeline(project.meta.pipeline);

const images = {
  r0: lowerToImage(r0, opts).image,
  speed: lowerToImage(speed, opts).image,
  hand: lowerToImage(hand.head, opts).image,
};
const rows = [];
for (const entry of inputs.entry.oneOf) {
  const call = { args: [null, entry, 12, 8] };
  // the buffer's address is assigned by the evaluator's memory image; ask it for the address instead of guessing
  const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
  const c = benchCase(storeOf(r0.value), 'runVm', { code: inputs.code, entry, n: 12, seed: 8 });
  const row = { entry, general: 0, speed: 0, hand: 0 };
  for (const [name, image] of Object.entries(images)) {
    const fn = name === 'hand' ? (entry === 0 ? 'seededFib' : 'rollingChecksum') : 'runVm';
    const args = name === 'hand' ? c.args.slice(2) : c.args;
    const r = runImage(image, fn, args, name === 'hand' ? c.memory.slice() : c.memory, {});
    if (r.trap || r.result !== (entry === 0 ? 1152 : 1298667478)) throw new Error(`${name}/${entry}: ${r.trap} ${r.result}`);
    const key = name === 'speed' ? 'speed' : name;
    row[key] = r.steps;
  }
  rows.push(row);
}
console.log(JSON.stringify({
  rows,
  bytes: Object.fromEntries(Object.entries(images).map(([k, v]) => [k, v.value.bytes])),
  stats: { r0: stats(r0), speed: stats(speed), hand: stats(hand.head) },
}, null, 2));
