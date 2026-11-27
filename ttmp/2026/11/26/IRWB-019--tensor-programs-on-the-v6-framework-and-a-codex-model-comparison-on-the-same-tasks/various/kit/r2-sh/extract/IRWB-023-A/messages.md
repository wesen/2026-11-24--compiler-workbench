## 1

I’m using the docmgr and diary skills to create IRWB-023-A and record the evidence as I go. I’ll read both stage designs and final reports before tracing the implementation and choosing experiments.

## 2

The stage reports distinguish preserving the current f32 expression tree from testing against an f64 tolerance. I’ll use that distinction in the experiments. I’m also using the deep-research skill to trace which scheduling and verification ideas already exist in the literature.

## 3

The local build and import probe passed, and the remote runner reported NVIDIA GB10, sm_121, with CUDA 13.0.88. I’ll benchmark the fused kernels alongside the generated stage-2 kernels in the same process, so each pair gets identical inputs and interleaved timing.

## 4

The first paired measurements show 1.94× for softmax and 2.51× for layernorm, with every compared output word equal. The attention run exposed a host buffer-size bug in my harness. I’ve isolated it to the output download and will rerun attention after correcting the allocation.

## 5

The corrected attention run matched all 65,536 full-size output words and improved from 1.048 ms to 0.770 ms. The INT8 path also matched every output word on its exact grid, but a single guard miss made the first fallback 2.32× slower than stage 2. I’ll test whether that penalty comes from the fallback’s lane mapping.

## 6

Both certificate-generated kernels ran on the GB10 and matched every compared output word. They reached 1.98× for softmax and 2.48× for layernorm at 4096×1024. The stronger matmul comparison changed my recommendation. Exact FP32 tiling beat scan-and-pack even when the INT8 guard passed.

## 7

The design and diary are complete. Docmgr validation passed, and all 19 focused tensor tests passed after a fresh build. I’ll commit the final ticket and verify that every change is inside it.

## 8

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
