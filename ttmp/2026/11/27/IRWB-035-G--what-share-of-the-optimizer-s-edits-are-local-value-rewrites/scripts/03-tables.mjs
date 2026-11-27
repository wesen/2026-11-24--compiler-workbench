// IRWB-035-G tables 03: the shares of local, structural and other edits from the JSON of script 02.
// Per pipeline, per pass, per project, by edit count and by affected instructions; the verified-rule coverage of
// the local rewrites; the shapes of the local rewrites no table re-derives. Markdown on stdout.
// Several JSON files (runs over disjoint project lists) are read as one.
// usage: node 03-tables.mjs classified.json [more.json ...] > tables.txt
import { readFileSync } from 'node:fs';
const parts = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8')));
const d = {
  projects: parts.flatMap(x => x.projects).sort(),
  pipelines: parts[0].pipelines,
  ms: parts.reduce((a, x) => a + x.ms, 0),
  problems: parts.flatMap(x => x.problems),
  applications: parts.flatMap(x => x.applications),
  edits: parts.flatMap(x => x.edits),
};
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '-');
const out = [];
const table = (head, rows) => {
  out.push(`| ${head.join(' | ')} |`, `|${head.map((h, i) => (i ? '---:' : '---')).join('|')}|`);
  for (const r of rows) out.push(`| ${r.join(' | ')} |`);
  out.push('');
};
const CLASSES = ['local', 'structural', 'other'];
const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
const group = (rows, key) => {
  const m = new Map();
  for (const r of rows) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))).push(r);
  return m;
};
/** A shape as a rule family: what a `get` became, or the shape itself. */
const family = e => {
  const [shape, by] = (e.shape ?? '').split(' by ');
  const parts = shape.split('; ').map(s => {
    const [l, r] = s.split(' -> ');
    return l !== 'get' ? s : r === '#' ? 'get -> constant' : r === 'get' ? 'get -> get' : 'get -> tree';
  });
  return `${[...new Set(parts)].sort().join('; ')}${by ? ` by ${by}` : ''}`;
};
const shareRow = (name, rows) => {
  const n = rows.length, w = sum(rows, r => r.insns);
  const c = k => rows.filter(r => r.class === k);
  return [name, n, ...CLASSES.map(k => pct(c(k).length, n)), w, ...CLASSES.map(k => pct(sum(c(k), r => r.insns), w))];
};
const SHARE_HEAD = ['edits', 'local %', 'structural %', 'other %', 'instructions', 'local %', 'structural %', 'other %'];

