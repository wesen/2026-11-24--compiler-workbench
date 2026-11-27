---
Title: Implementation diary
Ticket: IRWB-029-D
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T23:14:27.253373387-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## Step 1: Read stages 1 and 2, probe the GB10, write the design

I read the IRWB-020-B and IRWB-022-I designs and reports, the IRWB-024 fixes, the tensor sources and tests, and the framework's contracts and IR READMEs, `define-pass.ts` and `correspondence.ts`. Then I probed the GPU limits the row mapping depends on, recorded the stage-2 source digests that `fuse: false` must keep, and wrote the design (fusion as a legality analysis on the Tix IR plus a group emitter).

### Prompt Context
**User prompt (verbatim, opening excerpt):** "You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). ... Your ticket is IRWB-029-D. This is an **implementation stage**, in one session. Write a short design first and commit it. Then implement, test, measure, and write a final report in the ticket." The full brief (stage 3: checked fusion; fixed API with `fuse` and `benchmark`; measure kernel count, benchmark time, bytes per kernel; report framework changes) is in the session that created this ticket.
**Assistant interpretation:** Design, then implement order-preserving fusion in the CUDA lowering, checked exactly on the GB10, measured against stage 2.
**Inferred user intent:** Find out whether the v6 framework can express and check a many-statements-to-one-kernel lowering, and how much fusion buys without changing bits.

### What I did
- `node tools/cuda-remote.mjs <ticket>/scripts/01-device-limits` (probe 01).
- `node <ticket>/scripts/02-stage2-source-digests.mjs > .../02-stage2-source-digests.json` on the base build.
- Checked the checker's extent unification: `fn f(x: f32[N], t: f32[M,K]): f32[N] { y[i] = x[i] + sum(k) t[i,k]; ... }` fails with `1:63 Inconsistent extent`; `t[i+0,k]` as the only witness fails with `Cannot infer extent`, so an IR address can be plain without its extents having been unified.
- Wrote `design-doc/01-checked-fusion-of-tix-statements-into-cuda-kernels.md`.

### Why
- A Tix pass cannot express where an intermediate lives; a kernel IR would have no consumer but the emitter. The plan is an analysis result recorded in the CUDA artifact.

### What worked
- Probe 01: `{"name":"NVIDIA GB10","cc":"12.1","sms":48,"maxThreadsPerSm":1536,"maxBlocksPerSm":24,"sharedPerBlockDefault":49152,"sharedPerBlockOptin":101376,"sharedPerSm":102400,"l2Bytes":25165824,"maxGridX":2147483647,"warp":32}`.
- Baseline build and the four non-GPU tensor test files: 22/22 pass.

### What didn't work
- No failures in this step.

### What I learned
- Staging must compare a tensor's leading extents with the block domain itself, because `plain()` in the IR does not imply that the checker unified the extents.
- 99 KiB per block caps a softmax row with its exp buffer at about 12K floats; larger rows need the scratch fallback.

### What was tricky to build
- N/A (design only).

### What warrants a second pair of eyes
- The legality rule's prefix argument (lowering k keeps earlier members legal) and the claim that a block's global writes are visible after `__syncthreads()`.

### What should be done in the future
- Choose the block-mode thread cap by measurement (step to come).

### Code review instructions
- Read the design doc; replay probe 01 and script 02 from the worktree root.

### Technical details
- Stage-2 digests: `scripts/02-stage2-source-digests.json` (15 sources).

## Step 2: Legality analysis, group emitter, API and contract

I implemented the design: `planFusion` in `src/tensor/fusion.ts`, a shared scalar writer and a group emitter in `cuda-source.ts`, the `fuse`/`benchmark` options in `index.ts`, and in `cuda-contract.ts` a boolean `fuse` port, a CUDA artifact that records its kernels, and a required `statements-to-kernels` correspondence. Every corpus program became one kernel, and the first GB10 check accepted all of them exactly.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Implement the committed design.
**Inferred user intent:** A working fused lowering before measuring.
**Commit (code):** ffa4bc5 — "IRWB-029-D: fusion plan (legality analysis on the Tix IR), group emitter ..."

