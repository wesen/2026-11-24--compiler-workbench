import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, cudaSource } from '../../dist/tensor/index.js';
import { lowerToSchedule, sidesOf } from '../../dist/tensor/cuda-contract.js';
import { emitSchedule, tileModes } from '../../dist/tensor/cuda-source.js';
import { contractionOf, ScheduleIR } from '../../dist/tensor/schedule.js';
import { runSchedule, scheduleGate, scheduleSides } from '../../dist/tensor/schedule-eval.js';
import {
  buildSchedule,
  fusedPlan,
  initialSchedule,
  passes,
  scheduleArtifact,
  unfusedStrategy,
} from '../../dist/tensor/schedule-passes.js';
import { applyNativePassSync } from '../../dist/framework/passes/index.js';
import * as S from '../../dist/framework/strategy/index.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const fnOf = source => compileTix(source).current.value.functions[0];
const kinds = schedule => schedule.kernels.map(k => [k.kind, k.statements.join(',')]);
const open = () => ({ ok: true });

test('the fused schedule: contractions are tile kernels of their own, the rest keeps stage 3b', () => {
  const schedule = name => lowerToSchedule(corpus(name).current.value.functions[0], true).schedule.value;
  assert.deepEqual(kinds(schedule('matmul')), [['tile', 'y']]);
  assert.deepEqual(kinds(schedule('softmax')), [['block', 'm,e,s,y']]);
  assert.deepEqual(kinds(schedule('attention')), [
    ['tile', 'score'],
    ['block', 'shift,e,z,weight'],
    ['tile', 'out'],
  ]);
  assert.deepEqual(kinds(schedule('mlp')), [
    ['tile', 'h'],
    ['thread', 'g'],
    ['tile', 'y'],
  ]);
  const conv = schedule('conv2d').kernels[0];
  assert.equal(conv.kind, 'tile');
  // rows n, y, xpos (read by x only), column o (read by kernel only)
  assert.deepEqual([conv.roles.rows.length, conv.roles.cols.length, conv.roles.batch.length], [3, 1, 0]);
  assert.deepEqual(schedule('matmul').kernels[0].configs, [
    { tile: [64, 64], patch: [4, 4], chunk: 16, staged: true, minTiles: 64, minTerms: 64 },
    { tile: [32, 32], patch: [2, 2], chunk: 32, staged: true, minTiles: 64, minTerms: 64 },
  ]);
  // the softmax part of attention keeps its staged row, in-place rows and gate
  const block = schedule('attention').kernels[1];
  assert.deepEqual([block.staged, block.inPlace.length, block.gate.fullRow], [['score'], 1, 96]);
  // fuse: false is the initial schedule
  const unfused = lowerToSchedule(corpus('attention').current.value.functions[0], false);
  assert.equal(unfused.schedule.revision, unfused.initial.revision);
  assert.equal(
    unfused.schedule.value.kernels.every(k => k.kind === 'thread' && k.statements.length === 1),
    true,
  );
});

test('what is and is not a contraction', () => {
  const roles = source => {
    const c = contractionOf(fnOf(source).statements[0]);
    return 'refused' in c ? c.refused : [c.roles.rows.length, c.roles.cols.length, c.roles.batch.length];
  };
  assert.deepEqual(
    roles('fn f(a:f32[B,M,K], b:f32[B,K,N]):f32[B,M,N] { y[t,i,j] = sum(k) a[t,i,k] * b[t,k,j]; return y; }'),
    [1, 1, 1],
  );
  assert.deepEqual(
    roles(
      'fn f(a:f32[M,K], b:f32[N,K]):f32[M,N] { y[i,j] = (sum(k) (a[i,k] - 1) * b[j,k]) + a[i,0]; return y; }',
    ),
    [1, 1, 0],
  );
  assert.match(
    roles('fn f(a:f32[M,K], x:f32[K]):f32[M] { y[i] = sum(k) a[i,k] * x[k]; return y; }'),
    /no row axis or no column axis/,
  );
  assert.match(
    roles('fn f(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = max(k) a[i,k] * b[k,j]; return y; }'),
    /not a sum/,
  );
  assert.match(
    roles('fn f(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[i,k] + b[k,j]; return y; }'),
    /not a product/,
  );
  assert.match(
    roles(
      'fn f(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = (sum(k) a[i,k] * b[k,j]) + sum(k) a[i,k]; return y; }',
    ),
    /2 outermost reductions/,
  );
});

test('every step is a checked revision: the interpreter gives the f32 meaning on every side', () => {
  const f = fnOf(
    'fn f(a:f32[M,K], b:f32[N,K], c:f32[N]):f32[M,N] { y[i,j] = (sum(k) a[i,k] * b[j,k]) + c[j]; z[i,j] = y[i,j] * 2; return z; }',
  );
  const built = buildSchedule(f, fusedPlan, { check: true });
  const changed = built.steps.filter(s => s.changed);
  assert.deepEqual(
    changed.map(s => s.pass.replace('tensor.sched.', '')),
    [
      'mark-contractions',
      'tile',
      'register-tile',
      'stage-operands',
      'tile',
      'register-tile',
      'stage-operands',
    ],
  );
  // two configurations and stage 2's mapping: three sides, each run on every sample
  assert.equal(changed.at(-1).check.sides, 3);
  assert.ok(changed.at(-1).check.runs >= 3 * 10);
  assert.deepEqual(
    scheduleSides(built.schedule.value).map(s => s.tile),
    [0, 1, 2],
  );
  assert.equal(new Set(built.steps.filter(s => s.changed).map(s => s.revision)).size, changed.length);
  // the asynchronous strategy interpreter cannot be used by the synchronous cudaSource; the plan is the same data
  assert.equal(S.validate(fusedPlan).valid, true);
  assert.equal(buildSchedule(f, unfusedStrategy).steps.length, 0);
});

