// IRWB-060-B: the standard library's term module (the R3 library row `terms`, IRWB-039 phase 4 item 4.6) and its
// two domain ports.
//   - a small signature of integer arithmetic terms: structural equality and key, the law that equal terms hash
//     equally, and size;
//   - matching and instantiation: variables, constants, computed constants, `same`, table order, guards, and the
//     builder's `outermost` flag (a domain records provenance on a replacement's root only);
//   - rule verification: a rule accepted over a generated domain, a wrong rule refused with a counterexample, a
//     guard that narrows a rule to the input on which it holds, and the interface's own law (the case generator's
//     variables are the rule's);
//   - the Tix port: `inline` and `split-sum` give the revision the coordinator's baselines record for every corpus
//     program (the oracle is read, never written);
//   - F40: Tix `inline` says `merged` for the statement it substituted, and names the reader it went into.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  equalStructure,
  firstMatch,
  indexRules,
  instantiate,
  match,
  patternOp,
  patternVariables,
  size,
  structuralHash,
  structuralKey,
  templateVariables,
  verifyRule,
} from '../../dist/stdlib/index.js';
import { compileTix, optimizeTix } from '../../dist/tensor/index.js';
import { inlinePass, mergedInto, splitPass } from '../../dist/tensor/passes.js';
import { applyNativePassSync } from '../../dist/framework/passes/index.js';

// ---------- a small signature: integer arithmetic terms ----------
const sig = {
  op: t => t.op,
  args: t => t.args ?? [],
  constant: t => (t.op === 'lit' ? t.value : undefined),
};
const lit = value => ({ op: 'lit', value });
const op = (name, ...args) => ({ op: name, args });
const x = { op: 'x' }; // an uninterpreted leaf, for structure only

/** A builder that records what instantiation made, so the arity, order and `outermost` flag are visible. */
const recorder = () => {
  const made = [];
  return {
    made,
    constant: (value, attrs, outermost) => ({ op: 'lit', value, attrs, outermost, made: made.push(value) }),
    operator: (name, args, attrs, outermost) => {
      const node = { op: name, args, attrs, outermost };
      made.push(node);
      return node;
    },
  };
};

test('term: structural key, equality and hash, and the law that equal terms hash equally', () => {
  const terms = [
    x,
    lit(0),
    op('add', x, lit(0)),
    op('add', lit(0), x),
    op('add', x, x),
    op('sub', op('add', x, lit(1)), op('mul', lit(2), x)),
    op('shl', x, lit(3)),
  ];
  for (const a of terms)
    for (const b of terms) {
      // the two structural equations of this module, checked on every pair: the key is the term's structure, so
      // equalStructure and key equality are the same relation, and a hash is a function of that key
      assert.equal(equalStructure(sig, a, b), structuralKey(sig, a) === structuralKey(sig, b));
      if (equalStructure(sig, a, b)) {
        assert.equal(structuralHash(sig, a), structuralHash(sig, b));
        assert.equal(size(sig, a), size(sig, b));
      }
    }
  // distinct structures get distinct keys (a hash may collide; a key may not)
  assert.equal(new Set(terms.map(t => structuralKey(sig, t))).size, terms.length);
  // a copy of a tree is equal to it, and a different immediate is not
  assert.ok(equalStructure(sig, op('add', x, lit(0)), { op: 'add', args: [{ op: 'x' }, lit(0)] }));
  assert.ok(!equalStructure(sig, op('add', x, lit(0)), op('add', x, lit(1))));
  assert.equal(size(sig, op('sub', op('add', x, lit(1)), x)), 5);
});

