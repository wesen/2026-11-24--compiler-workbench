// D1 generated workload. Generate once at r0 so all images receive identical arguments and bytes.
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const D = '../../../../../../dist/typed/';
const { Program } = await import(D + 'program.js');
const { projectSource } = await import(D + 'project.js');
const { storeOf } = await import(D + 'ir.js');
const { casesFrom } = await import(D + 'evaluate.js');
const { lowerToImage, runImage, imageFromCode } = await import(D + 'backend/index.js');
for (const id of projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  const row = { id };
  try {
    const p = Program.fromProject(ps);
    if (p.status !== 'ok') throw new Error(p.status);
    const calls = p.origin.value.fnOrder.flatMap(fn => casesFrom(storeOf(p.origin.value), fn,
      { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} }).map(c => ({ fn, ...c })));
    function measure(image) {
      let instructions = 0, limited = 0, trapped = 0;
      for (const c of calls) {
        const r = runImage(image, c.fn, c.args, c.memory, { limit: 200000, counts: false });
        if (r.fault) throw new Error(String(r.fault));
        limited += Number(r.limit);
        trapped += Number(Boolean(r.trap));
        instructions += r.limit ? 200000 : r.steps;
      }
      return { instructions, limited, trapped };
    }
    for (const name of ['O2', 'speed']) {
      const q = Program.fromProject(ps);
      const run = await q.pipeline(name, { count: 5 });
      row[name] = { ...measure(lowerToImage(q.head, name === 'O2' ? {} :
        { chains: true, coalesce: true, homes: true }).image),
        rejected: run.steps.filter(s => s.rejected).map(s => s.pass) };
    }
    const r = globalThis.typedRv32.compile(ps.source, [], undefined);
    row.reference = measure(imageFromCode(id, r.image, r.entries, r.signatures));
  } catch (e) { row.error = String(e.message); }
  console.log(JSON.stringify(row));
}
