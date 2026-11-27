Completed [IRWB-033-A](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-sm-irwb-033-a/ttmp/2026/11/27/IRWB-033-A--schedule-ir-and-exact-tiled-contractions/index.md). The [design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-sm-irwb-033-a/ttmp/2026/11/27/IRWB-033-A--schedule-ir-and-exact-tiled-contractions/design-doc/01-schedule-ir-and-ordered-cuda-tiles.md) was committed before implementation. The [final report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-sm-irwb-033-a/ttmp/2026/11/27/IRWB-033-A--schedule-ir-and-exact-tiled-contractions/reference/02-final-report.md) contains the whole-corpus timings, contract costs, and replay instructions.

Tix now lowers through a v6 schedule artifact. Three checked passes recognize contractions, map them to CUDA tiles, and add alternate phases to eligible fused row groups. The synchronous strategy uses shape and device-memory predicates. It selects 32 × 64 output tiles with 16-term shared-memory stripes and 4 × 4 register patches where the grid is large enough. Every output retains its original accumulation order, with separate f32 multiply and add rounding.

| Contraction | Fused ms | Unfused ms | TFLOP/s fused / unfused | Time vs. cuBLAS fused / unfused |
| --- | ---: | ---: | ---: | ---: |
| Matmul 512³ | 0.08848 | 0.21315 | 3.03 / 1.26 | 2.69× / 6.48× |
| Matmul 4096³ | 25.228 | 133.825 | 5.45 / 1.03 | 3.52× / 18.70× |
| Attention score and scale | 0.03328 | 0.61878 | 4.03 / 0.22 | 1.88× / 34.96× |
| Attention value | 0.09725 | 0.09526 | 1.38 / 1.41 | 4.50× / 4.41× |
| MLP first contraction | 0.14246 | 0.47018 | 3.77 / 1.14 | 3.37× / 11.12× |
| MLP second contraction | 0.15459 | 0.38006 | 3.47 / 1.41 | 3.25× / 8.00× |
| Convolution | 0.12528 | 0.16541 | 2.26 / 1.71 | — |

The fused first MLP timing includes GELU. Attention keeps its normalization fused and uses scalar mapping for the value contraction because the tiled variant was slower at 32 blocks. The row-local register patch was discarded after an attention word mismatch and slower smoke timings. No measured corpus workload regressed beyond the 5% noise band. Each still emits one `__global__` definition, with three launches for attention and two for MLP.

The framework change gives synchronous native-pass checks their revision correspondence. Measurements used the existing CUDA runner and timing lock. The build, 43 CPU-only tests, and 23 GB10 tests passed. The serial GPU rerun resolved five SSH connection failures from concurrent validation.

Last commit `0f41a93d8799a91dd5365088fe5c373112195d3f`. The worktree is clean.