import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, runTix, optimizeTix } from '../../dist/tensor/index.js';
import { optimizeWith } from '../../dist/tensor/optimize.js';
import { mapChildren } from '../../dist/tensor/model.js';
import { inline, splitSum } from '../../dist/tensor/passes.js';
import { definePass } from '../../dist/framework/passes/index.js';

const arg = (shape, values) => ({ shape, data: Float32Array.from(values) });
const step = (body, relation) => ({ pass: body.id, body, relation });
const sumSource = 'fn f(x:f32[1,D]):f32[1]{ y[i]=sum(d) x[i,d]; return y; }';
const inlineSource = 'fn f(x:f32[N]):f32[N]{ t[i]=x[i]+1; y[i]=t[i]*2; return y; }';
const words = t => new Uint32Array(t.data.buffer);

function mutant(pass, fn, writes = pass.writes) {
  return definePass({
    ...pass,
    id: `${pass.id}.wrong`,
    writes,
    run(ctx) {
      const { native, correspondence } = pass.run(ctx);
      const rewrite = e => fn(mapChildren(e, rewrite));
      return {
        correspondence,
        native: {
          functions: native.functions.map(f => ({
            ...f,
            statements: f.statements.map(s => ({ ...s, expr: rewrite(s.expr) })),
          })),
        },
      };
    },
  });
}

test('actual length-8 split changes f32 words, fails exact, and passes tolerance', () => {
  const p = compileTix(sumSource);
  const inputs = { x: arg([1, 8], [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24, 2 ** -24]) };
  const exact = optimizeWith(p, [step(splitSum, 'exact')]);
  assert.equal(exact.program, p);
  assert.equal(exact.steps[0].accepted, false);
  assert.match(exact.steps[0].check.reason, /contractRejected/);
  assert.ok(
    exact.steps[0].check.evidence.counterexamples.some(
      ({ case: c, reason }) =>
        c.pattern === 'small-addends' && c.shapes[0][1] === 8 && /0x3f800000.*0x3f800002/.test(reason),
    ),
  );
  const q = optimizeTix(p, ['split-sum', 'split-sum']);
  assert.deepEqual(q.steps, [
    { pass: 'split-sum', accepted: true },
    { pass: 'split-sum', accepted: true },
  ]);
  assert.notEqual(q.program.revision, p.revision);
  assert.equal(q.program.value.functions[0].statements[0].expr.op, 'blockedSum');
  assert.equal(words(runTix(p, 'f', inputs))[0], 0x3f800000);
  assert.equal(words(runTix(q.program, 'f', inputs))[0], 0x3f800002);
  assert.equal(runTix(q.program, 'f', inputs).data[0], runTix(p, 'f', inputs, { precision: 'f64' }).data[0]);
  assert.equal(runTix(q.program, 'f', { x: arg([1, 5], [1, 1, 1, 1, 1]) }).data[0], 5);
  assert.equal(runTix(q.program, 'f', { x: arg([1, 0], []) }).data[0], 0);
});

test('composing affine coordinates inlines a slice with repeated and constant coordinates', () => {
  const p = compileTix(`fn f(x:f32[N,N,2]):f32[N-1]{
    t[i,j,k] = x[i,j,k] * 2;
    y[i]:f32[N-1] = t[i+1,i+1,1];
    return y;
  }`);
  const { program: q, steps } = optimizeTix(p, ['inline']);
  const inputs = {
    x: arg(
      [3, 3, 2],
      Array.from({ length: 18 }, (_, i) => i),
    ),
  };
  assert.deepEqual(steps, [{ pass: 'inline', accepted: true }]);
  assert.deepEqual(
    q.value.functions[0].statements.map(s => s.name),
    ['y'],
  );
  assert.deepEqual(runTix(q, 'f', inputs).data, Float32Array.of(18, 34));
  assert.deepEqual(words(runTix(q, 'f', inputs)), words(runTix(p, 'f', inputs)));
});

test('inline composes the producer affines, preserves IEEE signed zero and leaves multiple uses alone', () => {
  const p = compileTix(`fn f(x:f32[N]):f32[N-2]{
    a[i]:f32[N-1] = x[i+1];
    b[i]:f32[N-2] = a[i+1];
    y[i] = b[i]; return y;
  }
  fn twice(x:f32[N]):f32[N]{ a[i]=x[i]*2; y[i]=a[i]+a[i]; return y; }`);
  const { program: q } = optimizeTix(p, ['inline']);
  assert.equal(q.value.functions[0].statements.length, 1);
  assert.equal(q.value.functions[1].statements.length, 2);
  const inputs = { x: arg([4], [8, 7, -0, 1]) };
  assert.deepEqual(runTix(q, 'f', inputs).data, Float32Array.of(-0, 1));
});