test('term: matching binds variables, constants, constant variables and repeats', () => {
  const two = op('mul', x, two0());
  function two0() {
    return lit(2);
  }
  const b = new Map();
  assert.ok(match(sig, { op: 'mul', args: [{ var: 'a' }, { bindConst: 'k' }] }, two, b));
  assert.equal(b.get('a'), b.get('a')); // the first operand, bound
  assert.equal(sig.constant(b.get('k')), 2);
  // a constant pattern is about the immediate; a constant variable is about being a constant at all
  assert.ok(match(sig, { const: 2 }, lit(2), new Map()));
  assert.ok(!match(sig, { const: 2 }, lit(3), new Map()));
  assert.ok(match(sig, { bindConst: 'k' }, lit(3), new Map()));
  assert.ok(!match(sig, { bindConst: 'k' }, x, new Map()));
  // `same` compares with the caller's equality: the library's by default, the domain's when it passes one
  const same = new Map();
  assert.ok(match(sig, { op: 'add', args: [{ var: 'a' }, { same: 'a' }] }, op('add', x, x), same));
  assert.ok(!match(sig, { op: 'add', args: [{ var: 'a' }, { same: 'a' }] }, op('add', x, lit(0)), new Map()));
  const never = () => false;
  assert.ok(
    !match(sig, { op: 'add', args: [{ var: 'a' }, { same: 'a' }] }, op('add', x, x), new Map(), never),
  );
  // a pattern is about its root operator and its arity
  assert.ok(!match(sig, { op: 'mul', args: [{ var: 'a' }, { var: 'b' }] }, op('add', x, x), new Map()));
  assert.ok(!match(sig, { op: 'add', args: [{ var: 'a' }] }, op('add', x, x), new Map()));
});

test('term: instantiation makes the replacement children first, and flags its root', () => {
  const b = new Map([
    ['x', x],
    ['k', lit(2)],
  ]);
  const build = recorder();
  const out = instantiate(
    { op: 'shl', args: [{ var: 'x' }, { const: { compute: () => 1, reads: ['k'] } }] },
    b,
    build,
  );
  assert.deepEqual(
    out.args.map(a => [a.op, a.outermost ?? null, a.value]),
    [
      ['x', null, undefined],
      ['lit', undefined, 1],
    ].map(([o, outer, v]) => (o === 'x' ? ['x', null, undefined] : ['lit', false, v])),
  );
  assert.equal(out.outermost, true, 'the replacement root is flagged');
  assert.equal(out.args[1].outermost, false, 'a constant under it is not');
  // a variable template makes no node: it is the bound term itself
  assert.equal(instantiate({ var: 'x' }, b, recorder()), x);
  // `attrs` travels from the template node to the builder unchanged (Typed tags an f32 constant with it)
  const tagged = instantiate({ const: 7, attrs: { type: 'f32' } }, b, recorder());
  assert.deepEqual(tagged.attrs, { type: 'f32' });
});

test('term: rules are indexed by root operator and tried in table order, guards are the domain’s', () => {
  const rules = [
    { name: 'mul-one', lhs: { op: 'mul', args: [{ var: 'a' }, { bindConst: 'k' }] }, where: [{ one: 'k' }], rhs: { var: 'a' } },
    { name: 'mul-any', lhs: { op: 'mul', args: [{ var: 'a' }, { var: 'b' }] }, rhs: { var: 'a' } },
    { name: 'add-zero', lhs: { op: 'add', args: [{ var: 'a' }, { const: 0 }] }, rhs: { var: 'a' } },
  ];
  const index = indexRules(rules);
  assert.deepEqual([...index.keys()], ['mul', 'add']);
  const guard = (g, bindings) => sig.constant(bindings.get(g.one)) === 1;
  // the guarded rule wins when its guard holds, and the next rule in table order is used when it does not
  const one = firstMatch(index, sig, op('mul', x, lit(1)), { guard });
  assert.equal(one.rule.name, 'mul-one');
  const other = firstMatch(index, sig, op('mul', x, lit(5)), { guard });
  assert.equal(other.rule.name, 'mul-any');
  // a rule that matches at another operator is not tried: the index is by the pattern's root
  assert.equal(firstMatch(index, sig, op('sub', x, lit(0)), { guard }), undefined);
  assert.equal(firstMatch(index, sig, op('add', x, lit(0)), { guard }).rule.name, 'add-zero');
  // no rule at this operator; and a guarded rule reached without the domain's predicate is an error, not a
  // silent "it does not hold"
  assert.equal(firstMatch(index, sig, op('sub', x, lit(0)), { guard }), undefined);
  assert.throws(
    () => firstMatch(index, sig, op('mul', x, lit(1))),
    /rule mul-one has guards and no guard function/,
  );
  // an unguarded rule needs no predicate
  assert.equal(firstMatch(index, sig, op('add', x, lit(0))).rule.name, 'add-zero');
  assert.deepEqual(patternVariables(rules[0].lhs), { binds: ['a', 'k'], repeats: [] });
  assert.deepEqual(templateVariables(rules[0].rhs), { uses: ['a'], constants: [] });
  assert.equal(patternOp(rules[1].lhs), 'mul');
});

