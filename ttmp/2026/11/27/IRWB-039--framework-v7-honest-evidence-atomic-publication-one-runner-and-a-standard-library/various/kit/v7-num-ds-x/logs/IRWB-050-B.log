Done. Report below.

## Ticket and report

- Ticket: `ttmp/2026/11/27/IRWB-050-B--stdlib-num-binary32-arithmetic-with-an-explicit-min-max-profile/` (design doc `design-doc/01-…`, diary `reference/01-implementation-diary.md`, probes `scripts/01–05`)
- Report: `ttmp/2026/11/27/IRWB-050-B--stdlib-num-binary32-arithmetic-with-an-explicit-min-max-profile/reference/02-report-stdlib-num-binary32-arithmetic-with-an-explicit-profile.md`

## What changed

- `src/stdlib/num/minmax.ts` (new) — the min/max rule stated once over a representation `FloatOrder<T>` (`isNaN`, total `compare` with -0 below +0, `nan`), with profiles `'minimumNumber'` (a NaN loses) and `'minimum'` (a NaN propagates), plus `NUMBERS` for JS numbers.
- `src/stdlib/num/binary32.ts` (new) — binary32 as bit patterns (`fromBits`/`toBits`/`isNaNBits`/`CANONICAL_NAN`), the bit representation's order `BITS`, and `binary32(profile)`: the arithmetic/sign/rounding/conversion/comparison set moved verbatim from `typed/f32.ts`, min/max from the profile.
- `src/stdlib/index.ts` — re-exports the module; `num/` added to "what exists now".
- `src/typed/f32.ts` — builds `F32_BINARY`/`F32_COMPARE`/`F32_UNARY` from `binary32('minimumNumber')`, re-exports the bit helpers, keeps opcode names, `F32_{RESULT,OPERANDS,FOLDABLE}`, `f32Op`, `formatF32`; old `minmax`/`order`/`round`/`toInt` and every operation implementation deleted. Public surface unchanged (12 importers untouched).
- `src/tensor/evaluate.ts` — `const MINMAX = minmax('minimum', NUMBERS)` used by the `max`/`min` ops and the `max` reduction; `Math.max`/`Math.min` deleted.
- `tests/stdlib/num.test.mjs` (new) — 6 tests: both profiles on the special values for every operation, the disagreeing inputs, both representations against each other, both clients end to end, the bit order.
- `scripts/01-tix-eval-speed.mjs`, `02-num-probe.mjs`, `03-num-speed-compare.mjs`, `04-minmax-cost.mjs`, `05-minmax-shapes.mjs` (new).

## Acceptance results (re-measured on the last commit)

- My tests: `tests/stdlib/num.test.mjs` 6/6 pass; `tests/stdlib` 13/13. `max(NaN,7)` = 7 under `minimumNumber`, NaN under `minimum`; `max(-0,+0)` = +0 and `min(-0,+0)` = -0 under both; payloaded NaN, ±inf, subnormals covered per operation.
- Baselines: `02-baselines.mjs check` → **`no differences`** (RV32 images/bytes/instruction counts/edit census under r0/O2/speed, and every Tix CUDA source and `optimizeTix` revision, byte-identical).
- Suites: typed 188 (186 pass, 2 env-gated skips, 0 fail), framework 243/243, workbench 25 (24 pass, 1 skip, 0 fail), stdlib 13/13, tensor minus `*-gpu` 45/45. No existing assertion changed.
- `npm run check` clean; `node tools/build-site.mjs` builds (400 ms, 131 source files); `format:check` warns on the same 9 pre-existing files, none touched.
- Tix evaluator speed (interleaved before/after builds, CPU-time minima over 7 rounds × 30 samples): softmax 64×256 and attention 32×64×64 at f32 and f64 are **1.02×–1.30×** of the old time, with outputs bit-identical; the ratio's spread within a run is as wide as the effect. The primitive itself is 13.3 ns/pair vs `Math.max`'s 2.4 ns/pair, and a plain hand-written arrow measures 11.4–17.5 ns/pair — the cost is the JS call, not the profile.

## Left out / disagreements with the brief

- `src/stdlib/index.ts`'s later-modules list (from IRWB-046-B) reserves `num/` for *exact small-number helpers (saturating/wrapping arithmetic)*, and the IRWB-039 design doc never mentions a binary32 `num`. This step takes the name; the integer helpers now need a sub-name. Flagged, not silently renamed.
- Only min/max is genuinely shared: Tix's arithmetic is `Math.fround(a op b)` (f32) or the raw double (f64), i.e. a precision flag, so it stays in the evaluator; the moved arithmetic has one client (Typed). No `src/stdlib/check/` law module — the admission rule's executable test is the test file.
- Rejected and reported: `'minimum'` over `NUMBERS` implemented as `Math.max` itself (would be 5× faster on the primitive but the representation would bypass the rule under test).

Last commit: **`3d3940c`** (`7f1bf4f` = code + tests, `e3705f0` = ticket, docs, probes).
