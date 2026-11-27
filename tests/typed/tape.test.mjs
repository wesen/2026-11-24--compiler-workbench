// IRWB-001 P4.2 (inventory step 2): lifting from the front end's tape. Candela lifts whole; the Compiler Workbench
// corpus lifted from the tape gives the tables the inspection path gives, except where the Wasm encoding expands a
// tape pseudo-op (a checked address), and there the two mean the same.
import { expectation } from './corpus-expectations.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles, projectIds } from '../../tools/corpus.mjs';
import { candelaSource, MAX_SOURCE } from '../../tools/candela.mjs';

await installVendor();
const { ingest, frontEndTape, inferLocalTypes, LiftError } = await import('../../dist/typed/lift.js');
const { blocksAdapter, validateBlocks, rebuildBlocks } = await import('../../dist/typed/ir.js');
const { Store } = await import('../../dist/typed/model.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { meaningKept } = await import('../../dist/typed/evaluate.js');
const { createIRArtifact, project } = await import('../../dist/framework/ir/index.js');
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');
const { canonical } = await import('../../dist/framework/core/data.js');

const source = candelaSource();
const count = (v, k) => Object.keys(v[k]).length;
// the raw tape knows parameters' names only: compare temporaries by type class, ops without positions
const withoutSpans = v => ({
  ...v,
  ops: Object.fromEntries(Object.entries(v.ops).map(([k, o]) => [k, { ...o, at: null }])),
  fns: Object.fromEntries(
    Object.entries(v.fns).map(([k, f]) => [
      k,
      { ...f, locals: f.locals.map(l => (l.param ? { ...l, at: null } : { index: l.index, type: l.type === 'f32' ? 'f32' : 'i32' })) },
    ]),
  ),
});

test('P4.2: the inspection path cannot lift Candela; its Wasm encoding has operations the tape does not', () => {
  assert.throws(() => ingest('candela', source, { maxSourceLength: MAX_SOURCE }), e => e instanceof LiftError && /unknown tape opcode 151/.test(e.message));
  assert.throws(() => ingest('candela', source, { tape: true }), /input limit exceeded/);
});

test('P4.2: all 332 Candela functions lift from the tape, with spans and raw; the tables validate and round-trip', () => {
  const spans = ingest('candela', source, { tape: true, maxSourceLength: MAX_SOURCE }).toNative();
  const raw = ingest('candela', source, { tape: true, spans: false, maxSourceLength: MAX_SOURCE }).toNative();
  for (const v of [spans, raw]) validateBlocks(v);
  assert.equal(count(spans, 'fns'), 332);
  assert.deepEqual(
    ['blocks', 'stmts', 'values', 'ops'].map(k => count(spans, k)),
    ['blocks', 'stmts', 'values', 'ops'].map(k => count(raw, k)),
  );
  assert.ok(Object.values(raw.ops).every(o => o.at === null));
  assert.ok(Object.values(spans.ops).filter(o => o.at).length > 40000);
  assert.equal(canonical(withoutSpans(raw)), canonical(withoutSpans(spans)));
  assert.equal(canonical(Store.from(spans).toNative()), canonical(spans), 'Store round trip');
  assert.equal(canonical(rebuildBlocks(spans, project(blocksAdapter, spans))), canonical(spans), 'projection round trip');
  // every operation of the inventory's gap table is lifted
  const ops = new Set(Object.values(spans.values).map(v => v.op));
  for (const op of ['fadd', 'fmul', 'fmax', 'fmin', 'fsqrt', 'fneg', 'fabs', 'fcopysign', 'ffloor', 'flt', 'fne', 'f2i', 'f2u', 'i2f', 'u2f', 'f2bits', 'bits2f', 'caddr', 'aaddr', 'result', 'tuple'])
    assert.ok(ops.has(op), op);
  assert.equal(Object.values(spans.stmts).filter(s => s.op === 'zero').length, 2);
});

test('P4.2: local types inferred from the tape agree with the front end\'s localTypes', () => {
  const raw = [];
  globalThis.typedWasm.compileFunctions(source, 0, [], MAX_SOURCE, undefined, fn => raw.push({ ...fn, code: Array.from(fn.code) }));
  const fe = frontEndTape(source, { maxSourceLength: MAX_SOURCE, spans: false });
  let f32s = 0;
  fe.fns.forEach((f, i) => {
    const types = inferLocalTypes(f, fe.info.signatures);
    const declared = raw[i].localTypes ?? [];
    for (let k = f.params.length; k < f.localCount; k++) {
      assert.equal(types[k], declared[k - f.params.length] ?? 'i32', `${f.name} local ${k}`);
      if (types[k] === 'f32') f32s++;
    }
  });
  assert.ok(f32s > 1000, `${f32s} f32 locals`);
});

test('P4.2: the corpus lifted from the tape gives the inspection path\'s tables, or the same meaning where a checked address differs', async () => {
  const manager = new AnalysisManager();
  for (const id of projectIds()) {
    const expected = expectation(id);
    const p = projectSource(id, projectFiles(id));
    let wasm;
    try {
      wasm = ingest(p.name, p.source).toNative();
    } catch (e) {
      if (e instanceof LiftError) { assert.equal(expected.tape, 'skipped', id); continue; }
      throw e;
    }
    const tape = ingest(p.name, p.source, { tape: true }).toNative();
    const raw = ingest(p.name, p.source, { tape: true, spans: false }).toNative();
    assert.equal(canonical(withoutSpans(raw)), canonical(withoutSpans(tape)), `${id}: raw tape`);
    const noBytes = v => ({ ...v, frontEnd: { ...v.frontEnd, wasmBytes: 0 } });
    if (!Object.values(tape.ops).some(o => o.op.startsWith('text.') || o.op.startsWith('array.'))) {
      assert.equal(canonical(noBytes(tape)), canonical(noBytes(wasm)), `${id}: identical, source positions included`);
      assert.equal(expected.tape, 'identical', id);
      continue;
    }
    // a checked address is one value caddr(receiver, position) on the tape; the Wasm encoding expands it into a
    // capacity load, a branch to an unreachable block, and receiver + (position << 1)
    assert.ok(Object.values(tape.values).some(v => v.op === 'caddr'), id);
    assert.ok(!Object.values(wasm.values).some(v => v.op === 'caddr'), id);
    const ev = (
      await manager.checkInvariant(meaningKept({ inputs: p.meta.inputs, count: 40 }), {
        origin: createIRArtifact(blocksAdapter, p.name, wasm),
        candidate: createIRArtifact(blocksAdapter, p.name, tape),
      })
    ).evidence;
    assert.equal(ev.disagree, 0, `${id}: ${JSON.stringify(ev.counterexamples)}`);
    assert.equal(expected.tape, 'checked', id);
  }
});
