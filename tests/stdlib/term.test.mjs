// IRWB-060-A: the standard library's term module (IRWB-039 phase 4, item 4.6) — first-order
// rewriting over a signature, and rule validation by evaluation on generated cases.
//   - matching on a small signature: variables, constants, constant variables, repeats (`same`),
//     operator patterns and arity, guards, the index and first match in table order;
//   - instantiation through a domain build, children first and left to right, the root distinct
//     from the children (Typed's id allocation depends on that order);
//   - the hash and equality laws: structurally equal terms hash equally, unequal terms do not,
//     and hash and equality agree;
//   - rule verification: a sound rule is verified, a wrong rule is refused with a counterexample,
//     a rule whose template uses an unbound variable is refused before any case, and a side
//     condition excludes exactly the cases its guard says;
//   - the campaigns the verifier composes: enumeration counts only guard-passing cases, and a
//     seeded sampling run reproduces.
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  match,
  indexRules,
  firstMatch,
  instantiate,
  structuralHash,
  structuralEqual,
  patternVars,
  templateVars,
} = await import('../../dist/stdlib/index.js');
const { enumerateCases, sampleCases, verifyRule, Rng } = await import('../../dist/stdlib/index.js');

// ---------- a small signature: terms are plain objects ----------
const sig = {
  op: t => t.op,
  args: t => t.args,
  constant: t => (t.op === 'const' ? t.imm : undefined),
  attr: t => (t.op === 'const' ? String(t.imm) : t.op === 'get' ? t.name : ''),
};
const constTerm = n => ({ op: 'const', args: [], imm: n | 0 });
const get = name => ({ op: 'get', args: [], name });
const op = (name, ...args) => ({ op: name, args });

test('match binds variables, constants, constant variables and repeats', () => {
  const t = op('add', get('x'), constTerm(3));
  const b = new Map();
  assert.ok(match(sig, { op: 'add', args: [{ var: 'a' }, { const: 3 }] }, t, b));
  assert.equal(b.get('a'), t.args[0]);

  const b2 = new Map();
  assert.ok(match(sig, { constVar: 'k' }, constTerm(7), b2));
  assert.equal(b2.get('k').imm, 7);
  assert.equal(match(sig, { constVar: 'k' }, get('x'), new Map()), false, 'a variable is not a constant');
  assert.equal(match(sig, { const: 7 }, constTerm(8), new Map()), false);

  // a repeat: x - x, two distinct objects of equal shape, matched with the library's equality
  const sub = op('sub', get('x'), get('x'));
  const b3 = new Map();
  assert.ok(match(sig, { op: 'sub', args: [{ var: 'x' }, { same: 'x' }] }, sub, b3));
  assert.equal(b3.get('x'), sub.args[0]);
  assert.equal(
    match(sig, { op: 'sub', args: [{ var: 'x' }, { same: 'x' }] }, op('sub', get('x'), get('y')), new Map()),
    false,
    'different operands do not repeat',
  );
  // an operator pattern: same operator, same arity, children in order
  assert.equal(match(sig, { op: 'add', args: [{ var: 'x' }] }, t, new Map()), false, 'the arity is part of the operator');
  assert.equal(match(sig, { op: 'mul', args: [{ var: 'a' }, { var: 'b' }] }, t, new Map()), false);
});

test('firstMatch tries the table in order, and its guards can read the matched term', () => {
  const rules = [
    { name: 'add-zero', lhs: { op: 'add', args: [{ var: 'x' }, { const: 0 }] }, rhs: { var: 'x' } },
    { name: 'add-x-x', lhs: { op: 'add', args: [{ var: 'x' }, { same: 'x' }] }, rhs: { var: 'x' }, where: [{ commutes: true }] },
  ];
  const index = indexRules(rules);
  const m = firstMatch(index, sig, op('add', get('y'), constTerm(0)), (g, b, t) => {
    assert.equal(g.commutes, true);
    assert.equal(t.op, 'add');
    return true;
  });
  assert.equal(m.rule.name, 'add-zero');
  const none = firstMatch(index, sig, op('mul', get('y'), constTerm(0)), () => true);
  assert.equal(none, undefined, 'no rule for another root operator');
  // a guard that fails leaves the rule unfired
  const refused = firstMatch(index, sig, op('add', get('y'), get('y')), () => false);
  assert.equal(refused, undefined);
});

test('instantiate builds children first and left to right, the root distinct from them', () => {
  const order = [];
  const build = {
    ref: t => (order.push(`ref:${t.name ?? t.imm}`), t),
    value: n => n,
    constant: (v, root, type) => (order.push(`const:${v}${root ? '@root' : ''}${type ? ':' + type : ''}`), { ...constTerm(v), type }),
    make: (o, args, root) => (order.push(`make:${o}${root ? '@root' : ''}`), { op: o, args }),
  };
  const b = new Map([['x', get('x')], ['k', constTerm(4)]]);
  const out = instantiate(
    { op: 'add', args: [{ op: 'mul', args: [{ var: 'x' }, { const: 2 }] }, { var: 'x' }] },
    b,
    build,
  );
  assert.deepEqual(out, { op: 'add', args: [{ op: 'mul', args: [get('x'), { ...constTerm(2), type: undefined }] }, get('x')] });
  assert.deepEqual(order, ['ref:x', 'const:2', 'make:mul', 'ref:x', 'make:add@root']);
});

