---
Title: Partial implementation report
Ticket: IRWB-029-C
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
LastUpdated: 2026-11-26T23:05:14.325845142-05:00
WhatFor: ""
WhenToUse: ""
---

# Partial implementation report

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

## Status: incomplete

The implementation fuses single-use pointwise producers and single-use reductions consumed at the same coordinate outside another reduction. The latter preserves the producer's sequential accumulation. It refuses substitution into reductions to avoid repeating work, and refuses reduction producers whose consumer coordinates differ or whose use is nested in a reduction. It does not implement row staging, softmax/layernorm fusion, or multi-use reduction epilogues; the requested stage is not complete. No framework or remote-tool changes were made. Emitter-local planning keeps the existing Tix artifact; the framework's grouped correspondence could express a merge, but no kernel artifact is created on which to record it.

The existing exact contract samples valid shapes and deterministic inputs, executes the current f32 meaning on the CPU and compares GPU output bits, with NaNs as a class. This is sampled evidence, not a proof. A reduction epilogue check accepted as exact; its wall time was approximately five seconds, including remote compilation and transport, not just contract computation. Build and focused source tests pass. The original tensor suite initially had one outdated assertion about the default kernel count; updating it to request unfused emission made the focused test pass. The full original suite otherwise passed 32 tests including GPU tests, but was run before the final restriction on inlining into reductions.

The following are median-of-three CUDA event measurements following one warm-up under the timed lock. Hashes of fused and unfused outputs matched for each measured case. Attention and MLP are the later measurements after restricting inlining. Runs are single batches and timings vary.

| Program | Unfused kernels / ms | Fused kernels / ms |
|---|---:|---:|
| matmul | 1 / 0.2142 | 1 / 0.2140 |
| softmax | 4 / 0.7968 | 4 / 0.7955 |
| layernorm | 4 / 0.4733 | 4 / 0.4712 |
| attention | 6 / 1.0511 | 6 / 1.0512 |
| mlp | 3 / 0.9610 | 3 / 0.9312 |
| conv2d | 1 / 0.1676 | 1 / 0.1651 |

An initial MLP fusion took 23.09 ms versus 0.91 ms because it recomputed the activation inside the next contraction. The final planner refuses that fusion; this is a performance legality restriction, not an arithmetic correctness failure.

Per-kernel byte counts and bandwidth estimates were not completed. The row-fusion mapping and its GPU checks remain necessary before this stage can be considered finished. Nothing in these measurements demonstrates the requested softmax speedup.
