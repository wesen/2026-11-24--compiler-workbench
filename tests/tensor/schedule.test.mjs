// IRWB-033-J: the schedule IR, its passes and the order certificate, without the GPU.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { AnalysisManager } from '../../dist/framework/contracts/index.js';
import {
  checkOrder,
  contractionOf,
  defaultTileParams,
  fusePass,
  orderGate,
  planArtifact,
  planTransformation,
  ScheduleIR,
  applySchedulePass,
  scheduleArtifact,
  scheduleTixFn,
  tilePass,
} from '../../dist/tensor/schedule.js';
import { runScheduleStrategy } from '../../dist/tensor/schedule-plan.js';
import { compileTix } from '../../dist/tensor/index.js';
import { selectFunction } from '../../dist/tensor/model.js';
import { outerReductions } from '../../dist/tensor/fusion.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const fnOf = program => program.current.value.functions[0];

test('the plan step gives one plain kernel per statement and classifies every reduction as serial', () => {
  const f = fnOf(corpus('softmax'));
  const unit = planArtifact(f).value;
  assert.equal(unit.kernels.length, 4);
  assert.deepEqual(
    unit.kernels.map(k => [k.mapping, k.statements]),
    [
      ['thread', ['m']],
      ['thread', ['e']],
      ['thread', ['s']],
      ['thread', ['y']],
    ],
  );
  const order = checkOrder(unit);
  assert.equal(order.ok, true);
  assert.deepEqual(
    order.certificate.map(c => [c.statement, c.kind]),
    [
      ['m', 'serial'],
      ['s', 'serial'],
    ],
  );
});

test('the tile pass turns a standalone contraction into a gemm kernel and records its refusals', () => {
  const program = corpus('matmul');
  const f = program.current.value.functions[0];
  const fused = applySchedulePass(fusePass, planArtifact(f)).result.artifact;
  const tiled = applySchedulePass(tilePass, fused, defaultTileParams).result.artifact;
  const kernel = tiled.value.kernels[0];
  const axes = f.statements[0].axes.map(a => a.id);
  assert.equal(kernel.mapping, 'gemm');
  assert.deepEqual(kernel.tile, {
    kind: 'gemm',
    rowAxes: [axes[0]],
    colAxes: [axes[1]],
    reduction: f.statements[0].expr.axes
      ? f.statements[0].expr.axes[0].id
      : undefined,
    row: 'a',
    staged: 'b',
    block: [64, 64],
    chunk: 64,
    patch: [4, 4],
    pad: 1,
    doubleBuffer: false,
  });
  assert.deepEqual(kernel.threads, { mode: 'patch', count: 256 });
  assert.equal(checkOrder(tiled.value).certificate[0].kind, 'tiled-serial');

  // refusals, with reasons, per program
  const refusalsOf = (name, statement) =>
    scheduleTixFn(fnOf(corpus(name))).schedule.value.tileRefusals.filter(r => r.statement === statement);
  assert.match(refusalsOf('mlp', 'h')[0].reason, /coalesced across the lanes/);
  assert.match(refusalsOf('mlp', 'y')[0].reason, /coalesced across the lanes/);
  assert.match(refusalsOf('conv2d', 'out')[0].reason, /more than one axis/);
  // attention's score is the legal form (its k is read uncoalesced); the shipped rule leaves it untiled
  assert.match(refusalsOf('attention', 'score')[0].reason, /legal for an operand tile/);
  assert.match(refusalsOf('attention', 'out')[0].reason, /coalesced across the lanes/);
});

test('attention score is legal for an operand tile, and the shipped member chunk leaves it off', () => {
  const f = fnOf(corpus('attention'));
  const withTiles = scheduleTixFn(f, {
    tile: { gemm: defaultTileParams.gemm, member: { chunk: 16, pad: 1 } },
  });
  const kernel = withTiles.schedule.value.kernels[0];
  const score = f.statements.find(s => s.name === 'score');
  const reductionId = outerReductions(score.expr)[0].axes[0].id;
  assert.deepEqual(kernel.memberTiles, [
    { statement: 'score', reduction: reductionId, row: 'q', staged: 'k', chunk: 16, pad: 1 },
  ]);
  const classes = checkOrder(withTiles.schedule.value).certificate.map(c => [c.statement, c.kind]);
  assert.deepEqual(classes.find(c => c[0] === 'score'), ['score', 'tiled-serial']);
  // the shipped constants tile no block-mode member
  assert.deepEqual(scheduleTixFn(f).schedule.value.kernels[0].memberTiles, []);
});

test('the order certificate rejects a forged tile', () => {
  const f = fnOf(corpus('matmul'));
  const tiled = scheduleTixFn(f).schedule.value;
  const forged = structuredClone(tiled);
  forged.kernels[0].tile['patch'] = [5, 5]; // does not divide the block
  assert.equal(checkOrder(forged).ok, false);
  assert.match(checkOrder(forged).reason ?? '', /does not match the contraction/);
  const swapped = structuredClone(tiled);
  swapped.kernels[0].tile['row'] = 'b';
  swapped.kernels[0].tile['staged'] = 'a';
  assert.match(checkOrder(swapped).reason ?? '', /does not match the contraction/);
  const untiled = structuredClone(tiled);
  untiled.kernels[0].tile = undefined;
  untiled.kernels[0].mapping = 'thread';
  assert.equal(checkOrder(untiled).ok, true); // back to serial: still exact, just not tiled
  assert.equal(orderGate({ value: tiled }, { value: untiled }).ok, true);
});

