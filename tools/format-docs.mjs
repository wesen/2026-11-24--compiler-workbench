// Hard-wrap the Markdown the browser workbench bundles (the book, the API reference, the divergences) at
// TILE_WIDTH columns, as tools/format-corpus.mjs does for project notes: wb.help() prints these as text in a
// narrow tile. Verifies before writing that the site's own renderer (site-src/md.js) makes the same HTML from
// the wrapped text. Book frontmatter is left as it is. node tools/format-docs.mjs [--check]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { wrapProse, TILE_WIDTH: W } = await import('../dist/typed/format.js');
const { UI } = await import('../site-src/ui.js');
await import('../site-src/md.js');

const check = process.argv.includes('--check');
// The reference is printed as text by wb.help(), so it must fit a tile as text, not only once rendered: its
// tables become lists ("- `member`: what it does", which wrap with a hanging indent), and a code line too long
// for the tile has its trailing comment moved onto a line of its own above it.
function tablesToLists(md) {
  const ls = md.split('\n'),
    out = [];
  const cells = l =>
    l
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split(/(?<!\\)\|/)
      .map(c => c.trim());
  for (let i = 0; i < ls.length; i++) {
    if (/^\|/.test(ls[i]) && i + 1 < ls.length && /^\|[\s:|-]+\|?\s*$/.test(ls[i + 1])) {
      i += 2; // the header names the columns; the list says it in each item
      while (i < ls.length && /^\|/.test(ls[i])) {
        const c = cells(ls[i++]);
        out.push(`- ${c.slice(0, -1).join(' ')}: ${c[c.length - 1]}`);
      }
      i--;
      continue;
    }
    out.push(ls[i]);
  }
  return out.join('\n');
}
function hoistComments(md) {
  let fenced = false;
  return md
    .split('\n')
    .flatMap(l => {
      if (/^```/.test(l)) fenced = !fenced;
      const m = fenced && l.length > W ? /^(\s*)(.*?\S)\s+\/\/ (.*)$/.exec(l) : null;
      return m && !/['"`]/.test(m[3]) && m[1].length + m[2].length <= W ? [`${m[1]}// ${m[3]}`, m[1] + m[2]] : [l];
    })
    .join('\n');
}
const AS_TEXT = new Set(['corpus/reference.md', 'src/workbench/DIVERGENCES.md']);
const files = [
  'corpus/reference.md',
  'src/workbench/DIVERGENCES.md',
  ...readdirSync(join(root, 'corpus/book'))
    .filter(f => f.endsWith('.md'))
    .map(f => `corpus/book/${f}`),
];
const width = text => Math.max(0, ...text.split('\n').map(l => l.length));
// Join paragraphs' and list items' lines first (the renderer joins them anyway), so text wrapped by hand at
// another width rewraps cleanly: wrapProse wraps one long line at a time.
const BLOCK = /^(\s*$|#|>|\||```|---|\s*([-*+]|\d+[.)]) )/;
function unwrap(md) {
  const out = [];
  let fenced = false;
  for (const l of md.split('\n')) {
    if (/^```/.test(l)) fenced = !fenced;
    const prev = out.length ? out[out.length - 1] : null;
    const joinable =
      !fenced &&
      !/^```/.test(l) &&
      prev !== null &&
      !BLOCK.test(l) &&
      !/^\s{4,}/.test(l) &&
      !/^(\s*$|#|\||```|---|>)/.test(prev) &&
      !/^ {4,}/.test(prev.replace(/^(\s*)([-*+]|\d+[.)]) /, ''));
    if (joinable) out[out.length - 1] = `${prev} ${l.trim()}`;
    else out.push(l);
  }
  return out.join('\n');
}
let changed = 0;
const wide = [];
for (const f of files) {
  const text = readFileSync(join(root, f), 'utf8');
  const fm = /^---\n[\s\S]*?\n---\n/.exec(text);
  const head = fm ? fm[0] : '';
  // text read as text gets its tables and long code comments reshaped (that changes how it renders, on purpose)
  const body = AS_TEXT.has(f) ? hoistComments(tablesToLists(text.slice(head.length))) : text.slice(head.length);
  const wrapped = wrapProse(unwrap(body), W);
  if (UI.md(body, { ids: true }) !== UI.md(wrapped, { ids: true })) throw new Error(`${f}: renders differently`);
  const out = head + wrapped;
  if (out !== text) {
    changed++;
    if (!check) writeFileSync(join(root, f), out);
  }
  // lines a tile still has to scroll inside their own box: tables and code
  const left = wrapped.split('\n').filter(l => l.length > W);
  if (left.length) wide.push(`${f}: ${left.length} (${width(wrapped)} max; tables or code)`);
}
console.log(`${check ? 'would change' : 'changed'} ${changed} of ${files.length} files`);
if (wide.length) console.log(`lines wider than ${W} left:\n  ${wide.join('\n  ')}`);
if (check && changed) process.exit(1);
