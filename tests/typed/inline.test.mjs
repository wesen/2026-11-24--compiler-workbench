// IRWB-003: the inline pass. Calls at the root of a statement are replaced by copies of their callees; record
// results become locals; the meaning contract checks every application; `why` reaches the callee and the call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
await installVendor();
const { projectFiles, projectIds } = await import('../../tools/corpus.mjs');
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { PASSES, PIPELINES } = await import('../../dist/typed/passes.js');
const E = await import('../../dist/typed/evaluate.js');
const B = await import('../../dist/typed/backend/index.js');
const { CONVENTION_FIXTURE } = await import('./f32-backend-fixture.mjs');

const open = id => Program.fromProject(projectSource(id, projectFiles(id)));
const calls = (p, fn) => {
  const st = storeOf(p.head.value),
    out = [];
  const walk = id => {
    const v = st.get(id);
    if (v.op === 'call') out.push(v.imm);
    v.args.forEach(walk);
  };
  for (const b of st.fn(fn).blocks)
    for (const sid of b.stmts) {
      const s = st.get(sid);
      for (const k of ['value', 'cond', 'addr']) if (s[k]) walk(s[k]);
    }
  return out;
};
const againstOrigin = (p, image) => {
  const st0 = storeOf(p.origin.value);
  let agree = 0,
    decided = 0;
  for (const fn of p.options.entries ?? p.fns())
    for (const k of E.casesFrom(st0, fn, { count: 100, seed: 7, inputs: p.inputs[fn] ?? {} })) {
      const e = E.evaluate(st0, fn, k.args, k.memory, { limit: 2e4 }),
        r = B.runImage(image, fn, k.args, k.memory, { limit: 2e5 });
      if (e.limit || r.limit) continue;
      decided++;
      if (E.agrees(e, r)) agree++;
    }
  return [agree, decided];
};

test('inline: a whole-program pass, registered, in the speed pipeline twice, and not scoped per function', () => {
  assert.equal(PASSES.inline.typed.program, true);
  assert.equal(PASSES.inline.id, 'typed.inline');
  assert.deepEqual(PIPELINES.speed.slice(0, 2), ['inline', 'inline']);
  assert.deepEqual(PIPELINES.speed.slice(-2), ['rotate', 'cfg']);
  // IRWB-037-F: O2+ with bcm after bce, and reassoc, bitwise, simplify and lvn after its last subst
  const o2plus = [...PIPELINES['O2+']];
  o2plus.splice(o2plus.indexOf('bce') + 1, 0, 'bcm');
  assert.deepEqual(PIPELINES.speed.slice(2, -2), [...o2plus, 'reassoc', 'bitwise', 'simplify', 'lvn']);
});

test('inline on calls: energy calls nothing afterwards, the check agrees, and why reaches callee and call', async () => {
  const p = open('calls');
  assert.deepEqual(calls(p, 'energy'), ['sq', 'sq', 'sq', 'clamp']);
  const r = await p.apply('inline');
  assert.equal(r.changed, true);
  assert.equal(r.check, '120/120');
  assert.equal(r.kinds.inline, 4);
  assert.deepEqual(calls(p, 'energy'), []);
  assert.ok(p.fns().includes('sq'), 'without entries the callees stay');
  const st = storeOf(p.head.value);
  // the copy of sq's return for the third call: from s:sq.0, because the call value and its statement
  const copy = [...st.fn('energy').blocks.flatMap(b => b.stmts)]
    .map(s => st.get(s))
    .filter(s => s.op === 'set' && s.origin[0].via === 'inline' && s.origin[0].from === 's:sq.0')
    .map(s => s.origin[0]);
  assert.equal(copy.length, 3);
  for (const o of copy) {
    assert.equal(o.because.length, 2);
    assert.match(o.because[0], /^v:energy\./);
    assert.match(o.because[1], /^s:energy\./);
    assert.match(o.note, /^inlined from sq into energy at s:energy\.\d+$/);
  }
  const sid = [...st.fn('energy').blocks.flatMap(b => b.stmts)].find(s => st.get(s).origin[0].from === 's:sq.0');
  const why = p.why(sid);
  assert.equal(why.via, 'inline');
  assert.equal(why.from.id, 's:sq.0');
  assert.match(why.from.from.text, /line 2/);
  assert.equal(why.because[1].status, 'removed@r1');
  assert.match(why.because[1].from.text, /call .* \(line 6\)/);
  assert.ok(p.whyChain(sid).some(n => n.relation === 'inline'));
});

test('inline: record results become locals; leaf reads read them; f32 code stays correct through the backend', async () => {
  const p = new Program('fixture', CONVENTION_FIXTURE, { ingest: { tape: true } });
  assert.ok(calls(p, 'bigSum').includes('big'));
  const r = await p.apply('inline');
  assert.equal(r.changed, true);
  assert.match(r.check, /^(\d+)\/\1$/);
  assert.deepEqual(calls(p, 'bigSum'), []);
  assert.deepEqual(calls(p, 'swapTwice'), []);
  const st = storeOf(p.head.value);
  const bigSum = st.fn('bigSum');
  assert.ok(bigSum.locals.some(l => l.name === 'big_r11' && l.madeBy === 'inline'));
  const reads = [];
  const walk = id => {
    const v = st.get(id);
    if (v.op === 'result') reads.push(id);
    v.args.forEach(walk);
  };
  for (const b of bigSum.blocks) for (const sid of b.stmts) for (const k of ['value', 'cond', 'addr']) if (st.get(sid)[k]) walk(st.get(sid)[k]);
  assert.deepEqual(reads, [], 'no leaf read is left');
  for (const o of [{}, { chains: true, coalesce: true, homes: true }]) {
    const [agree, decided] = againstOrigin(p, B.lowerToImage(p.head, o).image);
    assert.ok(decided > 0);
    assert.equal(agree, decided, JSON.stringify(o));
  }
  // frame arrays are never inlined, and functions that use them keep their calls (none calls sumArray here)
  assert.ok(p.fns().includes('sumArray'));
});

