import { canonical } from '../framework/core/data.js';
import { defineIR } from '../framework/contracts/index.js';
import { createIRArtifact, defineAdapter, type IREntity } from '../framework/ir/index.js';
import { applyNativePassSync, definePass } from '../framework/passes/index.js';
import { planFusion, unfusedPlan, type FusionPlan } from './fusion.js';
import type { Fn } from './model.js';

/** The initial schedule retains the original scalar expressions and their ordered reductions. */
export interface Schedule {
  fn: Fn;
  plan: FusionPlan;
}

function validate(value: unknown): asserts value is Schedule {
  const schedule = value as Schedule;
  if (!schedule || !schedule.fn || !schedule.plan || !Array.isArray(schedule.plan.groups))
    throw Error('Invalid tensor schedule');
  const statements = schedule.plan.groups.flatMap(g => g.statements);
  if (JSON.stringify(statements) !== JSON.stringify(schedule.fn.statements.map(s => s.name)))
    throw Error('Schedule must cover statements in order');
  if (new Set(schedule.plan.groups.map(g => g.kernel)).size !== schedule.plan.groups.length)
    throw Error('Duplicate schedule kernel');
}

export const ScheduleIR = defineIR<Schedule>({
  id: 'tensor.schedule', version: '1', description: 'Tensor function and its kernel schedule', validate,
  entities: s => s.plan.groups.map(g => g.kernel),
});
function entities(s: Schedule): IREntity[] {
  return s.plan.groups.map(g => ({ id: g.kernel, kind: 'kernel', attributes: { ...g } }));
}
export const scheduleAdapter = defineAdapter<Schedule>({
  id: 'tensor.schedule.adapter', version: '1', description: 'Scheduled kernel groups',
  kind: ScheduleIR.id, schemaVersion: ScheduleIR.version, validate,
  relationKinds: {}, entities, relations: () => [],
  resolve: (s, id) => entities(s).find(e => e.id === id),
  describe: (_, id) => ({ label: id }),
});

/** The existing fusion analysis remains responsible for its own legality. */
export const fusionSchedulePass = definePass<Schedule>({
  id: 'tensor.schedule.fusion', version: '1', description: 'Schedule legal fusion groups',
  ir: ScheduleIR, adapter: scheduleAdapter, writes: { entities: ['kernel'], relations: [] },
  run: ({ before }) => {
    const plan = planFusion(before.value.fn);
    return {
      native: { fn: before.value.fn, plan },
      correspondence: plan.groups.map(group => ({
        from: before.value.plan.groups.filter(old => old.statements.some(s => group.statements.includes(s))).map(old => old.kernel),
        to: [group.kernel], relation: 'fusion',
      })),
    };
  },
});

export function scheduleFunction(fn: Fn, fuse: boolean) {
  const initial = createIRArtifact(scheduleAdapter, 'schedule/' + fn.name, { fn, plan: unfusedPlan(fn) });
  if (!fuse) return initial;
  return applyNativePassSync(fusionSchedulePass, initial, (before, after) => ({
    ok: canonical(before.value.fn) === canonical(after.value.fn) &&
      canonical(after.value.plan) === canonical(planFusion(before.value.fn)),
    reason: 'Fusion schedule must retain the function and match the fusion analysis',
  })).artifact;
}
