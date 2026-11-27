#!/usr/bin/env node
// IRWB-019 Typed stage D1 (why `speed` slows the bytecode VM) hidden evaluation, written from the D1 brief before any
// cell's code was read (the coordinator had read only two cells' final messages).
//   node d1-eval.mjs run <out.json> <worktree>...   one child per worktree, sequentially
//   node d1-eval.mjs worker <worktree> [--only id,id]   prints JSON
// Per worktree, with its own build (dist/) and its own corpus:
//   instructions: the strategies' own metric (`measure`: RV32 instructions of the lowered image over seeded cases per
//     function) for r0, O2 and speed on every corpus project, at the agents' seed (count 10, seed 7) and at a held-out
//     seed (count 20, seed 1103) the brief never named; rejected pass applications are counted;
//   parity: tools/parity.mjs --json (every pass checked, head against r0 on 100 cases);
//   tests: tests/typed, tests/framework, tests/workbench (pass, fail, skip);
//   scope: files changed against t6-base (or $EVAL_BASE), by area. Also used for D2 (EVAL_BASE=d2-base).
// The brief's acceptance: the VM's instructions under `speed` at or below r0's, no regression in the other projects'
// totals, parity clean.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SEEDS = [
  { name: 'agents', count: 10, seed: 7 },
  { name: 'heldout', count: 20, seed: 1103 },
];
const PIPES = ['r0', 'O2', 'speed'];
const [mode, ...rest] = process.argv.slice(2);
const err = e => String(e?.message ?? e).slice(0, 300);

if (mode === 'worker') {
  const wt = rest[0];
  const only = rest.includes('--only') ? rest[rest.indexOf('--only') + 1].split(',') : null;
  const t0 = Date.now();
  const imp = p => import(pathToFileURL(path.join(wt, p)).href);
  const { installVendor } = await imp('tools/node-vendor.mjs');
  await installVendor();
  const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
  const { projectSource } = await imp('dist/typed/project.js');
  const { Program } = await imp('dist/typed/program.js');
  const { measure } = await imp('dist/typed/strategies.js');
  const projects = {};
  for (const id of only ?? projectIds()) {
    const row = {};
    for (const pipe of PIPES) {
      try {
        const p = Program.fromProject(projectSource(id, projectFiles(id)));
        let rejected = [];
        if (pipe !== 'r0') rejected = (await p.pipeline(pipe)).steps.filter(s => s.rejected).map(s => s.pass);
        const m = {};
        for (const s of SEEDS) {
          const r = measure(p, p.artifact(), { count: s.count, seed: s.seed });
          m[s.name] = { instructions: r.instructions, limited: r.limited, bytes: r.bytes };
        }
        row[pipe] = { ...m, rejected };
      } catch (e) {
        row[pipe] = { error: err(e) };
      }
    }
    projects[id] = row;
  }
  let parity, tests;
  if (!only) {
    const pr = spawnSync(process.execPath, ['tools/parity.mjs', '--json'], { cwd: wt, encoding: 'utf8', timeout: 3600000, maxBuffer: 1 << 28 });
    try { parity = JSON.parse(pr.stdout).totals ?? JSON.parse(pr.stdout); } catch { parity = { error: (pr.stderr || pr.stdout || '').slice(-400) }; }
    tests = {};
    for (const dir of ['typed', 'framework', 'workbench']) {
      const files = fs.readdirSync(path.join(wt, 'tests', dir)).filter(f => f.endsWith('.test.mjs')).map(f => `tests/${dir}/${f}`);
      const tr = spawnSync(process.execPath, ['--test', ...files], { cwd: wt, encoding: 'utf8', timeout: 3600000, maxBuffer: 1 << 28 });
      const num = k => +((tr.stdout.match(new RegExp(`^(?:#|\u2139) ${k} (\\d+)`, 'm')) || [])[1] ?? NaN);
      tests[dir] = { pass: num('pass'), fail: num('fail'), skipped: num('skipped') };
    }
  }
  process.stdout.write(JSON.stringify({ projects, parity, tests, seconds: +((Date.now() - t0) / 1000).toFixed(1) }), () => process.exit(0));
} else if (mode === 'run') {
  const [outFile, ...wts] = rest;
  const all = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  for (const wt of wts) {
    const name = path.basename(wt);
    const b = spawnSync('npm', ['run', 'build', '--silent'], { cwd: wt, encoding: 'utf8' });
    if (b.status) { all[name] = { error: 'build failed: ' + (b.stdout + b.stderr).slice(-400) }; fs.writeFileSync(outFile, JSON.stringify(all, null, 1)); continue; }
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, 'worker', wt], { encoding: 'utf8', timeout: 4 * 3600000, maxBuffer: 1 << 28 });
    let res;
    try { res = JSON.parse(r.stdout); } catch { res = { error: (r.stderr || r.error?.message || 'no output').slice(-600) }; }
    const diff = spawnSync('git', ['diff', '--numstat', process.env.EVAL_BASE ?? 't6-base', 'HEAD'], { cwd: wt, encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
    const areas = {};
    for (const l of diff) { const [a, d, f] = l.split('\t'); const k = f.split('/').slice(0, f.startsWith('src/') || f.startsWith('tests/') ? 2 : 1).join('/'); areas[k] = (areas[k] ?? 0) + (+a || 0); }
    res.scope = areas;
    res.head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: wt, encoding: 'utf8' }).stdout.trim();
    all[name] = res;
    fs.writeFileSync(outFile, JSON.stringify(all, null, 1));
    if (res.error) { console.log(`${name}: ${res.error.slice(-200)}`); continue; }
    const tot = (pipe, s, skip) => Object.entries(res.projects).filter(([id]) => id !== skip).reduce((a, [, v]) => a + (v[pipe]?.[s]?.instructions ?? NaN), 0);
    const vm = res.projects['bytecode-vm'] ?? {};
    console.log(`${name.padEnd(24)} ${res.seconds}s vm r0/O2/speed ${PIPES.map(p => vm[p]?.agents?.instructions).join('/')} (held-out ${PIPES.map(p => vm[p]?.heldout?.instructions).join('/')})`);
    console.log(`  totals O2 ${tot('O2', 'agents')} speed ${tot('speed', 'agents')} | held-out O2 ${tot('O2', 'heldout')} speed ${tot('speed', 'heldout')} | parity ${JSON.stringify(res.parity).slice(0, 120)} | tests ${JSON.stringify(res.tests)}`);
  }
}
