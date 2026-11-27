// What stops the specialization, and where it falls short:
//  (a) the code bound but entry dynamic: what pe makes (static sp, dynamic pc), and its cost;
//  (b) a guest program that pushes in a loop: the static stack check ends the path with a residual trap;
//  (c) a Typed loop with a static counter and a dynamic exit: the budget refuses it;
//  (d) a program that stores outside its frame: the buffer promise is refused.
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const D = '../../../../../../dist/typed/';
const { Program } = await import(D + 'program.js');
const { projectSource } = await import(D + 'project.js');
const { storeOf } = await import(D + 'ir.js');
const { benchCase } = await import(D + 'evaluate.js');
const { lowerToImage, runImage } = await import(D + 'backend/index.js');
const { BindingsIR } = await import(D + 'specialize.js');
const { pe, bindingTimes, RESIDUAL_PIPELINE } = await import(D + 'pe.js');
const { createArtifact } = await import('../../../../../../dist/framework/contracts/index.js');

const files = projectAllFiles('bytecode-vm');
const project = projectSource('bytecode-vm', files);
const cells = project.meta.inputs.runVm.code.cells;
const bind = (fn, list) => createArtifact(BindingsIR, 'probe', { formatVersion: 1, source: 'probe', bindings: list.map(b => ({ fn, entity: 'probe', ...b })) });
const steps = (art, fn, bench) => {
  const st = storeOf(art.value), c = benchCase(st, fn, bench);
  const img = lowerToImage(art, { coalesce: true }).image;
  const r = runImage(img, fn, c.args, c.memory, { counts: false });
  return { result: r.result, trap: r.trap, instructions: r.steps, bytes: img.value.fns[fn].bytes };
};
const names = (f, set) => [...set].map(l => f.locals[l].name).sort().join(' ');
const attempt = async (label, p, bindings, after = RESIDUAL_PIPELINE, budget) => {
  try {
    await p.specialize(bindings);
    await p.apply(pe, { params: { bindings, ...(budget ? { budget } : {}) } });
    const e = p.revisions.at(-1).edits.find(x => x.kind === 'pe');
    const pl = await p.pipeline(after);
    console.log(label, JSON.stringify({ variants: e?.variants, residual: e?.statements, rejected: pl.steps.filter(s => s.rejected).length }));
    return true;
  } catch (err) {
    console.log(label, 'refused:', err.message.split('\n')[0]);
    return false;
  }
};

// (a)
{
  const p = Program.fromProject(project);
  const b = bind('runVm', [{ param: 'code', cells }]);
  const st = storeOf(p.origin.value), f = st.fn('runVm');
  const bt = bindingTimes(st, f, b.value.bindings);
  console.log('(a) static without entry:', names(f, bt.static.keys()));
  await attempt('(a) code only, default budget', p, b);
  const ok = await attempt('(a) code only, budget 4096', p, b, RESIDUAL_PIPELINE, 4096);
  if (ok) for (const entry of [0, 34]) console.log('(a) entry', entry, JSON.stringify(steps(p.head, 'runVm', { code: { cells }, entry, n: 12, seed: 8 })));
  const p2 = Program.fromProject(project);
  const b2 = bind('runVm', [{ param: 'code', cells }, { param: 'entry', value: 0 }]);
  const { ANALYSES, liveView } = await import(D + 'analyses.js');
  const live = liveView((await p2.manager.analyse(ANALYSES.liveness, p2.origin)).value, st, 'runVm');
  const bt2 = bindingTimes(storeOf(p2.origin.value), f, b2.value.bindings, live.liveIn(f.blocks[0].id));
  console.log('(a) static with entry:', names(f, bt2.static.keys()), '| kinds f:', names(f, [...bt2.static].filter(([, k]) => k === 'f').map(([l]) => l)));
}
// (b) PUSH 1; JUMP 0: the stack grows until the static check stack[4] fails
{
  const code = [1, 1, 8, 0];
  const p = Program.fromProject(projectSource('bytecode-vm', { ...files, 'project.json': JSON.stringify({ ...project.meta, inputs: { runVm: { ...project.meta.inputs.runVm, code: { cells: code }, entry: 0 } } }) }));
  await attempt('(b) push loop', p, bind('runVm', [{ param: 'code', cells: code }, { param: 'entry', value: 0 }]));
  console.log('(b) residual:', p.listing('runVm').split('\n').slice(1).join(' | '));
}
// (c) a static counter with a dynamic exit
{
  const src = `function count(n: i32, k: i32): i32 {
    let i = 0;
    let s = 0;
    while (true) {
        s = s + n;
        i = i + k;
        if (s > 100) { break; }
    }
    return i;
}`;
  const p = Program.fromProject(projectSource('count', { 'main.typed': src, 'project.json': JSON.stringify({ inputs: { count: { n: [1, 50] } } }) }));
  await attempt('(c) static counter', p, bind('count', [{ param: 'k', value: 1 }]));
}
// (d) a store outside the frame: a buffer write in another function
{
  const src = `function poke(b: buffer): i32 { b.setCharCodeAt(0, 1); return 0; }
function read(b: buffer): i32 { return b.charCodeAt(0); }`;
  const p = Program.fromProject(projectSource('poke', { 'main.typed': src, 'project.json': JSON.stringify({ inputs: { read: { b: { cells: [5] } } } }) }));
  console.log('(d) status', p.status, p.error?.message ?? '');
  if (p.status === 'ok') await attempt('(d) buffer written elsewhere', p, bind('read', [{ param: 'b', cells: [5] }]));
}
