// The chess hot sites at the head of speed for the quiet-mate-in-two fixture, same as 03 but with the fixture
// helper that encodes the board (the 9216-cell input is not hand-typed).
// usage: node 05-chess-hot.mjs [--top 20]
import { writeFileSync } from 'node:fs';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { benchCase } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');
const { showStmt } = await import(D + 'typed/listing.js');
const { zeroState, encodeBoard, fixture, SEARCH_CELLS } = await import(
  '../../../../../../corpus/projects/chess-search/scripts/fixtures.mjs',
);

const top = Number(process.argv.includes('--top') ? process.argv[process.argv.indexOf('--top') + 1] : 20);
const id = 'chess-search';
const ps = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(ps);
const quiet = fixture('quiet-mate-in-two');
const call = benchCase(storeOf(p.origin.value), 'chessSearch', {
  board: { cells: encodeBoard(quiet.fen, SEARCH_CELLS) },
  state: { record: zeroState },
  depth: 3,
  budget: 1600,
  advanced: 1,
});
await p.pipeline('speed', { count: 5 });
const backend = { chains: true, coalesce: true, homes: true };
const st = storeOf(p.head.value);
const { image } = lowerToImage(p.head, backend);
const r = runImage(image, 'chessSearch', call.args, call.memory, { limit: 3e7 });
console.log(`chessSearch: ${r.steps} instructions at the head of speed`);
const bySite = new Map();
for (const m of image.value.insns) {
  const n = r.counts[m.offset >>> 2];
  if (!n) continue;
  const site = m.covers.find(c => st.has(c) && st.get(c).kind === 'stmt') ?? (m.covers.length ? 'frame' : 'backend');
  bySite.set(site, (bySite.get(site) ?? 0) + n);
}
const editsOf = new Map();
for (const rev of p.revisions)
  for (const e of rev.edits)
    for (const x of [e.stmt, ...(e.kind === 'replaceStmt' ? [e.from, e.to] : [])])
      if (x) {
        const list = editsOf.get(x) ?? [];
        list.push({ rev: rev.rev, pass: rev.pass, kind: e.kind, note: e.note ?? null });
        editsOf.set(x, list);
      }
for (const [site, n] of [...bySite].sort((a, b) => b[1] - a[1]).slice(0, top)) {
  if (site === 'frame' || site === 'backend') {
    console.log(`\n${String(n).padStart(9)}  ${site}`);
    continue;
  }
  const s = st.get(site);
  const origin = s.origin?.[0];
  console.log(`\n${String(n).padStart(9)}  ${site}  ${showStmt(st, site)}`);
  console.log(
    `           introduced: ${origin?.from && origin.from !== 'source' ? `${origin.via} from ${origin.from}` : 'front end'}${origin?.note ? ` (${origin.note})` : ''}`,
  );
  for (const e of editsOf.get(site) ?? [])
    console.log(`           edit r${e.rev} ${e.pass}: ${e.kind}${e.note ? ` (${e.note})` : ''}`);
}
writeFileSync('hot-chess.json', JSON.stringify({ steps: r.steps, sites: [...bySite] }, null, 1));
