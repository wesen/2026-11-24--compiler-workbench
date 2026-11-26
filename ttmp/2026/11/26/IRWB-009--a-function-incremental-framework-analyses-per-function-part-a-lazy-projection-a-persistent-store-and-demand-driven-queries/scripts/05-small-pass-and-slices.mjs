// IRWB-009: (1) where a pass that changes 2 functions spends its time after IRWB-004, piece by piece; (2) the
// sizes of the slices in which a page could adopt a Candela revision.
//
// (1) O2 is replayed without a contract up to its 15th pass (dce, r12), as in 03-o2-edit-size.mjs. The 16th pass
//     (cfg, 2 functions) is then taken apart: the analysis it reads, Store.from, the pass body over every function,
//     toNative, createIRArtifact, both views, diff, makeCorrespondence, the undeclared-write check; then the whole
//     applyPass once more for comparison. Its revision must be IRWB-004's r13.
// (2) For the head: each part's text size and the time to parse and freeze it (what a page does per part when a
//     worker sends parts), assembleParts, validateBlocks, and the portable streaming SHA-256 of the revision text
//     in 1 MiB slices (what a page does when it may not hold the main thread for long).
//
//   systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 \
//     node --max-old-space-size=10240 …/05-small-pass-and-slices.mjs > …/various/05-small-pass-and-slices.json
import { readFileSync } from 'node:fs';
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter, validateBlocks } = await import(root + 'dist/typed/ir.js');
const { Store } = await import(root + 'dist/typed/model.js');
const { createIRArtifact, openIR, diff, makeCorrespondence } = await import(root + 'dist/framework/ir/index.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { applyPass, undeclaredWrites } = await import(root + 'dist/framework/passes/define-pass.js');
const { PASSES, PIPELINES } = await import(root + 'dist/typed/passes.js');
const { partsOf, partText, parsePart, assembleParts, partsRef } = await import(root + 'dist/typed/parts.js');
const { canonical, revisionOf } = await import(root + 'dist/framework/core/data.js');
const { Sha256 } = await import(root + 'dist/framework/core/sha256.js');
const baseline = JSON.parse(
  readFileSync(new URL('../../../25/IRWB-004--cheap-experiments-cached-origin-outcomes-functions-as-the-unit-of-change-workers-and-a-worker-for-the-workbench/various/04-candela-o2-baseline.json', import.meta.url), 'utf8'),
);
const ms = t => +(performance.now() - t).toFixed(1);
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
const manager = new AnalysisManager();
let cur = r0;
const names = PIPELINES.O2;
let t = performance.now();
for (const name of names.slice(0, -1)) cur = (await applyPass(PASSES[name], cur, { manager })).artifact;
const out = { node: process.version, replayMs: ms(t), r12: cur.revision, r12Matches: cur.revision === baseline.steps[14].revision };

// ---------- (1) the last cfg, piece by piece ----------
const pass = PASSES[names.at(-1)];
const p = {};
t = performance.now();
const facts = {};
for (const [alias, def] of Object.entries(pass.needs ?? {})) facts[alias] = (await manager.analyse(def, cur)).value;
p.needs = ms(t);
t = performance.now();
Store.from(cur.value);
p.storeFromAlone = ms(t);
t = performance.now();
const produced = await pass.run({ before: cur, facts, records: {}, params: {} });
p.passRun = ms(t);
p.fns = produced.report.fns;
t = performance.now();
const after = createIRArtifact(blocksAdapter, 'candela', produced.native);
p.createIRArtifact = ms(t);
p.revision = after.revision;
p.matches = after.revision === baseline.steps[15].revision;
t = performance.now();
const vb = openIR(cur, blocksAdapter), va = openIR(after, blocksAdapter);
p.openBothViews = ms(t);
t = performance.now();
const changes = diff(vb, va);
p.diff = ms(t);
p.changedEntities = changes.entities.length;
p.changedRelations = changes.relations.length;
t = performance.now();
const corr = makeCorrespondence(
  { artifact: cur.id, revision: cur.revision }, { artifact: after.id, revision: after.revision },
  vb.graph().entities.map(e => e.id), va.graph().entities.map(e => e.id), produced.correspondence ?? []);
p.correspondence = ms(t);
p.correspondenceEntries = corr.entries.length;
t = performance.now();
p.undeclared = undeclaredWrites(pass.writes, changes).length;
p.undeclaredMs = ms(t);
t = performance.now();
const again = await applyPass(pass, cur, { manager });
p.applyPassWhole = ms(t);
p.applyPassSameRevision = again.artifact.revision === after.revision;
out.lastCfg = p;
process.stderr.write(JSON.stringify(p) + '\n');

// ---------- (2) slices for adopting the head ----------
const head = after;
const parts = partsOf(head.value);
const rows = [];
const texts = new Map();
for (const [n, part] of parts) texts.set(n, partText(part));
for (const [n, text] of texts) {
  const t1 = performance.now();
  parsePart(text);
  rows.push({ fn: n, chars: text.length, parseFreezeMs: performance.now() - t1 });
}
rows.sort((a, b) => b.parseFreezeMs - a.parseFreezeMs);
out.slices = {
  parts: rows.length,
  partChars: rows.reduce((a, r) => a + r.chars, 0),
  parseFreezeSumMs: +rows.reduce((a, r) => a + r.parseFreezeMs, 0).toFixed(1),
  largestParseFreeze: rows.slice(0, 5).map(r => [r.fn, r.chars, +r.parseFreezeMs.toFixed(1)]),
  medianParseFreezeMs: +rows[rows.length >> 1].parseFreezeMs.toFixed(3),
};
const byHash = new Map();
const ref = partsRef(head.revision, head.value, true);
for (const [i, n] of head.value.fnOrder.entries()) byHash.set(ref.hashes[i], parsePart(texts.get(n)));
t = performance.now();
const value = assembleParts(ref, h => byHash.get(h));
out.slices.assembleParts = ms(t);
t = performance.now();
validateBlocks(value);
out.slices.validateBlocks = ms(t);
t = performance.now();
const text = canonical({ kind: 'typed.blocks', schemaVersion: '1', value });
out.slices.revisionText = ms(t);
out.slices.revisionChars = text.length;
const sha = new Sha256();
const slice = 1 << 20;
let worst = 0;
t = performance.now();
for (let i = 0; i < text.length; i += slice) {
  const t1 = performance.now();
  sha.update(text.slice(i, i + slice));
  worst = Math.max(worst, performance.now() - t1);
}
const digest = sha.digest();
out.slices.portableSha256Ms = ms(t);
out.slices.portableSha256WorstSliceMs = +worst.toFixed(1);
out.slices.sliceChars = slice;
out.slices.revisionMatches = digest === head.revision && revisionOf('typed.blocks', '1', value) === head.revision;
out.rssMB = Math.round(process.memoryUsage().rss / 1e6);
console.log(JSON.stringify(out, null, 1));
