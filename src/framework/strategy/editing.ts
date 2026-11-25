import { canonical, immutable } from '../core/data.js';
import type { NodeVisit, PlanChange, StrategyNode, StrategyPlan } from './ir.js';
import { assertValid } from './validation.js';

export function childNodes(node: StrategyNode): Array<{ node: StrategyNode; slot: string }> {
  switch (node.kind) {
    case 'sequence':
    case 'parallel':
      return node.steps.map((node, i) => ({ node, slot: `steps[${i}]` }));
    case 'fork':
      return node.branches.map((b, i) => ({ node: b.strategy, slot: `branches[${i}].strategy` }));
    case 'chooseBest':
      return [{ node: node.candidates, slot: 'candidates' }];
    case 'conditional':
      return [
        { node: node.then, slot: 'then' },
        { node: node.else, slot: 'else' },
      ];
    case 'repeatUntilStable':
    case 'forEach':
    case 'scope':
      return [{ node: node.body, slot: 'body' }];
    case 'attempt':
      return [
        { node: node.body, slot: 'body' },
        { node: node.fallback, slot: 'fallback' },
      ];
    default:
      return [];
  }
}
export function walk(
  plan: StrategyPlan,
  visitor?: (node: StrategyNode, visit: NodeVisit) => void,
): NodeVisit[] {
  assertValid(plan);
  const visits: NodeVisit[] = [];
  function visit(
    node: StrategyNode,
    parent: StrategyNode | undefined,
    path: string,
    depth: number,
    slot?: string,
  ) {
    const entry = { node, ...(parent ? { parent } : {}), path, depth, ...(slot ? { slot } : {}) };
    visits.push(entry);
    visitor?.(node, entry);
    for (const c of childNodes(node)) visit(c.node, node, `${path}.${c.slot}`, depth + 1, c.slot);
  }
  visit(plan.root, undefined, '$.root', 0);
  return visits;
}
export function find(plan: StrategyPlan, id: string): StrategyNode | undefined;
export function find(
  plan: StrategyPlan,
  predicate: (node: StrategyNode, visit: NodeVisit) => boolean,
): StrategyNode | undefined;
export function find(
  plan: StrategyPlan,
  query: string | ((node: StrategyNode, visit: NodeVisit) => boolean),
): StrategyNode | undefined {
  return walk(plan).find(v => (typeof query === 'string' ? v.node.id === query : query(v.node, v)))?.node;
}
function mapChildren(n: StrategyNode, fn: (n: StrategyNode) => StrategyNode): StrategyNode {
  switch (n.kind) {
    case 'sequence':
    case 'parallel':
      return { ...n, steps: n.steps.map(fn) };
    case 'fork':
      return { ...n, branches: n.branches.map(b => ({ ...b, strategy: fn(b.strategy) })) };
    case 'chooseBest':
      return { ...n, candidates: fn(n.candidates) };
    case 'conditional':
      return { ...n, then: fn(n.then), else: fn(n.else) };
    case 'repeatUntilStable':
    case 'forEach':
    case 'scope':
      return { ...n, body: fn(n.body) };
    case 'attempt':
      return { ...n, body: fn(n.body), fallback: fn(n.fallback) };
    default:
      return n;
  }
}
function edit(plan: StrategyPlan, id: string, operation: (node: StrategyNode) => StrategyNode): StrategyPlan {
  assertValid(plan);
  let matches = 0;
  function rewrite(n: StrategyNode): StrategyNode {
    if (n.id === id) {
      matches++;
      return operation(n);
    }
    return mapChildren(n, rewrite);
  }
  const next = { ...plan, root: rewrite(plan.root) };
  if (matches !== 1) throw new Error(`Strategy node ${id} was not found`);
  assertValid(next);
  return immutable(next);
}
export function replace(plan: StrategyPlan, id: string, replacement: StrategyNode): StrategyPlan {
  return edit(plan, id, () => replacement);
}
/** Insert siblings in an existing sequence; otherwise wrap the target in a fresh sequence. */
function insert(plan: StrategyPlan, id: string, addition: StrategyNode, before: boolean): StrategyPlan {
  const location = walk(plan).find(v => v.node.id === id);
  if (!location) throw new Error(`Strategy node ${id} was not found`);
  if (location.parent?.kind === 'sequence')
    return edit(plan, location.parent.id, n => {
      if (n.kind !== 'sequence') throw new Error('Expected sequence');
      return {
        ...n,
        steps: n.steps.flatMap(s => (s.id === id ? (before ? [addition, s] : [s, addition]) : [s])),
      };
    });
  const ids = new Set(walk(plan).map(v => v.node.id));
  let wrapper = `${id}:sequence`;
  let suffix = 1;
  while (ids.has(wrapper) || wrapper === addition.id) wrapper = `${id}:sequence:${suffix++}`;
  return edit(plan, id, n => ({
    id: wrapper,
    kind: 'sequence',
    steps: before ? [addition, n] : [n, addition],
  }));
}
export const insertBefore = (plan: StrategyPlan, id: string, node: StrategyNode) =>
  insert(plan, id, node, true);
