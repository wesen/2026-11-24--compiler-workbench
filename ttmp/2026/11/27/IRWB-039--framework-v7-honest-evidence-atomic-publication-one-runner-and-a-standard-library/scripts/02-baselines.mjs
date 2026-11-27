#!/usr/bin/env node
// IRWB-039 phase 1a: baselines every refactor step must leave unchanged (or state, in its report, why it changed).
//   node 02-baselines.mjs write [out.json]     record, default ../various/baselines/main.json
//   node 02-baselines.mjs check [base.json]    recompute in this checkout and print every difference (exit 1 if any)
// Run from any directory; it measures the checkout it lives in (needs `npm run build` first), or ROOT=<checkout>.
// Recorded:
//   typed:  per corpus project and pipeline (r0, O2, speed): SHA-256 of the RV32 image, its byte size, RV32
//           instructions at the agents' seed (10 cases, seed 7) and a held-out seed (20, 1103), and edit records
//           per pass (the census);
//   tensor: per corpus/tensor program and function: SHA-256 of the CUDA source, fused and unfused; the revision of
//           optimizeTix with ['inline'] and with ['inline', 'split-sum'];
//   timing: milliseconds per pass application of Tix inline on attention (informational, never compared).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.env.ROOT ?? resolve(here, '../../../../../..'));
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const sha = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 16);
const [mode = 'check', file = resolve(here, '../various/baselines/main.json')] = process.argv.slice(2);

const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
const { projectSource } = await imp('dist/typed/project.js');
const { Program } = await imp('dist/typed/program.js');
const { measure } = await imp('dist/typed/strategies.js');
const { lowerToImage } = await imp('dist/typed/backend/index.js');
const T = await imp('dist/tensor/index.js');

const out = { typed: {}, tensor: {}, timing: {} };
for (const id of projectIds()) {
  const row = {};
  for (const pipe of ['r0', 'O2', 'speed']) {
    try {
      const p = Program.fromProject(projectSource(id, projectFiles(id)));
      const census = {};
      if (pipe !== 'r0') {
        await p.pipeline(pipe);
        for (const r of p.revisions.slice(1)) census[r.pass] = (census[r.pass] ?? 0) + (r.edits?.length ?? 0);
      }
      const image = lowerToImage(p.artifact()).image.value;
      const m = s => measure(p, p.artifact(), s).instructions;
      row[pipe] = { image: sha(image), bytes: image.bytes?.length ?? image.code?.length ?? null,
        instructions: m({ count: 10, seed: 7 }), heldout: m({ count: 20, seed: 1103 }), census };
    } catch (e) {
      row[pipe] = { error: String(e.message).slice(0, 200) };
    }
  }
  out.typed[id] = row;
}
const tdir = resolve(root, 'corpus/tensor');
for (const name of readdirSync(tdir)) {
  const p = T.compileTix(readFileSync(resolve(tdir, name, 'main.tix'), 'utf8'));
  const row = { functions: {} };
  for (const f of p.current.value.functions) {
    const fused = T.cudaSource(p, f.name), unfused = T.cudaSource(p, f.name, { fuse: false });
    row.functions[f.name] = { fused: sha(fused), unfused: sha(unfused) };
  }
  row.inline = T.optimizeTix(p, ['inline']).program.current.revision;
  row.inlineSplit = T.optimizeTix(p, ['inline', 'split-sum']).program.current.revision;
  out.tensor[name] = row;
}
{
  const { applyNativePassSync } = await imp('dist/framework/passes/index.js');
  const { inlinePass } = await imp('dist/tensor/passes.js');
  const p = T.compileTix(readFileSync(resolve(tdir, 'attention', 'main.tix'), 'utf8'));
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) applyNativePassSync(inlinePass, p.current, () => ({ ok: true }));
  out.timing.inlineAttentionMs = +((performance.now() - t0) / 50).toFixed(3);
}

if (mode === 'write') {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 1));
  const n = Object.keys(out.typed).length, errs = Object.values(out.typed).flatMap(r => Object.values(r)).filter(v => v.error).length;
  console.log(`wrote ${file}: ${n} typed projects (${errs} errors), ${Object.keys(out.tensor).length} Tix programs, inline ${out.timing.inlineAttentionMs} ms`);
} else {
  const base = JSON.parse(readFileSync(file, 'utf8'));
  const diffs = [];
  const walk = (a, b, path) => {
    if (path[0] === 'timing') return;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], [...path, k]);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${path.join('.')}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  };
  walk(base, out, []);
  console.log(diffs.length ? diffs.join('\n') : 'no differences from ' + file);
  console.log(`timing: inline on attention ${base.timing.inlineAttentionMs} -> ${out.timing.inlineAttentionMs} ms per application`);
  process.exit(diffs.length ? 1 : 0);
}
