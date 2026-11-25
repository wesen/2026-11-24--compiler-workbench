// Format the corpus files the workbench shows for a tile (TILE_WIDTH columns): project.json with prose fields
// as lines, notes.md hard-wrapped. Verifies before writing: the project's meaning (projectSource) and the
// rendered Markdown blocks are unchanged. node tools/format-corpus.mjs [--check]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { corpusDir, projectIds, projectFiles } from './corpus.mjs';
const { formatJson, wrapProse, splitWords, TILE_WIDTH } = await import('../dist/typed/format.js');
const { projectSource } = await import('../dist/typed/project.js');

const check = process.argv.includes('--check');
const W = TILE_WIDTH;
// prose → lines that fit at the indentation the printer will give them (quotes and comma take 3 columns)
const lines = (text, indent) => {
  if (typeof text !== 'string' || indent + text.length + 3 <= W) return text;
  return splitWords(text, W - indent - 3);
};
function narrowProject(j) {
  const out = { ...j };
  if (out.about !== undefined) out.about = lines(out.about, 4);
  if (Array.isArray(out.try)) out.try = out.try.map(t => lines(t, 6));
  if (out.scripts)
    out.scripts = Object.fromEntries(Object.entries(out.scripts).map(([k, v]) => [k, v && v.about !== undefined ? { ...v, about: lines(v.about, 8) } : v]));
  return out;
}
// the renderer's block structure (ui/md.js rules): fences verbatim, list items with continuations, paragraphs joined
function blocks(md) {
  const ls = md.replace(/\r/g, '').split('\n'), out = [];
  let para = [];
  const flush = () => { if (para.length) out.push(['p', para.join(' ')]); para = []; };
  for (let i = 0; i < ls.length; ) {
    const l = ls[i];
    if (/^```/.test(l)) { flush(); const body = [l]; i++; while (i < ls.length && !/^```\s*$/.test(ls[i])) body.push(ls[i++]); body.push(ls[i++]); out.push(['code', body.join('\n')]); continue; }
    const li = /^(\s*)([-*]|\d+\.) (.*)$/.exec(l);
    if (li) { flush(); let item = li[3]; i++; while (i < ls.length && /^\s{2,}\S/.test(ls[i]) && !/^(\s*)([-*]|\d+\.) /.test(ls[i])) item += ' ' + ls[i++].trim(); out.push(['li', li[2], item]); continue; }
    if (/^\s*$/.test(l)) { flush(); i++; continue; }
    if (/^(#|\||---|>)/.test(l)) { flush(); out.push(['raw', l]); i++; continue; }
    para.push(l.trim()); i++;
  }
  flush();
  return out;
}
const width = text => Math.max(0, ...text.split('\n').map(l => l.length));
let changed = 0, wide = [];
for (const id of projectIds()) {
  const dir = join(corpusDir, id), files = projectFiles(id);
  const before = projectSource(id, files).meta;
  if (files['project.json']) {
    const text = formatJson(narrowProject(JSON.parse(files['project.json'])), W);
    const after = projectSource(id, { ...files, 'project.json': text }).meta;
    if (!isDeepStrictEqual(before, after)) throw new Error(`${id}: project.json meaning changed`);
    if (text !== files['project.json']) { changed++; if (!check) writeFileSync(join(dir, 'project.json'), text); }
    if (width(text) > W) wide.push(`${id}/project.json ${width(text)}`);
  }
  const notes = join(dir, 'notes.md');
  if (existsSync(notes)) {
    const md = readFileSync(notes, 'utf8'), wrapped = wrapProse(md, W);
    if (!isDeepStrictEqual(blocks(md), blocks(wrapped))) throw new Error(`${id}: notes.md renders differently`);
    if (wrapped !== md) { changed++; if (!check) writeFileSync(notes, wrapped); }
    if (width(wrapped) > W) wide.push(`${id}/notes.md ${width(wrapped)}`);
  }
}
console.log(`${check ? 'would change' : 'changed'} ${changed} files; still wider than ${W}: ${wide.length ? wide.join(', ') : 'none'}`);
if (check && changed) process.exit(1);
