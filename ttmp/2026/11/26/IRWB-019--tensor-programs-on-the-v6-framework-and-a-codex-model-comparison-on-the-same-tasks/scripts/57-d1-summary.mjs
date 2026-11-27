#!/usr/bin/env node
// IRWB-019: D1 summary from results/eval-d1.json: the VM under r0/O2/speed at both seeds, corpus totals, projects
// slower than the base (per pipeline and seed), parity, tests, and lines changed per area.
// node 57-d1-summary.mjs <eval-d1.json> [--tests <dir>]   (--tests: rerun the three test directories per worktree)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const [file, ...rest] = process.argv.slice(2);
const all = JSON.parse(fs.readFileSync(file, 'utf8'));
const base = all['typed-base-eval'];
const W = '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees';
if (rest.includes('--tests')) {
  for (const name of Object.keys(all)) {
    const wt = path.join(W, name), tests = {};
    for (const dir of ['typed', 'framework', 'workbench']) {
      const files = fs.readdirSync(path.join(wt, 'tests', dir)).filter(f => f.endsWith('.test.mjs')).map(f => `tests/${dir}/${f}`);
      const tr = spawnSync(process.execPath, ['--test', ...files], { cwd: wt, encoding: 'utf8', maxBuffer: 1 << 28 });
      const num = k => +((tr.stdout.match(new RegExp(`^(?:#|ℹ) ${k} (\\d+)`, 'm')) || [])[1] ?? NaN);
      tests[dir] = { pass: num('pass'), fail: num('fail'), skipped: num('skipped') };
    }
    all[name].tests = tests;
  }
  fs.writeFileSync(file, JSON.stringify(all, null, 1));
}
const tot = (r, pipe, s) => Object.values(r.projects).reduce((a, v) => a + (v[pipe]?.[s]?.instructions ?? 0), 0);
for (const [name, r] of Object.entries(all)) {
  if (r.error) { console.log(name, 'ERROR', r.error.slice(0, 200)); continue; }
  const vm = r.projects['bytecode-vm'];
  const slower = [];
  for (const [id, v] of Object.entries(r.projects))
    for (const pipe of ['O2', 'speed'])
      for (const s of ['agents', 'heldout']) {
        const b = base.projects[id]?.[pipe]?.[s]?.instructions, x = v[pipe]?.[s]?.instructions;
        if (x > b) slower.push(`${id}/${pipe}/${s} ${b}->${x}`);
      }
  const rej = Object.entries(r.projects).flatMap(([id, v]) => ['O2', 'speed'].flatMap(p => (v[p]?.rejected ?? []).map(x => `${id}/${p}/${x}`)));
  const ps = r.parity?.summary ?? r.parity;
  const t = r.tests ? Object.entries(r.tests).map(([k, v]) => `${k} ${v.pass}/${v.fail}/${v.skipped}`).join(' ') : '';
  console.log(`${name.padEnd(22)} vm speed ${vm.speed.agents.instructions} (r0 ${vm.r0.agents.instructions}) held-out ${vm.speed.heldout.instructions} (r0 ${vm.r0.heldout.instructions}) | speed total ${tot(r, 'speed', 'agents')} held-out ${tot(r, 'speed', 'heldout')} | O2 ${tot(r, 'O2', 'agents')} | parity fail ${ps?.failures} | tests ${t}`);
  console.log(`   slower than base: ${slower.length ? slower.join('; ') : 'none'}${rej.length ? ' | rejected: ' + rej.join(', ') : ''}`);
  console.log(`   changed: ${Object.entries(r.scope ?? {}).filter(([k]) => !k.startsWith('ttmp')).map(([k, v]) => `${k} +${v}`).join(', ')}`);
}
