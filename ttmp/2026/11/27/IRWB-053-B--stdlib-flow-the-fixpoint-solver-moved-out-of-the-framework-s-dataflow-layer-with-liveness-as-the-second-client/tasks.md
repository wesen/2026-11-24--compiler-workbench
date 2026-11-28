# Tasks

## TODO

- [x] read the ground: `src/stdlib/index.ts` (admission rule, layering, the `flow/` line), the framework solver, liveness, `tests/stdlib/*`, `tests/framework/layering.test.mjs`
- [x] move `solve`, `FlowGraph`, `SolveOptions`, `Solution`, `DataflowError` and the entry walk into `src/stdlib/flow/solver.ts`, body unchanged
- [x] `src/framework/dataflow/solver.ts`: re-export shim, `depthFirst` kept as the old name of the library's `flowOrder`
- [x] `src/stdlib/index.ts`: export the solver; `flow/` "what exists now" line; drop the "later" line it replaces
- [x] `src/typed/analyses.ts`: take `FlowGraph` from the library index
- [x] rewrite `src/stdlib/flow/liveness.ts` on `solve` with `setLattice()`, both scopes, same facts; old sweep deleted
- [x] `tests/stdlib/flow.test.mjs`: forward/backward fixpoints, widening (refused and used), unreachable block, bad entry, re-export identity, liveness vs the old sweep on 300 generated graphs, empty graph
- [x] probes: speed timing (01, one build per run — undecided by drift), interleaved speed (02), interleaved liveness (03)
- [x] acceptance: `npm run build` + baselines `check` (`no differences`), `npm run check`, `tools/build-site.mjs`, the five suites, prettier
- [x] diary and report in `reference/`

## Follow-ups (not this step)

- [ ] `all-blocks` needs a phantom entry block to say what it means to the solver (report, "Left out"): a
      scope option on the solver, or a solver over a set of entries, would remove the trick
- [ ] the solver's two schedules (`worklist`, `round-robin`) are both still in the library because Typed's
      three dataflow analyses pick the round-robin one to reproduce Compiler Workbench's facts; one schedule
      would need its baselines re-recorded, which is not a library extraction
- [ ] `src/framework/dataflow/analysis.ts` still imports `solve` through the shim; a later step can point it
      at the library directly, as `typed/analyses.ts` now points at the library for `FlowGraph`
