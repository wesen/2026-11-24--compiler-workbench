#!/usr/bin/env node
// One row per stage-1 implementation: correctness (hidden suite, its name-reuse variant, the differential
// cross-check), size (tensor source and tests, framework diff), and the cost of the implementation turn (turn 2):
// minutes, commands, generated tokens. Codex turn 2 comes from the rollout (second task_started to its
// task_complete; commands from CommandExecution events; tokens as the difference of total_token_usage). Pi turn 2 is
// everything after the second user message (bash calls; output + reasoning tokens summed from usage). Claude cells
// come from results/claude-usage.json (subagent tokens include input, so they are not comparable).
// Usage: node 14-impl-summary.mjs <acceptance.json> <variant.json> <crosscheck.json> [--json out.json] [--md out.md]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = n => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const [accFile, varFile, xcFile] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const T = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const K = path.join(T, 'various/kit');
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const key = read(path.join(T, 'various/results/t1-config-key.json'));
const acc = read(accFile), vr = read(varFile), xc = read(xcFile);
const claude = read(path.join(T, 'various/results/claude-usage.json'));
const lines = (files, re = /^\s*(\/\/.*)?$/) => files.reduce((a, f) => a + fs.readFileSync(f, 'utf8').split('\n').filter(l => !re.test(l)).length, 0);
const ls = (d, ext) => (fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(ext)).map(f => path.join(d, f)) : []);
const git = (wt, ...a) => execFileSync('git', ['-C', wt, ...a], { encoding: 'utf8' });
const numstat = (wt, p) => git(wt, 'diff', '--numstat', '19ad269', 'HEAD', '--', p).trim().split('\n').filter(Boolean)
  .reduce((s, l) => { const [a, d] = l.split('\t'); return [s[0] + (+a || 0), s[1] + (+d || 0)]; }, [0, 0]);

function codexTurn2(item, round) {
  const tsv = path.join(K, round, 'rollouts/sessions.tsv');
  if (!fs.existsSync(tsv)) return null;
  const file = fs.readFileSync(tsv, 'utf8').split('\n').map(l => l.split('\t')).find(([i]) => i === item)?.[1];
  if (!file || !fs.existsSync(file)) return null;
  const L = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return {}; } });
  let turn = 0, cmds = 0, t0 = null, t1 = null, u1 = null, u2 = null;
  for (const o of L) {
    const p = o.payload ?? {};
    if (o.type === 'event_msg' && p.type === 'task_started') { turn++; if (turn === 2) t0 = Date.parse(o.timestamp); }
    if (o.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) { if (turn === 1) u1 = p.info.total_token_usage; if (turn === 2) u2 = p.info.total_token_usage; }
    if (turn === 2 && o.type === 'event_msg' && p.type === 'item_completed' && p.item?.type === 'CommandExecution') cmds++;
    if (turn === 2 && o.type === 'event_msg' && p.type === 'task_complete') t1 = Date.parse(o.timestamp);
  }
  if (!t0 || !u2) return null;
  const gen = u => (u?.output_tokens ?? 0);
  return { minutes: +(((t1 ?? Date.parse(L.at(-1).timestamp)) - t0) / 60000).toFixed(1), commands: cmds,
    outputTokens: gen(u2) - gen(u1), reasoningTokens: (u2.reasoning_output_tokens ?? 0) - (u1?.reasoning_output_tokens ?? 0),
    inputTokens: (u2.input_tokens ?? 0) - (u1?.input_tokens ?? 0) };
}
function piTurn2(item, round) {
  const d = path.join(K, round, 'sessions', item);
  const file = ls(d, '.jsonl')[0];
  if (!file) return null;
  const L = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const users = L.map((o, i) => [o, i]).filter(([o]) => o.type === 'message' && o.message?.role === 'user').map(([, i]) => i);
  if (users.length < 2) return null;
  const S = L.slice(users[1], users[2] ?? L.length);
  let cmds = 0, out = 0, inp = 0, reas = 0;
  for (const o of S) {
    const m = o.message;
    if (o.type !== 'message' || m?.role !== 'assistant') continue;
    out += m.usage?.output ?? 0; inp += (m.usage?.input ?? 0) + (m.usage?.cacheRead ?? 0); reas += m.usage?.reasoning ?? 0;
    for (const c of m.content ?? []) if (c.type === 'toolCall' && c.name === 'bash') cmds++;
  }
  const ts = S.map(o => Date.parse(o.timestamp)).filter(Number.isFinite);
  return { minutes: +((Math.max(...ts) - Math.min(...ts)) / 60000).toFixed(1), commands: cmds, outputTokens: out, reasoningTokens: reas, inputTokens: inp };
}

