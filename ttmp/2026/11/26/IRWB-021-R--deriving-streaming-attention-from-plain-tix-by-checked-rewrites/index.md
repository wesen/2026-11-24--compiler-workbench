---
Title: Deriving streaming attention from plain Tix by checked rewrites
Ticket: IRWB-021-R
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/README.md
      Note: the transformation, property and assurance (declared/checked/proof) model the nine rules and the Associative property register into
    - Path: repo://src/framework/contracts/differential.ts
      Note: the sampled differential invariant (cases, seeds, relations, counterexamples) that every rule application's ensures clause instantiates
    - Path: repo://src/framework/ir/PATTERNS-AND-REWRITES.md
      Note: the pattern API the rules' syntactic side conditions will be expressed against once a Tix adapter exists
    - Path: repo://ttmp/2026/11/26/IRWB-021-R--deriving-streaming-attention-from-plain-tix-by-checked-rewrites/design-doc/01-deriving-flashattention-from-the-plain-tix-attention-program-a-checked-rewrite-research-design.md
      Note: the research design deliverable (rule set, construct, derivation, checking, experiment)
ExternalSources: []
Summary: "Research design: can a compiler derive the streaming (FlashAttention) form of attention from the plain Tix program as a sequence of checked rewrites? Defines the missing state-reduction construct (tuple state, user-supplied associative combine, f32 fold meaning), nine rules with side conditions and real-algebra arguments, the six-step derivation, per-rule checking (exact or tolerance vs the f64 reference) in the framework contract, generality (softmax, LSE, fused moments reached; weight-mismatch, Welford, scans not), and a falsifiable GB10 experiment."
LastUpdated: 2026-11-26T22:10:00-05:00
WhatFor: "Settling the research question before any implementation; the deliverable is the design document in design-doc/."
WhenToUse: "Before implementing the Tix state-reduction construct, the rewrite rules, the CUDA lowering, or the GB10 measurement rig."
---

# Deriving streaming attention from plain Tix by checked rewrites

## Overview

IRWB-021-R is a research design ticket, no implementation. The question: single-head attention written plainly in Tix materializes an N×N score matrix; FlashAttention computes the same function with a running (max, normalizer, output) state and never stores the scores. Can a compiler derive the streaming form as a sequence of rewrites, each checked, each with a local mechanical correctness argument?

The answer given here: yes, with one added IR construct (a state reduction over a tuple with a user-supplied combine) and nine rules. The design document states each rule with side conditions and its algebraic argument over the reals (one rescaling lemma and its payload extension carry the set), derives the streaming form from the given program in six checked steps, instantiates the framework's meaning contract per rule (domain, observation, exact or tolerance relation against the f64 reference, with an explicit f32 error model), analyzes generality (softmax, log-sum-exp and fused moments reached; weight-mismatch, Welford variance and scans not, with reasons), and pre-registers a falsifiable GB10 experiment: derived kernel vs unfused lowering vs hand-written streaming kernel, measured wall-clock time and DRAM bytes, with named refutation conditions per hypothesis.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
- verification
- research

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- design/ - Architecture and design documents
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Command sequences and test procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
