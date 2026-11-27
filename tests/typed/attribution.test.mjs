// IRWB-034-D: instruction attribution. `src/typed/attribution.ts` credits every executed RV32 instruction to the
// pass that placed the statement it implements and to the r0 statements that statement descends from, by composing
// the revision chain's correspondences. These tests check the properties the report relies on: the credits add up
// to the run, r0 has no difference against itself, and the two cases the ticket turns on -- a hoist `licm` keeps
// (Blend) and the bytecode VM's dispatch loop, where every hoist is now refused -- are credited or recorded.
import assert from 'node:assert/strict';
import test from 'node:test';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectAllFiles } from '../../tools/corpus.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { benchCase } = await import('../../dist/typed/evaluate.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { lowerToImage, runImage } = await import('../../dist/typed/backend/index.js');
const A = await import('../../dist/typed/attribution.js');

/** The project's r0 store and a call of `fn`, built from a benchCase input spec. */
function caseOf(id, fn, spec) {
  const project = projectSource(id, projectAllFiles(id));
  const p = Program.fromProject(project);
  const c = benchCase(storeOf(p.origin.value), fn, spec);
  return { project, fn, args: c.args, memory: c.memory };
}

/** Run `pipeline` on the project and attribute both ends of its revision chain for the one call. */
async function prepared({ project, fn, args, memory }, pipeline) {
  const p = Program.fromProject(project);
  await p.pipeline(pipeline, { count: 10 });
  const chain = A.chainOf(p);
  const lineage = A.lineageOf(chain);
  const at = chain.length - 1;
  const imageAt = i => lowerToImage(chain[i].artifact, { coalesce: true }).image;
  const runAt = i => runImage(imageAt(i), fn, args, memory);
  const base = runAt(0),
    head = runAt(at);
  const a0 = A.attributeRun(lineage, 0, { image: imageAt(0), counts: base.counts });
  const aN = A.attributeRun(lineage, at, { image: imageAt(at), counts: head.counts });
  return { p, chain, lineage, at, base, head, a0, aN, deltas: A.deltaBetween(a0, aN) };
}

const blend = () =>
  caseOf('blend', 'blend', { work: { buffer: [40, 40], cell: [0, 255] }, n: 40, a: 3, b: 5 });
const fibonacci = () => {
  const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
  const code = project.meta.inputs.runVm.code;
  return caseOf('bytecode-vm', 'runVm', { code, entry: 0, n: 12, seed: 8 });
};
const checksum = () => caseOf('checksum', 'total', { work: { buffer: [40, 40], cell: [0, 255] } });

test('attribution: the credits add up to the run and every root is an r0 statement', async () => {
  const { chain, lineage, base, head, a0, aN } = await prepared(checksum(), 'speed');
  assert.ok(chain.length > 3, 'the pipeline published revisions');
  assert.equal(lineage.gaps, 0, 'every entity of every revision has a correspondence');
  assert.equal(a0.total, base.steps, 'r0: the credits are the executed instructions');
  assert.equal(aN.total, head.steps, 'head: the credits are the executed instructions');
  assert.equal(
    a0.unattributed + aN.unattributed,
    0,
    'every instruction covers a statement its revision holds',
  );
  assert.ok(aN.credits.every(c => c.insns > 0));
  assert.equal(
    aN.credits.reduce((n, c) => n + c.insns, 0),
    head.steps,
    'the rows are the whole run',
  );
  const st0 = storeOf(chain[0].artifact.value);
  for (const c of aN.credits)
    for (const r of c.roots) assert.equal(st0.get(r)?.kind, 'stmt', `${c.statement} roots ${r}`);
});

test('attribution: r0 against itself has no difference, and at r0 everything belongs to the front end', async () => {
  const { lineage, at, a0, aN } = await prepared(checksum(), 'speed');
  assert.deepEqual(A.deltaBetween(a0, a0), [], 'the same revision has no difference against itself');
  assert.deepEqual(
    a0.byPass.map(r => r.pass),
    ['source'],
    'at r0 every statement is the front end’s',
  );
  assert.ok(at > 0);
  void aN;
});

test('attribution: a hoist licm keeps is credited to licm, once, at the preheader count', async () => {
  // Blend's loop computes `a * b + scale`: licm moves it to the preheader, which runs once per call, and the
  // loop body drops the product and the addition from every iteration (2 instructions × 40 iterations).
  const { chain, aN, deltas } = await prepared(blend(), 'O2');
  const hoisted = aN.credits.filter(c => c.pass === 'licm');
  assert.deepEqual(
    hoisted.map(c => [c.statement, c.insns, c.roots.join(',')]),
    [['s:blend.15', 2, 's:blend.10']],
    'the hoisted statement runs 2 instructions once, and descends from the loop body statement',
  );
  assert.match(hoisted[0].note ?? '', /hoisted out of loop:blend/);
  assert.deepEqual(
    deltas.filter(d => d.pass === 'licm').map(d => [d.root, d.base, d.next]),
    [['s:blend.10', 280, 202]],
    'the loop body statement lost 2 instructions per iteration and the preheader added 2',
  );
  assert.ok(chain.some(s => s.pass === 'licm'));
});

test('attribution: in the bytecode VM every licm hoist is refused, and speed is no worse than r0', async () => {
  const { chain, base, head, a0, aN, deltas } = await prepared(fibonacci(), 'speed');
  assert.equal(
    deltas.reduce((n, d) => n + d.delta, 0),
    head.steps - base.steps,
    'the deltas account for the whole difference against r0',
  );
  assert.ok(head.steps <= base.steps, `speed runs ${head.steps} instructions, r0 ${base.steps}`);
  assert.equal(
    aN.credits.filter(c => c.pass === 'licm').length,
    0,
    'no instruction is credited to licm: nothing was hoisted',
  );
  // the refused hoists are in the compiler's own records: one `skip` per value, with the reason
  const skips = chain.flatMap(s => (s.edits ?? []).filter(e => e.kind === 'skip'));
  assert.equal(
    new Set(skips.map(s => s.value)).size,
    15,
    'the 15 loop-invariant addresses of the opcode arms',
  );
  // (two reasons: the head has several natural loops, or the definition is not certain to run every iteration)
  for (const s of skips)
    assert.match(s.why ?? '', /runs once per re-entry|not certain to execute on every iteration/);
  assert.ok(
    deltas.every(d => d.pass !== A.SOURCE || d.next === 0),
    'every difference is credited to a pass, not to the front end',
  );
  void a0;
});
