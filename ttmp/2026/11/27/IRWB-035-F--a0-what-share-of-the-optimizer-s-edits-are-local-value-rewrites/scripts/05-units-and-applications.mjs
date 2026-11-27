// IRWB-035-F analysis 05, over the JSON of tools/edit-classes.mjs (no pipeline is rerun):
//  (a) the shares when a structural change is counted once per application and function instead of once per record
//      (a block merge writes one record per moved statement; a jump threading one per retargeted branch);
//  (b) pass applications by the classes of their edits: all local/verified, all local, mixed, none local — the unit
//      at which a check that samples only the residual (IRWB-008's version 3) would skip the sampled check.
// usage: node 05-units-and-applications.mjs ../various/03-edit-classes-corpus.json
import { readFileSync } from 'node:fs';
const { rows } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const pct = (n, d) => ((100 * n) / d).toFixed(1);
for (const pl of ['O2', 'speed']) {
  const sel = rows.filter(r => r.pipeline === pl);
  const units = new Map();
  for (const r of sel) {
    const k = r.class === 'structural' ? `${r.project}|${r.rev}|${r.fn}|${r.sub}` : `${r.project}|${r.edit}`;
    const u = units.get(k) ?? { class: r.class, executed: 0 };
    u.executed += r.weight?.executed ?? 0;
    units.set(k, u);
  }
  const n = { local: 0, structural: 0, other: 0 };
  for (const u of units.values()) n[u.class]++;
  console.log(`${pl}: units ${units.size} (structural grouped per application, function and sub-class): ` +
    `local ${pct(n.local, units.size)} %, structural ${pct(n.structural, units.size)} %, other ${pct(n.other, units.size)} %`);
  const apps = new Map();
  for (const r of sel) {
    const k = `${r.project}|${r.rev}`;
    const a = apps.get(k) ?? { pass: r.pass, classes: new Set(), executed: 0 };
    a.classes.add(r.class === 'local' ? `local/${r.sub}` : r.class);
    a.executed += r.weight?.executed ?? 0;
    apps.set(k, a);
  }
  const kinds = {};
  for (const a of apps.values()) {
    const c = [...a.classes];
    const k = c.every(x => x === 'local/verified') ? 'all local/verified'
      : c.every(x => x.startsWith('local/')) ? 'all local (some fact-guarded)'
      : c.some(x => x.startsWith('local/')) ? 'mixed' : 'no local edit';
    const t = (kinds[k] ??= { apps: 0, passes: {} });
    t.apps++;
    t.passes[a.pass] = (t.passes[a.pass] ?? 0) + 1;
  }
  console.log(`${pl}: published applications ${apps.size}`);
  for (const [k, t] of Object.entries(kinds))
    console.log(`  ${k.padEnd(30)} ${String(t.apps).padStart(4)} (${pct(t.apps, apps.size)} %)  ${Object.entries(t.passes).map(([p, x]) => `${p} ${x}`).join(', ')}`);
}