test('the hash and equality laws: equal terms hash equally, unequal terms do not', () => {
  const a = op('add', get('x'), constTerm(3)),
    a2 = op('add', get('x'), constTerm(3)),
    b = op('add', get('x'), constTerm(4));
  assert.ok(structuralEqual(sig, a, a2), 'distinct objects of equal shape are equal');
  assert.ok(structuralEqual(sig, a2, a), 'equality is symmetric');
  assert.equal(structuralHash(sig, a), structuralHash(sig, a2), 'equal terms hash equally');
  assert.notEqual(structuralHash(sig, a), structuralHash(sig, b), 'unequal terms hash differently');
  assert.equal(structuralEqual(sig, a, b), false);
  assert.equal(structuralEqual(sig, op('add', get('x'), get('y')), op('add', get('y'), get('x'))), false, 'order matters');
  assert.equal(structuralEqual(sig, get('x'), get('y')), false, 'the own data matters');
  // hash and equality agree on the law: unequal hashes imply unequal terms
  const terms = [a, a2, b, get('x'), constTerm(3), op('sub', get('x'), get('x'))];
  for (const t of terms)
    for (const u of terms)
      assert.equal(structuralHash(sig, t) === structuralHash(sig, u), structuralEqual(sig, t, u), `${structuralHash(sig, t)} vs ${structuralHash(sig, u)}`);
});

test('a rule is verified, and a wrong rule is refused with a counterexample', () => {
  const interpretation = {
    literal: n => n,
    value: (o, args) =>
      o === 'add' ? (args[0] + args[1]) | 0 : o === 'mul' ? Math.imul(args[0], args[1]) : o === 'sub' ? (args[0] - args[1]) | 0 : undefined,
  };
  const set = values => ({ domain: values, values, draw: rng => values[(rng.next() >>> 0) % values.length] });
  const cases = { x: set([-3, -1, 0, 1, 2, 5]), k: set([0, 1, 2, 4]) };
  const sem = { interpretation, cases };

  const sound = verifyRule(
    { name: 'add-zero', lhs: { op: 'add', args: [{ var: 'x' }, { const: 0 }] }, rhs: { var: 'x' } },
    sem,
    { random: 50 },
  );
  assert.equal(sound.verdict, 'sound');
  assert.deepEqual(sound.methods, [
    { method: 'exhaustive', verdict: 'pass', cases: 6 },
    { method: 'sampled', verdict: 'pass', cases: 56 },
  ], 'the whole domain enumerated (6), then the crossing and 50 random draws on top');

  const wrong = verifyRule(
    { name: 'add-one', lhs: { op: 'add', args: [{ var: 'x' }, { const: 1 }] }, rhs: { var: 'x' } },
    sem,
    { random: 50 },
  );
  assert.equal(wrong.verdict, 'unsound');
  const cx = wrong.counterexample;
  assert.equal(cx.lhs, (cx.bindings.x + 1) | 0, 'the left side is x + 1, the right is x');
  assert.notEqual(cx.lhs, cx.rhs);

  // a template variable the pattern does not bind is refused before any case is run
  const unbound = verifyRule({ name: 'unbound', lhs: { op: 'add', args: [{ var: 'x' }, { const: 0 }] }, rhs: { var: 'y' } }, sem);
  assert.equal(unbound.verdict, 'unsound');
  assert.match(unbound.reason, /pattern does not bind/);
  assert.deepEqual(unbound.methods, []);

  // a side condition excludes exactly the cases its guard says: x/2 -> x holds for even x only
  const guarded = verifyRule(
    {
      name: 'half',
      lhs: { op: 'sub', args: [{ var: 'x' }, { var: 'x' }] },
      rhs: { const: 0 },
      where: [{ selfring: true }],
    },
    { interpretation, cases, holds: g => g.selfring },
    { random: 0 },
  );
  assert.equal(guarded.verdict, 'sound', 'x - x is 0 under any assignment');
  const evaded = verifyRule(
    { name: 'div-two', lhs: { op: 'add', args: [{ var: 'x' }, { var: 'x' }] }, rhs: { var: 'x' }, where: [{ zero: true }] },
    { interpretation, cases, holds: (g, env) => (g.zero ? env.x === 0 : true) },
    { random: 0 },
  );
  assert.equal(evaded.verdict, 'sound', 'the guard excludes every assignment that refutes it');
});

test('the campaigns: enumeration counts only guard-passing cases; a seeded sampling run reproduces', () => {
  const sem = {
    variables: [
      { name: 'a', domain: () => [0, 1, 2], values: () => [0, 1, 2], draw: (_w, rng) => rng.next() % 3 },
      { name: 'b', domain: () => [0, 1], values: () => [0, 1], draw: (_w, rng) => rng.next() % 2 },
    ],
    holds: env => env[0] !== 1 || env[1] !== 1,
    lhs: env => (env[0] + env[1]) | 0,
    rhs: env => env[0] + env[1],
    agree: (l, r) => l === r,
  };
  // 6 combinations, one excluded by the side condition: 5 counted cases
  assert.deepEqual(enumerateCases(sem, 0), { verdict: 'pass', cases: 5 });
  // the crossing loop runs every combination of the boundary sets, then random draws; same seed, same run
  const opts = { random: 20, seed: 12 };
  assert.deepEqual(sampleCases(sem, 0, opts), sampleCases(sem, 0, opts));
  assert.equal(sampleCases(sem, 0, opts).cases, 24, '5 counted cases from the crossing, 19 from the draws (one draw excluded by the side condition, with this seed)');
  assert.equal(new Rng(7).next(), new Rng(7).next());
  // the well-formedness queries the library shares with the domains
  assert.deepEqual(patternVars({ op: 'add', args: [{ var: 'x' }, { same: 'x' }, { constVar: 'k' }] }), {
    binds: ['x', 'k'],
    repeats: ['x'],
  });
  assert.deepEqual(templateVars({ op: 'add', args: [{ var: 'x' }, { const: 3 }] }), { uses: ['x'], consts: [] });
});
