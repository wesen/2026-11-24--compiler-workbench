---
Title: 'Report: fusion that is never slower'
Ticket: IRWB-030-J
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: Term-staging decisions, the decline rule and their recorded reasons
    - Path: repo://src/tensor/cuda-source.ts
      Note: The term phase, the ordered fold and the terms row buffer in the group emitter
    - Path: repo://src/tensor/index.ts
      Note: runTixCuda passes the launch's shape values to the planner
    - Path: repo://tests/tensor/parallel-terms.test.mjs
      Note: The staging and decline decisions, without the GPU
    - Path: repo://tests/tensor/parallel-terms-gpu.test.mjs
      Note: GB10 tests: inside variants, declined groups, scratch terms, a reversed-fold mutant
    - Path: repo://ttmp/2026/11/27/IRWB-030-J--fusion-that-is-never-slower-parallel-reduction-terms-and-a-fuse-or-not-decision/scripts/03-decline-sweep.mjs
      Note: The measurements that fixed the decline rule's threshold and loss class
ExternalSources: []
Summary: Parallel reduction terms staged by the block and folded in order by thread 0 (inside layernorm 0.569 to 0.220 ms); a decline rule from a measured sweep (contraction chains below 65536 threads keep stage 2); 80/80 random lowerings exact; no framework change, one finding about launch shapes.
LastUpdated: 2026-11-27T04:30:00-05:00
WhatFor: Final report of stage 3b (IRWB-030-J)
WhenToUse: Reviewing what staging and the decline rule do, what was measured, and what the framework could not express
---

# Report: fusion that is never slower

Stage 3's block mode computed a row-scalar member's reduction entirely on thread 0 of the row's block, with the reduction's body inside the fold loop: on the inside placement of layernorm (`mu[i] = sum(d) x[i,d] / D`) every division was a link in one thread's serial chain, and fused ran 0.569 ms against stage 2's 0.577. This stage moves the body out of the chain: **any thread of the block now computes a term** — terms never depend on the accumulator, Tix has no syntax for it — each into a terms buffer, and **thread 0 folds them in the meaning's order**, rounded per step, so the result keeps every bit. Inside layernorm now runs 0.220 ms fused (stage 2: 0.555), matching the corpus's outside placement (0.209). The second deliverable, **a decline rule that keeps a group unfused when fusing would be slower**, came out differently from the design's expectation: a measured sweep showed rows-only groups are never the loss case — stage 2's one-thread-per-row folds are themselves latency-bound at few rows — and the loss case is the per-element fold chains of contractions that stream global operands. The rule declines exactly that class, below a measured 65,536 points × threads. Everything stays bit-identical: fused and unfused outputs were equal in every measurement round, the contract accepts every corpus program and variant as `exact`, and 80 of 80 random lowerings (two seeds, before and after inline + split-sum) were accepted with staged reductions inside the checked source. No framework source changed; the stage's framework finding is below.

The code is at the last commit of branch `t3b-g-max/irwb-030-j`. All measurements were taken at `a4c1ad9` (the emitted kernels are unchanged since).

## Results

Kernel count is `__global__` definitions in `cudaSource`. GPU time is `runTixCuda(..., { benchmark: true })`: one warm-up launch and the median of three CUDA-event intervals, under the runner's `--timed` lock; the table gives the **median of three such calls** per program (script 02, output in `scripts/02-benchmark.out.jsonl`), at the brief's sizes, on the GB10, seed 20, values in [−0.1, 0.1], layernorm eps = 1e-5. Fused and unfused outputs had the same SHA-256 in every round.

| Program | Staged reductions (fused kernel) | Kernels fused / unfused | GPU ms fused (3 calls) | GPU ms unfused | Fused / unfused |
| --- | --- | ---: | --- | --- | ---: |
| matmul | — (thread mode) | 1 / 1 | 0.215 (0.212, 0.215, 0.217) | 0.214 | 1.00 |
| softmax | none: `m`, `s` refused (bare loads) | 1 / 4 | **0.385** (0.385, 0.385, 0.386) | 0.814 | 0.47 |
| layernorm | `variance` (its body rounds a multiply per term) | 1 / 4 | **0.209** (0.201, 0.209, 0.219) | 0.481 | 0.44 |
| attention | none: `score`, `out` trailing; `shift`, `z` bare loads | 1 / 6 | **0.753** (0.751, 0.753, 0.754) | 1.048 | 0.72 |
| mlp | none: `h`, `y` trailing | 1 / 3 | **0.725** (0.725, 0.725, 0.725) | 0.960 | 0.76 |
| conv2d | — (thread mode) | 1 / 1 | 0.166 (0.165, 0.166, 0.166) | 0.166 | 1.00 |
| layernorm-inside | **`mean`, `variance`** (divisions per term) | 1 / 4 | **0.220** (0.218, 0.220, 0.225) | 0.555 | 0.40 |
| attention-inside | none (all four reductions refused; see below) | 1 / 5 | **1.413** (1.412, 1.413, 1.413) | 1.515 | 0.93 |

