---
Title: Parallel terms with a serial fold, and a launch-time gate for fusion
Ticket: IRWB-030-E
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: planFusion gains the term-staging decision and the gate's inputs
    - Path: repo://src/tensor/cuda-source.ts
      Note: Group emitter gains the term pass, the serial fold over staged terms and the per-statement instantiations
    - Path: repo://src/tensor/cuda-contract.ts
      Note: The check runs every case on both sides of the gate
ExternalSources: []
Summary: Row-scalar reductions compute their terms on all threads of the block and fold them in order on one; a launch-time gate runs a block-mode group per statement when its grid or rows make fusion slower; the contract checks both sides of the gate.
LastUpdated: 2026-11-27T01:29:01.393605054-05:00
WhatFor: Design of stage 3b before implementation
WhenToUse: Reviewing term staging, the fusion gate and what the contract checks
---

# Parallel terms with a serial fold, and a launch-time gate for fusion

## Goal and domain

Make the fused lowering (`fuse: true`) never slower than stage 2's (`fuse: false`), with every output bit still equal to the current revision's f32 meaning (NaN as a class). The domain is stage 3's: any function of the checked core, called with consistent shapes, finite inputs, in-bounds reads and sizes the GB10 can allocate and launch. `fuse: false` keeps printing stage 2's bytes (the digest test stays).

Two changes, both in `src/tensor/`: **term staging** inside block-mode kernels, and a **gate** that decides at launch whether a block-mode group runs fused.

## Baseline (measured on the base, one `benchmark` call each, script 01)

| Program (sizes of the brief) | Fused ms | Unfused ms |
| --- | ---: | ---: |
| layernorm, division inside | 0.584 | 0.541 |
| attention, division inside | 1.412 | 1.491 |
| softmax with `s[i] = sum(j) exp(x[i,j] - m[i])` (no `e` statement) | 12.416 | 1.636 |
| softmax, layernorm, attention, mlp as in the corpus | 0.385, 0.193, 0.750, 0.730 | 0.801, 0.482, 1.048, 0.941 |

The third row is the problem in its plain form: thread 0 of each block computes 1,024 `exp` calls serially while 127 threads wait.

## Term staging

**Where.** In a block-mode group, a member with no trailing axes (rank = block depth: `mean[i]`, `s[i]`) has one element per block and thread 0 computes it. For each *outermost* reduction R of such a member (a reduction not inside another reduction), the plan decides whether R's terms are staged.

**How.** A staged R with axes a₁…aₙ of extents n₁…nₙ gets a term buffer of c = n₁·…·nₙ floats in the block's row area (shared memory, or scratch when the rows do not fit). Before the member runs:

1. **Term pass, all threads.** Thread t computes terms t, t + blockDim, …: it decodes the term number row-major into (a₁, …, aₙ), a₁ outermost, evaluates R's body with the scalar code the serial loop would have run, and stores the f32 result at `terms[e]`.
2. A barrier.
3. **Fold, thread 0.** In place of R's loop nest: `acc = init; for (e = 0; e < c; ++e) acc = fold(acc, terms[e])`.

**Why the bits do not change (argued).** R's body does not read the accumulator (Tix has no way to name it), so each term is a function of the block point and (a₁, …, aₙ) only. The term pass evaluates it with the same instruction sequence as before and stores the rounded f32; the fold reads the same words in increasing row-major order, which is the meaning's lexicographic order with the first axis outermost, and applies the same `__fadd_rn` or max fold after each one. A store and a load move a word unchanged. With c = 0 the fold returns the initial value, as the empty loop did.

**Which bodies (decided from the IR).**

| Case | Decision |
| --- | --- |
| Body is a bare load of a row buffer (`sum(j) e[i,j]`) | Not staged: the terms already sit in shared memory, and a term pass would copy them. |
| Any other body | Staged, **unless measurement shows a class of cheap bodies is faster serial**; candidates are bodies of `+ - *` and negation only (`sum(j) c[i,j] * c[i,j]`). Script 03 measures layernorm (corpus), `rownorm` and `rowsum` with and without staging, and the rule is fixed from that. |
| R has an axis whose extent depends on another index (the `tail` extent that `split-sum` generates) | Refused: the term space is not a rectangle. After `split-sum`, the outer `blocks` reduction is outermost and is staged; its body contains the `tail` loop. |
| A reduction inside another reduction | Not considered: it is part of the outer reduction's term. |
| A member with trailing axes (`score[i,j] = sum(d) …`) | Refused: every thread of the block already computes elements of the row, so there is no idle thread to give the terms to. (When that row is much shorter than the block this is not true; see the gate, and Later.) |

*Simplest alternative:* keep thread 0's serial loop and let the gate unfuse the group. That gives up fusion's gain (one read and one write of the data) on exactly the programs the brief lists. *Alternative for the buffer:* reuse a dead row buffer for the terms. It needs liveness on the plan; the term buffer is added to the row area instead, and the cost (fewer resident blocks per SM) is measured.

The term buffer has one slot per group: its length is the largest, over the group's members, of the sum of that member's staged term counts.

## The gate

**Thread-mode groups** (elementwise chains, epilogues) always fuse. They keep stage 2's mapping and replace memory round trips with registers; a chain is measured to confirm.

