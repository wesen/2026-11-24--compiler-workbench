import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles, projectIds } from '../../../../../../tools/corpus.mjs';
import { Program } from '../../../../../../dist/typed/program.js';
import { projectSource } from '../../../../../../dist/typed/project.js';
import { planFromSpec, PRESETS, runStrategy } from '../../../../../../dist/typed/strategies.js';
import { lowerToImage, runImage } from '../../../../../../dist/typed/backend/index.js';
import { casesFrom } from '../../../../../../dist/typed/evaluate.js';
import { storeOf } from '../../../../../../dist/typed/ir.js';
import { classifyRevision } from '../../../../../../dist/typed/edit-census.js';

await installVendor();
const out = new URL('../various/census/', import.meta.url);
mkdirSync(out, { recursive: true });
const classes = ['local', 'structural', 'other'];
const empty = () => Object.fromEntries(classes.map(c => [c, 0]));

function profile(artifact, cases) {
  const { image } = lowerToImage(artifact);
  const insns = image.value.insns;
  const counts = new Float64Array(insns.length);
  const missing = {};
  for (const c of cases) {
    const r = runImage(image, c.fn, c.args, c.memory);
    if (!r.counts) {
      const cause = r.limit ? 'limit' : r.trap;
      missing[cause] = (missing[cause] ?? 0) + 1;
    } else for (let i = 0; i < counts.length; i++) counts[i] += r.counts[i];
  }
  return { insns, counts, missing };
}

function weights(rows, profile, field, weights) {
  const claims = new Map();
  for (const row of rows) for (const sid of row[field]) {
    if (!claims.has(sid)) claims.set(sid, new Set());
    claims.get(sid).add(row.category);
  }
  for (const word of profile.insns) {
    const touched = new Set(word.covers.flatMap(id => [...(claims.get(id) ?? [])]));
    for (const category of touched) {
      weights.words[category] += 1 / touched.size;
      weights.hits[category] += profile.counts[word.offset / 4] / touched.size;
    }
  }
}

for (const project of process.argv.length > 2 ? process.argv.slice(2) : projectIds()) {
  const source = projectSource(project, projectFiles(project));
  const result = {};
  for (const pipeline of ['O2', 'speed']) {
    const p = Program.fromProject(source);
    const checked = await runStrategy(p, planFromSpec(pipeline, PRESETS[pipeline]));
    const run = result[pipeline] = { status: checked.status, error: checked.error, revisions: [], profiles: [] };
    if (checked.status !== 'succeeded') continue;
    const st = storeOf(p.origin.value);
    const cases = p.fns().flatMap(fn => casesFrom(st, fn, {count: 10, seed: 7, inputs: p.inputs[fn]}));
    const sample = r => {
      const data = profile(r.artifact, cases);
      run.profiles.push({ rev: r.rev, cases: cases.length, missing: data.missing });
      return data;
    };
    let previous;
    for (let i = 1; i < p.revisions.length; i++) {
      const before = p.revisions[i - 1], after = p.revisions[i];
      const rows = classifyRevision(before, after);
      previous ??= sample(before);
      const next = sample(after);
      const footprint = { words: empty(), hits: empty() };
      weights(rows, previous, 'beforeStatements', footprint);
      weights(rows, next, 'afterStatements', footprint);
      run.revisions.push({ rev: i, pass: after.pass, before: before.artifact.revision, after: after.artifact.revision,
        ...footprint, edits: rows.map(({edit, ...row}) => ({ id: edit.id, fn: edit.fn, kind: edit.kind, ...row })) });
      previous = next;
    }
  }
  writeFileSync(new URL(project + '.json.gz', out), gzipSync(JSON.stringify(result)));
  console.log(project, result.O2.status, result.speed.status);
}