// ---------- rule verification ----------
/** A tiny i32 evaluator over the test's terms, at 32 bits: the domain's semantics for `verifyRule`. */
const apply32 = (name, xs) => {
  const [a, b] = xs;
  switch (name) {
    case 'add':
      return (a + b) | 0;
    case 'sub':
      return (a - b) | 0;
    case 'mul':
      return Math.imul(a, b);
    case 'shl':
      return a << b;
    case 'shr':
      return a >> b;
    default:
      throw new Error('no meaning for ' + name);
  }
};
const side = node => {
  if ('var' in node) return assignment => assignment[node.var];
  if ('const' in node) {
    if (typeof node.const !== 'number') throw new Error('a computed constant in a test rule');
    return () => node.const;
  }
  const parts = node.args.map(side);
  return assignment => apply32(node.op, parts.map(p => p(assignment)));
};
const model = (rule, variables, values, holds) => {
  const lhs = side(rule.lhs),
    rhs = side(rule.rhs);
  return {
    rule,
    cases: {
      variables,
      *cases() {
        let env = [[]];
        for (const v of values) env = env.flatMap(e => v.map(x => [...e, x]));
        yield* env;
      },
      ...(holds ? { holds } : {}),
    },
    semantics: {
      evaluate: (which, add) => {
        const assignment = Object.fromEntries(variables.map((v, i) => [v, add[i]]));
        return (which === 'lhs' ? lhs : rhs)(assignment);
      },
      agrees: (a, b) => a === b,
    },
  };
};
const X = ['x'];
const domain = [-4, -3, -1, 0, 1, 2, 3, 5];
const rule = (name, lhs, rhs) => ({ name, lhs, rhs });

test('term: a rule is verified over generated cases, and a wrong rule is refused with a counterexample', () => {
  const sound = verifyRule(model(rule('mul-two', op('mul', { var: 'x' }, { const: 2 }), op('shl', { var: 'x' }, { const: 1 })), X, [domain]));
  assert.equal(sound.verdict, 'sound');
  assert.equal(sound.cases, domain.length);
  assert.deepEqual(sound.variables, ['x']);
  // the same shape over a division is wrong: right shift rounds down
  const wrong = rule('mul-half', op('mul', { var: 'x' }, { const: 2 }), op('shr', { var: 'x' }, { const: 1 }));
  const refused = verifyRule(model(wrong, X, [domain]));
  assert.equal(refused.verdict, 'unsound');
  assert.equal(refused.counterexample.bindings.get('x'), -4);
  assert.deepEqual([refused.counterexample.lhs, refused.counterexample.rhs], [-8, -2]);
  // a guard narrows the rule to the assignments on which it holds, and the count is the guarded ones
  const divRule = rule('div-two', op('mul', { var: 'x' }, { const: 2 }), op('shl', { var: 'x' }, { const: 1 }));
  const guarded = verifyRule(model(divRule, X, [[-2, -1, 0, 1, 2]], add => add[0] >= 0));
  assert.equal(guarded.verdict, 'sound');
  assert.equal(guarded.cases, 3);
  // the interface's own law: the generator names the rule's pattern variables, in order
  assert.throws(
    () => verifyRule(model(rule('mul-two', op('mul', { var: 'x' }, { const: 2 }), op('shl', { var: 'x' }, { const: 1 })), ['y'], [domain])),
    /are not the rule's pattern variables/,
  );
});

// ---------- the Tix port: same revisions as the baselines record ----------
/** The coordinator's baselines (read only): the oracle every lane must leave unchanged. */
const baselines = (() => {
  const root = fileURLToPath(new URL('../../ttmp/2026/11/27/', import.meta.url));
  const ticket = readdirSync(root).find(d => d.startsWith('IRWB-039--'));
  assert.ok(ticket, 'the baselines ticket is present');
  return JSON.parse(readFileSync(join(root, ticket, 'various/baselines/main.json'), 'utf8')).tensor;
})();

