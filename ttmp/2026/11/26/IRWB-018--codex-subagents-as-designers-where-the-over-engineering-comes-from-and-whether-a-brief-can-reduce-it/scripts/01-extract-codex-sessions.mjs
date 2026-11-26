#!/usr/bin/env node
// IRWB-018: extract what each Codex work session was shown and what it did, from the native rollout JSONL.
// Usage: node 01-extract-codex-sessions.mjs <work-sessions.txt> <out-dir> [label-prefix]
// Writes per session: commands.tsv (seq, tool, cmd), reads.tsv (paths read with cat/sed/head/rg -n), messages.md
// (assistant commentary), and a summary.json across sessions. Writes the shared context once: system-prompt.md,
// skills-catalogue.md, agents-md.md (identical across sessions; the script checks and reports any difference).
// The rollouts are read only; nothing in ~/.codex is modified.
import fs from 'node:fs';
import path from 'node:path';

const [listFile, outDir] = process.argv.slice(2);
const files = fs.readFileSync(listFile, 'utf8').trim().split('\n');
fs.mkdirSync(outDir, { recursive: true });

const text = item => (item.payload.content || []).map(p => p.text || p.input_text || '').join('');
const shared = {};
const summary = [];

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const meta = lines.find(l => l.type === 'session_meta')?.payload ?? {};
  const cwd = meta.cwd ?? '';
  const id = (cwd.match(/codex-(irwb-\d+)/)?.[1] ?? path.basename(file)).toUpperCase();
  const dir = path.join(outDir, id);
  fs.mkdirSync(dir, { recursive: true });

  const msgs = lines.filter(l => l.type === 'response_item' && l.payload.type === 'message');
  const dev = msgs.filter(m => m.payload.role === 'developer').map(text);
  const user = msgs.filter(m => m.payload.role === 'user').map(text);
  const asst = msgs.filter(m => m.payload.role === 'assistant').map(text);
  for (const [k, v] of [['system-prompt', dev[0]], ['skills-catalogue', dev[1]], ['multi-agent', dev.slice(2).join('\n\n---\n\n')], ['agents-md', user[0]]]) {
    if (shared[k] === undefined) shared[k] = v;
    else if (shared[k] !== v) shared[k + ':differs'] = (shared[k + ':differs'] || []).concat(id);
  }

  // Tool calls: code-mode `exec` with JS calling tools.<name>({...}); pull every cmd string literal.
  const calls = lines.filter(l => l.type === 'response_item' && /tool_call$/.test(l.payload.type));
  const commands = [];
  const toolNames = {};
  calls.forEach((c, i) => {
    const src = c.payload.input ?? c.payload.arguments ?? '';
    for (const m of src.matchAll(/tools\.(\w+)\(/g)) toolNames[m[1]] = (toolNames[m[1]] || 0) + 1;
    for (const m of src.matchAll(/cmd:\s*("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g)) {
      let cmd = m[1];
      try { cmd = cmd.startsWith('"') ? JSON.parse(cmd) : cmd.slice(1, -1); } catch { /* keep raw */ }
      commands.push({ seq: i, cmd });
    }
    if (/apply_patch/.test(src)) commands.push({ seq: i, cmd: '[apply_patch] ' + (src.match(/\*\*\* (?:Add|Update) File: ([^\\\n]+)/g) || []).join(' ') });
  });
  fs.writeFileSync(path.join(dir, 'commands.tsv'), commands.map(c => `${c.seq}\t${c.cmd.replace(/\n/g, '\\n')}`).join('\n') + '\n');

  // Paths read: arguments of cat/sed -n/head/tail/nl, plus files named in rg/grep over specific files.
  const reads = new Map();
  for (const { seq, cmd } of commands) {
    for (const m of cmd.matchAll(/(?:^|[;&|(]\s*|\s)(?:cat|sed -n '[^']*'|sed -n "[^"]*"|sed -n \S+|head(?: -n? ?\d+)?|tail(?: -n? ?\d+)?|nl -ba)\s+((?:[^\s;&|<>]+\s*)+)/g)) {
      for (const p of m[1].split(/\s+/)) if (/[./]/.test(p) && !p.startsWith('-') && !/^\d/.test(p)) {
        if (!reads.has(p)) reads.set(p, seq);
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'reads.tsv'), [...reads].map(([p, s]) => `${s}\t${p}`).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'messages.md'), asst.map((t, i) => `## ${i + 1}\n\n${t}\n`).join('\n'));

  const tokens = lines.filter(l => l.type === 'event_msg' && l.payload.type === 'token_count').map(l => l.payload.info?.total_token_usage).filter(Boolean).pop() ?? null;
  const skillReads = [...reads.keys()].filter(p => p.includes('/.codex/skills/'));
  const skillCmds = commands.filter(c => c.cmd.includes('/.codex/skills/')).map(c => c.cmd.slice(0, 300));
  summary.push({
    id, file, cwd, model: lines.find(l => l.type === 'turn_context')?.payload?.model ?? null,
    effort: lines.find(l => l.type === 'turn_context')?.payload?.effort ?? null,
    toolCalls: calls.length, commands: commands.length, toolNames, reasoningItems: lines.filter(l => l.type === 'response_item' && l.payload.type === 'reasoning').length,
    reasoningSummaries: lines.filter(l => l.type === 'response_item' && l.payload.type === 'reasoning' && (l.payload.summary || []).length).length,
    skillReads, skillCmds, readsCount: reads.size, tokens,
  });
}
for (const [k, v] of Object.entries(shared)) if (!k.includes(':')) fs.writeFileSync(path.join(outDir, `${k}.md`), v ?? '');
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ shared: Object.fromEntries(Object.entries(shared).map(([k, v]) => [k, typeof v === 'string' ? v.length : v])), sessions: summary }, null, 2));
console.log(JSON.stringify(summary.map(s => ({ id: s.id, model: s.model, effort: s.effort, calls: s.toolCalls, cmds: s.commands, tools: s.toolNames, skills: s.skillReads.map(p => p.replace(/.*\.codex\/skills\//, '')), tokens: s.tokens?.total_tokens })), null, 1));
console.log('shared lengths', Object.fromEntries(Object.entries(shared).map(([k, v]) => [k, typeof v === 'string' ? v.length : v])));
