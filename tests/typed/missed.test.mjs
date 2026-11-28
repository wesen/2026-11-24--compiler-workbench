// IRWB-037-G: hot shapes by provenance (src/typed/missed.ts): the tables sum to the emulator's count, and
// "untouched" means no pass is named in the origins of a statement or of the values under it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAllFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { benchCase } = await import('../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../dist/typed/backend/index.js');
const { hotShapes, formatHotShapes, stmtShape } = await import('../../dist/typed/missed.js');
const { SIMPLIFY_RULES } = await import('../../dist/typed/rules/simplify.js');

const open = () => Program.fromProject(projectSource('regex-nfa', projectAllFiles('regex-nfa')));
/** The record chain from r0 to the head: what `hotShapes` reads a site's provenance from (IRWB-065-B). */
const chainOf = p =>
  p.revisions.slice(1).map(r => ({ label: r.pass, correspondence: r.correspondence, derivation: r.derivation }));
const input = { pattern: { string: '[a-c]*[b-d]*a*d' }, text: { string: 'abccabbd' } };
const sum = (rows, k) => rows.reduce((n, r) => n + r[k], 0);

test('at r0 every executed instruction of a statement is untouched, and both tables sum to the run', () => {
  const p = open();
  const call = benchCase(storeOf(p.origin.value), 'regexMatch', input);
  const steps = runImage(lowerToImage(p.head).image, call.fn, call.args, call.memory).steps;
  assert.equal(steps, 8183);
  const h = hotShapes(p.head, [call], { rules: SIMPLIFY_RULES.rules });
  assert.equal(h.total, steps);
  for (const table of [h.statements, h.nodes]) {
    assert.equal(sum(table, 'instructions') + h.frame, steps);
    assert.equal(sum(table, 'untouched'), sum(table, 'instructions'));
    for (const r of table) {
      assert.deepEqual(Object.keys(r.provenance), ['ingest']);
      assert.equal(sum(Object.entries(r.provenance).map(([, n]) => ({ n })), 'n'), r.instructions);
    }
  }
  // two calls count twice
  assert.equal(hotShapes(p.head, [call, call]).total, 2 * steps);
});

test('after speed the constant bounds checks that remain are the hottest untouched shape, and rows name their passes', async () => {
  const p = open();
  const run = await p.pipeline('speed', { count: 10 });
  assert.deepEqual(run.steps.filter(s => s.rejected), []);
  const call = benchCase(storeOf(p.origin.value), 'regexMatch', input);
  const h = hotShapes(p.head, [call], { chain: chainOf(p), rules: SIMPLIFY_RULES.rules });
  assert.equal(h.total, runImage(lowerToImage(p.head).image, call.fn, call.args, call.memory).steps);
  assert.equal(sum(h.statements, 'instructions') + h.frame, h.total);
  assert.equal(sum(h.nodes, 'instructions') + h.frame, h.total);
  const checks = h.statements.find(r => r.shape === 'if geu(x, #)');
  assert.ok(checks && checks === [...h.statements].sort((a, b) => b.untouched - a.untouched)[0]);
  assert.ok(checks.untouched > 0.9 * checks.instructions);
  assert.equal(stmtShape(storeOf(p.head.value), checks.example.id), 'if geu(x, #)');
  // a statement licm rewrote is not untouched, and its row says licm
  const hoisted = h.statements.find(r => r.shape === 'if eq(load(add(x, shl(x, #))), 1)');
  assert.ok(hoisted && hoisted.untouched === 0 && hoisted.provenance.licm > 0);
  // node patterns carry the number of table rules with their root operator
  const node = h.nodes.find(r => r.shape === 'if geu(x, #)');
  assert.equal(node.rules, SIMPLIFY_RULES.rules.filter(r => r.lhs.op === 'geu').length);
  const text = formatHotShapes(h, 5);
  assert.match(text, /statement shapes/);
  assert.match(text, /node patterns/);
});

test('guards removes the checks the table showed: fewer instructions in the shape than with the old speed list', async () => {
  const { PIPELINES } = await import('../../dist/typed/passes.js');
  const call = benchCase(storeOf(open().origin.value), 'regexMatch', input);
  const measure = async list => {
    const p = open();
    for (const pass of list) await p.apply(pass, { count: 10 });
    const h = hotShapes(p.head, [call], { chain: chainOf(p) });
    return { total: h.total, checks: h.statements.find(r => r.shape === 'if geu(x, #)').instructions };
  };
  const now = await measure(PIPELINES.speed);
  const without = await measure(PIPELINES.speed.filter(n => n !== 'guards'));
  assert.ok(now.checks < without.checks, `${now.checks} < ${without.checks}`);
  assert.ok(now.total < without.total);
  assert.ok(now.total < 6628, `below the reference compiler's 6,628: ${now.total}`);
});

test('provenance is a query over the records: a head above r0 without its chain is refused', async () => {
  const p = open();
  await p.pipeline('speed', { count: 10 });
  const call = benchCase(storeOf(p.origin.value), 'regexMatch', input);
  assert.throws(() => hotShapes(p.head, [call]), /pass the correspondence chain from r0/);
  // with the chain, a site licm rewrote says licm; the same program without the chain cannot be asked
  const withChain = hotShapes(p.head, [call], { chain: chainOf(p) });
  assert.ok(withChain.statements.some(r => r.provenance.licm > 0));
});
