Completed IRWB-023-A. [Design](</home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-sh-irwb-023-a/ttmp/2026/11/26/IRWB-023-A--certified-scheduling-for-tix/design-doc/01-certified-scheduling-for-tix.md>) · [Research diary](</home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-sh-irwb-023-a/ttmp/2026/11/26/IRWB-023-A--certified-scheduling-for-tix/reference/01-research-diary.md>)

**Ranked proposals**

1. Keep row-local values in GPU shared memory, preserving f32 sum order and parallelizing max.
2. Check schedule certificates against the exact v6 revision and test the emitted CUDA independently.
3. Tile ordered FP32 contractions first. Use INT8 tensor cores when proven input provenance can amortize packing.

**Experiments**

- GB10 smoke probes reproduced explicit f32 rounding and all 256 expected signed INT8 WMMA results.
- Handwritten row fusion matched every compared word and sped up softmax **1.92×**, layernorm **2.57×**, and post-score attention **1.36×**.
- The schedule checker rejected **16/16 mutants** with under **0.35 ms p95** verification. The current sampled tolerance missed a modeled dropped tail and a signed-zero change, and rejected an exact f32 result.
- Certificate-generated CUDA matched every compared word, including shape fallback, and sped up softmax **1.98×** and layernorm **2.48×**.
- Exact FP32 tiling sped up 512³ matmul **3.80×**. Prepacked INT8 was slightly faster, but scanning and packing lost to the exact tile even on a guard hit.
- The dyadic guard accepted **2,400/2,400** synthetic on-grid dots with exact results and rejected **2,400/2,400** off-grid dots.
- Speculative sum carries verified **1/4,608** nonuniform proposals at width 1024 and **0/4,608** at width 4096.

The build and all 19 focused tensor tests passed. All changes are inside the ticket. The worktree is clean.

**Final commit** `02daa4177fed1c601cf56f84416a211bd1800930`