// Candela through the f32 backend: our images of r0 and of the O2 head against the evaluator (the oracle), against
// the reference compiler's images (typed-rv32.js; the second oracle), and their sizes and instruction counts beside
// the reference's policies.
//   node tools/candela-image.mjs [--count N] [--seed S] [--limit statements] [--head head.json]
//                                [--policies stock,kernel] [--only fn,fn] [--json out.json] [--invariant]
// --head: an O2 head saved by `tools/candela-o2.mjs --save`; without it only r0 is compiled.
// --limit: the evaluator's step limit (default 2e5 statements); every image gets 100 instructions per statement.
// --invariant: also run rv32.image-agrees (backend/run.ts imageAgrees) on r0 and the head, as the framework checks it.
// Per function and case: the evaluator of the program each image was lowered from decides; a reference image is
// compared with the evaluator of r0, and our images are compared with the stock image. Instructions per case are
// averaged over the cases that every image and evaluator finished within its limit (traps included).
import { readFileSync, writeFileSync } from 'node:fs';
import { installVendor } from './node-vendor.mjs';
import { candelaInputs, candelaSource, MAX_SOURCE } from './candela.mjs';

await installVendor({ reference: true });
const { ingest } = await import('../dist/typed/lift.js');
const { blocksAdapter, storeOf } = await import('../dist/typed/ir.js');
const { createIRArtifact } = await import('../dist/framework/ir/index.js');
const { AnalysisManager } = await import('../dist/framework/contracts/index.js');
const { casesFrom, evaluate, agrees } = await import('../dist/typed/evaluate.js');
const { referenceCompile } = await import('../dist/typed/reference.js');
const B = await import('../dist/typed/backend/index.js');

const args = process.argv.slice(2);
const flag = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const count = +flag('--count', 100), seed = +flag('--seed', 7), limit = +flag('--limit', 2e5);
const headFile = flag('--head', null), out = flag('--json', null);
const policies = flag('--policies', 'stock,kernel').split(',').filter(Boolean);
const only = flag('--only', '').split(',').filter(Boolean);
const imageLimit = 100 * limit;
const log = (...xs) => process.stderr.write(xs.join(' ') + '\n');
const ms = t => Math.round(performance.now() - t);

