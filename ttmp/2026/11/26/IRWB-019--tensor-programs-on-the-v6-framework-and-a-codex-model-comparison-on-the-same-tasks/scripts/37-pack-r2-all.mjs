#!/usr/bin/env node
// Blind pack of all eleven R2 tickets: the four original cells (Codex Sol and Astra high, Opus, Fable) and the seven R2b
// cells (DeepSeek 4.1 Flash high/xhigh/max, GLM 5.3 Flash high/max, GLM 5.3 high/max, through Pi). Adapted from
// 23-pack-r2.mjs: whole tickets under random letters, every text file (no extension list), names that identify the
// author replaced (ticket ids, branch and worktree names, model, vendor, provider and harness names), the coordinator's
// launch wrapper replaced. Then a leak scan, and a completeness check: files packed against files in each ticket.
// Usage: node 37-pack-r2-all.mjs <out-dir> [seed]   Writes results/blind-key-r2-all.json (kept out of the pack).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [out, seedArg] = process.argv.slice(2);
const T = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WT = '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees';
const key = Object.assign(...['r2', 'r2b'].map(r => JSON.parse(fs.readFileSync(path.join(T, `various/results/${r}-config-key.json`), 'utf8'))));
let s = Number(seedArg ?? 13) >>> 0;
const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
const items = Object.keys(key).sort();
for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }

const NAMES = /\b(Claude(?: Code)?|Anthropic|OpenAI|Codex|GPT-?[0-9.]*|gpt-[0-9.]+-\w+|Sol|Astra|Opus|Fable|Terra|DeepSeek(?:[- ][0-9.]+)?(?:[- ]Flash)?|deepseek-[\w.-]+|GLM(?:[- ][0-9.]+)?(?:[- ]Flash)?|glm-[\w.-]+|Zhipu|Z\.ai|LunaRoute|lunaroute|Pi coding agent|pi-coding-agent)\b/gi;
const LETTERS = 'ABCDEFGHIJK';
const neutral = (text, item, letter) => text
  .replace(/You are a research agent in a comparison of agent configurations\.[\s\S]*?Your final message is the one the brief specifies\./g, '[The task prompt: the brief in brief.md.]')
  .replace(/\/tmp\/claude-[^\s)`'"\]]*/g, 'SCRATCH')
  .replace(/claude-briefs\/[\w.-]+/g, 'BRIEF')
  .replace(/\.claude\b/gi, '.agent')
  .replaceAll(item, `TICKET-${letter}`)
  .replace(/IRWB-023(-[A-K])?/g, 'TICKET-?')
  .replace(/irwb-?023-?[a-k]?/gi, 'ticket')
  .replace(/r2b?-(sh|ah|op|fa|ds-h|ds-x|ds-max|gf-h|gf-max|g-h|g-max)(-irwb-023-[a-k]|\/irwb-023-[a-k])?/g, 'r2-branch')
  .replace(/\.agent\/worktrees\/[\w.-]+/g, 'WORKTREE')
  .replace(NAMES, 'AGENT');
const skipped = [], counts = [];
const copy = (src, dst, item, letter) => {
  let n = 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name), to = path.join(dst, neutral(e.name, item, letter));
    if (e.isDirectory()) n += copy(from, to, item, letter);
    else {
      const buf = fs.readFileSync(from);
      if (buf.length < 5e6 && !buf.includes(0)) { fs.writeFileSync(to, neutral(buf.toString('utf8'), item, letter)); n++; }
      else skipped.push(path.relative(src, from));
    }
  }
  return n;
};
const countFiles = d => fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? countFiles(path.join(d, e.name)) : 1), 0);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const blind = [];
items.forEach((item, i) => {
  const letter = LETTERS[i], c = key[item];
  const wt = path.join(WT, `${c.round}-${item.toLowerCase()}`);
  const dir = path.join(wt, 'ttmp/2026/11/26');
  // the ticket directory with the most files: IRWB-023-E's worktree also has an empty directory literally named
  // 'IRWB-023-E--*' (an unexpanded glob of the agent's), which sorts first
  const candidates = fs.readdirSync(dir).filter(d => d.startsWith(item + '--') || /^IRWB-023--/.test(d));
  const ticket = candidates.sort((a, b) => countFiles(path.join(dir, b)) - countFiles(path.join(dir, a)))[0];
  if (!ticket) throw new Error(`no ticket for ${item} in ${dir}`);
  const packed = copy(path.join(dir, ticket), path.join(out, `doc-${letter}`), item, letter);
  counts.push(`${letter}:${packed}/${countFiles(path.join(dir, ticket))}`);
  blind.push({ name: `doc-${letter}`, item, ticket, rev: execFileSync('git', ['-C', wt, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() });
});
fs.writeFileSync(path.join(out, 'brief.md'), fs.readFileSync(path.join(T, 'various/prompts/r2/common.md'), 'utf8').replaceAll('<ID>', 'TICKET'));
fs.copyFileSync(path.join(T, 'scripts/22-judge-rubric-r2.md'), path.join(out, 'rubric.md'));
fs.writeFileSync(path.join(T, 'various/results/blind-key-r2-all.json'), JSON.stringify(blind, null, 1));
const leaks = [];
const scan = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) scan(p); else { const t = fs.readFileSync(p, 'utf8'); const m = t.match(/IRWB-023|\b(claude|anthropic|openai|codex|sol|astra|opus|fable|terra|deepseek|glm|zhipu|lunaroute)\b/i); if (m) leaks.push(`${path.relative(out, p)}: ${m[0]}`); } } };
scan(out);
console.log('packed', blind.map(b => b.name).join(' '), '| files packed/in ticket:', counts.join(' '), '| skipped (binary or over 5 MB):', skipped.length ? skipped.join(', ') : 'none', '| leaks:', leaks.length ? leaks.slice(0, 20).join('; ') : 'none');
