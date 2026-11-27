// Probe: which src/framework modules does each consumer group import, and how many framework lines does no
// domain reach? "Reach" is transitive: a module a domain imports, or one those modules import.
// usage: node 01-framework-import-census.mjs   (run from the worktree root; reads src/, no build needed)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
const root = process.argv[2] ?? 'src';
const files = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []; });
const all = files(root);
const imports = f => [...readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)]
  .map(m => normalize(join(dirname(f), m[1])).replace(/\.js$/, '.ts'));
const graph = new Map(all.map(f => [f, imports(f)]));
const expand = f => (graph.has(f) ? [f] : graph.has(f.replace(/\.ts$/, '/index.ts')) ? [f.replace(/\.ts$/, '/index.ts')] : []);
const reach = seeds => { const seen = new Set(); const go = f => { for (const g of expand(f)) if (!seen.has(g)) { seen.add(g); graph.get(g).forEach(go); } }; seeds.forEach(go); return seen; };
const lines = f => readFileSync(f, 'utf8').split('\n').length - 1;
const fw = all.filter(f => f.startsWith(join(root, 'framework')));
const groups = { typed: ['typed'], tensor: ['tensor'], workbench: ['workbench'], 'labs+conformance': ['labs', 'conformance'] };
const reached = {};
for (const [g, dirs] of Object.entries(groups))
  reached[g] = reach(all.filter(f => dirs.some(d => f.startsWith(join(root, d) + '/'))));
console.log('module'.padEnd(44), 'lines', Object.keys(groups).join(' '));
let dead = 0, total = 0, tensorOnly = 0;
for (const f of fw.sort()) {
  const n = lines(f); total += n;
  const marks = Object.keys(groups).map(g => (reached[g].has(f) ? 'x' : '.').padEnd(g.length));
  const domains = reached.typed.has(f) || reached.tensor.has(f) || reached.workbench.has(f);
  if (!domains) dead += n;
  if (!reached.tensor.has(f)) tensorOnly += n;
  console.log(f.padEnd(44), String(n).padStart(5), marks.join(' '), domains ? '' : '  <- no domain reaches it');
}
console.log(`framework lines: ${total}; reached by no domain (typed, tensor, workbench): ${dead}; not reached by tensor: ${tensorOnly}`);
// direct imports only: which framework files does a domain name itself?
for (const g of ['typed', 'tensor']) {
  const direct = new Set(all.filter(f => f.startsWith(join(root, g) + '/')).flatMap(f => graph.get(f)).flatMap(expand).filter(f => fw.includes(f)));
  console.log(`${g} imports directly:`, [...direct].map(f => f.replace(join(root, 'framework') + '/', '')).sort().join(', '));
}

// Part 2: transitive reach overstates use (ir/index.ts re-exports everything). Count, for each framework module,
// how many of its exported names occur as identifiers in each domain's sources that import the framework.
const exported = f => [...readFileSync(f, 'utf8').matchAll(/^export (?:async )?(?:function\*?|const|class|interface|type) ([A-Za-z0-9_]+)/gm)].map(m => m[1]);
const text = Object.fromEntries(['typed', 'tensor', 'workbench'].map(g => [g, all.filter(f => f.startsWith(join(root, g) + '/')).map(f => {
  const s = readFileSync(f, 'utf8');
  // only names inside import clauses that come from the framework (direct or through a framework index)
  return [...s.matchAll(/import\s+(?:type\s+)?(?:\*\s+as\s+\w+|\{([^}]*)\})\s+from\s+'([^']*framework[^']*)'/g)].map(m => m[1] ?? '').join(',');
}).join(',')]));
console.log('\nexported names a domain imports by name, per framework module (used/exported):');
for (const f of fw.sort()) {
  const names = exported(f); if (!names.length) continue;
  const row = ['typed', 'tensor', 'workbench'].map(g => {
    const used = names.filter(n => new RegExp(`(^|[,\\s])(type\\s+)?${n}(\\s+as\\s+\\w+)?\\s*(,|$)`, 'm').test(text[g]));
    return `${g} ${used.length}/${names.length}`.padEnd(18);
  });
  console.log(f.replace(join(root, 'framework') + '/', '').padEnd(32), row.join(' '));
}
