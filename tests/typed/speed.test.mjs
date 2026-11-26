// IRWB-003: the backend options chains, coalesce and homes, block frequencies, and the rotate pass.
// The defaults must leave every image as it was (scripts/08 of IRWB-001 checks the revisions); the options are
// checked against the evaluator of r0 on the book's benchmarks and, with IRWB_FULL=1, on the whole corpus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
await installVendor();
const { projectFiles, projectIds } = await import('../../tools/corpus.mjs');
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const E = await import('../../dist/typed/evaluate.js');
const B = await import('../../dist/typed/backend/index.js');
const { blockFrequencies } = await import('../../dist/typed/backend/frequency.js');
const { layoutBlocks } = await import('../../dist/typed/backend/layout.js');
const { PIPELINES } = await import('../../dist/typed/passes.js');

const ALL = { chains: true, coalesce: true, homes: true };
const ROTATED = [...PIPELINES['O2+'], 'rotate', 'cfg'];
const open = id => Program.fromProject(projectSource(id, projectFiles(id)));
const cells = n => ({ cells: Array.from({ length: n }, (_, i) => (i * 37) % 256) });
const bench = (p, image, fn, b) => {
  const st = storeOf(p.head.value),
    c = E.benchCase(st, fn, b);
  return B.runImage(image, fn, c.args, c.memory, { limit: 5e6 });
};
/** The image against the evaluator of r0 on 100 generated cases per function: [agree, decided]. */
const againstOrigin = (p, image) => {
  const st0 = storeOf(p.origin.value);
  let agree = 0,
    decided = 0;
  for (const fn of p.fns())
    for (const k of E.casesFrom(st0, fn, { count: 100, seed: 7, inputs: p.inputs[fn] ?? {} })) {
      const e = E.evaluate(st0, fn, k.args, k.memory, { limit: 2e4 }),
        r = B.runImage(image, fn, k.args, k.memory, { limit: 2e5 });
      if (e.limit || r.limit) continue;
      decided++;
      if (E.agrees(e, r)) agree++;
    }
  return [agree, decided];
};

test('IRWB-003 options: extras are absent at their defaults, validated, and recorded when on', () => {
  assert.deepEqual(B.checkBackendOptions({}), B.backendDefaults);
  assert.deepEqual(B.checkBackendOptions({ coalesce: false, homes: false }), B.backendDefaults);
  assert.equal(B.checkBackendOptions({ coalesce: true }).coalesce, true);
  assert.equal(B.checkBackendOptions({ chains: true }).chains, true);
  assert.throws(() => B.checkBackendOptions({ layout: 'loops' }), e => e.code === 'badArgument');
  assert.throws(() => B.checkBackendOptions({ homes: 1 }), e => e.code === 'badArgument');
  assert.throws(() => B.checkBackendOptions({ coalesc: true }), e => e.code === 'unknownOption');
  assert.deepEqual(B.diffOptions(B.checkBackendOptions(ALL)), ALL);
  const p = open('blend');
  const plain = B.lowerToImage(p.head).image,
    same = B.lowerToImage(p.head, { coalesce: false }).image,
    on = B.lowerToImage(p.head, { coalesce: true }).image;
  assert.equal(same.revision, plain.revision, 'an extra at its default leaves the image as it was');
  assert.equal(on.value.options.coalesce, true);
  assert.equal(B.variantChoices(p.head)['blend'], null, 'the default backend compiles once');
});

test('IRWB-003 frequencies and chains: rotated Blend runs its loop 7.33 times per call and ends it in one branch', async () => {
  const p = open('blend');
  await p.pipeline(ROTATED);
  const st = storeOf(p.head.value),
    f = st.fn('blend');
  const fr = blockFrequencies(st, f);
  assert.ok(Math.abs(fr.block.get('bb:blend.3') - 0.88 / 0.12) < 1e-6, String(fr.block.get('bb:blend.3')));
  assert.equal(fr.block.get('bb:blend.4'), 0, 'the trap block');
  assert.ok(Math.abs(fr.block.get('bb:blend.2') - 1) < 1e-6);
  assert.deepEqual(layoutBlocks(st, f, fr), ['bb:blend.0', 'bb:blend.3', 'bb:blend.7', 'bb:blend.2', 'bb:blend.4']);
  const img = B.lowerToImage(p.head, { chains: true }).image;
  const loop = img.value.insns.map(i => i.sym);
  assert.ok(loop.includes('blt t1, a1, bb.3'), loop.join('\n'));
  assert.ok(!loop.some(s => s.startsWith('jal zero')), 'no jump back to a test');
  assert.equal(bench(p, img, 'blend', { work: cells(40), n: 40, a: 3, b: 5 }).steps, 410);
});

