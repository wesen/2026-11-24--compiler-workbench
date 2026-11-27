// Specialize runVm on the code image and each entry, then measure: RV32 instructions at n = 12, seed = 8 and image
// bytes, for r0, speed, the specialized program, and (with --listing) print the specialized IR.
// Usage: node 02-specialize.mjs [--listing] [--budget N] [--after pass,pass,...]
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');
const { BindingsIR } = await import('../../../../../../dist/typed/specialize.js');
const { pe } = await import('../../../../../../dist/typed/pe.js');
const { PIPELINES } = await import('../../../../../../dist/typed/passes.js');
const { createArtifact } = await import('../../../../../../dist/framework/contracts/index.js');

const argv = process.argv.slice(2);
const opt = k => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const budget = opt('--budget') ? +opt('--budget') : undefined;
const after = opt('--after') ? opt('--after').split(',') : ['cfg', 'promote', ...PIPELINES.speed];
const backend = { coalesce: true };
const files = projectAllFiles('bytecode-vm');
const project = projectSource('bytecode-vm', files);
const cells = project.meta.inputs.runVm.code.cells;

const run = (art, entry, n = 12, seed = 8) => {
  const st = storeOf(art.value);
  const c = benchCase(st, 'runVm', { code: { cells }, entry, n, seed });
  const img = lowerToImage(art, backend).image;
  const r = runImage(img, 'runVm', c.args, c.memory, { counts: false });
  return { result: r.result, steps: r.steps, trap: r.trap, bytes: img.value.fns.runVm.bytes };
};

for (const entry of [0, 34]) {
  const p = Program.fromProject(project);
  const bindings = createArtifact(BindingsIR, `bytecode-vm@${entry}`, {
    formatVersion: 1,
    source: 'bytecode-vm',
    bindings: [
      { fn: 'runVm', param: 'code', cells, entity: 'bytecode-vm:project.json#inputs.runVm.code' },
      { fn: 'runVm', param: 'entry', value: entry, entity: `bytecode-vm:entry/${entry}` },
    ],
  });
  const r0 = run(p.origin, entry);
  const t0 = performance.now();
  const s1 = await p.specialize(bindings);
  const s2 = await p.apply(pe, { params: { bindings, ...(budget ? { budget } : {}) } });
  const peEdit = p.revisions.at(-1).edits.find(e => e.kind === 'pe');
  const pl = await p.pipeline(after);
  const ms = performance.now() - t0;
  const rejected = pl.steps.filter(s => s.rejected);
  const spec = run(p.head, entry);
  const st = storeOf(p.head.value);
  const stmts = st.fn('runVm').blocks.reduce((n, b) => n + b.stmts.length, 0);
  console.log(JSON.stringify({
    entry,
    specialize: s1.check, pe: s2.check, variants: peEdit?.variants, residual: peEdit?.statements,
    rejected, r0, specialized: spec, finalStatements: stmts, blocks: st.fn('runVm').blocks.length,
    ms: Math.round(ms),
  }));
  if (argv.includes('--listing')) console.log(p.listing('runVm'));
}
