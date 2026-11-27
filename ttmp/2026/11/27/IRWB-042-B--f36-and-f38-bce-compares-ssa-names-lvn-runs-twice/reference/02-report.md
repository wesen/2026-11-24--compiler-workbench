---
Title: 'Report: F36 and F38 — bce compares SSA names, lvn runs twice'
Ticket: IRWB-042-B
Status: complete
Topics:
    - compiler
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Report of IRWB-042-B
LastUpdated: 2026-11-27
WhatFor: ""
WhenToUse: ""
---

# IRWB-042-B: F36 and F38 — bce compares SSA names, lvn runs twice

Two Typed pass defects found by IRWB-037-G (its report, "Found on the way, not changed"), fixed in one small step.
Scope: `src/typed/passes.ts` and `tests/typed/d2-defects.test.mjs`. No framework change.

## F36: `bce` kept removing a check that a dominating branch did not prove

`bce` accepted a dominating `i < buf.length` as proof for a later `buf[i]` when the index had the same **set** of
reaching definitions at the branch and at the check (`same` sorted and compared two sets). Equal sets are not
equal values: in the defect's program the only assignment to `i` lies between the two and reaches both, so the
sets are equal while the value changes each time round the loop. `bce` removed the check and only the meaning
contract rejected the pass.

Evidence (`scripts/03-f36-ssa-names.mjs`, `various/07-f36-ssa-names.log`): at the guard (`s:walk.3`) and at the
check's copy `t4 = i` (`s:walk.8`), the reaching set of `i` is `s:walk.0 s:walk.5` at both — but the SSA names
are `i.2` (the loop-header phi) against `i.4` (the if-join phi).

**Fix.** `bce` now needs `typed.ssa` (in place of `reaching`) and compares the **SSA names** of the index and of
the buffer, each resolved through copies (`nameOf`: `t = x` gives `x`'s name; chains of copies included). One
name is one value, so equal names at the branch and at the check mean the check tests exactly what the branch
proved; a phi differs from the branch's name precisely when the value may have changed in between. Two
restrictions kept, one relaxed:

- the branch's index must still be a **direct `get`**, so that `ranges.at(branch, x.imm)` is the interval of the
  value the branch tested (a copy `t = i` at the branch would leave `i` free to change between the copy and the
  branch, and the interval of `t`'s source local would no longer describe the tested value);
- the check's index may still be a copy, and the name chain resolves it without the old `resolve`'s
  single-reaching-definition restriction — strictly more cases, all of them sound by name equality;
- the buffer comparison is names too (the old code compared the reaching sets of the buffer local), so a copied
  buffer (`t = buf; t.charCodeAt(i)` checked against a branch on `buf`) now matches as well.

## F38: a second `lvn` threw `[absent] v:regexMatch.587 is not used`

Why `lvn` referred to a value no longer used: its per-block `seen` map records `{ stmt, value }` per structural
key. A merge replaces two values, and `tx.replace` **rebuilds every tree around the value it replaces** (a value
has one user), so any other `seen` entry whose value is, or sits above or below, one of the replaced values
now names a
dead id — its tree was rebuilt under a new id. The next duplicate of that key then called `tx.replace(deadId)`,
which throws `[absent]`. A pass must be applicable to any revision, so the fix is in `lvn`, not in a pipeline.

Evidence (`scripts/02`, run against a temporarily instrumented build; the logging is not in the committed
source): the second `lvn` on regex-nfa meets exactly one stale entry — `v:regexMatch.587` recorded at
`s:regexMatch.246`, whose tree an earlier merge of the same run rebuilt — and refreshes it to `v:regexMatch.585`
at `s:regexMatch.251` (`various/06-staleness.log`). The id in the old error message is the stale entry's value.

**Fix.** A recorded occurrence is live exactly while its value is still in its statement's tree (statements
never move, and a value has one user), so `live(entry)` checks exactly that; a dead entry's key is refreshed to
the current occurrence (`seen.set(key, { stmt, value })`) instead of a merge with a dead id. (A first sketch
kept the set of replaced ids and looked for one in the recorded value's own subtree; it missed the case where
the replaced value is an ancestor of the recorded one — the rebuild abandons the whole subtree under the
replaced value — so the exact statement-tree check replaced it.) The refreshed entry can still merge with later
duplicates of its key: the second `lvn` on regex-nfa makes 4 edits and saves 296 instructions (31,587 → 31,291
at seed 7, `various/08-second-lvn.log`). Corpus-wide (`scripts/04`): a second `lvn` before `rotate` in `speed`,
and one right after the first in `O2`, on every corpus project — 0 thrown, 0 rejected steps, no project slower,
4 project/pipeline combinations faster (`various/09-second-lvn-corpus.log`).

Left out: a value whose tree was rebuilt under a new id is never re-matched with the rebuilt id — its structural
key changed (the replaced sub-value became a read of the new local `@t`), so matching it would need
copy-equivalence through the hoisted local, not structural keys. One possible extra merge per stale entry; sound
to leave out.

## Acceptance (on the final commit)

| Check | Result |
| --- | --- |
| `F36` and `F38` tests in `tests/typed/d2-defects.test.mjs`, `todo` removed | both pass |
| `02-baselines.mjs check` after `npm run build` | **no differences** (image hashes, byte sizes, instruction counts at both seeds, and the per-pass edit census, for every corpus project under r0, O2 and `speed`; every Tix program's CUDA source and `optimizeTix` revisions) |
| `node --test tests/typed/*.test.mjs` | 188 tests: 185 pass, 0 fail, 2 skipped, 1 todo (F37, another step) |
| `node --test tests/framework/*.test.mjs` | 242 tests: 238 pass, 0 fail, 4 todo (F33-F35, other steps) |
| `node --test tests/workbench/*.test.mjs` | 25 tests: 24 pass, 1 skipped, 0 fail |
| `node --test tests/tensor/*.test.mjs` (no `*-gpu`) | 45 tests: 44 pass, 1 todo (F27, another step), 0 fail |
| `npm run check` | clean |
| `node tools/build-site.mjs` | not run: no `src/framework/` or `src/workbench/` change |

Baseline differences: none, so none to list. Every corpus elimination `bce` made before it still makes — its
corpus cases were genuinely same-value cases, which the SSA names recognize — and no project's instruction count
changed in either direction. `lvn`'s fix cannot change a standard pipeline: a first-run stale entry either is
never matched again (no observable difference) or threw `[absent]` (which no baseline pipeline did).

Files: `src/typed/passes.ts` (`bce`: `nameOf` + needs `ssa`; `lvn`: replaced-id set, `stale`, the refresh),
`tests/typed/d2-defects.test.mjs` (two `todo` options removed). Suite logs in `various/`, probes in `scripts/`.
