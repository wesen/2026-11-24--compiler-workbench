/**
 * The digraph every graph primitive in this directory runs over (IRWB-047-B): a finite list of nodes, one entry
 * node, and each node's successors in a fixed order. Nodes are whatever is a stable key — Typed's block ids and
 * the framework's block labels are strings — so the primitives are generic in the node type. There are no node
 * attributes and no edge labels: `succ` is the whole graph, and every other relation is derived from it.
 *
 * Input domain: a finite graph whose successors are nodes of the graph (`nodes`), with an entry that is one of
 * them. The entry is the only node the orders start from.
 */
export interface Digraph<N> {
  readonly nodes: readonly N[];
  /** The node every order starts from; one of `nodes`. */
  readonly entry: N;
  /** The successors of a node, in the order the algorithms walk them. */
  succ(node: N): readonly N[];
}

/** One edge of the graph, as a pair. */
export interface Edge<N> {
  readonly from: N;
  readonly to: N;
}

/**
 * The predecessors of every node, derived from `succ`: `preds.get(x)` lists the nodes that name `x` as a
 * successor, in `nodes` order (a node that has no predecessor gets an empty list). Derived rather than passed so
 * that a caller states its graph once — as successors — and every primitive here agrees on it.
 */
export function predecessors<N>(graph: Digraph<N>): ReadonlyMap<N, readonly N[]> {
  const preds = new Map<N, N[]>(graph.nodes.map(n => [n, []]));
  for (const b of graph.nodes) for (const s of graph.succ(b)) preds.get(s)!.push(b);
  return preds;
}
