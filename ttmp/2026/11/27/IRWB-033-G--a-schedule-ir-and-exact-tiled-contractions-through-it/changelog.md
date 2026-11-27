# Changelog

## 2026-11-27

- Design of the schedule IR and the tiled contractions, and the hand-tiled GEMM probe (script 01, commit `1bfcc95`).
- The schedule IR (`tensor.schedule` v1), its adapter, the build from the fusion plan, `contractionOf` and the
  accumulation-order claim.
- Four scheduling passes with legality and the order gate, and the strategy that picks them.
- The tiled contraction kernel: one `template <bool Tiled>` definition, the launch-time body choice and the
  `--tile=tiled|plain` flag; `CudaIR` v3 and `tensor.lower-cuda` v3.
- Framework: `PassSpec.source`, so a pass may read an artifact of another IR kind.
- Tests: `tests/tensor/schedule.test.mjs` (15, no GPU), `tests/tensor/tiled-gpu.test.mjs` (7, GPU).
- Report, diary and the benchmark scripts 02 to 04 with their outputs.
