---
Title: Implementation diary
Ticket: IRWB-030-G
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
LastUpdated: 2026-11-27T02:30:00-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Goal

Stage 3b of Tix: a fused lowering that is never slower than stage 2 — compute a reduction's terms in parallel and
fold them in the meaning's order, and keep a group unfused when fusing would be slower.

## Step 1: Read stages 1 to 3 and the framework, then measure where stage 3's fusion loses

I read IRWB-029-D's design and report, IRWB-022-I's design and report, the contracts and IR READMEs, the tensor
sources and tests, and `tools/cuda-remote.mjs`. Then I measured the merged stage 3 fused against unfused on the six
corpus programs, the brief's two "inside" variants, and a set of probes designed to find a loss: short rows, few
rows, long rows, an `exp` inside a reduction, and a long reduction with a costly term.

### Prompt Context
**User prompt (verbatim, opening):** "You are working in a git worktree of the IR Workbench repository (TypeScript,
Node 24). ... Your ticket is IRWB-030-G. This is an **implementation stage**, in one session. Write a short design
first and commit it. Then implement, test, measure, and write a final report in the ticket." The full brief (stage
3b: parallel terms, a cost gate, keep stage 3's guarantees; sizes; what is out of scope) is in the session that
created this ticket.
**Assistant interpretation:** Find the losses first, then design the fix and the gate around the measurements.
**Inferred user intent:** A fusion decision that is justified by measured time, not by an argument.

### What I did
- `node <ticket>/scripts/01-bench.mjs` / `02-cases.mjs`: a harness that times a program fused and unfused through
  the fixed API's `benchmark` mode and compares the two outputs word for word. Its case table is the brief's
  programs plus the probes.
- `node <ticket>/scripts/02-cases.mjs --set=main --runs=3` and `--set=probe --runs=2` on the merged stage 3
  (outputs: `scripts/02-baseline-main.jsonl`, `scripts/02-baseline-probe.jsonl`).

### Why
- The gate has to be justified by measurement, so the measurements had to come first.

### What worked
- The merged stage 3 reproduces the brief's numbers: layernorm-inside 0.578 / 0.542 ms (fusion does not pay),
  attention-inside 1.412 / 1.555, softmax 0.388 / 0.806.
- Three large losses found: `s[i] = sum(j) exp(x[i,j] - m[i])` 12.41 vs 1.62 ms (7.6× slower fused); softmax with
  4-element rows 1.469 vs 0.298 (4.9× slower); with 8-element rows 0.736 vs 0.282 (2.6× slower). A 16-element row is
  still 0.372 vs 0.330; a 32-element row is 0.188 vs 0.329 (fused 1.75× faster).
- Fusion wins everywhere else measured: few rows (N=8: 0.015 vs 0.105), long rows (N=1, C=65536: 2.51 vs 3.97), a
  200 KiB row set in global scratch (layernorm-inside N=256, D=16384: 2.42 vs 4.39).

### What didn't work
- No failures in this step.

### What I learned
- The two losses have different causes. The `exp` in a reduction is a *serial fold* problem, which parallel terms
  fix. The short row is a *lane utilization* problem, which nothing in the emitter fixes; it needs a decision.
- The crossover for short rows is between 16 and 32 elements, which is where the warp boundary sits.

### What was tricky to build
- N/A (measurement).

### What warrants a second pair of eyes
- Fusion losing at a 16-element row by only 13% is close to the noise floor (2% per call, 5% between sessions); the
  rule should not depend on that point alone. At 8 and 4 the loss is large and unambiguous.

### What should be done in the future
- N/A

### Code review instructions
- `scripts/01-bench.mjs`, `scripts/02-cases.mjs`, and their outputs.

### Technical details
- Sizes as the brief fixes them; inputs seed 20, f32 in [-0.1, 0.1], layernorm eps = 1e-5.

## Step 2: Parallel terms

A rank-depth member of a block-mode group is computed by thread 0, its reductions included, so every term of
`sum(j) x[i,j] / D` was one thread's work. The block now computes the terms into an array in the same row buffer that
holds the rows, and thread 0 folds that array in the meaning's order.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Implement the brief's first item exactly: terms in parallel, the fold in order.
**Inferred user intent:** Bit-identical by construction, not by tolerance.
**Commit (code):** 6d33272 — "IRWB-030-G: parallel terms (block-computed term arrays folded in order), the width
gate, and the plan/source tests".

### What I did
- `fusion.ts`: `planTerms(member, depth)` decides, from the IR alone, which of a member's reductions stage their
  terms; `FusionGroup.terms` records the staged ones and `FusionGroup.serial` the refused ones with the reason;
  `termArrays(group, members)` hands the emitter the nodes it must stage (node identity, not text).