### What I did
- `kernelWriter(dimensions, load)` holds stage 2's tree walk; `emitKernel` (stage 2) and `emitGroup` (stage 3) both use it. A plan of singletons goes through `emitKernel`, so `emitCuda(fn)` without a plan is stage 2.
- `emitGroup`: thread mode (registers) and block mode (`extern __shared__` rows, staging loop, one element loop per member, `__syncthreads()` between members, thread 0 for rank-k members). Host: grid, row bytes, `shared_limit` from `cudaDevAttrMaxSharedMemoryPerBlockOptin`, scratch `DeviceBuffer` (size 0 when the row fits), threads per block.
- `node <ticket>/scripts/02-stage2-source-digests.mjs --fuse-false | diff - .../02-stage2-source-digests.json`: identical.
- `node <ticket>/scripts/03-check-corpus.mjs fused` (12 checks).

### Why
- The shared writer keeps "every element computed by stage 2's code" true by construction rather than by a second copy of the walk.

### What worked
- Plans: matmul and conv2d one thread-mode singleton; softmax `k0 block depth 1 m,e,s,y stored y buffered m,e,s staged x`; layernorm, attention (6 statements) and mlp (h, g, y) one block-mode kernel each. No refusals on the corpus.
- All 12 checks `accepted: true, relation: 'exact'`, 2.4 to 4.6 s each (the repeated conv2d revision replays in 2 ms).
- First full-size benchmark (script 04, block cap 256): fused and unfused outputs bit-identical for all six; softmax 0.666 vs 0.808 ms, layernorm 0.268 vs 0.539, attention 0.971 vs 1.049, mlp 0.842 vs 0.949.

### What didn't work
- `node -e ...import('./dist/tensor/index.js')` failed at load: `Error: Missing invariant binding fuse` from `defineTransformation`. The invariant's ports were `{ ...inputs, ...outputs }`, which now included `fuse`; an invariant must bind every port it declares. Fixed by declaring the invariant on `{ baseline, fn, subject }` only.

### What I learned
- Fusing alone gave softmax only 1.2×. The time had to be somewhere other than global memory traffic.

### What was tricky to build
- Index names: stage 2 names binders `i${indices.size}`. Aliasing a member's block axes to the first member's names adds map entries without names, so later names skip numbers but stay unique (the size only grows).

### What warrants a second pair of eyes
- `emitGroup`'s loader throws if a member is read outside its own row; the planner should make that unreachable.

### What should be done in the future
- Find where fused softmax spends its time (step 3).

### Code review instructions
- `src/tensor/fusion.ts` `planFusion`, `src/tensor/cuda-source.ts` `emitGroup`/`emitCuda`, `src/tensor/cuda-contract.ts` `kernelCorrespondence`.

### Technical details
- The emitted fused softmax kernel is reproduced by `cudaSource(compileTix(corpus softmax), 'softmax')`.

## Step 3: Where fused softmax spent its time

Fused softmax was 0.52 ms at 128 threads per block against 0.79 unfused. Variants of the program (script 05) and textual variants of one kernel (script 06) located two costs: the double `exp` and the serial max fold. A probe (07) showed PTX `max.NaN.f32` equals the emitter's `minmax(a, b, true)` on every pair of 18 special and ordinary words; using it for the fold halved the row-max kernel.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Make the fused kernels fast without changing bits.
**Inferred user intent:** Fusion that pays.
**Commit (code):** b31f270 (with step 4).

