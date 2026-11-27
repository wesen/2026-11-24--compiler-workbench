// Rule candidates written from the hot node patterns (various/07-corpus-shapes-before.json), each verified with
// the repository's rule verifier, then measured: the corpus under `speed` with simplify's table plus every sound
// candidate, firings per rule and instructions per project against the table alone.
// usage: node 11-rule-candidates.mjs out.json [--verify-only] [id...]
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const ROOT = process.env.IRWB_ROOT ? pathToFileURL(process.env.IRWB_ROOT + '/').href : new URL('../../../../../../', import.meta.url).href;
const { projectIds, projectFiles } = await import(ROOT + 'tools/corpus.mjs');
const { installVendor } = await import(ROOT + 'tools/node-vendor.mjs');
await installVendor();
const D = ROOT + 'dist/';
const { rule, op, v, c, kv, ruleText } = await import(D + 'typed/rules/form.js');
const { verifyRule } = await import(D + 'typed/rules/verify.js');
const { SIMPLIFY_RULES } = await import(D + 'typed/rules/simplify.js');
const { tableBody } = await import(D + 'typed/rules/compile.js');
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');
const { PIPELINES, simplify, typedPass } = await import(D + 'typed/passes.js');

const X = { x: 'i32' };
// name, the hot pattern it comes from (instructions over the corpus under speed), the rule
export const CANDIDATES = [
  ['eq-and-one', 'eq(and, 1): 320', rule('eq-and-one', X, op('eq', op('and', v('x'), c(1)), c(1)), op('and', v('x'), c(1)))],
  ['eq-zero', 'if eq(x, 0): 1,333; eq(x, 0): 62', rule('eq-zero', X, op('eq', v('x'), c(0)), op('eqz', v('x')))],
  ['ne-zero-bool', 'ne(x, 0): 82', rule('ne-zero-bool', { x: 'bool' }, op('ne', v('x'), c(0)), v('x'), { where: [{ boolean: 'x' }] })],
  ['ne-zero', 'if ne(x, 0): 6,190 (unsound as a value: ne gives 0 or 1)', rule('ne-zero', X, op('ne', v('x'), c(0)), v('x'))],
  ['add-add-const', 'add(add, #): 60', rule('add-add-const', { x: 'i32', a: 'i32', b: 'i32' }, op('add', op('add', v('x'), kv('a')), kv('b')), op('add', v('x'), c({ eval: 'add', args: ['a', 'b'] })))],
  ['sub-add-const', 'sub(add, #): 198', rule('sub-add-const', { x: 'i32', a: 'i32', b: 'i32' }, op('sub', op('add', v('x'), kv('a')), kv('b')), op('add', v('x'), c({ eval: 'sub', args: ['a', 'b'] })))],
  ['shl-shl-one', 'shl(shl, 1): 192', rule('shl-shl-one', X, op('shl', op('shl', v('x'), c(1)), c(1)), op('shl', v('x'), c(2)))],
  ['lt-rem16-8', 'lt(rem, #): 4,289 (unsound: x < 0)', rule('lt-rem16-8', X, op('lt', op('rem', v('x'), c(16)), c(8)), op('eqz', op('and', v('x'), c(8))))],
  ['lt-and15-8', 'lt(rem, #) after strength', rule('lt-and15-8', X, op('lt', op('and', v('x'), c(15)), c(8)), op('eqz', op('and', v('x'), c(8))))],
  ['shl-div8-3', 'shl(div, #): 3,794 (unsound: x < 0)', rule('shl-div8-3', X, op('shl', op('div', v('x'), c(8)), c(3)), op('and', v('x'), c(-8)))],
];
const argv = process.argv.slice(2);
const [out, ...only] = argv.filter(a => !a.startsWith('--'));
const evidence = {};
for (const [name, from, r] of CANDIDATES) {
  const e = verifyRule(r, { random: 1e5, seed: 7 });
  evidence[name] = { text: ruleText(r), from, verdict: e.verdict, strength: e.strength, methods: e.methods.filter(m => m.verdict !== 'n/a').map(m => `${m.method}:${m.verdict}`), counterexample: e.counterexample, reason: e.reason };
  console.log(`${name.padEnd(14)} ${e.verdict.padEnd(8)} ${(e.strength ?? '-').padEnd(22)} ${ruleText(r)}${e.counterexample ? '   ' + JSON.stringify(e.counterexample.bindings) + ` lhs ${e.counterexample.lhs} rhs ${e.counterexample.rhs}` : ''}${e.reason ? '   ' + e.reason : ''}`);
}
if (argv.includes('--verify-only')) process.exit(0);

const sound = CANDIDATES.filter(([n]) => evidence[n].verdict === 'sound').map(([, , r]) => r);
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
const firings = new Map();
const withCandidates = typedPass({ ...simplify.typed, body: tableBody([...SIMPLIFY_RULES.rules, ...sound], firings) });
const rows = {}, totals = { table: { default: 0, tuned: 0 }, candidates: { default: 0, tuned: 0 } };
for (const id of only.length ? only : projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  rows[id] = {};
  for (const variant of ['table', 'candidates']) {
    const p = Program.fromProject(ps);
    for (const pass of PIPELINES.speed) {
      try { await p.apply(variant === 'candidates' && pass === 'simplify' ? withCandidates : pass, { count: 5 }); }
      catch (e) { if (e.code !== 'contractRejected') throw e; rows[id].rejected = pass; }
    }
    rows[id][variant] = { default: instructions(p, {}), tuned: instructions(p, TUNED) };
    totals[variant].default += rows[id][variant].default; totals[variant].tuned += rows[id][variant].tuned;
  }
  const a = rows[id].table, b = rows[id].candidates;
  if (a.default !== b.default || a.tuned !== b.tuned) console.log(id.padEnd(20), `default ${a.default} -> ${b.default}, tuned ${a.tuned} -> ${b.tuned}`);
}
const fired = Object.fromEntries(sound.map(r => [r.name, firings.get(r.name) ?? 0]));
console.log('firings of the candidates:', JSON.stringify(fired));
console.log('totals:', JSON.stringify(totals));
writeFileSync(out, JSON.stringify({ evidence, fired, totals, rows }, null, 1) + '\n');
