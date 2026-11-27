// Run from the worktree. With --fixtures, repeat the earlier tickets' headline cases.
// Otherwise use ten seed-7 cases per declared entry (all functions when there are no entries).
import assert from 'node:assert/strict';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { encodeBoard, fixture, SEARCH_CELLS, zeroState } from '../../../../../../corpus/projects/chess-search/scripts/fixtures.mjs';

await installVendor({ reference: true });
const dist = '../../../../../../dist/typed/';
const { Program } = await import(dist + 'program.js');
const { projectSource } = await import(dist + 'project.js');
const { storeOf } = await import(dist + 'ir.js');
const { agrees, benchCase, casesFrom } = await import(dist + 'evaluate.js');
const { imageFromCode, lowerToImage, runImage } = await import(dist + 'backend/index.js');

export const tuned = { chains: true, coalesce: true, homes: true };
export const fixtureIds = ['regex-nfa', 'lz-roundtrip', 'chess-search'];
export const load = id => projectSource(id, projectFiles(id));
export function reference(project) {
  const { image, entries, signatures } = globalThis.typedRv32.compile(project.source, [], undefined);
  return imageFromCode(project.id, image, entries, signatures);
}
export function fixtureCases(id, p) {
  const st = storeOf(p.origin.value);
  switch (id) {
    case 'regex-nfa':
      return [benchCase(st, 'regexMatch', { pattern: { string: '[a-c]*[b-d]*a*d' }, text: { string: 'abccabbd' } })];
    case 'lz-roundtrip':
      return casesFrom(st, 'roundTrip', { count: 100, seed: 7, inputs: p.inputs.roundTrip });
    case 'chess-search':
      return [benchCase(st, 'chessSearch', {
        board: { cells: encodeBoard(fixture('quiet-mate-in-two').fen, SEARCH_CELLS) },
        state: { record: zeroState }, depth: 3, budget: 1600, advanced: 1,
      })];
    default:
      throw new Error('no historical fixture for ' + id);
  }
}

import { pathToFileURL } from 'node:url';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixtures = process.argv.includes('--fixtures');
  const ids = process.argv.slice(2).filter(arg => arg !== '--fixtures');
  for (const id of ids.length ? ids : fixtures ? fixtureIds : projectIds()) {
    const ps = load(id);
    const base = Program.fromProject(ps);
    assert.equal(base.status, 'ok', id);
    const st = storeOf(base.origin.value);
    const cases = fixtures ? fixtureCases(id, base) : (ps.meta.entries ?? base.fns()).flatMap(fn =>
      casesFrom(st, fn, { count: 10, seed: 7, inputs: base.inputs[fn] }));
    const images = { reference: reference(ps) };
    const rules = {};
    const rejected = {};
    for (const name of ['O2', 'speed']) {
      const p = Program.fromProject(ps);
      const run = await p.pipeline(name);
      rejected[name] = run.steps.filter(s => s.rejected).map(s => s.pass);
      rules[name] = {};
      for (const rev of p.revisions)
        for (const edit of rev.edits)
          for (const reason of edit.because ?? [])
            if (reason.startsWith('rule:')) rules[name][reason] = (rules[name][reason] ?? 0) + 1;
      images[name] = lowerToImage(p.head).image;
      images[name + 'Tuned'] = lowerToImage(p.head, tuned).image;
    }
    const counts = Object.fromEntries(Object.keys(images).map(name => [name, 0]));
    let limited = 0;
    let bothTrap = 0;
    for (const c of cases) {
      const runs = Object.entries(images).map(([name, image]) => [name, runImage(image, c.fn, c.args, c.memory, {
        limit: fixtures ? 30_000_000 : 200_000, counts: false,
      })]);
      if (runs.some(([, r]) => r.limit)) { limited++; continue; }
      for (const [name, r] of runs)
        assert.ok(agrees(runs[0][1], r), `${id} ${c.fn} ${c.n} ${name}: reference disagreement`);
      if (runs[0][1].trap) bothTrap++;
      for (const [name, r] of runs) counts[name] += r.steps;
    }
    console.log(JSON.stringify({ id, cases: cases.length, limited, bothTrap, ...counts, rejected, rules }));
  }
}
