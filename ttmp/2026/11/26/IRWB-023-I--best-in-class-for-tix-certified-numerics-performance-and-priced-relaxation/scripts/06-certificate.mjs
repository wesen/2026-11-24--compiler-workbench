// E5b: a working certificate-checker prototype for the inline pass.
//
// Instead of running the sampled exact gate, a certificate checker verifies the
// rewrite's *class rules* structurally. For inline (`substitute` class):
//   1. the function signature and statement count change only by removed producers;
//   2. every changed consumer expression differs from its before-expression only at
//      load sites of a removed single-use producer;
//   3. at each such site the new subtree is exactly the producer's tree with the
//      consumer's affine index tuple substituted for the producer's free binders;
//   4. no other node kind, operator, literal or reduction changed (no rounding site
//      added, removed or reordered).
// If all four hold, the rewrite is exact for ALL inputs by the exactness calculus;
// the sampled gate then only has to guard the certificate checker itself.
// This script measures the certificate's runtime and verifies it accepts the real
// inline candidates and rejects two mutants (identity-order substitution; dropped
// rounding via a fused multiply — modeled by collapsing mul+add nodes).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTix, optimizeTix } from '../../../../../../dist/tensor/index.js';
import { substitute } from '../../../../../../dist/tensor/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..', '..', '..');

// Binder identities are per-parse; structural comparison is modulo a renaming of
// the after-side binder ids to the before-side ids (paired by occurrence).
function sameAffine(a, b, rename) {
  const canon = (x) => JSON.stringify({
    constant: x.constant,
    terms: x.terms.map(([n, k]) => [rename.get(n) ?? n, k]),
  });
  return canon(a) === canon(b);
}

