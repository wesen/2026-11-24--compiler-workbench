---
Title: Stage 2 diary
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
LastUpdated: 2026-11-26T15:11:52.286362565-05:00
WhatFor: ""
WhenToUse: ""
---

# Stage 2 diary

## Step 1: Test the simplest intrinsic mapping before choosing a contract

At baseline `1880fc4` I compared CUDA library functions with Node's rounded JS results. A one-word mismatch is enough to rule out exact agreement for this mapping. The probe found thousands, small relative to the existing stage-1 output budget. This was a numerical probe only, not a corpus benchmark or a lowering implementation.

### Prompt context

[User request, verbatim](../sources/request.md). I understand the review boundary to mean: settle the relation using actual hardware, specify the pass and its evidence lifetime, then stop before changing production code.

### What I did and why

Read the IRWB-020-B design/report and traced `meaningGate`, the executable tree, the pass runners, transformation contracts and the remote tool. Kept kernel generation separate from acceptance: the runtime and the checker must execute the same translation unit. Created this workspace with docmgr.

### What worked / what didn't

`node tools/cuda-remote.mjs /tmp/irwb022h-probe` completed untimed: host manuel@bling, tool hash `9dca9e0adac802c8`, compiled=true, exit 0, NVIDIA GB10 sm_121 nvcc 13.0.88. No transport or compile failure. Exact `expf`, `logf` and `tanhf` agreement failed; see the design table for counts. `sqrtf` alone had no observed mismatches. The largest observed budget fraction over all four operations was 0.00656921 (rounded up). This does not establish agreement for every input to a compiled function.

### What I learned / what was tricky

A cached binary saves compilation, not GPU execution. Caching a verdict by Tix revision would also miss changes to the emitted text. The design therefore reuses the candidate's observed words separately from checking the current numerical obligation. The original, not the already-blocked reduction, owns the tolerance budget.

### Review and next steps

Review the design's heterogeneous contract ports, finite-reference case domain and proposed tool isolation/profile changes. Reproduce the experiment from the worktree root without writing outputs to the ticket:

```sh
ticket=$(echo ttmp/2026/11/26/IRWB-022-H*)
dir=$(mktemp -d)
cp "$ticket/scripts/01-probe/main.cu" "$dir/"
node tools/cuda-remote.mjs "$dir"
node "$ticket/scripts/02-compare.mjs" "$dir/out/words"
sha256sum "$dir/out/words"
```

Observed digest: `1039ed88a0b69224c051b20233ad5996a4e8d3580264a0496248bf222adac745`. No full suite or timed GPU runs in this step. After review, start with source emission and tests on the existing IR, not an alternative kernel representation.

## Step 2: Review correction

Accepted both required changes. Reading `runDifferentialAsync` confirmed `todo` already removes replayed indices before delegation; the proposed packet analysis duplicated that work. Preload all kernels before events using `cudaFuncGetAttributes`. Dropped tool changes, profile queries and concurrent request handling. Baseline `npm run build` succeeded.

## Step 3: Emit and run the actual translation unit

Added ordinal CUDA generation and a shared versioned packet runner. `npm run build` initially reported TS2345 (Buffer<ArrayBufferLike> vs Buffer<ArrayBuffer>); explicitly typing the packet list fixed it. Built successfully and launched the full-size CPU and timed GPU benchmark script. GB10 compiled the emitted MLP, convolution, matmul and attention programs and returned event samples and endpoint values. No tool change.

## Step 4: Check emitted bytes, not an interpreter of the candidate

`cuda-contract.ts` uses a heterogeneous transformation with the async differential postcondition. Replayed verdicts use the emitted revision and the origin/function, not timing records. A wrong block count on the GB10 failed at an output coordinate although the unmodified candidate had already passed. All six corpus gates passed unchanged. GPU tests also exercised empty and signed-zero behavior; small local tests checked packet validation and preloading. The first full run passed 20/20; after adding coverage a combined build/test command hit the host-side 180 s command timeout after nine successful tests, so I reran the requested test command separately. No framework or tool sources changed.

## Step 5: Verify and measure

`npm run build` succeeded. `node --test tests/tensor/*.test.mjs` passed 23/23 (100.76 s), including the dedicated network tests. Did not run the full suite. `03-bench.mjs cpu` completed unchanged at all six full sizes; the MLP alone took 35.6 minutes on the shared host. The GPU endpoint sanity check used matching digests. `04-budget.mjs` recorded elementwise error maxima separately from cached pass verdicts. Results, commands and caveats are in the report. Code commits: `9d8b846` and `e04fade`; reviewed design `15ea177`.

## Step 6: Trace the independent evaluation at `0bf5f99`

The evaluation measured returned words; it did not trace intermediate values. I followed each corpus expression to the emitter, compared the scalar operation to the f32 evaluator (`src/tensor/evaluate.ts:15–18,80`), and checked the existing GB10 probe. This diagnoses the first possible *operation* responsible for each finite corpus discrepancy, not the first mismatching thread or index. I also extracted the matmul excerpt for the [publication report](02-report.md) with the built `cudaSource`. No implementation edits, new timings or GPU launches.

- **Softmax**, small, optimized small and full-size: `corpus/tensor/softmax/main.tix:3` → `src/tensor/cuda-source.ts:104`, `expf` rather than rounded double `Math.exp`. Both the numerator and the denominator can change. The reported exact counts were 54/76, 56/76 and 2616298/4194304 respectively.
- **Attention**, same three comparisons: `corpus/tensor/attention/main.tix:4` → `src/tensor/cuda-source.ts:104`, `expf` in the normalized weights; then propagation through the value contraction. Counts 56/72, 47/72 and 10618/65536. The score divisor uses `sqrtf` at `src/tensor/cuda-source.ts:106`, not a separate cause.
- **MLP**, same three comparisons: `corpus/tensor/mlp/main.tix:3` → `src/tensor/cuda-source.ts:107`, `tanhf` rather than rounded double `Math.tanh`. The second matrix product consumes that activation. Counts 21/24, 18/24 and 231045/262144.
- **Random set**, four of 20 differed: operation-level candidates are `src/tensor/cuda-source.ts:104,105,107` (`expf`, `logf`, `tanhf`). In particular the probe isolated `logf(1.044921875)` = 0.04394211992621422 against rounded JS 0.04394212365150452. The earlier probe also isolated `tanhf(-4.9248046875)` = -0.9998944997787476 against -0.9998944401741028. The supplied aggregate gives no program texts, inputs or trace distinguishing those four; assigning a specific call to each hidden program would be guessing. The local probe demonstrates mechanisms, not hidden program identity.
- **Nonzero small-case f64 residuals**, including matmul/conv/layernorm whose f32 words matched: f32 rounding is intentional (`src/tensor/cuda-source.ts:79–85,99–107,127`, versus the f64 interpreter's unrounded scalar and fold at `src/tensor/evaluate.ts:80,85`). The optimized f32 oracle already incorporates the new reduction grouping: split-sum is not a first divergence between backend and current f32. Output-level f64 maxima alone cannot identify an individual summand. All reported counts and error metrics are tabulated in the report.

**Relation.** Of the two specified uniform relations, the implemented lowering supports sampled tolerance, not bit identity: the float transcendental calls give concrete counterexamples. The budget is neither a proven global bound nor established to be the tightest tolerance. The coordinator's exhaustive test justifies a different intrinsic implementation to target exact current-f32 agreement (NaNs compared as a class); it does not make these emitted calls exact. The origin-f64 check would still serve a distinct purpose after an authorized reassociation.
