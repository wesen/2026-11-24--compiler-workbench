# Tasks

## TODO

- [x] read the admission rule, the layering and the one existing module (`src/stdlib/index.ts`, `flow/liveness.ts`, `tests/stdlib/`)
- [x] decide what the move needs that the brief did not say: a library-local `Json` (layering), the framework import rule, SCCP's element shape
- [x] move the interface and the set, flat, interval and map lattices into `src/stdlib/lattice/lattices.ts`, unchanged
- [x] `src/stdlib/index.ts`: export the module; `src/framework/dataflow/lattices.ts`: re-export it
- [x] SCCP (`src/typed/sccp.ts`): `Lat = Flat<Const>`, `meet = flat.join`, top/bottom by use, not by name
- [x] `tests/stdlib/lattice.test.mjs`: the join laws on every triple, bottom identity, widening upper bounds, widening chains that stabilize, the thresholds, encode/decode, one copy
- [x] amend `tests/framework/layering.test.mjs` (import rule) and `tests/typed/ssa.test.mjs` (element shape), with reasons
- [x] probes: the type constraint, the old lattice vs the library lattice, SCCP over the corpus before and after
- [x] acceptance: `npm run build` + the baselines `check` (no differences), `npm run check`, `tools/build-site.mjs`, the four suites, prettier
- [x] diary and report in `reference/`

## Follow-ups (not this step)

- [ ] the solver (`src/framework/dataflow/solver.ts`) and `src/typed/analyses.ts` are their own step: a `widen` on the `Lattice` interface itself, so a solver can widen any lattice, would enter there
- [ ] if the framework is meant to depend on nothing outside itself, the re-export has to be revisited (report, "Left out")
