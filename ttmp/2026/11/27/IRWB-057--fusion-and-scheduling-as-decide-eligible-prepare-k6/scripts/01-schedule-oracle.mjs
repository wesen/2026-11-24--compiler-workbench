#!/usr/bin/env node
// IRWB-057 probe 01: the schedules and CUDA sources the lowering produces, as an oracle for this step.
//   node 01-schedule-oracle.mjs write   record 01-schedule-oracle.out.json (run on the base commit ab23152)
//   node 01-schedule-oracle.mjs check   recompute and compare (default)
// Programs: the Tix corpus, the test fixtures' functions, and the programs written inline in the tensor tests
// (anything that parses), each fused and unfused. Recorded per function: SHA-256 of the CUDA source and the
// schedule's kernels (names, kinds, fusion groups, variants, selection) as JSON.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../../..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const sha = x => createHash('sha256').update(x).digest('hex').slice(0, 16);
const T = await imp('dist/tensor/index.js');
const { lowerSchedule } = await imp('dist/tensor/strategy.js');

const sources = new Map();
for (const name of readdirSync(resolve(root, 'corpus/tensor')))
  sources.set('corpus/' + name, readFileSync(resolve(root, 'corpus/tensor', name, 'main.tix'), 'utf8'));
const fixtures = resolve(root, 'tests/tensor/fixtures');
for (const name of readdirSync(fixtures))
  if (name.endsWith('.tix')) sources.set('fixtures/' + name, readFileSync(resolve(fixtures, name), 'utf8'));
for (const file of [...readdirSync(resolve(root, 'tests/tensor')), '../stdlib/affine.test.mjs'].filter(f => f.endsWith('.mjs'))) {
  const text = readFileSync(resolve(root, 'tests/tensor', file), 'utf8');
  let i = 0;
  for (const m of text.matchAll(/fn \w+\([^)]*\)\s*:\s*f32[^{]*\{[^}]*\}/g)) sources.set(`${file}#${i++}`, m[0]);
}
const out = {};
let functions = 0;
for (const [name, text] of sources) {
  let p;
  try {
    p = T.compileTix(text.replaceAll('\\n', '\n'));
  } catch {
    continue; // a test's deliberately invalid program
  }
  for (const program of [p, T.optimizeTix(p, ['inline']).program, T.optimizeTix(p, ['inline', 'split-sum']).program])
    for (const f of program.current.value.functions)
      for (const fuse of [true, false]) {
        const key = `${name}:${f.name}:${program.current.revision.slice(0, 8)}:${fuse ? 'fused' : 'unfused'}`;
        try {
          out[key] = {
            cuda: sha(T.cudaSource(program, f.name, { fuse })),
            kernels: lowerSchedule(f, fuse).value.kernels,
          };
        } catch (e) {
          out[key] = { error: String(e.message) };
        }
        functions++;
      }
}
const file = resolve(here, '01-schedule-oracle.out.json');
if (process.argv[2] === 'write') {
  writeFileSync(file, JSON.stringify(out, null, 1));
  const kinds = Object.values(out).flatMap(o => (o.kernels ?? []).map(k => k.kind));
  const count = k => kinds.filter(x => x === k).length;
  console.log(`wrote ${Object.keys(out).length} schedules (${functions} lowered) from ${sources.size} sources: ` +
    `${count('pointwise')} pointwise, ${count('rows')} rows, ${count('contraction')} contraction kernels, ` +
    `${Object.values(out).filter(o => o.error).length} errors`);
} else {
  const base = JSON.parse(readFileSync(file, 'utf8'));
  // programs added to the tests after the record have no base to compare with
  const diffs = Object.keys(base).filter(
    k => JSON.stringify(base[k]) !== JSON.stringify(JSON.parse(JSON.stringify(out[k] ?? null))),
  );
  const added = Object.keys(out).filter(k => !(k in base)).length;
  console.log(
    diffs.length
      ? `${diffs.length} differences:\n` + diffs.slice(0, 20).join('\n')
      : `no differences (${Object.keys(base).length} schedules; ${added} new programs not compared)`,
  );
  process.exit(diffs.length ? 1 : 0);
}
