import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { checkScheduleStep, scheduleTix } from '../../dist/tensor/schedule.js';

const corpus = name => compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const schedule = name => scheduleTix(corpus(name).current.value.functions[0], true);

test('schedule passes link exact revisions and reject changing operand maps or lane ownership', () => {
  const { artifact, steps } = schedule('matmul');
  assert.equal(artifact.kind, 'tensor.schedule');
  assert.deepEqual(steps.map(step => step.changed), [true, true, false]);
  for (const { before, artifact, correspondence } of steps.filter(s => s.changed)) {
    assert.equal(correspondence.from.revision, before.revision);
    assert.equal(correspondence.to.revision, artifact.revision);
    assert.ok(correspondence.entries.some(e => e.from[0] === 'matmul/y' && e.to[0] === 'matmul/y'));
  }
  const { before, correspondence } = steps[1];
  const candidate = structuredClone(artifact);
  candidate.value.groups[0].contractions[0].layout.patch[1] = 0;
  assert.match(checkScheduleStep(before, candidate, correspondence, 'map').reason, /tile is invalid/);
  candidate.value.groups[0].contractions[0].domain.operands.reverse();
  assert.match(checkScheduleStep(before, candidate, correspondence, 'map').reason, /operand maps/);
});

test('lexicographic affine convolution and same-row contractions reach schedule IR', () => {
  const conv = schedule('conv2d').artifact.value.groups[0].contractions[0];
  assert.deepEqual(conv.domain.batch, []);
  assert.deepEqual(conv.domain.row, [0, 2, 3]);
  assert.deepEqual(conv.domain.column, [1]);
  assert.ok(conv.layout.swap);
  const mlp = schedule('mlp').artifact.value.groups[0];
  assert.deepEqual(mlp.partition.phases.map(p => [p.statements, p.contractions[0]?.layout.kind]),
    [[['h', 'g'], 'shared-tile'], [['y'], 'shared-tile']]);
  assert.deepEqual(mlp.inPlace, [{ statement: 'g', over: 'h' }]);
});

test('split sums retain their scalar implementation and unfused source stays independent of the strategy', () => {
  const { program } = optimizeTix(corpus('matmul'), ['split-sum']);
  assert.equal(scheduleTix(program.current.value.functions[0], true).steps[0].changed, false);
  assert.doesNotMatch(cudaSource(program, 'matmul'), /TileMode/);
  assert.doesNotMatch(cudaSource(corpus('matmul'), 'matmul', { fuse: false }), /TileMode/);
});

test('the phased route must retain intermediate tensors and statement order', () => {
  const { artifact, steps } = schedule('attention');
  const { before, correspondence } = steps[2];
  const candidate = structuredClone(artifact);
  candidate.value.groups[0].partition.materialized = ['out'];
  assert.match(checkScheduleStep(before, candidate, correspondence, 'partition').reason, /cross-phase reads/);
});
