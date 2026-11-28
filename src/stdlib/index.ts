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
 *   flow/     liveness — backward gen/kill liveness over blocks, with an explicit scope
 *   lattice/  lattices — the Lattice interface, the set, flat, interval (widen up-to thresholds) and map lattices
 *
 * Later modules, one line each (each enters under the admission rule, with its two clients):
 *   graph/    dominators and loops — the dominator tree, dominance frontiers, natural loops
 *   num/      exact small-number helpers (saturating and wrapping arithmetic)
 *   flow/     the fixpoint solver over a lattice (liveness hardcodes its own; this generalises it)
 *   ssa/      SSA construction — from a graph and dominators to phi placement
 *   term/     terms over a signature, matching and substitution
 *   affine/   affine forms — linear expressions over index variables
 *   pe/       partial evaluation — specialization over a term and an affine form
 *   check/    executable laws over library results (a checker per admitted algorithm)
 *   measure/  cost measures over library results (sizes, depths)
 */
export { liveness, reachableBlocks } from './flow/liveness.js';
export type { LiveBlock, LiveGraph, Liveness, LivenessScope } from './flow/liveness.js';
export {
  lattice,
  setLattice,
  flatLattice,
  intervalLattice,
  mapLattice,
  I32_MIN,
  I32_MAX,
  TOP,
  BOT,
} from './lattice/lattices.js';
export type { Json, Lattice, Flat, Interval } from './lattice/lattices.js';
