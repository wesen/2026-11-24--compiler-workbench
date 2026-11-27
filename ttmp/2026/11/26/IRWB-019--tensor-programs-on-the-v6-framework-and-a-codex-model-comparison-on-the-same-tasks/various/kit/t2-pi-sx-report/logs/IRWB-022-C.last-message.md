[Final report: `reference/02-report.md`](ttmp/2026/11/26/IRWB-022-C--checked-tix-lowering-to-cuda-on-the-gpu-machine/reference/02-report.md) · Commit `693500eddda2d058ae889bd8f277fcd1e86ee296`. No changes under `src/`, `tests/`, `corpus/`, or `tools/`.

**No CUDA–f32 mismatch was reported.** The nonzero deltas were against f64. The diary records the rounding sites by `file:line`; the aggregate results cannot isolate which instruction caused each maximum.

- **Matmul:** f32 products and sequential accumulator updates.
- **Softmax:** f32 shift subtraction, exponential conversion, normalization sum, and division.
- **Layernorm:** f32 mean and variance calculations, square root, and final affine arithmetic.
- **Attention:** f32 dot products, square-root scaling, softmax, and weighted sums.
- **MLP:** f32 affine layers, GELU constants and polynomial arithmetic, and tanh conversion.
- **Conv2d:** f32 filter products and ordered accumulator updates.

**The implemented tolerance is not the strongest relation supported.** On the evaluated GB10/Node configuration, the evidence supports exact comparison against the immediate revision’s f32 result, including signed zeros and infinities, with NaNs compared as a class. The lowering preserves rounding sites and reduction order, the coordinator’s exhaustive sweep found agreement for the widened transcendental operations, and the independent whole-program comparisons found no f32 mismatch. That supports a stronger sampled gate, not a proof for all programs or a portability claim. The evaluated contract remains unchanged.
