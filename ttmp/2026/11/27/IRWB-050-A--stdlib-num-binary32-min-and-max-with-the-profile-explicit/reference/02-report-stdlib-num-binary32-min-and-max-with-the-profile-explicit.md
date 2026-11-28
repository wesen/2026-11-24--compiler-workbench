---
Title: 'Report: stdlib num — binary32 min and max with the profile explicit'
Ticket: IRWB-050-A
Status: complete
Topics:
    - compiler
    - ir
    - typescript
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T21:40:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: `stdlib/num` — binary32 min and max with the profile explicit

## What changed

- `src/stdlib/num/minmax.ts` (new): the IEEE 754-2019 min/max family as four **named operations** —
  `maximumNumber`/`minimumNumber` (the RV32F profile Typed follows: the other operand on one NaN,
  NaN on two, −0 below +0) and `maximum`/`minimum` (the JavaScript profile Tix follows: NaN
  propagates; otherwise exactly `Math.max`/`Math.min`). Values are carried as JS numbers; the
  operations never round, so one implementation serves binary32 and Tix's binary64 mode.
- `src/typed/f32.ts`: `F32_BINARY.fmin/fmax` call the library across the existing bits↔number
  boundary (`toBits(minimumNumber(fromBits(a), fromBits(b)))`); the bit-level `order`/`minmax`
  helpers are deleted. The boundary is exact for non-NaN f32 and canonicalizes NaN, so RV32F
  behaviour — including operand bits, NaN payloads and the sign of zero — is unchanged.
- `src/tensor/evaluate.ts`: the ops table maps `max: maximum, min: minimum` and the `max` reduction
  calls `maximum(acc, x)`; the direct `Math.max`/`Math.min` calls are deleted. The remaining
  `Math.max`/`Math.min` in `src/tensor` are integer-domain (block extents, fusion depth, text
  scraping) and out of scope.
- `src/stdlib/index.ts`: exports the four operations; `num/` moves from "Later modules" to "What
  exists now".
- `tests/stdlib/minmax.test.mjs` (new): every operation on every ordered pair of the binary32
  special values in both argument orders (the JavaScript profile bit-exactly against
  `Math.max`/`Math.min`, so Tix's behaviour is pinned, not approximated), the two brief-named cases
  (`max(NaN, 7)`: 7 under `maximumNumber`, NaN under `maximum`; `max(-0, +0)`: +0 under both), the
  equal-zeros sign cases, and both clients through their own representations (Typed bit patterns
  with NaN payloads and the canonical NaN; Tix tensors, elementwise and in a reduction).
- Ticket `scripts/01-evaluator-speed.mjs` and `scripts/02-minmax-micro.mjs`: the speed probes
  (before/after; see below).

The trap the step exists for is closed structurally: there is no unqualified `max` to call — a
client must name the IEEE operation, and the two names disagree on NaN by construction.

## Scope decision (why only min/max)

"Binary32 arithmetic" narrows to the min/max family as the movable code: Tix's ops table is
precision-generic (it rounds outside the op), so a library binary32 add that rounds internally —
the only behaviour worth moving — would break its f64 mode, and one that does not is `a + b` itself;
Typed would then be the only client of a number-level add, failing the admission rule (two clients).
The family with the rule IEEE leaves open is exactly where the two compilers disagree.

## Acceptance results (on the last commit)

- My tests: `tests/stdlib/minmax.test.mjs` — 5 tests, 5 pass.
- Baselines: `node ttmp/2026/11/27/IRWB-039--.../scripts/02-baselines.mjs check` → **no differences**
  (RV32 images, instruction counts, edit records, Tix revisions and CUDA byte-identical).
- Suites: `tests/typed` 186 pass / 2 skipped / 0 fail; `tests/framework` 243 / 0 / 0;
  `tests/workbench` 24 pass / 1 skipped / 0 fail; `tests/stdlib` 12 / 0 / 0; `tests/tensor`
  (non-gpu) 45 / 0 / 0. No existing assertion was weakened or changed.
- `npm run check` (tsc --noEmit) clean; `npm run format:check` clean on every file this step
  created or changed (the 9 files it warns about were already unformatted and are untouched here);
  `node tools/build-site.mjs` builds (src/stdlib changed).

## Speed (Tix's evaluator runs inside every meaning check)

- Probe 01, `evaluate` on the corpus program `attention` (f32, the `max` reduction), best per run
  over 9 batches of 5: **before 128–140 ms, after 125–187 ms** (three invocations each; the machine
  is shared, medians swing ±50 %). Best-case run time is unchanged within noise; the max path is
  ~1k of ~100k+ operations per run, so this probe bounds the total effect.
- Probe 02, per-call at a monomorphic call site (identical loop shapes, best of 7, two
  invocations): `maximum` 7.2/6.3 ns vs `Math.max` 51.1/30.9 ns; `minimum` 35.7/20.2 vs
  `Math.min` 56.0/40.5; `maximumNumber` 36.9/30.9 vs 42.8/38.7; `minimumNumber` 31.9/24.2 vs
  37.2/36.5. All deltas negative — the explicit functions inline where the builtin indirection
  does not. Honest reading: **no per-call slowdown**; the nanosecond scale is the loop overhead's
  order, so the deltas are an upper bound in the library's favour, not a speedup claim.

## Left out / caveats

- No library binary32 add/sub/mul/div/sqrt (scope decision above; would need a per-precision story
  and a second client before admission).
- Typed's remaining f32 semantics (conversions, rounding directions, formatting) stay in
  `src/typed/f32.ts`: they are RV32F target facts with one client, not library algorithms.
- The brief's line references check out (`evaluate.ts` 19-20 and 85 at the base commit); nothing
  in the brief proved wrong.
