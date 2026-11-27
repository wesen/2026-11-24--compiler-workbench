[Final report](ttmp/2026/11/26/IRWB-022-F--lowering-tix-to-cuda-checked-on-the-gpu-machine/reference/02-report.md) · Commit `5fdea442e3a92e4dc10e2b49008110bc126906f9`. The evaluated backend is unchanged.

- **Softmax and attention**, including optimized cases: `expf` (`src/tensor/cuda-source.ts:13`) introduces differences before normalization.
- **MLP**, including optimized cases: `tanhf` (`src/tensor/cuda-source.ts:16`) perturbs GELU activations before the final linear layer.
- **Random programs:** `expf`, `logf`, and `tanhf` (`src/tensor/cuda-source.ts:13–16`) are confirmed primitive mismatch sources. The aggregate results do not identify which operation caused each of the four failures.
- **Differences from f64:** the backend rounds intermediate arithmetic and reduction steps to f32 (`src/tensor/cuda-source.ts:174,179`), so even f32-identical outputs can differ from the f64 reference.

Sampled f64 tolerance is the strongest of the two offered uniform relations supported by the evaluated implementation. Its float transcendental calls give concrete counterexamples to f32 identity, and the successful checks establish the tolerance only on sampled inputs. In one untimed GB10 probe, changing only the relevant call to double precision and rounding back to f32 removed every reproduced corpus mismatch. Together with the coordinator’s exhaustive primitive results, that supports an exact f32 check with NaNs compared by class for a revised emitter—not for the one evaluated here.