Against the merged stage 3, fused times are unchanged except where staging applies: layernorm-inside went 0.569 → 0.220 ms (2.6×) and the corpus layernorm gained `variance`'s staging at a measured neutral cost. Attention-inside is unchanged and keeps its 6.7% edge over stage 2; its remaining time is the per-element fold chains of `score` and `o`, whose bodies divide per term — removing that needs reassociation or tiling, both outside this stage (Later).

## Where the decisions live

Both decisions are **made by the plan** (`planFusion(fn, shapes?)`, pure, `src/tensor/fusion.ts`) and **applied by the emitter**; every answer, yes or no, is recorded in the plan with its reason, and the tests read the reasons. Staging legality is unchanged IRWB-029-D rule work: groups are still decided from the Tix IR alone before any code exists.

- **`terms`**: which reductions get parallel terms; **`termRefusals`**: every reduction considered and refused, with why.
- **`declined`**: which groups the launch's shape values left unfused, with why. `runTixCuda` passes the concrete shapes (`caseShapeValues`, extracted from the batch encoder); `cudaSource` and the checked transformation see no shape values and emit the default plan — every legal group fused — which is what the kernel counts above measure and what the contract checks. At the corpus sizes nothing is declined, so the source that runs is the source that is checked.

## Parallel terms, and what was refused

**The rule** (from the IR, per reduction): stage when the enclosing member has rank == depth (stage 3 computes it on thread 0), no other reduction encloses this one, every axis extent is `kind: 'dim'` (a rectangular term space), and the body contains an op, a call, or a nested reduction — it rounds a value per term. **Refused, with the reason recorded in `termRefusals`** and the fold kept exactly as stage 3 emitted it:

