/**
 * IRWB-001 E4: a worklist solver for monotone dataflow problems over a flow graph.
 *
 * Forward problems compute in(b) = join of out(p) over predecessors p (boundary at the entry) and out(b) =
 * transfer(b, in(b)). Backward problems mirror this over successors (boundary at exits). Blocks are processed in
 * reverse postorder (forward) or postorder (backward) so acyclic regions converge in one sweep.
 *
 * Widening is applied only at loop heads: targets of retreating edges in a depth-first walk from the entry. A
 * lattice of infinite height without a widening operator is refused (`noWidening`), as in Compiler Workbench.
 */
import type { Lattice } from './lattices.js';

export interface FlowGraph {
  readonly entry: string;
  readonly blocks: readonly string[];
  succ(block: string): readonly string[];
  preds(block: string): readonly string[];
}

export interface SolveOptions<V> {
  readonly direction: 'forward' | 'backward';
  readonly lattice: Lattice<V>;
  /** The fact entering the entry block (forward) or leaving exit blocks (backward). Default: bottom. */
  readonly boundary?: V;
  transfer(block: string, input: V): V;
  /** Required for lattices of infinite height; called at loop heads with the previous and new value. */
  widen?(previous: V, next: V, block: string): V;
  readonly maxIterations?: number;
}

export interface Solution<V> {
  /** Fact at block entry (forward: after the join; backward: after transfer). */
  readonly in: ReadonlyMap<string, V>;
  /** Fact at block exit (forward: after transfer; backward: after the join). */
  readonly out: ReadonlyMap<string, V>;
  readonly iterations: number;
  readonly loopHeads: readonly string[];
}

export class DataflowError extends Error {
  constructor(
    readonly code: 'noWidening' | 'noFixpoint' | 'badGraph',
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'DataflowError';
  }
}

/** Depth-first order from the entry: postorder of reachable blocks, and targets of retreating edges. */
export function depthFirst(graph: FlowGraph): { postorder: string[]; loopHeads: Set<string> } {
  const state = new Map<string, 'active' | 'done'>(),
    postorder: string[] = [],
    loopHeads = new Set<string>();
  const stack: { block: string; next: number }[] = [{ block: graph.entry, next: 0 }];
  state.set(graph.entry, 'active');
  while (stack.length) {
    const top = stack[stack.length - 1],
      succ = graph.succ(top.block);
    if (top.next < succ.length) {
      const s = succ[top.next++];
      const st = state.get(s);
      if (st === 'active') loopHeads.add(s);
      else if (!st) {
        state.set(s, 'active');
        stack.push({ block: s, next: 0 });
      }
    } else {
      state.set(top.block, 'done');
      postorder.push(top.block);
      stack.pop();
    }
  }
  return { postorder, loopHeads };
}

export function solve<V>(graph: FlowGraph, options: SolveOptions<V>): Solution<V> {
  const { lattice, direction } = options;
  if (!graph.blocks.includes(graph.entry))
    throw new DataflowError('badGraph', `entry ${graph.entry} is not a block`);
  if (lattice.infiniteHeight && !options.widen)
    throw new DataflowError(
      'noWidening',
      `the ${lattice.name} lattice has infinite height; provide widen(previous, next, block)`,
    );
  const { postorder, loopHeads } = depthFirst(graph);
  const reachable = new Set(postorder);
  // Unreachable blocks keep bottom; they are still reported so every block has a fact.
  const order = direction === 'forward' ? [...postorder].reverse() : postorder;
  const IN = new Map<string, V>(),
    OUT = new Map<string, V>();
  for (const b of graph.blocks) {
    IN.set(b, lattice.bottom());
    OUT.set(b, lattice.bottom());
  }
  const boundary = options.boundary ?? lattice.bottom();
  const max = options.maxIterations ?? 10000;
  const position = new Map(order.map((b, i) => [b, i]));
  const work = new Set(order);
  let iterations = 0;
  const forward = direction === 'forward';
  while (work.size) {
    if (++iterations > max)
      throw new DataflowError('noFixpoint', `no fixpoint after ${max} block visits (${work.size} pending)`);
    // pick the earliest pending block in the chosen order
    let b = '';
    let best = Infinity;
    for (const x of work) {
      const p = position.get(x)!;
      if (p < best) {
        best = p;
        b = x;
      }
    }
    work.delete(b);
    const sources = (forward ? graph.preds(b) : graph.succ(b)).filter(x => reachable.has(x));
    let joined = forward
      ? b === graph.entry
        ? boundary
        : lattice.bottom()
      : sources.length
        ? lattice.bottom()
        : boundary;
    for (const s of sources) joined = lattice.join(joined, forward ? OUT.get(s)! : IN.get(s)!);
    const before = forward ? IN.get(b)! : OUT.get(b)!;
    if (loopHeads.has(b) && options.widen) joined = options.widen(before, joined, b);
    if (forward) IN.set(b, joined);
    else OUT.set(b, joined);
    const result = options.transfer(b, joined);
    const old = forward ? OUT.get(b)! : IN.get(b)!;
    if (forward) OUT.set(b, result);
    else IN.set(b, result);
    if (!lattice.equal(old, result))
      for (const t of forward ? graph.succ(b) : graph.preds(b)) if (reachable.has(t)) work.add(t);
  }
  return { in: IN, out: OUT, iterations, loopHeads: [...loopHeads].sort() };
}
