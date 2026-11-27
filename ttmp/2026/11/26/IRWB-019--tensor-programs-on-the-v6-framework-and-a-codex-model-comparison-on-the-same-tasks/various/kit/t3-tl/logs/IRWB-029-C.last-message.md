**Stage 3 is incomplete.** The committed implementation fuses single-use pointwise chains and some reduction epilogues, but it does not yet fuse the softmax or layernorm row pipelines. Per-kernel byte counts and bandwidth estimates are also outstanding.

Fusion planning lives beside the CUDA emitter, using resolved Tix expressions. This leaves the original lowering available through `fuse: false`; the framework can represent grouped correspondence, but this implementation does not create a kernel artifact to record it. No framework or remote-tool changes were made.

The measured kernel counts and median GPU times, after one warm-up, were:

| Program | Unfused kernels / ms | Fused kernels / ms |
|---|---:|---:|
| matmul | 1 / 0.2142 | 1 / 0.2140 |
| softmax | 4 / 0.7968 | 4 / 0.7955 |
| layernorm | 4 / 0.4733 | 4 / 0.4712 |
| attention | 6 / 1.0511 | 6 / 1.0512 |
| mlp | 3 / 0.9610 | 3 / 0.9312 |
| conv2d | 1 / 0.1676 | 1 / 0.1651 |

Fused and unfused output hashes matched for these measured inputs. The build and focused tests passed, and a GPU check accepted a fused reduction epilogue under the exact relation. The original tensor suite had one outdated default-kernel-count assertion; the updated focused test passed.

The [ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-tl-irwb-029-c/ttmp/2026/11/26/IRWB-029-C--checked-tix-fusion/index.md), [design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-tl-irwb-029-c/ttmp/2026/11/26/IRWB-029-C--checked-tix-fusion/design-doc/01-checked-fusion-design.md), and [partial report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-tl-irwb-029-c/ttmp/2026/11/26/IRWB-029-C--checked-tix-fusion/reference/02-partial-implementation-report.md) contain the implementation and measurement details.

Last commit: `eff1243`.