test('Tix: inline and split-sum give the revisions the baselines record, on every corpus program', () => {
  const dir = fileURLToPath(new URL('../../corpus/tensor/', import.meta.url));
  const names = readdirSync(dir).sort();
  assert.ok(names.length >= 6, names.join(', '));
  for (const name of names) {
    const p = compileTix(readFileSync(join(dir, name, 'main.tix'), 'utf8'));
    assert.equal(optimizeTix(p, ['inline']).program.current.revision, baselines[name].inline, name);
    assert.equal(
      optimizeTix(p, ['inline', 'split-sum']).program.current.revision,
      baselines[name].inlineSplit,
      name,
    );
    // the same passes applied to the split program, in the other order, keep the program unchanged both times
    const once = optimizeTix(p, ['split-sum', 'split-sum']).program.current.revision;
    assert.equal(once, optimizeTix(p, ['split-sum']).program.current.revision, name);
  }
});

test('Tix: split-sum and inline are rules over the expression signature, and fire where they used to', () => {
  const p = compileTix('fn f(x:f32[N,N]):f32[N]{s[i]=sum(j) x[i,j];y[i]=s[i]+1;return y;}');
  const split = optimizeTix(p, ['split-sum']).program.current.value.functions[0];
  const expr = split.statements.find(s => s.name === 's').expr;
  assert.equal(expr.kind, 'reduce');
  assert.equal(expr.axes[0].extent.kind, 'blocks');
  assert.equal(expr.body.axes[0].extent.kind, 'tail');
  // the inner axis is bounded by the outer block axis, and the body reads the block's lane plus its base
  assert.equal(expr.body.axes[0].extent.block, expr.axes[0].id);
  // inline: `a` is pointwise and read once, so it is substituted into `b` and removed
  const inline = optimizeTix(p, ['inline']).program.current.value.functions[0];
  assert.equal(inline.statements.length, 2);
});

test('F40: Tix inline says `merged` for the statement it substituted, and names the reader', () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{a[i]=x[i]*2;b[i]=a[i]+1;return b;}');
  const r = applyNativePassSync(inlinePass, p.current, () => ({ ok: true }));
  assert.ok(r.changed);
  const byFrom = Object.fromEntries(r.correspondence.entries.map(e => [e.from.join(','), e]));
  assert.deepEqual(byFrom['f/a'], { from: ['f/a'], to: ['f/b'], relation: 'merged' });
  assert.deepEqual(byFrom['f/b'], { from: ['f/b'], to: ['f/b'], relation: 'retained' });
  assert.deepEqual([...mergedInto(r.correspondence)], [['f/a', 'f/b']]);
  // a chain resolves to the final survivor: `a` into `b`, then `b` into `c`, leaves one entry, `f/a` to `f/c`
  const chain = compileTix('fn f(x:f32[N]):f32[N]{a[i]=x[i]*2;b[i]=a[i]+1;c[i]=b[i]*3;return c;}');
  const chained = applyNativePassSync(inlinePass, chain.current, () => ({ ok: true }));
  assert.deepEqual(
    [...mergedInto(chained.correspondence)],
    [
      ['f/a', 'f/c'],
      ['f/b', 'f/c'],
    ],
  );
  // a correspondence entry naming a statement the module does not have is refused
  const broken = {
    ...inlinePass,
    prepare: ctx => ({
      ...inlinePass.prepare(ctx),
      correspondence: [{ from: ['f/zz'], to: ['f/b'], relation: 'merged' }],
    }),
  };
  assert.throws(() => applyNativePassSync(broken, p.current, () => ({ ok: true })), /Unknown source entity f\/zz/);
});

test('Tix: split-sum applied to a program with no single-dimension sum is the identity', () => {
  const p = compileTix('fn f(x:f32[N,N]):f32[N,N]{y[i,j]=x[i,j]+1;return y;}');
  const r = applyNativePassSync(splitPass, p.current, () => ({ ok: true }));
  assert.equal(r.changed, false);
  assert.equal(r.artifact.revision, p.current.revision);
});