- `cuda-source.ts`: `kernelWriter` gained an optional `staged(e)` hook; for a staged reduction the fold reads
  `aN[fN]` and advances a counter, and the body is not emitted in the fold. `emitGroup` emits, per member, one
  staging loop per staged reduction, a barrier, then the member's element loop; the term arrays are appended to the
  row layout (kernel and host compute the same lengths).
- Cost rule for a body: a division, `exp`/`log`/`tanh`/`sqrt`, or a nested reduction. Measured refusals in the
  corpus: softmax's `s`, attention's `z`, layernorm's `mean` and `variance` as the corpus writes them are body =
  load or product.

### Why
- One array per reduction, filled in parallel and folded by one thread, is the smallest change that keeps the
  meaning's order: no reassociation, no change to any rounding.

### What worked
- layernorm-inside 0.578 → 0.264 ms (2.1× faster than stage 2); `exp`-in-sum 12.41 → 0.748 ms (2.2× faster than
  stage 2). Both accepted exactly by the contract and bit-identical at full size.
- The corpus programs' fused sources are unchanged (no staged terms), and `fuse: false` still matches stage 2's
  digests.

### What didn't work
- First attempt produced a kernel with two loop variables of the same name: `bind` named indices `i${indices.size}`,
  and re-binding an axis that a staging loop had already bound does not grow the map, so both folds got `i5`. Fixed
  by naming from a counter (`indexNames`), which is identical for stage 2's kernels (they never re-bind) and for
  every source that never re-binds.
- My first probe program put the staged member in its own group (`m` read no member), so nothing staged; the
  planner's rule "a statement joins when it reads a member" made the probe say the wrong thing twice before I
  wrote the statements as a chain.

### What I learned
- A row-scalar reduction's terms are the only work a block-mode kernel does serially; everything else is already
  spread over the block.

### What was tricky to build
- The fold's flat position: the staging loop decomposes `q` into the reduction's axes with successive modulos, and
  the fold counts its own iterations, so the two agree for one axis, for several axes, and for the split-sum form
  (`sum(block) sum(tail)`, where a term is the tail reduction and the count is `ceil(D/4)`).

### What warrants a second set of eyes
- `termArrays` matches plan entries to IR nodes by identity after re-running the same predicate; a second predicate
  would silently disagree with the first (there is only one, `serialReason`).

### What should be done in the future
- Chunked term arrays, so a very long reduction does not enlarge the row set.

### Code review instructions
- `fusion.ts` `planTerms`/`serialReason`/`termArrays`, `cuda-source.ts` `kernelWriter`'s reduce case and the staging
  loops in `emitGroup`.

### Technical details
- Term arrays: `a0`, `a1`, … with lengths `na0`, `na1`, … appended after the row buffers in the same shared/scratch
  base.

## Step 3: The cost gate

A block-mode group whose rows do not fill a warp wastes its lanes, and the device admits at most 24 blocks per SM,
so a fused kernel can have an eighth of stage 2's threads working. The gate keeps such a group unfused.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Decide from the IR plus the launch's shape values, and justify the threshold.
**Inferred user intent:** No round numbers; the rule must come from the measurements.
**Commit (code):** 6d33272 (same commit as step 2).

### What I did
- `fusion.ts`: `warp = 32`; `blockWidth(group, tensors, sizes)` = the wider of the group's rows and its staged term
  arrays, in elements; `applyGate` rewrites a block-mode group whose width is under a warp into stage 2's
  per-statement kernels and records `{statements, reason, width}` in `FusionPlan.gate`.
- `index.ts`: `LoweringOptions.sizes`; `runTixCuda` derives the values from its inputs, so the timed path is gated;
  `cudaSource` takes them as an option; `checkLowering` has none and plans the ungated lowering.

### Why
- The width is the quantity the loss depends on, and the shape values are the only way to know it. The brief allows
  values at launch.

### What worked
- Measured with `scripts/06-plans.mjs` (api = gated, ungated = the same planner without values, unfused = stage 2):
  short-row softmax C=4 0.294 / 2.923 / 0.298 ms, C=16 0.284 / 0.734 / 0.328 — the ungated plan is 7.5× and 1.9×
  worse than unfused, so gating is right and the threshold is not too conservative.
- `longterm` (rows of 8, staged reduction of 1024 terms): fused 0.047 vs unfused 0.117, so width must be the wider
  of rows and term arrays; a row-only rule would have thrown away a 2.5× win.

### What didn't work
- Nothing to report.

### What I learned
- 32 is where the measurements put the crossover (16 → fused 13% slower, 32 → fused 75% faster) and it is also the
  warp size, so the rule is not a fitted constant.

