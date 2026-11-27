// IRWB-035-E, measurement 03: the report tables from the census JSON (script 02's output). Prints, per pipeline
// (O2, speed): the headline shares by edit count and by instruction weight; per pass; per project; the
// verified-rule coverage of the local rewrites with the rules fired; the fact shapes that would raise it most; and
// the applications/edits context. Output is plain text at 100 columns, written to various/03-tables.txt.
//
// usage: node 03-tables.mjs [--dir various] [--out file]
const { readFileSync, writeFileSync, readdirSync } = await import('node:fs');
const argv = process.argv.slice(2);
const opt = n => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dir = opt('--dir') ?? new URL('../various/', import.meta.url).pathname;
const outPath = opt('--out') ?? new URL('../various/03-tables.txt', import.meta.url).pathname;
const data = { projects: [], pipelines: ['O2', 'speed'], byProject: {} };
// the per-project records script 02 writes (a partial re-run overwrites only its own projects)
for (const f of readdirSync(dir).filter(f => /^02-.*\.json$/.test(f) && f !== '02-summary.json').sort()) {
  const rec = JSON.parse(readFileSync(`${dir}${f}`, 'utf8'));
  data.byProject[rec.project] = rec;
  data.projects.push(rec.project);
}
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) : '0.0');
const pad = (s, n) => String(s).padStart(n);
const lines = [];
const L = (...x) => lines.push(x.join(' '));

const projectList = data.projects,
  pipelines = data.pipelines;
const tot = { edits: 0, local: 0, structural: 0, other: 0, owned: 0, dropped: 0, weight: 0 },
  pipeTot = {};
for (const pl of pipelines)
  pipeTot[pl] = {
    edits: 0,
    local: 0,
    structural: 0,
    other: 0,
    owned: 0,
    dropped: 0,
    weight: 0,
    just: { rule: 0, fact: 0, none: 0 },
    changed: 0,
    byPass: {},
  };

for (const id of projectList) {
  const rec = data.byProject[id];
  if (!rec) continue;
  for (const pl of pipelines) {
    const pipe = rec.pipelines[pl];
    if (!pipe) continue;
    const t = pipeTot[pl];
    t.changed += pipe.changed;
    t.edits += pipe.edits;
    for (const c of ['local', 'structural', 'other']) t[c] += pipe.cls[c];
    for (const [name, row] of Object.entries(pipe.byPass)) {
      const p = (t.byPass[name] ??= {
        edits: 0,
        local: 0,
        structural: 0,
        other: 0,
        owned: 0,
        dropped: 0,
        just: { rule: 0, fact: 0, none: 0 },
        facts: {},
        rules: {},
        notRederived: [],
      });
      p.edits += row.edits;
      for (const c of ['local', 'structural', 'other']) p[c] += row.cls[c];
      p.owned += row.owned;
      p.dropped += row.dropped;
      for (const k of ['rule', 'fact', 'none']) p.just[k] += row.just[k];
      for (const [k, v] of Object.entries(row.facts)) p.facts[k] = (p.facts[k] ?? 0) + v;
      for (const [k, v] of Object.entries(row.rules)) p.rules[k] = (p.rules[k] ?? 0) + v;
      p.notRederived.push(...row.notRederived);
      t.just.rule += row.just.rule;
      t.just.fact += row.just.fact;
      t.just.none += row.just.none;
    }
  }
}
for (const pl of pipelines) {
  const t = pipeTot[pl];
  t.weight = t.owned + t.dropped;
  tot.edits += t.edits;
  tot.local += t.local;
  tot.structural += t.structural;
  tot.other += t.other;
  tot.owned += t.owned;
  tot.dropped += t.dropped;
}
tot.weight = tot.owned + tot.dropped;

// ---------- the headline ----------
L(
  `corpus: ${projectList.filter(id => data.byProject[id]).length} projects (of ${projectList.length}), pipelines ${pipelines.join(' ')}`,
);
L('');
L('headline, by edit count / by instruction weight (owned + dropped)');
L('pipeline   edits   local  struct   other | weight  local  struct   other');
for (const pl of pipelines) {
  const t = pipeTot[pl];
  L(
    `${pl.padEnd(9)} ${pad(t.edits, 6)} ${pad(pct(t.local, t.edits), 6)} ${pad(pct(t.structural, t.edits), 6)} ${pad(pct(t.other, t.edits), 6)} |` +
      ` ${pad(t.weight, 5)} ${pad(pct(t.local, t.weight), 6)} ${pad(pct(t.structural, t.weight), 6)} ${pad(pct(t.other, t.weight), 6)}`,
  );
  L(
    `${' '.repeat(9)} ${pad(t.local, 6)} ${pad(t.structural, 6)} ${pad(t.other, 6)} |` +
      ` ${pad(t.weight, 5)} ${pad(t.local, 6)} ${pad(t.structural, 6)} ${pad(t.other, 6)}`,
  );
}
L(
  `both       ${pad(tot.edits, 6)} ${pad(pct(tot.local, tot.edits), 6)} ${pad(pct(tot.structural, tot.edits), 6)} ${pad(pct(tot.other, tot.edits), 6)} |` +
    ` ${pad(tot.weight, 5)} ${pad(pct(tot.local, tot.weight), 6)} ${pad(pct(tot.structural, tot.weight), 6)} ${pad(pct(tot.other, tot.weight), 6)}`,
);

