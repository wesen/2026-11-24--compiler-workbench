---
Title: Ordered terms and fusion selection
Ticket: IRWB-030-A
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T01:22:52.450589572-05:00
WhatFor: ""
WhenToUse: ""
---

# Ordered terms and fusion selection

## Domain and decision

The input is the checked Tix core, including optimized IR, with consistent nonnegative shapes, finite f32 inputs and in-bounds reads. CUDA buffers and launches must fit the target. The output preserves the current revision's f32 result words, comparing NaNs as a class.

Keep the existing dependence and extent legality analysis. For a legal block group, inspect reductions in statements with one output per block point. Stage terms when a reduction is outside other reductions, has one plain extent binder, has a reduction-free body and does expensive scalar work. The initial candidates are division, square root and the double transcendental paths. The simplest alternative is the existing thread-0 fold, which avoids extra barriers and storage and is the initial choice for cheap bodies. Row-element reductions already have one thread per output element. Nested reductions and generated split bounds keep their original scalar paths.

Threads write rounded terms by reduction index into a reusable buffer. After a block barrier, thread 0 uses the existing scalar emitter and folds the saved terms in ascending order. A second barrier protects reuse when another staged reduction follows. The term buffer extends the existing shared or scratch layout, and its length participates in launch sizing. A serial fold through that buffer preserves the f32 addition order even when the body generates NaNs or the extent is empty. A tree fold would reduce the critical path but would change Tix's meaning.

Use a conservative profitability policy separate from legality. Measure the staged and legacy schedules against stage 2 on all eight requested programs, and compare candidates where changed work distribution is likely to cost more than the saved global traffic. Preserve thread-mode chains where they retain stage 2's element mapping. For block groups whose performance is unsupported by the evidence, prefer the stage-2 mapping. Start with IR-based selection so the same source and correspondence are seen by source inspection, execution and checking. Shape-dependent dispatch is an alternative if a measured crossover warrants the extra kernel definitions. Timing is evidence for tested workloads on this target and cannot establish a universal device-time bound for symbolic programs.

The existing lowering transformation, exact differential checker and timed runner cover the implementation. A separate pass over Tix would need to express barriers and storage in a language that has neither. Keep the decisions in CUDA planning and emission. Preserve stage 2's source bytes when explicitly requested.

## Validation

Verify both routes against the existing contract and use targeted cases for ordered f32 folding and empty bounds. Report kernel counts, each block kernel's staged reductions and three timed API calls per path. Three calls allow the middle observation to exclude a single high or low observation. Compare the output words for each full-size pair and report the case counts and cold and repeated wall times of the exact contract.

## Later

Reassociated folds, contraction tiling, FMA, tensor cores, approximate intrinsics, streaming attention and autotuning are outside the requested stage. Correspondence entity validation is assigned to another ticket.

## As built

The static rule leaves reduction-free block groups on the element grid. It also leaves costly per-element reductions and costly row-scalar reductions whose terms cannot be staged on the element grid. Thread-mode joins continue to use that grid. In inside attention the two outer contractions stay separate, and the three middle statements share one block kernel. The report gives the supporting timing comparisons and the opportunities the static rule leaves unused.
