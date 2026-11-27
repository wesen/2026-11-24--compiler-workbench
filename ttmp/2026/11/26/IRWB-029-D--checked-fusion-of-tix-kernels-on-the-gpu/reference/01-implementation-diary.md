---
Title: Implementation diary
Ticket: IRWB-029-D
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
LastUpdated: 2026-11-26T23:14:27.253373387-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

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

## Step 1: Read stages 1 and 2, probe the GB10, write the design

I read the IRWB-020-B and IRWB-022-I designs and reports, the IRWB-024 fixes, the tensor sources and tests, and the framework's contracts and IR READMEs, `define-pass.ts` and `correspondence.ts`. Then I probed the GPU limits the row mapping depends on, recorded the stage-2 source digests that `fuse: false` must keep, and wrote the design (fusion as a legality analysis on the Tix IR plus a group emitter).

### Prompt Context
**User prompt (verbatim, opening excerpt):** "You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). ... Your ticket is IRWB-029-D. This is an **implementation stage**, in one session. Write a short design first and commit it. Then implement, test, measure, and write a final report in the ticket." The full brief (stage 3: checked fusion; fixed API with `fuse` and `benchmark`; measure kernel count, benchmark time, bytes per kernel; report framework changes) is in the session that created this ticket.
**Assistant interpretation:** Design, then implement order-preserving fusion in the CUDA lowering, checked exactly on the GB10, measured against stage 2.
**Inferred user intent:** Find out whether the v6 framework can express and check a many-statements-to-one-kernel lowering, and how much fusion buys without changing bits.

### What I did
- `node tools/cuda-remote.mjs <ticket>/scripts/01-device-limits` (probe 01).
- `node <ticket>/scripts/02-stage2-source-digests.mjs > .../02-stage2-source-digests.json` on the base build.
- Checked the checker's extent unification: `fn f(x: f32[N], t: f32[M,K]): f32[N] { y[i] = x[i] + sum(k) t[i,k]; ... }` fails with `1:63 Inconsistent extent`; `t[i+0,k]` as the only witness fails with `Cannot infer extent`, so an IR address can be plain without its extents having been unified.
- Wrote `design-doc/01-checked-fusion-of-tix-statements-into-cuda-kernels.md`.

### Why
- A Tix pass cannot express where an intermediate lives; a kernel IR would have no consumer but the emitter. The plan is an analysis result recorded in the CUDA artifact.

### What worked
- Probe 01: `{"name":"NVIDIA GB10","cc":"12.1","sms":48,"maxThreadsPerSm":1536,"maxBlocksPerSm":24,"sharedPerBlockDefault":49152,"sharedPerBlockOptin":101376,"sharedPerSm":102400,"l2Bytes":25165824,"maxGridX":2147483647,"warp":32}`.
- Baseline build and the four non-GPU tensor test files: 22/22 pass.

### What didn't work
- No failures in this step.

### What I learned
- Staging must compare a tensor's leading extents with the block domain itself, because `plain()` in the IR does not imply that the checker unified the extents.
- 99 KiB per block caps a softmax row with its exp buffer at about 12K floats; larger rows need the scratch fallback.

### What was tricky to build
- N/A (design only).

### What warrants a second pair of eyes
- The legality rule's prefix argument (lowering k keeps earlier members legal) and the claim that a block's global writes are visible after `__syncthreads()`.

### What should be done in the future
- Choose the block-mode thread cap by measurement (step to come).

### Code review instructions
- Read the design doc; replay probe 01 and script 02 from the worktree root.

### Technical details
- Stage-2 digests: `scripts/02-stage2-source-digests.json` (15 sources).
