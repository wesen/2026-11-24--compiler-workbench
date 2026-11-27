// Claims: (D) no domain imports the framework's rewrite, transaction or traversal modules, and the Tix adapter is
// not rewritable; (C, D) the core runtime (runtime.ts, query.ts, records.ts, about 1,240 lines) has no domain caller.
// Method: (1) resolve every relative import in src/ to a file, follow re-exports through index.ts by NAME (a domain
// importing `{ x } from '../framework/ir/index.js'` uses the module that defines x), and compute, per framework
// module, which domain files use one of its names; (2) the transitive file closure from each domain, so a module a
// used module imports counts as reached; (3) open a Tix view and try a generic edit.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, normalize, relative } from 'node:path';
import { at, dist } from './00-root.mjs';
const src = at('src');
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
const all = walk(src);
const rel = f => relative(src, f);
const lines = f => readFileSync(f, 'utf8').split('\n').length - (readFileSync(f, 'utf8').endsWith('\n') ? 1 : 0);
const resolveImport = (from, spec) => {
  const base = normalize(join(dirname(from), spec)).replace(/\.js$/, '.ts');
  return all.includes(base) ? base : all.includes(base.replace(/\.ts$/, '/index.ts')) ? base.replace(/\.ts$/, '/index.ts') : undefined;
};
const importsOf = f => [...readFileSync(f, 'utf8').matchAll(/(?:import|export)\s+(?:type\s+)?(?:\{([^}]*)\}|\*\s+as\s+\w+|\*|[\w$]+)?\s*(?:,\s*\{([^}]*)\})?\s*from\s+'(\.[^']+)'/g)]
  .map(m => ({ names: `${m[1] ?? ''},${m[2] ?? ''}`.split(',').map(s => s.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0].trim()).filter(Boolean), star: !m[1] && !m[2], to: resolveImport(f, m[3]) }))
  .filter(i => i.to);
// where a name is defined, following `export { a } from` and `export * from` chains
const definedIn = (file, name, seen = new Set()) => {
  if (seen.has(file)) return undefined; seen.add(file);
  const s = readFileSync(file, 'utf8');
  if (new RegExp(`^export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|class|interface|type|abstract\\s+class|enum)\\s+${name}\\b`, 'm').test(s)) return file;
  for (const i of importsOf(file)) if (/^\s*export/.test(s.slice(0)) || true) {
    const reexp = new RegExp(`export\\s+(?:type\\s+)?(?:\\{[^}]*\\b${name}\\b[^}]*\\}|\\*)\\s+from\\s+'[^']*'`, 'm');
    if (!reexp.test(s)) continue;
    const hit = definedIn(i.to, name, seen); if (hit) return hit;
  }
  return undefined;
};
const fw = all.filter(f => rel(f).startsWith('framework/') && !f.endsWith('index.ts'));
const domains = { typed: 'typed/', tensor: 'tensor/', workbench: 'workbench/' };
const usedBy = new Map(fw.map(f => [f, { typed: new Set(), tensor: new Set(), workbench: new Set() }]));
for (const [d, prefix] of Object.entries(domains))
  for (const f of all.filter(f => rel(f).startsWith(prefix)))
    for (const i of importsOf(f)) {
      if (!rel(i.to).startsWith('framework/')) continue;
      if (!i.to.endsWith('index.ts')) { usedBy.get(i.to)?.[d].add(rel(f)); continue; }
      for (const n of i.names) { const def = definedIn(i.to, n); if (def && usedBy.has(def)) usedBy.get(def)[d].add(rel(f)); }
    }
// transitive closure over files (through framework-internal imports)
const reach = seeds => { const seen = new Set(); const go = f => { if (seen.has(f)) return; seen.add(f); for (const i of importsOf(f)) go(i.to); }; seeds.forEach(go); return seen; };
const closure = Object.fromEntries(Object.entries(domains).map(([d, p]) => [d, reach(all.filter(f => rel(f).startsWith(p)))]));
console.log('module'.padEnd(40), 'lines', 'named-use typed/tensor/workbench', ' transitively reached by');
let noDomain = 0;
for (const f of fw.sort()) {
  const u = usedBy.get(f);
  const named = `${u.typed.size}/${u.tensor.size}/${u.workbench.size}`;
  const tr = Object.keys(domains).filter(d => closure[d].has(f) && !rel(f).startsWith(d)).join(',') || '-';
  if (!u.typed.size && !u.tensor.size && !u.workbench.size) noDomain += lines(f);
  console.log(rel(f).padEnd(40), String(lines(f)).padStart(5), named.padStart(12), '                     ', tr);
}
const core = ['framework/core/runtime.ts', 'framework/core/query.ts', 'framework/core/records.ts'].map(p => join(src, p));
console.log('core runtime lines (runtime+query+records):', core.map(lines).reduce((a, b) => a + b, 0),
  '| named by a domain:', core.some(f => Object.values(usedBy.get(f)).some(s => s.size)),
  '| transitively reached by a domain:', core.filter(f => Object.keys(domains).some(d => closure[d].has(f))).map(rel).join(', ') || 'none');
console.log('importers of the core runtime anywhere in src/:', all.filter(f => importsOf(f).some(i => core.includes(i.to) || (i.to.endsWith('core/index.ts') && /Compiler|query|records/.test(readFileSync(f, 'utf8'))))).map(rel).join(', '));
console.log('framework lines no domain names:', noDomain);

const { adapter } = await dist('tensor/ir.js');
const ir = await dist('framework/ir/index.js');
const { compileTix } = await dist('tensor/index.js');
const view = ir.openIR(compileTix('fn f(x:f32[N]):f32[N] { y[i] = x[i] * 2; return y; }').origin, adapter);
console.log('Tix adapter capabilities:', JSON.stringify(view.descriptor.capabilities));
try { view.beginEdit(); console.log('Tix view.beginEdit(): opened'); } catch (e) { console.log('Tix view.beginEdit():', e.code, '-', e.message); }
