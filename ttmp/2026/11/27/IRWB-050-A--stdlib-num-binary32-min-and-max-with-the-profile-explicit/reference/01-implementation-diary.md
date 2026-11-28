---
Title: Implementation diary
Ticket: IRWB-050-A
Status: active
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
LastUpdated: 2026-11-27T20:22:32.203928525-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1 — orientation and the trap

Read `src/stdlib/index.ts` (admission rule R3, layering D, `flow/liveness.ts` as the model module)
and the two clients the brief names:

- `src/typed/f32.ts`: `F32_BINARY.fmin/fmax` through the bit-level `order`/`minmax` helpers —
  RV32F rules (other operand on one NaN, canonical NaN on two, −0 below +0).
- `src/tensor/evaluate.ts`: `max: Math.max, min: Math.min` in the ops table (line 24-25) and
  `Math.max(acc, x)` in the `max` reduction (line 85) — NaN propagates.

The trap is real and checked by hand: `max(NaN, 7)` is 7 under the first rule, NaN under the second;
`max(-0, +0)` is +0 under both (ECMAScript orders −0 below +0, like RV32F). So the extraction must
name the rule, not share an unqualified `max`.

## Step 2 — the speed baseline (probe 01, before any change)

`scripts/01-evaluator-speed.mjs`: `evaluate` on the corpus program `attention` (the one with a `max`
reduction), f32, Q=K=D=V=32, 9 batches of 5 runs, median and best per run. First attempt with
128-sized inputs timed out the 300 s command budget — the evaluator is ~190 ms per 32³ attention
run — so the probe was sized to 32. Three invocations on the unchanged tree:

- median 187997 / 151681 / 122764 µs, best 131.0 / 140.3 / 128.0 ms
- (re-sized probe) median 229063 / 220914 / 219202 µs, best 131.0 / 140.3 / 128.0 ms

The machine is shared and loaded (medians swing ±50 %); best-of-batches is the usable statistic.
Before-state: **best ≈ 128–140 ms per run**.

## Step 3 — the design (see design-doc/01)

Named operations, IEEE 754-2019's own: `maximumNumber`/`minimumNumber` (RV32F profile) and
`maximum`/`minimum` (JavaScript profile), over values carried as JS numbers — the smallest shape
interface, and exact for both compilers' f32 (and Tix's f64, since these ops never round). Rejected
alternatives: a profile object (`max.rv32f` is one rename from `max.js`) and a bit-level interface
(bits are Typed's storage choice; Tix would never call it).

Scope decision: only the min/max family moves. Tix's ops table is precision-generic (rounding
happens outside the op), so a library binary32 add that rounds internally would break its f64 mode,
and one that does not is `a + b` itself — no code to move, and Typed would be its only client,
failing the admission rule. The family with the open choice is exactly the one the brief's trap is
about.

## Step 4 — the implementation

- `src/stdlib/num/minmax.ts` (new): the four operations, each a short explicit function; the module
  comment states both profiles and the NaN case that separates them.
- `src/typed/f32.ts`: `fmin/fmax` become `toBits(minimumNumber(fromBits(a), fromBits(b)))` (and the
  maximumNumber twin); `order`/`minmax` deleted. Exactness argument: the bits↔number boundary is
  exact for non-NaN f32 (f32 ⊂ f64), maps every NaN to the number NaN, and `toBits(NaN)` is the
  canonical NaN — so the other-operand rule keeps exact bits and both-NaN gives `0x7fc00000`.
- `src/tensor/evaluate.ts`: `max: maximum, min: minimum` in the table, `maximum(acc, x)` in the
  reduction; `Math.max`/`Math.min` gone from the f32 semantics.
- `src/stdlib/index.ts`: export line, and `num/` moved from the "Later" list to "What exists now".

## Step 5 — the tests

`tests/stdlib/minmax.test.mjs`, five tests: the full ordered pair grid over the binary32 special
values (±0, ±inf, NaN, smallest/largest subnormal, smallest normal, ±1, 7, largest finite) in both
argument orders for all four operations — the JavaScript profile asserted equal to `Math.max`/
`Math.min` bit-exactly (`Object.is`, so −0 is distinguished), the RV32F profile asserted as the NaN
rule plus the same non-NaN order; the two brief-named cases as explicit tests; the sign-of-zero
equality cases (max(-0,-0) = −0, min(+0,+0) = +0 under both profiles); and both clients through
their own representations (Typed's bit patterns incl. NaN payloads and the canonical NaN; Tix's
tensors elementwise and in a `max(j)` reduction). All 5 pass.

## Step 6 — the acceptance gauntlet

- `tests/typed`: 186 pass, 2 skipped, 0 fail. `tests/framework`: 243 pass, 0 fail.
  `tests/workbench`: 24 pass, 1 skipped. `tests/stdlib`: 12 pass, 0 fail.
  `tests/tensor` (non-gpu): 45 pass, 0 fail.
- Baselines: `node ttmp/2026/11/27/IRWB-039.../scripts/02-baselines.mjs check` → **no differences**
  (RV32 image hashes, instruction counts, edit records, Tix revisions and CUDA byte-identical).
- `npm run check` (tsc --noEmit) clean; `node tools/build-site.mjs` builds (src/stdlib changed).
- Prettier: my four changed/created files pass; the 9 files `format:check` warns about were already
  unformatted before this step and are not mine.

## Step 7 — the speed after (probes 01 and 02)

Probe 01 after the change, three invocations: median 343373 / 317508 / 152786 µs, **best 180.9 /
187.3 / 125.0 ms** — the best-case run time overlaps the before range (128–140 ms), and the max path
is ~1k of ~100k+ operations in one attention run, so the evaluator probe bounds the total effect
rather than resolving it. Probe 02 (`scripts/02-minmax-micro.mjs`, monomorphic call-site loops of
identical shape, best of 7) resolves the per-call question — the library ops are not slower than the
builtins they replace; both invocations give negative deltas:

- maximum 7.2/6.3 ns vs Math.max 51.1/30.9 ns; minimum 35.7/20.2 ns vs Math.min 56.0/40.5 ns;
  maximumNumber 36.9/30.9 vs 42.8/38.7; minimumNumber 31.9/24.2 vs 37.2/36.5.

(The explicit functions inline at the call site where the builtin indirection does not; the
nanosecond scale is of the same order as the loop overhead, so the honest reading is "no per-call
slowdown", not the ratios.) Conclusion: the extraction costs the evaluator nothing measurable.