### What I did
- `node <ticket>/scripts/05-softmax-variants.mjs --threads=128` (N = 4096, C = 1024).
- `node <ticket>/scripts/06-serial-chain-probe.mjs` on `m[i] = max(j) x[i,j]; y[i,j] = x[i,j] - m[i]`.
- `node tools/cuda-remote.mjs <ticket>/scripts/07-max-nan-probe`.
- Added `max_nan` (inline PTX) to fused kernels only, for max folds (`kernelWriter`'s `maxFold`); made block-mode kernels `template <bool Shared>` so shared rows are addressed as shared memory; the host launches `k<true>` or `k<false>`.

### Why
- The block mapping keeps a row (8 KiB for softmax) in shared memory, so at most 12 blocks, hence 12 serial folds, run per SM. Stage 2's row kernel had 4,096 threads, about 85 per SM, all folding at once. Each fold step's latency is therefore on the critical path in the fused kernel and not in stage 2.

### What worked
- Script 05 (ms, fused / unfused): original 0.519 / 0.792; no-exp 0.409 / 0.511; sum-for-max 0.389 / 0.756; max-only 0.333 / 0.361; exp-only (`y = exp(x)`, one kernel either way) 0.368 / 0.369.
- Script 06 (max-only, 128 threads): base 0.323; shared addressing 0.255; `#pragma unroll 8` 0.301; both 0.243; max.NaN 0.146; shared + max.NaN 0.134 ms. Same output digest `70daa58b7358b8ee` in every variant.
- Probe 07: `{"pairs":324,"mismatches":0}`.
- After both changes, fused softmax 0.387 ms (128 threads).

### What didn't work
- No failures; the unroll pragma's 7% was not worth a change.

### What I learned
- 4M double `exp` calls take 0.37 ms on the GB10 (exp-only kernel; the 32 MB it moves take 0.13 ms at 244 GB/s). That bounds softmax from below in this lowering.
- The scratch fallback through a generic pointer cost 25% on a serial fold; the template removes it without a second code path.
- 0.134 ms for the row-max kernel is the streaming bound for its 32 MB.

### What was tricky to build
- `max.NaN.f32` is not exposed as a CUDA float intrinsic; it needs inline PTX, and `fuse: false` must not see it, so it lives in a support snippet emitted only when a plan has a multi-statement group.

### What warrants a second pair of eyes
- The exactness of `max.NaN.f32` rests on probe 07's classes (zeros of both signs, ±1, ±∞, quiet and signalling NaNs of both signs, subnormals, ±FLT_MAX, 1 + ulp, π) and on the GPU contract's exact checks; it is not exhaustive over 2^64 pairs. Its PTX definition (larger operand; canonical NaN if either is NaN; −0 below +0) is what the probe observed.

### What should be done in the future
- An exact cheaper f32 `exp` would lower softmax and attention further (Later).

### Code review instructions
- `cuda-source.ts` `fusedSupport`, `kernelWriter(..., maxFold)`, block-mode `template <bool Shared>`.

### Technical details
- The max fold is the only primitive that differs between fused and unfused kernels.

## Step 4: Threads per block in block mode

I measured the block-mode thread cap at 64, 128 and 256 on the four block-mode programs, twice for 64 and 128. Rows-only kernels (softmax, layernorm) were best at 128; kernels whose reductions read a tensor from global memory (attention's `k` and `v`, mlp's `w` and `v`) at 64. The emitter now picks 64 when a member's reduction reads a tensor that is neither a member nor a staged row, else 128.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Justify the block size by measurement.
**Inferred user intent:** No round-number thresholds.
**Commit (code):** b31f270 — "IRWB-029-D: block-mode kernels templated on shared or scratch rows, max folds with max.NaN.f32 ..."

### What I did
- `for t in 64 128 256; do node <ticket>/scripts/04-benchmark.mjs gpu --threads=$t --only=fused softmax layernorm attention mlp; done`, then 64 and 128 again.

### What worked
- Fused ms (cap 64 / 128 / 256), first round: softmax 0.494 / 0.387 / 0.384; layernorm 0.213 / 0.197 / 0.207; attention 0.750 / 0.796 / 0.880; mlp 0.727 / 0.881 / 1.001. Second round (64 / 128): softmax 0.432 / 0.390; layernorm 0.210 / 0.202; attention 0.820 / 0.900; mlp 0.728 / 0.857.
- With the rule: softmax 0.387, layernorm 0.198, attention 0.750, mlp 0.727 (two later runs: 0.727, 0.726), all bit-identical to unfused.

### What didn't work
- One mlp run gave fused 1.269 ms; reruns gave 0.727 and 0.726. Untimed jobs of other agents do not take the runner's GPU lock, so a timed run can overlap them. I repeat timings and report medians in the report.

### What I learned
- Occupancy does not explain the split: attention and mlp lose with more threads although shared memory leaves room for them. Their reductions stream `k`, `w` and `v` from L2 in every block; my unverified explanation is L1 contention. Softmax's exp phase needs the warps.
- mlp as one block-mode kernel (0.812 ms) beat the epilogue-only plan (h and g in one thread-mode kernel, y in another: 0.858 ms; script 08, cap 128), with equal outputs; so the planner keeps fusing the contraction consumer.

### What was tricky to build
- Scripts 04 to 08 now override the cap by regex on `std::min<U>(N, (longest_`, so they keep working whatever the constants are.

### What warrants a second pair of eyes
- Two caps tuned on four programs; a random program gets whichever its reads select.

### What should be done in the future
- Measure on more shapes before trusting the rule beyond the corpus.

### Code review instructions
- `cuda-source.ts` `blockThreads` and the `operands` test in `emitGroup`.

### Technical details
- Thread mode keeps stage 2's 256 threads per block.
