/**
 * The standard library of compiler algorithms (IRWB-039 phase 2): pure, synchronous implementations
 * of named algorithms and laws over small shape interfaces — blocks, values, terms — never over a
 * domain's types, so any domain can call them. Admission rule (R3): a named algorithm or law, at
 * least two clients, and an executable test; a module that fails one of these stays in its domain.
 *
 * Layering (the v7 design doc's layering D): each directory uses only the directories listed below
 * it. `graph`, `lattice` and `num` use nothing; `ssa` and `flow` use those; `pe`, `affine` and `term`
 * above; `check` and `measure` on top. Nothing under src/stdlib imports outside src/stdlib.
 *
 * What exists now:
 *   flow/     liveness — backward gen/kill liveness over blocks, with an explicit scope, solved on
 *             `solve`; solve — the fixpoint solver: a monotone transfer over a graph, in either
 *             direction, widening at loop heads, over the caller's lattice (generalises liveness)
 *             solveFor — demand-driven equation solving (local fixpoints, Fecht–Seidl): unknowns created
 *             on demand, with widening and a budget (SCCP)
 *   graph/    orders, dominators, natural loops — over one digraph: nodes, an entry, successors
 *   lattice/  lattices — join, order and widening: the set, flat, interval and map lattices
 *             (dataflow's ranges analysis, and SCCP's flat lattice of SSA names)
 *   affine/   forms — linear expressions over index variables, computed exactly; distances — dependence
 *             distance vectors over them (a read's index per position against the consumer's axis)
 *             directions — direction vectors, strip-mining, and the legality of a loop order with parallel loops
 *   num/      binary32 arithmetic on bit patterns, and min/max under a named IEEE 754-2019 profile
 *
 * Later modules, one line each (each enters under the admission rule, with its two clients):
 *   graph/    dominance frontiers
 *   num/      exact small-number helpers (saturating and wrapping arithmetic)
 *   ssa/      SSA construction — from a graph and dominators to phi placement
 *   term/     terms over a signature, matching and substitution
 *   pe/       partial evaluation — specialization over a term and an affine form
 *   check/    executable laws over library results (a checker per admitted algorithm)
 *   measure/  cost measures over library results (sizes, depths)
 */
export { liveness, reachableBlocks } from './flow/liveness.js';
// The solver's own `depthFirst` (over a FlowGraph) is not re-exported here: the graph module's
// `depthFirst` (over a Digraph) already owns the name; it stays reachable through the module and
// through the framework dataflow layer that re-exports the whole solver.
export { DataflowError, solve } from './flow/solve.js';
export type { FlowGraph, SolveOptions, Solution } from './flow/solve.js';
export { minmax, NUMBERS } from './num/minmax.js';
export type { FloatOrder, MinMax, MinMaxProfile } from './num/minmax.js';
export { binary32, BITS, CANONICAL_NAN, fromBits, isNaNBits, toBits } from './num/binary32.js';
export type { Binary32Ops } from './num/binary32.js';
export type { LiveBlock, LiveGraph, Liveness, LivenessScope } from './flow/liveness.js';

export { predecessors } from './graph/digraph.js';
export type { Digraph, Edge } from './graph/digraph.js';
export { depthFirst } from './graph/orders.js';
export type { DfsOrder } from './graph/orders.js';
export { dominates, dominators, dominatorTree } from './graph/dominators.js';
export type { Dominators } from './graph/dominators.js';
export { naturalLoops } from './graph/loops.js';
export type { NaturalLoop } from './graph/loops.js';

export {
  BOT,
  I32_MAX,
  I32_MIN,
  TOP,
  flatLattice,
  intervalLattice,
  lattice,
  mapLattice,
  setLattice,
} from './lattice/lattices.js';
export type { Flat, Interval, Json, Lattice } from './lattice/lattices.js';

export { add, constant, plain, substitute, value, variable } from './affine/forms.js';
export type { Affine } from './affine/forms.js';
export { distanceVector, isZero } from './affine/distances.js';
export { direction, orderViolation, stripMine } from './affine/directions.js';
export type { Direction, OrderViolation, ScheduledLoop } from './affine/directions.js';

export { solveFor } from './flow/solve-for.js';
export type { Budget, Equations, Solution as LocalSolution } from './flow/solve-for.js';