test('legality is decided from the IR before a step is applied, and the validator re-checks it', () => {
  const f = fnOf('fn f(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[i,k] * b[k,j]; return y; }');
  const apply = (pass, artifact, params) => applyNativePassSync(pass, artifact, open, params).artifact;
  const marked = apply(passes.markContractions, scheduleArtifact(initialSchedule(f)));
  // a 64 x 64 tile with one thread per element is not a block
  assert.throws(
    () => apply(passes.tile, marked, { tile: [64, 64], minTiles: 1, minTerms: 1 }),
    /more than 1,024 threads/,
  );
  const tiled = apply(passes.tile, marked, { tile: [16, 16], minTiles: 1, minTerms: 1 });
  assert.throws(() => apply(passes.registerTile, tiled, { patch: [16, 16] }), /more than 64 accumulators/);
  const patched = apply(passes.registerTile, tiled, { patch: [4, 4] });
  assert.deepEqual(patched.value.kernels[0].configs[0].tile, [64, 64]);
  assert.throws(
    () => apply(passes.stageOperands, patched, { chunk: 128 }),
    /exceeds the block's default shared memory/,
  );
  // each intermediate schedule prints and passes the interpreter's check
  for (const artifact of [tiled, patched, apply(passes.stageOperands, patched, { chunk: 16 })]) {
    assert.equal(scheduleGate(marked, artifact).ok, true);
    assert.equal(tileModes(emitSchedule(artifact.value)), 1);
  }
  // hand-made illegal schedules are not artifacts
  const base = lowerToSchedule(corpus('attention').current.value.functions[0], true).schedule.value;
  const mutate = change => {
    const copy = JSON.parse(JSON.stringify(base));
    change(copy);
    return () => ScheduleIR.validate(copy);
  };
  assert.throws(
    mutate(s => (s.kernels[0].stored = [])),
    /reads score, which k0 does not store/,
  );
  assert.throws(
    mutate(s => (s.kernels[0].roles.rows = s.kernels[0].roles.cols)),
    /roles differ/,
  );
  assert.throws(
    mutate(s => s.kernels[1].inPlace.push({ statement: 'shift', over: 'score' })),
    /written over score, which is read later/,
  );
  assert.throws(
    mutate(s => s.kernels.reverse()),
    /statements in order/,
  );
  assert.throws(
    mutate(s => (s.kernels[2].configs[0].patch = [3, 4])),
    /does not divide/,
  );
});

test('the interpreter follows the schedule: staged tiles at shapes that cross tiles and chunks', () => {
  const p = corpus('matmul');
  const { schedule } = lowerToSchedule(p.current.value.functions[0], true);
  let seed = 7;
  const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  const tensor = shape => ({ shape, data: Float32Array.from({ length: shape[0] * shape[1] }, next) });
  const inputs = { a: tensor([70, 45]), b: tensor([45, 67]) };
  const plain = runSchedule(schedule.value, inputs, { tile: 2, gate: 'fused' });
  for (const tile of [0, 1])
    assert.deepEqual(runSchedule(schedule.value, inputs, { tile, gate: 'fused' }).data, plain.data);
});

test('the printed source: one definition per schedule kernel, configurations as template modes, forced by --tile', () => {
  const source = cudaSource(corpus('matmul'), 'matmul');
  assert.equal((source.match(/__global__ void/g) ?? []).length, 1);
  assert.match(source, /template <int Mode>\n__global__ void k0\(/);
  assert.match(source, /constexpr int TM = Mode == 0 \? 64 : Mode == 1 \? 32 : 1/);
  assert.match(source, /acc\[r\]\[q\] = __fadd_rn\(acc\[r\]\[q\], __fmul_rn\(av\[r\], bv\[q\]\)\);/);
  assert.match(
    source,
    /tiles_k0_0 >= 64 && terms_k0 >= 64 \? 0 : tiles_k0_1 >= 64 && terms_k0 >= 64 \? 1 : 2/,
  );
  assert.match(source, /k0<0><<<static_cast<unsigned>\(tiles_k0_0\), 256, 8192>>>/);
  assert.match(source, /"--tile="/);
  assert.equal(tileModes(source), 2);
  assert.deepEqual(sidesOf(source), [{ tile: 0 }, { tile: 1 }, { tile: 2 }]);
  // attention: both gate sides and all tile modes in three runs
  assert.deepEqual(sidesOf(cudaSource(corpus('attention'), 'attention')), [
    { gate: 'fused', tile: 0 },
    { gate: 'unfused', tile: 1 },
    { gate: 'fused', tile: 2 },
  ]);
  assert.deepEqual(sidesOf(cudaSource(corpus('softmax'), 'softmax')), [
    { gate: 'fused' },
    { gate: 'unfused' },
  ]);
  assert.deepEqual(sidesOf(cudaSource(corpus('matmul'), 'matmul', { fuse: false })), [{}]);
});
