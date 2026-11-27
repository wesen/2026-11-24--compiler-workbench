import { defineIR } from '../framework/contracts/index.js';
import { canonical } from '../framework/core/data.js';
import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact, defineAdapter, type EntityCorrespondence } from '../framework/ir/index.js';
import { applyNativePassSync, definePass } from '../framework/passes/index.js';
import { gate, outerReductions, planFusion, unfusedPlan, type FusionGroup, type Reduce } from './fusion.js';
import { visit, type Expr, type Fn, type Statement } from './model.js';

type Load = Extract<Expr, { kind: 'load' }>;

/** Partition of the output coordinates and the original, ordered rectangular reduction. */
export interface Contraction {
  reduction: number;
  row: number[];
  column: number[];
  batch: number[];
  operands: [Load, Load];
}

export interface SharedTile {
  kind: 'shared-tile';
  threads: [number, number];
  patch: [number, number];
  stripe: number;
  swap: boolean;
  columnLoad: 'column-first' | 'term-first';
  // Minimum linear K and output sizes for which to use the cooperative schedule.
  minTerms: number;
  minOutputs: number;
}

export interface ScheduledContraction {
  statement: string;
  domain: Contraction;
  layout?: SharedTile;
}

export interface ScheduleGroup extends FusionGroup {
  launch: { kind: 'element'; threads: number } | {
    kind: 'row';
    cap: number;
    heavyCap: number;
    gate: typeof gate;
  };
  contractions: ScheduledContraction[];
  partition?: { phases: ScheduleGroup[]; materialized: string[] };
}

export interface Schedule {
  fn: Fn;
  groups: ScheduleGroup[];
}

export const blockThreads = { rows: 128, contraction: 64, heavy: 256 };
const elementThreads = 256;

function rowReadsGlobal(e: Expr, local: readonly string[], reducing = false): boolean {
  switch (e.kind) {
    case 'load': return reducing && !local.includes(e.name);
    case 'op': return e.args.some(a => rowReadsGlobal(a, local, reducing));
    case 'reduce': return rowReadsGlobal(e.body, local, true);
    default: return false;
  }
}

export function scheduleGroup(fn: Fn, group: FusionGroup): ScheduleGroup {
  const local = [...group.staged, ...group.buffered];
  const globalReduction = fn.statements.some(s =>
    group.statements.includes(s.name) && rowReadsGlobal(s.expr, local));
  return {
    ...group,
    launch: group.mapping === 'block'
      ? { kind: 'row', cap: globalReduction ? blockThreads.contraction : blockThreads.rows,
        heavyCap: blockThreads.heavy, gate }
      : { kind: 'element', threads: elementThreads },
    contractions: [],
  };
}

const entities = (schedule: Schedule) => [
  { id: 'function/' + schedule.fn.name, kind: 'function', attributes: { fn: schedule.fn } },
  ...schedule.groups.map(group => {
    const { contractions, partition: _, ...mapping } = group;
    return { id: group.kernel, kind: 'group', attributes: { mapping } };
  }),
  ...schedule.groups.flatMap(group => group.statements.map(statement => ({
    id: schedule.fn.name + '/' + statement,
    kind: 'statement',
    attributes: {
      contractions: group.contractions.filter(c => c.statement === statement),
      ...(group.partition && statement === group.statements[0] && { partition: group.partition }),
    },
  }))),
];

function validate(value: unknown) {
  const s = value as Schedule;
  if (!Array.isArray(s.fn?.statements) || !Array.isArray(s.groups) ||
      canonical(s.groups.flatMap(g => g.statements)) !== canonical(s.fn.statements.map(m => m.name)) ||
      new Set(s.groups.map(g => g.kernel)).size !== s.groups.length)
    throw Error('Invalid ordered schedule groups');
}

export const ScheduleIR = defineIR<Schedule>({
  id: 'tensor.schedule', version: '1', description: 'CUDA execution schedule for one Tix function',
  validate, entities: v => entities(v).map(e => e.id),
});

const adapter = defineAdapter<Schedule>({
  id: 'tensor.schedule-adapter', version: '1', description: 'Schedule groups and member mappings',
  kind: ScheduleIR.id, schemaVersion: ScheduleIR.version,
  validate, entities, resolve: (v, id) => entities(v).find(e => e.id === id),
  relationKinds: {}, relations: () => [], describe: (_, id) => ({ label: id }),
});

export function seedSchedule(fn: Fn, fuse: boolean): Artifact<Schedule> {
  const plan = fuse ? planFusion(fn) : unfusedPlan(fn);
  return createIRArtifact(adapter, 'tix-schedule/' + fn.name, {
    fn, groups: plan.groups.map(group => scheduleGroup(fn, group)),
  });
}

