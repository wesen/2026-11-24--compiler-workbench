# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Implemented: `src/framework/dataflow/solver.ts` moved to `src/stdlib/flow/solver.ts` with the body of `solve` unchanged (the entry walk is the library's `flowOrder`; the framework re-exports it as `depthFirst`), so `dataflow()` and Typed's three dataflow analyses keep working and the baselines print `no differences`; liveness rewritten on `solve` with the set lattice under both scopes, with a phantom entry block for `all-blocks`, old sweep deleted; `tests/stdlib/flow.test.mjs` (8 tests: forward and backward fixpoints, widening refused and used, `widenAfter`, unreachable block in both directions, bad entry, framework re-export identity, liveness against a verbatim copy of the old sweep on 300 generated graphs, the trap cases); interleaved two-build timing probes: corpus `speed` compile +0.4% (5 rounds, 50 projects), liveness per call +16..28% on real machine code (about 2 ms of a 32 s build); suites 554 pass / 0 fail / 3 pre-existing skips; `npm run check` clean, site builds

### Related Files

- src/stdlib/flow/solver.ts — the moved solver
- src/framework/dataflow/solver.ts — the re-export shim
- src/stdlib/flow/liveness.ts — the second client
- src/stdlib/index.ts — the library index
- src/typed/analyses.ts — FlowGraph from the library index
- tests/stdlib/flow.test.mjs — the solver's tests and the liveness comparison
