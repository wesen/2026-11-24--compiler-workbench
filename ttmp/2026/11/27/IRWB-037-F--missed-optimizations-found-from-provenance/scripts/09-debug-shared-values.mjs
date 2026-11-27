// Debug: after a pass list, list value nodes reachable from more than one parent (statement field or value) in a
// function: a tree IR shares no nodes, and lvn's replace assumes it. usage: node 09-debug-shared-values.mjs <project> <passes> <fn>
const root = new URL('../../../../../../', import.meta.url);
const { installVendor } = await import(new URL('tools/node-vendor.mjs', root));
const { projectFiles } = await import(new URL('tools/corpus.mjs', root));
await installVendor();
const { Program } = await import(new URL('dist/typed/program.js', root));
const { projectSource } = await import(new URL('dist/typed/project.js', root));
const { storeOf } = await import(new URL('dist/typed/ir.js', root));
const { show } = await import(new URL('dist/typed/listing.js', root));
const [id, passes, fn] = process.argv.slice(2);
const p = Program.fromProject(projectSource(id, projectFiles(id)));
for (const pass of passes.split(',')) {
  await p.apply(pass, { count: 5 });
  const st = storeOf(p.head.value);
  const f = st.fns.get(fn);
  const parents = new Map();
  const walk = (vid, from) => {
    (parents.get(vid) ?? parents.set(vid, []).get(vid)).push(from);
    for (const a of st.get(vid).args) walk(a, vid);
  };
  for (const b of f.blocks) for (const sid of b.stmts) for (const k of ['value', 'cond', 'addr']) if (st.get(sid)[k]) walk(st.get(sid)[k], `${sid}.${k}`);
  const shared = [...parents].filter(([, ps]) => ps.length > 1);
  console.log(`r${p.rev} ${pass}: ${shared.length} shared`);
  for (const [v, ps] of shared.slice(0, 5)) console.log(`   ${v} ${show(st, v)} <- ${ps.join(', ')}`);
}
