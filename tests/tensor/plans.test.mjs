// IRWB-057 (K6): fusion and loop scheduling as decide, eligible, prepare. The plans are data; `eligible` is the
// trusted check. Covered here:
//   - the extent-17 counterexample (reviewer B's probe r3-b-05-reduction-order.mjs): a strip-mined reduction whose
//     inner loop runs outside its outer loop passes T6's three simulated extents and changes an f32 sum at extent 17;
//   - `eligible` against an enumeration of the nest (the oracle below) over all loop orders of small nests;
//   - fusion and loop plans through serialization, and the strategy plan through its own;
//   - every plan the corpus and the test programs produce is eligible;
//   - the manifest printed with the CUDA source.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { applyTransformationSync } from '../../dist/framework/passes/index.js';
import { deserialize, executeSync, serialize } from '../../dist/framework/strategy/index.js';
import { compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { decodeCudaCases, runCudaBatch } from '../../dist/tensor/cuda-runtime.js';
import { emitScheduleProgram, emittedKernels } from '../../dist/tensor/cuda-source.js';
import { decideFusion, fusionEligible, fusionPlan, planFusion } from '../../dist/tensor/fusion.js';
import * as S from '../../dist/tensor/schedule.js';
import {
  chooseFusion,
  chooseLoops,
  lowerSchedule,
  scheduleFunction,
  schedulePlan,
  scheduleRegistry,
} from '../../dist/tensor/strategy.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const corpusNames = readdirSync(new URL('../../corpus/tensor/', import.meta.url));
const corpus = name => compileTix(read(`../../corpus/tensor/${name}/main.tix`)).current.value.functions[0];
const fnOf = text => compileTix(text).current.value.functions[0];

// The oracle: the order in which a nest visits the values of one dim at a concrete extent. A loop of level l steps
// by the product of the deeper levels' factors; level 0 runs ceil(extent / step) times; a point at or past the
// extent is skipped. (This is T6's `simulate`, which the schedule module no longer has.)
function visited(loops, dim, extent) {
  const nest = loops.filter(l => l.dim === dim);
  const step = nest.map(l => nest.filter(x => x.level > l.level).reduce((p, x) => p * x.factor, 1));
  const trips = nest.map((l, i) => l.factor ?? Math.ceil(extent / step[i]));
  const out = [];
  const walk = (depth, at) => {
    if (depth === nest.length) return void (at < extent && out.push(at));
    for (let i = 0; i < trips[depth]; i++) walk(depth + 1, at + i * step[depth]);
  };
  walk(0, 0);
  return out;
}
const loop = (dim, level = 0, factor = null, bind = 'serial') => ({
  id: `${dim}.${level}`,
  dim,
  level,
  factor,
  bind,
});
const inOrder = (order, extent) => order.length === extent && order.every((k, i) => k === i);

test('the extent-17 counterexample is rejected: a strip-mined reduction with its inner loop outside', () => {
  // T6's variant: r.1 (16 iterations) outside r.0
  const swapped = { loops: [loop('b'), loop('m'), loop('n'), loop('r', 1, 16), loop('r')], stages: [] };
  // the three extents T6's validator simulated (11, 1 and 0 terms) all give the source's order
  for (const extent of [11, 1, 0]) assert.ok(inOrder(visited(swapped.loops, 'r', extent), extent), extent);
  // at 17 the order is 0, 16, 1, 2, ..., and an f32 sum differs
  const order = visited(swapped.loops, 'r', 17);
  assert.deepEqual(order.slice(0, 3), [0, 16, 1]);
  const terms = new Float32Array(17);
  terms[0] = 2 ** 24;
  terms[1] = -(2 ** 24);
  terms[16] = 1;
  const fold = indices => indices.reduce((sum, k) => Math.fround(sum + terms[k]), 0);
  assert.equal(fold([...terms.keys()]), 1);
  assert.equal(fold(order), 0);
  // eligible rejects it, whatever extents a test would have tried
  assert.match(S.accumulationViolation(swapped), /loop r.1 is outside the loops that order it/);
  const fn = corpus('matmul');
  const schedule = S.initialSchedule(fn);
  const plan = { kernels: [{ kernel: 'k0', variants: [swapped], select: [{ variant: 0, minBlocks: 0 }] }] };
  assert.deepEqual(S.loopsEligible(schedule.value, plan), {
    ok: false,
    reason:
      'k0 variant 0: loop r.1 is outside the loops that order it (nest b.0 m.0 n.0 r.1 r.0, dependence = = = < *): ' +
      "an output would not accumulate its terms in the source's order",
  });
  assert.throws(() => applyTransformationSync(S.loopsPass, schedule, { params: plan }), { code: 'illegal' });
  // the canonical order of the same loops is eligible
  const canonical = { loops: [...swapped.loops.slice(0, 3), loop('r'), loop('r', 1, 16)], stages: [] };
  plan.kernels[0].variants = [canonical];
  assert.deepEqual(S.loopsEligible(schedule.value, plan), { ok: true });
  assert.ok([0, 1, 11, 16, 17, 33].every(extent => inOrder(visited(canonical.loops, 'r', extent), extent)));
});

test('eligible agrees with the enumerated order on every loop order of small nests', () => {
  const permutations = list =>
    list.length < 2
      ? [list]
      : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map(p => [x, ...p]));
  // Extents up to twice the product of the fixed factors, plus one: a wrong order of two levels shows as soon as
  // the outer one has two iterations with the inner one complete, which needs at most that many terms.
  const nests = [
    [loop('b'), loop('m'), loop('n'), loop('r'), loop('r', 1, 4)],
    [loop('b'), loop('m'), loop('n'), loop('r'), loop('r', 1, 2), loop('r', 2, 3)],
    [loop('b'), loop('m'), loop('m', 1, 2), loop('n'), loop('r'), loop('r', 1, 3)],
  ];
  let accepted = 0,
    rejected = 0;
  for (const nest of nests) {
    const fixed = nest.reduce((p, l) => p * (l.factor ?? 1), 1);
    for (const loops of permutations(nest)) {
      const why = S.accumulationViolation({ loops, stages: [] });
      const extents = Array.from({ length: 2 * fixed + 2 }, (_, e) => e);
      const ordered = extents.every(e => inOrder(visited(loops, 'r', e), e));
      // every output dim is covered once in any order
      for (const d of ['b', 'm', 'n'])
        for (const e of [0, 1, 5])
          assert.deepEqual(
            visited(loops, d, e).sort((x, y) => x - y),
            Array.from({ length: e }, (_, i) => i),
          );
      assert.equal(why === undefined, ordered, loops.map(l => l.id).join(' ') + ': ' + why);
      why ? rejected++ : accepted++;
    }
  }
  // r.0 before r.1 in half of 120 orders; r.0, r.1, r.2 in order in a sixth of 720; r.0 before r.1 in half of 720
  assert.deepEqual([accepted, rejected], [60 + 120 + 360, 60 + 600 + 360]);
  // a parallel binding of a reduction loop is a dependence between concurrent iterations
  const bound = { loops: [loop('b'), loop('m'), loop('n'), loop('r', 0, null, 'thread.x')], stages: [] };
  assert.match(S.accumulationViolation(bound), /r.0 is bound to thread.x.*reassociation/);
  const outputs = ['b', 'm', 'n'].map(d => loop(d, 0, null, 'thread'));
  assert.equal(S.accumulationViolation({ loops: [...outputs, loop('r')], stages: [] }), undefined);
});

