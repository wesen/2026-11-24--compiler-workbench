/**
 * Depth-first orders over a directed graph: the standard library's first graph module (IRWB-039
 * phase 2c, IRWB-047-A). One depth-first walk from the entry yields the postorder and its reverse —
 * the order every later graph algorithm iterates in — and the retreating edges: edges whose target
 * is still on the walk's path, an ancestor in the depth-first tree. In a reducible flow graph the
 * retreating edges are exactly the back edges (an edge u -> v where v dominates u), and a dataflow
 * solver can widen at their targets; in an irreducible cycle a retreating edge need not be a back
 * edge, which is where the two notions part (see `naturalLoops` in `graph/dominators.js`).
 *
 * The walk runs over `Digraph` — nodes, an entry, successors — never over a domain's blocks. A node
 * is marked before its successors are walked and enters the order after they all are, so children
 * precede parents in the postorder and parents precede children in its reverse. Successors that
 * are not nodes of the graph are not walked, as a dangling jump in a block list is not a block.
 */
export interface Digraph {
  /** Every node of the graph, in declaration order; the entry is one of them. */
  readonly nodes: readonly string[];
  readonly entry: string;
  /** The successors of a node, in edge order; successors outside `nodes` are not walked. */
  succ(node: string): readonly string[];
}

export interface DepthFirst {
  /** The nodes a path from the entry reaches, each after all its successors. */
  readonly postorder: readonly string[];
  /** The reverse of the postorder: iterate a forward problem in this order. */
  readonly reversePostorder: readonly string[];
  /** Every edge (from, to) whose target is still on the walk's path when the edge is taken. */
  readonly retreating: readonly (readonly [string, string])[];
}

export function depthFirst(graph: Digraph): DepthFirst {
  const known = new Set(graph.nodes);
  const state = new Map<string, 'active' | 'done'>();
  const postorder: string[] = [],
    retreating: [string, string][] = [];
  const stack: { node: string; next: number }[] = [{ node: graph.entry, next: 0 }];
  state.set(graph.entry, 'active');
  while (stack.length) {
    const top = stack[stack.length - 1],
      succ = graph.succ(top.node);
    if (top.next < succ.length) {
      const s = succ[top.next++];
      if (!known.has(s)) continue;
      const st = state.get(s);
      if (st === 'active') retreating.push([top.node, s]);
      else if (!st) {
        state.set(s, 'active');
        stack.push({ node: s, next: 0 });
      }
    } else {
      state.set(top.node, 'done');
      postorder.push(top.node);
      stack.pop();
    }
  }
  return { postorder, reversePostorder: [...postorder].reverse(), retreating };
}
