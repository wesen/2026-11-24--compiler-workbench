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
 *   affine/   affine forms — exact linear forms over named variables, and their dependence distances
 *
 * Later modules, one line each (each enters under the admission rule, with its two clients):
 *   graph/    dominators and loops — the dominator tree, dominance frontiers, natural loops
 *   lattice/  lattices — joins, order, widening for dataflow and constant propagation
 *   num/      exact small-number helpers (saturating and wrapping arithmetic)
 *   flow/     the fixpoint solver over a lattice (liveness hardcodes its own; this generalises it)
 *   ssa/      SSA construction — from a graph and dominators to phi placement
 *   term/     terms over a signature, matching and substitution
 *   pe/       partial evaluation — specialization over a term and an affine form
 *   check/    executable laws over library results (a checker per admitted algorithm)
 *   measure/  cost measures over library results (sizes, depths)
 */
export { liveness, reachableBlocks } from './flow/liveness.js';
export type { LiveBlock, LiveGraph, Liveness, LivenessScope } from './flow/liveness.js';

// affine forms and the distances between them: a namespace each, since `value`, `constant` and
// `distance` are names every library module would want to export.
export * as affine from './affine/forms.js';
export * as dependence from './affine/distances.js';
