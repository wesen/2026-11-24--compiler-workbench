# Tasks

## TODO

- [x] Read stages 1 to 3 and the framework; measure where stage 3's fusion loses (`scripts/02-baseline-*.jsonl`)
- [x] Write and commit the design
- [x] Parallel terms: plan from the IR (`planTerms`), emit term arrays, fold in the meaning's order
- [x] Cost gate: keep a block-mode group unfused when its block is under a warp, from the launch's shape values
- [x] Tests: `tests/tensor/terms.test.mjs` (no GPU), `tests/tensor/terms-gpu.test.mjs` (GB10)
- [x] Measure kernel counts, benchmark times, and the contract's cost
- [x] Report
- [ ] Later: several rows per block for short rows; chunked term arrays
