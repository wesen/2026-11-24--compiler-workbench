// The standalone site: what the build writes, that it makes no network requests and carries no keys, and that
// the text it bundles fits a tile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { root, widest } from './helpers.mjs';

const out = 'dist/site-test';

test('build:site writes the page, the bundle, the styles and the checked vendor scripts', () => {
  rmSync(join(root, out), { recursive: true, force: true });
  const log = execFileSync(process.execPath, [join(root, 'tools/build-site.mjs'), out], { cwd: root }).toString();
  assert.match(log, /44 projects, 17 chapters/);
  for (const f of ['index.html', 'app.js', 'app.css', 'vendor/tape.js', 'vendor/typed-wasm.js', 'vendor/rv32-interp.js'])
    assert.ok(existsSync(join(root, out, f)), f);
  const html = readFileSync(join(root, out, 'index.html'), 'utf8');
  assert.match(html, /connect-src 'none'/);
  // the vendored scripts load as classic scripts before the bundle
  assert.ok(html.indexOf('vendor/rv32-interp.js') < html.indexOf('src="app.js"'));
  const app = readFileSync(join(root, out, 'app.js'), 'utf8');
  for (const s of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'sk-ant', 'anthropic.com'])
    assert.ok(!app.includes(s), `the bundle contains ${s}`);
  rmSync(join(root, out), { recursive: true, force: true });
});

test('the reference, the divergences and the book are wrapped at 72 columns', () => {
  const log = execFileSync(process.execPath, [join(root, 'tools/format-docs.mjs'), '--check'], { cwd: root }).toString();
  assert.match(log, /would change 0 of 19 files/);
  for (const f of ['corpus/reference.md', 'src/workbench/DIVERGENCES.md'])
    assert.ok(widest(readFileSync(join(root, f), 'utf8')) <= 72, f);
});
