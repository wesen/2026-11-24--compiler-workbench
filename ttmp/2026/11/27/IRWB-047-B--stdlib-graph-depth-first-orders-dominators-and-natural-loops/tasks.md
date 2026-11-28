# Tasks

## DONE

- [x] Read `src/stdlib/index.ts` (admission rule, layering D), liveness and its tests, IRWB-039 phase 2c
- [x] Record the starting baseline (`02-baselines.mjs check` on the untouched checkout): no differences
- [x] Ticket, design (`design/01-…md`), diary, report
- [x] `src/stdlib/graph/{digraph,orders,dominators,loops}.ts` and the index exports
- [x] `src/typed/analyses.ts`: `cfgOf`, `dominatorsOf`, `domView`, `loopsOf` as adapters; old copies deleted
- [x] `src/framework/dataflow/solver.ts`: `depthFirst` is the library's walk
- [x] `tests/stdlib/graph.test.mjs` (8 tests) and the index-export test; framework layering rule narrowed
- [x] Acceptance: baselines `no differences`, four suites green, tsc clean, site builds

## TODO

- None in this step. Later (not this ticket): `src/typed/backend/frequency.ts`'s own reverse postorder
  is a third copy of `depthFirst`; dominance frontiers belong in `graph/` (one line in the index).
