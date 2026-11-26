// IRWB-008: the guide's worked example. Blend through O2; for every simplify and fold edit: the edit record, the
// before- and after-trees, the origin of the new root (if one was made), the correspondence entry of the old root,
// the rules an independent re-derivation fires, and the recorded evidence of each. Also the sampled check of the
// same application, with the memo's counters.
//   node 04-blend-worked-example.mjs [project]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectFiles } = await import(root + 'tools/corpus.mjs');
const { projectSource, ingestProject } = await import(root + 'dist/typed/project.js');
const { PASSES, PIPELINES } = await import(root + 'dist/typed/passes.js');
const { SIMPLIFY_RULES } = await import(root + 'dist/typed/rules/simplify.js');
const { FOLD_RULES } = await import(root + 'dist/typed/rules/fold.js');
const { RULE_EVIDENCE } = await import(root + 'dist/typed/rules/evidence.js');
const { ruleText } = await import(root + 'dist/typed/rules/form.js');
const { evalOp } = await import(root + 'dist/typed/rules/compile.js');
const { meaningKept } = await import(root + 'dist/typed/evaluate.js');
const { COMPARE } = await import(root + 'dist/typed/listing.js');
const { F32_RESULT } = await import(root + 'dist/typed/f32.js');
const C = await import(root + 'dist/framework/contracts/index.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');

const id = process.argv[2] ?? 'blend';
const p = projectSource(id, projectFiles(id)),
  r0 = ingestProject(p);
const spec = C.differentialSpec(meaningKept({ inputs: p.meta.inputs }));

// the re-derivation of measurement 01, compact
const IMPURE = new Set(['call', 'load', 'load16u', 'div', 'rem', 'caddr', 'result']);
const treeOf = (vs, x) => ({ op: vs[x].op, imm: vs[x].imm, type: vs[x].type, args: vs[x].args.map(a => treeOf(vs, a)) });
const sameT = (x, y) => x.op === y.op && x.imm === y.imm && x.type === y.type && x.args.length === y.args.length && x.args.every((a, i) => sameT(a, y.args[i]));
const pureT = t => !IMPURE.has(t.op) && t.args.every(pureT);
const match = (q, t, b) =>
  'var' in q ? ((b[q.var] = t), true) : 'constVar' in q ? (t.op === 'const' ? ((b[q.constVar] = t), true) : false)
  : 'const' in q ? t.op === 'const' && t.imm === q.const : 'same' in q ? sameT(t, b[q.same])
  : t.op === q.op && t.args.length === q.args.length && q.args.every((s, i) => match(s, t.args[i], b));
const guard = (g, b) =>
  'pure' in g ? pureT(b[g.pure]) : 'pow2' in g ? b[g.pow2].imm > 0 && (b[g.pow2].imm & (b[g.pow2].imm - 1)) === 0
  : 'boolean' in g ? COMPARE.has(b[g.boolean].op) : !(b[g.noTrap[1]].imm === 0 || (b[g.noTrap[0]].imm === -2147483648 && b[g.noTrap[1]].imm === -1));
const num = (n, b) => (typeof n === 'number' ? n : 'log2' in n ? 31 - Math.clz32(b[n.log2].imm) : evalOp(n.eval, n.args.map(a => b[a].imm)));
const inst = (t, b) =>
  'var' in t ? b[t.var] : 'const' in t ? { op: 'const', imm: num(t.const, b) | 0, type: t.type, args: [] }
  : { op: t.op, imm: undefined, type: F32_RESULT.has(t.op) ? 'f32' : undefined, args: t.args.map(a => inst(a, b)) };
const normalize = (t, rules, fired) => {
  const n = { ...t, args: t.args.map(a => normalize(a, rules, fired)) };
  for (const r of rules) {
    if (r.lhs.op !== n.op) continue;
    const b = {};
    if (match(r.lhs, n, b) && (r.where ?? []).every(g => guard(g, b))) return fired.push(r), inst(r.rhs, b);
  }
  return n;
};
const text = t => (t.op === 'const' ? String(t.imm) : t.op === 'get' ? `get#${t.imm}` : `${t.op}(${t.args.map(text).join(', ')})`);

let cur = r0;
const manager = new C.AnalysisManager();
for (const name of PIPELINES.O2) {
  const r = await applyPass(PASSES[name], cur, { manager });
  if (!r.changed) continue;
  const s0 = C.differentialStats();
  const ev = await C.runDifferentialAsync(spec, { origin: r0, candidate: r.artifact });
  const s1 = C.differentialStats();
  if (name === 'simplify' || name === 'fold') {
    console.log(`== ${name} at r${r.artifact.value.rev}: check ${ev.agree}/${ev.total} agree; subject runs ${s1.subjectRuns - s0.subjectRuns}, replayed ${s1.replayed - s0.replayed}`);
    for (const e of r.report.edits) {
      console.log('edit', JSON.stringify(e));
      const before = treeOf(cur.value.values, e.from), after = treeOf(r.artifact.value.values, e.to);
      console.log('  before', text(before), '\n  after ', text(after));
      const made = cur.value.values[e.to] ? null : r.artifact.value.values[e.to];
      console.log('  new root record', made ? JSON.stringify({ id: made.id, op: made.op, args: made.args, origin: made.origin }) : '(an existing value: no value was made at the root)');
      const entry = r.correspondence.entries.find(x => x.from.includes(e.from));
      console.log('  correspondence entry of the old root', JSON.stringify(entry ?? null));
      const fired = [];
      const got = normalize(before, (name === 'simplify' ? SIMPLIFY_RULES : FOLD_RULES).rules, fired);
      console.log('  re-derived', sameT(got, after), 'firing', fired.map(f => `${f.name}@${f.version} [${RULE_EVIDENCE[f.name].strength}] ${ruleText(f)}`).join('; '));
    }
  }
  cur = r.artifact;
}
const e = RULE_EVIDENCE['not-lt'];
console.log('evidence not-lt:', JSON.stringify({ version: e.version, fingerprint: e.fingerprint.slice(0, 12), verdict: e.verdict, strength: e.strength, methods: e.methods.map(m => `${m.method}:${m.verdict}${m.cases ? ` ${m.cases}` : ''}`) }));
