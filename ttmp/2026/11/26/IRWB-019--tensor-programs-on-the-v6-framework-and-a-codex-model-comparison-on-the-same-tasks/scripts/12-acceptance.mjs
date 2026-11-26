#!/usr/bin/env node
// Run the hidden acceptance suite against implementation worktrees, one at a time, and record per-test results.
// Usage: node 12-acceptance.mjs <suite.test.mjs> <out.json> [ITEM ...]   (default: every item of t1 with a worktree)
//   For each item: `npm run build` in its worktree (skipped with --no-build), then
//   `TIX_ROOT=<worktree> node --test --test-reporter=tap <suite>`, with a 5-minute limit.
//   Writes {item: {rev, build, passed, failed, tests: {name: 'ok' | 'not ok'}, firstFailures: [...]}} and prints
//   one line per item. The suite path is an argument so that the suite itself can stay outside the repository.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const [suite, outFile, ...only] = args.filter(a => a !== '--no-build');
const T = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const key = JSON.parse(fs.readFileSync(path.join(T, 'various/results/t1-config-key.json'), 'utf8'));
const heads = round => {
  try { return JSON.parse(fs.readFileSync(path.join(T, 'various/kit', round, 'heads.json'), 'utf8')); } catch { return {}; }
};
const results = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
const items = only.length ? only : Object.keys(key).sort();
for (const item of items) {
  const c = key[item];
  const wt = c?.worktree ?? heads(c?.round)[item]?.worktree;
  if (!wt || !fs.existsSync(wt)) { console.log(`${item}: no worktree`); continue; }
  const rev = spawnSync('git', ['-C', wt, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  let build = 'skipped';
  if (!noBuild) {
    const b = spawnSync('npm', ['run', 'build', '--silent'], { cwd: wt, encoding: 'utf8', timeout: 300000 });
    build = b.status === 0 ? 'ok' : `failed (${b.status}): ${(b.stderr || b.stdout).trim().split('\n').slice(-3).join(' | ')}`;
  }
  const hasApi = fs.existsSync(path.join(wt, 'dist/tensor/index.js'));
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.resolve(suite)], {
    cwd: path.dirname(path.resolve(suite)), env: { ...process.env, TIX_ROOT: wt }, encoding: 'utf8', timeout: 300000,
  });
  const tests = {}, failures = [];
  const lines = (r.stdout ?? '').split('\n');
  lines.forEach((l, i) => {
    const m = l.match(/^(?: {4})?(not ok|ok) \d+ - (.*)$/);
    if (!m || l.startsWith('    ')) return; // top-level tests only
    tests[m[2]] = m[1];
    if (m[1] === 'not ok') {
      const err = lines.slice(i + 1, i + 30).find(x => /error: |message: /.test(x));
      failures.push(`${m[2]}: ${(err ?? '').trim().slice(0, 240)}`);
    }
  });
  const passed = Object.values(tests).filter(v => v === 'ok').length, failed = Object.values(tests).filter(v => v === 'not ok').length;
  results[item] = { config: c.config, harness: c.harness, model: c.model, effort: c.effort, rev, build, hasApi, passed, failed, tests, firstFailures: failures.slice(0, 8), exit: r.status, timedOut: r.error?.code === 'ETIMEDOUT' };
  fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
  console.log(`${item} ${String(c.config).padEnd(9)} rev ${rev} build ${build.slice(0, 60)} api ${hasApi ? 'yes' : 'no'}  ${passed}/${passed + failed}`);
}
