import type { EntityCorrespondence, RevisionRef } from '../ir/types.js';
import { invertCorrespondence, validateCorrespondence } from '../ir/correspondence.js';
import { canonical } from '../core/data.js';

export interface CorrespondencePath {
  readonly path: readonly EntityCorrespondence[];
  readonly branchPoints: readonly { revision: RevisionRef; choices: readonly RevisionRef[] }[];
  readonly exploredEdges: number;
}
const key = (ref: RevisionRef): string => JSON.stringify([ref.artifact, ref.revision]);

/** Select one concrete revision route for the viewer. Entity branching is left
 * to the core trace/composition APIs. Distinct candidate revisions are never
 * concatenated into a fictitious linear history. */
export function correspondencePath(records: readonly EntityCorrespondence[], start: RevisionRef, target: RevisionRef, options: { reverse?: boolean; maxEdges?: number } = {}): CorrespondencePath | undefined {
  const limit = options.maxEdges ?? 1000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) throw new Error('Lineage search budget must be an integer from 1 to 100,000');
  if (key(start) === key(target)) return { path: [], branchPoints: [], exploredEdges: 0 };
  const outgoing = new Map<string, EntityCorrespondence[]>(), exact = new Map<string, string>();
  for (const record of records) {
    const value = options.reverse ? invertCorrespondence(record) : validateCorrespondence(record), edge = JSON.stringify([key(value.from), key(value.to)]), content = canonical(value);
    const previous = exact.get(edge);
    if (previous && previous !== content) throw new Error(`Ambiguous correspondence between ${value.from.artifact}@${value.from.revision} and ${value.to.artifact}@${value.to.revision}; inspect the individual mappings.`);
    if (previous) continue;
    exact.set(edge, content); const edges = outgoing.get(key(value.from)) ?? []; edges.push(value); outgoing.set(key(value.from), edges);
  }
  for (const edges of outgoing.values()) edges.sort((a, b) => key(a.to).localeCompare(key(b.to)));
  const queue: { revision: RevisionRef; path: EntityCorrespondence[] }[] = [{ revision: start, path: [] }], visited = new Set([key(start)]), branchPoints: { revision: RevisionRef; choices: RevisionRef[] }[] = [];
  let exploredEdges = 0;
  while (queue.length) {
    const current = queue.shift()!, edges = outgoing.get(key(current.revision)) ?? [];
    if (edges.length > 1) branchPoints.push({ revision: current.revision, choices: edges.map(edge => edge.to) });
    for (const edge of edges) {
      if (++exploredEdges > limit) throw new Error(`Lineage search exceeded its ${limit}-edge budget`);
      const path = [...current.path, edge];
      if (key(edge.to) === key(target)) return { path, branchPoints, exploredEdges };
      if (!visited.has(key(edge.to))) { visited.add(key(edge.to)); queue.push({ revision: edge.to, path }); }
    }
  }
  return undefined;
}
