---
Title: Residualize Typed control flow with a constant buffer
Ticket: IRWB-036-A
Status: active
Topics: []
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/specialize.ts
      Note: Existing host bindings
    - Path: repo://src/typed/tx.ts
      Note: Residual CFG construction and origins
    - Path: repo://ttmp/2026/11/27/IRWB-036-A--specialize-the-bytecode-vm-on-constant-memory/scripts/01-lift-vm.mjs
      Note: VM native IR probe
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:43:51.291119213-05:00
WhatFor: ""
WhenToUse: ""
---

# Residualize Typed control flow with a constant buffer

## Supported inputs and host contract

Extend a `typed.bindings` parameter fact with a `cells` value. It describes the entire length and u16 contents of an ordinary Typed input buffer in guest memory. The host supplies this exact buffer on every call, and the existing generated-case contract runs both r0 and the candidate with those same cells. An integer fact fixes the entry argument as before. Counts and seeds remain dynamic. Preserve the call signature. This stage handles external entry functions. Reject a target with an internal caller and reject calls or unclassified memory accesses reached during specialization. A runtime comparison of the cells would make the promise unnecessary for callers, at the cost of rereading the bytecode at every invocation. The host already sets the image in this workload, so use the same conditional contract as field binding.

Check the bindings artifact and parameter types at entry to specialization. Only a change accepted by the checked pass installs its assumptions in the revision history. A later pass or checkout uses the applicable revision's assumptions. A buffer assumption supplies both length and contents. A known, out-of-range checked access retains the trap without folding the read to an arbitrary number. A dynamic checked access is outside this stage's residualization domain. Prove every reachable store is inside the private frame before accepting a result, so the folded reads cannot be invalidated by the program. Leave existing scalar and field rewriting on its current path.

## Binding-time analysis and residual CFG

Walk Typed blocks with a state of known local values. Integers, identity of a bound buffer, checked addresses into it, and offsets into the function's private frame can be static. Ordinary input scalars, frame loads and arithmetic depending on them stay dynamic. Follow assignments, including the frontend's temporaries. Reuse i32 operation semantics. Fold `load16u(caddr(boundBuffer, staticIndex), 4)` after the unsigned range test. This is the operation the tape loader emitted for both bytecode fetches. A static branch follows only its selected edge. A dynamic branch keeps its condition and explores both successors.

Memoize by source block and the static bindings of its live-in locals. A repeated state closes a residual edge, so the VM dispatch can specialize on each reachable program counter and stack depth while a loop controlled by the guest count remains a loop. A single merged state per block would make different program counters join to unknown and leave the dispatch in place. Full unrolling would require fixing the count or repeatedly emitting the backedge. Bound the number of variants by the original block count times the number of promised cells by default, the space required if each block appears once per possible code cell. Additional independent static variables can exceed this estimate. Use an explicit block budget to test failure and bound growth. A budget or unsupported access aborts the draft. The original remains available.

Emit through Typed transactions and retain origin links for copied blocks, statements and values. Folded buffer fetches and specialized control flow cite the binding artifact as well as their IR origins. Use the ordinary checked cleanup passes on the residual CFG. This uses the existing generic pass and correspondence APIs.

## Experiment and measurements

Measure scalar binding alone, dispatch residualization with frame memory retained, and the effect of promoting fixed, aligned i32 frame slots into Typed locals after residualization. The lift probe shows one stack and one locals array, 32 private bytes together, with frame zeroing and checked array indexing. Once all accesses are to constant slots, scan for any remaining frame or pointer escape before promoting. This experiment tests whether frame traffic accounts for the residual gap. Running the ordinary optimizer alone is the baseline.

Measure RV32 executed instructions and code bytes with coalescing at count 12 and seed 8 for each entry, against the general r0 and the original hand-written loops. Also report the combined hand-written image size. Replay all 442 corpus calls against the general evaluator and RV32 image, including memory and trap outcomes. Check budget refusal, rollback, buffer mismatch, and provenance. Run the requested typed, framework and workbench test selections.

## Later

- Add guarded fallback when callers cannot promise a fixed buffer.
- Extend the memory model to dynamic buffer indices, internal calls, and stores that need alias analysis.
- Widen static state to residualize a subset when the variant budget is exceeded. This session uses one bounded CFG construction path.
