import type { Artifact, EntityRef } from '../framework/core/types.js';
import type { DatabaseSnapshot, InvocationRecord } from './records.js';
import { canonical } from '../framework/core/data.js';

type Target = Artifact | EntityRef | string;
function idOf(target: Target): string {
  return typeof target === 'string' ? target : 'id' in target ? target.id : target.artifact;
}
function revisionOf(target: Target): string | undefined {
  return typeof target === 'string' ? undefined : target.revision;
}
function key(ref: EntityRef): string {
  return `${ref.artifact}@${ref.revision}`;
}

/** Queries are read-only projections of portable records; they never execute compiler passes. */
export class Queries {
  constructor(
    readonly database: DatabaseSnapshot,
    readonly runId?: string,
  ) {}

  invocations(target?: Target): InvocationRecord[] {
    return this.database.invocations.filter(
      i =>
        (!this.runId || i.runId === this.runId) &&
        (!target ||
          (i.taskId === idOf(target) && (!revisionOf(target) || i.output?.revision === revisionOf(target)))),
    );
  }

  artifact(target: Target): Artifact | undefined {
    const id = idOf(target);
    const revision = revisionOf(target) ?? this.invocations(target).at(-1)?.output?.revision;
    return this.database.artifacts.find(a => a.id === id && a.revision === revision);
  }

  why(target: Target) {
    const invocation = this.invocations(target).at(-1);
    if (!invocation) return undefined;
    const source = invocation.cache.originInvocation
      ? this.database.invocations.find(i => i.id === invocation.cache.originInvocation)
      : undefined;
    return {
      artifact: this.artifact(target) ?? null,
      invocation,
      originalInvocation: source ?? null,
      sourceInputs: this.sourceInputs(target),
      derivations: this.database.derivations.filter(d => d.invocationId === invocation.id),
      decisions: this.ancestors(target).flatMap(i =>
        i.decisions.map(d => ({ taskId: i.taskId, invocationId: i.id, ...d })),
      ),
    };
  }

  explainCache(target: Target) {
    return this.invocations(target).map(i => ({
      invocationId: i.id,
      runId: i.runId,
      taskId: i.taskId,
      ...i.cache,
    }));
  }
  history(target: Target) {
    return this.database.invocations.filter(i => i.taskId === idOf(target));
  }
  alternatives(target: Target) {
    return this.ancestors(target).flatMap(i =>
      i.decisions.filter(d => d.alternatives).map(d => ({ taskId: i.taskId, invocationId: i.id, ...d })),
    );
  }

  private ancestors(target: Target): InvocationRecord[] {
    const root = this.invocations(target).at(-1);
    if (!root) return [];
    const seen = new Set<string>();
    const output: InvocationRecord[] = [];
    const visit = (i: InvocationRecord) => {
      if (seen.has(i.id)) return;
      seen.add(i.id);
      output.push(i);
      for (const taskId of i.requests) {
        const child = this.database.invocations.findLast(j => j.runId === i.runId && j.taskId === taskId);
        if (child) visit(child);
      }
    };
    visit(root);
    return output;
  }

  dependencies(target: Target) {
    const invocations = this.ancestors(target);
    return invocations.flatMap(i =>
      i.dependencies.map(d => ({ consumer: i.taskId, invocationId: i.id, dependency: d })),
    );
  }

  sourceInputs(target: Target): Record<string, unknown> {
    return Object.fromEntries(
      this.ancestors(target).flatMap(i =>
        i.dependencies.filter(d => d.type === 'input').map(d => [d.key, d.value]),
      ),
    );
  }

  /** Trace a named entity backward across explicit correspondences, retaining split/merge edges. */
  lineage(target: EntityRef) {
    const seen = new Set<string>();
    const result: DatabaseSnapshot['derivations'] = [];
    const visit = (entity: EntityRef) => {
      const entityKey = key(entity) + (entity.entity ? `#${entity.entity}` : '');
      if (seen.has(entityKey)) return;
      seen.add(entityKey);
      const incoming = this.database.derivations.filter(
        d =>
          (!this.runId || d.runId === this.runId) &&
          key(d.target) === key(entity) &&
          (!entity.entity || !d.target.entity || d.target.entity === entity.entity),
      );
      for (const edge of incoming) {
        result.push(edge);
        visit(edge.source);
      }
    };
    visit(target);
    return result;
  }

  compare(beforeRun: string, afterRun: string) {
    const before = this.database.runs.find(r => r.id === beforeRun),
      after = this.database.runs.find(r => r.id === afterRun);
    if (!before || !after) throw new Error('Both run IDs must exist');
    const oldMap = new Map(
      this.database.invocations.filter(i => i.runId === beforeRun).map(i => [i.taskId, i]),
    );
    const newMap = new Map(
      this.database.invocations.filter(i => i.runId === afterRun).map(i => [i.taskId, i]),
    );
    const tasks = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort().map(taskId => {
      const a = oldMap.get(taskId),
        b = newMap.get(taskId);
      return {
        taskId,
        before: a?.output ?? null,
        after: b?.output ?? null,
        change: !a
          ? 'added'
          : !b
            ? 'removed'
            : a.output?.revision !== b.output?.revision
              ? 'changed'
              : 'unchanged',
        execution: b?.status ?? 'absent',
        cache: b?.cache ?? null,
      };
    });
    const inputKeys = [...new Set([...Object.keys(before.inputs), ...Object.keys(after.inputs)])].sort();
    const inputs = inputKeys
      .filter(
        k =>
          Object.hasOwn(before.inputs, k) !== Object.hasOwn(after.inputs, k) ||
          canonical(before.inputs[k] ?? null) !== canonical(after.inputs[k] ?? null),
      )
      .map(k => ({
        key: k,
        before: before.inputs[k] ?? null,
        after: after.inputs[k] ?? null,
        ...(!Object.hasOwn(before.inputs, k) || !Object.hasOwn(after.inputs, k)
          ? { beforePresent: Object.hasOwn(before.inputs, k), afterPresent: Object.hasOwn(after.inputs, k) }
          : {}),
      }));
    return { beforeRun, afterRun, inputs, tasks };
  }

  /** Minimal structural JSON diff with stable paths; array elements use numeric indices. */
  diff(
    before: Target,
    after: Target,
  ): Array<{
    path: string;
    before: unknown;
    after: unknown;
    beforePresent?: boolean;
    afterPresent?: boolean;
  }> {
    const a = this.artifact(before),
      b = this.artifact(after);
    if (!a || !b) throw new Error('Both artifacts must exist for a diff');
    const changes: Array<{
      path: string;
      before: unknown;
      after: unknown;
      beforePresent?: boolean;
      afterPresent?: boolean;
    }> = [];
    const walk = (x: unknown, y: unknown, path: string, xPresent = true, yPresent = true) => {
      if (xPresent === yPresent && canonical(x ?? null) === canonical(y ?? null)) return;
      if (x && y && typeof x === 'object' && typeof y === 'object' && Array.isArray(x) === Array.isArray(y)) {
        const xx = x as Record<string, unknown>,
          yy = y as Record<string, unknown>;
        for (const name of new Set([...Object.keys(xx), ...Object.keys(yy)]))
          walk(
            xx[name],
            yy[name],
            `${path}/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`,
            Object.hasOwn(xx, name),
            Object.hasOwn(yy, name),
          );
      } else
        changes.push({
          path,
          before: x ?? null,
          after: y ?? null,
          ...(!xPresent || !yPresent ? { beforePresent: xPresent, afterPresent: yPresent } : {}),
        });
    };
    walk(a.value, b.value, '');
    return changes;
  }
}
