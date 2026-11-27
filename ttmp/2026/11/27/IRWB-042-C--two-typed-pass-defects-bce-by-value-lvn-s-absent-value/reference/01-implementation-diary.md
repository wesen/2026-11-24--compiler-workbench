---
Title: Implementation diary
Ticket: IRWB-042-C
Status: active
Topics:
    - compiler
    - typed
    - passes
    - framework-v7
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/typed/passes.ts
      Note: bce compares SSA names (F36); lvn drops the entries a firing rebuilds (F38)
    - Path: tests/typed/d2-defects.test.mjs
      Note: F36 and F38 without todo
ExternalSources: []
Summary: 'Chronological record of the two fixes: bce compared reaching-definition sets (F36), lvn replaced a value a firing had already rebuilt (F38).'
LastUpdated: 2026-11-27T18:00:00-05:00
WhatFor: 'Review of this step: what was reproduced, what was measured, what was changed and why.'
WhenToUse: When reviewing IRWB-042-C, or before touching bce or lvn again.
---

# Implementation diary — IRWB-042-C (F36, F38)

Ticket `ttmp/2026/11/27/IRWB-042-C--two-typed-pass-defects-bce-by-value-lvn-s-absent-value/`.
Both defects were found by IRWB-037-G and written up there as `todo` tests of the correct behaviour
(`tests/typed/d2-defects.test.mjs`, IRWB-039 phase 1a).

## Step 1: reproduce both, and the baseline

- `npm run build`, then `node --test tests/typed/d2-defects.test.mjs`: F36, F37 and F38 are todo and fail as
  documented (F36: `contractRejected … 16/40 sampled cases disagree`; F38: `[absent] v:regexMatch.587 is not used
  in regexMatch at this revision`).
- `node ttmp/2026/11/27/IRWB-039--…/scripts/02-baselines.mjs check` on the unmodified source: `no differences`
  (11m19s wall clock; the machine is shared with other sessions). So the baseline is clean before the fix.

## Step 2: F36 — what the corpus actually needs from bce

The proposed fix is "compare values (SSA names), not definition sets". A stricter reading of the same idea —
"the reaching set must be a singleton, and the same one" — would be wrong for this corpus: a loop counter has
two *may*-definitions at both points (`i = 0` and the back-edge `i = i + 1`), and the two reads are still the
same value in the same iteration.

`scripts/01-bce-sites.mjs` lists every candidate site in the corpus after the passes before `bce` (O2 prefix),
with the reaching sets of the index and the buffer at the branch and at the check, and the SSA name of each
read (`src/typed/ssa.ts`, `uses`):

| criterion | sites it accepts (of 13) |
| --- | --- |
| equal reaching-definition sets (today) | 13 |
| equal sets, both singletons | 0 |
| equal SSA names of the two reads | 13 |

So SSA-name equality keeps every elimination the corpus has, and singleton equality would remove all 13 (13
projects would get slower, which the acceptance forbids). `scripts/02-bce-defect-program.mjs` shows the defect
and the fix on the test's program: `i` reaches both points from `{s:walk.0 s:walk.5}` (equal sets, so the old
rule fires), while the guard reads `i.2` and the check — through the copy `t4 = i` — reads `i.4`.

Implementation: `bce` needs the `ssa` fact (as `guards` already does) and compares `ssa.uses[...]` of the two
index reads and of the two buffer reads; a read the SSA view does not know (an unreachable block) is not
evidence and the pair is skipped. `resolve` only needs to return the value and the local now: its statement id
existed for the reaching-set comparison.

Soundness argument: `tx`/`dom` already require the branch's arm to dominate the check, so every path to the
check runs the branch. The SSA name of a read is the last definition of that local on every path to the read
(with a phi at a join), so equal names mean the same dynamic value at the two points; the guard's `i < len`
therefore holds at the check.

## Step 3: F38 — where the dead value comes from

A temporary `console.error` in `lvn` (reverted; the equivalent check is in `scripts/01`-style form in the diary
below) printed, on regex-nfa's `regexMatch`, `bb:regexMatch.164`:

```
DEBUG fire regexMatch bb:regexMatch.164 key shl(@41,#2)            first v:regexMatch.631@s:regexMatch.246 id v:regexMatch.437 stmt s:regexMatch.246
DEBUG fire regexMatch bb:regexMatch.164 key add(@62,shl(@41,#2))   first v:regexMatch.587@s:regexMatch.246 id v:regexMatch.585 stmt s:regexMatch.251
DEBUG lvn …: first v:regexMatch.587 inUse=false
```

The first firing replaces the `shl` inside `s:regexMatch.246`'s tree. `tx.replace` rebuilds every parent of the
replaced value with a fresh id (`src/typed/tx.ts`), so the `add(@62,shl(@41,#2))` value registered from the same
statement — `v:regexMatch.587` — is dead from that moment, and its key is stale as well. A later statement that
recomputes `add(@62, shl(@41,#2))` matches that stale entry and `tx.replace` throws `absent`. The first lvn of
the pipeline does not hit this shape; the second one does, which is why "a pass is applicable to any revision"
fails here rather than earlier.

Implementation: before a firing replaces anything, `rebuildParents` collects the strict parents (transitively)
of the two values about to be replaced, read from the live store; after the two `tx.replace`s, the `seen`
entries that point at one of those rebuilt values are dropped. Nothing else changes, so a run that does not hit
this shape fires exactly where it did before (no entry can be stale-and-matched without throwing today, and no
other entry is dropped).

## Step 4: the checks

- `node --test tests/typed/d2-defects.test.mjs`'s F36 and F38 pass without `todo`; F37 stays `todo` (not this
  step).
- `scripts/01-bce-sites.mjs` after the fix: the same 13 sites, all accepted by the name rule.
- Baselines, suites, `tsc`, Prettier: see the report.
