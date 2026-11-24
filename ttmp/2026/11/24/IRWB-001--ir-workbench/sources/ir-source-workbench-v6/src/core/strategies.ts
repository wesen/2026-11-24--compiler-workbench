import type { Artifact, PassContext, Task } from './types.js';
import { assert } from './types.js';

export interface Candidate<T> { name: string; artifact: Artifact<T>; metrics: Record<string, number> }
export interface Objective { metric: string; direction: 'min' | 'max' }
export interface Constraint { metric: string; op: '<=' | '>='; value: number }

/** Domain-neutral constrained selection, with all evaluated alternatives retained as evidence. */
export function selectByMetrics<T>(ctx: PassContext, candidates: Candidate<T>[], objective: Objective, constraints: Constraint[] = []): Candidate<T> {
  assert(candidates.length > 0, 'Selection requires candidates');
  assert(new Set(candidates.map(c => c.name)).size === candidates.length, 'Candidate names must be unique');
  for (const constraint of constraints) assert(Number.isFinite(constraint.value), 'Constraint threshold must be finite');
  const evaluated = candidates.map(candidate => {
    for (const name of [objective.metric, ...constraints.map(c => c.metric)]) {
      assert(Number.isFinite(candidate.metrics[name]), `Candidate ${candidate.name} has no finite ${name} metric`);
    }
    const violations = constraints.filter(c => c.op === '<=' ? candidate.metrics[c.metric] > c.value : candidate.metrics[c.metric] < c.value);
    return { candidate, feasible: violations.length === 0, violations };
  });
  const feasible = evaluated.filter(c => c.feasible).sort((a,b) => {
    const delta = a.candidate.metrics[objective.metric] - b.candidate.metrics[objective.metric];
    return (objective.direction === 'min' ? delta : -delta) || (a.candidate.name<b.candidate.name?-1:a.candidate.name>b.candidate.name?1:0);
  });
  const winner = feasible[0]?.candidate;
  ctx.decision({
    code: 'strategy.choose',
    message: winner ? `Selected ${winner.name}: ${objective.direction} ${objective.metric} among ${feasible.length} feasible candidates` : 'No feasible candidate',
    evidence: { objective, constraints, tieBreak: 'lexicographic candidate name' },
    alternatives: evaluated.map(e => ({
      name: e.candidate.name,
      accepted: e.candidate === winner,
      metrics: e.candidate.metrics,
      reason: !e.feasible ? e.violations.map(c=>`${c.metric}=${e.candidate.metrics[c.metric]} violates ${c.op} ${c.value}`).join('; ')
        : e.candidate === winner ? 'Best feasible objective; ties use candidate name'
        : `Feasible; ${objective.metric}=${e.candidate.metrics[objective.metric]}; ranked after selected candidate`
    }))
  });
  assert(winner, 'No feasible optimization candidate');
  ctx.derive(winner.artifact, { relation: 'selected-from' });
  return winner;
}

/** Tasks can be scheduled concurrently without losing dependency/provenance accounting. */
export async function parallel<T>(ctx: PassContext, tasks: Task[]): Promise<Artifact<T>[]> {
  return Promise.all(tasks.map(t => ctx.require<T>(t)));
}

export async function sequence<T>(ctx: PassContext, initial: Task, steps: Array<(previous: Task) => Task>): Promise<Artifact<T>> {
  let current = initial;
  for(const step of steps) current = step(current);
  return ctx.require<T>(current);
}

/** Content convergence, cycle detection, and a mandatory bound. Never silently accepts nonconvergence. */
export async function repeatUntilStable<T>(ctx: PassContext, initial: Task, step: (previous: Task, iteration: number) => Task, maxIterations: number): Promise<Artifact<T>> {
  assert(Number.isInteger(maxIterations) && maxIterations > 0, 'Fixpoint bound must be a positive integer');
  let previousTask = initial;
  let previous = await ctx.require<T>(initial);
  const seen = new Set([previous.revision]);
  for(let iteration=1; iteration<=maxIterations; iteration++) {
    const nextTask=step(previousTask, iteration);
    const next=await ctx.require<T>(nextTask);
    ctx.checkpoint('fixpoint', { iteration, before: previous.contentHash, after: next.contentHash });
    if(next.revision===previous.revision) {
      ctx.decision({code:'strategy.fixpoint',message:`Content stabilized after ${iteration} iterations`,evidence:{iteration,maxIterations}});
      ctx.derive(next,{relation:'fixed-point'});
      return next;
    }
    assert(!seen.has(next.revision), `Transformation cycle detected at iteration ${iteration}`);
    seen.add(next.revision); previous=next; previousTask=nextTask;
  }
  throw new Error(`Fixpoint did not converge within ${maxIterations} iterations`);
}
