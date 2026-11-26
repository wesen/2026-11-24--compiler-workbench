#!/usr/bin/env node
// IRWB-018: collect the 18 design docs (baseline at its recorded commit, round 2, round 3), strip frontmatter and a
// trailing cuts section (which would reveal round 3), and write them under shuffled names for a blind judge.
// Usage: node 04-blind-pack.mjs <out-dir> <key-file>   (the key file must live outside out-dir)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = '/home/manuel/code/wesen/2026-11-24--compiler-workbench';
const BASELINE = { 'IRWB-012': '4038fb8', 'IRWB-013': 'a493a0b', 'IRWB-014': '43baa4b', 'IRWB-015': '8ba5bba', 'IRWB-016': '07592d2', 'IRWB-017': '8daa63c' };
const [outDir, keyFile] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
const docIn = (cwd, rev, id) => git(cwd, 'ls-tree', '-r', '--name-only', rev, 'ttmp/2026/11/26').split('\n').find(p => p.includes(`/${id}--`) && p.includes('/design-doc/') && p.endsWith('.md'));
const strip = src => {
  src = src.replace(/^---\n[\s\S]*?\n---\n/, '');
  // Drop a final section whose heading names cuts, simplification or self-review (round 3's appended list).
  // Whole words only ("Executive" contains "cut"), and only the last such heading.
  const heads = [...src.matchAll(/\n#{2,3} [^\n]*\b(cuts?|simplif\w*|self-review)\b[^\n]*\n/gi)];
  const m = heads.pop();
  return m ? src.slice(0, m.index) + '\n' : src;
};

const items = [];
for (const [id, base] of Object.entries(BASELINE)) {
  const w1 = path.join(ROOT, '.claude/worktrees', 'codex-' + id.toLowerCase());
  const w2 = path.join(ROOT, '.claude/worktrees', 'codex2-' + id.toLowerCase());
  const p1 = docIn(w1, base, id);
  items.push({ id, round: 'baseline', rev: base, text: git(w1, 'show', `${base}:${p1}`) });
  const head2 = git(w2, 'rev-parse', '--short', 'HEAD').trim();
  const p2 = docIn(w2, 'HEAD', id);
  items.push({ id, round: 'round2', rev: head2, text: p2 ? git(w2, 'show', `HEAD:${p2}`) : '' });
  const head3 = git(w1, 'rev-parse', '--short', 'HEAD').trim();
  const p3 = docIn(w1, 'HEAD', id);
  items.push({ id, round: 'round3', rev: head3, text: head3 === base ? '' : git(w1, 'show', `HEAD:${p3}`) });
}
// Deterministic shuffle (seed 18) so the packing can be reproduced.
let s = 18;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const order = items.map((it, i) => ({ it, k: rnd() })).sort((a, b) => a.k - b.k).map(x => x.it);
const key = [];
order.forEach((it, i) => {
  const name = `doc-${String.fromCharCode(65 + i)}.md`;
  const body = strip(it.text);
  const program = it.id; // program identity is visible in the text anyway; the judge is told which program each is
  fs.writeFileSync(path.join(outDir, name), body);
  key.push({ name, id: it.id, round: it.round, rev: it.rev, words: body.split(/\s+/).filter(Boolean).length, missing: !it.text });
});
fs.writeFileSync(keyFile, JSON.stringify(key, null, 1));
console.log(key.map(k => `${k.name} ${k.id} ${k.missing ? 'MISSING' : k.words + 'w'}`).join('\n'));