// Every function the corpus, the fixtures and the tensor tests' inline programs define, also after the Tix passes.
function everyFunction() {
  const sources = corpusNames.map(n => read(`../../corpus/tensor/${n}/main.tix`));
  const dir = new URL('./', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.test.mjs')))
    for (const m of read('./' + file).matchAll(/fn \w+\([^)]*\)\s*:\s*f32[^{]*\{[^}]*\}/g))
      sources.push(m[0]);
  for (const f of readdirSync(new URL('./fixtures/', import.meta.url)))
    if (f.endsWith('.tix')) sources.push(read('./fixtures/' + f));
  const functions = [];
  for (const text of sources) {
    let p;
    try {
      p = compileTix(text.replaceAll('\\n', '\n'));
    } catch {
      continue; // a test's deliberately invalid program
    }
    for (const q of [p, optimizeTix(p, ['inline']).program, optimizeTix(p, ['inline', 'split-sum']).program])
      functions.push(...q.current.value.functions);
  }
  return functions;
}

test('eligible accepts every plan the corpus and the test programs produce; the plans round-trip as JSON', () => {
  const functions = everyFunction();
  let groups = 0,
    fused = 0,
    variants = 0;
  const decisionOf = (execution, node) =>
    execution.records.find(r => r.nodeId === node).evidence.find(e => e.label === 'analysis').data.value;
  for (const fn of functions) {
    const { schedule, execution } = scheduleFunction(fn, true);
    assert.equal(execution.status, 'succeeded');
    // the decisions are in the execution's records, as data
    const fusion = decisionOf(execution, 'decide-fuse'),
      loops = decisionOf(execution, 'decide-loops');
    assert.deepEqual(fusion, chooseFusion(fn));
    const initial = S.initialSchedule(fn);
    assert.deepEqual(fusionEligible(fn, fusion), { ok: true }, fn.name);
    // through JSON and back: the same value, still eligible, and applying it gives the same schedule
    const fusion2 = JSON.parse(JSON.stringify(fusion)),
      loops2 = JSON.parse(JSON.stringify(loops));
    assert.deepEqual(fusion2, fusion);
    assert.deepEqual(loops2, loops);
    const grouped = applyTransformationSync(S.fusePass, initial, { params: fusion2 }).artifact;
    assert.deepEqual(S.loopsEligible(grouped.value, loops2), { ok: true }, fn.name);
    assert.deepEqual(loops2, JSON.parse(JSON.stringify(chooseLoops(grouped.value))));
    const scheduled = applyTransformationSync(S.loopsPass, grouped, { params: loops2 }).artifact;
    assert.equal(scheduled.revision, schedule.revision, fn.name);
    // the greedy grouping and stage 2's are eligible too, and planFusion is the greedy choice applied
    assert.deepEqual(fusionEligible(fn, decideFusion(fn)), { ok: true });
    assert.deepEqual(fusionPlan(fn, decideFusion(fn)), planFusion(fn));
    assert.deepEqual(fusionEligible(fn, { groups: initial.value.kernels.map(k => k.group), refusals: [] }), {
      ok: true,
    });
    groups += fusion.groups.length;
    fused += fusion.groups.filter(g => g.statements.length > 1).length;
    variants += loops.kernels.reduce((n, k) => n + k.variants.length, 0);
  }
  // the test is not vacuous: fused groups and tiled variants are among the plans
  assert.ok(
    functions.length > 100 && fused > 20 && variants > 40,
    `${functions.length} ${groups} ${fused} ${variants}`,
  );
  for (const name of corpusNames) assert.ok(functions.some(f => f.name === corpus(name).name));
});

