// R3 synthesis probes: shared helper. Every probe reads the code under test from ROOT, a checkout with a built
// `dist/` (`npx tsc -p tsconfig.json`). Default: the repository this file lives in. The synthesis ran the probes on
// clean `git archive` exports (never on the main checkout's working copy, which had uncommitted edits in src/typed):
//   ROOT=<export of a0c2199>  (src identical to 93ec5fc, the reviewers' base)   for probes 01-07, 09-10
//   ROOT=<export of t6-base>  (0f45d04, the A0 cells' base)                      for probe 08's second run
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
export const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../../../../../');
export const root = resolve(process.env.ROOT ?? repo);
export const dist = path => import(pathToFileURL(resolve(root, 'dist', path)).href);
export const at = path => resolve(root, path);
export const worktree = name => resolve(repo, '.claude/worktrees', name);
export const attempt = async (label, f) => {
  try {
    const v = await f();
    console.log(label, '->', v);
    return v;
  } catch (e) {
    console.log(label, '-> THROWS', `${e.constructor.name}${e.code ? '[' + e.code + ']' : ''}:`, String(e.message).slice(0, 160));
  }
};
