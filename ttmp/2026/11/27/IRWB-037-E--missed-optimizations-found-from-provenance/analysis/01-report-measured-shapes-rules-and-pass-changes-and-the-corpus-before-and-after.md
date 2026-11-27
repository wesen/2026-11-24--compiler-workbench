---
Title: 'Report: measured shapes, rules and pass changes, and the corpus before and after'
Ticket: IRWB-037-E
Status: active
Topics:
    - compiler
    - performance
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'Results: regex 6933->6587 (reference 6628), LZ 156782->154700 (reference 156405), chess 10038193->9535352 (reference 10827760), corpus speed -2.0%'
LastUpdated: 2026-11-27T14:00:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: missed optimizations found from provenance

## Method

The baseline was measured first (scripts/01, scripts/02): every corpus project at r0, after O2 and after `speed`,
under default and tuned backend options, against the reference compiler's images on the same seeded cases; and the
three named benchmarks exactly as the tickets of IRWB-013–017 measured them. Then the loop from hot code to rules:

1. **Hot sites with provenance** (scripts/03, scripts/04): one call on the head image with the emulator's
   per-instruction counters, summed per statement site, each site printed with the pass decisions (edit records)
   that touch it and its origin. A site that executes many instructions and whose provenance names no improving
   decision is a missed optimization.
