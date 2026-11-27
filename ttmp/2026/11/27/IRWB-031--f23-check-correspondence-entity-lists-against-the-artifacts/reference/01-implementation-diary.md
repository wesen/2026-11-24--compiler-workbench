---
Title: Implementation diary
Ticket: IRWB-031
Status: active
Topics: []
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T01:21:25.553315046-05:00
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

## 1. Regression first

The request is to add optional entity enumeration to `defineIR`, compare correspondence lists against both artifacts where available, preserve behavior for non-enumerating types, test first, and leave Typed and Tix untouched.

Ran `npm run build && node --test tests/framework/correspondence-entities.test.mjs` before changing the implementation. The build passed; the sandbox prevented the test worker from running. Re-ran `node --test tests/framework/correspondence-entities.test.mjs` with escalation: three tests failed with `Missing expected rejection` for fake source, fake target, and omitted source `s2`; the non-enumerating case passed (1 pass, 3 failures). The omitted-target assertion follows the omitted-source assertion and could not yet execute.

## 2. Implementation decision

The contract manager already checks correspondences against artifact revisions and has the declared types at transformation and analysis-transfer boundaries. Checking there avoids coupling the generic IR correspondence builder to artifact types. Carry the two declared lists as optional correspondence fields through `semanticCorrespondence`; extracting them from opaque evidence would be smaller syntactically but would make a structured contract depend on untyped application evidence. Enumerators are opt-in, preserving existing behavior for other IR types.

## 3. Validation

`npm run build` passed. The focused regression run passed all 4 tests. The requested combined framework, Typed, and tensor non-GPU test run passed: 411 tests, 409 passed, 2 skipped, 0 failed. The first attempt to select non-GPU files used a zsh pattern without extended globbing and selected no files; a Bash array with a filename filter ran the intended set. `git diff --check` passed. Prettier was not installed in the worktree or available as a command, so no Prettier invocation was made; the TypeScript edits follow the surrounding style.

A CUDA artifact can opt in by adding `entities(value)` to its `defineIR` declaration and returning the kernel IDs for that value. Its semantic correspondence must supply the same IDs in `targetEntities`.
