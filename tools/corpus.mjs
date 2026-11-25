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
