Wrote [reference/02-report.md](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-sh-irwb-022-i/ttmp/2026/11/26/IRWB-022-I--lowering-tix-to-cuda-with-checked-execution-on-the-gpu-machine/reference/02-report.md) and committed it as `ff1c4e7`. The evaluated code remains identical to `dd8b7b6`.

Every independently reported CUDA output matched f32 bit for bit. The [diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-sh-irwb-022-i/ttmp/2026/11/26/IRWB-022-I--lowering-tix-to-cuda-with-checked-execution-on-the-gpu-machine/reference/01-implementation-diary.md) records the emitter locations and ten reproducible witnesses. The aggregate f64 maxima came without the inputs or traces needed to pinpoint their individual rounding steps.

- **Matmul and conv2d** round products and each sum step.
- **Split sums** round separately in their inner and outer folds.
- **Softmax** rounds the shifted exponential, denominator and division.
- **Attention** adds rounded score and value contractions around the same normalization.
- **Layernorm** rounds the square root and subsequent normalization arithmetic.
- **MLP** rounds GELU constants, arithmetic and `tanh`, along with both dense contractions.
- **NaN encoding** differed in one untimed replay of generated `sqrt`. CUDA returned `0x7fffffff` and Node returned `0xffc00000`.

The evidence supports a stronger preservation check than the implemented f64 tolerance. Compare output shapes and exact f32 words against the current Tix revision, including signed zeros and signed infinities, and compare NaNs by class. The exhaustive rounded transcendental comparison and correctly rounded IEEE arithmetic support that relation on the tested toolchain. The square-root replay rules out strict NaN word equality.