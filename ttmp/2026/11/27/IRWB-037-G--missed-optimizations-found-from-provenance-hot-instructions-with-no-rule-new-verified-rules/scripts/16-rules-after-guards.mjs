// Second round of rule candidates: the shapes `guards` leaves once it has turned x / 8 and x % 16 into shifts and
// masks (chess: `dense + ((dense >> 3) << 3)`, `(at & 15) < 8`). Verified, then measured as a table pass placed
// after the last subst-mem of `speed` (the simplify table runs before guards, so its rules cannot see these).
// usage: node 16-rules-after-guards.mjs out.json [id...]
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const ROOT = process.env.IRWB_ROOT ? pathToFileURL(process.env.IRWB_ROOT + '/').href : new URL('../../../../../../', import.meta.url).href;
const { projectIds, projectFiles } = await import(ROOT + 'tools/corpus.mjs');
const { installVendor } = await import(ROOT + 'tools/node-vendor.mjs');
await installVendor();
const D = ROOT + 'dist/';
const { rule, op, v, c, ruleText } = await import(D + 'typed/rules/form.js');
const { verifyRule } = await import(D + 'typed/rules/verify.js');
const { tableBody } = await import(D + 'typed/rules/compile.js');
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');
const { PIPELINES, simplify, typedPass } = await import(D + 'typed/passes.js');

const X = { x: 'i32' };
const RULES = [
  rule('shl-shr3-mask', X, op('shl', op('shr', v('x'), c(3)), c(3)), op('and', v('x'), c(-8))),
  rule('lt-and15-8', X, op('lt', op('and', v('x'), c(15)), c(8)), op('eqz', op('and', v('x'), c(8)))),
  rule('ge-and15-8', X, op('ge', op('and', v('x'), c(15)), c(8)), op('ne', op('and', v('x'), c(8)), c(0))),
  rule('shl-shl-one', X, op('shl', op('shl', v('x'), c(1)), c(1)), op('shl', v('x'), c(2))),
];
for (const r of RULES) {
  const e = verifyRule(r, { random: 1e5, seed: 7 });
  console.log(`${r.name.padEnd(14)} ${e.verdict} ${e.strength ?? ''}  ${ruleText(r)}`);
  if (e.verdict !== 'sound') throw new Error(r.name);
}
const [out, ...only] = process.argv.slice(2);
const firings = new Map();
const table = typedPass({ ...simplify.typed, name: 'identities', body: tableBody(RULES, firings) });
const S = PIPELINES.speed, at = S.lastIndexOf('subst-mem');
const VARIANTS = { speed: S, 'speed + rules': [...S.slice(0, at + 1), table, ...S.slice(at + 1)] };
const TUNED = { chains: true, coalesce: true, homes: true };
function instructions(p, options) {
  const st = storeOf(p.origin.value), { image } = lowerToImage(p.head, options);
  let n = 0;
  for (const fn of p.origin.value.fnOrder)
    for (const k of casesFrom(st, fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} })) {
      const r = runImage(image, fn, k.args, k.memory, { limit: 2e5, counts: false });
      n += r.limit || !Number.isFinite(r.steps) ? 2e5 : r.steps;
    }
  return n;
}
const rows = {};
for (const id of only.length ? only : projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  rows[id] = {};
  for (const [name, list] of Object.entries(VARIANTS)) {
    const p = Program.fromProject(ps);
    for (const pass of list) await p.apply(pass, { count: 5 });
    rows[id][name] = { default: instructions(p, {}), tuned: instructions(p, TUNED) };
  }
  console.log(id.padEnd(18), JSON.stringify(rows[id]));
}
console.log('firings:', JSON.stringify(Object.fromEntries(firings)));
if (out) writeFileSync(out, JSON.stringify({ firings: Object.fromEntries(firings), rows }, null, 1) + '\n');
