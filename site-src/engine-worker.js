// engine-worker.js (IRWB-004 F4): the Candela view's engines in a Web Worker, so that compiling the reference image,
// lifting Candela, building the sky table and rendering (a stride-1 row is one engine call of up to a second) never
// hold the page. tools/build-site.mjs bundles this file with esbuild and puts the vendored scripts it needs in
// front of the bundle, each checked against vendor/ds-js-os/VENDOR.json at build time.
//
// Messages from the page, answered with { id, ok, ... } or { id, error }:
//   { type: 'init', data }                          the Candela data (sources, scene table) the page loaded
//   { type: 'render', id, engine, scene, stride, passes, program?, parts? }
//        engine: kernel | stock | r0 | head | own; for head and own, `program` names the revision by its parts
//        (src/typed/parts.ts) and `parts` carries those this worker does not have. Progress arrives as
//        { id, progress, frame } about every 100 ms; the reply carries the finished frame.
//   { type: 'stop', id }                            stop the render `id` after the current engine call
//   { type: 'lift', id }                            lift Candela and make its r0 artifact here; replies with the
//                                                   revision, its PartsRef and every part text (for the page)
import { setVendor } from '../src/typed/vendor.ts';
import {
  parseSceneTable,
  candelaSource,
  candelaHost,
  referenceEngine,
  evaluatorEngine,
  imageEngine,
  liftCandela,
  renderProgressive,
} from '../src/workbench/candela.ts';
import { createIRArtifact } from '../src/framework/ir/adapters.ts';
import { blocksAdapter, storeOf } from '../src/typed/ir.ts';
import { assembleParts, missingParts, parsePart, partHash, partsOf, partsRef } from '../src/typed/parts.ts';

setVendor({
  typedTape: self.typedTape,
  typedWasm: self.typedWasm,
  typedRv32Interp: self.typedRv32Interp,
  typedRv32: self.typedRv32,
});

let candela = null; // { source, scenes }
let r0Store = null; // the lifted r0, for the 'r0' engine
let r0Artifact = null;
const parts = new Map(); // hash -> PartRecords
const artifacts = new Map(); // revision -> Artifact, the programs the page named (few)
const renders = new Map(); // id -> signal

function artifactOf(ref) {
  let a = artifacts.get(ref.revision);
  if (a) return a;
  const value = assembleParts(ref, h => parts.get(h));
  a = createIRArtifact(blocksAdapter, 'candela', value);
  // the parts and the two program-wide records rebuild the value exactly, or the revision says otherwise
  if (a.revision !== ref.revision) throw new Error(`rebuilt ${ref.revision.slice(0, 12)} as ${a.revision.slice(0, 12)}`);
  artifacts.set(ref.revision, a);
  while (artifacts.size > 3) artifacts.delete(artifacts.keys().next().value);
  return a;
}

function engineFor(m) {
  if (m.engine === 'kernel' || m.engine === 'stock') return referenceEngine(candela.source, m.engine);
  if (m.engine === 'r0') {
    const t0 = performance.now(),
      fresh = !r0Store;
    r0Store ??= liftCandela(candela.source);
    const e = evaluatorEngine(r0Store, 'evaluator · r0 (lifted)');
    return { ...e, setupMs: fresh ? performance.now() - t0 : 0 };
  }
  for (const [h, text] of m.parts ?? []) if (!parts.has(h)) parts.set(h, parsePart(text));
  const t0 = performance.now();
  // 'own' without a project: this compiler's image of r0, lifted here
  const art = m.program ? artifactOf(m.program) : (lift(), r0Artifact);
  const made = performance.now() - t0;
  if (m.engine === 'head') {
    const e = evaluatorEngine(storeOf(art.value), m.label);
    return { ...e, setupMs: made };
  }
  if (m.engine === 'own') {
    const e = imageEngine(art, m.label);
    return { ...e, setupMs: e.setupMs + made };
  }
  throw new Error(`unknown engine ${m.engine}`);
}

const snapshot = f => ({
  ...f,
  frame0: f.frame0.slice(),
  acc: f.acc.slice(),
  count: f.count.slice(),
});

async function render(m) {
  const scene = candela.scenes.find(s => s.id === m.scene);
  if (!scene) throw new Error(`no scene ${m.scene}`);
  const eng = engineFor(m);
  const signal = { aborted: false };
  renders.set(m.id, signal);
  self.postMessage({ id: m.id, engine: { label: eng.label, unit: eng.unit, setupMs: eng.setupMs } });
  let sent = 0;
  try {
    const frame = await renderProgressive(candelaHost(eng), scene, {
      stride: m.stride,
      passes: m.passes,
      signal,
      onProgress: p => {
        const now = performance.now();
        if (now - sent < 100 && p.phase === 'rows') return;
        sent = now;
        self.postMessage({ id: m.id, progress: { phase: p.phase, pass: p.pass, passes: p.passes, row: p.row, rows: p.rows }, frame: snapshot(p.frame) });
      },
    });
    return { frame: snapshot(frame) };
  } finally {
    renders.delete(m.id);
  }
}

function lift() {
  const t0 = performance.now();
  r0Store ??= liftCandela(candela.source);
  const liftMs = performance.now() - t0;
  r0Artifact ??= createIRArtifact(blocksAdapter, 'candela', r0Store.toNative());
  const artifactMs = performance.now() - t0 - liftMs;
  artifacts.set(r0Artifact.revision, r0Artifact);
  const ref = partsRef(r0Artifact.revision, r0Artifact.value, true);
  for (const p of partsOf(r0Artifact.value).values()) parts.set(partHash(p), [p.fn, p.blocks, p.stmts, p.values, p.ops]);
  return { ref, parts: missingParts(r0Artifact.value, new Set()), liftMs, artifactMs };
}

self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'stop') {
    const s = renders.get(m.id);
    if (s) s.aborted = true;
    return;
  }
  try {
    let out;
    if (m.type === 'init') {
      candela = { source: candelaSource(m.data), scenes: parseSceneTable(m.data.scenes) };
      out = { scenes: candela.scenes.length };
    } else if (!candela) throw new Error('the engine worker has no Candela data yet');
    else if (m.type === 'render') out = await render(m);
    else if (m.type === 'lift') out = lift();
    else throw new Error(`unknown message ${m.type}`);
    self.postMessage({ id: m.id, ok: true, ...out });
  } catch (err) {
    self.postMessage({ id: m.id, error: err && err.message ? err.message : String(err) });
  }
};