1. **A bare-load body** (softmax's `m` and `s`, layernorm's `mean`, attention's `shift` and `z`): the fold's dependent adds are the only serial work; staging would add a terms buffer and two barriers without removing any. Measured: forcing `m` and `s` staged on softmax changed nothing (0.399 vs 0.393, then 0.387 vs 0.387 — softmax is exp-bound), so the refusal costs nothing and keeps the simpler kernel.
2. **A reduction nested in another** (`max(j) (x*2 + sum(k) v[k]*3)`): it is computed per term, inside the enclosing term's phase, by that term's thread. This refusal was added after the random probe caught the first version staging nested reductions and emitting out-of-scope accumulators (diary step 5).
3. **Split-sum's generated bounds** (`blocks`/`tail` extents): the term space is not rectangular; the serial fold keeps the split's rounding structure. Programs after `split-sum` keep stage 3's folds.
4. **A member with trailing axes** (mlp's `h` and `y`, attention's `score` and `out`, attention-inside's `o`): its elements are already spread over the block's threads; staging would fold one element at a time behind a barrier per element. This is why attention-inside sees no staging — and per-element cooperation would serialize 64 folds that currently run on 64 threads at once.
5. **Thread mode**: one thread per point already parallelizes the reductions across the grid; nothing is lost, so nothing is staged.

**Emitted structure** (softmax-class member, one staged reduction):

```cpp
float acc = 0.0f;                                 // member scope; later folds' combines see earlier ones
for (U t = threadIdx.x; t < nterm0; t += blockDim.x) {   // any thread, any order
  <decode the reduction's indices from t, last axis fastest>
  rterm[t] = <the body, stage 2's scalar code>;          // each term rounds exactly as before
}
__syncthreads();
if (threadIdx.x == 0) {
  for (U t = 0; t < nterm0; ++t) acc = __fadd_rn(acc, rterm[t]);   // the meaning's order, rounded per step
  <the rest of the member's expression, staged reductions replaced by their accumulators>
  <buffer and store>
}
```

`nterm` is the product of the extents with each factor clamped at 0, so an empty extent gives an empty phase and an untouched accumulator, exactly as the meaning's empty loop does. The terms buffer is one row buffer per group, sized to the largest staged reduction, laid out after the staged and buffered rows and covered by the existing `Shared`/scratch template (rows of D = 30,000 with terms run through global scratch in the GPU tests). Several staged reductions in one member alternate phases and folds with a barrier between a fold and the next phase, since the buffer is reused.

**Why the bits do not change.** A term is stage 2's scalar code for the same body at the same indices, run by some thread instead of thread 0; the shared/scratch copy moves f32 words unchanged. Thread 0 folds the terms in increasing linear index — the meaning's lexicographic order, first binder outermost — from +0 (or −∞), rounding after each step: the same instructions on the same values in the same order as stage 3's serial fold. The mutant test shows the check notices the order: reversing the fold (`rterm[nterm0 - 1 - t]`) is rejected with a coordinate, on the half-ulp stream whose forward sum is 2 and reversed sum is 2.0000002.

## The fuse-or-not rule, and the measurements behind it

The design expected block mode to lose whenever `points × threads` cannot fill the machine. The sweep (script 03, one batched remote job per family and fuse setting, each rung timed separately) says the loss class is narrower:

| Family (block group) | points × threads | fused ms | unfused ms | fused/unfused |
| --- | ---: | ---: | ---: | ---: |
| softmax (rows only, T=128) | 128 | 2.598 | 3.870 | 0.67 |
| | 2,048 | 2.571 | 4.747 | 0.54 |
| | 32,768 | 1.502 | 4.070 | 0.37 |
| | 524,288 | 0.387 | 0.802 | 0.48 |
| layernorm-inside (staged divisions, T=128) | 128 | 2.083 | 6.973 | 0.30 |
| | 2,048 | 2.084 | 8.802 | 0.24 |
| | 524,288 | 0.236 | 0.565 | 0.42 |
| mlp (contractions streaming w, v; T=64) | 256 | 1.594 | 0.346 | **4.61** |
| | 4,096 | 2.951 | 0.794 | **3.72** |
| | 16,384 | 2.270 | 0.984 | **2.31** |
| | 32,768 | 1.323 | 0.963 | **1.37** |
| | 65,536 | 0.727 | 0.950 | **0.77** |

(The full ladder, 1 to 4,096 points, is in `scripts/03-decline-sweep.out.jsonl`; a second run of the 16-point-and-up ladder agreed, and the 32,768 rung lost 1.24× there too.)

Rows-only groups were faster fused at **every** rung, down to 1 point × 128 threads: stage 2's row kernels give each row one thread whose serial loads are latency-bound, while the fused kernel stages the row with the whole block. The loss is specific to what the sweep's third family has and the others lack: **a member with trailing axes whose reduction streams a global operand** (mlp's `h` and `y`). Unfused, such a statement runs one thread per element, so its per-element fold chains fill the machine; fused block mode runs `points × T` threads and serializes the chains when that starves the machine.

**The rule**: a block-mode group is declined — its statements keep stage 2's one-kernel-each lowering — when, at the launch's shape values, (1) a member with trailing axes has a reduction reading a tensor from global memory (the same predicate that picks the 64-thread cap), (2) the longest row exceeds the cap, and (3) `points × threads < 65536`. The threshold is the **least points × threads at which the measured contraction family was faster fused** (0.77 and 0.73 of stage 2's time in two runs); one rung below it lost by 1.37× and 1.24×. It is not a round number chosen in advance — it is the measured boundary's conservative end, and it sits exactly on the corpus's two contraction programs (mlp and attention at 1024 × 64), which stay fused and measured faster. Thread-mode groups are never declined (same threads, strictly less traffic, fewer launches); rows-only groups are never declined (measured fused-favored at every rung); a declined group's statements run stage 2's own `emitKernel` bytes, and the planner recomputes `stored` over the final group list, so a fused group followed by a declined one stores what the declined kernels read — asserted byte-for-byte in the local tests: a fully declined plan prints exactly `cudaSource(..., { fuse: false })`.

**Which fusions were refused** — the decline records its reason per group; the local and GPU tests cover a fully declined mlp (byte-equal to stage 2), a declined contraction after a fused rows-only group, and softmax at 1–4,096 points (never declined, fused at every measured size).

## Framework and tool changes

**None.** `git diff <base> -- src/framework tools` is empty. The tensor domain changed in five places: `fusion.ts` (the two decisions and their reasons, the thread cap moved here so the decision and the launch share one formula), `cuda-source.ts` (the phase, the fold, the terms buffer), `index.ts` and `cuda-runtime.ts` (`caseShapeValues`: the launch's shape values, shared with the batch encoder), and the CUDA artifact at version 3 with `tensor.lower-cuda` version 3 (each kernel record gains `parallel`, the staged reductions it computes, and the correspondence's evidence carries the same list).

**Finding: the profitability decision needs the launch's shape values, and the checked transformation has no port that carries them.** The transformation's inputs are the baseline, the function name and `fuse`; shape values live only in the differential's case payloads, which the checker — not the transformation — sees. The decision therefore lives in `runTixCuda`'s lowering, and the transformation checks the shape-independent default plan. A mixed plan (some groups fused, some declined) is exact by composition — each kernel is either a legality-checked fused kernel or stage 2's own, and only `stored` sets differ, which never changes values — and the GPU tests run declined and mixed plans against the interpreter; but the checker never judges a mixed source as its own subject. A later `launchShapes` scalar port (`JsonValue`, version 4 of the transformation) would let it. That is the whole gap: legality never needed the shapes, only profitability does.

Stage 3's correspondence finding stands unchanged (entity lists are declared by the caller, not compared with the artifacts' entities; another ticket fixes it in `src/framework/ir/`).

## What the contract checks and what it costs

`checkLowering(program, fn, { fuse })` runs the same transformation as stage 3 (version 3), over the same case recipe (`cudaCases`: shape assignments 1/3/4/7/mixed-distinct/zeros/one-zero with four streams each), under the same exact relation — bit for bit against the current revision's f32 meaning, NaN as a class. The staged phases and folds are inside the checked source, so the recipe exercises them at small extents and empty extents, and the `half-ulp` stream pins the fold order. Beyond the contract, the GPU tests run the inside variants at full size against the interpreter, terms through the scratch path, declined and mixed plans at their shapes, and the reversed-fold mutant. Random programs (script 06, the stage-3 generator extended with division-inside-reduction and nested-reduction forms): **80/80 lowerings accepted exact** over two seeds, 52 staged reductions in the checked sources, 307 statements over 203 kernels.

Cost per program (script 05, `scripts/05-contract-cost.out.jsonl`): cases and elements are identical to stage 3 — the recipe is unchanged — at 28 to 40 cases; a cold `checkLowering` is 2.6 to 4.1 s (ssh, nvcc and process start dominate; the cases build locally in 1 to 254 ms); a repeated check replays in 1 ms.

## Measured, and only argued

**Measured on the GB10:** every number in the three tables above (medians of three benchmark calls; fused and unfused outputs bit-identical in every round); the staging A/Bs (inside layernorm staged 0.217–0.226 against unstaged 0.585–0.593; softmax's forced bare-load staging neutral; the corpus layernorm's multiply body neutral at 0.192–0.201 either way); the thread cap re-measured on staged inside layernorm (64 clearly worse; 128 and 256 disagreed between rounds, so stage 3's 128 stays); the contract costs; the mutants and the 80 random lowerings.

**Argued, not measured:** that staging keeps the bits for every program in the domain (the construction: same scalar code, same indices, same fold order and rounding; the measurements are samples, and the contract samples small shapes); that a mixed plan is exact by composition (each kernel is either checked-legal fused or stage 2's; tested directly at several shapes, not proven in general); that thread-mode fusion is never slower (same threads per element, strictly fewer launches and round trips); the behavior of the decline rule between the sweep's rungs and below 1 point (unmeasured; below the threshold a declined group is stage 2 and cannot be slower than it).

## Later

- A `launchShapes` port so the checker judges mixed plans as their own subjects (the finding above).
- Attention-inside's remaining time: the per-element fold chains of `score` and `o` divide per term; only reassociation (out of scope by the brief), contraction tiling, or tensor cores change it.
- Staging with split-sum extents (rectangular decode of the blocks/tail nest), so optimized programs keep the parallel terms.
- Row-buffer reuse (dead buffers overlaid with the terms buffer) to raise occupancy.
- The exactly rounded `exp` (softmax's floor) and the stage-3 Later list, unchanged.
