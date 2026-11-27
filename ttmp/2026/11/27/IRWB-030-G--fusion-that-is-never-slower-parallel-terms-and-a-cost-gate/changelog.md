# Changelog

## 2026-11-27

- Initial workspace created
- Baselines of the merged stage 3, fused against unfused, on the corpus, the "inside" variants and a probe set:
  found the two losses this stage fixes (`scripts/02-baseline-probe.jsonl`)
- Design: parallel terms and the cost gate
- Parallel terms in `planFusion`/`emitGroup`; the cost gate in `planFusion`, planned with the launch's shape values
  from `runTixCuda`
- Fixed the scalar writer's index naming, which collided when a staging loop and a fold bound the same axis
- Split-sum reductions stage one term per block of the split (`ceil(D/4)` terms)
- Tests: 10 plan tests, 5 GB10 tests; the existing tensor tests unchanged and passing
- Measurements, contract cost, and the report
