---
Title: Report
Ticket: IRWB-067
Status: active
Topics:
    - tensor
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T03:39:23.240227882-05:00
WhatFor: ""
WhenToUse: ""
---

# Report

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

## Outcome

CUDA lowering uses the scheduler's cached initial artifact and full pass results to compose correspondence. The scheduler builds registries through one factory, collecting results per execution; the public registry remains available to plan consumers. The memo key is the entire serialized function and fuse option: the scheduler has no other program input, so a revision change affecting the function changes the key, while equal functions across revisions reuse work. A revision-specific key would add a dependency the scheduler does not have.

On matmul, after 20 warmups, five batches of 100 `cudaSource` calls gave before 8.177, 6.261, 5.603, 6.725, 6.070 ms/call (median 6.261) and after 4.071, 2.082, 2.173, 2.082, 1.948 (median 2.082). The shared machine and separate runs limit precision; the retained transformation and correspondence work explains why the result is not the historical 0.29 ms. Run `node ttmp/2026/11/28/IRWB-067--lowering-follow-up-fixes/scripts/01-benchmark.mjs` after building to repeat.

Existing corpus assertions remain unchanged. A new test covers reuse and distinct function and fusion keys. No framework infrastructure was added or duplicated. No changes to index.ts were needed. GPU tests are deferred to the coordinator as requested.

## Validation

- `npm run build` and `npm run check`: passed.
- `node --test tests/tensor/lowering.test.mjs`: passed, including 24 corpus cases for byte identity and correspondence.
- Baseline check: `no differences`.
- Non-GPU suite: 85 files passed and 4 failed in the sandbox (89 total). Rerunning the four files with elevated permissions passed 15 tests, with 1 pre-existing conditional skip. The initial file-level reporter did not expose the failure diagnostics, so the cause is not established.
