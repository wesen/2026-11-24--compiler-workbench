// IRWB-046-C: the standard library's boundary, read off the source imports (no build needed).
//   - a module under src/stdlib/ imports nothing outside src/stdlib/ — in particular nothing from src/framework/,
//     src/typed/ or src/tensor/, and no Node builtin or package: the library is arithmetic over its arguments;
//   - the layers of src/stdlib/index.ts hold: a module imports another library module only from its own layer or a
//     lower one, so a leaf (graph, lattice, num) stays a leaf and `check`/`measure` see everything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../src/', import.meta.url));
const root = join(src, 'stdlib');
const files = dir =>
  readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
const imports = file =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map(m => m[1]);

/** Layer of a stdlib module, from the file's directory; the index sits above every layer. */
const LAYERS = { graph: 0, lattice: 0, num: 0, ssa: 1, flow: 1, pe: 2, affine: 2, term: 2, check: 3, measure: 3 };
const layerOf = rel => (/(^|\/)index\.ts$/.test(rel) && !rel.includes('/') ? 4 : LAYERS[rel.split('/')[0]]);

test('stdlib sources import nothing outside src/stdlib', () => {
  const found = files(root);
  assert.ok(found.length > 0, 'src/stdlib has modules');
  for (const f of found)
    for (const spec of imports(f)) {
      assert.ok(spec.startsWith('.'), `${relative(src, f)} imports '${spec}': a library module has no dependencies`);
      const target = relative(root, resolve(dirname(f), spec));
      assert.ok(!target.startsWith('..'), `${relative(src, f)} imports ${target}`);
    }
});

test('the library layers hold: leaf, middle, upper, top', () => {
  for (const f of files(root)) {
    const own = layerOf(relative(root, f));
    assert.notEqual(own, undefined, `${relative(src, f)} is under a layer named in src/stdlib/index.ts`);
    for (const spec of imports(f).filter(s => s.startsWith('.'))) {
      const target = relative(root, resolve(dirname(f), spec));
      const other = layerOf(target);
      assert.notEqual(other, undefined, `${relative(src, f)} imports ${target}, which has no layer`);
      assert.ok(other <= own, `${relative(src, f)} (layer ${own}) imports ${target} (layer ${other})`);
    }
  }
});

test('the stdlib index re-exports what the library offers', () => {
  const index = readFileSync(join(root, 'index.ts'), 'utf8');
  for (const f of files(root).filter(f => !f.endsWith(join('stdlib', 'index.ts')))) {
    const rel = relative(root, f).replace(/\\/g, '/');
    if (/(^|\/)index\.ts$/.test(rel) === false) assert.match(index, new RegExp(`'\./${rel.replace('.ts', '.js')}'`), `index.ts exports ${rel}`);
  }
});
