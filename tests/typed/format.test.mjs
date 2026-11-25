// Tile-width formatting: what the workbench shows must read in a 60–80 column tile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { corpusDir, projectIds } from '../../tools/corpus.mjs';

const { formatJson, wrapProse, joinText, TILE_WIDTH } = await import('../../dist/typed/format.js');
const S = await import('../../dist/typed/strategies.js');
const width = text => Math.max(0, ...text.split('\n').map(l => l.length));
const files = dir =>
  readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

test('format: JSON keeps what fits on one line, breaks the rest, and round-trips', () => {
  const v = { a: [1, 2, 3], b: { c: 'x [ y ] z', d: null }, long: Array.from({ length: 30 }, (_, i) => `item-${i}`) };
  const text = formatJson(v, 40);
  assert.deepEqual(JSON.parse(text), v);
  assert.ok(width(text) <= 40, text);
  assert.match(text, /"a": \[1, 2, 3\]/);
  assert.match(text, /"c": "x \[ y \] z"/); // string contents untouched
});

test('format: prose wraps without changing blocks; lists keep their items', () => {
  const md = '# Title\n\nA ' + 'word '.repeat(40) + '\n\n- item ' + 'more '.repeat(30) + '\n\n```\ncode line that is very long and must not be wrapped by the formatter at all\n```\n';
  const out = wrapProse(md, 60);
  assert.ok(out.split('\n').filter(l => !l.startsWith('code')).every(l => l.length <= 60));
  assert.match(out, /^ {2}more/m); // list continuation is indented, so it stays in the item
  assert.match(out, /code line that is very long and must not be wrapped by the formatter at all/);
  assert.equal(joinText(['a', 'b']), 'a b');
});

test('format: every corpus file the workbench shows fits a tile; formatted ones fit TILE_WIDTH', () => {
  const wide = [];
  for (const id of projectIds())
    for (const f of files(join(corpusDir, id))) {
      if (!/\.(typed|js|json|md)$/.test(f)) continue;
      const w = width(readFileSync(f, 'utf8'));
      const limit = /(project\.json|notes\.md)$/.test(f) ? TILE_WIDTH + 1 : 80; // +1: a word carried past a block marker
      if (w > limit) wide.push(`${f}: ${w}`);
    }
  assert.deepEqual(wide, []);
  // the formatter has nothing left to do
  execFileSync(process.execPath, ['tools/format-corpus.mjs', '--check'], { stdio: 'pipe' });
});

test('format: strategy presets and plans fit TILE_WIDTH', () => {
  for (const [path, text] of Object.entries(S.presetFiles())) {
    assert.ok(width(text) <= TILE_WIDTH, `${path}: ${width(text)}`);
    const name = path.replace(/^strategies\/|\.json$/g, '');
    assert.equal(S.projectStrategies({ [path]: text })[name].id, `typed.strategy.${name}`);
    assert.ok(width(S.toJson(S.planFromSpec(name, JSON.parse(text)))) <= TILE_WIDTH);
  }
});
