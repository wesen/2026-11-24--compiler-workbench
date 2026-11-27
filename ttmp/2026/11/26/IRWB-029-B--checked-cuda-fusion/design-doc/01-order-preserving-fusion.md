---
Title: Order-preserving fusion
Ticket: IRWB-029-B
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T23:01:40.177177632-05:00
WhatFor: ""
WhenToUse: ""
---

# Order-preserving fusion

Accept the same checked Tix functions and concrete calls as stage 2, including transformed reductions, zero sizes and parameter returns. Plan consecutive definitions before emission. The default uses the longest proved group starting at the next definition. Singletons keep the stage-2 kernel. The explicit unfused option uses only singletons.

* Element schedule. Equal symbolic result shapes and identity-coordinate reads of private earlier group values let one thread hold those f32 results in registers. The first definition may reduce, so this covers a contraction and its pointwise epilogue. Require a dependency between stages and no external uses of a private value.
* Row schedule. Recognize a rank-one reduction reading a matrix along its contiguous last dimension. Group row scalars and pointwise row vectors whose internal reads stay in the same row. A block owns the row. Cooperating lanes load its source, compute vector stages and store the final vector. One lane evaluates each scalar fold with the ordinary scalar emitter. Barriers publish each completed stage. Use device scratch for rows larger than the kernel's shared memory allowance. This keeps one executable for symbolic widths.
* Keep scalar operations and loop bounds verbatim from the selected revision. Reusing the existing scalar emitter avoids duplicating signed-zero, NaN, tail and exact rounding rules. Use the existing block size initially and measure. Contracts use the emitted source revision as candidate identity.

A Tix rewrite can inline pure expressions but cannot name a block barrier or a register result shared across repeated loads. A kernel artifact would add construction and validation without a second consumer of the schedule. An emitter-local plan can preserve source statement membership directly. Framework correspondence already accepts arrays on both ends of a merge. CUDA source has no projected kernel entities today. Verify the merge primitive separately and keep the existing whole-function differential contract.

Compare source counts, exact GPU samples and locked median event times for all six programs. Count global traffic from emitted loads and stores separately from measured time. Independent statements, non-identity internal element reads, escaping intermediates and contractions across materialized tensors can retain launch boundaries. Parallel folds, tiling, streaming attention and tuning fall outside this stage.
