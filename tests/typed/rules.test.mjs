// IRWB-006 B1 and B2: simplify and fold as rule tables, and the rule verifier with its recorded evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles, projectIds } from '../../tools/corpus.mjs';

await installVendor();
const { projectSource, ingestProject } = await import('../../dist/typed/project.js');
const { PASSES, PIPELINES, optimizationContract, typedPass, simplify } = await import('../../dist/typed/passes.js');
const R = await import('../../dist/typed/rules/passes.js');
const { SIMPLIFY_RULES } = await import('../../dist/typed/rules/simplify.js');
const { FOLD_RULES } = await import('../../dist/typed/rules/fold.js');
const { UNSOUND_CANDIDATES, F32_SOUND_CANDIDATES } = await import('../../dist/typed/rules/candidates.js');
const { RULE_EVIDENCE } = await import('../../dist/typed/rules/evidence.js');
const { verifyRule, ruleFingerprint } = await import('../../dist/typed/rules/verify.js');
const { binopW, TRAP, boundaryI32 } = await import('../../dist/typed/rules/semantics.js');
const { tableBody } = await import('../../dist/typed/rules/compile.js');
const { rule, ruleSet, op, v, c, ruleText, toNodePattern } = await import('../../dist/typed/rules/form.js');
const { rulesListing, RULE_SETS } = await import('../../dist/typed/rules/listing.js');
const { binop, F32_EDGES } = await import('../../dist/typed/evaluate.js');
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');
const { applyPass } = await import('../../dist/framework/passes/index.js');
const { canonical } = await import('../../dist/framework/core/data.js');

const FULL = process.env.IRWB_FULL === '1';
const SUBSET = ['blend', 'algebra', 'checksum', 'dead-code', 'strength', 'value-numbering', 'constants', 'start-here'];
// Only the tables name their rules. Compare the structural edits shared by both implementations.
const sig = r => [
  r.artifact.revision,
  canonical((r.report?.edits ?? []).map(({ rules, ...edit }) => edit)),
  canonical(r.correspondence?.entries ?? []),
];

/** Every pipeline with simplify or fold; at each such step, apply `alt[name]` to the same input and compare. */
async function compareOnCorpus(ids, alt) {
  let compared = 0, changed = 0;
  const differ = [];
  for (const id of ids) {
    const p = projectSource(id, projectFiles(id)), r0 = ingestProject(p);
    // IRWB-003's speed runs simplify and fold on inlined code: compared as well
    for (const pl of ['O1', 'O2', 'O2+', 'loops', 'checks', 'speed']) {
      const manager = new AnalysisManager(), contract = optimizationContract({ inputs: p.meta.inputs });
      let cur = r0;
      for (const name of PIPELINES[pl]) {
        const r = await applyPass(PASSES[name], cur, { manager, contract, contractInputs: { origin: r0 } });
        if (alt[name]) {
          const got = sig(await applyPass(alt[name], cur, { manager: new AnalysisManager() }));
          compared++;
          if (r.changed) changed++;
          if (canonical(got) !== canonical(sig(r))) differ.push(`${id} ${pl} ${name}`);
        }
        cur = r.artifact;
      }
    }
  }
  return { compared, changed, differ };
}

test(`B1: the tables give the hand-written passes' revisions, structural edits and correspondences (${FULL ? 'all projects' : 'subset'})`, { timeout: 600000 }, async () => {
  const res = await compareOnCorpus(FULL ? projectIds() : SUBSET, { simplify: R.simplifyHandwritten, fold: R.foldHandwritten });
  assert.deepEqual(res.differ, []);
  assert.ok(res.changed > 0, 'some steps change the program, so the comparison has something to compare');
  if (FULL) assert.equal(res.compared, 792); // 616 on IRWB-006's five pipelines, 176 more (4 steps x 44) on speed
});

test('B1: the comparison sees a one-rule difference (a rule with another note changes the revision)', async () => {
  const rules = SIMPLIFY_RULES.rules.map(r => (r.name === 'not-lt' ? { ...r, note: 'not less than' } : r));
  const mutated = typedPass({ ...simplify.typed, body: tableBody(rules) });
  const res = await compareOnCorpus(['blend'], { simplify: mutated });
  assert.ok(res.differ.some(d => d.startsWith('blend O2 simplify')), JSON.stringify(res.differ));
  // and an order change: x * 1 tried after x * 2^k makes x * 1 into x << 0 (where it occurs) -- the table order is the switch's
  const i = SIMPLIFY_RULES.rules.findIndex(r => r.name === 'mul-one');
  assert.ok(i < SIMPLIFY_RULES.rules.findIndex(r => r.name === 'mul-pow2'));
});

test('B1: the tables are data: names, text, 27 simplify and 40 fold rules, patterns convertible to the framework', () => {
  assert.equal(SIMPLIFY_RULES.rules.length, 27);
  assert.equal(FOLD_RULES.rules.length, 40);
  const byName = Object.fromEntries(SIMPLIFY_RULES.rules.map(r => [r.name, r]));
  assert.equal(ruleText(byName['mul-pow2']), 'mul(x, #k) → shl(x, #log2 k) if pow2 k');
  assert.equal(ruleText(byName['not-lt']), 'eqz(lt(a, b)) → ge(a, b)');
  assert.equal(JSON.parse(JSON.stringify(byName['sub-self'])).where[0].pure, 'x');
  assert.ok(Object.isFrozen(byName['sub-self'].lhs.args));
  assert.deepEqual(toNodePattern(byName['add-zero']).exact, true);
  assert.deepEqual(toNodePattern(byName['sub-self']).exact, false, 'the framework has no structural repeat');
  assert.throws(() => rule('bad', { x: 'i32' }, op('add', v('x'), v('y')), v('x')), /no declared type|not bound|y/);
});

