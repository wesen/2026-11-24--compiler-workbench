import { immutable } from '../core/data.js';
import type {
  DependencyOptions,
  EntityTarget,
  IRRef,
  IRRelation,
  IRSubgraph,
  IRView,
  SubgraphOptions,
  WalkOptions,
  WalkVisit,
} from './types.js';
import { compareText, IRError, IRBudgetError, limit, revisionRef } from './common.js';
export function relationFilter(view: IRView<any>, kinds?: readonly string[]): Set<string> | undefined {
  if (kinds === undefined) return undefined;
  if (
    !Array.isArray(kinds) ||
    kinds.some(k => typeof k !== 'string' || !Object.hasOwn(view.descriptor.relationKinds, k))
  )
    throw new IRError('ir.relation', 'Query contains an undeclared relation kind');
  return new Set(kinds);
}
function categories(view: IRView<any>, names: readonly string[]): string[] {
  return Object.entries(view.descriptor.relationKinds)
    .filter(([, c]) => names.includes(c))
    .map(([k]) => k);
}
function adjacent(
  view: IRView<any>,
  target: EntityTarget,
  kinds: Set<string> | undefined,
  direction: 'incoming' | 'outgoing' | 'both',
): {
  ref: IRRef;
  via: IRRelation;
}[] {
  const current = view.ref(target);
  return view
    .relations(current, direction)
    .filter(r => !kinds || kinds.has(r.kind))
    .map(r => ({
      ref: view.ref(
        direction === 'incoming'
          ? r.from
          : direction === 'outgoing'
            ? r.to
            : r.from === current.entity
              ? r.to
              : r.from,
      ),
      via: r,
    }));
}
export function successors(
  view: IRView<any>,
  target: EntityTarget,
  kinds?: string | readonly string[],
): readonly IRRef[] {
  return neighbors(view, target, kinds, 'outgoing');
}
export function predecessors(
  view: IRView<any>,
  target: EntityTarget,
  kinds?: string | readonly string[],
): readonly IRRef[] {
  return neighbors(view, target, kinds, 'incoming');
}
function neighbors(
  view: IRView<any>,
  target: EntityTarget,
  kinds: string | readonly string[] | undefined,
  direction: 'incoming' | 'outgoing',
): readonly IRRef[] {
  const unique = new Map<string, IRRef>();
  for (const item of adjacent(
    view,
    target,
    relationFilter(view, typeof kinds === 'string' ? [kinds] : kinds),
    direction,
  ))
    unique.set(item.ref.entity, item.ref);
  return immutable([...unique.values()]);
}
export function children(view: IRView<any>, target: EntityTarget): readonly IRRef[] {
  return successors(view, target, categories(view, ['containment']));
}
export function parents(view: IRView<any>, target: EntityTarget): readonly IRRef[] {
  return predecessors(view, target, categories(view, ['containment']));
}
/** Cycle-safe deterministic traversal. Explicit bounds throw instead of returning partial evidence. */
export function walk(view: IRView<any>, options: WalkOptions = {}): readonly WalkVisit[] {
  const order = options.order ?? 'pre',
    direction = options.direction ?? 'outgoing';
  if (!['pre', 'post', 'breadth'].includes(order) || !['incoming', 'outgoing', 'both'].includes(direction))
    throw new IRError('ir.walk', 'Invalid traversal order/direction');
  const maxNodes = limit(options.maxNodes, 10000, 'maxNodes'),
    maxDepth = limit(options.maxDepth, 10000, 'maxDepth', true);
  const filter = relationFilter(view, options.relations ?? categories(view, ['containment']));
  const seeds = options.roots
    ? options.roots.map(r => view.ref(r))
    : [...view.graph().roots.map(r => view.ref(r)), ...view.entities()];
  const visited = new Set<string>(),
    result: WalkVisit[] = [];
  const enter = (ref: IRRef, depth: number, via?: IRRelation): WalkVisit => {
    if (depth > maxDepth) throw new IRBudgetError('walk depth', maxDepth);
    if (visited.size >= maxNodes) throw new IRBudgetError('walk nodes', maxNodes);
    visited.add(ref.entity);
    return {
      ref,
      entity: view.resolve(ref),
      depth,
      ...(via ? { via } : {}),
    };
  };
  for (const seed of seeds) {
    if (visited.has(seed.entity)) continue;
    if (order === 'breadth') {
      const queue: WalkVisit[] = [enter(seed, 0)];
      for (let i = 0; i < queue.length; i++) {
        const visit = queue[i];
        result.push(visit);
        for (const next of adjacent(view, visit.ref, filter, direction))
          if (!visited.has(next.ref.entity)) queue.push(enter(next.ref, visit.depth + 1, next.via));
      }
    } else {
      const root = enter(seed, 0),
        stack: {
          visit: WalkVisit;
          next: {
            ref: IRRef;
            via: IRRelation;
          }[];
          index: number;
        }[] = [
          {
            visit: root,
            next: adjacent(view, root.ref, filter, direction),
            index: 0,
          },
        ];
      if (order === 'pre') result.push(root);
      while (stack.length) {
        const frame = stack[stack.length - 1];
        if (frame.index >= frame.next.length) {
          if (order === 'post') result.push(frame.visit);
          stack.pop();
          continue;
        }
        const next = frame.next[frame.index++];
        if (visited.has(next.ref.entity)) continue;
        const visit = enter(next.ref, frame.visit.depth + 1, next.via);
        if (order === 'pre') result.push(visit);
        stack.push({
          visit,
          next: adjacent(view, visit.ref, filter, direction),
          index: 0,
        });
      }
    }
  }
  return immutable(result);
}
export function ancestors(
  view: IRView<any>,
  target: EntityTarget,
  options: {
    maxNodes?: number;
  } = {},
): readonly IRRef[] {
  const start = view.ref(target);
  return immutable(
    walk(view, {
      roots: [start],
      relations: categories(view, ['containment']),
      direction: 'incoming',
      maxNodes: options.maxNodes,
    })
      .filter(v => v.ref.entity !== start.entity)
      .map(v => v.ref),
  );
}
export function dependencies(
  view: IRView<any>,
  target: EntityTarget,
  options: DependencyOptions = {},
): readonly IRRef[] {
  const start = view.ref(target),
    kinds = options.relations ?? categories(view, ['dependency', 'binding']);
  const maxNodes = limit(options.maxNodes, 10000, 'maxNodes');
  if (options.transitive === false) {
    const result = successors(view, start, kinds).filter(r => r.entity !== start.entity);
    if (result.length > maxNodes) throw new IRBudgetError('dependency nodes', maxNodes);
    return immutable(result);
  }
  return immutable(
    walk(view, {
      roots: [start],
      relations: kinds,
      maxNodes,
    })
      .filter(v => v.ref.entity !== start.entity)
      .map(v => v.ref),
  );
}
export function subgraph(
  view: IRView<any>,
  selection: readonly EntityTarget[],
  options: SubgraphOptions = {},
): IRSubgraph {
  const roots = selection.map(r => view.ref(r)),
    closure = options.closure ?? 'none',
    maxNodes = limit(options.maxNodes, 10000, 'maxNodes');
  if (!['none', 'dependencies', 'connected'].includes(closure))
    throw new IRError('ir.subgraph', 'Invalid subgraph closure');
  const kinds =
    options.relations ??
    (closure === 'dependencies' ? categories(view, ['dependency', 'binding']) : undefined);
  const filter = relationFilter(view, kinds);
  const selected = new Set(roots.map(r => r.entity));
  if (closure !== 'none')
    for (const item of walk(view, {
      roots,
      relations: kinds ?? Object.keys(view.descriptor.relationKinds),
      direction: closure === 'connected' ? 'both' : 'outgoing',
      maxNodes,
    }))
      selected.add(item.ref.entity);
  if (selected.size > maxNodes) throw new IRBudgetError('subgraph nodes', maxNodes);
  const graph = view.graph(),
    relations = graph.relations.filter(
      r => selected.has(r.from) && selected.has(r.to) && (!filter || filter.has(r.kind)),
    );
  const incoming = new Set(relations.filter(r => r.category === 'containment').map(r => r.to));
  return immutable({
    artifact: revisionRef(view.artifact),
    selection: roots,
    entities: graph.entities.filter(e => selected.has(e.id)),
    relations,
    roots: [...selected].filter(id => !incoming.has(id)).sort(compareText),
  });
}