function depends(load: Load, binder: string) {
  return load.indices.some(index => index.terms.some(([id]) => id === binder));
}

function recognize(statement: Statement): Contraction | undefined {
  const reductions = outerReductions(statement.expr);
  if (reductions.length !== 1) return;
  const [{ op, axes, body }] = reductions;
  if (op !== 'sum' || axes.some(axis => axis.extent.kind !== 'dim') ||
      body.kind !== 'op' || body.op !== '*') return;
  const [a, b] = body.args;
  if (a.kind !== 'load' || b.kind !== 'load') return;
  const row: number[] = [], column: number[] = [], batch: number[] = [];
  statement.axes.forEach(({id}, i) => {
    const left = depends(a, id), right = depends(b, id);
    (left === right ? batch : left ? row : column).push(i);
  });
  if (!row.length || !column.length) return;
  return { reduction: 0, row, column, batch, operands: [a, b] };
}

export function contractionReduction(statement: Statement, domain: Contraction): Reduce {
  return outerReductions(statement.expr)[domain.reduction];
}

function selectLayout(group: ScheduleGroup, statement: Statement, domain: Contraction): SharedTile | undefined {
  if (group.statements.length !== 1) return;
  const { row, column } = domain;
  // Assign contiguous lanes to the last output axis. The operands can swap storage roles, but
  // their multiplication order stays as written (the printer preserves their original positions).
  const spatialRows = row.includes(statement.axes.length - 1);
  const colLoad = domain.operands[spatialRows ? 0 : 1];
  const last = colLoad.indices.at(-1)!;
  const contiguous = (spatialRows ? row : column).at(-1)!;
  return {
    kind: 'shared-tile',
    threads: [8, 16],
    patch: [4, 4],
    stripe: 16,
    swap: spatialRows,
    columnLoad: last.terms.some(([id]) => id === statement.axes[contiguous].id) ? 'column-first' : 'term-first',
    minTerms: 16,
    minOutputs: 4096,
  };
}

function rewrite(schedule: Schedule, update: (group: ScheduleGroup, s: Statement) => ScheduledContraction[]) {
  const members = new Map(schedule.fn.statements.map(s => [s.name, s]));
  const groups = schedule.groups.map(group => ({
    ...group,
    contractions: group.statements.flatMap(name => update(group, members.get(name)!)),
  }));
  const correspondence = entities(schedule).map(({ id }) =>
    ({ from: [id], to: [id], relation: 'same-entity' }));
  return { native: { ...schedule, groups }, correspondence };
}

export const recognizeContractions = definePass({
  id: 'tensor.recognize-contractions', version: '1',
  ir: ScheduleIR, adapter, description: 'Recover two output reuse axes and an ordered dot product',
  writes: { entities: ['statement'], relations: [] },
  run: ({ before }) => rewrite(before.value, (_group, statement) => {
    const domain = recognize(statement);
    return domain ? [{ statement: statement.name, domain }] : [];
  }),
});

export const mapContractions = definePass({
  id: 'tensor.map-contractions', version: '1',
  ir: ScheduleIR, adapter, description: 'Map ordered contractions to CUDA lanes, registers and shared memory',
  writes: { entities: ['statement'], relations: [] },
  run: ({ before }) => rewrite(before.value, (group, statement) => {
    const contraction = group.contractions.find(c => c.statement === statement.name);
    if (!contraction) return [];
    const layout = selectLayout(group, statement, contraction.domain);
    return [layout ? { ...contraction, layout } : contraction];
  }),
});

function partitionGroup(fn: Fn, group: ScheduleGroup): ScheduleGroup['partition'] {
  if (group.launch.kind !== 'row' || group.depth !== 1 || group.statements.length < 3) return;
  const members = fn.statements.filter(s => group.statements.includes(s.name));
  const first = members[0], last = members.at(-1)!;
  const boundaries = [first, last].map(s => group.contractions.find(c => c.statement === s.name));
  if (boundaries.some(c => !c) || first.axes.length !== 2 || last.axes.length !== 2) return;

  const phases: ScheduleGroup[] = [];
  for (const section of [[first], members.slice(1, -1), [last]]) {
    const names = new Set(section.map(s => s.name));
    const fragment: Fn = { ...fn, statements: section,
      params: [...fn.params, ...fn.statements.filter(s => !names.has(s.name))],
      result: section.at(-1)!.name, shape: section.at(-1)!.shape,
    };
    for (const part of planFusion(fragment).groups) {
      const outside = new Set(fn.statements.filter(s => !part.statements.includes(s.name)).flatMap(s => {
        const reads: string[] = [];
        visit(s.expr, e => { if (e.kind === 'load') reads.push(e.name); });
        return reads;
      }));
      const phase = scheduleGroup(fn, {
        ...part,
        kernel: group.kernel + '_p' + phases.length,
        stored: part.statements.filter(s => part.stored.includes(s) || group.stored.includes(s) || outside.has(s)),
      });
      const boundary = boundaries.find(c => c && phase.statements.includes(c.statement));
      const statement = section[0];
      if (boundary) {
        const layout = selectLayout(phase, statement, boundary.domain);
        if (!layout) return;
        phase.contractions.push({ ...boundary, layout });
      }
      phases.push(phase);
    }
  }
  return { phases, materialized: phases.flatMap(p => p.stored) };
}

