// IRWB-037-G: the four passes found from the hot-shape tables (src/typed/guards.ts): thread, guards, copies,
// subst-mem. Each on a small program, checked against r0 like every pass, and where it must not fire.
import assert from 'node:assert/strict';
import test from 'node:test';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { listing } = await import('../../dist/typed/listing.js');
const { decideCompare, narrowBy } = await import('../../dist/typed/guards.js');
const { PIPELINES, PASSES } = await import('../../dist/typed/passes.js');

const open = (name, source, inputs, tape = false) => {
  const p = Program.fromProject(
    projectSource(name, {
      'main.typed': source,
      'project.json': JSON.stringify({ inputs, ...(tape ? { ingest: { tape: true } } : {}) }),
    }),
  );
  assert.equal(p.status, 'ok', JSON.stringify(p.error));
  return p;
};
/** Apply the passes in order; every one that changes the program must pass its check on all cases. */
async function run(p, passes) {
  const changed = [];
  for (const pass of passes) {
    const r = await p.apply(pass);
    if (!r.changed) continue;
    const [agree, total] = r.check.split('/').map(Number);
    assert.equal(agree, total, `${pass}: ${r.check}`);
    changed.push(pass);
  }
  return { changed, text: listing(storeOf(p.head.value)) };
}
const count = (text, re) => (text.match(re) ?? []).length;

test('thread: the join of an && is copied into its arms, and the stored boolean goes', async () => {
  const p = open(
    'and',
    `
function both(a: i32, b: i32): i32 {
    let r = 0;
    if (a > 0 && b > 0) {
        r = 1;
    }
    return r;
}`,
    { both: { a: [-3, 3], b: [-3, 3] } },
  );
  const before = listing(storeOf(p.head.value));
  assert.match(before, /if t3 goto/);
  const { changed, text } = await run(p, ['cfg', 'thread', 'constprop', 'cfg', 'dce', 'subst-mem', 'dce', 'cfg']);
  assert.ok(changed.includes('thread'));
  assert.doesNotMatch(text, /t3/, text);
  assert.match(text, /if \(a > 0\) goto/);
  assert.match(text, /if \(b > 0\) goto/);
  // the copied branch names the block it came from
  const made = p.revisions.find(r => r.pass === 'thread').edits.filter(e => e.kind === 'replaceStmt');
  assert.equal(made.length, 2);
  assert.ok(made.every(e => e.because.some(b => b.startsWith('bb:both.'))));
});

test('thread leaves a loop head alone (copying a head is rotation, which runs after licm)', async () => {
  const p = open(
    'head',
    `
function count(n: i32, on: bool): i32 {
    let i = 0;
    while (on) {
        i = i + 1;
        if (i >= n) {
            break;
        }
    }
    return i;
}`,
    { count: { n: [0, 9], on: { bool: true } } },
  );
  await p.apply('cfg');
  const r = await p.apply('thread');
  assert.equal(r.changed, false, listing(storeOf(p.head.value)));
});

const FILL = `
function fill(n: i32): i32 {
    const cells = new Int32Array(9);
    const rows = new Int32Array(45);
    let sum = 0;
    for (let state = 0; state < n; state = state + 1) {
        const row = 5 * state;
        cells[state] = cells[state] + 1;
        rows[row + 1] = state;
        sum = sum + rows[row + 4] + cells[state];
    }
    return sum;
}`;

