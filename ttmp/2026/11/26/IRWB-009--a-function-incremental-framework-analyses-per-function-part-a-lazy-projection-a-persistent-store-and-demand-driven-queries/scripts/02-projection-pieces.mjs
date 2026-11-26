// IRWB-009: what createIRArtifact, the projection, diff and correspondence cost on Candela, piece by piece.
//
//   cold:  a value whose records are all new (r0 as lifted): immutable, validateBlocks, contentHash, revision, then
//          the projection's pieces (entities, relations, validateGraph with its two sorts, the resolve check)
//   warm:  a value that shares every record with r0 but is a new object (what a pass that changed nothing in a
//          function's records leaves for it): the same pieces, with IRWB-004's per-record caches hitting
//   parts: the same projection built per function part (each part's entities and relations, sorted within the part)
//   delta: r0 against r1 (the cfg pass, 110 functions changed): the whole diff and correspondence, against a diff of
//          the changed parts' projections only
//
//   systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 \
//     node --max-old-space-size=10240 …/02-projection-pieces.mjs > …/various/02-projection-pieces.json
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter, blocksEntities, blocksRelations, validateBlocks, entityIdSet } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact, openIR, project, validateGraph, compareRelations, validateEntity, makeCorrespondence, diffGraphs } =
  await import(root + 'dist/framework/ir/index.js');
const { compareText } = await import(root + 'dist/framework/ir/common.js');
const { immutable, fingerprint, revisionOf, sameCanonical, canonical } = await import(root + 'dist/framework/core/data.js');
const { PASSES } = await import(root + 'dist/typed/passes.js');
const { partsOf } = await import(root + 'dist/typed/parts.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');

const ms = t => +(performance.now() - t).toFixed(1);
const out = { node: process.version };
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });

const pieces = (snap, label) => {
  const o = {};
  let t = performance.now();
  validateBlocks(snap);
  o.validateBlocks = ms(t);
  t = performance.now();
  const ents = blocksEntities(snap);
  o.entities = ms(t);
  t = performance.now();
  const rels = blocksRelations(snap);
  o.relations = ms(t);
  const roots = blocksAdapter.roots(snap);
  t = performance.now();
  [...ents].sort((a, b) => compareText(a.id, b.id));
  o.sortEntitiesAlone = ms(t);
  t = performance.now();
  [...rels].sort(compareRelations);
  o.sortRelationsAlone = ms(t);
  t = performance.now();
  const g = validateGraph(blocksAdapter, { entities: ents, relations: rels, roots });
  o.validateGraph = ms(t);
  t = performance.now();
  for (const e of g.entities) {
    const r = blocksAdapter.resolve(snap, e.id);
    if (!r || !sameCanonical(validateEntity(r), e)) throw new Error('resolve ' + e.id);
  }
  o.resolveCheck = ms(t);
  o.counts = { entities: ents.length, relations: rels.length };
  process.stderr.write(`${label} ${JSON.stringify(o)}\n`);
  return o;
};

// ---------- cold ----------
let t = performance.now();
const snap = immutable(st.toNative());
out.cold = { immutable: ms(t) };
t = performance.now();
fingerprint(snap);
out.cold.contentHash = ms(t);
t = performance.now();
revisionOf('typed.blocks', '1', snap);
out.cold.revisionHash = ms(t);
Object.assign(out.cold, pieces(snap, 'cold'));
// the whole of createIRArtifact on another all-new value, for the total
t = performance.now();
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
out.cold.createIRArtifactTotal = ms(t);
out.r0 = r0.revision;

// ---------- warm: a new value object over r0's frozen records ----------
t = performance.now();
const warm = immutable({ ...r0.value, rev: r0.value.rev + 1 });
out.warm = { immutable: ms(t) };
t = performance.now();
fingerprint(warm);
out.warm.contentHash = ms(t);
t = performance.now();
revisionOf('typed.blocks', '1', warm);
out.warm.revisionHash = ms(t);
Object.assign(out.warm, pieces(warm, 'warm'));
t = performance.now();
createIRArtifact(blocksAdapter, 'candela', immutable({ ...r0.value, rev: r0.value.rev + 2 }));
out.warm.createIRArtifactTotal = ms(t);

