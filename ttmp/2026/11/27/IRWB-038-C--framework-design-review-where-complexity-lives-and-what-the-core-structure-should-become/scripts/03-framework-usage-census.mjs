// IRWB-038-C probe 03: which framework modules and symbols each domain imports (by imported name, so re-exports
// through index.ts are attributed to the module that defines the symbol). Usage: node <this> [repo-root]
// Prints, per framework module: lines, and the importing files in src/tensor, src/typed, src/workbench.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = process.argv[2] ?? '.';
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
const fw = walk(join(root, 'src/framework')).filter(f => !f.endsWith('index.ts'));
const owner = new Map(); const lines = {};
for (const f of fw) {
  const s = readFileSync(f, 'utf8'); lines[relative(root, f)] = s.split('\n').length;
  for (const m of s.matchAll(/^export (?:async )?(?:function|const|class|interface|type|abstract class|let)\s+(\w+)/gm)) owner.set(m[1], relative(root, f));
}
const use = {};
for (const dom of ['src/tensor', 'src/typed', 'src/workbench']) for (const f of walk(join(root, dom))) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'[./]*\/framework\/[^']+'/g))
    for (const raw of m[1].split(',')) {
      const name = raw.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0].trim(); if (!name) continue;
      const mod = owner.get(name) ?? '?';
      ((use[mod] ??= {})[relative(root, f)] ??= new Set()).add(name);
    }
}
for (const mod of Object.keys(lines).sort()) {
  const u = use[mod] ?? {}; const files = Object.keys(u);
  const by = d => files.filter(f => f.startsWith(d)).length;
  console.log(`${mod.padEnd(42)} ${String(lines[mod]).padStart(5)} lines  tensor:${by('src/tensor')} typed:${by('src/typed')} workbench:${by('src/workbench')}  ${[...new Set(files.flatMap(f => [...u[f]]))].sort().join(' ')}`);
}
if (use['?']) console.log('unattributed:', JSON.stringify(Object.fromEntries(Object.entries(use['?']).map(([k, v]) => [k, [...v]]))));
