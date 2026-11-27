/**
 * The standard library of compiler algorithms: pure, synchronous functions over small shape interfaces, never over a
 * domain's types. A module here knows nothing about `src/framework/`, `src/typed/` or `src/tensor/`, and does not
 * import them (`tests/stdlib/imports.test.mjs` enforces that).
 *
 * Admission (IRWB-039 phase 2, from R3): a named theory, at least two clients, an executable test — and the
 * promotion test names both clients, the law, the code it retires, and one input on which a careless extraction
 * would change meaning.
 *
 * Layers, from design doc D of IRWB-039. A module may import another library module only from its own layer or a
 * lower one; `check/` and `measure/` see everything.
 *
 *   leaf    graph/  lattice/  num/     use nothing from the library
 *   middle  ssa/  flow/                use the leaves
 *   upper   pe/  affine/  term/        use the leaves and the middle
 *   top     check/  measure/           use anything
 *
 * What exists today:
 *
 *   flow/liveness.ts   liveness by backward gen/kill dataflow, over numbered blocks and items; an explicit scope
 *                      ('all' blocks or 'entryReachable') because the two disagree on unreachable blocks. Clients:
 *                      intervals() in src/typed/backend/regalloc.ts, coalesceCopies() in src/typed/backend/coalesce.ts.
 *
 * What later steps put here, one line each (the design doc's Phase 2 and 4):
 *
 *   graph/dominators.ts   immediate dominators (Cooper, Harvey and Kennedy) and the dominator tree
 *   graph/loops.ts        natural loops, preheaders, loop bodies
 *   graph/postorder.ts    depth-first order, reverse postorder, retreating edges
 *   lattice/lattices.ts   the lattice interface and the standard instances (flat, powerset, map, interval)
 *   lattice/fixpoint.ts   worklist and round-robin solvers with widening at loop heads (liveness's own loop moves here)
 *   num/intervals.ts      integer intervals, their arithmetic and comparison rules
 *   ssa/ssa.ts            SSA construction and destruction (renaming over the dominator tree)
 *   pe/partial-eval.ts    folding, residualisation and solving for a constant
 *   affine/affine.ts      affine forms over index expressions
 *   term/terms.ts         a term signature with matching and instantiation
 *   check/verify.ts       translation-validation helpers shared by meaning contracts
 *   measure/frequencies.ts block and edge frequencies and the cost estimates built on them
 */
export { liveness, type Liveness, type LivenessScope, type LivenessShape } from './flow/liveness.js';
