/**
 * IRWB-001 E4: the worklist solver for monotone dataflow problems over a flow graph.
 *
 * IRWB-053-A moved the solver itself into the standard library (`src/stdlib/flow/solve.ts`:
 * `solve` with its `FlowGraph`, `SolveOptions` and `Solution` types, the `depthFirst` order it takes
 * from `stdlib/graph`, and `DataflowError`) and this module re-exports it, so every caller of the
 * dataflow layer keeps its import. The library imports nothing outside `src/stdlib/`; the dependency
 * runs one way, framework -> library. The doc comment on the solver is in the library.
 */
export * from '../../stdlib/flow/solve.js';
