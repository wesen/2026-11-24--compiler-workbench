---
Title: GB10 results and framework finding
Ticket: IRWB-022-H
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T15:49:41.705981505-05:00
WhatFor: ""
WhenToUse: ""
---

# GB10 results and framework finding

All six unoptimized programs passed their sampled GPU-to-origin-f64 checks. A deliberately incorrect CUDA translation that rounded its block count down failed through the same transformation postcondition. The numerical budget was not increased.

| Function and sizes | CPU interpreter ms | GPU median ms (min–max) | Eligible cases | Largest fraction of budget |
|---|---:|---:|---:|---:|
| matmul M=K=N=512 | 288981 | 0.1834 (0.1826–0.1884) | 15 | 0.02887 |
| softmax N=4096 C=1024 | 13652 | 0.5152 (0.5113–0.5222) | 15 | 0.00638 |
| layernorm N=4096 D=1024 | 21412 | 0.4754 (0.4740–0.4766) | 14 | 0.01282 |
| attention Q=K=1024 D=V=64 | 197772 | 0.9762 (0.9730–0.9832) | 15 | 0.01000 |
| mlp N=1024 D=256 H=1024 O=256 | 2137183 | 0.8637 (0.8573–0.8666) | 15 | 0.03253 |
| conv2d N=8 C=16 H=W=64 O=32 kernel 3×3 | 488625 | 0.1631 (0.1623–0.1649) | 12 | 0.24668 |

Timing and meaning checks use **different workloads**. Timing: Node 24.18.0 on shared host `f`, Intel i7-1165G7, one wall-clock interval around unmodified f32 `runTix` after a small warmup. This includes interpreter overhead and host contention. GPU: GB10, nvcc 13.0.88 `-O3 -arch=sm_121`, timed lock, one warmup then three CUDA event intervals per program on resident buffers with kernels preloaded. Kernel-only numbers exclude compilation, transfer and startup and are not end-to-end speedups. Both sides used identical seed-22 inputs; all input digests matched. First and last output elements were within 0.000002 of each other at all six sizes. This endpoint sanity check is not the whole-output contract.

Meaning: every output element on the small origin-derived finite cases, seed 20. The largest budget fraction was 0.247 (conv2d, signed stream, flat index 699 of [7,7,5,5]). No universal bound follows from this sample. Detailed coordinates, input digests, endpoint values and event intervals: [budget](../sources/budget.jsonl), [CPU](../sources/cpu.jsonl), [GPU](../sources/gpu.jsonl). Reproduce from the worktree root with `node <ticket>/scripts/03-bench.mjs cpu`, then `gpu` in place of `cpu`; `04-budget.mjs` runs the untimed margin experiment.

**Framework change ledger: empty.** The same-adapter pass runner is not a fit for cross-representation output. Existing heterogeneous transformation ports and `differential`'s async delegation and verdict memo cover the requirement without adding a kernel IR, evidence manager or tool feature. Warm replay and changed-source rejection were tested on the GB10. Native tool behavior (including shared remote directories for identical input packets) is unchanged. The postcondition retains verdicts, not measured margins: we collected the latter separately for this report to avoid extending evidence lifetime. No scheduling optimizations were added.
