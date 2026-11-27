---
Title: 'Report: two Typed pass defects (F36, F38)'
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
Summary: bce accepted equal reaching-definition sets as proof of equal index values (F36); lvn replaced a value that a firing of the same block had already rebuilt (F38). Both fixed in src/typed/passes.ts, both tests lose their todo, baselines unchanged.
LastUpdated: 2026-11-27T18:04:00-05:00
WhatFor: What changed in this step, why, and what the checks say.
WhenToUse: When reviewing IRWB-042-C, or before changing bce's or lvn's decision rule.
---

# Report — IRWB-042-C: two Typed pass defects (F36, F38)

Both defects came from IRWB-037-G ("Found on the way, not changed") and were carried as `todo` tests of the
correct behaviour by IRWB-039 phase 1a. This step fixes both in `src/typed/passes.ts`; nothing outside
`src/typed/` and the tests changed.

## F36: `bce` compared definitions, not values

**Defect.** `bce` removed a bounds check `i >=u buf.length` when a dominating branch proved `i < buf.length`, and
accepted the branch's proof when the index (and the buffer) had the *same set of reaching definitions* at the
branch and at the check. Equal sets do not mean equal values: an assignment between the two points reaches both
of them. In the test's program the only assignment to `i` is `i = i + 1` inside the loop, so `i`'s set at the
header (`{i = 0, i = i + 1}`) and at `buf.charCodeAt(i)` are the same, while the values differ whenever the
`if` was taken. The pass removed the check and only the meaning contract rejected it (16 of 40 cases).

**Fix.** The index and the buffer must be the *same value* at the branch and at the check: the two reads' SSA
names must be equal (`ssa.uses`, the analysis IRWB-037-G added to `src/typed/ssa.ts`; `bce` now declares
`ssa` as a need, as `guards` already does). A read the SSA view does not know (an unreachable block) is not
evidence and the pair is skipped. `resolve` no longer returns the statement id it needed only for the old set
comparison.

**Why SSA names and not a stricter rule over the sets.** The obvious strengthening — "the set must be a
singleton, and the same one" — is *wrong* for this corpus: a loop counter has two may-definitions at both
points (`i = 0` and the back-edge increment) and the two reads are still the same value in the same iteration.
`scripts/01-bce-sites.mjs` classifies all 13 candidate sites in the corpus:

| criterion | sites accepted (of 13) |
| --- | --- |
| equal reaching-definition sets (before) | 13 |
| equal sets, both singletons | 0 |
| equal SSA names (after) | 13 |

So the singleton rule would have removed every bounds-check elimination on the corpus (13 projects slower, which
the acceptance forbids), and the name rule keeps them all. `scripts/02-bce-defect-program.mjs` shows the defect
and the fix on the test's program: `i` reaches the guard and the check from `{s:walk.0 s:walk.5}` (equal sets),
while the guard reads `i.2` and the check — through the copy `t4 = i` — reads `i.4`; `bce` now leaves the check
and is accepted.

**Soundness.** `bce` already requires the branch's arm to dominate the check, so every path to the check runs
the branch. The SSA name of a read is the last definition of that local on every path to the read (a phi at a
join), so equal names at the two points mean the same dynamic value there; the branch's `i < len` therefore
holds at the check, and the range fact still supplies `i ≥ 0`.

**The simplest alternative** would have been to compare the two *read* value ids `cond.args[0]` and `c.args[0]`
directly, with no new need. It fires on nothing: two reads of one local are two value ids even when nothing was
assigned between them. SSA names are the framework's existing answer to "which value is this read".

## F38: `lvn` replaced a value a firing had already rebuilt

**Defect.** A second `lvn` before `rotate` on regex-nfa threw `[absent] v:regexMatch.587 is not used in regexMatch
at this revision` (`src/typed/tx.ts`). In `regexMatch`'s block `bb:regexMatch.164`, the statement `s:regexMatch.246`
computes `add(@62, shl(@41, 2))`; `lvn` registers the `shl` under its key, then finds the same `shl` twice in that
statement and fires on it. A firing calls `tx.replace`, which rebuilds *every parent* of the replaced value with
fresh ids (`src/typed/tx.ts: replace` → `rewrite`). The `add(...)` value registered from the same statement
(`v:regexMatch.587`) is dead from that moment, and its key is stale too. A later statement that recomputes the
same `add(...)` matches the stale entry and `tx.replace` throws. The first `lvn` of the pipeline never produces
this shape; the second one does — which is why the pass was not applicable to that revision.

