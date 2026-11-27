#!/usr/bin/env node
// Blind pack for round R2: each agent's whole ticket (design, diary, scripts, results) under a random letter, with
// names that identify the author replaced: ticket ids, branch and worktree names, model, vendor and harness names.
// Usage: node 23-pack-r2.mjs <out-dir> [seed]
// Writes <out-dir>/brief.md, <out-dir>/rubric.md, <out-dir>/doc-X/... and results/blind-key-r2.json (kept out of the pack).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [out, seedArg] = process.argv.slice(2);
const T = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WT = '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees';
const key = JSON.parse(fs.readFileSync(path.join(T, 'various/results/r2-config-key.json'), 'utf8'));
let s = Number(seedArg ?? 20261126) >>> 0;
const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
const items = Object.keys(key);
for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }

const NAMES = /\b(Claude(?: Code)?|Anthropic|OpenAI|Codex|GPT-?[0-9.]*|gpt-[0-9.]+-\w+|Sol|Astra|Opus|Fable|Pi coding agent)\b/g;
const neutral = (text, item, letter) => text
  // the Claude cells' diaries quote the coordinator's launch wrapper, which would set them apart; keep only the fact
  .replace(/You are a research agent in a comparison of agent configurations\.[\s\S]*?Your final message is the one the brief specifies\./g, '[The task prompt: the brief in brief.md.]')
  .replace(/\/tmp\/claude-[^\s)`'"\]]*/g, 'SCRATCH')
  .replace(/claude-briefs\/[\w.-]+/g, 'BRIEF')
  .replace(/\.claude\b/gi, '.agent')
  .replaceAll(item, `TICKET-${letter}`)
  .replace(/IRWB-023-[A-D]/g, 'TICKET-?')
  .replace(/r2-(sh|ah|op|fa)(-irwb-023-[a-d]|\/irwb-023-[a-d])?/g, 'r2-branch')
  .replace(/\.claude\/worktrees\/[\w.-]+/g, 'WORKTREE')
  .replace(NAMES, 'AGENT');
const TEXT = /\.(md|mjs|js|ts|cu|cuh|json|txt|py|sh|csv|tsv|log)$/i;
const copy = (src, dst, item, letter) => {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name), name = neutral(e.name, item, letter), to = path.join(dst, name);
    if (e.isDirectory()) copy(from, to, item, letter);
    else if (TEXT.test(e.name) && fs.statSync(from).size < 2e6) fs.writeFileSync(to, neutral(fs.readFileSync(from, 'utf8'), item, letter));
  }
};
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const blind = [];
items.forEach((item, i) => {
  const letter = 'ABCD'[i], c = key[item];
  const wt = path.join(WT, `${c.round}-${item.toLowerCase()}`);
  const ticket = fs.readdirSync(path.join(wt, 'ttmp/2026/11/26')).find(d => d.startsWith(item + '--'));
  copy(path.join(wt, 'ttmp/2026/11/26', ticket), path.join(out, `doc-${letter}`), item, letter);
  blind.push({ name: `doc-${letter}`, item, ticket, rev: execFileSync('git', ['-C', wt, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() });
});
fs.writeFileSync(path.join(out, 'brief.md'), fs.readFileSync(path.join(T, 'various/prompts/r2/common.md'), 'utf8').replaceAll('<ID>', 'TICKET'));
fs.copyFileSync(path.join(T, 'scripts/22-judge-rubric-r2.md'), path.join(out, 'rubric.md'));
fs.writeFileSync(path.join(T, 'various/results/blind-key-r2.json'), JSON.stringify(blind, null, 1));
// leak check: any remaining identifying string in the pack
const leaks = [];
const scan = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) scan(p); else { const t = fs.readFileSync(p, 'utf8'); const m = t.match(/IRWB-023|claude|anthropic|openai|codex|\bsol\b|astra|opus|fable/i); if (m) leaks.push(`${path.relative(out, p)}: ${m[0]}`); } } };
scan(out);
console.log('packed', blind.map(b => `${b.name}`).join(' '), '| leaks:', leaks.length ? leaks.slice(0, 20).join('; ') : 'none');