out.push(`# Edit classes on the corpus`, '', `${d.projects.length} projects, pipelines ${d.pipelines.join(', ')}; ${d.edits.length} edits in ${d.applications.length} changed applications; runs ${Math.round(d.ms / 1000)} s in ${parts.length} process(es); problems: ${d.problems.length ? d.problems.join('; ') : 'none'}.`, '');
out.push('## 1. Per pipeline', '');
table(['pipeline', ...SHARE_HEAD], d.pipelines.map(pl => shareRow(pl, d.edits.filter(e => e.pipeline === pl))));
out.push('Instructions with the values a `replace` rebuilt above its changed subtrees counted too (an upper bound for the value edits):', '');
table(['pipeline', 'instructions', 'local %', 'structural %', 'other %', 'rule % of all'], d.pipelines.map(pl => {
  const E = d.edits.filter(e => e.pipeline === pl), w = sum(E, e => e.insnsUpper);
  return [pl, w, ...CLASSES.map(k => pct(sum(E.filter(e => e.class === k), e => e.insnsUpper), w)), pct(sum(E.filter(e => e.sub === 'rule'), e => e.insnsUpper), w)];
}));
out.push('The local class by reason, and the share of value edits (`replace` records) that are local:', '');
table(
  ['pipeline', 'local', 'rule', 'fact', 'uncited', 'rule % of all edits', 'rule % of all instructions', '`replace` edits', 'local % of them', 'rule % of them'],
  d.pipelines.map(pl => {
    const E = d.edits.filter(e => e.pipeline === pl), L = E.filter(e => e.class === 'local'), R = E.filter(e => e.kind === 'replace');
    const s = k => L.filter(e => e.sub === k);
    return [pl, L.length, s('rule').length, s('fact').length, s('uncited').length, pct(s('rule').length, E.length),
      pct(sum(s('rule'), e => e.insns), sum(E, e => e.insns)), R.length, pct(L.length, R.length), pct(s('rule').length, R.length)];
  }),
);
out.push('## 2. Per reason', '');
for (const pl of d.pipelines) {
  const E = d.edits.filter(e => e.pipeline === pl), W = sum(E, e => e.insns);
  out.push(`### ${pl}`, '');
  table(['class/reason', 'edits', '%', 'instructions', '%', 'passes'],
    [...group(E, e => `${e.class}/${e.sub}`)].sort().map(([k, rows]) => [k, rows.length, pct(rows.length, E.length), sum(rows, r => r.insns), pct(sum(rows, r => r.insns), W), [...new Set(rows.map(r => r.pass))].sort().join(' ')]));
}
out.push('## 3. Per pass', '');
for (const pl of d.pipelines) {
  out.push(`### ${pl}`, '');
  const E = d.edits.filter(e => e.pipeline === pl);
  table(['pass', ...SHARE_HEAD], [...group(E, e => e.pass)].sort((a, b) => b[1].length - a[1].length).map(([k, rows]) => shareRow(k, rows)));
}
out.push('## 4. Per project', '');
for (const pl of d.pipelines) {
  out.push(`### ${pl}`, '');
  const E = d.edits.filter(e => e.pipeline === pl), g = group(E, e => e.project);
  table(['project', ...SHARE_HEAD], d.projects.map(p => shareRow(p, g.get(p) ?? [])));
  const shares = d.projects.map(p => g.get(p) ?? []).filter(r => r.length).map(r => (100 * r.filter(e => e.class === 'local').length) / r.length).sort((a, b) => a - b);
  const q = f => shares[Math.min(shares.length - 1, Math.floor(f * shares.length))].toFixed(1);
  out.push(`Local share by edits across the ${shares.length} projects with edits: minimum ${q(0)} %, median ${q(0.5)} %, maximum ${q(1)} %; projects with a local share of at least half: ${shares.filter(s => s >= 50).length}.`, '');
}
out.push('## 5. Verified-rule coverage of the local rewrites', '');
table(
  ['pipeline', 'local', 're-derived by a verified table', '%', 'of them made by that table\'s pass', 'by another pass', 'instructions of local', 're-derived %'],
  d.pipelines.map(pl => {
    const L = d.edits.filter(e => e.pipeline === pl && e.class === 'local'), R = L.filter(e => e.sub === 'rule');
    return [pl, L.length, R.length, pct(R.length, L.length), R.filter(e => e.table === e.pass).length, R.filter(e => e.table !== e.pass).length,
      sum(L, e => e.insns), pct(sum(R, e => e.insns), sum(L, e => e.insns))];
  }),
);
for (const pl of d.pipelines) {
  const L = d.edits.filter(e => e.pipeline === pl && e.class === 'local'), R = L.filter(e => e.sub === 'rule');
  out.push(`### ${pl}: evidence and rules of the re-derived edits`, '');
  table(['weakest evidence of the edit', 'edits', '% of re-derived'], [...group(R, e => e.weakest)].sort((a, b) => b[1].length - a[1].length).map(([k, r]) => [k, r.length, pct(r.length, R.length)]));
  const fir = new Map();
  for (const e of R) for (const f of e.fired) fir.set(f, (fir.get(f) ?? 0) + 1);
  out.push(`Firings: ${[...fir].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}.`, '');
  out.push(`### ${pl}: the local rewrites no table re-derives, by shape`, '');
  const rest = L.filter(e => e.sub !== 'rule');
  let cum = R.length;
  table(['shape', 'edits', 'instructions', 'passes', 'coverage of local if covered, cumulative %'],
    [...group(rest, family)].sort((a, b) => b[1].length - a[1].length).map(([k, r]) => [
      `\`${k}\``, r.length, sum(r, e => e.insns), [...new Set(r.map(e => e.pass))].sort().join(' '), pct((cum += r.length), L.length)]));
}
out.push('## 6. Units a per-rule proof could discharge whole', '');
out.push('A unit is one function in one changed pass application (what a per-function check would cover), or one function over the whole pipeline. It is "rule only" when every edit in it is local/rule, "local only" when every edit is local.', '');
const kindOf = rows => (rows.every(e => e.sub === 'rule') ? 'rule' : rows.every(e => e.class === 'local') ? 'local' : rows.some(e => e.class === 'local') ? 'mixed' : 'none');
const unitRow = (name, units) => {
  const k = units.map(kindOf), n = k.length, c = x => k.filter(y => y === x).length;
  return [name, n, c('rule'), pct(c('rule'), n), c('rule') + c('local'), pct(c('rule') + c('local'), n), c('mixed'), c('none')];
};
const UNIT_HEAD = ['units', 'rule only', '%', 'local only (rule or fact)', '%', 'local with other classes', 'no local edit'];
table(['pipeline, unit', ...UNIT_HEAD], d.pipelines.flatMap(pl => {
  const E = d.edits.filter(e => e.pipeline === pl);
  return [
    unitRow(`${pl}, function in one application`, [...group(E, e => `${e.project} ${e.rev} ${e.fn}`).values()]),
    unitRow(`${pl}, function over the pipeline`, [...group(E, e => `${e.project} ${e.fn}`).values()]),
  ];
}));
out.push('## 7. Checks on the attribution', '');
table(['pipeline', 'changed applications', 'changed values and statements', 'neither claimed nor rebuilt', 'rebuilt values', 'instructions affected', 'instructions in the images before and after, summed over applications', '%', 'edits with no instruction'],
  d.pipelines.map(pl => {
    const A = d.applications.filter(a => a.pipeline === pl), E = d.edits.filter(e => e.pipeline === pl);
    const all = sum(A, a => a.insnsBefore + a.insnsAfter), w = sum(E, e => e.insns);
    return [pl, A.length, sum(A, a => a.changedEntities), sum(A, a => a.unclaimedEntities), sum(E, e => e.rebuilt), w, all, pct(w, all), E.filter(e => !e.insns).length];
  }));
for (const pl of d.pipelines) {
  const U = d.edits.filter(e => e.pipeline === pl && (e.sub === 'unresolved' || e.sub === 'unknown-kind' || e.sub === 'note'));
  out.push(`${pl}: unresolved, unknown or note edits: ${U.length}${U.length ? ` (${[...group(U, e => `${e.pass} ${e.kind} ${e.sub}`)].map(([k, r]) => `${k} ${r.length}`).join(', ')})` : ''}.`);
}
console.log(out.join('\n'));
