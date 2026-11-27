// Probe: executed RV32 instructions of the bytecode VM after each pass of a pipeline (n = 12, seed = 8).
// usage: node 01-per-pass-steps.mjs [pipeline=speed] [project=bytecode-vm]
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { benchCase } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');
const { PIPELINES } = await import(D + 'typed/passes.js');

const pipeline = process.argv[2] ?? 'speed';
const id = process.argv[3] ?? 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(project);
const inputs = project.meta.inputs.runVm;
const row = (label, art) => {
  const st = storeOf(art.value);
  const out = [label.padEnd(14)];
  for (const opts of [{ coalesce: true }, {}]) {
    const { image } = lowerToImage(art, opts);
    for (const entry of [0, 34]) {
      const c = benchCase(st, 'runVm', { code: inputs.code, entry, n: 12, seed: 8 });
      out.push(String(runImage(image, c.fn, c.args, c.memory).steps).padStart(6));
    }
    out.push(String(image.value.bytes).padStart(5) + 'B');
  }
  let stmts = 0;
  for (const f of st.fns.values()) for (const b of f.blocks) stmts += b.stmts.length;
  out.push(String(stmts).padStart(4) + ' stmts');
  console.log(out.join(' '));
};
console.log('pass            coalesce: fib  chk  bytes | default: fib chk bytes');
row('r0', p.head);
for (const [i, name] of PIPELINES[pipeline].entries()) {
  const r = await p.apply(name);
  row(`${i}:${name}${r.changed ? '' : ' ='}`, p.head);
}
