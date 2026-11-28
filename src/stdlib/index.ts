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
 *   flow/     backward gen/kill liveness and demand-driven equation solving with widening
 *   graph/    orders, dominators, natural loops — over one digraph: nodes, an entry, successors
 *   lattice/  lattices — join, order and widening: the set, flat, interval and map lattices
 *             (dataflow's ranges analysis, and SCCP's flat lattice of SSA names)
 *   affine/   forms — linear expressions over index variables, computed exactly; distances — dependence
 *             distance vectors over them (a read's index per position against the consumer's axis)
 *   num/      binary32 arithmetic on bit patterns, and min/max under a named IEEE 754-2019 profile
 *
 * Later modules, one line each (each enters under the admission rule, with its two clients):
 *   graph/    dominance frontiers
 *   num/      exact small-number helpers (saturating and wrapping arithmetic)
 *   flow/     the fixpoint solver over a lattice (liveness hardcodes its own; this generalises it)
 *   ssa/      SSA construction — from a graph and dominators to phi placement
 *   term/     terms over a signature, matching and substitution
 *   pe/       partial evaluation — specialization over a term and an affine form
 *   check/    executable laws over library results (a checker per admitted algorithm)
 *   measure/  cost measures over library results (sizes, depths)
 */
export { liveness, reachableBlocks } from './flow/liveness.js';
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

export { solveFor } from './flow/solve-for.js';
export type { Budget, Equations, Solution } from './flow/solve-for.js';
