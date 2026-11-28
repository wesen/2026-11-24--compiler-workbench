# Tasks

## DONE

- [x] design: interface, scope decision, layout (design-doc/01)
- [x] `src/stdlib/index.ts` and `src/stdlib/flow/liveness.ts`
- [x] `tests/stdlib/liveness.test.mjs` (8 tests, includes the unreachable block under both scopes)
- [x] `tests/stdlib/imports.test.mjs` (no import outside src/stdlib; the layers; the index)
- [x] `intervals()` in regalloc.ts reads the primitive; its sweeps deleted
- [x] `coalesceCopies()` reads the primitive; its sweeps deleted
- [x] baselines check: `no differences`
- [x] the four suites, `npm run check`, `node tools/build-site.mjs`
- [x] probes 01 (the unreachable-block case) and 02 (the corpus has no unreachable block)
- [x] report in the ticket (reference/02-report.md)

## TODO

- [ ] later steps: `graph/`, `lattice/`, `ssa/` moved (IRWB-039 2c), and `physicalOccupancy`'s bitmask sweep
      converted to the primitive (see the report, "Where the brief and the repository disagree")