// ---------- per part, cold (a third all-new value) ----------
const cold3 = immutable(st.toNative());
const parts3 = partsOf(cold3);
const mini = p => ({
  fns: { [p.name]: p.fn },
  blocks: Object.fromEntries(p.blocks.map(b => [b.id, b])),
  stmts: Object.fromEntries(p.stmts.map(s => [s.id, s])),
  values: Object.fromEntries(p.values.map(x => [x.id, x])),
  ops: Object.fromEntries(p.ops.map(o => [o.id, o])),
});
const partRows = [];
t = performance.now();
for (const p of parts3.values()) {
  const t1 = performance.now();
  const m = mini(p);
  const e = blocksEntities(m).sort((a, b) => compareText(a.id, b.id));
  const r = blocksRelations(m).sort(compareRelations);
  partRows.push({ fn: p.name, ms: performance.now() - t1, entities: e.length, relations: r.length });
}
out.perPart = { totalMs: ms(t), entities: partRows.reduce((a, r) => a + r.entities, 0), relations: partRows.reduce((a, r) => a + r.relations, 0) };
const sortedRows = [...partRows].sort((a, b) => b.ms - a.ms);
out.perPart.top = sortedRows.slice(0, 5).map(r => [r.fn, +r.ms.toFixed(1), r.entities, r.relations]);
out.perPart.medianMs = +sortedRows[sortedRows.length >> 1].ms.toFixed(3);

// ---------- delta: r0 against r1 (cfg, 110 functions) ----------
const manager = new AnalysisManager();
const facts = {};
for (const [alias, def] of Object.entries(PASSES.cfg.needs ?? {})) facts[alias] = (await manager.analyse(def, r0)).value;
t = performance.now();
const produced = await PASSES.cfg.run({ before: r0, facts, records: {}, params: {} });
out.delta = { cfgRun: ms(t) };
t = performance.now();
const r1 = createIRArtifact(blocksAdapter, 'candela', produced.native);
out.delta.createIRArtifactR1 = ms(t);
out.r1 = r1.revision;
const v0 = openIR(r0, blocksAdapter), v1 = openIR(r1, blocksAdapter);
t = performance.now();
const changes = diffGraphs(v0.graph(), v1.graph(), { artifact: 'candela', revision: r0.revision }, { artifact: 'candela', revision: r1.revision });
out.delta.diffWhole = ms(t);
out.delta.changedEntities = changes.entities.length;
out.delta.changedRelations = changes.relations.length;
t = performance.now();
const corr = makeCorrespondence(
  { artifact: 'candela', revision: r0.revision }, { artifact: 'candela', revision: r1.revision },
  v0.graph().entities.map(e => e.id), v1.graph().entities.map(e => e.id), produced.correspondence ?? []);
out.delta.correspondenceWhole = ms(t);
out.delta.correspondenceEntries = corr.entries.length;
out.delta.correspondenceNonRetained = corr.entries.filter(e => e.relation !== 'retained').length;
// per part: only the parts that are new objects
const p0 = partsOf(r0.value), p1 = partsOf(r1.value);
t = performance.now();
let changedParts = 0, partEntities = 0, partRelations = 0;
for (const [name, a] of p1) {
  const b = p0.get(name);
  if (a === b) continue;
  changedParts++;
  const ga = { entities: blocksEntities(mini(a)), relations: blocksRelations(mini(a)), roots: [] };
  const gb = b ? { entities: blocksEntities(mini(b)), relations: blocksRelations(mini(b)), roots: [] } : { entities: [], relations: [], roots: [] };
  const c = diffGraphs(gb, ga, { artifact: 'x', revision: 'a' }, { artifact: 'x', revision: 'b' });
  partEntities += c.entities.length;
  partRelations += c.relations.length;
}
out.delta.diffChangedPartsOnly = ms(t);
out.delta.partsChanged = changedParts;
out.delta.partDiffEntities = partEntities;
out.delta.partDiffRelations = partRelations;
// the entity id sets alone (what revisionCorrespondence uses)
t = performance.now();
entityIdSet(r0.value); entityIdSet(r1.value);
out.delta.entityIdSets = ms(t);
out.rssMB = Math.round(process.memoryUsage().rss / 1e6);
console.log(JSON.stringify(out, null, 1));