test('guards: one check of state decides the later ones, and those of 5 * state + k', async () => {
  const p = open('checks', FILL, { fill: { n: [0, 12] } }, true);
  await p.apply('cfg');
  const before = listing(storeOf(p.head.value));
  assert.equal(count(before, />=u/g), 5);
  const { changed, text } = await run(p, ['guards', 'cfg']);
  assert.deepEqual(changed, ['guards', 'cfg']);
  assert.equal(count(text, />=u/g), 1, text);
  assert.equal(count(text, /trap/g), 1);
  // n goes to 12, so the cases include calls that trap at state = 9: the remaining check is the one that traps
  const edits = p.revisions.find(r => r.pass === 'guards').edits.filter(e => e.kind === 'replaceStmt');
  assert.equal(edits.length, 4);
  const first = /s:fill\.\d+(?=\s+if \(state >=u 9\))/.exec(before)[0];
  for (const e of edits) assert.ok(e.because.includes(first), 'each decision names the check that gave the fact');
  // row + 4 with state in [0, 8] is in [4, 44]
  const origin = storeOf(p.revisions.find(r => r.pass === 'guards').artifact.value);
  const notes = edits.map(e => origin.get(e.to).origin[0].note);
  assert.ok(notes.includes('always false: geu([4, 44], [45, 45])'), notes.join('; '));
});

test('guards: a check stays when its index was assigned after the check that would decide it', async () => {
  const p = open(
    'moved',
    `
function hop(start: i32, k: i32): i32 {
    const cells = new Int32Array(9);
    let i = start;
    cells[i] = 1;
    i = i + k;
    cells[i] = 2;
    return cells[0];
}`,
    { hop: { start: [0, 12], k: [0, 12] } },
    true,
  );
  await p.apply('cfg');
  assert.equal((await p.apply('guards')).changed, false);
  assert.equal(count(listing(storeOf(p.head.value)), />=u/g), 2);
});

test('guards: only checks by default; params.all decides any branch', async () => {
  const source = `
function clamp(x: i32): i32 {
    let r = 0;
    if (x > 10) {
        if (x > 5) {
            r = 1;
        } else {
            r = 2;
        }
    }
    return r;
}`;
  const inputs = { clamp: { x: [0, 20] } };
  const p = open('branch', source, inputs);
  await p.apply('cfg');
  assert.equal((await p.apply('guards')).changed, false);
  const q = open('branch', source, inputs);
  await q.apply('cfg');
  const r = await q.apply('guards', { params: { all: true } });
  assert.equal(r.changed, true);
  assert.equal(r.check, '40/40');
  const { text } = await run(q, ['cfg', 'dce']);
  assert.doesNotMatch(text, /x > 5/);
  assert.doesNotMatch(text, /r = 2/);
});

const COUNTER = `
function sum(n: i32): i32 {
    let s = 0;
    for (let d = 0; d < 64; d = d + 1) {
        for (let j = 0; j < n; j = j + 1) {
            s = s + j;
        }
        s = s + d / 8 + d % 8;
    }
    return s;
}
function wander(n: i32, back: bool): i32 {
    let s = 0;
    let d = 0;
    while (d < 64) {
        s = s + d / 8;
        if (back) {
            d = d - 3;
        }
        d = d + 2;
        if (s > n) {
            break;
        }
    }
    return s;
}`;

test('guards: a counter that only goes up is not negative, so x / 8 and x % 8 are a shift and a mask', async () => {
  const inputs = { sum: { n: [0, 3] }, wander: { n: [0, 40], back: { bool: true } } };
  // F37: typed.ranges keeps d's lower bound under the inner loop, so strength now makes this rewrite itself.
  const s = open('counter', COUNTER, inputs);
  await run(s, ['cfg', 'simplify']);
  const strength = await run(s, ['strength']);
  assert.deepEqual(strength.changed, ['strength']);
  assert.match(strength.text, /\(s \+ \(d >> 3\)\) \+ \(d & 7\)/, strength.text);
  // and guards has the same rule for a division it sees itself, without strength in front of it
  const p = open('counter', COUNTER, inputs);
  await run(p, ['cfg', 'simplify']);
  const { changed, text } = await run(p, ['guards']);
  assert.deepEqual(changed, ['guards']);
  assert.match(text, /\(s \+ \(d >> 3\)\) \+ \(d & 7\)/, text);
  // wander's d goes down as well as up: it can be negative, and its division stays
  assert.match(text, /s = \(s \+ \(d \/ 8\)\)/, text);
  const edits = p.revisions.find(r => r.pass === 'guards').edits;
  assert.ok(edits.length >= 1);
});

