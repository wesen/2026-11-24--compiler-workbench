#!/usr/bin/env node
// One-call status of every agent in the IRWB-019 rounds (token-efficient): reads the config keys, the kit's exit
// files and each worktree's git state. Usage: node 08-status.mjs [t1|r1|...] [--long]
// Columns: item, cell (harness/model/effort), state (done/exit code, or running), minutes since the worktree's first
// commit or log, commits since base, design-doc words, lines added under src/tensor, tests/tensor, corpus/tensor,
// src/framework, other non-ticket paths, and the last commit subject.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const T = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const R = path.resolve(T, '../../../../..');
const tasks = process.argv.slice(2).filter(a => !a.startsWith('--'));
const long = process.argv.includes('--long');
const git = (w, ...a) => { try { return execFileSync('git', ['-C', w, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const short = { 'gpt-6.2-sol': 'sol', 'gpt-6.2-astra': 'astra', 'claude-opus-5-5': 'opus', 'claude-fable-5-2': 'fable' };
for (const f of fs.readdirSync(path.join(T, 'various/results')).filter(f => f.endsWith('-config-key.json')).sort()) {
  const task = f.replace('-config-key.json', '');
  if (tasks.length && !tasks.includes(task)) continue;
  const key = JSON.parse(fs.readFileSync(path.join(T, 'various/results', f), 'utf8'));
  console.log(`== ${task}`);
  for (const [item, c] of Object.entries(key).sort((a, b) => a[1].round.localeCompare(b[1].round))) {
    const w = c.worktree ?? path.join(R, '.claude/worktrees', `${c.round}-${item.toLowerCase()}`);
    const logs = path.join(T, 'various/kit', c.round, 'logs');
    let state = c.harness === 'claude-code-subagent' ? 'agent' : 'running';
    try { const m = fs.readFileSync(path.join(logs, 'exits.txt'), 'utf8').match(new RegExp(`${item} exit (\\d+)`)); if (m) state = m[1] === '0' ? 'done' : `exit ${m[1]}`; } catch {}
    const base = '19ad269';
    const commits = git(w, 'rev-list', '--count', `${base}..HEAD`) || '-';
    const changed = git(w, 'diff', '--numstat', base).split('\n').filter(Boolean).map(l => l.split('\t'));
    const add = re => changed.filter(([, , p]) => re.test(p)).reduce((s, [a]) => s + (Number(a) || 0), 0);
    const docs = changed.map(x => x[2]).filter(p => /design-doc\/.*\.md$/.test(p));
    let words = 0; for (const d of docs) try { words += fs.readFileSync(path.join(w, d), 'utf8').split(/\s+/).length; } catch {}
    const other = changed.map(x => x[2]).filter(p => !/^(ttmp|src\/tensor|tests\/tensor|corpus\/tensor|src\/framework)\//.test(p));
    const subj = git(w, 'log', '-1', '--format=%s', `${base}..HEAD`).slice(0, long ? 200 : 60);
    const cell = `${c.harness === 'claude-code-subagent' ? 'claude' : c.harness}/${short[String(c.model).replace('openai-codex/', '')] ?? c.model}/${c.effort}`;
    console.log([item, cell.padEnd(18), state.padEnd(7), `c${commits}`, `doc ${words}w`, `src+${add(/^src\/tensor\//)}`, `test+${add(/^tests\/tensor\//)}`, `corpus+${add(/^corpus\/tensor\//)}`, `fw+${add(/^src\/framework\//)}`, other.length ? `OTHER:${other.length}` : '', subj].join(' '));
  }
}
