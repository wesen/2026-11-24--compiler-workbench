---
Title: Implementation diary
Ticket: IRWB-042-B
Status: active
Topics:
    - compiler
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Diary of IRWB-042-B
LastUpdated: 2026-11-27
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1: reproduce both defects (scripts/01)

- Both reproduce on the built `f99682a` checkout: `bce` on the bce-probe program produced a candidate the meaning
  contract rejected (`16/40 sampled cases disagree`), and a second `lvn` before `rotate` in `speed` on regex-nfa
  threw `[absent] v:regexMatch.587 is not used in regexMatch at this revision`.

## Step 2: F36 — bce compares SSA names (src/typed/passes.ts)

- `bce` accepted a dominating `i < buf.length` when the index had the same *set* of reaching definitions at the
  branch and at the check (`same` sorted and compared the two sets). `scripts/03-f36-ssa-names.mjs` shows why
  that is not equality of values: in the probe's `walk`, the reaching set of `i` is `s:walk.0 s:walk.5` at BOTH
  the guard (`s:walk.3`) and the check's copy (`s:walk.8`) — the only assignment `s:walk.5` lies between the two
  and reaches both — while the SSA names are `i.2` (the loop-header phi) against `i.4` (the if-join phi).
- Fix: `bce` now needs `typed.ssa` (not `reaching`) and compares the **SSA names** of the index and of the buffer,
  each resolved through copies (`nameOf`: `t = x` gives `x`'s name, chains included). One name is one value, so
  equal names at the branch and at the check mean the check tests what the branch proved; phis differ exactly
  when the value may have changed in between. The branch's index must still be a direct `get`, so that
  `ranges.at(branch, x.imm)` is the interval of the value the branch tested (a copy `t = i` at the branch would
  leave `i` free to change between the copy and the branch). The check side may still be a copy: the name chain
  resolves it, which is what the old `resolve` did, but without the single-reaching-definition restriction.

## Step 3: F38 — lvn refreshes a dead `seen` entry (src/typed/passes.ts)

- Why `lvn` referred to a value no longer used: its per-block `seen` map records `{ stmt, value }` per key. A
  merge replaces two values (`tx.replace(first.value, ...)`, `tx.replace(id, ...)`), and `tx.replace` **rebuilds
  every tree around the value it replaces** (a value has one user). Any other `seen` entry whose value is, or
  sits above or below, one of the replaced values now names a dead id — the rebuild made a new id for its tree.
  The next duplicate of that key then called `tx.replace(deadId)` — `[absent]`. This cannot happen on a first
  `lvn` run only by luck of ordering; it is not a property of the first run, so the fix is in `lvn`, not in the
  pipeline.
- Evidence (scripts/02, against a temporarily instrumented build, not in the committed source): the second
  `lvn` on regex-nfa meets exactly one dead entry — `v:regexMatch.587` recorded at `s:regexMatch.246`, whose
  tree an earlier merge of the same run rebuilt — and refreshes it to `v:regexMatch.585` at `s:regexMatch.251`
  (`various/06-staleness.log`). The id in the old error is the dead entry's value.
- Fix: a recorded occurrence is live exactly while its value is still in its statement's tree (statements never
  move, and a value has one user), so `live(entry)` checks that, and a dead entry's key is refreshed to the
  current occurrence (`seen.set(key, { stmt, value })`) instead of merging with a dead id. A first sketch kept
  the set of replaced ids and looked for one in the recorded value's own subtree; it missed the case where the
  replaced value is an ANCESTOR of the recorded one (the rebuild abandons the whole subtree under the replaced
  value), so the exact statement-tree check replaced it. The refreshed entry can merge with later duplicates;
  the second `lvn` on regex-nfa still makes 4 edits and saves 296 instructions (31,587 → 31,291 at seed 7;
  `various/08-second-lvn.log`).
- Corpus-wide (scripts/04): a second `lvn` before `rotate` in `speed`, and one right after the first in `O2`, on
  every corpus project: 0 thrown, 0 rejected steps, no project slower, 4 project/pipeline combinations faster
  (`various/09-second-lvn-corpus.log`).
- A value whose tree was rebuilt under a new id is not re-matched with the rebuilt id (its key changed, since
  the replaced sub-value became `@t`): a possible extra merge left out, listed in the report.

## Step 4: acceptance

- `tests/typed/d2-defects.test.mjs`: F36 and F38 pass with their `todo` removed (F37 stays a todo, another step).
- `node ttmp/.../IRWB-039.../scripts/02-baselines.mjs check` after `npm run build`: **no differences** — bce's
  SSA-name comparison makes the same edits on every corpus project (all its corpus eliminations really are
  same-value cases), and `lvn`'s fix is invisible to the standard pipelines.
- Suites (logs in `various/`): typed 188 tests 185 pass 0 fail 2 skipped 1 todo (F37); framework 242/238 pass,
  0 fail, 4 todo (F33-F35); workbench 25/24, 0 fail, 1 skipped; tensor (no gpu) 45/44, 0 fail, 1 todo (F27).
- `npm run check` clean; `tools/build-site.mjs` not needed (no `src/framework/`, `src/workbench/` change);
  Prettier run on `src/typed/passes.ts` only (the 9 other unformatted files were unformatted before this step).
