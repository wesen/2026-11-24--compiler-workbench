// IRWB-046-B: the standard library's admission rule, as a source-level import check (as
// tests/framework/layering.test.mjs does for the framework). The library is pure, synchronous code
// over small shape interfaces, never over a domain's types, so a module under src/stdlib/ resolves
// no import outside src/stdlib/ — which covers src/framework/, src/typed/ and src/tensor/ (and every
// other domain the compiler carries).
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

test('stdlib sources import nothing outside src/stdlib', () => {
  const dir = join(src, 'stdlib');
  const found = files(dir);
  assert.ok(found.length > 0, 'src/stdlib exists and holds TypeScript sources');
  for (const f of found)
    for (const i of imports(f))
      assert.ok(i.startsWith('stdlib/'), `${relative(src, f)} imports ${i}`);
});

test('the library index exports the liveness primitive', async () => {
  const { liveness } = await import('../../dist/stdlib/index.js');
  const r = liveness(
    { blocks: [{ uses: new Set([1]), defs: new Set(), succ: [] }] },
    'all-blocks',
  );
  assert.deepEqual([...r.in[0]], [1]);
});

test('the library index exports the graph primitives', async () => {
  const { depthFirst, dominators, naturalLoops } = await import('../../dist/stdlib/index.js');
  const g = { nodes: ['e', 'a'], entry: 'e', succ: n => (n === 'e' ? ['a'] : []) };
  assert.deepEqual(depthFirst(g).rpo, ['e', 'a']);
  assert.deepEqual([...dominators(g).idom], [['e', 'e'], ['a', 'e']]);
  assert.deepEqual(naturalLoops(g), []);
});
