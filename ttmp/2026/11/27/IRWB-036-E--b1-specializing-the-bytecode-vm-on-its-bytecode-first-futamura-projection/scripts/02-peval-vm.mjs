// 02: specialize the bytecode VM with peval and measure RV32 instructions/bytes against r0, speed and hand.
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { BindingsIR } = await import('../../../../../../dist/typed/specialize.js');
const { createArtifact } = await import('../../../../../../dist/framework/contracts/index.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase, evaluate } = await import('../../../../../../dist/typed/evaluate.js');

const id = 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const inputs = project.meta.inputs.runVm;
const cells = inputs.code.cells;
const entries = inputs.entry.oneOf;
const backendOptions = { coalesce: true };

// the host promise: runVm's `code` parameter always holds the fixture's 64 cells
const bindings = createArtifact(BindingsIR, 'bytecode-vm-fixture', {
  formatVersion: 1,
  source: 'bytecode-vm fixture',
  bindings: [{ fn: 'runVm', param: 'code', cells, entity: 'project/bytecode-vm#runVm.code' }],
});

const referenceVm = (code, entry, n, seed) => {
  const stack = [];
  const locals = [n, seed, 0, 0];
  let pc = entry;
  for (let d = 1; d <= 184; d++) {
    const opcode = code[pc],
      operand = code[pc + 1];
    pc += 2;
    if (opcode === 0) return { result: stack.pop(), dispatches: d };
    if (opcode === 1) stack.push(operand);
    else if (opcode === 2) stack.push(locals[operand]);
    else if (opcode === 3) locals[operand] = stack.pop();
    else if (opcode === 4) stack.push((stack.pop() + (stack.pop() | 0)) | 0);
    else if (opcode === 5) {
      const r = stack.pop();
      stack.push((stack.pop() - r) | 0);
    } else if (opcode === 6) stack.push(Math.imul(stack.pop(), stack.pop()));
    else if (opcode === 7) {
      if (stack.pop() === 0) pc = operand;
    } else if (opcode === 8) pc = operand;
    else throw new Error(`opcode ${opcode}`);
  }
  throw new Error('no HALT');
};

// (a) r0, (b) speed, (c) peval + speed
const fresh = source => Program.fromProject(projectSource('bytecode-vm-measure-' + Math.random().toString(36).slice(2, 6), {
  'main.typed': source,
  'project.json': JSON.stringify({ pipeline: project.meta.pipeline, inputs: { runVm: inputs } }),
}));

const p = Program.fromProject(project);
const applied = await p.apply('peval', { params: { bindings, inputs: p.inputs } });
console.log('peval:', JSON.stringify(applied));
console.log(p.listing('runVm'));
const report = p.revisions[p.rev];
const rep = p.revisions.at(-1);
console.log('edits:', rep.edits.length, 'kinds:', JSON.stringify(rep.edits.reduce((m, e) => (m[e.kind] = (m[e.kind] || 0) + 1, m), {})));
const pipeline = await p.pipeline(project.meta.pipeline);
console.log('pipeline rejected:', JSON.stringify(pipeline.steps.filter(s => s.rejected)));
const pevalSpeedImage = lowerToImage(p.head, backendOptions).image;

const q = Program.fromProject(project);
await q.apply('peval', { params: { bindings, inputs: q.inputs } });
const pevalOnlyImage = lowerToImage(q.head, backendOptions).image;

const r = Program.fromProject(project);
const r0Image = lowerToImage(r.artifact(0), backendOptions).image;
await r.pipeline(project.meta.pipeline);
const speedImage = lowerToImage(r.head, backendOptions).image;

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
const hand = fresh(specializedSource);
await hand.pipeline(project.meta.pipeline);
const handStore = storeOf(hand.head.value);
const handImage = lowerToImage(hand.head, backendOptions).image;

const rows = [];
let exhaustive = 0;
for (const entry of entries) {
  for (let n = inputs.n[0]; n <= inputs.n[1]; n++) {
    for (let seed = inputs.seed[0]; seed <= inputs.seed[1]; seed++) {
      const c = benchCase(storeOf(r.artifact(0).value), 'runVm', { code: inputs.code, entry, n, seed });
      const oracle = referenceVm(cells, entry, n, seed).result;
      for (const [name, image, fn = 'runVm'] of [
        ['r0', r0Image],
        ['speed', speedImage],
        ['peval', pevalOnlyImage],
        ['peval+speed', pevalSpeedImage],
      ]) {
        const run = runImage(image, fn, c.args, c.memory, { limit: 2e5 });
        if (run.result !== oracle || run.trap)
          throw new Error(`${name} entry=${entry} n=${n} seed=${seed}: got ${run.result} (${run.trap}), want ${oracle}`);
      }
      exhaustive++;
    }
  }
}
console.log('exhaustive RV32 agreement:', exhaustive, 'cases per image');
for (const entry of entries) {
  const n = 12,
    seed = 8;
  const c = benchCase(storeOf(r.artifact(0).value), 'runVm', { code: inputs.code, entry, n, seed });
  const oracle = referenceVm(cells, entry, n, seed);
  const row = { entry, guest: oracle.dispatches };
  for (const [name, image] of [
    ['r0', r0Image],
    ['speed', speedImage],
    ['peval', pevalOnlyImage],
    ['peval+speed', pevalSpeedImage],
  ])
    row[name] = { instructions: runImage(image, 'runVm', c.args, c.memory).steps, bytes: image.value.bytes };
  const fn = entry === 0 ? 'seededFib' : 'rollingChecksum';
  const hc = benchCase(handStore, fn, { n, seed });
  row.hand = {
    instructions: runImage(handImage, fn, hc.args, hc.memory).steps,
    bytes: handImage.value.bytes,
  };
  rows.push(row);
}
console.table(
  rows.map(row => ({
    entry: row.entry,
    guest: row.guest,
    r0: row.r0.instructions,
    speed: row.speed.instructions,
    peval: row.peval.instructions,
    'peval+speed': row['peval+speed'].instructions,
    hand: row.hand.instructions,
  })),
);
console.table(
  rows.map(row => ({
    entry: row.entry,
    r0bytes: row.r0.bytes,
    speedBytes: row.speed.bytes,
    pevalBytes: row.peval.bytes,
    pevalSpeedBytes: row['peval+speed'].bytes,
    handBytes: row.hand.bytes,
  })),
);
