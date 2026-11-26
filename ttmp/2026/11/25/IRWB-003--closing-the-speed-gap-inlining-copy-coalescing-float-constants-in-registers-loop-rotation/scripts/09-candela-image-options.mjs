// The general Candela program's images per case (tools/candela-image.mjs, with backend options): our image of r0,
// our images of a saved head with the default options and with the given options, and the reference compiler's
// kernel image. Each of our images is judged by the evaluator of the program it was lowered from; the kernel image
// by the evaluator of r0. Instructions are summed over the cases every image and evaluator finished.
//   node --max-old-space-size=12288 09-candela-image-options.mjs --head head.json
//        [--options '{"chains":true,"coalesce":true,"homes":true}'] [--count 100] [--json out.json] [--table out.tsv]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { readFileSync, writeFileSync } = await import('node:fs');
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor({ reference: true });
const { candelaInputs, candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter, storeOf } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact } = await import(root + 'dist/framework/ir/index.js');
const { casesFrom, evaluate, agrees } = await import(root + 'dist/typed/evaluate.js');
const { referenceCompile } = await import(root + 'dist/typed/reference.js');
const B = await import(root + 'dist/typed/backend/index.js');
const args = process.argv.slice(2);
const flag = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const count = +flag('--count', 100),
  seed = 7,
  limit = 2e5,
  imageLimit = 100 * limit;
const options = JSON.parse(flag('--options', '{"chains":true,"coalesce":true,"homes":true}'));
const log = (...xs) => process.stderr.write(xs.join(' ') + '\n');
const ms = t => Math.round(performance.now() - t);
const source = candelaSource();
const st0 = ingest('candela', source, { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st0.toNative());
const head = createIRArtifact(blocksAdapter, 'candela', JSON.parse(readFileSync(flag('--head'), 'utf8')));
const programs = { r0: { art: r0, st: storeOf(r0.value) }, head: { art: head, st: storeOf(head.value) } };
log('head', `r${head.value.rev}`, Object.keys(head.value.stmts).length, 'statements');
const images = [];
for (const [key, prog, o] of [
  ['r0', 'r0', {}],
  ['head', 'head', {}],
  ['options', 'head', options],
]) {
  const t = performance.now();
  images.push({ key, program: prog, value: B.compileImage(programs[prog].art, o) });
  log('image', key, images.at(-1).value.bytes, 'bytes', ms(t), 'ms');
}
{
  const ref = referenceCompile(source, { maxSourceLength: MAX_SOURCE, policy: 'kernel' });
  images.push({ key: 'kernel', program: 'r0', value: B.imageFromCode('candela-kernel', ref.image, ref.entries, ref.signatures) });
  log('image kernel', images.at(-1).value.bytes, 'bytes');
}
const inputs = candelaInputs(st0);
const keys = images.map(i => i.key);
const zero = () => Object.fromEntries(keys.map(k => [k, 0]));
const rows = [];
const t0 = performance.now();
for (const fn of st0.fns.keys()) {
  const f = st0.fn(fn);
  const sig = { params: f.params, result: f.result, ...(f.results ? { results: f.results } : {}) };
  const row = { fn, cases: 0, decided: 0, agree: zero(), disagree: zero(), inconclusive: zero(), insns: zero(), examples: [] };
  for (const c of casesFrom(st0, fn, { count, seed, inputs: inputs[fn] ?? {} })) {
    row.cases++;
    const meaning = Object.fromEntries(
      Object.entries(programs).map(([k, p]) => [k, p.st.fns.has(fn) ? evaluate(p.st, fn, c.args, c.memory, { limit }) : null]),
    );
    const runs = images.map(i => B.runImage(i.value, fn, c.args, c.memory, { limit: imageLimit, counts: false, sig }));
    images.forEach((img, k) => {
      const expected = meaning[img.program],
        got = runs[k];
      if (!expected || expected.limit || got.limit) return void row.inconclusive[img.key]++;
      if (agrees(expected, { ...got, counts: null })) row.agree[img.key]++;
      else {
        row.disagree[img.key]++;
        if (row.examples.length < 3) row.examples.push({ image: img.key, n: c.n });
      }
    });
    if (Object.values(meaning).some(r => !r || r.limit) || runs.some(r => r.limit)) continue;
    row.decided++;
    images.forEach((img, k) => (row.insns[img.key] += runs[k].steps));
  }
  rows.push(row);
  if (rows.length % 50 === 0) log(rows.length, 'functions', ms(t0), 'ms');
}
const sum = pick => rows.reduce((n, r) => n + pick(r), 0);
const total = {
  options,
  functions: rows.length,
  cases: sum(r => r.cases),
  decided: sum(r => r.decided),
  bytes: Object.fromEntries(images.map(i => [i.key, i.value.bytes])),
  agree: Object.fromEntries(keys.map(k => [k, sum(r => r.agree[k])])),
  disagree: Object.fromEntries(keys.map(k => [k, sum(r => r.disagree[k])])),
  inconclusive: Object.fromEntries(keys.map(k => [k, sum(r => r.inconclusive[k])])),
  insns: Object.fromEntries(keys.map(k => [k, sum(r => r.insns[k])])),
  perCase: Object.fromEntries(keys.map(k => [k, +(sum(r => r.insns[k]) / Math.max(1, sum(r => r.decided))).toFixed(1)])),
  ms: ms(t0),
};
for (const r of rows) r.perCase = Object.fromEntries(keys.map(k => [k, r.decided ? +(r.insns[k] / r.decided).toFixed(1) : null]));
if (flag('--json')) writeFileSync(flag('--json'), JSON.stringify({ total, rows }, null, 1));
if (flag('--table')) {
  const headLine = ['fn', 'decided', ...keys.map(k => `bytes.${k}`), ...keys.map(k => `perCase.${k}`)];
  const fnBytes = (img, fn) => img.value.fns[fn]?.bytes ?? null;
  const line = r => [r.fn, r.decided, ...images.map(i => fnBytes(i, r.fn)), ...keys.map(k => r.perCase[k])].join('\t');
  writeFileSync(flag('--table'), [headLine.join('\t'), ...rows.map(line)].join('\n') + '\n');
}
for (const r of rows.filter(r => Object.values(r.disagree).some(Boolean))) console.log(r.fn, JSON.stringify({ disagree: r.disagree, examples: r.examples }));
console.log(JSON.stringify(total));
