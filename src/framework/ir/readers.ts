import type { IRView } from './types.js';
/** Algorithm guards and predicates receive observation capabilities, never commit authority. */
export type IRReader<T = unknown> = Omit<IRView<T>, 'beginEdit' | 'at'>;
const readers = new WeakMap<object, IRReader<any>>();
export function readIR<T>(view: IRReader<T>): IRReader<T> {
  const previous = readers.get(view);
  if (previous) return previous;
  const reader: IRReader<T> = Object.freeze({
    artifact: view.artifact,
    adapter: view.adapter,
    descriptor: view.descriptor,
    capabilities: view.capabilities,
    ref: view.ref.bind(view),
    entities: view.entities.bind(view),
    resolve: view.resolve.bind(view),
    describe: view.describe.bind(view),
    relations: view.relations.bind(view),
    operation: view.operation.bind(view),
    walk: view.walk.bind(view),
    children: view.children.bind(view),
    parents: view.parents.bind(view),
    successors: view.successors.bind(view),
    predecessors: view.predecessors.bind(view),
    ancestors: view.ancestors.bind(view),
    dependencies: view.dependencies.bind(view),
    subgraph: view.subgraph.bind(view),
    find: view.find.bind(view),
    graph: view.graph.bind(view),
    serialize: view.serialize.bind(view),
    visualize: view.visualize.bind(view),
  });
  readers.set(view, reader);
  return reader;
}
