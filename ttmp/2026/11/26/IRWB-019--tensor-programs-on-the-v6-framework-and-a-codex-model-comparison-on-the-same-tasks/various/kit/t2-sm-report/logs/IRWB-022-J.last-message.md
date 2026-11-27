[Final report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-sm-irwb-022-j/ttmp/2026/11/26/IRWB-022-J--lowering-tix-to-cuda-checked-on-the-gpu-machine/reference/02-report.md) committed as `78ff7086b8233864c20b845c25e63a8db5842726`. The evaluated code is unchanged, and the worktree is clean.

The independent evaluation found **zero f32 bit mismatches**. All ten reported f64 gaps reflect Tix’s prescribed f32 rounding. The aggregate maxima leave the exact contributing instruction at each maximum undetermined. The diary records the applicable emission sites with file and line references.

- **Matmul:** Products and accumulations round separately. The optimized version uses separate block and tail accumulators.
- **Softmax:** Shifted logits, exponentials, sums, and divisions round to f32. The optimized denominator uses split sums.
- **Layernorm:** Mean and variance folds, centering, square root, and output scaling all round to f32.
- **Attention:** Score and weighted-value dot products, score scaling, and softmax round to f32. The optimized version uses split sums.
- **MLP:** Affine products and accumulations, biases, GELU constants, and `tanh` round to f32. The optimized affine sums use split accumulators.
- **Conv2d:** Products and the ordered channel and spatial accumulation round separately.
- **Earlier NaN probe:** CUDA and Node returned different NaN words for `log(-1)`. Both results were NaNs.

The shipped tolerance is weaker than the strongest **sampled** relation supported on the evaluated GB10 and compiler configuration. That stronger relation requires identical f32 words for every non-NaN result, including signed zeros and infinities, and compares NaNs by class. The exhaustive intrinsic comparison, IEEE arithmetic, preserved reduction order, and zero observed program-level mismatches support it. The earlier `log(-1)` result sets the limit on raw word equality, and the program tests establish agreement only for the cases exercised.