// (1) A bytecode image the corpus does not have (seed + the sum of k*k for k = 1..n, stack depth 3, no entry
//     binding: one entry), to see that nothing is tuned to the two fixtures.
// (2) The guarded form's fixed cost: instructions at n = 0 and n = 12, against the promised form.
import { fresh, bindings, project, inputs, Program, projectSource, BindingsIR, createArtifact, lowerToImage, runImage, benchCase, storeOf } from './lib.mjs';
const { specializeInterpreter } = await import('../../../../../../dist/typed/specialize-buffer.js');

const squares = [2, 0, 7, 26, 2, 1, 2, 0, 2, 0, 6, 0, 4, 0, 3, 1, 2, 0, 1, 1, 5, 0, 3, 0, 8, 0, 2, 1, 0, 0];
const meta = { pipeline: 'speed', ingest: { tape: true }, inputs: { runVm: { code: { cells: squares }, entry: 0, n: [0, 12], seed: [-8, 8] } } };
const src = () => projectSource('bytecode-vm-squares', { 'main.typed': project.source, 'project.json': JSON.stringify(meta) });
const run = (p, args) => {
  const c = benchCase(storeOf(p.head.value), 'runVm', args);
  const { image } = lowerToImage(p.head, { coalesce: true });
  const r = runImage(image, c.fn, c.args, c.memory, { counts: false });
  return { result: r.trap ? 'trap' : r.result, steps: r.steps, bytes: image.value.bytes };
};
const general = Program.fromProject(src()), p = Program.fromProject(src());
const b = createArtifact(BindingsIR, 'squares', { formatVersion: 1, source: 'script 07', bindings: [
  { fn: 'runVm', param: 'code', cells: squares, entity: 'squares' },
  { fn: 'runVm', param: 'entry', oneOf: [0], entity: 'squares.entry' },
] });
const steps = await specializeInterpreter(p, b);
console.log('rejected:', steps.filter(s => s.rejected).map(s => s.pass), 'variants:', p.edits(1).find(e => e.kind === 'specialized').variants);
console.log(p.listing('runVm'));
const args = { code: { cells: squares }, entry: 0, n: 12, seed: 8 };
console.log('squares general:', run(general, args), 'specialized:', run(p, args), 'expected', 8 + 650);

const promised = fresh(), guarded = fresh();
await specializeInterpreter(promised, bindings());
await specializeInterpreter(guarded, bindings(), { guard: true });
const rows = [];
for (const [label, q] of [['general r0', fresh()], ['promised', promised], ['guarded', guarded]])
  for (const entry of [0, 34]) {
    const at = n => run(q, { code: inputs.code, entry, n, seed: 8 });
    const a = at(0), z = at(12);
    rows.push({ label, entry, bytes: a.bytes, n0: a.steps, n12: z.steps, perTrip: ((z.steps - a.steps) / 12).toFixed(2) });
  }
console.table(rows);