test('inline leaves a producer in place if the composed bounds exceed the static proof subset', () => {
  const p =
    compileTix(`fn f(x:f32[N], m:f32[M], k:f32[K], a:f32[N-M], b:f32[M-K], c:f32[K-L], d:f32[L]):f32[L]{
    t[i]:f32[M] = x[i+0]; y[i]:f32[L] = t[i+0]; return y;
  }`);
  const q = optimizeTix(p, ['inline']);
  assert.equal(q.program, p);
  assert.deepEqual(q.steps, [{ pass: 'inline', accepted: true }]);
});

test('both incorrect rewrites are rejected by meaning and the pipeline keeps the last accepted revision', () => {
  const badInline = mutant(inline, e => (e.op === '+' ? { ...e, op: '-' } : e));
  const a = compileTix(inlineSource);
  const wrong = optimizeWith(a, [step(badInline, 'exact'), step(inline, 'exact')]);
  assert.deepEqual(
    wrong.steps.map(s => s.accepted),
    [false, true],
  );
  assert.match(wrong.steps[0].check.reason, /contractRejected/);
  assert.ok(wrong.steps[0].check.evidence.disagree > 0);
  assert.equal(wrong.program.revision, optimizeTix(a, ['inline']).program.revision);

  const badSplit = mutant(
    splitSum,
    e => {
      if (e.op !== 'blockedSum') return e;
      const copy = ex => {
        const id = `${ex.id}:second`;
        if (ex.op === 'blockedSum')
          return { ...ex, id, axis: { ...ex.axis, id: `${ex.axis.id}:second` }, body: copy(ex.body) };
        if (ex.op === 'load')
          return {
            ...ex,
            id,
            subs: ex.subs.map(s => ({
              ...s,
              terms: s.terms.map(([k, n]) => [k.includes(':r') ? `${k}:second` : k, n]),
            })),
          };
        return mapChildren({ ...ex, id }, copy);
      };
      return { op: '+', id: `${e.id}:twice`, at: e.at, left: e, right: copy(e) };
    },
    { entities: ['expr.*', 'axis'], relations: ['contains', 'reads', 'binds'] },
  );
  const b = compileTix(sumSource.replace('[1,D]', '[1,5]'));
  const rejected = optimizeWith(b, [step(badSplit, 'tolerance'), step(splitSum, 'tolerance')]);
  assert.deepEqual(
    rejected.steps.map(s => s.accepted),
    [false, true],
  );
  assert.match(rejected.steps[0].check.reason, /contractRejected/);
  assert.ok(
    rejected.steps[0].check.evidence.counterexamples.some(c => /expected finite 5.*got 10/.test(c.reason)),
  );
  assert.equal(rejected.program.revision, optimizeTix(b, ['split-sum']).program.revision);
});

test('inline after reassociation uses the immediate f32 input; tolerance across calls still uses compiled f64', () => {
  const p = compileTix(`fn f(x:f32[1,D]):f32[1]{
    s[i] = (sum(d) x[i,d]); a[i] = s[i]; y[i] = a[i] + 0; return y;
  }`);
  const first = optimizeTix(p, ['split-sum']);
  const next = optimizeTix(first.program, ['inline']);
  assert.deepEqual(next.steps, [{ pass: 'inline', accepted: true }]);
  assert.deepEqual(
    next.program.value.functions[0].statements.map(s => s.name),
    ['s', 'y'],
  );
  const witness = { x: arg([1, 8], [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24, 2 ** -24]) };
  assert.equal(words(runTix(next.program, 'f', witness))[0], 0x3f800002);

  const z = compileTix('fn f(x:f32[N]):f32[N]{ y[i]=x[i]*0; return y; }');
  const offset = definePass({
    ...inline,
    id: 'tensor.test-offset',
    run({ before }) {
      const [f] = before.value.functions,
        [s] = f.statements;
      const expr = {
        op: '+',
        id: `${s.expr.id}:add`,
        at: s.at,
        left: s.expr,
        right: { op: 'literal', id: `${s.expr.id}:epsilon`, at: s.at, text: '0.000006' },
      };
      return { native: { functions: [{ ...f, statements: [{ ...s, expr }] }] } };
    },
  });
  const x = optimizeWith(z, [step(offset, 'tolerance')]);
  assert.equal(x.steps[0].accepted, true);
  const y = optimizeWith(x.program, [step(offset, 'tolerance')]);
  assert.equal(y.steps[0].accepted, false, '6e-6 twice exceeds the original reference budget');
  assert.equal(y.program, x.program);
});

test('an uncovered function prevents contract acceptance even when another function was checked', () => {
  const p = compileTix(`${inlineSource} fn big(x:f32[8193]): f32[8193]{ return x; }`);
  const r = optimizeWith(p, [step(inline, 'exact')]);
  assert.equal(r.program, p);
  const e = r.steps[0].check.evidence;
  assert.ok(e.agree > 0 && e.disagree === 1);
  assert.match(e.counterexamples[0].reason, /no admitted case for 'big'/);
});