const rows = [];
for (const [item, c] of Object.entries(key)) {
  if ((c.policy ?? 'v1') !== 'v1' || !acc[item]) continue;
  const heads = (() => { try { return read(path.join(K, c.round, 'heads.json')); } catch { return {}; } })();
  const wt = c.worktree ?? heads[item]?.worktree;
  const x = xc[path.basename(wt)] ?? {};
  const src = ls(path.join(wt, 'src/tensor'), '.ts'), tests = ls(path.join(wt, 'tests/tensor'), '.mjs');
  const fw = numstat(wt, 'src/framework'), fwt = numstat(wt, 'tests/framework');
  const outside = git(wt, 'diff', '--name-only', '19ad269', 'HEAD').split('\n').filter(f => f && !/^(src|tests|corpus)\/tensor\/|^src\/framework\/|^tests\/framework\/|^ttmp\//.test(f));
  const cost = c.harness === 'codex' ? codexTurn2(item, c.round) : c.harness === 'pi' ? piTurn2(item, c.round) : null;
  const cl = claude.find(u => u.item === item && u.turn === 'impl');
  rows.push({
    item, cell: `${c.harness.replace('claude-code-subagent', 'claude')}/${String(c.model).replace(/openai-codex\/|gpt-6\.2-|claude-|-5-5|-5-2/g, '')}/${c.effort}`,
    rev: acc[item].rev, suite: `${acc[item].passed}/${acc[item].passed + acc[item].failed}`, variant: vr[item] ? `${vr[item].passed}/${vr[item].passed + vr[item].failed}` : '-',
    xcF32: `${x.f32Same}/${x.f32Cases}`, xcF64: `${x.f64Close}/${x.f32Cases}`, inline: `${x.inlinePreserved}/${x.programs}`, split: `${x.splitPreserved}/${x.programs}`,
    srcLines: lines(src), testLines: lines(tests), tests: tests.reduce((a, f) => a + (fs.readFileSync(f, 'utf8').match(/^\s*(test|it)\(/gm) ?? []).length, 0),
    framework: `+${fw[0]}/-${fw[1]}`, frameworkTests: `+${fwt[0]}`, outsideScope: outside.length ? outside.join(' ') : '-',
    minutes: cost?.minutes ?? cl?.minutes ?? null, commands: cost?.commands ?? cl?.tool_uses ?? null,
    outputTokens: cost?.outputTokens ?? null, claudeSubagentTokens: cl?.subagent_tokens ?? null,
  });
}
rows.sort((a, b) => a.cell.localeCompare(b.cell));
console.table(rows.map(({ rev, outsideScope, claudeSubagentTokens, ...r }) => r));
const out = rows.filter(r => r.outsideScope !== '-');
if (out.length) console.log('outside the allowed scope:', out.map(r => `${r.item}: ${r.outsideScope}`).join('; '));
if (flag('--json')) fs.writeFileSync(flag('--json'), JSON.stringify(rows, null, 1));
if (flag('--md')) {
  const cols = ['item', 'cell', 'suite', 'variant', 'xcF32', 'inline', 'split', 'srcLines', 'testLines', 'tests', 'framework', 'minutes', 'commands', 'outputTokens'];
  fs.writeFileSync(flag('--md'), `| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n` + rows.map(r => `| ${cols.map(c => r[c] ?? '-').join(' | ')} |`).join('\n') + '\n');
}
