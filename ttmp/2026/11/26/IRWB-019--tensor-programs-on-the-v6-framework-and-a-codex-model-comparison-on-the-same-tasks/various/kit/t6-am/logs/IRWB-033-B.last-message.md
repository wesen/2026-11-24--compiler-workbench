IRWB-033-B is complete. Exact matmul ran **4.15× faster at 512³** and **9.29× faster at 4096³** than the stage 3b fused baseline. Whole attention improved **3.57×**, MLP **2.72×**, and conv2d **1.44×**. No corpus program regressed at the requested shapes. Performance at unmeasured shapes remains an inference from the dispatch rule.

[Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-am-irwb-033-b/ttmp/2026/11/27/IRWB-033-B--checked-schedules-for-exact-tiled-contractions/index.md) · [Design committed before implementation](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-am-irwb-033-b/ttmp/2026/11/27/IRWB-033-B--checked-schedules-for-exact-tiled-contractions/design-doc/01-scheduling-exact-contractions.md) · [Final report and measurements](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-am-irwb-033-b/ttmp/2026/11/27/IRWB-033-B--checked-schedules-for-exact-tiled-contractions/reference/02-results.md)

### Contraction measurements

Each pair is **fused / unfused**, using the median of five alternating benchmark calls on GB10. Attention and MLP rows time individual launches with their actual intermediate inputs. The fused MLP hidden launch includes bias and GELU. The last column gives throughput relative to the supplied cuBLAS reference.

| Contraction | GPU ms, F / U | TFLOP/s, F / U | cuBLAS throughput, F / U |
|---|---:|---:|---:|
| Matmul 512³ | 0.0522 / 0.2183 | 5.15 / 1.23 | 63% / 15% |
| Matmul 4096³ | 14.5144 / 133.9223 | 9.47 / 1.03 | 49% / 5% |
| Attention score | 0.0291 / 0.6167 | 4.62 / 0.22 | 61% / 3% |
| Attention value | 0.0723 / 0.0943 | 1.86 / 1.42 | 30% / 23% |
| MLP hidden | 0.1335 / 0.4704 | 4.02 / 1.14 | 32% / 9% |
| MLP output | 0.0965 / 0.3936 | 5.56 / 1.36 | 49% / 12% |
| Conv2d | 0.1152 / 0.1661 | 2.46 / 1.71 | — |

### Compiler and verification

Both public lowering modes now compile through **Tix → schedule IR → CUDA**. The initial schedule imports the existing fusion groups, staged terms, row storage, and gate. Nine native passes handle output tiling, register tiling, shared-panel staging, vector loads, register packing, wide tiles, phase fusion, shape dispatch, and operand reuse across output channels. Each changed revision carries a correspondence that preserves the identity of its reductions.

A synchronous strategy applies the passes in dependency order and emits shape predicates. At 512³ it selects a 64×64×16 tile with 4×4 outputs per thread. At 4096³ it selects 128×128×16 with 8×8 outputs per thread. Each output visits K in increasing order and rounds its multiply and add separately. Attention uses three launches and MLP two, with one `__global__` definition apiece.

The pass experiments showed where the speed came from. At 512³, scalar shared staging alone was slower than register tiling alone, **0.0885 vs 0.0741 ms**. Four-word global loads brought it to **0.0701 ms**, and packed register fragments to **0.0517 ms**. For convolution, reusing one input word across four output channels preserved the original fold and delivered the measured 1.44× gain.

The sole framework change lets a pass own a synchronous structural postcondition, enforced by both pass application paths. The CUDA remote tool required no changes. All **68 CPU/framework tests and 23 GPU tests passed**. All six corpus lowerings and a representative intermediate revision for each of the nine passes checked as `exact`. The checker also rejected a deliberately corrupted packed load. Cold corpus checks took 8.6–26.5 seconds each. Replay submitted zero GPU batches.

Final commit `a6acedcd5342ea39928bcfcc9c9e681d9b535de3`. The worktree is clean.