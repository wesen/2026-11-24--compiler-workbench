// IRWB-035-E: the edit classifier (dist/typed/edit-class.js) and its decision procedure.
// Runs O2 on small corpus projects through applyPass (no contract: classification is about shape) and checks the
// invariants the design states, plus one synthetic application for the motion test on its own.
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';
import { projectSource, ingestProject } from '../../dist/typed/project.js';
import { PASSES, PIPELINES } from '../../dist/typed/passes.js';
import { applyPass } from '../../dist/framework/passes/index.js';
import { AnalysisManager } from '../../dist/framework/contracts/index.js';
import { classifyApplication, rederive } from '../../dist/typed/edit-class.js';
import test from 'node:test';
import assert from 'node:assert/strict';

await installVendor();

/** O2's changed applications of one project, with their classifications: [pass, edits, cls]. */
async function o2(id) {
  const r0 = ingestProject(projectSource(id, projectFiles(id)));
  const manager = new AnalysisManager();
  let cur = r0;
  const out = [];
  for (const name of PIPELINES.O2) {
    const r = await applyPass(PASSES[name], cur, { manager });
    if (!r.changed) continue;
    out.push([
      name,
      r.report.edits,
      classifyApplication({ pass: name, edits: r.report.edits, before: cur.value, after: r.artifact.value }),
    ]);
    cur = r.artifact;
  }
  return out;
}

test('blend under O2: every edit placed, each pass in its class', async () => {
  const apps = await o2('blend');
  assert.ok(apps.length >= 5, 'blend O2 changes at least five revisions');
  for (const [pass, edits, cls] of apps) {
    assert.equal(cls.length, edits.length, `${pass}: every edit classified`);
    for (const c of cls) assert.ok(['local', 'structural', 'other'].includes(c.cls));
  }
  const byPass = new Map(apps.map(([p, e, c]) => [p, { e, c }]));
  // fold and simplify: local rewrites that re-derive from their verified tables
  for (const name of ['fold', 'simplify']) {
    const row = byPass.get(name);
    if (!row) continue;
    for (const c of row.c)
      if (c.cls === 'local') {
        assert.equal(c.local.kind, 'rule', `${name}: a local replace cites a verified rule`);
        assert.ok(c.local.rules.length > 0, `${name}: the fired rules are named`);
        assert.ok(c.local.strength, `${name}: the weakest evidence strength is recorded`);
        assert.ok(c.local.ruleSet === name, `${name}: re-derives from its own table`);
      }
  }
  // constprop: a local rewrite on a reaching-definitions hypothesis, not rule-derivable
  const cp = byPass.get('constprop');
  if (cp)
    for (const c of cp.c)
      if (c.cls === 'local') {
        assert.equal(c.local.kind, 'fact');
        assert.match(c.local.fact, /constprop/);
      }
  // licm: structural (code motion), including its replace edits (they read the hoisted local)
  const licm = byPass.get('licm');
  if (licm)
    for (const [e, c] of licm.e.map((e, i) => [e, licm.c[i]])) {
      assert.equal(c.cls, 'structural', `licm ${e.kind}: code motion`);
      if (e.kind === 'replace')
        assert.match(c.reason, /motion/, 'a licm replace is bookkeeping of the hoist');
    }
  // cfg: structural (branch structure)
  const cfg = byPass.get('cfg');
  if (cfg) for (const c of cfg.c) assert.equal(c.cls, 'structural');
  // dce: other (dead statement removal)
  const dce = byPass.get('dce');
  if (dce)
    for (const [e, c] of dce.e.map((e, i) => [e, dce.c[i]])) {
      assert.equal(e.kind, 'remove');
      assert.equal(c.cls, 'other', 'a dead statement is neither a value rewrite nor structural');
    }
});

test('value-numbering under O2: lvn is intra-block motion, both chained replaces included', async () => {
  const apps = await o2('value-numbering');
  const lvn = apps.find(([p]) => p === 'lvn');
  assert.ok(lvn, 'lvn changes value-numbering');
  const [pass, edits, cls] = lvn;
  for (const c of cls) assert.equal(c.cls, 'structural', 'value numbering is code motion');
  // the chained replace: the first replace of a twice-numbered field is still motion bookkeeping
  const fields = new Map();
  for (const e of edits)
    if (e.kind === 'replace')
      fields.set(`${e.stmt}/${e.field}`, (fields.get(`${e.stmt}/${e.field}`) ?? 0) + 1);
  if ([...fields.values()].some(n => n > 1)) {
    const chained = cls.find(c => /chained/.test(c.reason));
    assert.ok(chained === undefined, 'a chained lvn replace is structural, not local-with-none');
  }
});

