/**
 * IRWB-001 E4: a worklist solver for monotone dataflow problems over a flow graph.
 *
 * IRWB-053-B moved the solver itself into the standard library (`src/stdlib/flow/solver.ts`: `solve`, its
 * `FlowGraph`, `SolveOptions` and `Solution` types, the entry walk and `DataflowError`) and this module
 * re-exports it, so every caller of the dataflow layer — `dataflow()` in `analysis.ts`, and through it Typed's
 * liveness, reaching definitions and ranges — keeps its import and its behaviour. The library imports nothing
 * outside `src/stdlib/`; the dependency runs one way, framework -> library, as it does for the lattices
 * (`dataflow/lattices.ts`).
 *
 * The one name that changes: the entry walk is the solver's `flowOrder` in the library, because the library also
 * exports the graph primitive it is built on as `depthFirst`. The framework keeps the old spelling, so
 * `depthFirst(flowGraph)` from this module is still the solver's.
 */
export * from '../../stdlib/flow/solver.js';
export { flowOrder as depthFirst } from '../../stdlib/flow/solver.js';
