// A workbench root as the browser build makes it (tools/build-site.mjs), from the built dist/ and the corpus.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installVendor } from '../../tools/node-vendor.mjs';
import { builtinProjects } from '../../tools/corpus.mjs';

export const root = fileURLToPath(new URL('../..', import.meta.url));
await installVendor();
export const W = await import('../../dist/workbench/index.js');

export function book() {
  const dir = join(root, 'corpus/book');
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => {
      const text = readFileSync(join(dir, f), 'utf8');
      const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
      const meta = Object.fromEntries(
        (m ? m[1] : '')
          .split('\n')
          .map(l => /^(\w+):\s*(.*)$/.exec(l))
          .filter(Boolean)
          .map(x => [x[1], x[2].trim()]),
      );
      return { id: meta.id, title: meta.title, part: meta.part, md: m ? text.slice(m[0].length) : text };
    });
}
export const reference = () => readFileSync(join(root, 'corpus/reference.md'), 'utf8');
export function sources() {
  const out = {};
  for (const dir of ['src/typed', 'src/workbench'])
    for (const f of readdirSync(join(root, dir)))
      if (f.endsWith('.ts')) out[`${dir}/${f}`] = readFileSync(join(root, dir, f), 'utf8');
  return out;
}
/** A fresh root with in-memory storage (the browser's localStorage). */
export function makeWb({ storage = new Map() } = {}) {
  const wb = W.createWb({
    storage: { get: k => storage.get(k), set: (k, v) => storage.set(k, v) },
    projects: builtinProjects(),
    book: book(),
    reference: reference(),
    sources: sources(),
  });
  return { wb, storage };
}
export const widest = text => Math.max(0, ...String(text).split('\n').map(l => l.length));