test('subst and strength: local rewrites on named hypotheses, not rule-derivable', async () => {
  const apps = [...(await o2('dead-code')), ...(await o2('strength'))];
  const facts = apps.flatMap(([, edits, cls]) =>
    edits.map((e, i) => ({ e, c: cls[i] })).filter(({ e, c }) => c.cls === 'local'),
  );
  for (const { e, c } of facts) {
    assert.ok(c.local.kind === 'fact' || c.local.kind === 'rule');
    if (c.local.kind === 'fact') assert.match(c.local.fact, /^(subst|strength|constprop):/);
  }
  const subst = apps.find(([p]) => p === 'subst');
  if (subst)
    for (const [e, c] of subst[1].map((e, i) => [e, subst[2][i]]))
      if (e.kind === 'replace') assert.equal(c.cls, 'local', 'a copy substituted into its only reader');
      else if (e.kind === 'remove')
        assert.equal(c.cls, 'other', 'the substituted-away definition is dead code');
});

test('the motion test alone: a replace reading a local the application created is structural', () => {
  // a synthetic application: pass 'fold' replaces a get with a const, but the same application also created the
  // local that get reads, so the edit is motion bookkeeping, not a local rewrite
  const local = { kind: 'local', fn: 'f', local: 'local:f/t', name: 't', because: [] };
  const replace = {
    kind: 'replace',
    fn: 'f',
    stmt: 's:f.1',
    field: 'value',
    from: 'v:f.1',
    to: 'v:f.9',
    because: [],
  };
  const f = {
    id: 'fn:f',
    kind: 'function',
    name: 'f',
    params: [],
    result: 'i32',
    locals: [
      { index: 0, name: 'x', type: 'i32', param: true, mutable: false },
      { index: 1, name: 't', type: 'i32', param: false, mutable: true },
    ],
    origin: [],
    blocks: ['bb:f.0'],
  };
  const shape = v => ({ id: 'blocks', kind: 'block', fn: 'fn:f', stmts: v, succ: [], origin: [] });
  const mk = (id, op, args, imm) => ({
    id,
    kind: 'value',
    fn: 'fn:f',
    op,
    args,
    ...(imm !== undefined ? { imm } : {}),
    origin: [],
  });
  const stmt = (id, value) => ({ id, kind: 'stmt', fn: 'fn:f', op: 'set', local: 1, value, origin: [] });
  const before = {
    formatVersion: 1,
    program: 'p',
    rev: 0,
    counters: {},
    fnOrder: ['f'],
    fns: { f: { ...f, blocks: ['bb:f.0'] } },
    blocks: { 'bb:f.0': shape(['s:f.0', 's:f.1']) },
    stmts: { 's:f.0': stmt('s:f.0', 'v:f.2'), 's:f.1': stmt('s:f.1', 'v:f.1') },
    values: {
      'v:f.1': mk('v:f.1', 'get', [], 0),
      'v:f.2': mk('v:f.2', 'get', [], 1),
    },
    ops: {},
    frontEnd: { wasmBytes: 0, records: null, enums: null, signatures: null },
  };
  const after = {
    ...before,
    rev: 1,
    blocks: { 'bb:f.0': shape(['s:f.0', 's:f.1']) },
    stmts: { 's:f.0': stmt('s:f.0', 'v:f.2'), 's:f.1': stmt('s:f.1', 'v:f.9') },
    values: {
      'v:f.2': mk('v:f.2', 'get', [], 1),
      'v:f.9': mk('v:f.9', 'get', [], 1),
    },
  };
  const cls = classifyApplication({ pass: 'fold', edits: [local, replace], before, after });
  assert.equal(cls[1].cls, 'structural');
  assert.match(cls[1].reason, /motion/);
  // without the local edit, the same replace is a local rewrite (here not rule-derivable: get is no rule's lhs)
  const cls2 = classifyApplication({ pass: 'fold', edits: [replace], before, after });
  assert.equal(cls2[0].cls, 'local');
  assert.equal(cls2[0].local.kind, 'none');
});

test('rederive: a fold edit re-derives; the same edit with the constant off by one does not', async () => {
  const manager = new AnalysisManager();
  const r0 = ingestProject(projectSource('blend', projectFiles('blend')));
  let cur = r0;
  for (const name of PIPELINES.O2) {
    const r = await applyPass(PASSES[name], cur, { manager });
    if (!r.changed) continue;
    if (name === 'fold') {
      const e = r.report.edits.find(x => x.kind === 'replace');
      const d = rederive(cur.value, r.artifact.value, e.from, e.to);
      assert.equal(d.ok, true, 'the fold edit re-derives from its table');
      const wrong = JSON.parse(JSON.stringify(r.artifact.value));
      wrong.values[e.to].imm = (wrong.values[e.to].imm | 0) + 1;
      assert.equal(
        rederive(cur.value, wrong, e.from, e.to).ok,
        false,
        'an off-by-one constant is not a derivation',
      );
      break;
    }
    cur = r.artifact;
  }
});