test('copies: a read of a copy reads the source, unless the source was assigned since', async () => {
  const p = open(
    'copy',
    `
function twice(a: i32): i32 {
    let b = a;
    return b + b;
}
function stale(x: i32): i32 {
    let a = x * 3;
    let b = a;
    a = a + 1;
    return b + a;
}
function joined(x: i32, c: bool): i32 {
    let a = x;
    let b = a;
    if (c) {
        b = 7;
    }
    return b + a;
}`,
    { twice: { a: [-9, 9] }, stale: { x: [-9, 9] }, joined: { x: [-9, 9], c: { bool: true } } },
  );
  const { changed, text } = await run(p, ['copies', 'dce']);
  assert.deepEqual(changed, ['copies', 'dce']);
  assert.match(text, /return \(a \+ a\)/);
  assert.match(text, /b = a\n.*a = \(a \+ 1\)\n.*return \(b \+ a\)/, 'stale: b still read after a changed');
  // joined: b at the return is a phi of the copy and 7, so its read stays; a is a copy of x and is read through
  assert.match(text, /return \(b \+ x\)/, text);
});

test('subst-mem: a load moves into its reader, not past a store', async () => {
  const p = open(
    'mem',
    `
function pick(n: i32): i32 {
    const cells = new Int32Array(4);
    cells[1] = n;
    const t = cells[1];
    let r = 0;
    if (t === 5) {
        r = 1;
    }
    return r;
}
function keep(n: i32): i32 {
    const cells = new Int32Array(4);
    cells[1] = n;
    const t = cells[1];
    cells[1] = 0;
    return t + cells[1];
}`,
    { pick: { n: [3, 7] }, keep: { n: [3, 7] } },
    true,
  );
  await run(p, ['cfg', 'fold', 'simplify', 'guards', 'cfg']);
  const before = listing(storeOf(p.head.value));
  assert.match(before, /t = load32\[frame\+4\+0\]\n.*r = 0\n.*if \(t == 5\)/);
  assert.equal((await p.apply('subst')).changed, false, 'subst itself is as it was');
  const { changed, text } = await run(p, ['subst-mem']);
  assert.deepEqual(changed, ['subst-mem']);
  assert.match(text, /if \(load32\[frame\+4\+0\] == 5\)/);
  assert.match(text, /t = load32\[frame\+4\+0\]\n.*store32/, 'keep: the store is between the load and its reader');
});

test('speed is inline, inline, O2+, rotate, cfg with the new passes inserted; O2 does not name them', () => {
  const added = ['thread', 'copies', 'guards', 'identities'];
  const base = PIPELINES.speed.filter(n => !added.includes(n)).map(n => (n === 'subst-mem' ? 'subst' : n));
  assert.deepEqual(base, ['inline', 'inline', ...PIPELINES['O2+'], 'rotate', 'cfg']);
  for (const n of [...added, 'subst-mem']) {
    assert.ok(PASSES[n], n);
    assert.ok(PIPELINES.speed.includes(n), n);
    for (const pl of ['O0', 'O1', 'O2', 'O2+', 'loops', 'checks']) assert.ok(!PIPELINES[pl].includes(n), `${pl} ${n}`);
  }
});

// ---------- the interval rules, against every value of small intervals ----------
const u = x => x >>> 0;
const HOLDS = {
  lt: (x, y) => x < y,
  le: (x, y) => x <= y,
  gt: (x, y) => x > y,
  ge: (x, y) => x >= y,
  eq: (x, y) => x === y,
  ne: (x, y) => x !== y,
  ltu: (x, y) => u(x) < u(y),
  geu: (x, y) => u(x) >= u(y),
};
const intervals = [];
for (let lo = -3; lo <= 3; lo++) for (let hi = lo; hi <= 3; hi++) intervals.push([lo, hi]);
const values = ([lo, hi]) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

