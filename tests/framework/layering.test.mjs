// The framework's module boundaries, enforced on the source imports.
//   - src/framework/** imports nothing outside src/framework, except src/stdlib/ — the standard library
//     of compiler algorithms, which sits below the framework, imports nothing outside src/stdlib/
//     (tests/stdlib/layering.test.mjs), and is where the lattices live since IRWB-048-B.
//   - strategy, contracts and ir import from core only core/data.js and core/types.js (v6's separability claim).
//   - no layer of the framework imports a domain (labs, typed, candela, workbench).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../src/', import.meta.url));
const files = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []; });
const imports = file => [...readFileSync(file, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)].map(m => relative(src, resolve(dirname(file), m[1])));

test('framework sources import nothing outside src/framework and src/stdlib', () => {
  for (const f of files(join(src, 'framework')))
    for (const i of imports(f))
      assert.ok(i.startsWith('framework/') || i.startsWith('stdlib/'), `${relative(src, f)} imports ${i}`);
});

test('strategy, contracts and ir use only core/data and core/types from core', () => {
  for (const layer of ['strategy', 'contracts', 'ir'])
    for (const f of files(join(src, 'framework', layer)))
      for (const i of imports(f).filter(i => i.startsWith('framework/core/')))
        assert.ok(['framework/core/data.js', 'framework/core/types.js'].includes(i), `${relative(src, f)} imports ${i}`);
});

test('the core runtime imports no higher framework layer', () => {
  for (const f of files(join(src, 'framework', 'core')))
    for (const i of imports(f)) assert.ok(i.startsWith('framework/core/'), `${relative(src, f)} imports ${i}`);
});