export const partitionContractions = definePass({
  id: 'tensor.partition-contractions', version: '1',
  ir: ScheduleIR, adapter, description: 'Add tiled boundary phases around a fused row computation',
  writes: { entities: ['statement'], relations: [] },
  run: ({ before }) => {
    const schedule = before.value;
    const groups = schedule.groups.map(group => {
      const partition = partitionGroup(schedule.fn, group);
      return partition ? { ...group, partition } : group;
    });
    return {
      native: { ...schedule, groups },
      correspondence: entities(schedule).map(({ id }) => ({ from: [id], to: [id], relation: 'same-entity' })),
    };
  },
});

function positive(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0;
}

export function checkScheduleStep(
  before: Artifact<Schedule>,
  after: Artifact<Schedule>,
  correspondence: EntityCorrespondence,
  step: 'recognize' | 'map' | 'partition',
) {
  const strip = ({ fn, groups }: Schedule) => ({
    fn, groups: groups.map(({ contractions: _, partition: _partition, ...group }) => group),
  });
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  const reject = (reason: string) => ({ ok: false, reason });
  const ids = ScheduleIR.entities!(before.value);
  if (!same(strip(before.value), strip(after.value)) ||
      correspondence.from.revision !== before.revision || correspondence.to.revision !== after.revision ||
      correspondence.entries.length !== ids.length ||
      !correspondence.entries.every(e => e.from.length === 1 && same(e.from, e.to) &&
        e.relation === 'same-entity'))
    return reject('The step must preserve the scalar function, fusion schedule and entity identities');

  for (const [i, group] of after.value.groups.entries()) {
    const old = before.value.groups[i];
    const prior = old.contractions;
    if (step === 'partition') {
      const expected = partitionGroup(after.value.fn, old);
      if (!same(prior, group.contractions) ||
          (expected ? !group.partition || !same(expected, group.partition) : group.partition !== undefined))
        return reject('Phases must preserve ordered statements and materialize cross-phase reads');
      continue;
    }
    if (group.partition !== undefined)
      return reject('Only partitioning may add alternate phases');
    if (step === 'map' && !same(prior.map(({ layout: _, ...c }) => c),
          group.contractions.map(({ layout: _, ...c }) => c)))
      return reject('Mapping must preserve operand maps and reduction order');
    for (const { statement, domain, layout } of group.contractions) {
      const member = after.value.fn.statements.find(s => s.name === statement)!;
      const expected = member && recognize(member);
      if (!group.statements.includes(statement) || !expected || !same(expected, domain))
        return reject('Contraction does not describe the original ordered sum and its operand maps');
      if (!layout) continue;
      if (step === 'recognize') return reject('Recognition cannot install a mapping');
      if (layout.kind === 'shared-tile') {
        const [ty, tx] = layout.threads, [ry, rx] = layout.patch;
        if (group.statements.length !== 1 ||
            ![ty, tx, ry, rx, layout.stripe, layout.minTerms, layout.minOutputs].every(positive) ||
            ty * tx > 1024 || (ty * ry + tx * rx + 2) * layout.stripe * 4 > 49152)
          return reject('The lane, register or shared-memory tile is invalid');
      } else return reject('Unknown contraction mapping');
    }
  }
  return { ok: true, evidence: {
    fold: 'positive zero followed by every original term in lexicographic order, with separate f32 multiply and add',
    ownership: 'each coordinate belongs to one tile, one lane and one register position',
  } };
}

/** Synchronous because cudaSource must return its source without an asynchronous execution context. */
export function scheduleTix(fn: Fn, fuse: boolean, seed = seedSchedule(fn, fuse)) {
  if (!fuse) return { artifact: seed, steps: [] };
  const recognized = applyNativePassSync(recognizeContractions, seed,
    (before, after, c) => checkScheduleStep(before, after, c, 'recognize'));
  const mapped = applyNativePassSync(mapContractions, recognized.artifact,
    (before, after, c) => checkScheduleStep(before, after, c, 'map'));
  const partitioned = applyNativePassSync(partitionContractions, mapped.artifact,
    (before, after, c) => checkScheduleStep(before, after, c, 'partition'));
  return { artifact: partitioned.artifact, steps: [recognized, mapped, partitioned] };
}