test('B2: binopW at 32 bits is the evaluator\'s binop (boundary values crossed, every i32 operator)', () => {
  const B = boundaryI32();
  for (const o of ['add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'shl', 'shr', 'shru', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'ltu', 'geu'])
    for (const a of B)
      for (const b of B) {
        let want;
        try { want = binop(o, a, b); } catch { want = TRAP; }
        assert.equal(binopW(o, a, b, 32), want, `${o}(${a}, ${b})`);
      }
});

test('B2: every table rule has recorded evidence for its current version, and it says sound', () => {
  for (const r of [...SIMPLIFY_RULES.rules, ...FOLD_RULES.rules]) {
    const e = RULE_EVIDENCE[r.name];
    assert.ok(e, `${r.name} has evidence`);
    assert.equal(e.version, r.version, r.name);
    assert.equal(e.fingerprint, ruleFingerprint(r), `${r.name}: the rule changed since it was verified; re-run scripts/04-verify-rules.mjs`);
    assert.equal(e.verdict, 'sound', r.name);
  }
  const strength = n => RULE_EVIDENCE[n].strength;
  for (const n of ['add-zero', 'sub-self', 'mul-zero', 'mul-pow2', 'pow2-mul', 'shl-zero', 'or-zero', 'and-ones']) assert.equal(strength(n), 'proof', n);
  for (const n of ['div-one', 'shr-zero', 'shru-zero', 'not-not']) assert.equal(strength(n), 'exhaustive', n);
  for (const n of ['not-lt', 'not-geu']) assert.equal(strength(n), 'reduced-width+argument', n);
  assert.match(RULE_EVIDENCE['not-lt'].argument, /total order/);
  for (const r of FOLD_RULES.rules) assert.equal(strength(r.name), 'by-construction', r.name);
  // an edited rule no longer matches its evidence
  assert.notEqual(ruleFingerprint({ ...SIMPLIFY_RULES.rules[0], note: 'edited' }), RULE_EVIDENCE['add-zero'].fingerprint);
});

test('B2: the fast methods, re-run, agree with the recorded evidence', () => {
  for (const r of [...SIMPLIFY_RULES.rules, ...FOLD_RULES.rules]) {
    const e = verifyRule(r, { random: 2000 }), rec = RULE_EVIDENCE[r.name];
    assert.equal(e.verdict, rec.verdict, r.name);
    // without exhaustive32 a one-variable rule's strength is only sampled; every other strength must reproduce
    if (rec.strength !== 'exhaustive' || r.name === 'not-not') assert.equal(e.strength, rec.strength, r.name);
  }
});

test('B2: deliberately unsound rules are rejected, each with a counterexample or a structural reason', () => {
  const ev = Object.fromEntries(UNSOUND_CANDIDATES.rules.map(r => [r.name, verifyRule(r, { random: 20000 })]));
  for (const [n, e] of Object.entries(ev)) assert.equal(e.verdict, 'unsound', n);
  // x / 2^j -> x >> j: a concrete counterexample, which the evaluator confirms
  const cx = ev['div-pow2-shr'].counterexample, { x, k } = cx.bindings;
  assert.ok(x < 0, 'only negative x');
  if (cx.width === 32) assert.notEqual(binop('div', x, k), binop('shr', x, 31 - Math.clz32(k)));
  else assert.notEqual(cx.lhs, cx.rhs);
  assert.match(ev['mul-zero-impure'].reason, /dropped .* without pure\(x\)/);
  assert.equal(ev['fadd-pos-zero'].counterexample.bindings.x, -0x80000000, '-0 + +0 is +0');
  const fm = ev['fmul-pos-zero'].counterexample; // x * +0 is -0 for a negative x (or x = -0), NaN for NaN and ∞
  assert.deepEqual([fm.rhs, fm.lhs !== 0], [0, true]);
  assert.equal(ev['fsub-self'].counterexample.lhs, 0x7fc00000, '∞ - ∞ is NaN');
  assert.equal(ev['not-flt'].counterexample.method, 'f32-special');
  assert.equal(ev['fadd-neg-zero'].counterexample.bindings.x & 0x7fffffff, 0x7fc00001, 'a NaN payload');
});

test('B2: x + (-0) -> x passes the meaning check\'s f32 edge values and is refuted by NaN payloads', () => {
  const r = UNSOUND_CANDIDATES.rules.find(x => x.name === 'fadd-neg-zero');
  assert.equal(verifyRule(r, { specials: F32_EDGES, random: 0 }).verdict, 'sound', 'F32_EDGES has only the canonical NaN');
  assert.equal(verifyRule(r).verdict, 'unsound');
  for (const s of F32_SOUND_CANDIDATES.rules) assert.equal(verifyRule(s, { random: 20000 }).verdict, 'sound', s.name);
});

test('workbench: the rules listing fits 72 columns and shows every rule with its evidence', () => {
  for (const set of Object.values(RULE_SETS)) {
    const text = rulesListing(set);
    for (const line of text.split('\n')) assert.ok(line.length <= 72, `${line.length}: ${line}`);
    for (const r of set.rules) assert.match(text, new RegExp(`^${r.name} `, 'm'));
    assert.doesNotMatch(text, /stale|none|UNSOUND/);
  }
  assert.match(rulesListing(SIMPLIFY_RULES), /^mul-pow2 +mul\(x, #k\) → shl\(x, #log2 k\) if pow2 k +proof$/m);
});