test('inline: limits and refusals', async () => {
  // Typed refuses recursion in its front end, so the cycle rule cannot be shown on a program; frame arrays can
  const SRC = `function cells(n: i32): i32 {
    const s = new Int32Array(4);
    s[n & 3] = n;
    return s[0] + s[1];
}
function useCells(n: i32): i32 { return cells(n) + 1; }
function tiny(x: i32): i32 { return x + 1; }
function twice(x: i32): i32 { return tiny(x) + tiny(x + 2); }
`;
  const p = new Program('limits', SRC, { ingest: { tape: true } });
  const r = await p.apply('inline', { params: { maxSize: 0, maxSingle: 0 } });
  assert.equal(r.changed, false, 'nothing is small enough');
  const q = await p.apply('inline', { params: { maxSize: 1, maxSingle: 0 } });
  assert.equal(q.changed, true);
  assert.deepEqual(calls(p, 'twice'), [], 'tiny is one statement');
  assert.deepEqual(calls(p, 'useCells'), ['cells'], 'a callee with a frame array stays a call');
  const s = await p.apply('inline');
  assert.equal(s.changed, false, 'and stays one under the default limits');
  assert.deepEqual(calls(p, 'useCells'), ['cells']);
});

test('inline under an entry-only contract, then dfe: the inlined callees disappear', async () => {
  const p = new Program('entries', `function sq(x: i32): i32 { return x * x; }
function clamp(v: i32, lo: i32, hi: i32): i32 { return Math.min(Math.max(v, lo), hi); }
function energy(a: i32, b: i32): i32 { return clamp(sq(a) + sq(b), 0, 5000); }
`, { entries: ['energy'] });
  await p.apply('inline');
  assert.deepEqual(calls(p, 'energy'), []);
  await p.apply('dfe', { params: { roots: ['energy'] } });
  assert.deepEqual(p.fns(), ['energy']);
  await p.pipeline('O2');
  const [agree, decided] = againstOrigin(p, B.lowerToImage(p.head).image);
  assert.ok(decided > 0);
  assert.equal(agree, decided);
});

test('inline: a callee local read before written starts at 0 at every inlined call', async () => {
  // Typed initializes every local, so lifted code reads none before writing it. A pass may remove an entry's
  // `t = 0` (a fresh frame holds 0); `t` is then live at last's entry, and each inlined copy must set it to 0
  // first: without that, last(k & 1) for an even k would return the 7 + i of the previous call.
  const SRC = `function last(n: i32): i32 {
    let t: i32 = 0;
    for (let i: i32 = 0; i < n; i = i + 1) { t = i + 7; }
    return t;
}
function sum(n: i32): i32 {
    let s: i32 = 0;
    for (let k: i32 = 0; k < n; k = k + 1) { s = s + last(k & 1); }
    return s;
}
`;
  const { typedPass } = await import('../../dist/typed/passes.js');
  const dropZeroInit = typedPass({
    name: 'drop-zero-init',
    about: "remove the entry's t = 0 of last: locals start at 0",
    writes: ['stmts'],
    body({ st, f, tx }) {
      if (f.name !== 'last') return;
      for (const sid of f.blocks[0].stmts.slice()) {
        const s = st.get(sid);
        if (s.op === 'set' && f.locals[s.local].name === 't' && st.get(s.value).op === 'const')
          tx.remove(sid, { because: ['fn:last'], note: 'locals start at 0' });
      }
    },
  });
  const p = new Program('zeroing', SRC, { inputs: { sum: { n: [0, 20] }, last: { n: [0, 20] } } });
  assert.equal((await p.apply(dropZeroInit)).changed, true);
  const r = await p.apply('inline');
  assert.equal(r.changed, true);
  assert.match(r.check, /^(\d+)\/\1$/);
  const st = storeOf(p.head.value);
  const zeroes = [...st.fn('sum').blocks.flatMap(b => b.stmts)]
    .map(s => st.get(s))
    .filter(s => /^last's local t starts at 0$/.test(s.origin[0].note ?? ''));
  assert.equal(zeroes.length, 1);
  assert.equal(st.fn('sum').locals[zeroes[0].local].name, 'last_t');
  await p.pipeline('O2');
  const [agree, decided] = againstOrigin(p, B.lowerToImage(p.head, { chains: true, coalesce: true, homes: true }).image);
  assert.equal(agree, decided);
});

test('speed on every corpus project agrees with r0 under the default and the new backend options (IRWB_FULL)', { timeout: 600000 }, async () => {
  if (process.env.IRWB_FULL !== '1') return;
  for (const id of projectIds()) {
    const p = open(id);
    const run = await p.pipeline('speed');
    assert.ok(!run.some?.(x => x.rejected), id);
    for (const o of [{}, { chains: true, coalesce: true, homes: true }]) {
      const [agree, decided] = againstOrigin(p, B.lowerToImage(p.head, o).image);
      assert.equal(agree, decided, `${id} ${JSON.stringify(o)}`);
    }
  }
});
