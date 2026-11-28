/**
 * The standard library's fixpoint solver (IRWB-039 phase 2d, IRWB-053-B), moved from the framework's
 * `dataflow/solver.ts` (IRWB-001 E4) without being rewritten: a worklist solver for monotone dataflow problems
 * over a flow graph, iterating a caller-supplied transfer function over a caller-supplied lattice.
 *
 * The lattice is the caller's, from `stdlib/lattice` (bottom, join, equality, height, widening); the depth-first
 * order and the loop heads are the library's `graph` primitive. Nothing here knows a domain's types, so any
 * domain can state its problem as a graph, a lattice and a transfer function. Liveness (`flow/liveness.ts`) is
 * the second client: it is the same equations with the transfer written as a set formula.
 *
 * Forward problems compute in(b) = join of out(p) over predecessors p (boundary at the entry) and out(b) =
 * transfer(b, in(b)). Backward problems mirror this over successors (boundary at exits). Blocks are processed in
 * reverse postorder (forward) or postorder (backward) so acyclic regions converge in one sweep.
 *
 * Widening is applied only at loop heads: targets of retreating edges in a depth-first walk from the entry, and
 * optionally only after a head has been visited `widenAfter` times, so the first iterations refine before widening.
 * A lattice of infinite height without a widening operator is refused (`noWidening`), as in Compiler Workbench.
 * An `edge` function transforms the fact along each edge (branch refinement). Two schedules are offered: a
 * worklist, and Compiler Workbench's round-robin sweeps; with widening the schedule can change the result, so a
 * port that must reproduce another tool's facts picks that tool's schedule.
 *
 * `flowOrder` is the entry walk this solver widens at, exported because it is part of the algorithm's statement:
 * the postorder it sweeps and the retreating targets it widens. It is not the graph library's `depthFirst`
 * under another name — that one is the primitive, over a `Digraph`; this one is the solver's two results.
 */
import { depthFirst as depthFirstOrder } from '../graph/orders.js';
import type { Lattice } from '../lattice/lattices.js';

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
  /** Widen at a loop head only after it has been visited this many times (default 0: from the first visit). */
  readonly widenAfter?: number;
  /** The fact flowing along one edge (forward: out(from) into to; backward: in(to) into from), e.g. branch refinement. */
  edge?(from: string, to: string, value: V): V;
  /** `worklist` (default) or `round-robin` sweeps in (reverse) postorder until nothing changes. */
  readonly strategy?: 'worklist' | 'round-robin';
  readonly maxIterations?: number;
  readonly maxRounds?: number;
}

export interface Solution<V> {
  /** Fact at block entry (forward: after the join; backward: after transfer). */
  readonly in: ReadonlyMap<string, V>;
  /** Fact at block exit (forward: after transfer; backward: after the join). */
  readonly out: ReadonlyMap<string, V>;
  readonly iterations: number;
  /** Sweeps made (round-robin only; 0 for the worklist). */
  readonly rounds: number;
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

/**
 * Depth-first order from the entry: postorder of reachable blocks, and targets of retreating edges. The walk is the
 * library's graph primitive; loop heads are the targets of the edges it retreats along, which is where widening
 * applies. The framework re-exports this as `depthFirst` (its name before the move).
 */
export function flowOrder(graph: FlowGraph): { postorder: string[]; loopHeads: Set<string> } {
  const order = depthFirstOrder({ nodes: graph.blocks, entry: graph.entry, succ: b => graph.succ(b) });
  return { postorder: [...order.postorder], loopHeads: new Set(order.retreating.map(e => e.to)) };
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
  const { postorder, loopHeads } = flowOrder(graph);
  const reachable = new Set(postorder);
  // Unreachable blocks keep bottom; they are still reported so every block has a fact.
  const order = direction === 'forward' ? [...postorder].reverse() : postorder;
  const IN = new Map<string, V>(),
    OUT = new Map<string, V>(),
    visits = new Map<string, number>();
  for (const b of graph.blocks) {
    IN.set(b, lattice.bottom());
    OUT.set(b, lattice.bottom());
  }
  const boundary = options.boundary ?? lattice.bottom();
  const max = options.maxIterations ?? 10000;
  const widenAfter = options.widenAfter ?? 0;
  const forward = direction === 'forward';
  /** Visit one block; returns whether its output changed (and, for round-robin, whether anything changed). */
  const visit = (b: string): { outChanged: boolean; anyChanged: boolean } => {
    const n = (visits.get(b) ?? 0) + 1;
    visits.set(b, n);
    const sources = (forward ? graph.preds(b) : graph.succ(b)).filter(x => reachable.has(x));
    let joined = forward
      ? b === graph.entry
        ? boundary
        : lattice.bottom()
      : sources.length
        ? lattice.bottom()
        : boundary;
    for (const s of sources) {
      const v = forward ? OUT.get(s)! : IN.get(s)!;
      joined = lattice.join(
        joined,
        options.edge ? (forward ? options.edge(s, b, v) : options.edge(b, s, v)) : v,
      );
    }
    const before = forward ? IN.get(b)! : OUT.get(b)!;
    if (loopHeads.has(b) && options.widen && n > widenAfter) joined = options.widen(before, joined, b);
    const inChanged = !lattice.equal(before, joined);
    if (forward) IN.set(b, joined);
    else OUT.set(b, joined);
    const result = options.transfer(b, joined);
    const old = forward ? OUT.get(b)! : IN.get(b)!;
    if (forward) OUT.set(b, result);
    else IN.set(b, result);
    const outChanged = !lattice.equal(old, result);
    return { outChanged, anyChanged: inChanged || outChanged };
  };
  let iterations = 0,
    rounds = 0;
  if (options.strategy === 'round-robin') {
    // Compiler Workbench's schedule: sweep every reachable block in order until a sweep changes nothing.
    const maxRounds = options.maxRounds ?? 200;
    for (let changed = true; changed; ) {
      changed = false;
      if (++rounds > maxRounds)
        throw new DataflowError('noFixpoint', `no fixpoint after ${maxRounds} rounds`);
      for (const b of order) {
        iterations++;
        if (visit(b).anyChanged) changed = true;
      }
    }
  } else {
    const position = new Map(order.map((b, i) => [b, i]));
    const work = new Set(order);
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
      if (visit(b).outChanged)
        for (const t of forward ? graph.succ(b) : graph.preds(b)) if (reachable.has(t)) work.add(t);
    }
  }
  return { in: IN, out: OUT, iterations, rounds, loopHeads: [...loopHeads].sort() };
}
