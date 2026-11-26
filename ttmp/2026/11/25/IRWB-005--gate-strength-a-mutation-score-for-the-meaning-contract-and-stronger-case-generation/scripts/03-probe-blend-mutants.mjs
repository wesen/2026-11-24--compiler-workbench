// Feasibility probe for the guide: two hand-written mutants of Blend's O2 head, each a typedPass applied through
// Program.apply (the exact gate a pass meets). (1) the bounds check dropped (bce gone wrong), (2) the loop exit
// compared with > instead of >=. Prints the gate's verdict and a 4000-case and an unconstrained re-check.
//   node ttmp/2026/11/25/IRWB-005--*/scripts/03-probe-blend-mutants.mjs
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { typedPass } = await import(root + 'dist/typed/passes.js');
const { meaningKept } = await import(root + 'dist/typed/evaluate.js');
const { listing } = await import(root + 'dist/typed/listing.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');

const p = Program.fromProject(projectSource('blend', projectFiles('blend')));
await p.pipeline('O2');
console.log(listing(storeOf(p.head.value)));
const dropCheck = typedPass({
  name: 'mutant', about: 'probe: drop the bounds check', writes: ['stmts', 'cfg', 'values'],
  body({ st, f, tx }) {
    for (const b of f.blocks) {
      const s = st.get(b.stmts.at(-1));
      if (s?.op !== 'br_if') continue;
      const t = st.get(s.then);
      if (st.get(t.stmts[0])?.op === 'trap') { tx.replaceStmt(s.id, { op: 'br', to: s.else }, { because: ['mutant'] }); return; }
    }
  },
});
const weakenLoop = typedPass({
  name: 'mutant', about: 'probe: i >= n becomes i > n', writes: ['values'],
  body: ({ tx }) => tx.rewrite(v => (v.op === 'ge' ? tx.make('gt', v.args[0].id, v.args[1].id) : undefined)),
});
for (const [name, m] of [['drop-check', dropCheck], ['ge->gt', weakenLoop]]) {
  let verdict;
  try { verdict = await p.apply(m); } catch (e) { verdict = { rejected: e.message.split('\n')[0].slice(0, 160) }; }
  console.log(name, JSON.stringify(verdict));
  if (!verdict.rejected) {
    for (const [label, inputs] of [['spec 4000', p.inputs], ['unconstrained 4000', {}]]) {
      const ev = (await p.manager.checkInvariant(meaningKept({ inputs, count: 4000, seed: 11, limit: 2e5 }), { origin: p.origin, candidate: p.head })).evidence;
      console.log('  ', label, `agree ${ev.agree} disagree ${ev.disagree} inconclusive ${ev.inconclusive}`, JSON.stringify(ev.counterexamples[0] ?? null).slice(0, 200));
    }
    p.undo();
  }
}
