---
Title: Implementation diary
Ticket: IRWB-042-A
Status: active
Topics:
    - typed
    - compiler
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:27:49.854327345-05:00
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

## 1. Fix the two Typed defects

The request is recorded in the conversation: fix F36 and F38, activate their existing tests, and check the corpus baselines and non-GPU suites. BCE compared reaching-definition sets, which conflate loop iterations; its existing SSA analysis distinguishes the values actually read at the guard and at the check. LVN kept candidate value IDs across replacements that removed descendants and rebuilt ancestors. It now drops candidates no longer present in their recorded statement.

Ran `npm run build` and started the requested defect tests and corpus check. The first unbounded suite run was stopped because its worker count overloaded the shared machine; restarted with `--test-concurrency=2`. The tmux socket was inaccessible in the sandbox, so the tmux invocations were escalated.
