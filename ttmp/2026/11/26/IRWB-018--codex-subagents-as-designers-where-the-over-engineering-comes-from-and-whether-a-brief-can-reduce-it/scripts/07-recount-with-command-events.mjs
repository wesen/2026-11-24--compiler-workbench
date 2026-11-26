#!/usr/bin/env node
// Recount the commands of IRWB-018's Codex rounds from the rollouts' CommandExecution events (the authoritative
// record of every command Codex ran), per turn, and compare with what the regex-based extractors reported.
// The earlier extractors matched `cmd: "..."` in tool-call text and missed commands a model batched inside one
// code-mode script (an array of commands mapped over tools.exec_command).
// Usage: node 07-recount-with-command-events.mjs <rollout.jsonl>...   (prints one JSON line per rollout turn)
import fs from 'node:fs';

const classify = c => ({
  interpreter: /(^|[\s;&|(])(node|python3?)\s/.test(c),
  test: /node --test|npm (run )?test/.test(c),
  bookkeeping: /\bdocmgr\b|01-diary|diary\.md|changelog\.md|tasks\.md/.test(c),
  guides: /ttmp\/2026\/11\/2[45]\/IRWB-0(0[7-9]|1[01])/.test(c),
});
for (const file of process.argv.slice(2)) {
  const L = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return {}; } });
  const meta = L.find(o => o.type === 'session_meta')?.payload ?? {};
  const cwd = String(meta.cwd ?? '');
  const item = (cwd.match(/irwb-\d+/i) ?? ['?'])[0].toUpperCase();
  const worktree = cwd.split('/').at(-1);
  let turn = 0;
  const turns = [];
  for (const o of L) {
    if (o.type === 'event_msg' && o.payload?.type === 'task_started') { turn++; turns[turn] = { cmds: [] }; }
    if (o.type === 'event_msg' && o.payload?.type === 'item_completed' && o.payload.item?.type === 'CommandExecution' && turns[turn]) {
      const c = o.payload.item.command;
      turns[turn].cmds.push(Array.isArray(c) ? c.at(-1) : String(c));
    }
  }
  turns.forEach((t, i) => {
    if (!t) return;
    const n = k => t.cmds.filter(c => classify(c)[k]).length;
    console.log(JSON.stringify({ item, worktree, turn: i, commands: t.cmds.length, interpreter: n('interpreter'), tests: n('test'), bookkeeping: n('bookkeeping'), guides: n('guides') }));
  });
}
