# Tasks

## TODO
- [ ] Move framework/dataflow/solver.ts to stdlib/flow (solve, FlowGraph, SolveOptions, Solution); re-export from the dataflow layer <!-- t:8iq9 -->
- [ ] Rewrite stdlib/flow/liveness.ts on solve with the set lattice, same results (both scopes) <!-- t:ch5t -->
- [ ] Measure corpus compile time under speed before/after; keep both implementations if liveness is >10% slower <!-- t:zmzq -->
- [ ] Tests: solver on small graphs (forward, backward, widening loop, unreachable block); liveness-via-solver == old liveness on generated graphs <!-- t:j80l -->
- [ ] Acceptance: baselines no differences, suites pass, tsc clean, site builds; diary and report <!-- t:8l6f -->
