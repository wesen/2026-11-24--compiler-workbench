// IRWB-035-F: classify every edit the O2 and speed pipelines make on the corpus (src/typed/edit-classes.ts) and print
// the tables: per pipeline, per sub-class, per pass, per project, per function, the verified-rule coverage of the
// local rewrites and the shapes of the rest.
//
// usage: node tools/edit-classes.mjs [--pipelines O2,speed] [--projects a,b] [--no-weights] [--json out.json]
//
// `census(ids, pipelines, opts)` is the same run for other code: it returns the classified rows (with project and
// pipeline), the gate's rejections, the projects that did not ingest and the weight no edit claimed.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installVendor } from './node-vendor.mjs';
await installVendor();
const { projectIds, projectFiles } = await import('./corpus.mjs');
const { Program } = await import('../dist/typed/program.js');
const { projectSource } = await import('../dist/typed/project.js');
const { classifyRevisions, tally } = await import('../dist/typed/edit-classes.js');

export async function census(ids = projectIds(), pipelines = ['O2', 'speed'], opts = { weights: true }) {
  const rows = [],
    rejected = [],
    skipped = [],
    unattributed = {};
  for (const id of ids)
    for (const pipeline of pipelines) {
      const p = Program.fromProject(projectSource(id, projectFiles(id)));
      if (p.status !== 'ok') {
        if (pipeline === pipelines[0]) skipped.push(`${id}: ${p.status}`);
        continue;
      }
      const run = await p.pipeline(pipeline);
      if (opts.progress) process.stderr.write(`${id} ${pipeline}\n`);
      for (const s of run.steps) if (s.rejected) rejected.push(`${id} ${pipeline} ${s.pass}: ${s.rejected}`);
      const c = classifyRevisions(p.revisions, { weights: opts.weights, inputs: p.inputs });
      for (const r of c.rows) rows.push({ project: id, pipeline, ...r });
      for (const [pass, u] of Object.entries(c.unattributed)) {
        const t = (unattributed[`${pipeline} ${pass}`] ??= { static: 0, executed: 0 });
        t.static += u.static;
        t.executed += u.executed;
      }
    }
  return { rows, rejected, skipped, unattributed };
}