test('decideCompare says true or false only when every pair of values agrees (28 x 28 intervals, 8 operators)', () => {
  let decided = 0;
  for (const [op, holds] of Object.entries(HOLDS))
    for (const a of intervals)
      for (const b of intervals) {
        const d = decideCompare(op, a, b);
        if (d === undefined) continue;
        decided++;
        for (const x of values(a)) for (const y of values(b)) assert.equal(holds(x, y), d, `${op} ${a} ${b}: ${x}, ${y}`);
      }
  assert.ok(decided > 1000, String(decided));
});

test('narrowBy keeps every x for which x op y holds for some y of the interval', () => {
  let narrowed = 0;
  for (const [op, holds] of Object.entries(HOLDS))
    for (const cur of intervals)
      for (const r of intervals) {
        const next = narrowBy(op, cur, r);
        if (next && (next[0] !== cur[0] || next[1] !== cur[1])) narrowed++;
        for (const x of values(cur))
          if (values(r).some(y => holds(x, y)))
            assert.ok(next && x >= next[0] && x <= next[1], `${op} ${cur} ${r}: lost ${x}, got ${next}`);
      }
  assert.ok(narrowed > 1000, String(narrowed));
});

// ---------- the identities table ----------
const { IDENTITY_RULES } = await import('../../dist/typed/rules/identities.js');
const { IDENTITY_EVIDENCE } = await import('../../dist/typed/rules/evidence-identities.js');
const { verifyRule, ruleFingerprint } = await import('../../dist/typed/rules/verify.js');
const { rule, op, v, c } = await import('../../dist/typed/rules/form.js');
const { RULE_SETS, rulesListing } = await import('../../dist/typed/rules/listing.js');

test('identities: every rule has recorded evidence for its current form, it says sound, and a re-run agrees', () => {
  assert.equal(RULE_SETS.identities, IDENTITY_RULES);
  const others = new Set([...RULE_SETS.simplify.rules, ...RULE_SETS.fold.rules].map(r => r.name));
  for (const r of IDENTITY_RULES.rules) {
    assert.ok(!others.has(r.name), `${r.name} is not a name of another table`);
    const e = IDENTITY_EVIDENCE[r.name];
    assert.ok(e, `${r.name} has evidence`);
    assert.equal(e.fingerprint, ruleFingerprint(r), `${r.name} changed since it was verified: scripts/17`);
    assert.equal(e.verdict, 'sound', r.name);
    assert.ok(['proof', 'exhaustive'].includes(e.strength), `${r.name}: ${e.strength}`);
    assert.equal(verifyRule(r, { random: 2000 }).verdict, 'sound', r.name);
  }
  const text = rulesListing(IDENTITY_RULES);
  for (const line of text.split('\n')) assert.ok(line.length <= 72, line);
  assert.doesNotMatch(text, /none|stale|UNSOUND/);
});

test('the same shapes over a division are refused by the verifier: they are wrong for negative x', () => {
  const X = { x: 'i32' };
  const rem = rule('lt-rem16-8', X, op('lt', op('rem', v('x'), c(16)), c(8)), op('eqz', op('and', v('x'), c(8))));
  const div = rule('shl-div8-3', X, op('shl', op('div', v('x'), c(8)), c(3)), op('and', v('x'), c(-8)));
  for (const r of [rem, div]) {
    const e = verifyRule(r, { random: 20000, seed: 7 });
    assert.equal(e.verdict, 'unsound', r.name);
    assert.ok(e.counterexample.bindings.x < 0, r.name);
  }
});

test('identities after guards: a board index loses its division, then its shift pair and its comparison', async () => {
  const p = open(
    'board',
    `
function files(n: i32): i32 {
    let s = 0;
    for (let d = 0; d < 64; d = d + 1) {
        const square = d + (d / 8) * 8;
        if (square % 16 < 8) {
            s = s + square;
        }
        if (s > n) {
            break;
        }
    }
    return s;
}`,
    { files: { n: [0, 4000] } },
  );
  const { changed, text } = await run(p, ['cfg', 'simplify', 'guards', 'subst-mem', 'identities']);
  assert.ok(changed.includes('guards') && changed.includes('identities'), changed.join(' '));
  assert.match(text, /d & -8/, text);
  assert.doesNotMatch(text, /[/%]/, text);
});