test('the strategy plan is data: it round-trips through serialization and runs to the same schedule', () => {
  const text = serialize(schedulePlan);
  const again = deserialize(text, scheduleRegistry);
  assert.deepEqual(again, schedulePlan);
  assert.deepEqual(
    again.root.steps.map(n => [n.kind, n.id, (n.algorithm ?? n.analysis).id]),
    [
      ['require', 'decide-fuse', 'tensor.schedule.decide-fuse'],
      ['apply', 'fuse', 'tensor.schedule.fuse'],
      ['require', 'decide-loops', 'tensor.schedule.decide-loops'],
      ['apply', 'loops', 'tensor.schedule.loops'],
    ],
  );
  for (const name of corpusNames) {
    const fn = corpus(name);
    const execution = executeSync(again, scheduleRegistry, S.initialSchedule(fn));
    assert.equal(execution.status, 'succeeded');
    assert.equal(execution.value.revision, lowerSchedule(fn, true).revision, name);
  }
});

test('fusion: eligible refuses a grouping that is not legal on the function', () => {
  const fn = fnOf(
    'fn f(x:f32[N,N]):f32[N,N] { s[i] = sum(j) x[i,j]; y[i,j] = x[i,j] - s[i]; z[i,j] = y[j,i] + s[j]; return z; }',
  );
  const group = (statements, depth) => ({ statements, depth, reasons: [] });
  const check = (...groups) => fusionEligible(fn, { groups, refusals: [] });
  assert.deepEqual(
    chooseFusion(fn).groups.map(g => [g.statements.join(), g.depth]),
    [
      ['s,y', 1],
      ['z', 2],
    ],
  );
  assert.deepEqual(check(group(['s', 'y'], 1), group(['z'], 2)), { ok: true });
  assert.deepEqual(check(group(['s'], 1), group(['y'], 2), group(['z'], 2)), { ok: true });
  // z reads y and s at another row: a transposed read has a non-zero distance in the block domain
  assert.match(
    check(group(['s', 'y', 'z'], 1)).reason,
    /z reads y at index i\d+ in position 0, not its own axis/,
  );
  assert.match(check(group(['s'], 1), group(['y', 'z'], 1)).reason, /z reads y at index i\d+ in position 0/);
  // the domain is no deeper than a member's rank, and not empty
  assert.match(check(group(['s', 'y'], 2), group(['z'], 2)).reason, /s has 1 axes, group 0's domain has 2/);
  assert.match(check(group(['s', 'y'], 0), group(['z'], 2)).reason, /shares no leading axis/);
  assert.match(check(group(['s'], 0), group(['y'], 2), group(['z'], 2)).reason, /s is alone in group 0/);
  // the groups are the statements in source order, each once
  assert.match(check(group(['y', 's'], 1), group(['z'], 2)).reason, /not the statements s, y, z in order/);
  assert.match(check(group(['s', 'y'], 1)).reason, /not the statements s, y, z in order/);
  assert.match(check(group(['s', 'y'], 1), group([], 0), group(['z'], 2)).reason, /group 1 is empty/);
  // unequal extents are not one domain
  const g = fnOf('fn g(x:f32[N], w:f32[M]):f32[M] { a[i] = x[i] * 2; b[j] = w[j] + sum(k) a[k]; return b; }');
  assert.match(
    fusionEligible(g, { groups: [group(['a', 'b'], 1)], refusals: [] }).reason,
    /axis 0 of b has extent M, group 0's N/,
  );
  // the transformation refuses before preparing, and once loops are scheduled
  const initial = S.initialSchedule(fn);
  assert.throws(
    () =>
      applyTransformationSync(S.fusePass, initial, {
        params: { groups: [group(['s', 'y', 'z'], 1)], refusals: [] },
      }),
    { code: 'illegal', message: /z reads y/ },
  );
  const matmul = lowerSchedule(corpus('matmul'), true);
  assert.throws(
    () => applyTransformationSync(S.fusePass, matmul, { params: chooseFusion(corpus('matmul')) }),
    {
      code: 'illegal',
      message: /already scheduled/,
    },
  );
});

test('the manifest is printed with the source and names the gates and variants the runtime uses', async () => {
  const kernelsOf = name => emitScheduleProgram(lowerSchedule(corpus(name), true).value).kernels;
  assert.deepEqual(kernelsOf('attention'), [
    { name: 'k0', mapping: 'tiled', statements: ['score'], variants: 4 },
    { name: 'k1', mapping: 'block', statements: ['shift', 'e', 'z', 'weight'], gated: true },
    { name: 'k2', mapping: 'tiled', statements: ['out'], variants: 4 },
  ]);
  for (const name of corpusNames) {
    const program = compileTix(read(`../../corpus/tensor/${name}/main.tix`));
    const fn = program.current.value.functions[0];
    for (const fuse of [true, false]) {
      const source = cudaSource(program, fn.name, { fuse });
      const kernels = emittedKernels(source);
      assert.deepEqual(kernels, emitScheduleProgram(lowerSchedule(fn, fuse).value).kernels);
      // what the manifest says is what the program does: one reported choice per gated kernel, --variant if any
      const reported = [...source.matchAll(/const unsigned char choice = fused_(\w+) \?/g)].map(m => m[1]);
      assert.deepEqual(
        kernels.filter(k => k.gated).map(k => k.name),
        reported,
        name,
      );
      assert.equal(
        kernels.some(k => k.variants),
        source.includes('"--variant="'),
        name,
      );
      assert.equal(
        kernels.some(k => k.gated) || kernels.some(k => k.variants),
        source.includes('"--gate=fused"'),
      );
      if (!fuse) assert.ok(kernels.every(k => k.mapping === 'thread' && !k.gated && !k.variants));
    }
  }
  assert.equal(emittedKernels('some other text'), undefined);
  // a source without a manifest is refused before anything is run
  await assert.rejects(
    runCudaBatch('int main() {}', corpus('softmax'), []),
    /No manifest for this CUDA source/,
  );
  // the decoder takes the gate names in manifest order
  const response = Buffer.alloc(16 + 8 + 4 + 8 + 2);
  response.write('TIXCUDA1');
  response.writeBigUInt64LE(1n, 8);
  response.writeBigUInt64LE(1n, 16);
  response[16 + 8 + 4 + 8 + 1] = 1;
  const gates = kernelsOf('attention')
    .filter(k => k.gated)
    .map(k => k.name);
  assert.deepEqual(decodeCudaCases(response, 1, 1, [...gates, 'k9'])[0].gates, {
    k1: 'unfused',
    k9: 'fused',
  });
});
