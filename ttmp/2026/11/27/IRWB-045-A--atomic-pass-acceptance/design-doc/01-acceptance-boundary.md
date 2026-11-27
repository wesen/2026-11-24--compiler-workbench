---
Title: Acceptance boundary
Ticket: IRWB-045-A
Status: active
Topics:
    - framework
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T18:34:15.388366337-05:00
WhatFor: ""
WhenToUse: ""
---

# Acceptance boundary

Supported inputs are pass applications and stores accepted by the existing IR and contract APIs. The input revision and its needed analyses may be retained before the pass runs. Candidate revisions, contract facts, and preservation results stay private until the contract and every preservation claim succeed. Rejection leaves the input and any pre-existing manager evidence intact, without publishing the candidate or accepted execution.

Prepare native candidates in a private store; edits already have a prepare operation. Use the manager's deferred transformation and extend its transaction to stage preservation analyses in the same overlay. Publish through the IR store's existing synchronous acceptance protocol, which commits the manager transaction as part of publication. For a different output ID, the store needs a corresponding atomic publication operation. The synchronous runner has no caller store or manager and continues to return its gated candidate.

The simplest alternative is to run preservation before the contract, but preservation itself can publish candidate analyses and a later rejection would still leak them. A separate throwaway manager would lose existing analysis dependencies and resource semantics. The existing overlay and publication protocol provide the shared boundary.

Later: none.