// ---------- per pass ----------
for (const pl of pipelines) {
  const t = pipeTot[pl];
  L('');
  L(`${pl}: per pass (edits, classes in %, instruction weight, justifications)`);
  L('pass        edits  local struct  other | weight  own   drop  | rule  fact  none');
  for (const [name, p] of Object.entries(t.byPass).sort((a, b) => b[1].edits - a[1].edits))
    L(
      `${name.padEnd(10)} ${pad(p.edits, 5)} ${pad(pct(p.local, p.edits), 6)} ${pad(pct(p.structural, p.edits), 6)} ${pad(pct(p.other, p.edits), 5)} |` +
        ` ${pad(p.owned + p.dropped, 6)} ${pad(p.owned, 5)} ${pad(p.dropped, 5)} | ${pad(p.just.rule, 5)} ${pad(p.just.fact, 5)} ${pad(p.just.none, 5)}`,
    );
}

// ---------- verified-rule coverage ----------
L('');
L('the local rewrites: verified-rule coverage (both pipelines together)');
for (const pl of pipelines) {
  const t = pipeTot[pl];
  const loc = t.local;
  L(
    `  ${pl}: ${loc} local edits; rule ${t.just.rule} (${pct(t.just.rule, loc)} %), fact ${t.just.fact} (${pct(t.just.fact, loc)} %), none ${t.just.none}`,
  );
}
const all = pipelines.map(pl => pipeTot[pl]);
const rules = {},
  facts = {};
for (const t of all) {
  for (const [k, v] of Object.entries(t.byPass)) {
    for (const [r, n] of Object.entries(v.rules)) rules[r] = (rules[r] ?? 0) + n;
    for (const [f, n] of Object.entries(v.facts)) facts[f] = (facts[f] ?? 0) + n;
  }
}
L('  rules fired (both pipelines):');
for (const [r, n] of Object.entries(rules).sort((a, b) => b[1] - a[1])) L(`    ${r}: ${n}`);
L('  fact shapes (the rule shapes that would cover the rest):');
for (const [f, n] of Object.entries(facts).sort((a, b) => b[1] - a[1])) L(`    ${f}: ${n}`);
const none = all.reduce((n, t) => n + Object.values(t.byPass).reduce((m, p) => m + p.just.none, 0), 0);
if (none) {
  L('  not re-derived (none):');
  for (const t of all)
    for (const [p, row] of Object.entries(t.byPass)) for (const x of row.notRederived) L(`    ${x}`);
} else L('  not re-derived (none): none');

// ---------- per project ----------
for (const pl of pipelines) {
  L('');
  L(`${pl}: per project (edits by class in %, image sizes r0 -> head)`);
  L('project            edits local struct other | r0 head');
  for (const id of projectList) {
    const rec = data.byProject[id];
    if (!rec) continue;
    const pipe = rec.pipelines[pl];
    if (!pipe) continue;
    L(
      `${id.padEnd(17)} ${pad(pipe.edits, 5)} ${pad(pct(pipe.cls.local, pipe.edits), 5)} ${pad(pct(pipe.cls.structural, pipe.edits), 6)} ${pad(pct(pipe.cls.other, pipe.edits), 5)} |` +
        ` ${pipe.images.r0} ${pipe.images.head}`,
    );
  }
}

// ---------- instruction-weight shares per class, per pipeline, per pass ----------
for (const pl of pipelines) {
  const t = pipeTot[pl];
  L('');
  L(
    `${pl}: instruction weight by pass and class (owned + dropped, in % of the pipeline's total weight ${t.weight})`,
  );
  L('pass        local struct  other | weight');
  for (const [name, p] of Object.entries(t.byPass).sort(
    (a, b) => b[1].owned + b[1].dropped - (a[1].owned + a[1].dropped),
  ))
    L(
      `${name.padEnd(10)} ${pad(pct(p.local, p.owned + p.dropped), 5)} ${pad(pct(p.structural, p.owned + p.dropped), 6)} ${pad(pct(p.other, p.owned + p.dropped), 5)} |` +
        ` ${p.owned + p.dropped}`,
    );
}

const text = lines.join('\n') + '\n';
writeFileSync(outPath, text);
console.log(text);
