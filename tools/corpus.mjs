// Read corpus/projects/<id>/ into { files } maps for the typed domain (Node only).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const corpusDir = fileURLToPath(new URL('../corpus/projects/', import.meta.url));
export const projectIds = () => readdirSync(corpusDir).filter(d => statSync(join(corpusDir, d)).isDirectory()).sort();
export function projectFiles(id) {
  const dir = join(corpusDir, id), files = {};
  for (const f of readdirSync(dir)) if (f === 'project.json' || f.endsWith('.typed')) files[f] = readFileSync(join(dir, f), 'utf8');
  return files;
}

/** Every file of a project (project.json, sources, notes, scripts/, ui/), path -> text. */
export function projectAllFiles(id) {
  const out = {};
  const walk = (dir, prefix) => {
    for (const f of readdirSync(dir).sort()) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, prefix + f + '/');
      else out[prefix + f] = readFileSync(p, 'utf8');
    }
  };
  walk(join(corpusDir, id), '');
  return out;
}

/** The built-in projects in the book's order (corpus/projects/index.json), as { id, files }. */
export function builtinProjects() {
  const order = JSON.parse(readFileSync(join(corpusDir, 'index.json'), 'utf8')).order;
  const ids = [...order, ...projectIds().filter(id => !order.includes(id))];
  return ids.map(id => ({ id, files: projectAllFiles(id) }));
}
