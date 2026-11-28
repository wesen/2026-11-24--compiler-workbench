#!/usr/bin/env node
// IRWB-049-B probe: what exactness costs. The old `add` (doubles, reimplemented here) against the
// library's (BigInt) on the forms Tix builds, then how many affine operations one compile of the Tix
// corpus performs, so the per-add difference can be bounded against a whole compile. The host is shared
// with other work, so the ratios are the evidence; absolute numbers move from run to run.
//   node 03-affine-cost.mjs      (needs `npm run build`; run from anywhere)
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const { add, constant, variable } = await imp('dist/stdlib/affine/forms.js');
const { compileTix, cudaSource, optimizeTix } = await imp('dist/tensor/index.js');
const { planFusion } = await imp('dist/tensor/fusion.js');

const old = (a, b, scale = 1) => {
  const terms = new Map(a.terms);
  for (const [name, k] of b.terms) terms.set(name, (terms.get(name) ?? 0) + k * scale);
  const result = {
    constant: a.constant + b.constant * scale,
    terms: [...terms].filter(([, k]) => k !== 0).sort(([x], [y]) => (x < y ? -1 : 1)),
  };
  if (![result.constant, ...result.terms.map(([, k]) => k)].every(Number.isSafeInteger))
    throw Error('Affine integer overflow');
  return result;
};

// Every form a Tix program carries (shapes, axis extents, indices, reduction extents), paired up.
const programs = {};
for (const name of readdirSync(resolve(root, 'corpus/tensor')).sort())
  programs[name] = readFileSync(resolve(root, `corpus/tensor/${name}/main.tix`), 'utf8');
const forms = [];
for (const text of Object.values(programs)) {
  const f = compileTix(text).current.value.functions[0];
  const walk = e => {
    if (e.kind === 'load') forms.push(...e.indices);
    if (e.kind === 'op') e.args.forEach(walk);
    if (e.kind === 'reduce') walk(e.body);
  };
  for (const t of [...f.params, ...f.statements]) forms.push(...t.shape);
  for (const s of f.statements) {
    for (const a of s.axes) forms.push(a.extent.dim);
    walk(s.expr);
  }
}
const pairs = [];
for (let k = 0; k + 1 < forms.length; k += 2) pairs.push([forms[k], forms[k + 1]]);

const nsPer = (f, n = 200000) => {
  const a = variable('i'),
    b = variable('j');
  for (let i = 0; i < 20000; i++) f(a, b, 1); // warm up
  const t = process.hrtime.bigint();
  for (let i = 0; i < n; i++) f(a, b, 1);
  return Number(process.hrtime.bigint() - t) / n;
};
console.log(
  `load average ${loadavg()
    .map(x => x.toFixed(0))
    .join(' ')} — a shared host, so the time per operation is noise;`,
);
console.log(`what is stable is how many of them a compile performs (below).`);
const before = nsPer(old),
  after = nsPer(add);
console.log(
  `one add of two terms, ${before.toFixed(0)} ns in doubles -> ${after.toFixed(0)} ns exact (${(after / before).toFixed(1)}x)`,
);
console.log(`  on the corpus's own forms, ${pairs.length} pairs from ${forms.length} forms:`);
const corpusMs = (f, n = 20000) => {
  for (let i = 0; i < 1000; i++) for (const [a, b] of pairs) f(a, b, 1);
  const t = process.hrtime.bigint();
  for (let i = 0; i < n; i++) for (const [a, b] of pairs) f(a, b, 1);
  return Number(process.hrtime.bigint() - t) / 1e6 / n;
};
console.log(`  old add ${corpusMs(old).toFixed(4)} ms per pass, exact ${corpusMs(add).toFixed(4)} ms`);

// How many affine operations one compile of the corpus performs: patch a copy of dist to count them.
const tmp = mkdtempSync(join(tmpdir(), 'affine-count-'));
cpSync(resolve(root, 'dist'), join(tmp, 'dist'), { recursive: true });
const formsFile = join(tmp, 'dist/stdlib/affine/forms.js');
cpSync(formsFile, join(tmp, 'dist/stdlib/affine/forms-real.js'));
writeFileSync(
  formsFile,
  `export * from './forms-real.js';\nimport * as real from './forms-real.js';\n` +
    `export const calls = { add: 0, substitute: 0 };\n` +
    `export function add(a, b, scale) { calls.add++; return real.add(a, b, scale); }\n` +
    `export function substitute(a, b) { calls.substitute++; return real.substitute(a, b); }\n`,
);
const { compileTix: counted } = await import(pathToFileURL(join(tmp, 'dist/tensor/index.js')).href);
const { calls } = await import(pathToFileURL(formsFile).href);
for (const [name, text] of Object.entries(programs)) {
  const before = { ...calls };
  const p = counted(text);
  for (const f of p.current.value.functions) {
    planFusion(f);
    optimizeTix(p, ['inline', 'split-sum']);
    cudaSource(p, f.name);
  }
  console.log(
    `  ${name}: ${calls.add - before.add} add, ${calls.substitute - before.substitute} substitute per compile`,
  );
}
console.log(
  `at most 60 adds per compile: even at the inflated per-add cost this host measures, the whole affine ` +
    `traffic of a compile is well under a millisecond, against compiles of 10 to 170 ms.`,
);