2. **Why no pass fired** (scripts/07–10): the analysis state at the site — the ranges the analysis gives, the
   widening steps that produced them (a logging widen through the framework's `solve`), what remains after the
   pass in question.
3. **Verify and measure**: each candidate became a verified rule or a checked pass change; after implementing,
   the same measurements were re-run and the attribution tool re-run to name the decisions that delivered the
   gain.

## Shapes found, with their instruction counts

**S1 — duplicate bounds checks** (regex first). The regex matcher's `speed` head executed 346 instructions in
four `if (state >=u 9)` / `if (first >=u 9)` / `if (second >=u 9)` trap checks that a dominating *identical*
check had already proved (sites s:144, s:162, s:242, s:247 in the head listing, `scripts/listing-regex-speed.txt`).
Their provenance named only `cfg: retarget` and `licm: replace`. `bce` recognized only a dominating `lt`/`ge`
*branch* against a loaded length — the front end's constant-length checks (`geu` against a constant) never
matched. The same shape appears corpus-wide (`sort`, `histogram`, `bytecode-vm`, LZ's hash-table stores).

**S2 — widening collapses loop counters** (chess first). `s:chessPseudoMoves.38`
`chessSquare_dense + ((chessSquare_dense / 8) << 3)` executed 860,800 instructions with the division intact;
provenance: inline, cfg, simplify. `scripts/07` showed the ranges analysis gives `[MIN, 63]` at the dividend, so
`strength` never fires. `scripts/09` traced the cause: the loop head's interval for `dense` widens `[0,2] →
[0, MAX]` (standard widening), `dense + 1` then overflows the interval (`evalRange`'s `fits` returns full on any
out-of-range bound), and the head joins `[MIN, MAX]` — although the guard `dense >= 64` bounds it by 64.

**S3 — shift pairs where one mask suffices** (chess, once S2 is fixed). `(x >>> k) << k` is `x & ~((1<<k)-1)`;
`x - ((x >>> k) << k)` is `x & ((1<<k)-1)`. On the chess head these shapes run at 860,800 + 200,256 executions
(after strength produces them), each two or three instructions where one suffices. No rule covered them, and
`strength` emitted the *arithmetic* `shr`, for which no unconditional identity exists.

## Rules and pass changes added, with verification and gains

1. **`typed.ranges` v2: widening up to the guard constants** (`src/typed/analyses.ts`). A bound that moves climbs
   only to the smallest constant that some branch of the same function compares the local with; `dense` widens to
   `[0, 64]`, `dense + 1` no longer overflows, and the body keeps `[0, 63]`. Sound because any superset of the
   joined interval is a sound fact; terminating because the threshold ladder is finite. `facts-check` (ranges
   against executions) passes. Gains: `strength` and `bce` now fire where loop counters are involved —
   chess `strength: replace −14,322` and `strength: indirect, frame −3,129` (fewer division checks in the image)
   on the measured call.
2. **Framework: `widen` receives the region context** (`solver.ts`, `analysis.ts`). `transfer`, `boundary` and
   `edge` already receive it; the thresholds are per-function data, so without the context a widening must be
   context-free. This is the only framework change; the dataflow tests and the site build pass unchanged.
3. **`strength` emits `shru`** instead of `shr` (`src/typed/passes.ts`), valid under its own x ≥ 0 proof, so the
   mask rules apply to its output. Checked as every pass (meaning contract per application; parity clean).
4. **Two verified rules** (`src/typed/rules/simplify.ts`): `shl-shru-mask` (`(x >>> k) << k → x & ~((1<<k)-1)`)
   and `sub-shl-shru-mask` (`x - ((x >>> k) << k) → x & ((1<<k)-1)`), guarded by a new `shift` guard
   (k ∈ [0, 31]; for k ≥ 32 the evaluator masks the count and the identity fails — without the guard the verifier
   rejects the rule with a counterexample). The rule DSL gained the guard, the `lowMask`/`highMask` constant
   forms (`form.ts`, `compile.ts`, `semantics.ts`) and the repeated-constant-variable pattern
   (`kv(k)` twice means the same constant). Both rules verify **sound, strength `reduced-width+argument`**
   (structural, exhaustive-w8 2,048 cases, random-32 1,000,048 cases; `exhaustive-32` n/a: more than 2^32
   assignments); the records are in `rules/evidence.ts`, generated by `scripts/11`. Firings on the corpus
   (O2 + speed, `scripts/12`): `shl-shru-mask` fires 3 times (the chess shapes); **`sub-shl-shru-mask` never
   fires** — kept as the verified pair identity, an honest negative result. Gains: chess
   `simplify: replace −165,314` (160 groups) on the measured call; the corpus's never-firing simplifier rules drop
   from 18 of 27 to 14 of 29.
5. **`bce`: a dominating identical check proves the check** (`src/typed/passes.ts`). In the existing dominator
   walk, a `br_if(geu(idx, len))` with a trap target proves `idx <u len` on its non-trapping arm; when that arm
   dominates the later check, the index local has the same reaching definitions, and the length is the same
   constant (or the same buffer with the same reaching definitions), the later check is removed. Constant lengths
   (the front end's `Int32Array(9)`-style checks) are now recognized as lengths at all. No ranges needed — the
   unsigned comparison proves non-negativity. The equal-reaching-sets argument is the same one the existing
   `lt`-branch case uses; the meaning contract (mutation-scored case generation, IRWB-005) gates every
   application, and corpus parity is clean. Gains: regex `bce −346` (the whole step, exactly the measured shape);
   LZ `bce −44` on the measured fixture; chess `bce −5,734`.
6. **`speed` runs `simplify` after `strength`** (`src/typed/passes.ts`), so the mask rules fire in the pipeline
   that is ours; O2 and O2+ stay exactly as the book defines them. The two book-anchored tests that pin `speed`'s
   composition (inline.test.mjs) and the book's O2 instruction table (backend.test.mjs: sort O2 2022 → 1932,
   now faster than the book's own measurement) were updated with the reason recorded.
7. **`attributeSteps` gained a `limit` option** (`src/typed/attribute.ts`, `tools/attribute.mjs --limit`): D1's
   attribution refused any call longer than the emulator's default 2e5 steps, so the chess search (14.2M) could
   not be attributed at all — exactly the "extend it where it falls short" case. With `--limit 3e7` the whole
   chess chain attributes; the attribution test still passes.

## Instructions per corpus project, before and after

Summed over the seeded cases (10 per function, seed 7). Full tables: `scripts/baseline.json` (before) and
`scripts/after.json` (after). Highlights (tuned options, `speed`):

| project | before | after | reference |
| --- | ---: | ---: | ---: |
| regex-nfa | 28,128 | 27,312 | 34,041 |
| lz-roundtrip | 28,330 | 27,974 | 28,499 |
| chess-search | 297,382 | 283,739 | 334,902 |
| sha-chacha | 107,102 | 106,780 | 136,109 |
| bytecode-vm | 24,750 | 24,593 | 28,889 |
| histogram | 2,000 | 1,690 | 2,036 |
| heat-lab | 7,996 | 7,648 | 6,758 |
| sort | 4,563 | 4,365 | 3,898 |

**No project regressed** under any pipeline × backend-option combination (checked pairwise over all 50 projects).
Corpus totals (tuned options): `speed` 792,800 → **776,650** (−2.04%), now 11.3% below the reference's 875,417;
O2 1,032,485 → **1,028,932** (−0.34%).

## The three benchmarks, before and after (`scripts/02`)

| benchmark | r0 | before | after | reference | change |
| --- | ---: | ---: | ---: | ---: | ---: |
| regex, one call, default options | 8,183 | 6,933 | **6,587** | 6,628 | −5.0%; now 0.6% *below* the reference |
| LZ, 100 seed-7 cases, tuned | 178,278 | 156,782 | **154,700** | 156,405 | −1.3%; now 1.1% below the reference |
| chess, quiet-mate-in-two, tuned | 14,152,069 | 10,038,193 | **9,535,352** | 10,827,760 | −5.0%; 11.9% below the reference |

Before this stage the regex matcher ran 8,040 against the reference's 6,628 (IRWB-015), then 6,933 after D1's
per-header loops; the LZ compressor ran 157,682 against 156,405 (IRWB-014). Both now beat the reference compiler;
chess extends its lead from 7.3% to 11.9%.

## What was measured and what was only argued

Measured: every number above (emulator instruction counts); rule firings (`scripts/12`); rule verification
(verifier output recorded in `rules/evidence.ts`); parity (50 projects, 8,286/8,286 decided cases agree,
0 failures); the test suites `tests/typed` (all pass), `tests/framework` (all pass), `tests/workbench`
(all pass), and `tools/build-site.mjs` (builds). Argued only: the soundness of threshold widening (a
set-inclusion argument, not formally checked) and the equal-reaching-sets argument `bce` shares with its
existing case — both are empirically gated by the meaning contract on mutation-scored cases, not proven.

## What was left out, and why

- `shl(shru(x, a), b)` with a ≠ b (chessDense's `(x / 16) << 3`): `(x >>> (a−b)) & ~((1<<b)−1)` saves no
  instructions (two before, two after), so the extra rule machinery does not pay.
- The arithmetic `shr` forms of the mask identities: unsound in general (sign extension), and no corpus shape
  needs them now that `strength` emits `shru`.
- BCE for two *different* buffers whose lengths are both 9: needs a value analysis the pass does not have;
  the constant-length case (what the corpus actually contains) is covered.
- Rule discovery against the reference compiler's *images* (diffing its code against ours): the regex gap was
  already explained exactly by provenance (346 measured vs a 305 gap), so the heavier machinery was not needed.
