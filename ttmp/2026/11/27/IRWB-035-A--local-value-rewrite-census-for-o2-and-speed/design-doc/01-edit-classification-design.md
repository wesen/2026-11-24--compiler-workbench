---
Title: Edit classification design
Ticket: IRWB-035-A
Status: active
Topics:
    - compiler
    - verification
    - research
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:12.100266506-05:00
WhatFor: ""
WhenToUse: ""
---

# Edit classification design

Measure every edit record in each accepted, changed revision of the built-in O2 and speed pipelines on every
project in `corpus/projects/`. The library accepts consecutive native Typed blocks revisions, their framework
correspondence, and the accepted Typed edit list. It returns one classification per record in input order,
with class, reason, statement IDs, candidate shapes and rule evidence where available. Repeat acquisitions of
the same program from r0 so the pipelines do not inherit each other's revisions.

| Class | Operational definition |
| --- | --- |
| Local rewrite | An existing statement field has an expression substitution reproduced by the current fold or simplify rule table, or matched by the guarded strength-reduction shapes. The enclosing statement and execution site stay fixed. The numeric strength guard is an explicit predicate over the matched operand. |
| Structural | An edit to CFG, loop-invariant motion, inlining, rotation, unrolling or allocation where applicable. The O2/speed instances are `cfg`, `licm`, `bce`, `inline` and `rotate`. Even a value field replaced by LICM or inlining is part of the motion or inlining. |
| Other | All remaining records. DCE deletes dead work. Constant propagation uses reaching definitions, LVN introduces sharing across use sites, and substitution depends on a separate assignment, reaching local state and single-use/liveness facts. Metadata-only records inherit the class of their operation. |

An algebraic change inside a conditional expression is local until a separate edit changes the branch or its
targets. A strength reduction is local with an operand hypothesis even when analysis supplies that hypothesis.
Definitions at other statements, moving evaluation and introducing a local name are outside this primary
definition. To measure sensitivity, also count selected value replacements from constprop, LVN and subst as
contextual rewrites, leaving their supporting inserts, declarations and removals in their baseline classes.

## Decisions

- Count recorded edits once each, including repetitions within a pass. Inferring edits from entity diff alone
  would turn each rebuilt wrapper and pruned descendant into another edit and lose operations recorded against
  intermediate IDs. Use diff-like statement reconciliation only as an attribution audit.
- Use static Typed statements for the instruction denominator. Resolve direct statement endpoints and value
  owners in both revisions; use non-identity correspondence for relevant related statement endpoints.
  Expand added, merged-away and unreachable blocks to their affected statements. Count the union of
  statement IDs within each class and revision. Count distinct IDs for inserted, removed or replaced
  statements, and stable IDs once. An instruction may participate in two classes in an alternative
  classification, so use class–statement incidences as the share denominator and audit overlap. A local
  declaration without a statement endpoint contributes zero. Dynamic RV32 instruction counts would weight
  hot paths but cannot reliably identify which optimized statements each recorded edit affected.
- Replay table rewrites with the existing compiler helpers on a private store, comparing the resulting field
  by operator, type, immediate and ordered operands. A pass-name lookup alone cannot distinguish an actual
  matching field from a different output. Reuse of compiler code suits a census and shares its bugs. A proof
  checker would need independent validation as discussed in IRWB-008.
- Recognize an existing citation only from an edit-scoped, versioned rule token that matches the current
  evidence for a re-derived firing. Report those separately from re-derived matches with sound evidence
  stronger than sampled. A legacy note or a pass name cannot identify the rule that fired. Preserve
  the evidence strengths from IRWB-006 instead of collapsing them into a formal proof claim.
- Run the ordinary checked pipeline with project inputs and inspect published revisions. Directly invoking
  pass bodies would include candidates the normal pipeline rejects. Record every configured pass, including
  zero-edit passes, and report any rejection.

## Outputs and checks

The callable Typed module, focused tests, numbered corpus script, and report will live in the worktree.
The corpus script will render pipeline, pass and project tables and provide edit-level data to callers.
Reconcile record and statement counts, inspect unmapped or borderline cases, and run the requested test
groups. No framework change is planned because adjacent artifacts and correspondence already reach the
caller. The existing build completed on Node v24.18.0 before implementation.

## Later

- Independent proof checking and certificate emission belong to a separate stage.
- Dynamic RV32 attribution requires a mapping between executions and the edited Typed statements.
- Backend allocation is outside the measured revision timeline, and these two pipelines have no unroll pass.
