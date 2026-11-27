---
Title: Implementation diary
Ticket: IRWB-029-F
Status: active
Topics:
    - compiler
    - ir
    - verification
    - cuda
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-029-F--stage-3-checked-statement-fusion-for-the-tix-cuda-lowering/scripts/01-stage2-parity.mjs
      Note: fuse:false is byte-identical to the stage 2 emitter at the base commit
    - Path: repo://ttmp/2026/11/26/IRWB-029-F--stage-3-checked-statement-fusion-for-the-tix-cuda-lowering/scripts/03-corpus-measurements.mjs
      Note: Corpus kernel counts, benchmark medians and analytic byte counts
    - Path: repo://ttmp/2026/11/26/IRWB-029-F--stage-3-checked-statement-fusion-for-the-tix-cuda-lowering/scripts/04-softmax-attributes.mjs
      Note: Stage 2 single-statement timings that bound the fused softmax
ExternalSources: []
Summary: Stage 3 design, the fusion planner and group kernels, the block-mapping failure, the warp mapping and contraction refusal, and the final measurements.
LastUpdated: 2026-11-26T21:30:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1. Design

I read the stage 1 and stage 2 designs, reports and diaries, then the emitter, contract, runtime and planner-relevant model code. The [design](../design-doc/01-checked-statement-fusion.md) fixes: a pure planner on the Tix IR plus the emitter (not a pass, not a kernel-IR artifact); groups of consecutive statements sharing a row dimension, with row-local/row-free load classification; two mappings (row group with shared staging, register chain); a 12,288-float static shared cap with an in-kernel global staging fallback; and the same exact differential check for the fused lowering. Committed as `8926854`.

## Step 2. Planner and emitters, fuse:false parity

`src/tensor/fusion.ts` computes the plan; `cuda-source.ts` gained a shared scalar walker, the row-group kernel and the chain kernel behind `options.fuse` (default true). Script 01 extracts the base commit's emitter, transpiles it with esbuild next to the current build and compares: **`fuse:false` is byte-identical to stage 2** on all six corpus programs. The first fused sources placed softmax, layernorm, attention (4/4/6 statements) into one kernel each and mlp's three statements into one kernel. A missing opening brace in the staging loop and an unbound `.ptr` on the chain kernel's count argument were caught by inspection and the first GB10 compile, respectively.

## Step 3. First measurement: the block-per-row mapping fails

The first GB10 smoke run was bit-identical everywhere and `checkLowering` accepted all six fused programs as exact, but the corpus benchmark showed the fused **softmax at 1.60 ms against stage 2's 0.81 ms** — the flagship case ran 2× slower. Cause: one block per row leaves 255 threads idle while lane 0 walks the row's serial reductions, and 48 KB of static shared per block caps the resident blocks, so only ~70 rows were in flight at once. Second failure in the same run: fusing mlp's `y` contraction into the row kernel serialized a 1024-long dot into each lane — **mlp 2.40 ms against 0.94 ms unfused**.

## Step 4. One warp per row; contractions keep the per-element mapping

Two changes, both recorded in the design. First, the row kernel now runs **one warp per row**: each warp stages its own slice of the static shared array, statements are ordered with `__syncwarp()` (the row guard is warp-uniform), and the host picks the block's warp count so every slice fits (a precedence bug in the emitted warp-count expression — `12288u / (A) + (B)` — was caught while updating tests). Second, a statement whose reduction body loads a **row-free** tensor (a matrix operand) never joins a group: it may start one, with a pointwise epilogue chained behind it through registers. The register-chain mapping was generalized to same-shape groups of any rank with reductions, which is exactly mlp's `h`+`g` epilogue. After this, mlp measured 0.85 ms and attention 0.92 ms, both faster than stage 2, and all 15 GB10 tests passed, including the shared-cap fallback at C = 13000.

## Step 5. Final measurements

[Script 03](../scripts/03-corpus-measurements.mjs) measures both lowerings at the brief's sizes; [script 04](../scripts/04-softmax-attributes.mjs) times stage 2's individual softmax kernels; [script 05](../scripts/05-contract-cost.mjs) times the contract. The fused and unfused GPU outputs are bit-identical (NaN as a class) on every measured input. The fused softmax's 0.72 ms is bounded by the 4.2M double-`exp` calls (0.369 ms alone) that the exact relation requires on this toolchain — the 4.25× prototype result is not reachable bit-identically here. The byte counter initially used the fused plan for both sides and reported identical bytes; fixed and re-run.

## Review instructions

`npm run build`; `node --test tests/tensor/*.test.mjs` (the GB10 file needs the GPU machine); scripts 01, 03, 04, 05 from the worktree root. `git log --oneline` shows one commit per working boundary; the last commit holds the measured state.