let t = performance.now();
const source = candelaSource();
const st0 = ingest('candela', source, { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st0.toNative());
log('r0', ms(t), 'ms');
const programs = [{ key: 'r0', art: r0, st: storeOf(r0.value) }];
if (headFile) {
  t = performance.now();
  const head = createIRArtifact(blocksAdapter, 'candela', JSON.parse(readFileSync(headFile, 'utf8')));
  programs.push({ key: 'o2', art: head, st: storeOf(head.value) });
  log('head', `r${head.value.rev}`, Object.keys(head.value.stmts).length, 'statements', ms(t), 'ms');
}
// our images
const images = [];
for (const p of programs) {
  t = performance.now();
  const value = B.compileImage(p.art);
  const art = createIRArtifact(B.imageAdapter, `img:candela@${p.key}`, value);
  images.push({ key: p.key, ours: true, program: p, art, value });
  log('image', p.key, value.bytes, 'bytes', ms(t), 'ms');
}
// the reference compiler's images, from the source (the r0 meaning)
for (const policy of policies) {
  t = performance.now();
  const ref = referenceCompile(source, { maxSourceLength: MAX_SOURCE, policy });
  if ((ref.relocations ?? []).length) throw new Error(`${policy}: the reference image has relocations`);
  const value = B.imageFromCode(`candela-${policy}`, ref.image, ref.entries, ref.signatures);
  images.push({ key: policy, ours: false, program: programs[0], art: null, value });
  log('reference', policy, value.bytes, 'bytes', ms(t), 'ms');
}
const stock = images.find(i => i.key === 'stock');

const inputs = candelaInputs(st0);
const names = only.length ? only : [...st0.fns.keys()];
const rows = [];
t = performance.now();
for (const fn of names) {
  const sig = (() => {
    const f = st0.fn(fn);
    return { params: f.params, result: f.result, ...(f.results ? { results: f.results } : {}) };
  })();
  const row = {
    fn,
    cases: 0,
    decided: 0,
    values: 0,
    traps: 0,
    bytes: Object.fromEntries(images.map(i => [i.key, i.value.fns[fn]?.bytes ?? null])),
    agree: Object.fromEntries(images.map(i => [i.key, 0])),
    disagree: Object.fromEntries(images.map(i => [i.key, 0])),
    inconclusive: Object.fromEntries(images.map(i => [i.key, 0])),
    vsStock: Object.fromEntries(images.filter(i => i.ours).map(i => [i.key, 0])),
    insns: Object.fromEntries(images.map(i => [i.key, 0])),
    examples: [],
  };
  for (const c of casesFrom(st0, fn, { count, seed, inputs: inputs[fn] ?? {} })) {
    row.cases++;
    const meaning = new Map(programs.map(p => [p.key, evaluate(p.st, fn, c.args, c.memory, { limit })]));
    const runs = images.map(i => B.runImage(i.value, fn, c.args, c.memory, { limit: imageLimit, counts: false, sig }));
    images.forEach((img, k) => {
      const expected = meaning.get(img.program.key), got = runs[k];
      if (expected.limit || got.limit) return void row.inconclusive[img.key]++;
      if (agrees(expected, { ...got, counts: null })) row.agree[img.key]++;
      else {
        row.disagree[img.key]++;
        if (row.examples.length < 3)
          row.examples.push({ image: img.key, n: c.n, expected: expected.trap || expected.result, got: got.fault ? `fault: ${got.trap}` : got.trap || got.result });
      }
    });
    if (stock) {
      const s = runs[images.indexOf(stock)];
      images.forEach((img, k) => {
        if (!img.ours || s.limit || runs[k].limit) return;
        if (!agrees(s, { ...runs[k], counts: null })) row.vsStock[img.key]++;
      });
    }
    const decided = [...meaning.values()].every(r => !r.limit) && runs.every(r => !r.limit);
    if (!decided) continue;
    row.decided++;
    if (meaning.get('r0').trap) row.traps++;
    else row.values++;
    images.forEach((img, k) => (row.insns[img.key] += runs[k].steps));
  }
  rows.push(row);
  if (rows.length % 50 === 0) log(rows.length, 'functions', ms(t), 'ms');
}
const sum = (pick) => rows.reduce((n, r) => n + pick(r), 0);
const keys = images.map(i => i.key);
const total = {
  functions: rows.length,
  cases: sum(r => r.cases),
  decided: sum(r => r.decided),
  values: sum(r => r.values),
  traps: sum(r => r.traps),
  bytes: Object.fromEntries(images.map(i => [i.key, i.value.bytes])),
  agree: Object.fromEntries(keys.map(k => [k, sum(r => r.agree[k])])),
  disagree: Object.fromEntries(keys.map(k => [k, sum(r => r.disagree[k])])),
  inconclusive: Object.fromEntries(keys.map(k => [k, sum(r => r.inconclusive[k])])),
  vsStock: stock ? Object.fromEntries(images.filter(i => i.ours).map(i => [i.key, sum(r => r.vsStock[i.key])])) : null,
  // instructions over all decided cases, and per decided case
  insns: Object.fromEntries(keys.map(k => [k, sum(r => r.insns[k])])),
  perCase: Object.fromEntries(keys.map(k => [k, +(sum(r => r.insns[k]) / Math.max(1, sum(r => r.decided))).toFixed(1)])),
  ms: ms(t),
};
for (const r of rows) r.perCase = Object.fromEntries(keys.map(k => [k, r.decided ? +(r.insns[k] / r.decided).toFixed(1) : null]));
let invariant = null;
if (args.includes('--invariant')) {
  const m = new AnalysisManager();
  invariant = {};
  for (const img of images.filter(i => i.ours)) {
    t = performance.now();
    const ev = await m.checkInvariant(B.imageAgrees({ count, seed, inputs, limit, imageLimit }), { program: img.program.art, image: img.art });
    const e = ev.evidence;
    invariant[img.key] = { ok: ev.ok, total: e.total, agree: e.agree, disagree: e.disagree, inconclusive: e.inconclusive, counterexamples: e.counterexamples, ms: ms(t) };
    log('rv32.image-agrees', img.key, JSON.stringify(invariant[img.key]));
  }
}
const result = { count, seed, limit, imageLimit, total, invariant, rows };
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
for (const r of rows.filter(r => Object.values(r.disagree).some(Boolean) || Object.values(r.vsStock).some(Boolean)))
  console.log(r.fn, JSON.stringify({ disagree: r.disagree, vsStock: r.vsStock, examples: r.examples }));
console.log(JSON.stringify(total));
if (invariant) console.log(JSON.stringify(invariant));
