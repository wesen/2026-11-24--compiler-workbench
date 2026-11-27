---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-M
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: the sampled meaning check as a differential invariant; CaseComparison and assuranceOf are where a tolerance relation must fit
    - Path: repo://ttmp/2026/11/26/IRWB-021-M--deriving-streaming-attention-by-checked-rewrites/scripts/01-f32-probe.mjs
      Note: the twelve measurements every f32 claim in the design rests on
    - Path: repo://ttmp/2026/11/26/IRWB-021-M--deriving-streaming-attention-by-checked-rewrites/various/01-f32-probe.txt
      Note: the probe's recorded output, cited as the numbers in design Part 3
ExternalSources: []
Summary: "Research design: derive FlashAttention from the plain Tix attention program by five checked rewrites. One Tix construct is missing (a fold whose carry is a tuple), five rules (R0-R5) carry the derivation, and the checking is weaker than Typed's: the real algebra is exact but f32 is not, so three of the five rules are real proofs plus a measured tolerance. Twelve host f32 probes measured the differences; the device experiment is designed and not run."
LastUpdated: 2026-11-26T22:40:00-05:00
WhatFor: "Before building the Tix rule table, the fold construct, the tolerance contract or the CUDA lowering; and when reviewing the claim that streaming attention is a compiler derivation rather than a hand-written kernel."
WhenToUse: "When picking up the Tix-to-CUDA track, when writing the first rewrite rule for a tensor domain, or when someone asks what 'checked' can mean for a rewrite whose real algebra is exact and whose f32 arithmetic is not."
---

# Deriving streaming attention by checked rewrites

## Overview

Single-head attention in Tix, written plainly, materializes an N×N score matrix. FlashAttention
computes the same function in one pass over blocks of the key index, keeping a running maximum, a
running normalizer and a running output, and never storing the scores or the weights. This ticket
asks whether a compiler can **derive** that from the plain program, as a sequence of rewrites each
of which is checked and each of whose correctness argument is local and mechanical — and answers:
yes, with one new construct and five rules, under a kind of checking that is weaker than the Typed
pipeline's.

**Status:** design round done; nothing implemented. The design is
`design-doc/01-intern-guide-and-research-design-deriving-streaming-attention-by-checked-rewrites.md`
(1 648 lines, six parts plus three appendices). The f32 behaviour it claims is measured by
`scripts/01-f32-probe.mjs` in five seconds, with the recorded output in `various/`.

The load-bearing results:

- **What Tix lacks** is a reduction whose state is not a single number. The design adds one
  statement form, `fold` with a tuple carry, an identity and an inline combine body, and defines
  its f32 meaning as a left fold (so the construct needs no monoid law; only the re-association
  rule does, and it checks one).
- **Five rules carry the derivation** (plus a structural α-renaming rule): slide a factor out of a
  reduction, normalize by any offset, extract the reduction group as a fold, fuse a pointwise
  definition into its single use, re-associate a fold into a fold of folds.
- **Three of them are not bit-exact in f32** and cannot be made so: the combine is *not*
  associative in f32 (82 % of random triples differ, measured). So the checking is exact where
  exactness exists (fusion is bit-identical: 0 of 2 048 elements differ) and a measured tolerance
  where it does not (≈1e-6 of the row's largest element, i.e. the plain program's own error).
  Over ℝ every rule is an identity with a three-line proof.
- **The offset is a validity condition, not an accuracy one.** Dropping the max is exact over ℝ and
  yields 256 of 256 inf/NaN at scores of 282.8. The derivation is *self-guarding*: with the running
  maximum, the guard is discharged by the fold's own invariant.
- **Which rewrite is expensive was not predictable from the algebra.** The division slide the
  streaming form *forces* costs ≤10 ulps of the row scale; the one it does not need costs 173,
  because `exp` amplifies an absolute score perturbation by the score's magnitude.
- **The experiment is designed and not run**: falsifiable hypotheses on measured DRAM bytes (primary)
  and device time, four kernels with two ablations, and a refutation table. Nothing in this
  worktree reaches a GPU.

## Key Links

- **Design:** [design-doc/01-intern-guide-and-research-design-…](./design-doc/01-intern-guide-and-research-design-deriving-streaming-attention-by-checked-rewrites.md)
- **Diary:** [log/01-design-diary.md](./log/01-design-diary.md)
- **Measurements:** [scripts/01-f32-probe.mjs](./scripts/01-f32-probe.mjs) → [various/01-f32-probe.txt](./various/01-f32-probe.txt), `.json`
- **Related Files**: see the frontmatter
- **External Sources**: none

## Status

Current status: **active** — design complete; the Tix front end, evaluators and meaning contract
are being built in parallel and are not in this worktree, so §3 of the design fixes the interfaces
it assumes rather than implementations.

## Topics

- compiler
- ir
- verification
- research
- performance

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- design-doc/ - the design
- log/ - the diary
- scripts/ - the f32 probe
- various/ - the probe's recorded output
- reference/, playbooks/, sources/, archive/ - unused this round
