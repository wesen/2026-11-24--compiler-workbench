// What each new pass gives: the corpus under variants of a pipeline, pass by pass, summed over the seeded cases
// `measure` uses (10 per function, seed 7), default and tuned backend options. The variants are pass lists: the
// old `speed` (the IRWB-037-G names removed, subst-mem read as subst), the old list plus each new pass alone,
// all of them (`speed` as it is now), `guards` deciding every branch, `guards` without its divisions, `thread` once instead of twice, without `copies`, `copies` only for copies all of whose
// reads can be read through (params.whole), and a second
// `lvn` before rotate (after cfg has merged the blocks the removed checks separated).
// With --pipeline O2: O2 as it is, and O2 with the same insertions (not a registered pipeline).
// usage: node 09-ablation.mjs out.json [--pipeline speed|O2] [id...]
// IRWB_ROOT names another build to run (a copy of dist/ and tools/ next to links to vendor/ and corpus/), so a
// long run is not disturbed by `npm run build`; made with 10-snapshot.sh.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const ROOT = process.env.IRWB_ROOT ? pathToFileURL(process.env.IRWB_ROOT + '/').href : new URL('../../../../../../', import.meta.url).href;
const { projectIds, projectFiles } = await import(ROOT + 'tools/corpus.mjs');
const { installVendor } = await import(ROOT + 'tools/node-vendor.mjs');
await installVendor();
const D = ROOT + 'dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');
const { PIPELINES } = await import(D + 'typed/passes.js');

const argv = process.argv.slice(2);
const pipeline = argv.includes('--pipeline') ? argv[argv.indexOf('--pipeline') + 1] : 'speed';
const [out, ...only] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--pipeline');
const NEW = ['thread', 'copies', 'guards', 'subst-mem', 'identities'];
const S = PIPELINES.speed;
const without = (list, keep) => list.flatMap(n => (!NEW.includes(n) || keep.includes(n) ? [n] : n === 'subst-mem' ? ['subst'] : []));
const VARIANTS =
  pipeline === 'O2'
    ? {
        O2: PIPELINES.O2,
        // speed's O2 part: without the inlining, O2+'s last subst-mem, and rotate, cfg
        'O2 + the new passes': S.slice(2, S.indexOf('rotate')).filter((n, i, all) => !(n === 'subst-mem' && i === all.lastIndexOf('subst-mem'))),
      }
    : {
        old: without(S, []),
        thread: without(S, ['thread']),
        copies: without(S, ['copies']),
        'copies whole': without(S, ['copies']).map(n => (n === 'copies' ? ['copies', { whole: true }] : n)),
        guards: without(S, ['guards']),
        'subst-mem': without(S, ['subst-mem']),
        'thread+subst-mem': without(S, ['thread', 'subst-mem']),
        'guards+identities': without(S, ['guards', 'identities']),
        'all but identities': S.filter(n => n !== 'identities'),
        all: S,
        'all, guards on every branch': S.map(n => (n === 'guards' ? ['guards', { all: true }] : n)),
        'all, guards without divisions': S.map(n => (n === 'guards' ? ['guards', { divisions: false }] : n)),
        'all, one thread': S.filter((n, i) => n !== 'thread' || i === S.indexOf('thread')),
        'all but copies': S.filter(n => n !== 'copies'),
        'all, copies whole': S.map(n => (n === 'copies' ? ['copies', { whole: true }] : n)),
        'all, lvn again before rotate': S.flatMap(n => (n === 'rotate' ? ['lvn', n] : [n])),
      };
const TUNED = { chains: true, coalesce: true, homes: true };
function instructions(p, options) {
  const st = storeOf(p.origin.value), { image } = lowerToImage(p.head, options);
  let n = 0;
  for (const fn of p.origin.value.fnOrder)
    for (const c of casesFrom(st, fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} })) {
      const r = runImage(image, fn, c.args, c.memory, { limit: 2e5, counts: false });
      n += r.limit || !Number.isFinite(r.steps) ? 2e5 : r.steps;
    }
  return n;
}
const rows = {}, totals = {};
for (const id of only.length ? only : projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  rows[id] = {};
  for (const [name, list] of Object.entries(VARIANTS)) {
    const p = Program.fromProject(ps);
    if (p.status !== 'ok') continue;
    const rejected = [];
    for (const step of list) {
      const [pass, params] = Array.isArray(step) ? step : [step];
      try { await p.apply(pass, { count: 5, ...(params ? { params } : {}) }); }
      catch (e) { if (!e.code) throw e; rejected.push(`${pass} (${e.code})`); } // a rejected or failing pass is skipped
    }
    const row = { default: instructions(p, {}), tuned: instructions(p, TUNED), ...(rejected.length ? { rejected } : {}) };
    rows[id][name] = row;
    totals[name] ??= { default: 0, tuned: 0 };
    totals[name].default += row.default; totals[name].tuned += row.tuned;
  }
  console.log(id.padEnd(20), Object.entries(rows[id]).map(([k, r]) => `${k} ${r.default}/${r.tuned}${r.rejected ? ' REJECTED ' + r.rejected : ''}`).join('  '));
}
console.log('\nvariant              default     tuned');
for (const [k, t] of Object.entries(totals)) console.log(`${k.padEnd(18)} ${String(t.default).padStart(9)} ${String(t.tuned).padStart(9)}`);
if (out) writeFileSync(out, JSON.stringify({ pipeline, totals, rows }, null, 1) + '\n');
