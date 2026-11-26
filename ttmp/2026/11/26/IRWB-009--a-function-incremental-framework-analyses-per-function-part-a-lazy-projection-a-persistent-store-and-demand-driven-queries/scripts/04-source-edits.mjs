// IRWB-009: what a small edit to Candela's source text does to its function parts.
//
// The workbench's other kind of edit is the user changing source. Each edit below is applied to the source string in
// memory (the corpus files are not touched), the whole program is ingested again from the tape, as the workbench
// does, and its parts are compared with r0's:
//   partsChanged       functions whose part hash (partText: fn, blocks, stmts, values, ops) differs
//   codeChanged        functions whose "code hash" differs: the part without its ops and without source positions
//                      (`at` of the function's locals); what the evaluator and the analyses read
//   closureKeys        functions whose closure key (IRWB-004, from part hashes) differs
//   codeClosureKeys    the same closure computed from code hashes
// Edits: a same-length constant change in a scene material, in a leaf with 78 transitive callers, and in tracePath;
// a blank line inserted (every later line moves); a comment appended to a line (every later offset moves).
//
//   systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 \
//     node --max-old-space-size=10240 …/04-source-edits.mjs > …/various/04-source-edits.json
import { createHash } from 'node:crypto';
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { immutable, canonical, revisionOf } = await import(root + 'dist/framework/core/data.js');
const { partsOf, partHash, closureKey, calleesOf, closureOf } = await import(root + 'dist/typed/parts.js');

const sha = s => createHash('sha256').update(s).digest('hex');
const ms = t => Math.round(performance.now() - t);
const lift = source => {
  const t = performance.now();
  const v = immutable(ingest('candela', source, { tape: true, maxSourceLength: MAX_SOURCE }).toNative());
  return { v, ms: ms(t) };
};
const CODE = new WeakMap();
const codeHash = p => {
  let h = CODE.get(p);
  if (h === undefined) {
    const { locals, ...fn } = p.fn;
    CODE.set(p, (h = sha(canonical([fn, locals.map(({ at, ...l }) => l), p.blocks, p.stmts, p.values]))));
  }
  return h;
};
const codeClosure = (v, f) => {
  const parts = partsOf(v);
  return sha(closureOf(v, f).map(g => `${g}:${parts.has(g) ? codeHash(parts.get(g)) : 'missing'}`).join('\n'));
};

const source = candelaSource();
const base = lift(source);
const p0 = partsOf(base.v);
const out = {
  node: process.version,
  r0: revisionOf('typed.blocks', '1', base.v),
  ingestMs: base.ms,
  functions: p0.size,
  opsWithPositions: Object.values(base.v.ops).filter(o => o.at).length,
  ops: Object.keys(base.v.ops).length,
  edits: [],
};

// the first decimal literal in function f's body, its last digit changed (same length)
const constantEdit = f => {
  const at = source.indexOf(`function ${f}(`);
  if (at < 0) throw new Error('no function ' + f);
  const body = source.indexOf('{', source.indexOf(')', at));
  const m = /\d\.\d+/.exec(source.slice(body));
  const end = body + m.index + m[0].length - 1;
  const d = source[end];
  return source.slice(0, end) + (d === '9' ? '8' : String(+d + 1)) + source.slice(end + 1);
};
const lineEnd = f => source.indexOf('\n', source.indexOf(`function ${f}(`));
const edits = [
  ['constant in a scene material (s3_mat_0)', 's3_mat_0', constantEdit('s3_mat_0')],
  ['constant in a shared leaf (fresnelDielectric)', 'fresnelDielectric', constantEdit('fresnelDielectric')],
  ['constant in the largest function (tracePath)', 'tracePath', constantEdit('tracePath')],
  ['blank line after the header of s3_mat_0', 's3_mat_0', source.slice(0, lineEnd('s3_mat_0') + 1) + '\n' + source.slice(lineEnd('s3_mat_0') + 1)],
  ['comment at the end of the header of s3_mat_0', 's3_mat_0', source.slice(0, lineEnd('s3_mat_0')) + ' // edited' + source.slice(lineEnd('s3_mat_0'))],
];
for (const [what, fn, text] of edits) {
  const e = lift(text);
  const p1 = partsOf(e.v);
  const row = { what, fn, ingestMs: e.ms, functions: p1.size };
  const full = [], code = [];
  for (const [n, p] of p1) {
    const q = p0.get(n);
    if (!q || partHash(q) !== partHash(p)) full.push(n);
    if (!q || codeHash(q) !== codeHash(p)) code.push(n);
  }
  row.partsChanged = full.length;
  row.partsChangedFirst = full.slice(0, 6);
  row.codeChanged = code.length;
  row.codeChangedNames = code.slice(0, 6);
  let keys = 0, codeKeys = 0;
  for (const n of p1.keys()) {
    if (closureKey(base.v, n) !== closureKey(e.v, n)) keys++;
    if (codeClosure(base.v, n) !== codeClosure(e.v, n)) codeKeys++;
  }
  row.closureKeys = keys;
  row.codeClosureKeys = codeKeys;
  row.frontEndSame = canonical(base.v.frontEnd) === canonical(e.v.frontEnd);
  row.countersSame = canonical(base.v.counters) === canonical(e.v.counters);
  out.edits.push(row);
  process.stderr.write(JSON.stringify(row) + '\n');
}
out.rssMB = Math.round(process.memoryUsage().rss / 1e6);
console.log(JSON.stringify(out, null, 1));