**Block-mode groups** are decided at launch from two numbers the host already computes: the grid G (number of block-domain points) and the longest row L. Block mode puts one block on each row, so it is expected to lose in two regimes, both to be measured (script 04, softmax, layernorm and a row sum over shapes with N·C fixed):

- **few, long rows:** G blocks cannot occupy the GPU, while stage 2's elementwise kernels spread G·L threads over all 48 SMs;
- **many, short rows:** a block's fixed cost (scheduling, barriers, staging) is paid per row for little work.

The rule is `fused = G ≥ G_min and L ≥ L_min`, with both thresholds read off the measured crossover (the smallest values at which fused is faster for every measured program by more than the 2% run-to-run noise). If tiny problems (a few elements) are faster fused because one launch replaces several, they are still sent to the per-statement path: the rule stays two comparisons, and nothing at that size is worth a third. The numbers and the table go in the report and next to the constants.

**The other side of the gate is stage 2's code.** A gated group's kernel is one templated `__global__` definition, `template <int Mode>`: rows in shared memory, rows in scratch (both exist today as `template <bool Shared>`), and one instantiation per member statement with stage 2's mapping (one thread per element, 256 threads per block, the stage-2 scalar code including `minmax`). When the gate says no, the host allocates every member's buffer and launches the per-statement instantiations in order. So "not slower than unfused" holds by construction on that side, up to the noise.

*Kernel count.* By the brief's definition (the number of `__global__` definitions) a gated group counts 1, although its unfused side launches once per statement. The report gives both numbers: definitions, and launches at the brief's sizes. *Simplest alternative:* decide from the IR only and print either the fused or the unfused kernels. It cannot see G or L, so it cannot keep both softmax over [4096, 1024] fused and softmax over [1, 4·10⁶] unfused. *Alternative:* separate `__global__` definitions for the per-statement side; the same code, but the count would then say 5 for a softmax that launches one kernel.

## Contract

The exact relation and stage 2's case recipe stay. The recipe's shapes are small (sizes 0 to 11), so with the gate deciding by shape the check would only ever run the per-statement side. Therefore:

- the generated program takes `--gate=fused` and `--gate=unfused`, which force every gated group to one side (without the argument the rule decides);
- the invariant's case set is every sample on each side (`gate: 'fused' | 'unfused'` is part of the case description), and `decide` runs one batch per side. A subject with no gated group runs once and the result is used for both.

Forcing the fused side at small shapes is inside the domain: stage 3 ran every case that way. *Simplest alternative:* check only what the rule picks; it would leave the fused kernels unchecked. The cost doubles in GPU runs (one compilation, two executions) and is measured.

A GPU test at shapes large enough for the rule to pick the fused side compares `runTixCuda` with the interpreter, as stage 3's tests do for the shared-memory limits.

## API

Unchanged signatures. `runTixCuda` and `cudaSource` are as fixed by the brief; `runCudaBatch` gains an optional `gate` that is passed to the program. `planFusion`'s groups gain `terms` (statement, reduction number, reason) and `gated`; `plan.refusals` gains the refused stagings.

## Framework

No change is planned. The doubled case set fits `differential` as it is (cases are opaque to it). If the implementation shows a misfit, the change and its reason go in the report.

## Measurements

Script 01 times any named program through `runTixCuda(..., { benchmark: true })`, fused and unfused, and compares the two outputs' SHA-256. The report gives, per corpus program and for the two "inside" variants: kernel definitions and launches, the median of five `benchmark` calls, and which reductions use staged terms.

## Later

- Terms for members with trailing axes when the row is shorter than the block (needs the row length, known only at launch).
- Reusing dead row buffers for terms and rows (liveness on the plan).
- Several short rows per block, instead of sending short rows to the per-statement side.
- A cost model in place of two thresholds (per-term cost from the IR, capacity from the device).

## As built

The implementation follows this design in its two mechanisms (term staging with a serial fold; a launch-time gate whose other side is the group's statements in stage 2 form inside the same templated kernel) and in the contract (both sides forced, every sample a case on each side). Measurement changed the rest; the report has the tables.

- **Staging has a cost class.** Bodies of at most three `+ - *` or negations stay in thread 0's loop; the term pass was slower or equal there (script 03).
- **The gate has no `G_min`.** Few long rows are faster fused down to one row, because both lowerings are bound by one thread's serial fold and the fused one reads the row from memory it wrote itself. The rule's first part is `longest row >= 96 or rows <= 1024` (first read as 32 and 2,048 from a sweep with too few sizes, then corrected; diary step 8).
- **The gate has a second part, not in the design: lanes of heavy members.** A member with trailing axes whose reduction is costly cannot have staged terms. Block mode is then slower than stage 2 unless enough lanes work on it. The plan lists such members (`heavy`); the host computes `resident blocks x min(threads, row length)` and requires 19/24 of an SM's threads. For such groups the block is as wide as the narrowest heavy row (up to 256).
- **Members are written in place** (`inPlace`), not in the design: B takes A's row buffer when every read of A in B is at B's own element and nothing reads A later. It halves or thirds the block's shared memory, so more blocks are resident (script 08). The design had listed buffer reuse under Later and for the term area only; in place is a simpler rule and made the term-area reuse unnecessary.
- **Cases double only for subjects with a gate,** and the differential's baseline key says which. The design had every subject's cases doubled.
- `planFusion` returns `termRefusals` beside `refusals`; `FusionGroup` gained `terms`, `inPlace`, `heavy`, `gated`.
