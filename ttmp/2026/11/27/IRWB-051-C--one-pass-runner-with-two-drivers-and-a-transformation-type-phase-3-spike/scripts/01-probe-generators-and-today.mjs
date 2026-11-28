#!/usr/bin/env node
// IRWB-051-C probe 01. (a) The generator features the design relies on, on this Node; (b) today's numbers: which
// Typed passes with needs change corpus programs when applied to r0, and milliseconds per application today.
//   node 01-probe-generators-and-today.mjs      (after npm run build)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);

// (a1) a throw into a generator suspended inside try runs its finally; a yield inside finally is reached
{
  const log = [];
  function* inner() {
    try {
      yield Promise.resolve(1);
      log.push('not reached');
    } finally {
      try {
        log.push('finally');
        yield 'cleanup';
      } finally {
        log.push('closed');
      }
    }
  }
  function* outer() {
    return yield* inner();
  }
  const g = outer();
  g.next();
  const s = g.throw(new Error('sync driver refuses a promise'));
  let thrown = null;
  try {
    g.throw(new Error('again'));
  } catch (e) {
    thrown = e.message;
  }
  console.log('(a1) throw through yield*:', JSON.stringify(log), '| cleanup yield seen:', s.value, '| rethrown:', thrown);
}
// (a2) cost of one yield round trip through yield* (what each effect of the runner costs)
{
  function* wait(x) {
    return yield x;
  }
  function* body(n) {
    let s = 0;
    for (let i = 0; i < n; i++) s += yield* wait(i);
    return s;
  }
  const drive = g => {
    let st = g.next();
    while (!st.done) st = g.next(st.value);
    return st.value;
  };
  drive(body(1e5));
  const t0 = performance.now();
  drive(body(1e6));
  console.log('(a2) one yield* round trip:', ((performance.now() - t0) / 1e6 * 1e6).toFixed(1), 'ns');
}

// (b) today
const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
const { projectSource } = await imp('dist/typed/project.js');
const { Program } = await imp('dist/typed/program.js');
const { PASSES } = await imp('dist/typed/passes.js');
const { applyPass, applyNativePassSync } = await imp('dist/framework/passes/index.js');
const { AnalysisManager } = await imp('dist/framework/contracts/index.js');
const T = await imp('dist/tensor/index.js');
const { inlinePass } = await imp('dist/tensor/passes.js');

const changed = {};
for (const id of projectIds()) {
  let p;
  try {
    p = Program.fromProject(projectSource(id, projectFiles(id)));
  } catch {
    continue;
  }
  for (const name of ['strength', 'licm', 'bce', 'copy-prop', 'dce']) {
    const pass = PASSES[name];
    if (!pass) continue;
    try {
      const r = await applyPass(pass, p.artifact(), { manager: new AnalysisManager() });
      if (r.changed) (changed[name] ??= []).push(id);
    } catch (e) {
      (changed[name + ' (error)'] ??= []).push(id + ': ' + String(e.message).slice(0, 60));
    }
  }
}
for (const [k, v] of Object.entries(changed)) console.log(`(b1) ${k} changes r0 of ${v.length}:`, v.join(', '));
for (const n of ['strength', 'licm', 'bce'])
  console.log(`(b1) ${n}: needs ${Object.keys(PASSES[n].needs)}, preserves ${PASSES[n].preserves.map(d => d.id)}`);

const p = T.compileTix(readFileSync(resolve(root, 'corpus/tensor/attention/main.tix'), 'utf8'));
for (let i = 0; i < 50; i++) applyNativePassSync(inlinePass, p.current, () => ({ ok: true }));
let t0 = performance.now();
for (let i = 0; i < 200; i++) applyNativePassSync(inlinePass, p.current, () => ({ ok: true }));
console.log('(b2) applyNativePassSync(inline, attention), trivial gate:', ((performance.now() - t0) / 200).toFixed(3), 'ms');
