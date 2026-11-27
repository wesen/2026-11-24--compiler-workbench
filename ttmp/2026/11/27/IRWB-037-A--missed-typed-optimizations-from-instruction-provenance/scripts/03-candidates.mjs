// Compare checked passes and a verified narrow Horner rewrite on the same fixture calls.
import assert from 'node:assert/strict';
import { fixtureCases, load, reference, tuned } from './01-measure.mjs';
const dist = '../../../../../../dist/typed/';
const { Program } = await import(dist + 'program.js');
const { agrees } = await import(dist + 'evaluate.js');
const { lowerToImage, runImage } = await import(dist + 'backend/index.js');
const { PIPELINES, simplify, typedPass } = await import(dist + 'passes.js');
const { tableBody } = await import(dist + 'rules/compile.js');
const { SIMPLIFY_RULES } = await import(dist + 'rules/simplify.js');
const { verifyRule } = await import(dist + 'rules/verify.js');

const horner = SIMPLIFY_RULES.rules.find(r => r.name === 'horner31-mask15');
const withoutHorner = typedPass({
  ...simplify.typed,
  body: tableBody(SIMPLIFY_RULES.rules.filter(rule => rule !== horner)),
});
const proof = verifyRule(horner);
assert.equal(proof.verdict, 'sound');
console.log(JSON.stringify(proof));
const firings = new Map();
const candidate = typedPass({
  name: 'masked-horner-probe', about: horner.note, writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops'], body: tableBody([horner], firings),
});

for (const id of process.argv.slice(2)) {
  const ps = load(id), program = Program.fromProject(ps);
  const cases = fixtureCases(id, program);
  const ref = reference(ps);
  const expected = cases.map(c => runImage(ref, c.fn, c.args, c.memory, { counts: false }));
  function steps(options) {
    const image = lowerToImage(program.head, options).image;
    return cases.reduce((n, c, i) => {
      const result = runImage(image, c.fn, c.args, c.memory, { counts: false });
      assert.ok(agrees(expected[i], result), `${id} case ${i}`);
      return n + result.steps;
    }, 0);
  }
  for (const pipeline of ['O2', 'speed']) {
    program.checkout(0);
    // Reproduce the BCE-only intermediate compiler using the same pass table with one rule omitted.
    const resolve = pass => pass === 'simplify' ? withoutHorner : pass;
    for (const pass of PIPELINES[pipeline]) await program.apply(resolve(pass));
    const head = program.rev;
    const choices = [[], ['lvn', 'dce', 'cfg'], ['bcm', 'simplify', 'fold'], [candidate]];
    for (const choice of choices) {
      program.checkout(head);
      const results = [];
      firings.clear();
      for (const pass of choice) {
        try { results.push(await program.apply(resolve(pass))); }
        catch (error) { results.push({ pass: typeof pass === "string" ? pass : pass.typed.name, error: error.message }); break; }
      }
      console.log(JSON.stringify({ id, pipeline, results, firings: Object.fromEntries(firings),
        default: steps({}), tuned: steps(tuned) }));
    }
  }
}
