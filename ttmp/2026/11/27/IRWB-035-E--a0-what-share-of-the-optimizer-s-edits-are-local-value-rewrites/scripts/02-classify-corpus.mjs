// IRWB-035-E, measurement 02: the edit classification census. For every corpus project, runs the O2 and speed
// pipelines with applyPass (no contract: the meaning check decides nothing about an edit's shape, and IRWB-008
// already measured the gate separately), classifies every edit of every changed application with the tool
// (src/typed/edit-class.ts), and weights each edit by the machine instructions it affects: the instructions of
// the application's before-image that cover entities the edit erased (dropped), plus the instructions of its
// after-image that cover entities the edit brought in (owned). Every changed revision is lowered once, so the
// images chain along the pipeline. Writes one JSON record per project (and a merged summary JSON), so a partial
// run keeps its results.
//
// usage: node 02-classify-corpus.mjs [--projects a,b] [--pipelines O2,speed] [--out dir]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { projectSource, ingestProject } = await import(root + 'dist/typed/project.js');
const { PASSES, PIPELINES } = await import(root + 'dist/typed/passes.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { lowerToImage } = await import(root + 'dist/typed/backend/index.js');
const { classifyApplication } = await import(root + 'dist/typed/edit-class.js');
const { mkdirSync, writeFileSync } = await import('node:fs');
const { join } = await import('node:path');

const argv = process.argv.slice(2);
const opt = n => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ids = opt('--projects') ? opt('--projects').split(',') : projectIds();
const pipes = opt('--pipelines') ? opt('--pipelines').split(',') : ['O2', 'speed'];
const outDir = opt('--out') ?? new URL('../various/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

// ---------- per-edit instruction weight (the design's section 4) ----------
/** The ids of the value tree rooted at `root` in a revision. */
const treeIds = (rev, root, out = new Set()) => {
  if (!root || out.has(root)) return out;
  out.add(root);
  for (const a of rev.values[root].args) treeIds(rev, a, out);
  return out;
};
/** The ids of all the value trees of a statement's fields (value, cond, addr). */
const fieldTreeIds = (rev, sid, out = new Set()) => {
  const s = rev.stmts[sid];
  if (s) for (const f of [s.value, s.cond, s.addr]) treeIds(rev, f, out);
  return out;
};
/** image entity -> the indices of the instructions that cover it */
const coversIndex = image => {
  const m = new Map();
  image.value.insns.forEach((insn, i) => {
    for (const c of insn.covers) {
      let s = m.get(c);
      if (!s) m.set(c, (s = new Set()));
      s.add(i);
    }
  });
  return m;
};
const covering = (index, entities) => {
  const hit = new Set();
  for (const id of entities) for (const i of index.get(id) ?? []) hit.add(i);
  return hit.size;
};

/**
 * The entities each edit of one application owns (brought in: new at this application) and drops (erased or
 * changed away). Branch edits that rewrite a surviving statement (retarget) count it on both sides.
 */
function ownedDropped(edits, before, after) {
  const newAt = new Set(),
    idsInA = new Set();
  const inBefore = id =>
    !!before.values[id] || !!before.stmts[id] || !!before.blocks[id];
  for (const table of [after.values, after.stmts, after.blocks])
    for (const id of Object.keys(table)) {
      idsInA.add(id);
      if (!inBefore(id)) newAt.add(id);
    }
  const gone = id => !idsInA.has(id);
  const owned = new Map(),
    dropped = new Map();
  for (const e of edits) {
    const own = new Set(),
      drop = new Set();
    switch (e.kind) {
      case 'replace': {
        if (after.values[e.to]) for (const id of treeIds(after, e.to)) if (newAt.has(id)) own.add(id);
        if (before.values[e.from]) for (const id of treeIds(before, e.from)) if (gone(id)) drop.add(id);
        break;
      }
      case 'retarget':
        own.add(e.stmt);
        drop.add(e.stmt);
        break;
      case 'replaceStmt': {
        own.add(e.to);
        for (const id of fieldTreeIds(after, e.to)) if (newAt.has(id)) own.add(id);
        drop.add(e.from);
        for (const id of fieldTreeIds(before, e.from)) if (gone(id)) drop.add(id);
        break;
      }
      case 'insert': {
        own.add(e.stmt);
        for (const id of fieldTreeIds(after, e.stmt)) if (newAt.has(id)) own.add(id);
        break;
      }
      case 'move':
        own.add(e.stmt);
        break;
      case 'remove': {
        drop.add(e.stmt);
        for (const id of fieldTreeIds(before, e.stmt)) if (gone(id)) drop.add(id);
        break;
      }
      case 'unreachable': {
        const b = before.blocks[e.block];
        if (b)
          for (const sid of b.stmts) {
            drop.add(sid);
            for (const id of fieldTreeIds(before, sid)) if (gone(id)) drop.add(id);
          }
        break;
      }
      case 'inline': {
        // the call statement and its tree are dropped; the copied statements are owned below (the leftovers)
        drop.add(e.stmt);
        for (const id of fieldTreeIds(before, e.stmt)) if (gone(id)) drop.add(id);
        break;
      }
      default:
        break; // local, block, merge: bookkeeping, no instructions of their own
    }
    owned.set(e, own);
    dropped.set(e, drop);
  }
  // the inline records own the new entities of their caller that no other record owns (the unrecorded copies)
  const taken = new Set();
  for (const own of owned.values()) for (const id of own) taken.add(id);
  for (const e of edits)
    if (e.kind === 'inline') {
      const fnId = `fn:${e.fn}`;
      const own = owned.get(e);
      for (const [id, rec] of [...Object.entries(after.values), ...Object.entries(after.stmts)])
        if (newAt.has(id) && rec.fn === fnId && !taken.has(id)) (own.add(id), taken.add(id));
    }
  return { owned, dropped };
}

// ---------- the census ----------
const zero = () => ({
  edits: 0,
  cls: { local: 0, structural: 0, other: 0 },
  just: { rule: 0, fact: 0, none: 0 },
  facts: {},
  rules: {},
  notRederived: [],
  owned: 0,
  dropped: 0,
});
const t0 = performance.now();
const merged = { projects: ids, pipelines: pipes, byProject: {} };
for (const id of ids) {
  const a = performance.now();
  const p = projectSource(id, projectFiles(id));
  const r0 = ingestProject(p);
  const rec = { project: id, fns: Object.keys(r0.value.fns).length, pipelines: {} };
  for (const pl of pipes) {
    const manager = new AnalysisManager();
    const pipe = { applications: 0, changed: 0, byPass: {}, edits: 0, cls: { local: 0, structural: 0, other: 0 }, images: {} };
    let cur = r0,
      prevImage = lowerToImage(r0).image;
    pipe.images.r0 = prevImage.value.insns.length;
    for (const name of PIPELINES[pl]) {
      const r = await applyPass(PASSES[name], cur, { manager });
      if (!r.changed) continue;
      pipe.applications++;
      const edits = r.report?.edits ?? [];
      const cls = classifyApplication({ pass: name, edits, before: cur.value, after: r.artifact.value });
      const nextImage = lowerToImage(r.artifact).image;
      const prevIdx = coversIndex(prevImage),
        nextIdx = coversIndex(nextImage);
      const { owned, dropped } = ownedDropped(edits, cur.value, r.artifact.value);
      const row = (pipe.byPass[name] ??= zero());
      pipe.changed++;
      for (let i = 0; i < edits.length; i++) {
        const e = edits[i],
          c = cls[i];
        pipe.edits++;
        row.edits++;
        pipe.cls[c.cls]++;
        row.cls[c.cls]++;
        row.owned += covering(nextIdx, owned.get(e));
        row.dropped += covering(prevIdx, dropped.get(e));
        if (c.cls === 'local') {
          row.just[c.local.kind]++;
          if (c.local.kind === 'rule') for (const rn of c.local.rules) row.rules[rn] = (row.rules[rn] ?? 0) + 1;
          if (c.local.kind === 'fact') row.facts[c.local.fact] = (row.facts[c.local.fact] ?? 0) + 1;
          if (c.local.kind === 'none')
            row.notRederived.push(`${name} ${e.id} ${e.fn} ${(e.text ?? '').slice(0, 40)}`);
        }
      }
      cur = r.artifact;
      prevImage = nextImage;
    }
    pipe.images.head = lowerToImage(cur).image.value.insns.length;
    rec.pipelines[pl] = pipe;
  }
  rec.ms = Math.round(performance.now() - a);
  merged.byProject[id] = rec;
  writeFileSync(join(outDir, `02-${id}.json`), JSON.stringify(rec, null, 1) + '\n');
  console.log(`${id} ${rec.ms} ms`);
}
merged.ms = Math.round(performance.now() - t0);
writeFileSync(join(outDir, '02-summary.json'), JSON.stringify(merged, null, 1) + '\n');
console.log(`done: ${ids.length} projects, ${pipes.join(' ')}, ${merged.ms} ms`);