export const insertAfter = (plan: StrategyPlan, id: string, node: StrategyNode) =>
  insert(plan, id, node, false);
/** Required single-child slots/root cannot be removed: replace explicitly with sequence(id). */
export function remove(plan: StrategyPlan, id: string): StrategyPlan {
  const location = walk(plan).find(v => v.node.id === id);
  if (!location) throw new Error(`Strategy node ${id} was not found`);
  const parent = location.parent;
  if (!parent) throw new Error('Cannot remove the root; replace it explicitly');
  if (parent.kind === 'sequence' || parent.kind === 'parallel')
    return edit(plan, parent.id, n => {
      if (n.kind !== 'sequence' && n.kind !== 'parallel') throw new Error('Expected step container');
      return { ...n, steps: n.steps.filter(s => s.id !== id) };
    });
  if (parent.kind === 'fork')
    return edit(plan, parent.id, n => {
      if (n.kind !== 'fork') throw new Error('Expected fork');
      return { ...n, branches: n.branches.filter(b => b.strategy.id !== id) };
    });
  throw new Error(`Cannot remove required ${location.slot} child; replace it explicitly`);
}
function localFields(node: StrategyNode): unknown {
  const copy = { ...node } as Record<string, unknown>;
  switch (node.kind) {
    case 'sequence':
    case 'parallel':
      copy.steps = node.steps.map(n => n.id);
      break;
    case 'fork':
      copy.branches = node.branches.map(b => ({ name: b.name, id: b.strategy.id }));
      break;
    case 'chooseBest':
      copy.candidates = node.candidates.id;
      break;
    case 'conditional':
      copy.then = node.then.id;
      copy.else = node.else.id;
      break;
    case 'repeatUntilStable':
    case 'forEach':
    case 'scope':
      copy.body = node.body.id;
      break;
    case 'attempt':
      copy.body = node.body.id;
      copy.fallback = node.fallback.id;
      break;
  }
  return copy;
}
export function diff(before: StrategyPlan, after: StrategyPlan): PlanChange[] {
  const a = new Map(walk(before).map(v => [v.node.id, v])),
    b = new Map(walk(after).map(v => [v.node.id, v]));
  const changes: PlanChange[] = [];
  for (const [id, v] of a) if (!b.has(id)) changes.push({ type: 'removed', nodeId: id, before: v.node });
  for (const [id, v] of b) {
    const old = a.get(id);
    if (!old) {
      changes.push({ type: 'added', nodeId: id, after: v.node });
      continue;
    }
    const x = localFields(old.node),
      y = localFields(v.node);
    if (canonical(x) !== canonical(y)) changes.push({ type: 'changed', nodeId: id, before: x, after: y });
    if (old.parent?.id !== v.parent?.id || old.slot !== v.slot)
      changes.push({
        type: 'moved',
        nodeId: id,
        before: { parent: old.parent?.id ?? null, slot: old.slot ?? null },
        after: { parent: v.parent?.id ?? null, slot: v.slot ?? null },
      });
  }
  if (
    before.id !== after.id ||
    before.description !== after.description ||
    canonical(before.requirements ?? []) !== canonical(after.requirements ?? [])
  )
    changes.unshift({
      type: 'changed',
      nodeId: '$plan',
      before: {
        id: before.id,
        description: before.description ?? null,
        requirements: before.requirements ?? [],
      },
      after: { id: after.id, description: after.description ?? null, requirements: after.requirements ?? [] },
    });
  return immutable(changes);
}
