#!/usr/bin/env node
// IRWB-049-B probe: dependence distances on small Tix programs with known answers, and the library's
// aligned depth against the predicate joinDepth used before the move (`plain(index) === axis`), on
// every read of every statement of the Tix corpus.
//   node 02-distances.mjs      (needs `npm run build`; run from anywhere)
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const { compileTix } = await imp('dist/tensor/index.js');
const { plain, visit } = await imp('dist/tensor/model.js');
const { distance, distances, alignedDepth } = await imp('dist/stdlib/affine/distances.js');

const fn = src => compileTix(src).current.value.functions[0];
const loads = s => {
  const out = [];
  visit(s.expr, e => {
    if (e.kind === 'load') out.push(e);
  });
  return out;
};
const text = a =>
  [
    ...a.terms.map(([n, k]) => (k === 1 ? n : `${k}*${n}`)),
    ...(a.constant || !a.terms.length ? [a.constant] : []),
  ].join('+');

const programs = {
  aligned: `fn aligned(x: f32[N]): f32[N] { y[i] = x[i]; return y; }`,
  shifted: `fn shifted(x: f32[N]): f32[N-1] { y[i]: f32[N-1] = x[i + 1]; return y; }`,
  transposed: `fn transposed(x: f32[M,N]): f32[N,M] { y[i,j]: f32[N,M] = x[j,i]; return y; }`,
  'constant index': `fn pick(g: f32[M], x: f32[N,M]): f32[N,M] { y[i,j] = x[i,j] * g[0]; return y; }`,
};
for (const [name, src] of Object.entries(programs)) {
  for (const s of fn(src).statements) {
    const axes = s.axes.map(a => a.id);
    for (const r of loads(s)) {
      const d = distances(axes, r.indices);
      console.log(
        `${name}: ${s.name}[${axes.join(',')}] reads ${r.name}[${r.indices.map(text).join(',')}] → ` +
          `distance [${d.map(text).join(', ')}], aligned depth ${alignedDepth(axes, r.indices)}`,
      );
    }
  }
}
console.log(`distance(i, i) = ${text(distance('i', { constant: 0, terms: [['i', 1]] })) || '0'}`);

// The decision the library now makes for a whole statement: the leading positions at which every read
// of the group's members is aligned — the same number the old predicate gave, on every corpus read.
const tdir = resolve(root, 'corpus/tensor');
let reads = 0,
  disagree = 0,
  statements = 0;
for (const name of readdirSync(tdir)) {
  const f = fn(readFileSync(resolve(tdir, name, 'main.tix'), 'utf8'));
  for (const s of f.statements) {
    statements++;
    const axes = s.axes.map(a => a.id);
    for (const r of loads(s)) {
      reads++;
      const now = alignedDepth(axes, r.indices);
      let old = 0;
      while (old < axes.length && old < r.indices.length && plain(r.indices[old]) === axes[old]) old++;
      if (now !== old) {
        disagree++;
        console.log(`  differs in ${name}/${s.name}: ${r.name} — library ${now}, old ${old}`);
      }
    }
  }
}
console.log(`${tdir.split('/').pop()}: ${statements} statements, ${reads} reads, ${disagree} disagreements`);
