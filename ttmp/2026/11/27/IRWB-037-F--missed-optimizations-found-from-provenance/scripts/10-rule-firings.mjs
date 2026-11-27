// Rule firings over the corpus: run a pipeline on every project with simplify, fold, reassoc and bitwise replaced by their
// table passes counting firings (rules/compile.ts `Firings`), and print, per rule, the firings and the projects.
// usage: node 10-rule-firings.mjs [pipeline or a,b,c] [--json out.json]
import { writeFileSync } from 'node:fs';
const root = new URL('../../../../../../', import.meta.url);
const { installVendor } = await import(new URL('tools/node-vendor.mjs', root));
const { projectIds, projectFiles } = await import(new URL('tools/corpus.mjs', root));
await installVendor();
const D = new URL('dist/typed/', root);
const { Program } = await import(new URL('program.js', D));
const { projectSource } = await import(new URL('project.js', D));
const { PIPELINES, reassoc, bitwise, typedPass } = await import(new URL('passes.js', D));
const { tablePass } = await import(new URL('rules/passes.js', D));
const { tableBody } = await import(new URL('rules/compile.js', D));
const { SIMPLIFY_RULES } = await import(new URL('rules/simplify.js', D));
const { FOLD_RULES } = await import(new URL('rules/fold.js', D));
const { REASSOC_RULES } = await import(new URL('rules/reassoc.js', D));
const { BITWISE_RULES } = await import(new URL('rules/bitwise.js', D));
const argv = process.argv.slice(2);
const spec = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--json') ?? 'speed';
const names = spec.includes(',') ? spec.split(',') : PIPELINES[spec];
const firings = new Map(), where = new Map();
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  if (p.status !== 'ok') continue;
  const local = new Map();
  const passes = {
    simplify: tablePass('simplify', local),
    fold: tablePass('fold', local),
    reassoc: typedPass({ ...reassoc.typed, body: tableBody(REASSOC_RULES.rules, local) }),
    bitwise: typedPass({ ...bitwise.typed, body: tableBody(BITWISE_RULES.rules, local) }),
  };
  for (const n of names) {
    try { await p.apply(passes[n] ?? n, { count: 5 }); } catch (e) { if (e.code !== 'contractRejected') throw e; }
  }
  for (const [r, n] of local) {
    firings.set(r, (firings.get(r) ?? 0) + n);
    (where.get(r) ?? where.set(r, []).get(r)).push(`${id} ${n}`);
  }
}
const sets = { simplify: SIMPLIFY_RULES, fold: FOLD_RULES, reassoc: REASSOC_RULES, bitwise: BITWISE_RULES };
const out = {};
for (const [s, set] of Object.entries(sets)) {
  const never = set.rules.filter(r => !firings.get(r.name)).map(r => r.name);
  console.log(`${s}: ${set.rules.length} rules, ${set.rules.length - never.length} fire, ${never.length} never`);
  for (const r of set.rules) if (firings.get(r.name)) console.log(`  ${r.name.padEnd(18)} ${String(firings.get(r.name)).padStart(5)}  ${where.get(r.name).join(', ')}`);
  console.log(`  never: ${never.join(', ')}`);
  out[s] = { fire: Object.fromEntries(set.rules.filter(r => firings.get(r.name)).map(r => [r.name, firings.get(r.name)])), never };
}
if (argv.includes('--json')) writeFileSync(argv[argv.indexOf('--json') + 1], JSON.stringify(out, null, 1) + '\n');
