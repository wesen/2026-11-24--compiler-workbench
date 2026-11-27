---
Title: Implementation diary
Ticket: IRWB-030-E
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
Summary: Chronological record of stage 3b (term staging, the fusion gate, measurements).
LastUpdated: 2026-11-27T01:29:01.936455959-05:00
WhatFor: What was done, in order, with commands, failures and measurements
WhenToUse: Reviewing or continuing IRWB-030-E
---

# Implementation diary

## Step 1: Read stage 3, measure the base, write the design

I read stage 3's design and report (IRWB-029-D), stage 2's lowering code, `src/tensor/` and the differential check in `src/framework/contracts/differential.ts`. I wrote a benchmark harness (script 01) and timed the base before designing anything.

### Prompt Context
**User prompt (verbatim, opening excerpt):** "You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). ... Your ticket is IRWB-030-E. This is an **implementation stage**, in one session. Write a short design first and commit it. Then implement, test, measure, and write a final report in the ticket." The full brief (stage 3b: fusion that is never slower; parallel terms with a serial fold; a decision that keeps a group unfused where fusing is slower; fixed API) is `IRWB-030-E.md` in the coordinator's prompts.
**Assistant interpretation:** Make the fused lowering at least as fast as stage 2's everywhere, keep it bit-identical, and justify the fusing rule by measurement.
**Inferred user intent:** See whether an exact, checked fusion can also be made robustly profitable, and what the framework needs for a lowering with a launch-time choice.

### What I did
- `npm run build`; `docmgr ticket create-ticket --ticket IRWB-030-E ...`; three `docmgr doc add`.
- `node <ticket>/scripts/01-benchmark.mjs --calls=1` on the base (output `scripts/01-baseline-1call.out.jsonl`).
- A shape sweep of softmax and a row sum on the base, N·C = 4M (output `scripts/02-baseline-shape-sweep.out.jsonl`).
- Wrote and committed the design (`1992a03`).

### What worked
- The brief's table reproduced: layernorm inside 0.584 fused against 0.541 unfused, attention inside 1.412 against 1.491.
- A plainer case of the same problem: softmax with `exp` inside the sum (no `e` statement) takes **12.4 ms fused against 1.64 ms unfused**. Thread 0 computes 1,024 `exp` per row alone.

### What I learned
- **Few, long rows are not a loss.** At N = 4, C = 2^20 fused softmax takes 68.7 ms against 106.3 ms unfused: both are bound by one thread's serial sum per row, and the fused kernel reads the row from scratch memory it wrote itself. The design had expected a loss there.
- **Many short rows are.** At N = 2^20, C = 4 fused softmax takes 4.15 ms against 0.62 ms, and the row sum 1.05 against 0.20. At C = 64 fused wins again (0.37 against 0.68).
- **Tiny problems are faster fused** (3 x 7: 3.3 us against 9.3 us), because one launch replaces four.

### What was tricky
- A 120 s foreground limit and the shared `--timed` lock: a benchmark of a dozen programs does not finish in one foreground command. Benchmarks run in the background from here on.

## Step 2: Term staging

`planFusion` now decides, per block-mode group, which reductions have their terms staged, and the group emitter prints a term pass, a barrier and a fold over the term buffer.

### What I did
- `fusion.ts`: `outerReductions`, `FusionGroup.terms`, `FusionPlan.termRefusals`.
- `cuda-source.ts`: `kernelWriter` takes a `stagedTerms` hook; `emitGroup` declares term counts, a `terms` pointer after the row buffers, and per member the term passes. The host adds the term area to the row size and the term counts to the longest length.
- Script 03 compares the plan's staging with none (and a subset) on one program.

### What didn't work
- First build of a kernel with two staged members: `error: calling a constexpr __host__ function("max") from a __global__ function("k0") is not allowed`. I had printed the term area's length with `std::max<U>` in device code. It is a nested conditional now. (The same expression on the host may use either; it uses the same text.)

### What worked
- softmax with `exp` inside the sum: **0.750 ms staged, 12.4 to 14.3 ms serial** (unfused 1.64), same output digest.
- layernorm inside: **0.224 to 0.242 ms staged, 0.571 to 0.583 serial** (unfused 0.541).

### What I learned
- Staging is not free: with a body of one multiplication it is slower than the serial loop (layernorm as in the corpus 0.206 to 0.214 staged against 0.191 to 0.203; `rownorm` 0.151 to 0.157 against 0.123 to 0.142). The term buffer adds 4 KiB to each block's shared memory, so fewer blocks are resident per SM. The rule therefore needs a cost class; script 03 with graded bodies decides it (step 4).

### Code review instructions
- `src/tensor/fusion.ts`, the block starting "Term staging"; `src/tensor/cuda-source.ts`, `stagedTerms` in `kernelWriter` and "Term pass" in `emitGroup`.

## Step 3: The gate, as one templated kernel, and the check on both sides

### What I did
- `emitGroup`: a block-mode kernel is `template <int Mode>`. Modes 0 and 1 are stage 3's `Shared` false and true. Mode 2 + s is member s in stage 2's mapping, printed by the same `elementOfThread` that prints stage 2's kernels (factored out of `emitKernel`; the stage-2 digests still match).
- Host: `fused_k = gate_mode ? gate_mode == 1 : <rule>`; non-stored members get a buffer only when the gate says unfused; the per-statement instantiations are launched in order.
- A source with a gated kernel gets a `main` that parses `--benchmark`, `--gate=fused` and `--gate=unfused`. Stage 2's `main` ignores unknown arguments and tests `argc == 2`, so `--gate` is only passed to sources that take it (`takesGate(source)`).
- `cuda-contract.ts`: every sample is a case on each side (`gate` in the case description); `decide` runs one batch per side for a source with a gate, one batch otherwise.
- `runCudaBatch` gains `gate`.
- Script 04 runs `checkLowering` on the benchmark programs. First run: softmax-inside, layernorm-inside and `div1`, as written and after inline + split-sum, fused and unfused, all accepted as exact.

### Why
- Whether a group is gated is read from the source, not from the artifact's kernel list. The list is declared by the caller (the known correspondence gap), and a mutant test that passes a hand-written list must still be run on the side it mutates.

### What I learned
- The differential check needed no change for a subject with a launch-time choice: cases are opaque to it, so "sample x side" is just a longer case list, and `decide` may batch them as it likes. The evidence then counts each side as a case.
