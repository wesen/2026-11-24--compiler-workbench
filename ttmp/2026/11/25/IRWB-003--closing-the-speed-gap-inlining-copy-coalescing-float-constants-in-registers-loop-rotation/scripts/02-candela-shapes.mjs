// What inlining meets in Candela at r0: per function, statements, calls made, calls received, record results,
// frame arrays, recursion; and the listing of the functions named on the command line.
//   node 02-candela-shapes.mjs [fn …] [--json out.json]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { listing } = await import(root + 'dist/typed/listing.js');
const { writeFileSync } = await import('node:fs');
const args = process.argv.slice(2);
const out = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const rows = new Map();
for (const f of st.fns.values())
  rows.set(f.name, {
    fn: f.name,
    stmts: f.blocks.reduce((n, b) => n + b.stmts.length, 0),
    blocks: f.blocks.length,
    results: f.results?.length ?? 0,
    arrays: f.arrayBytes ?? 0,
    calls: 0,
    callers: 0,
    sites: 0,
    rootCall: 0,
    nestedCall: 0,
    self: false,
  });
for (const f of st.fns.values())
  for (const b of f.blocks)
    for (const sid of b.stmts) {
      const s = st.get(sid);
      const walk = (id, depth) => {
        if (!id) return;
        const v = st.get(id);
        if (v.op === 'call') {
          rows.get(f.name).calls++;
          const r = rows.get(v.imm);
          r.sites++;
          if (v.imm === f.name) rows.get(f.name).self = true;
          if (depth === 0 && ['set', 'eval', 'return'].includes(s.op)) rows.get(f.name).rootCall++;
          else rows.get(f.name).nestedCall++;
        }
        for (const a of v.args) walk(a, depth + 1);
      };
      walk(s.value, 0);
      walk(s.cond, 0);
      walk(s.addr, 0);
    }
const all = [...rows.values()];
const sum = k => all.reduce((n, r) => n + (typeof r[k] === 'number' ? r[k] : r[k] ? 1 : 0), 0);
console.log(
  JSON.stringify({
    fns: all.length,
    calls: sum('calls'),
    rootCalls: sum('rootCall'),
    nestedCalls: sum('nestedCall'),
    recordResultFns: all.filter(r => r.results).length,
    frameArrayFns: all.filter(r => r.arrays).length,
    selfRecursive: all.filter(r => r.self).map(r => r.fn),
    singleSite: all.filter(r => r.sites === 1).length,
    smallLeaves: all.filter(r => r.calls === 0 && r.stmts <= 12).length,
  }),
);
for (const n of names) {
  console.log(JSON.stringify(rows.get(n)));
  console.log(listing(st, n));
}
if (out) writeFileSync(out, JSON.stringify(all, null, 1));
