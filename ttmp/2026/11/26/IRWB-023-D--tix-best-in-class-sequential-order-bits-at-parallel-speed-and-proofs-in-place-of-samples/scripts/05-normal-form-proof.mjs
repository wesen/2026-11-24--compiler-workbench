// Experiment 5: replace the sampled exact gate by a proof for all shapes and all inputs.
//
// Tix's exact meaning has no algebra to reason modulo: two functions whose result elements are the same tree
// of rounded operations over the same affine reads are bit-equal on every input. So "normalize and compare"
// is a sound equivalence check: inline every definition into the result (substituting affine addresses, with
// fresh reduction binders), rename binders canonically, serialize.
//   (a) inline pass on the six corpus programs: proved, and timed against the sampled gate
//   (b) a mutant the sampled gate accepts (it confuses two shape symbols that every sampled case sets equal)
//       is rejected by the proof; a concrete counterexample is shown
//   (c) split-sum: undo the declared reassociation (nested block/lane sum -> flat sum) and compare, which proves
//       "same terms, order changed only where declared"; the floor-rounding mutant is rejected structurally
//   (d) the reassociation budget as a theorem instead of a constant: |split - original| <= 2*gamma_(n-1)*sum|t|
import { readFileSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
const root = new URL('../../../../../../', import.meta.url);
const { compileTix, optimizeTix, runTix } = await import(new URL('dist/tensor/index.js', root));
const { meaningGate } = await import(new URL('dist/tensor/contract.js', root));
const { applyNativePassSync, definePass } = await import(new URL('dist/framework/passes/index.js', root));
const { adapter, TixIR } = await import(new URL('dist/tensor/ir.js', root));
const { substitute, add, variable, constant, mapExpr } = await import(new URL('dist/tensor/model.js', root));

// ---- normal form ----
function normalForm(fn) {
  const defs = new Map(fn.statements.map(s => [s.name, s]));
  let fresh = 0;
  // expression with index bindings applied; reductions get fresh binder ids
  function inst(e, bind) {
    switch (e.kind) {
      case 'literal': return { k: 'lit', w: Math.fround(Number(e.text)) }; // meaning rounds literals to f32
      case 'shape': return { k: 'shape', n: e.name };
      case 'op': return { k: 'op', op: e.op, a: e.args.map(x => inst(x, bind)) };
      case 'load': {
        const idx = e.indices.map(a => substitute(a, bind));
        const d = defs.get(e.name);
        if (!d) return { k: 'load', n: e.name, idx };
        return inst(d.expr, new Map(d.axes.map((ax, i) => [ax.id, idx[i]])));
      }
      case 'reduce': {
        const b2 = new Map(bind);
        const axes = e.axes.map(ax => {
          const id = '#' + fresh++;
          b2.set(ax.id, variable(id));
          const ext = ax.extent.kind === 'tail' ? { ...ax.extent, block: b2.get(ax.extent.block).terms[0][0] } : ax.extent;
          return { id, ext };
        });
        return { k: 'red', op: e.op, axes, body: inst(e.body, b2) };
      }
    }
  }
  const res = defs.get(fn.result);
  if (!res) return JSON.stringify({ param: fn.result });
  const tree = inst(res.expr, new Map(res.axes.map((ax, i) => [ax.id, variable('@' + i)])));
  // canonical binder names: order of first appearance in a preorder walk
  const names = new Map();
  const nm = id => id.startsWith('@') ? id : (names.has(id) || names.set(id, '$' + names.size), names.get(id));
  const aff = a => ({ c: a.constant, t: a.terms.map(([n, k]) => [nm(n), k]).sort() });
  // key order must not matter: passes build extents with different property orders
  const ext = x => [x.kind, x.dim.constant, x.dim.terms, x.rounding ?? null, x.block ? nm(x.block) : null];
  const canon = t => t.k === 'red'
    ? { k: 'red', op: t.op, axes: t.axes.map(a => ({ id: nm(a.id), ext: ext(a.ext) })), body: canon(t.body) }
    : t.k === 'op' ? { ...t, a: t.a.map(canon) } : t.k === 'load' ? { ...t, idx: t.idx.map(aff) } : t;
  return JSON.stringify({ params: fn.params, shape: res.shape, axes: res.axes.map(a => ext(a.extent)), tree: canon(tree) });
}
const proveExact = (a, b) => a.functions.length === b.functions.length && a.functions.every((f, i) => normalForm(f) === normalForm(b.functions[i]));

// undo the declared split: sum(block: blocks ceil) sum(lane: tail of block) body[W*block+lane] -> sum(k) body[k]
function unsplit(fn) {
  const rw = e => {
    if (e.kind !== 'reduce' || e.op !== 'sum' || e.axes.length !== 1 || e.axes[0].extent.kind !== 'blocks' || e.axes[0].extent.rounding !== 'ceil') return e;
    const inner = e.body, B = e.axes[0];
    if (inner.kind !== 'reduce' || inner.op !== 'sum' || inner.axes.length !== 1) return e;
    const L = inner.axes[0];
    if (L.extent.kind !== 'tail' || L.extent.block !== B.id || JSON.stringify(L.extent.dim) !== JSON.stringify(B.extent.dim)) return e;
    let ok = true;
    const coef = (a, n) => (a.terms.find(([x]) => x === n) ?? [n, 0])[1];
    const k = B.id.replace(/\/block$/, '') + '/flat';
    const body = mapExpr(inner.body, x => {
      if (x.kind === 'reduce' && x.axes.some(ax => ax.extent.kind === 'tail' && ax.extent.block === B.id)) ok = false;
      if (x.kind !== 'load') return x;
      return { ...x, indices: x.indices.map(a => {
        const cl = coef(a, L.id), cb = coef(a, B.id);
        if (cb !== 4 * cl) ok = false; // the address must depend on (block, lane) only through 4*block+lane
        return substitute(a, new Map([[L.id, variable(k)], [B.id, constant(0)]]));
      }) };
    });
    return ok ? { kind: 'reduce', op: 'sum', axes: [{ id: k, extent: { kind: 'dim', dim: B.extent.dim } }], body } : e;
  };
  return { ...fn, statements: fn.statements.map(s => ({ ...s, expr: mapExpr(s.expr, rw) })) };
}
const proveSplit = (orig, cand) => orig.functions.every((f, i) => normalForm(f) === normalForm(unsplit(cand.functions[i])));

// ---- (a) corpus ----
const corpusDir = new URL('corpus/tensor/', root);
const med = xs => xs.sort((a, b) => a - b)[xs.length >> 1];
const time = (f, reps = 15) => med(Array.from({ length: reps }, () => { const t = performance.now(); f(); return performance.now() - t; }));
console.log('program | inline changed IR | proof(inline) | proof ms | sampled gate ms | proof(split, unsplit) | proof(split) as exact (must be false if changed)');
const programs = {};
for (const name of readdirSync(corpusDir).sort()) {
  const p = compileTix(readFileSync(new URL(name + '/main.tix', corpusDir), 'utf8'));
  programs[name] = p;
  const inl = optimizeTix(p, ['inline']);
  const changed = inl.program.current.revision !== p.origin.revision;
  const proved = proveExact(p.origin.value, inl.program.current.value);
  const tProof = time(() => proveExact(p.origin.value, inl.program.current.value));
  const tGate = time(() => optimizeTix(p, ['inline']), 5);
  const sp = optimizeTix(p, ['split-sum']);
  const spChanged = sp.program.current.revision !== p.origin.revision;
  console.log(`${name} | ${changed} | ${proved} | ${tProof.toFixed(3)} | ${tGate.toFixed(1)} | ${proveSplit(p.origin.value, sp.program.current.value)} | ${proveExact(p.origin.value, sp.program.current.value)} (changed=${spChanged})`);
}

// ---- (b) mutant accepted by the sampled gate ----
function mutantPass(id, transform) {
  return definePass({ id, version: '1', description: id, ir: TixIR, adapter, writes: { entities: ['tensor'], relations: ['reads', 'contains'] },
    run: ({ before }) => ({ native: { functions: before.value.functions.map(transform) } }) });
}
// "Inline" for mlp that also shortens the first contraction from extent D to extent O.
const aliasMutant = mutantPass('mutant.alias-extent', fn => ({ ...fn, statements: fn.statements.map(s => ({ ...s,
  expr: mapExpr(s.expr, e => e.kind === 'reduce' && e.axes.length === 1 && JSON.stringify(e.axes[0].extent.dim) === JSON.stringify(variable('D'))
    ? { ...e, axes: [{ ...e.axes[0], extent: { kind: 'dim', dim: variable('O') } }] } : e) })) }));
{
  const p = programs.mlp;
  let accepted = true, cand;
  try { cand = applyNativePassSync(aliasMutant, p.current, meaningGate(p.origin, 'exact')).artifact; } catch (e) { accepted = false; console.log('gate rejected:', e.message); }
  const proof = cand ? proveExact(p.origin.value, cand.value) : null;
  // counterexample outside the sampled shapes: D=4, O=2
  const r = (() => { let a = 7; return () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1; })();
  const t = (...shape) => ({ shape, data: Float32Array.from({ length: shape.reduce((x, y) => x * y, 1) }, r) });
  const inputs = { x: t(2, 4), w: t(4, 3), bias: t(3), v: t(3, 2), outBias: t(2) };
  const want = runTix(p, 'mlp', inputs), got = cand ? runTix({ origin: p.origin, current: cand }, 'mlp', inputs) : want;
  console.log(JSON.stringify({ mutant: 'mlp: sum(d) over extent O instead of D', sampledGateAccepted: accepted, changedRevision: cand && cand.revision !== p.origin.revision,
    normalFormProofAccepts: proof, counterexample: { D: 4, O: 2, original: [...want.data], mutant: [...got.data] } }));
}
// ---- (c) split mutant: floor instead of ceil ----
{
  const p = programs.matmul;
  const sp = optimizeTix(p, ['split-sum']).program.current.value;
  const floorMutant = { functions: sp.functions.map(fn => ({ ...fn, statements: fn.statements.map(s => ({ ...s,
    expr: mapExpr(s.expr, e => e.kind === 'reduce' && e.axes[0].extent.kind === 'blocks' ? { ...e, axes: [{ ...e.axes[0], extent: { ...e.axes[0].extent, rounding: 'floor' } }] } : e) })) })) };
  const stride = { functions: sp.functions.map(fn => ({ ...fn, statements: fn.statements.map(s => ({ ...s,
    expr: mapExpr(s.expr, e => e.kind === 'load' && e.name === 'b' ? { ...e, indices: e.indices.map((a, i) => i === 0 ? { ...a, terms: a.terms.map(([n, k]) => [n, n.endsWith('/block') ? 3 : k]) } : a) } : e) })) })) };
  console.log(JSON.stringify({ splitProof: { genuine: proveSplit(p.origin.value, sp), floorMutant: proveSplit(p.origin.value, floorMutant), strideMutant: proveSplit(p.origin.value, stride) } }));
}
// ---- (d) the budget as a theorem ----
{
  const f = Math.fround, u = 2 ** -24;
  let worst = 0, viol = 0, trials = 0, worstFixed = 0;
  let a = 12345; const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const n of [7, 64, 1024, 65536])
    for (let t = 0; t < (n > 5000 ? 20 : 400); t++) {
      const scale = 2 ** Math.floor(rnd() * 40 - 20);
      const x = Float32Array.from({ length: n }, () => f((2 * rnd() - 1) * scale * (rnd() < 0.1 ? 1000 : 1)));
      let s = 0, abs = 0, sp = 0;
      for (let i = 0; i < n; i++) { s = f(s + x[i]); abs += Math.abs(x[i]); }
      for (let b = 0; b < n; b += 4) { let q = 0; for (let i = b; i < Math.min(n, b + 4); i++) q = f(q + x[i]); sp = f(sp + q); }
      const g = ((n - 1) * u) / (1 - (n - 1) * u), bound = 2 * g * abs;
      trials++; if (Math.abs(s - sp) > bound) viol++;
      worst = Math.max(worst, Math.abs(s - sp) / bound);
      worstFixed = Math.max(worstFixed, Math.abs(s - sp) / (2e-6 + 2e-5 * Math.abs(s)));
    }
  console.log(JSON.stringify({ budgetTheorem: { trials, violations: viol, worstObservedOverBound: worst, worstObservedOverFixedTolerance: worstFixed } }));
}
