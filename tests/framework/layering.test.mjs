// The framework's module boundaries, enforced on the source imports.
//   - src/framework/** imports nothing outside src/framework except src/stdlib/, the standard library of compiler
//     algorithms, which sits below the framework and imports nothing outside itself (tests/stdlib/layering.test.mjs),
//     so the two rules cannot form a cycle. The dataflow solver's depth-first order (IRWB-047-B) and the lattices
//     (IRWB-048-B) live there.
//   - strategy, contracts and ir import from core only core/data.js, core/types.js and core/steps.js (v6's separability claim).
//   - no layer of the framework imports a domain (labs, typed, candela, workbench).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../src/', import.meta.url));
const files = dir =>
  readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
const imports = file =>
  [...readFileSync(file, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)].map(m =>
    relative(src, resolve(dirname(file), m[1])),
  );

test('framework sources import nothing outside src/framework and src/stdlib', () => {
  for (const f of files(join(src, 'framework')))
    for (const i of imports(f))
      assert.ok(i.startsWith('framework/') || i.startsWith('stdlib/'), `${relative(src, f)} imports ${i}`);
});

test('strategy, contracts and ir use only core/data, core/types and core/steps from core', () => {
  for (const layer of ['strategy', 'contracts', 'ir'])
    for (const f of files(join(src, 'framework', layer)))
      for (const i of imports(f).filter(i => i.startsWith('framework/core/')))
        assert.ok(
          ['framework/core/data.js', 'framework/core/types.js', 'framework/core/steps.js'].includes(i),
          `${relative(src, f)} imports ${i}`,
        );
});

test('the core runtime imports no higher framework layer', () => {
  for (const f of files(join(src, 'framework', 'core')))
    for (const i of imports(f))
      assert.ok(i.startsWith('framework/core/'), `${relative(src, f)} imports ${i}`);
});