### What was tricky to build
- Deciding without values: `cudaSource` must keep printing one kernel for a corpus program, so the no-values default
  is "fuse" (stage 3's plan) rather than "refuse".

### What warrants a second set of eyes
- The gate makes the lowering a function of the launch's shape values, so the artifact `checkLowering` checks is not
  always the artifact a benchmark runs. A GPU test checks a gated source as a supplied candidate and compares its
  full-size output with the interpreter, but the contract itself is a per-(program, lowering) check.

### What should be done in the future
- Several rows per block for short rows, which would remove the need for the gate on them.

### Code review instructions
- `fusion.ts` `blockWidth`/`applyGate`, `index.ts` `shapeValues`/`lower`.

### Technical details
- Without a symbol's value the width is unknown and the group stays fused.

## Step 4: Tests

`tests/tensor/terms.test.mjs` (no GPU: plans, staging decisions, refusals, the gate, source shape) and
`tests/tensor/terms-gpu.test.mjs` (GB10: exact acceptance, full-size equality with the interpreter, the scratch
path, the gated source as a candidate, four mutants).

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Prove what the brief asks for, and keep GPU tests in their own file.
**Inferred user intent:** The evidence a reviewer needs, with the mutants that show the check has teeth.

### What I did
- 9 plan tests, 5 GPU tests; and the existing tensor tests were rerun unchanged.
- `tests/tensor/terms-gpu.test.mjs` mutants: the term array written in reverse (`a0[na0 - 1 - q0]`) and the fold
  started at 1 (`U f0 = 1;`), both rejected with a coordinate; the gated short-row source verified through
  `checkCudaLowering` as a supplied candidate, and its full-size output compared with `runTix`.

### Why
- A staging loop is a new way to compute a term; a wrong index or a reversed fold must be caught.

### What worked
- Local: 38 tests pass (corpus, cuda, language, passes, fusion, terms). GB10: `terms-gpu` 5/5, and the existing
  `fusion-gpu` + `cuda-gpu` 16/16 unchanged.

### What didn't work
- The split-sum case first failed to compile: the host's `std::max<U>({...})` mixed `static_cast<U>` entries with a
  raw `(d1)` from the term length, which nvcc rejects as a narrowing conversion. Fixed by wrapping the host-side term
  length in `static_cast<U>`.
- Two test-side errors of mine: an extent assertion that said "2 axes" where the member has one axis beyond the block
  domain, and `out`'s reduction is over `K`, not `V`.

### What I learned
- The contract's small cases already catch a reversed term array: the half-ulp row `[1,0,0,0,2^-24,2^-24,2^-24]`
  must be summed in order.

### What was tricky to build
- The gated source cannot be checked by `checkLowering` (no shape values), so the test builds the candidate artifact
  itself, which is exactly the API's supplied-candidate path.

### What warrants a second set of eyes
- A missing barrier is a race, not a deterministic mutant; the suite has none. The staging barrier is emitted
  unconditionally when a member stages anything.

### What should be done in the future
- N/A

### Code review instructions
- `tests/tensor/terms.test.mjs`, `tests/tensor/terms-gpu.test.mjs`.

### Technical details
- GPU test wall time 84 s, dominated by remote compiles.

## Step 5: Measurements, contract cost and the report

Two rounds of five `benchmark` calls per program and lowering (`scripts/09-round1.jsonl`, `scripts/09-round2.jsonl`),
the plan table (`scripts/08-plans.md`), the gate's own measurements (`scripts/06-plans.mjs`), and the contract's cost
(`scripts/10-contract-cost.jsonl`).

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Report what was measured and what was only argued, separately.
**Inferred user intent:** Numbers a reviewer can replay.
**Commit (code):** see the last commit of the branch.

### What I did
- `node <ticket>/scripts/02-cases.mjs --runs=5` twice; `node <ticket>/scripts/07-contract-cost.mjs` fused and
  unfused; `node <ticket>/scripts/04-check.mjs` for exact acceptance and full-size equality.
- Wrote `reference/02-report-fusion-that-is-never-slower.md`.

### Why
- The brief fixes how the time is measured (`benchmark`: warm-up plus the median of three launches, under the
  runner's lock) and asks for the median of several such calls.

### What worked
- (results in the report)

### What didn't work
- (results in the report)

### What I learned
- (results in the report)

### What was tricky to build
- N/A

### What warrants a second set of eyes
- Run-to-run spread on this shared machine: fused times of the same program moved up to 8% within a round when other
  agents' untimed jobs overlapped a timed one.

### What should be done in the future
- See the report's Later list.

### Code review instructions
- Start with the report, then `fusion.ts`, `emitGroup` in `cuda-source.ts`, and `tests/tensor/terms-gpu.test.mjs`.

### Technical details
- (filled in by the report)