// ---------- printing ----------
const CLASSES = ['local', 'structural', 'other'];
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}` : '-');
const pad = (x, n) => String(x).padStart(n);
const big = n => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

/** One line per key: edits, and the share of each class by edits / static / executed. */
function shareTable(title, summary, keys = Object.keys(summary)) {
  const out = [title, `${'key'.padEnd(14)}${pad('edits', 6)}  local% str% oth%  (edits | static | executed)`];
  for (const k of keys) {
    const s = summary[k] ?? {};
    const tot = f => CLASSES.reduce((n, c) => n + (s[c]?.[f] ?? 0), 0);
    const cells = f => CLASSES.map(c => pad(pct(s[c]?.[f] ?? 0, tot(f)), 5)).join('');
    out.push(`${k.slice(0, 14).padEnd(14)}${pad(tot('edits'), 6)} ${cells('edits')} |${cells('static')} |${cells('executed')}`);
  }
  return out.join('\n');
}

function report(c, pipelines) {
  const L = [];
  const { rows } = c;
  L.push(`edits classified: ${rows.length}; projects skipped: ${c.skipped.length ? c.skipped.join('; ') : 'none'}`);
  L.push(`gate rejections: ${c.rejected.length ? '' : 'none'}`);
  for (const r of c.rejected) L.push(`  ${r}`);
  L.push('');
  L.push(shareTable('== per pipeline', tally(rows, r => r.pipeline), pipelines));
  L.push('');
  for (const pl of pipelines) {
    const sel = rows.filter(r => r.pipeline === pl);
    const subs = tally(sel, r => `${r.class}/${r.sub}`, () => 'all');
    L.push(`== ${pl}: sub-classes (edits, static, executed)`);
    const tot = sel.length,
      ts = sel.reduce((n, r) => n + (r.weight?.static ?? 0), 0),
      te = sel.reduce((n, r) => n + (r.weight?.executed ?? 0), 0);
    for (const [k, v] of Object.entries(subs).sort((a, b) => b[1].all.edits - a[1].all.edits))
      L.push(
        `${k.padEnd(26)}${pad(v.all.edits, 6)} ${pad(pct(v.all.edits, tot), 5)}%${pad(big(v.all.static), 7)} ${pad(pct(v.all.static, ts), 5)}%${pad(big(v.all.executed), 8)} ${pad(pct(v.all.executed, te), 5)}%`,
      );
    L.push(`${'total'.padEnd(26)}${pad(tot, 6)}       ${pad(big(ts), 7)}        ${pad(big(te), 8)}`);
    L.push('');
    L.push(shareTable(`== ${pl}: per pass`, tally(sel, r => r.pass)));
    L.push('');
  }
  for (const pl of pipelines) {
    const sel = rows.filter(r => r.pipeline === pl);
    L.push(shareTable(`== ${pl}: per project`, tally(sel, r => r.project)));
    L.push('');
  }
  // the record kinds inside each sub-class (a block merge is one merge, one remove and a move per statement)
  for (const pl of pipelines) {
    const k = tally(rows.filter(r => r.pipeline === pl), r => `${r.class}/${r.sub}`, r => r.kind);
    L.push(`== ${pl}: record kinds per sub-class (edits)`);
    for (const [sub, kinds] of Object.entries(k))
      L.push(`${sub.padEnd(26)} ${Object.entries(kinds).sort((a, b) => b[1].edits - a[1].edits).map(([n, t]) => `${n} ${t.edits}`).join(', ')}`);
    L.push('');
  }
  // functions: what keeps a changed function from being all local rewrites
  for (const pl of pipelines) {
    const fns = new Map();
    for (const r of rows.filter(x => x.pipeline === pl)) {
      const k = `${r.project}/${r.fn}`;
      const f = fns.get(k) ?? new Set();
      if (r.class !== 'local') f.add(`${r.class}/${r.sub}`);
      fns.set(k, f);
    }
    const only = {}, any = {};
    for (const f of fns.values()) {
      const key = f.size === 0 ? '(none: all local)' : f.size === 1 ? [...f][0] : '(two or more)';
      only[key] = (only[key] ?? 0) + 1;
      for (const x of f) any[x] = (any[x] ?? 0) + 1;
    }
    const sorted = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([n, k]) => `${n} ${k}`).join(', ');
    L.push(`== ${pl}: changed functions by their only non-local sub-class: ${sorted(only)}`);
    L.push(`== ${pl}: changed functions containing each non-local sub-class: ${sorted(any)}`);
  }
  L.push('');
  // functions: every edit of the function local / local-verified
  for (const pl of pipelines) {
    const fns = new Map();
    for (const r of rows.filter(x => x.pipeline === pl)) {
      const k = `${r.project}/${r.fn}`;
      const f = fns.get(k) ?? { local: true, verified: true };
      f.local &&= r.class === 'local';
      f.verified &&= r.class === 'local' && r.sub === 'verified';
      fns.set(k, f);
    }
    const all = [...fns.values()];
    L.push(
      `== ${pl}: changed functions ${all.length}; every edit local ${all.filter(f => f.local).length}; every edit local/verified ${all.filter(f => f.verified).length}`,
    );
  }
  L.push('');
  // local coverage
  for (const pl of pipelines) {
    const loc = rows.filter(r => r.pipeline === pl && r.class === 'local');
    const ver = loc.filter(r => r.sub === 'verified');
    const w = (xs, f) => xs.reduce((n, r) => n + (r.weight?.[f] ?? 0), 0);
    L.push(`== ${pl}: local rewrites ${loc.length}; matched by a verified rule ${ver.length} (${pct(ver.length, loc.length)} %),` +
      ` static ${pct(w(ver, 'static'), w(loc, 'static'))} %, executed ${pct(w(ver, 'executed'), w(loc, 'executed'))} %;` +
      ` citing a rule in the record: ${loc.filter(r => r.cites).length}`);
    const firings = {}, strengths = {};
    for (const r of ver) {
      for (const n of r.rules) firings[n] = (firings[n] ?? 0) + 1;
      strengths[r.strength] = (strengths[r.strength] ?? 0) + 1;
    }
    L.push(`  firings: ${Object.entries(firings).sort((a, b) => b[1] - a[1]).map(([n, k]) => `${n} ${k}`).join(', ')}`);
    L.push(`  weakest strength per edit: ${Object.entries(strengths).map(([n, k]) => `${n} ${k}`).join(', ')}`);
  }
  L.push('');
  // shapes of the rest: fact-guarded local rewrites and other value replacements
  for (const pl of pipelines) {
    const rest = rows.filter(
      r => r.pipeline === pl && ((r.class === 'local' && r.sub !== 'verified') || (r.class === 'other' && r.kind === 'replace')),
    );
    const by = new Map();
    for (const r of rest)
      for (const s of r.shapes?.length ? r.shapes : ['(several records on one field)']) {
        const k = `${r.class}/${r.sub} ${r.pass}: ${s}`;
        const t = by.get(k) ?? { edits: 0, executed: 0 };
        t.edits++;
        t.executed += (r.weight?.executed ?? 0) / Math.max(1, r.shapes?.length ?? 1);
        by.set(k, t);
      }
    L.push(`== ${pl}: shapes of the local rewrites no verified rule matches, and of the other value replacements (top 20 by edits)`);
    for (const [k, t] of [...by].sort((a, b) => b[1].edits - a[1].edits).slice(0, 20))
      L.push(`${pad(t.edits, 5)} ${pad(big(t.executed), 7)}  ${k}`);
    L.push('');
  }
  // checks
  const fs = rows.filter(r => (r.pass === 'fold' || r.pass === 'simplify') && r.kind === 'replace');
  L.push(`check: fold/simplify replace edits ${fs.length}, of them local/verified ${fs.filter(r => r.sub === 'verified').length}`);
  for (const r of fs.filter(r => r.sub !== 'verified').slice(0, 10)) L.push(`  NOT: ${r.project} ${r.pipeline} ${r.pass} ${r.edit} ${r.class}/${r.sub}`);
  L.push(`unattributed weight (new statements no edit names), by pipeline and pass: ${JSON.stringify(c.unattributed)}`);
  return L.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const opt = n => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const pipelines = (opt('--pipelines') ?? 'O2,speed').split(',');
  const ids = opt('--projects') ? opt('--projects').split(',') : projectIds();
  const t0 = performance.now();
  const c = await census(ids, pipelines, { weights: !argv.includes('--no-weights'), progress: true });
  console.log(report(c, pipelines));
  console.log(`${Math.round(performance.now() - t0)} ms`);
  if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(c) + '\n');
}