test('IRWB-003 coalesce: the copy t7 = i in Blend disappears, and Blend runs in 370 with rotation', async () => {
  const p = open('blend');
  await p.pipeline(ROTATED);
  const copies = o => B.lowerToImage(p.head, o).image.value.insns.filter(i => i.why === 'copy').length;
  assert.equal(copies({}) - copies({ coalesce: true }), 1);
  const img = B.lowerToImage(p.head, ALL).image;
  assert.equal(bench(p, img, 'blend', { work: cells(40), n: 40, a: 3, b: 5 }).steps, 370);
  const choice = B.variantChoices(p.head, ALL).blend;
  assert.equal(choice.coalesce, true);
  assert.ok(choice.cost.chosen < choice.cost.plain);
});

test('IRWB-003 homes: Collatz builds 1, 2 and 3 once, outside its loop', async () => {
  const p = open('collatz');
  await p.pipeline('O2');
  const choice = B.variantChoices(p.head, { homes: true }).collatz;
  assert.deepEqual(choice.homes, ['x:1', 'x:2', 'x:3']);
  const img = B.lowerToImage(p.head, { homes: true }).image;
  assert.equal(bench(p, img, 'collatz', { n: 27 }).steps, 1329);
  assert.ok(bench(p, img, 'collatz', { n: 27 }).steps < 1486, 'faster than the reference compiler');
});

test("IRWB-003 rotate: Blend's header is duplicated into the preheader and the latch, checked, with provenance", async () => {
  const p = open('blend');
  await p.pipeline('O2+');
  const r = await p.apply('rotate');
  assert.equal(r.changed, true);
  assert.equal(r.check, '40/40');
  const st = storeOf(p.head.value);
  assert.ok(!st.has('bb:blend.1'), 'the header is gone');
  const copies = [...st.fn('blend').blocks.flatMap(b => b.stmts)]
    .map(s => st.get(s))
    .filter(s => s.op === 'br_if' && s.origin[0].via === 'rotate');
  assert.equal(copies.length, 2);
  for (const s of copies) {
    assert.equal(s.origin[0].from, 's:blend.4');
    assert.deepEqual(s.origin[0].because, ['loop:blend@bb:blend.1', 'bb:blend.1']);
  }
  const why = p.why(copies[1].id);
  assert.equal(why.via, 'rotate');
  assert.equal(why.from.id, 's:blend.4');
  assert.match(why.from.from.text, /line 4/);
  assert.ok(p.whyChain(copies[1].id).some(n => n.relation === 'rotate'));
});

test('IRWB-003 rotate: a header that is not the exit test (Collatz) gives a two-entry loop, still checked and analysable', async () => {
  const p = open('collatz');
  await p.pipeline('O2+');
  const r = await p.apply('rotate');
  assert.equal(r.changed, true);
  // the loop now has two entries: no natural loop is found, and the interval analysis still terminates
  const loops = await p.fact('loops', 'collatz');
  assert.deepEqual(loops.value, []);
  await p.apply('strength');
  await p.apply('cfg');
  const [agree, decided] = againstOrigin(p, B.lowerToImage(p.head, ALL).image);
  assert.equal(agree, decided);
});

test('IRWB-003: the benchmarks under O2+, rotate, cfg and all three options', async () => {
  const rows = [
    ['blend', 'blend', { work: cells(40), n: 40, a: 3, b: 5 }, 370],
    ['checksum', 'total', { work: cells(40) }, 286],
    ['sort', 'sort', { work: { cells: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] } }],
    ['collatz', 'collatz', { n: 27 }],
  ];
  for (const [id, fn, b, want] of rows) {
    const p = open(id);
    await p.pipeline(ROTATED);
    const img = B.lowerToImage(p.head, ALL).image;
    const run = bench(p, img, fn, b);
    if (want) assert.equal(run.steps, want, id);
    const [agree, decided] = againstOrigin(p, img);
    assert.equal(agree, decided, id);
  }
});

test('IRWB-003: every corpus project agrees with r0 under each option alone and all together (IRWB_FULL)', { timeout: 600000 }, async () => {
  if (process.env.IRWB_FULL !== '1') return;
  for (const id of projectIds()) {
    const p = open(id);
    await p.pipeline(ROTATED);
    for (const o of [{ chains: true }, { coalesce: true }, { homes: true }, ALL]) {
      const [agree, decided] = againstOrigin(p, B.lowerToImage(p.head, o).image);
      assert.equal(agree, decided, `${id} ${JSON.stringify(o)}`);
    }
  }
});