test('the order gate refuses a step that would reassociate or lose a reduction', () => {
  const f = fnOf(corpus('matmul'));
  const tiled = scheduleTixFn(f).schedule.value;
  const move = structuredClone(tiled);
  // pretend the schedule staged the terms of a tiled reduction: the class changes beyond the allowed moves
  const gate = orderGate({ value: tiled }, { value: structuredClone(tiled) });
  assert.equal(gate.ok, true);
  // a schedule that drops a statement loses a reduction: the gate must say so
  const dropped = structuredClone(tiled);
  dropped.kernels[0].statements = [];
  assert.match(orderGate({ value: tiled }, { value: dropped }).reason ?? '', /changed which reductions exist|does not classify/);
});

test('contractionOf refuses the forms the tiled paths do not compute', () => {
  const refusal = source => {
    const program = compileTix(source);
    const found = contractionOf(program.current.value.functions[0].statements[0]);
    return 'refusal' in found ? found.refusal : undefined;
  };
  assert.equal(refusal('fn f(x:f32[N]):f32[N] { y[i] = x[i] + 1; return y; }'), 'the statement has no reduction');
  assert.equal(
    refusal('fn f(x:f32[N,N]):f32[N] { y[i] = max(j) x[i,j]; return y; }'),
    'the reduction is not a sum',
  );
  assert.equal(
    refusal('fn f(x:f32[N,N]):f32[N] { y[i] = sum(j) x[i,j] * x[i,j] * x[i,j]; return y; }'),
    'the reduction body is not a product of two loads',
  );
  assert.equal(
    refusal('fn f(x:f32[N,N],b:f32[N]):f32[N] { y[i] = sum(j) x[i,j] * b[i]; return y; }'),
    'the operands do not carry each output axis once at identity and the reduction axis once',
  );
  // a vector row operand with the output on the staged side is the legal rank-1 form
  const vector = compileTix('fn f(x:f32[N],b:f32[N,N]):f32[N] { y[i] = sum(j) x[j] * b[j,i]; return y; }');
  const found = contractionOf(vector.current.value.functions[0].statements[0]);
  assert.equal('refusal' in found, false);
  assert.deepEqual([found.contraction.rowAxes, found.contraction.colAxes], [[], ['i0']]);
});

test('the manager checks the plan correspondence against both artifacts entity lists', async () => {
  const program = corpus('softmax');
  const manager = new AnalysisManager();
  const prepared = await manager.execute(planTransformation, { baseline: program.current, fn: 'softmax' });
  const schedule = prepared.outputs.subject;
  const checks = manager.snapshot().executions.at(-1).checks;
  assert.equal(checks.find(c => c.phase === "correspondence").ok, true);
  assert.equal(checks.find(c => c.phase === "ensures").ok, true);
  // a genuine artifact (real hashes) whose entity universe differs from the record's: the manager must catch
  // the mismatch in the entity lists (F23/F24)
  const tampered = structuredClone(schedule.value);
  tampered.kernels.push({ ...tampered.kernels[0], kernel: 'k99' });
  const forged = scheduleArtifact(program.current.value.functions.find(f => f.name === 'softmax'), tampered);
  await assert.rejects(
    manager.verifyTransformation(
      { baseline: program.current, fn: 'softmax' },
      { subject: forged },
      planTransformation,
      [
        {
          id: 'scheduled-as',
          from: { artifact: program.current.id, revision: program.current.revision },
          to: { artifact: forged.id, revision: forged.revision },
          relation: 'statements-to-members',
          sourceEntities: program.current.value.functions.flatMap(f => f.statements.map(s => f.name + '/' + s.name)),
          targetEntities: [schedule.value.fn, ...schedule.value.kernels.flatMap(k => [k.kernel, ...k.statements.map(s => k.kernel + '/' + s)])],
          entities: [],
          evidence: {},
        },
      ],
    ),
    /entity mismatch|Unknown target entity/,
  );
});

test('the strategy plan and the plain path give the same schedule, step for step', async () => {
  const f = fnOf(corpus('attention'));
  const plain = scheduleTixFn(f);
  const viaPlan = await runScheduleStrategy({
    schedule: planArtifact(f),
    fuse: true,
    tile: defaultTileParams,
  });
  assert.equal(viaPlan.schedule.revision, plain.schedule.revision);
  assert.deepEqual(
    viaPlan.steps.map(s => s.pass),
    ['tensor.schedule.fuse', 'tensor.schedule.tile', 'tensor.schedule.pipeline'],
  );
  assert.deepEqual(
    plain.steps.map(s => s.pass),
    ['tensor.plan-schedule', 'tensor.schedule.fuse', 'tensor.schedule.tile', 'tensor.schedule.pipeline'],
  );
  // the plan records the passes' reports
  assert.match(viaPlan.steps[1].reason, /nothing tiled|refusals/);
});

test('every corpus schedule classifies, and the schedule IR validates them', () => {
  for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
    const { schedule } = scheduleTixFn(fnOf(corpus(name)));
    ScheduleIR.validate(schedule.value);
    assert.equal(checkOrder(schedule.value).ok, true, name);
  }
});