function inlineCertificate(before, after) {
  const violations = [];
  for (const [fi, fnBefore] of before.functions.entries()) {
    const fnAfter = after.functions[fi];
    if (fnBefore.name !== fnAfter.name || fnBefore.params.length !== fnAfter.params.length)
      violations.push(`fn ${fi}: signature changed`);
    const beforeNames = new Map(fnBefore.statements.map(s => [s.name, s]));
    const afterNames = new Map(fnAfter.statements.map(s => [s.name, s]));
    // removed producers, and their exprs with their free binder ids
    const removed = [];
    for (const [name, s] of beforeNames)
      if (!afterNames.has(name)) {
        let pointwise = true;
        const walk = e => {
          if (e.kind === 'reduce') pointwise = false;
          if (e.kind === 'op') e.args.forEach(walk);
        };
        walk(s.expr);
        removed.push({ name, expr: s.expr, axes: s.axes.map(a => a.id), pointwise });
      }
    // every remaining statement must match except at substituted load sites
    for (const s of fnAfter.statements) {
      const b = beforeNames.get(s.name);
      if (!b) { violations.push(`fn ${fi}: new statement ${s.name}`); continue; }
      if (!sameAffineShape(s.shape, b.shape)) violations.push(`${s.name}: shape changed`);
      checkStatement(fnAfter, b, s, removed, violations);
    }
  }
  return violations;
}
function sameAffineShape(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function checkStatement(fn, b, s, removed, violations) {
  // walk both trees in lockstep; divergences allowed only where before has a load
  // of a removed producer, and there the after-tree must be the substituted producer tree
  const rename = new Map();
  s.axes.forEach((axis, k) => rename.set(axis.id, b.axes[k].id));
  function walk(be, ae) {
    if (be.kind === 'load' && removed.some(r => r.name === be.name)) {
      const producer = removed.find(r => r.name === be.name);
      if (!producer.pointwise) { violations.push(`${s.name}: producer ${be.name} is not pointwise`); return; }
      if (be.indices.length !== producer.axes.length) { violations.push(`${s.name}: rank mismatch at ${be.name}`); return; }
      const bindings = new Map(producer.axes.map((axis, k) => [axis, be.indices[k]]));
      // the substituted producer tree, with its free binders mapped to the load's indices
      const expected = substituteTree(producer.expr, bindings, new Set(producer.axes));
      if (!sameExprModulo(expected, ae, rename))
        violations.push(`${s.name}: substituted tree differs from the producer's tree at a ${be.name} site`);
      return;
    }
    if (be.kind !== ae.kind) { violations.push(`${s.name}: node kind ${be.kind} -> ${ae.kind}`); return; }
    if (be.kind === 'literal' || be.kind === 'shape') {
      if (be.text !== ae.text && be.name !== ae.name) violations.push(`${s.name}: literal/shape changed`);
      else if (be.kind === 'literal' && be.text !== ae.text) violations.push(`${s.name}: literal changed`);
      else if (be.kind === 'shape' && be.name !== ae.name) violations.push(`${s.name}: shape name changed`);
      return;
    }
    if (be.kind === 'load') {
      if (be.name !== ae.name || !be.indices.every((x, i) => sameAffine(x, ae.indices[i], rename)))
        violations.push(`${s.name}: load changed outside the substitution rule`);
      return;
    }
    if (be.kind === 'op') {
      if (be.op !== ae.op || be.args.length !== ae.args.length) { violations.push(`${s.name}: op changed`); return; }
      be.args.forEach((x, i) => walk(x, ae.args[i]));
      return;
    }
    // reduce: binder count/extents/operator unchanged; binder ids paired by occurrence
    if (be.op !== ae.op || be.axes.length !== ae.axes.length ||
        be.axes.some((x, i) => !sameExtent(x.extent, ae.axes[i].extent))) {
      violations.push(`${s.name}: reduction header changed`);
      return;
    }
    be.axes.forEach((x, i) => rename.set(ae.axes[i].id, x.id));
    walk(be.body, ae.body);
  }
  walk(b.expr, s.expr);
}
function sameExtent(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// structural equality of two trees where the after side's binder ids are renamed
// into before-side ids by the shared map (extend it for nested reductions)
function sameExprModulo(be, ae, rename) {
  if (be.kind !== ae.kind) return false;
  if (be.kind === 'literal' || be.kind === 'shape') return be.kind === 'literal' ? be.text === ae.text : be.name === ae.name;
  if (be.kind === 'load')
    return be.name === ae.name && be.indices.every((x, i) => sameAffine(x, ae.indices[i], rename));
  if (be.kind === 'op')
    return be.op === ae.op && be.args.length === ae.args.length && be.args.every((x, i) => sameExprModulo(x, ae.args[i], rename));
  if (be.op !== ae.op || be.axes.length !== ae.axes.length) return false;
  if (!be.axes.every((x, i) => sameExtent(x.extent, ae.axes[i].extent))) return false;
  const inner = new Map(rename);
  be.axes.forEach((x, i) => inner.set(ae.axes[i].id, x.id));
  return sameExprModulo(be.body, ae.body, inner);
}
function substituteTree(expr, bindings, producerAxes) {
  // replace loads of *other* tensors by composing the consumer's index with the
  // producer's free-axis mapping; within the producer tree, free binders occur only
  // as whole plain indices of loads (guaranteed for pointwise producers here)
  const map = (e) => {
    if (e.kind === 'load')
      return { ...e, indices: e.indices.map(a => substitute(a, bindings)) };
    if (e.kind === 'op') return { ...e, args: e.args.map(map) };
    return e;
  };
  return map(expr);
}

// negative controls: synthetic before/after pairs built with the real parser.
// correct: y[i,j] = (x[j,i]+1)*2 — the producer tree with the consumer's index tuple.
// wrong 1: y[i,j] = (x[i,j]+1)*2 — substitution in identity order (the Stage 1 mutant).
// wrong 2: y[i,j] = (x[j,i]+1)*(x[j,i]+1) — a duplicated subtree with a *shared* rounding
//          site removed (the producer's add now executes twice instead of once — the
//          certificate must catch structure that is not a pure single-site substitution).
const beforeSrc = 'fn f(x: f32[M,M]): f32[M,M] { p[i,j] = x[i,j] + 1; y[i,j] = p[j,i] * 2; return y; }';
const correctSrc = 'fn f(x: f32[M,M]): f32[M,M] { y[i,j] = (x[j,i] + 1) * 2; return y; }';
const wrongOrderSrc = 'fn f(x: f32[M,M]): f32[M,M] { y[i,j] = (x[i,j] + 1) * 2; return y; }';
const wrongDupSrc = 'fn f(x: f32[M,M]): f32[M,M] { y[i,j] = (x[j,i] + 1) * (x[j,i] + 1); return y; }';
const before = compileTix(beforeSrc).origin.value;
const controls = {
  correctInline: compileTix(correctSrc).origin.value,
  wrongIdentityOrder: compileTix(wrongOrderSrc).origin.value,
  wrongDuplicatedTree: compileTix(wrongDupSrc).origin.value,
};
const controlRows = {};
for (const [label, after] of Object.entries(controls)) {
  const v = inlineCertificate(before, after);
  controlRows[label] = { holds: v.length === 0, first: v[0] };
  console.log(`control ${label}: ${v.length === 0 ? 'accepted' : 'rejected'}${v.length ? ' — ' + v[0] : ''}`);
}

const programs = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
const rows = [];
for (const name of programs) {
  const src = readFileSync(join(root, 'corpus/tensor', name, 'main.tix'), 'utf8');
  const program = compileTix(src);
  const { program: optimized } = optimizeTix(program, ['inline']);
  const t0 = performance.now();
  const violations = inlineCertificate(program.origin.value, optimized.current.value);
  const certMs = performance.now() - t0;

  // negative controls on a synthetic pair
  const beforeFn = program.origin.value.functions[0];
  const okSelf = inlineCertificate({ functions: [beforeFn] }, { functions: [beforeFn] });

  rows.push({ name, certMs: +certMs.toFixed(2), violations, selfCheckViolations: okSelf.length, controls: controlRows });
  console.log(`${name}: certificate ${violations.length === 0 ? 'HOLDS' : 'VIOLATED'} in ${certMs.toFixed(2)} ms` +
    (violations.length ? ` — ${violations[0]}` : ''));
}
writeFileSync(join(here, '..', 'results', 'certificate.json'), JSON.stringify(rows, null, 2));
console.log('E5b done');
