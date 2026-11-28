/**
 * Depth-first search from the entry, in one traversal (IRWB-047-B): the postorder, the reverse postorder the
 * dominator iteration sweeps, and the retreating edges (edges to a node still on the walk's stack).
 *
 * The walk is an explicit stack that marks a node active when it is pushed and appends it to the postorder when
 * its last successor is done, so the postorder lists a node after every node it reaches — successors before
 * predecessors — and the reverse postorder puts the entry first and every node after its depth-first parent. Only
 * nodes a path from the entry reaches appear; a node no path reaches is in none of the three results.
 *
 * Retreating edges are what a dataflow solver widens at: they are the edges whose target can still be on the stack
 * when they are taken. They are reported as edges, in discovery order, and they are not the same thing as a
 * natural loop's back edge — a retreating edge is a fact about this walk, a back edge is a fact about dominance, so
 * an irreducible cycle has retreating edges and no natural loop (see `naturalLoops`).
 */
import type { Digraph, Edge } from './digraph.js';

export interface DfsOrder<N> {
  /** The nodes a path from the entry reaches, each listed after all nodes it reaches. */
  readonly postorder: readonly N[];
  /** The postorder reversed: `rpo[0]` is the entry, and every node comes after its depth-first parent. */
  readonly rpo: readonly N[];
  /** The edges `from -> to` taken while `to` was active on the stack, in the order the walk took them. */
  readonly retreating: readonly Edge<N>[];
}

export function depthFirst<N>(graph: Digraph<N>): DfsOrder<N> {
  const state = new Map<N, 'active' | 'done'>(),
    postorder: N[] = [],
    retreating: Edge<N>[] = [],
    stack: { block: N; next: number }[] = [{ block: graph.entry, next: 0 }];
  state.set(graph.entry, 'active');
  while (stack.length) {
    const top = stack[stack.length - 1],
      succ = graph.succ(top.block);
    if (top.next < succ.length) {
      const s = succ[top.next++],
        seen = state.get(s);
      if (seen === 'active') retreating.push({ from: top.block, to: s });
      else if (!seen) {
        state.set(s, 'active');
        stack.push({ block: s, next: 0 });
      }
    } else {
      state.set(top.block, 'done');
      postorder.push(top.block);
      stack.pop();
    }
  }
  return { postorder, rpo: [...postorder].reverse(), retreating };
}
