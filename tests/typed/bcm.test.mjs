// bcm: merging checked text addresses (tape-lifted caddr) per block and receiver.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
await installVendor();
const { Program } = await import('../../dist/typed/program.js');

const SRC = `function consts(s: string): i32 {
    const a = s.charCodeAt(0);
    const b = s.charCodeAt(3);
    const c = s.charCodeAt(1);
    return a + b + c;
}
function run(s: string, i: i32): i32 {
    return s.charCodeAt(i) + s.charCodeAt(i + 1) + s.charCodeAt(i + 2);
}
function pair(s: string, i: i32): i32 {
    return s.charCodeAt(i) + s.charCodeAt(i + 5);
}
function one(): i32 { return 1; }
function split(s: string): i32 {
    const a = s.charCodeAt(0);
    const b = one();
    return a + s.charCodeAt(2) + b;
}
`;
const text = { buffer: [0, 6], cell: [0, 255] };
const inputs = {
  consts: { s: text },
  run: { s: text, i: [-2, 6] },
  pair: { s: text, i: [-2, 6] },
  split: { s: text },
};
const open = () => new Program('fixture', SRC, { ingest: { tape: true }, inputs });
const checks = (p, fn) => (p.listing(fn).match(/caddr\(/g) || []).length;

test('bcm: constant positions are checked once, for the largest, at the first site', async () => {
  const p = open();
  assert.equal(checks(p, 'consts'), 3);
  const r = await p.apply('bcm');
  assert.equal(r.changed, true);
  assert.equal(checks(p, 'consts'), 1);
  assert.match(p.listing('consts'), /caddr\(s, \(0 \+ 3\)\)|caddr\(s, 3\)|caddr\(s, \(.*\+ 3\)\)/);
  assert.equal(p.check({ count: 200 }).status, 'agree');
});

test('bcm: one base plus offsets keeps the smallest and the largest check, three sites become two', async () => {
  const p = open();
  assert.equal(checks(p, 'run'), 3);
  await p.apply('bcm');
  assert.equal(checks(p, 'run'), 2);
  // two sites with different offsets gain nothing and stay as they are
  assert.equal(checks(p, 'pair'), 2);
  assert.equal(p.check({ count: 200 }).status, 'agree');
});

test('bcm: a call ends a group (it might not return), so both checks stay', async () => {
  const p = open();
  await p.apply('bcm');
  assert.equal(checks(p, 'split'), 2);
});

test('bcm: why on an unchecked address reaches the statement where the group is checked', async () => {
  const p = open();
  await p.apply('bcm');
  const e = p.revisions.at(-1).edits.find(x => x.fn === 'consts' && /s \+ \(t\d+ << 1\)/.test(x.text));
  assert.ok(e, 'an unchecked site in consts');
  const reaches = (node, target, seen = new Set()) => {
    if (typeof node === 'string') return node === target;
    if (!node || typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    return Object.values(node).some(x => (Array.isArray(x) ? x.some(y => reaches(y, target, seen)) : reaches(x, target, seen)));
  };
  const first = p.revisions.at(-1).edits.find(x => x.fn === 'consts' && /caddr/.test(x.text)).stmt;
  // the load was rebuilt around its address; the address is the rewritten value
  const addr = p.lookup(e.to).entity.args[0];
  const tree = p.why(addr);
  assert.ok(reaches(tree, first) || JSON.stringify(tree).includes('covered by the group'), JSON.stringify(tree).slice(0, 400));
});
