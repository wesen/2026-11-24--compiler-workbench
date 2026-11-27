// What the existing pipelines do with the promoted residual program: repeat speed, and the hand-written loops.
import { fresh, bindings, measure, rejected, frameSlots, copyprop, Program, projectSource, project, lowerToImage, runImage, benchCase, storeOf } from './lib.mjs';
const p = fresh();
await p.specializeBuffer(bindings());
await p.apply('cfg');
await p.apply(frameSlots);
const rows = [measure(p, 'promoted')];
const stages = process.argv.includes('--copyprop')
  ? [[copyprop, 'dce'], 'speed', [copyprop, 'dce'], 'speed']
  : ['speed', 'speed', 'speed'];
for (const stage of stages) {
  const run = typeof stage === 'string' ? await p.pipeline(stage) : { steps: [] };
  if (typeof stage !== 'string') for (const x of stage) run.steps.push(await p.apply(x));
  const label = typeof stage === 'string' ? stage : stage.map(x => x.typed?.name ?? x).join(' ');
  console.log(label, 'rejected', rejected(run), 'changed', run.steps.filter(s => s.changed).map(s => s.pass).join(' '));
  rows.push(measure(p, '+ ' + label));
}
console.table(rows);
console.log(p.listing('runVm'));

// the hand-specialized loops of tests/typed/bytecode-vm.test.mjs, same pipeline and backend options
const source = `
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
const scalar = { n: [0, 12], seed: [-8, 8] };
const hand = Program.fromProject(projectSource('bytecode-vm-specialized', {
  'main.typed': source,
  'project.json': JSON.stringify({ pipeline: 'speed', inputs: { seededFib: scalar, rollingChecksum: scalar } }),
}));
await hand.pipeline('speed');
const { image } = lowerToImage(hand.head, { coalesce: true });
const out = { bytes: image.value.bytes };
for (const fn of ['seededFib', 'rollingChecksum']) {
  const c = benchCase(storeOf(hand.head.value), fn, { n: 12, seed: 8 });
  out[fn] = runImage(image, c.fn, c.args, c.memory, { counts: false }).steps;
}
console.log('hand-specialized:', out);
console.log(hand.listing());