**Fix.** Before a firing replaces anything, `rebuildParents` collects the strict parents, transitively, of the two
values about to be replaced (read from the live store, since the rebuild has not happened yet); after the two
`tx.replace`s the `seen` entries that point at one of those rebuilt values are dropped. Nothing else changes: an
entry can only be stale *and* matched where the pass throws today, so a run that does not hit this shape fires
exactly where it did before, and no valid entry is lost.

**Alternatives considered.** (a) Clear `seen` after each firing — correct, but loses every sharing later in the
block after a firing (a real change in what the pass does on the corpus). (b) Collect all matches from one scan
and apply them in a single `tx.rewrite` — the walk only sees the rebuilt ids of parents, so pairs whose
representative is the parent of another pair's value silently stop matching; a bigger change to what `lvn` does.
(c) Recompute the block's `seen` map after each firing (rescan) — correct and simple, but quadratic; dropping the
few rebuilt entries is the same result for the cost of one parent walk per firing.

## What changed, file by file

| file | change |
| --- | --- |
| `src/typed/passes.ts` | `bce`: `ssa` as a need; compares `ssa.uses` of the two index reads and of the two buffer reads instead of reaching-definition sets; `resolve` returns only the value and the local |
| `src/typed/passes.ts` | `lvn`: `rebuildParents` (new helper above `strength`) and one line after a firing that drops the `seen` entries pointing at rebuilt values |
| `tests/typed/d2-defects.test.mjs` | F36 and F38 lost their `todo` (assertions unchanged); the header says F37 is still a todo |
| `ttmp/…/IRWB-042-C--…/scripts/01-bce-sites.mjs` | probe: every bce candidate site in the corpus, its facts, and what each candidate criterion accepts |
| `ttmp/…/IRWB-042-C--…/scripts/02-bce-defect-program.mjs` | probe: the test's program — equal reaching sets, different SSA names, and `bce` before/after |
| `ttmp/…/IRWB-042-C--…/reference/01-implementation-diary.md` | the chronological record |

## Checks

| Check | Result |
| --- | --- |
| `node --test tests/typed/d2-defects.test.mjs` (F36, F38) | 2 pass, 0 fail, 0 todo (F37 still todo) |
| `node ttmp/…/IRWB-039--…/scripts/02-baselines.mjs check` | `no differences from …/main.json` (`various/03-baselines-check.log`) |
| `node --test tests/typed/*.test.mjs` | 188 tests, 185 pass, 0 fail, 2 skipped, 1 todo (F37) (`various/04`) |
| `node --test tests/framework/*.test.mjs` | 242 tests, 238 pass, 0 fail, 4 todo (R3's other steps) (`various/05`) |
| `node --test tests/workbench/*.test.mjs` | 25 tests, 24 pass, 0 fail, 1 skipped (`various/06`) |
| `node --test tests/tensor/*.test.mjs` (no `*-gpu`) | 45 tests, 44 pass, 0 fail, 1 todo (F27) (`various/07`) |
| `npm run check` (tsc) | clean |
| `npx prettier --check src/typed/passes.ts` | clean |

**Baselines.** No difference in RV32 image hash, byte size, instruction counts (seed 7 and the held-out seed
1103) or edit census for any corpus project under r0, O2 and `speed`, and none for the Tix programs. That is
the expected result: `bce` accepts the same 13 sites it accepted before (`scripts/01`), and `lvn`'s only change
is on entries it would have thrown on, which no pipeline in the baselines reaches.

## Later

- The second `lvn` before `rotate` is now applicable but is not added to `speed`: IRWB-037-G measured 1,010
  instructions on five projects and a pipeline list that the tests pin. That is a separate decision about the
  pipeline, not a pass defect.
- F37 (`typed.ranges` loses an outer counter's bound under an inner loop) remains a `todo` and belongs to
  IRWB-043-A.
- Nothing was left out of the brief. One point of the brief's wording: the "equal set of reaching definitions"
  framing also suggests that *set equality* was the only unsound part; the account above is that the sets are
  fine as a may-analysis, but they are not a value identity, and the framework's value identity is the SSA name.
