// IRWB-037-G: scoped facts over a dominator tree (src/framework/dataflow/scoped.ts).
import assert from 'node:assert/strict';
import test from 'node:test';

const { ScopedMap, walkDominatorTree } = await import('../../dist/framework/dataflow/index.js');

test('ScopedMap: close undoes the writes since the matching open, overwrites and new keys alike', () => {
  const m = new ScopedMap();
  m.set('a', 1);
  m.open();
  m.set('a', 2).set('b', 3);
  m.open();
  m.set('a', 4);
  assert.deepEqual([m.get('a'), m.get('b'), m.depth], [4, 3, 2]);
  m.close();
  assert.deepEqual([m.get('a'), m.get('b')], [2, 3]);
  m.close();
  assert.deepEqual([m.get('a'), m.has('b'), m.depth], [1, false, 0]);
  assert.throws(() => m.close(), /without open/);
});

test('walkDominatorTree: preorder, children in the given order, each node sees exactly its ancestors\' facts', () => {
  //        r
  //      a   b
  //     c d    e
  const kids = { r: ['a', 'b'], a: ['c', 'd'], b: ['e'] };
  const path = new ScopedMap();
  const order = [],
    seen = {};
  walkDominatorTree(
    'r',
    n => kids[n] ?? [],
    n => {
      order.push(n);
      seen[n] = ['r', 'a', 'b', 'c', 'd', 'e'].filter(k => path.has(k));
      path.set(n, true);
    },
    [path],
  );
  assert.deepEqual(order, ['r', 'a', 'c', 'd', 'b', 'e']);
  assert.deepEqual(seen, { r: [], a: ['r'], c: ['r', 'a'], d: ['r', 'a'], b: ['r'], e: ['r', 'b'] });
  assert.equal(path.depth, 0);
  assert.equal(path.has('r'), false);
});

test('walkDominatorTree does not recurse: a chain of 100000 nodes', () => {
  let n = 0;
  walkDominatorTree(
    0,
    i => (i < 99999 ? [i + 1] : []),
    () => n++,
  );
  assert.equal(n, 100000);
});
