---
Title: Implementation diary
Ticket: IRWB-037-E
Status: active
Topics:
    - compiler
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'Chronological record: baseline, probes, design, implementation, verification, measurements'
LastUpdated: 2026-11-27T14:10:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary, IRWB-037-E

## Step 1 — Baseline and the loop from hot code to provenance

The task: find hot executed instructions whose provenance shows no rule or pass improving them (the regex gap
first), turn the shapes into verified rules or checked pass changes, and measure. Measured first, before any
change (`scripts/01-baseline.mjs`, `scripts/02-benchmarks.mjs`):

- regex `[a-c]*[b-d]*a*d` over `abccabbd`: r0 8,183 / speed 6,933 (8,040 before D1's fix) / reference 6,628;
- LZ, 100 seed-7 `roundTrip` cases, tuned options: r0 178,278 / speed 156,782 / reference 156,405;
- chess quiet-mate-in-two depth 3, tuned: r0 14,152,069 / speed 10,038,193 / reference 10,827,760;
- every corpus project at r0 / O2 / speed × default / tuned options, plus the reference images (`baseline.json`).

Built the hot-site probe (`scripts/03`, `scripts/04`): per-statement executed instruction counts on the head
image, each site with the edit-record provenance of every revision. Found the three shapes of the design: four
duplicate `>=u` checks in the regex head (346 instructions, provenance: only cfg retarget and licm replace);
chess `chessSquare_dense / 8` at 860,800 executions with the division intact; `(x >>> k) << k` shift pairs with
no covering rule.

## Step 2 — Why no pass fired, and the design

`scripts/07` printed, for every power-of-two div/rem at `strength`'s input, the range the analysis gives:
chessPseudoMoves.38's dividend was `[MIN, 63]`. `scripts/08` localized the loss to the loop head; `scripts/09`
(a logging `widen` through the framework's `solve`) showed the mechanism: the head widens `dense` from `[0,2]`
to `[0, MAX]`, then `dense + 1` overflows the interval and `evalRange` returns full, and the head joins
`[MIN, MAX]` — the guard constant 64 was in the function all along. Also noticed D1's `attributeSteps` refused
the chess call entirely (its `runImage` default limit 2e5 < 14.2M).

Wrote the design (committed `51b82ff`): threshold widening in `typed.ranges` v2 with the region context handed
to `widen` (one framework change); `strength` emits `shru`; two verified mask rules with a `shift` guard;
`bce` accepts a dominating identical check and constant lengths; `simplify` after `strength` in `speed`;
`attributeSteps` gains a `limit`. Alternatives rejected in the design: saturating interval arithmetic (unsound
under wraparound), an induction-variable analysis (more machinery than the guard constants), strength emitting
the mask itself (escapes rule verification).

## Step 3 — Implementation

- `src/framework/dataflow/solver.ts`, `analysis.ts`: `widen(previous, next, block, context)`; the region context
  is passed through. All framework tests pass unchanged.
- `src/typed/analyses.ts`: `typed.ranges` v2 with `widenTo` (climb to the smallest guard constant at or beyond
  the moved bound) and per-function threshold collection (cached per store).
- `src/typed/passes.ts`: `strength` emits `shru`; `bce` recognizes constant lengths and a dominating identical
  `geu` check (the non-trapping arm must dominate; same reaching definitions; same constant or same buffer);
  `speed` runs `simplify` after `strength`.
- `src/typed/rules/`: the `shift` guard, `lowMask`/`highMask` constant forms, and the repeated `kv(k)` (the same
  constant) across `form.ts`, `compile.ts`, `semantics.ts`, `verify.ts` (domain 0..w−1 at width w, and a
  width-independence argument for the reduced-width strength); the two rules in `simplify.ts`.

Failure recorded: the first rule draft had no `shift` guard; without it the rules are wrong for k ≥ 32 (the
evaluator masks shift counts), and the verifier would reject them — the guard is what makes them verifiable.
The first evidence-record merge (`scripts/11`) corrupted `rules/evidence.ts` by inserting before the wrong
`} as const;` (the `EVIDENCE_OPTIONS` line, not the table's end); restored from git and fixed the marker.

## Step 4 — Verification and measurement

`scripts/11` verified both rules with the evidence options (structural, exhaustive-w8 2,048, random-32 1,000,048;
exhaustive-32 n/a: more than 2^32 assignments) and recorded them: both **sound, reduced-width+argument**.
`scripts/12` counted firings: `shl-shru-mask` 3 on the corpus (the chess shapes), `sub-shl-shru-mask` 0 — kept,
reported as a negative result. Parity: 50 projects, 8,286/8,286 decided cases agree, 0 failures. Tests: all
`tests/typed`, `tests/framework`, `tests/workbench` pass; `tools/build-site.mjs` builds. Two book-anchored
tests updated with reasons: `inline.test.mjs` (speed is O2+ with the inserted simplify) and `backend.test.mjs`
(sort's O2 is now 1932, below the book's 2022).

Results (see the report for the full tables): regex 6,933 → **6,587** (reference 6,628 — the gap is closed and
inverted); LZ 156,782 → **154,700** (reference 156,405); chess 10,038,193 → **9,535,352** (reference 10,827,760);
corpus `speed` tuned total 792,800 → **776,650** (−2.04%), no project regressed under any combination.
Attribution after: regex `bce −346` (exactly the measured shape); chess `strength −17,451`, `simplify −152,832`,
`bce −5,734`; LZ `bce −44` on the fixture. The extended `attributeSteps` (`--limit 3e7`) produced the chess
table that names these decisions.

## Step 5 — Bookkeeping

Report written (`analysis/01-…`), this diary, changelog and tasks updated, scripts 01–12 committed in the order
written. Remaining work is listed in the report's "left out" section (two-exponent shifts, arithmetic-shr
identities, cross-buffer length equality, reference-image diffing) with the reason each does not pay.
