---
Title: Implementation diary
Ticket: IRWB-035-A
Status: active
Topics:
    - compiler
    - verification
    - research
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:12.893474688-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1. Freeze the measurement design

The first decision was to use the edit log as the unit of work and the two adjacent revisions as the unit
of context. IRWB-008 shows that one recorded field change can contain several table rule firings and that
the current tables do not emit explicit rule tokens.

### Prompt context

IRWB-035-A asks for a reproducible O2/speed census of local, structural and other edits, the number of
instructions they affect, and verified-rule coverage. The design must be committed before implementation.

### What I did and why

Read the pass contracts, Typed transaction and strategy paths, and relevant IRWB-006, IRWB-008 and IRWB-010
sections. Created the ticket and compared log-based counting with entity diffs. Selected static Typed
statements because the edit log and correspondence can relate them to individual edits. Scheduled a
contextual-rewrite sensitivity analysis so the boundary around dataflow dependencies is measurable.

### Evidence and review

`npm run build` passed on Node v24.18.0. Review the design's class table and denominators first, especially
the handling of support operations for LVN and substitution.

## Step 2. Implement the classifier and test the attribution

The classifier uses the two accepted artifacts and the existing correspondence. It keeps one row per Typed
edit record and does its table replay in a private store. A transaction emits the field edit after visiting
every node in that field, so the current log position groups rule firings even if an outer rule consumes
an inner result.

### What I did and why

- Implemented `classifyEdits` with structural classifications, rule replay, guarded strength shapes,
  contextual labels and statement footprints.
- Added tests for two nested rule firings in one field, for valid and stale citation tokens, for division
  and remainder shapes, and for correspondence links from an inlined call to its setup statements.
- Ran `node --test tests/typed/edit-classification.test.mjs`. The focused file passed.
- Probed the corpus script on Blend. It reported nine O2 and twelve speed edits and recovered the expected
  fold and simplify rules. This exercised the existing vendor loader, runPipeline, and classifier together.

### What needed attention

- Replacing just a tree root can erase an already-fired child rule from both the final values table and
  correspondence. Table replay captures these firings before comparison with the final tree.
- Intermediate block and statement IDs from a pass may disappear before publication. A record can
  contribute an edit with an empty statement footprint, so the two denominators are counted independently.
- The worktree's Git index was read-only under the sandbox. The design commit used escalation and landed
  as `855657f`. Both the default and dedicated tmux sockets returned `Operation not permitted` under the
  sandbox. The escalated dedicated socket ran the census successfully.

## Step 3. Measure the full corpus

The checked pipelines accepted every application across the 50 projects. The ledger contained 2,021 O2
and 9,736 speed edits. Every changed or moved statement measured by the endpoint audit was accounted for.

### What I did and why

- Ran `01-census.mjs --json` in tmux and rendered the ledger to the checked-in tables.
- Compared the strict definition with a broader one that counts contextual substitutions as local.
  The broader interpretation made local rewrites a majority of value replacements in both pipelines,
  while they remained a minority of all edits and affected statements.
- Joined recovered rule names to evidence strengths and ranked the two guarded power-of-two shapes
  that cover the strict local edits left over from table replay.

### Review path

Start with the definitions and coverage table in the report. For implementation review, read
`classifyEdits` and `classifyEdits`'s tests. The census script also accepts `--from=<ledger.json>` for
rendering existing results.

### Validation environment

The fresh worktree had no npm dependencies installed. `npm ci --cache dist/.npm-cache --fetch-retries=0`
initially failed with `ENOTFOUND registry.npmjs.org`. Retrying with escalation installed all six locked
packages locally, including the esbuild dependency used by the workbench tests.

The final classifier's full edit ledger was byte-identical to the first run. The SHA-256 of the
newline-terminated JSON emitted by `01-census.mjs --json` was
`c2c98378b43f66d6acaa5e08f34e90e692d2ba082ee0002711e907bc791588c9`. Rendering that ledger reproduced
the checked-in tables. The implementation and focused tests were committed as `dfde46d`.

Docmgr flagged the generated Markdown tables because their first copy had no frontmatter. The table
body now lives in a docmgr analysis document. The ticket doctor passed after the move.

## Step 4. Run the requested validation and close the ticket

`npm run build` passed with the locked dependencies installed. In the dedicated tmux session,
`node --test --test-concurrency=2 tests/typed/*.test.mjs tests/framework/*.test.mjs tests/workbench/*.test.mjs`
finished with 410 passed, zero failed and three skips reported by the suites. The run included the
workbench's standalone-site builds. Concurrency was limited because the build-and-test worker shares
the machine with other worktrees.
