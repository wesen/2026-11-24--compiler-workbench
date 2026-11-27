---
Title: Binding time and residual control flow
Ticket: IRWB-036-B
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:13.725849535-05:00
WhatFor: ""
WhenToUse: ""
---

# Binding time and residual control flow

## Contract and supported inputs

Specialize a Typed entry on a host-supplied u16 cell sequence (including its length) and optional scalar facts. Use the existing bindings artifact and Program.specialize. The two measurements bind the corpus code parameter and entry 0 or 34. Count and seed remain ordinary inputs in their declared ranges. The generated function retains its original ABI. The host supplies a valid buffer satisfying the promise at each call. A different pointer to equal contents is sufficient.

Before publishing, generate origin and candidate calls with the exact cells and entry, using the existing sampled meaning contract. Keep these assumptions in later checks and revision history. A run-time content comparison would serve hosts without the promise but would scan the image on every call. Omit it here. Refuse potentially aliasing stores and calls, allowing writes only to proven private frame words. Require the bound function to be an externally invoked entry without internal callers.

## Specialization algorithm

Interpret Typed blocks, not bytecode mnemonics. Track known integers, the promised buffer identity and fixed frame offsets in locals. A checked character load can become an integer when its index is static and in range. Preserve dynamic and out-of-range checked reads or decline unsupported uses. Evaluate static i32 operations with evaluator semantics. A dynamic value remains a residual expression. Promote statically addressed private frame words to fresh mutable locals, including zero initialization. Retaining frame accesses would be simpler but would leave the VM operand stack in memory after dispatch disappears.

Follow the taken edge for a known branch and emit both edges for a dynamic one. Memoize each original block by its live incoming static facts. Revisiting that state emits a backedge, so the guest loop remains a loop for dynamic counts. One version per block would merge different PCs and lose the opcode. Bound distinct states by a limit derived from input block and image size (one copy per block per cell, including an entry case for empty buffers). Decline the transformation on overflow. This is a compilation budget, not a claim about how many states all programs require.

Build the residual graph through Typed transactions, sourcing clones from the original entities and binding facts. Use ordinary checked cleanup passes to merge chains and discard temporary assignments. No new IR or framework primitive is anticipated.

## Experiment

Use the same coalescing RV32 backend and n=12, seed=8 as IRWB-012. Record instructions, emitted bytes per standalone image, and fraction of the general-to-hand gap closed. Compare the residual before and after cleanup. Compare return, trap and caller memory over the complete corpus domain as a separate check. Test promise provenance, writes, budget termination and restoration of the input domain.

Probe 01 built the project under Node 24.18.0 and loaded the real VM. Its r0 listing shows a checked caddr and load16u at offset four for each fetch, explicit stack bounds branches, and separate zero operations for two 16-byte frame arrays.

## Later

- Interprocedural effects and internally called specializations need a separate call-site contract.
- Dynamic frame indexing and escaping arrays need alias analysis for safe promotion.

## Amendment after measurement

The first residual measured 164 and 139 instructions after speed. Repeating subst alone saved zero instructions because distinct uses of a VM stack slot shared a multiply assigned local. A checked pass that gives short-lived definitions separate locals unlocked substitution and reduced both results to 77. This pass uses ordinary reaching definitions and live-out sets. It is exported for explicit application to a residual.

The Typed transaction adapter also needed a source edge for fresh locals. Recording the initializing statement and projected local index closes that gap without changing the shared IR or contract framework.
