IRWB-022-H is ready for design review. Commit: `2e89818f0314`. No production code changed.

- [Ticket](ttmp/2026/11/26/IRWB-022-H--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/index.md)
- [Design and change ledger](ttmp/2026/11/26/IRWB-022-H--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/design-doc/01-lowering-and-checking-one-cuda-translation-unit.md)
- [Diary and reproducible GB10 probe](ttmp/2026/11/26/IRWB-022-H--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/reference/01-stage-2-diary.md)

**Lowering:** Emit CUDA directly from the current Tix IR. It already represents statement boundaries and ordered reductions, including the nested folds produced by `split-sum`.

**Relation:** Use the stage-1 tolerance against the original f64 reference: `abs(got − ref) ≤ 2e-6 + 2e-5·abs(ref)`. On the GB10 with nvcc 13.0.88, `expf` differed from rounded JavaScript `Math.exp` on 5,007 of 16,384 inputs, ruling out bit identity for this mapping. Across all four probed intrinsics, the largest error consumed less than 0.66% of the budget. Whole-function agreement remains for the contract to check after implementation.

**Framework:** No source changes proposed. Use the existing asynchronous transformation contract and analysis manager to check one remote batch per function and reuse observations keyed by candidate, case bytes and engine profile.

**Remote tool:** Isolate concurrent runs’ outputs, lock publication of cached binaries, include compiler identity and flags in the build key, and expose the engine profile for evidence reuse.
