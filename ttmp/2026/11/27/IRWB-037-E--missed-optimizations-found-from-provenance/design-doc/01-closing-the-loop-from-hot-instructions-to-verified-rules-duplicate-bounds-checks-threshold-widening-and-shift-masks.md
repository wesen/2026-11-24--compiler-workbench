---
Title: Closing the loop from hot instructions to verified rules: duplicate bounds checks, threshold widening, and shift masks
Ticket: IRWB-037-E
Status: active
Topics:
    - compiler
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'Design: attribute hot executed instructions to pass decisions, find the shapes no rule covers, add verified rules and pass changes, measure'
LastUpdated: 2026-11-27T12:00:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Closing the loop from hot instructions to verified rules

## Goal

Use D1's instruction attribution (`attributeSteps`, `tools/attribute.mjs`) to find hot executed instructions whose
provenance names no rule or pass improving them, turn those shapes into verified rules and checked pass changes,
and measure: the regex matcher first (the one still behind the reference compiler), then LZ, chess, and the corpus
under O2 and `speed`, against the reference compiler.

## Baseline, measured before any change (scripts/01, scripts/02)

| benchmark | r0 | `speed` | reference | gap |
| --- | ---: | ---: | ---: | ---: |
| regex: `regexMatch('[a-c]*[b-d]*a*d', 'abccabbd')`, default backend | 8,183 | **6,933** | 6,628 | +305 (4.6%) |
| LZ: 100 seed-7 `roundTrip` cases, tuned backend | 178,278 | **156,782** | 156,405 | +377 (0.24%) |
| chess: quiet-mate-in-two, depth 3, tuned backend | 14,152,069 | **10,038,193** | 10,827,760 | −789,567 (7.3% ahead) |

The regex matcher at `speed` was 8,040 before D1's fix (IRWB-015's diary); D1's per-header loops made it 6,933.
The corpus table per project is in `scripts/baseline.json`.

## Method: hot sites and their provenance

`scripts/03` and `scripts/04` run one call on the head image with the emulator's per-instruction counters, sum the
counts per statement site, and print each hot site with (a) the pass decisions (edit records across revisions) that
touch it and (b) the statement's origin. A site that executes many instructions and whose provenance names no
improving decision is a missed optimization; `scripts/07`–`scripts/10` then ask the analyses why no pass fired.

## Shapes found

**S1 — duplicate bounds checks (regex, corpus-wide).** The regex matcher's hot loop bodies contain up to three
`if (state >=u 9)` trap checks of the *same* index on one path (`current[state] = next[state]; next[state] = 0`
checks `state` three times): sites s:144 (52 instructions), s:162 (38), s:242 (128), s:247 (128) — 346 of the 305-gap
plus margin. Their provenance names only `cfg: retarget` and `licm: replace`. `bce` removes a check only when a
dominating `lt`/`ge` *branch* proved the index below the length; the front end's constant-length checks (`geu` against
a constant, or against a loaded length) never match, so a check dominated by an identical earlier check stays.

**S2 — widening collapses loop counters (chess, corpus-wide).** `s:chessPseudoMoves.38`
`chessSquare_dense + ((chessSquare_dense / 8) << 3)` executes 860,800 instructions; provenance: inline, cfg, simplify
— the division survives. `scripts/07` shows the ranges analysis gives the dividend `[MIN, 63]` at that site, so
`strength` (which needs ≥ 0) never fires. `scripts/09` traces the widening: the loop head's interval for `dense`
widens `[0,2] → [0, MAX]` (standard widening), then `dense + 1` overflows the interval, `evalRange`'s `fits` returns
full, and the head joins `[MIN, MAX]` — the bound that actually holds is `[0, 64]`. The same collapse keeps
`piece / 8` shapes working only where ranges come from loads (`[0, 65535]`), and keeps `bce`'s `≥ 0` side conditions
from holding in more places than they need to.

**S3 — shift pairs where one mask suffices (chess, after S2).** `(x >>> k) << k` (two instructions) is
`x & ~((1<<k)-1)` (one), and `x - ((x >>> k) << k)` (three) is `x & ((1<<k)-1)` (one). On the chess head these shapes
run at 860,800 + 200,256 executions once S2 lets strength produce them. No simplifier rule covers them; `strength`
currently emits the *arithmetic* `shr`, for which no unconditional identity exists.

## Changes, each with its reason

1. **`typed.ranges` v2 — widening up to the loop guards' constants (threshold widening).** The widen callback climbs
   a local's bound only to the smallest constant that some branch of the same function compares that local with
   (sound: any superset of the joined interval is sound; terminating: finitely many thresholds). For `dense` the guard
   is `>= 64`, so the head widens to `[0, 64]`; `dense + 1` no longer overflows and the body keeps `[0, 63]`.
   *Alternative rejected:* saturating `evalRange` on overflow — unsound, `add` wraps. *Alternative rejected:* an
   induction-variable analysis — more machinery for what the guard constants already say.
2. **Framework: the dataflow solver passes the region context to `widen`** (`transfer`, `boundary` and `edge`
   already receive it). The thresholds are per-function data; without the context a widening must be context-free.
   This is the only framework change.
3. **`strength` emits `shru`, not `shr`**, under its own proof that x ≥ 0 (where the two agree); this makes its
   output match the new mask rules.
4. **Two verified simplify rules:** `shl-shru-mask`: `(x >>> k) << k → x & ~((1<<k)-1)` and `sub-shl-shru-mask`:
   `x - ((x >>> k) << k) → x & ((1<<k)-1)`, guarded by a new `shift` guard (k ∈ [0, 31]; without it the rules are
   unsound for k ≥ 32, where the evaluator masks counts). The rule DSL gains the constant forms `{ lowMask: k }` and
   `{ highMask: k }` and the `shift` guard; the verifier's reduced-width argument covers them (the identity holds at
   every width with that width's mask).
   *Alternative rejected:* teaching `strength` to emit the mask directly — moves an algebraic identity into pass
   code and out of the rule verification.
5. **`bce`: a dominating identical check proves the check.** In the existing dominator walk, a `br_if` whose
   condition is `geu(idx, len)` with a trap target proves `idx <u len` on its fall-through; when the index local has
   the same reaching definitions at both sites and the length is the same constant (or the same loaded length), the
   later check is redundant. No ranges needed — the unsigned check proves non-negativity itself.
6. **`speed` runs `simplify` after `strength`** so the new rules fire in the pipeline that is ours (IRWB-003's);
   O2 and O2+ stay exactly as the book defines them.

## Verification

- Each new rule is verified by `rules/verify.ts` once for all inputs (the rules test asserts every rule sound).
- Every pass change is checked as passes are now: the meaning contract against r0 on generated cases per
  application, preservation claims checked, correspondence intact.
- `tools/parity.mjs` over the corpus at the end; `tests/typed`, `tests/framework`, `tests/workbench` before the
  last commit; `tools/build-site.mjs` still builds (a framework file changed).

## What is measured and what is only argued

Measured: the three benchmarks before/after; the corpus per project under O2 and `speed` (default and tuned options)
before/after, against the reference compiler's images on the same cases; per-shape instruction counts from the
emulator's counters. Argued only: soundness of threshold widening (a set-inclusion argument, stated above, not
formally checked) and the width-independence argument the rule verifier records for the mask rules.
