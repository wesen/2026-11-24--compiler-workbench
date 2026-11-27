# Tasks

## Stage 6 (IRWB-033-G)

- [x] Read stage 3b's, stage 3's and stage 2's designs and reports, and the framework docs.
- [x] Probe a hand-written exact tiled GEMM on the GB10 before designing (script 01).
- [x] Write and commit the design (commit `1bfcc95`).
- [x] Framework: a pass may read another IR kind (`PassSpec.source`).
- [x] The schedule IR: artifact, adapter, build from the fusion plan, `contractionOf`, the order claim.
- [x] Four scheduling passes with legality, the order gate and the refusals.
- [x] The strategy that picks the steps and the tile shape.
- [x] The tiled contraction kernel, the launch-time body choice and `--tile`.
- [x] `CudaIR` v3, `tensor.lower-cuda` v3, `tiles` in the run result, both sides in the differential's cases.
- [x] Tests: `schedule.test.mjs` (15, no GPU) and `tiled-gpu.test.mjs` (7, GPU); the existing GPU suites re-run.
- [x] Measure: the corpus fused and unfused, matmul at both sizes, the four standalone GEMMs, the contract's cost.
- [x] Report, diary, changelog, scripts with their outputs.

## Later

- Tiling inside the block-mode fused kernels (several rows per block).
- A launch-time choice of tile shape; double buffering; vector loads; a cost model.
- A synchronous executor for `src/framework/strategy`.
- A two-record correspondence Tix → schedule → CUDA.
