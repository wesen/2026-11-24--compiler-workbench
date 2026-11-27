# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Schedule IR between Tix and CUDA with five checked layout passes and an accumulation-order analysis; exact tiled
contractions with a launch-time cost model and a stage-2 fallback for small grids; matmul 512^3 0.0628 ms (3.4x the
base, 0.29x the base's time), 4096^3 17.2 ms; no corpus program slower; framework: synchronous pass claims and a
sync strategy executor.

### Related Files

- src/tensor/schedule.ts — the IR, the passes, the order analysis
- src/tensor/strategy.ts — the rule and the cost model
- src/tensor/cuda-source.ts — emitGemm and the printer
- src/framework/strategy/sync.ts — runPlanSync
