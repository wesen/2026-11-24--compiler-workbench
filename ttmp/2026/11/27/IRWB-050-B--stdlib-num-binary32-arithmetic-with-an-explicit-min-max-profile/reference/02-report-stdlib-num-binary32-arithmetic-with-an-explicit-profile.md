---
Title: 'Report: stdlib/num, binary32 arithmetic with an explicit profile'
Ticket: IRWB-050-B
Status: complete
Topics:
    - compiler
    - ir
    - typescript
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/stdlib/num/minmax.ts
      Note: the min/max rule over a representation, with the two IEEE 754-2019 profile names
    - Path: repo://src/stdlib/num/binary32.ts
      Note: binary32 as bit patterns, the operation set, the bit representation's order
    - Path: repo://src/stdlib/index.ts
      Note: re-exports and the "what exists now" line for num/
    - Path: repo://src/typed/f32.ts
      Note: the RV32F client (minimumNumber), opcode tables, folds
    - Path: repo://src/tensor/evaluate.ts
      Note: the Tix client (minimum over numbers), Math.max/Math.min deleted
    - Path: repo://tests/stdlib/num.test.mjs
      Note: the six tests, including the two inputs the profiles disagree on
ExternalSources: []
Summary: "What IRWB-050-B moved into src/stdlib/num, the profile that keeps each client's min/max, the acceptance numbers and the evaluator measurement."
LastUpdated: 2026-11-27
WhatFor: "Reviewing what the num module delivers and what it cost."
WhenToUse: "Before adding an operation to src/stdlib/num, or when questioning the evaluator's min/max rule."
---

# Report: `stdlib/num` — binary32 arithmetic with an explicit profile

## What changed, file by file

- `src/stdlib/num/minmax.ts` (new) — the rule IEEE 754-2019 leaves open, stated once: `minmax(profile, domain)`
  returns `{ min, max }` over a representation `FloatOrder<T>` (`isNaN`, `compare` as a total order with -0 below
  +0, `nan`). Profiles `'minimumNumber'` (a NaN loses to a number; two NaNs give `domain.nan`) and `'minimum'` (a NaN
  propagates). Also `NUMBERS`, the representation for JavaScript numbers.
- `src/stdlib/num/binary32.ts` (new) — binary32 as bit patterns (`CANONICAL_NAN`, `fromBits`, `toBits`, `isNaNBits`),
  that representation's order (`BITS`), and `binary32(profile)`: add, sub, mul, div, sqrt, floor, ceil, trunc,
  saturating `toInt`/`toUnsigned`, `fromInt`/`fromUnsigned`, `neg`, `abs`, `copysign`, six comparisons, min and max
  from the profile. All of it moved from `src/typed/f32.ts`, with min/max routed through `minmax`.
- `src/stdlib/index.ts` — re-exports the module's names and values; "what exists now" gains `num/`.
- `src/typed/f32.ts` — builds `F32_BINARY`/`F32_COMPARE`/`F32_UNARY` from `binary32('minimumNumber')`, re-exports the
  bit helpers; its `minmax`/`order`/`round`/`toInt` and every operation implementation are deleted. Keeps the IR's
  opcode names, `F32_RESULT`/`F32_OPERANDS`/`F32_FOLDABLE`, `f32Op` and `formatF32`. Public surface unchanged, so all
  twelve internal importers and the three Typed tests are untouched.
- `src/tensor/evaluate.ts` — one `const MINMAX = minmax('minimum', NUMBERS)` names the rule; the elementwise
  `max`/`min` operations and the `max` reduction use it. `Math.max`/`Math.min` deleted.
- `tests/stdlib/num.test.mjs` (new) — six tests: each operation under each profile on the special values; the
  disagreed-on inputs; the two representations against each other; the clients end to end; the bit order itself.
- `scripts/01-tix-eval-speed.mjs`, `02-num-probe.mjs`, `03-num-speed-compare.mjs`, `04-minmax-cost.mjs`,
  `05-minmax-shapes.mjs` (new) — the probes: the evaluator's speed, the first behaviour check, the interleaved
  before/after comparison, the primitive's per-pair cost, and an interface-shape measurement that came out in noise.

## The choice the step exists to make explicit

| input | Typed (`'minimumNumber'`, RV32F `fmin.s`/`fmax.s`) | Tix (`'minimum'`, `Math.min`/`Math.max`) |
| --- | --- | --- |
| `max(NaN, 7)` | 7 | NaN |
| `max(-0, +0)` | +0 | +0 |
| `min(-0, +0)` | -0 | -0 |
| both NaN | the canonical NaN `0x7fc00000` | NaN |

Both clients ask the library for their own profile at one place each — `binary32('minimumNumber')` in
`src/typed/f32.ts`, `minmax('minimum', NUMBERS)` in `src/tensor/evaluate.ts` — and the library exports no unqualified
`max`, so a later unification has to delete an argument rather than change a behaviour. That a NaN beside a number is
where they differ is now a stated property of the module, not a coincidence of two call sites.

## Acceptance (on the last commit)

- **Tests**: `node --test tests/stdlib/num.test.mjs` — 6 tests, 6 pass. `tests/stdlib/*.test.mjs` — 13 tests, 13 pass.
  The special values cover the canonical NaN, a payloaded NaN (and its sign-flipped form), ±0, ±infinity, the smallest
  and largest subnormals, the smallest normal and the largest finite f32; each operation is run under both profiles
  and the two are asserted identical except min/max. `max(NaN, 7)` is 7 under `minimumNumber` and NaN under
  `minimum`; `max(-0, +0)` is +0 under both, `min(-0, +0)` is -0 under both.
- **Baselines**: `node ttmp/2026/11/27/IRWB-039--…/scripts/02-baselines.mjs check` (after `npm run build`) prints
  `no differences` — every corpus project's RV32 image hash, byte size, instruction counts at both seeds and per-pass
  edit census under r0/O2/speed, and every Tix program's CUDA sources and `optimizeTix` revisions, unchanged. The
  step changes no generated code and no revision. (The script's informational line, `timing: inline on attention
  0.562 -> 4.343 ms per application`, is its own wall-clock measurement of a Tix pass, which the script never
  compares; this machine was at load average ~10–20 throughout.)
- **Suites**: `tests/typed` 188 (186 pass, 2 skipped, 0 fail — the two Candela/env-gated skips), `tests/framework`
  243 (243 pass), `tests/workbench` 25 (24 pass, 1 skipped, 0 fail), `tests/stdlib` 13 (13 pass), `tests/tensor`
  minus `*-gpu.test.mjs` 45 (45 pass). No existing assertion was weakened or changed.
- **`npm run check`** (tsc) clean. **`node tools/build-site.mjs`** builds (`dist/site built in 232 ms`, 131 source
  files). `npm run format:check` warns on the same 9 files it warned on before this step; none of them is touched here.

## The evaluator's speed, measured

Tix's evaluator runs inside every meaning check (`src/tensor/contract.ts:70`, `:77`, `:149` evaluate the candidate,
the baseline and the cases), so the primitive it calls on every `max`/`min` matters. Two measurements, both with the
pre-change build saved from before the edit and measured alternately with the post-change build (this machine is
shared and noisy):

- **End to end** (`scripts/03-num-speed-compare.mjs`, 7 rounds × 2 builds × 30 timed `runTix` calls per (program,
  precision), CPU time, minima): softmax 64×256 and attention 32×64×64, at f32 and f64, are **1.02×–1.30×** of the
  old time. Within one run the four ratios read 1.04/1.04/1.12/1.02 and in a second run 1.11/1.18/1.09/1.30, i.e. the
  spread of the ratio between two runs of the *same* comparison is about as wide as the effect. The outputs are
  byte-identical in all eight rows (output hashes `5692f27afb399669`, `de29ffc9419d375a`, `6b58145b366734ed`,
  `ac930cff92321f4f`), so the timing compares the same numbers.
- **The primitive** (`scripts/04-minmax-cost.mjs`, 20M pairs, CPU-time minima of 5 rounds): `Math.max` **2.4–2.5
  ns/pair**, the library's `max` **13.3–13.8 ns/pair**, and a plain hand-written `(x, y) => (x < y ? y : x)` arrow
  **11.4–17.5 ns/pair** (it measured both sides of the library's number in two runs). So the profile rule costs
  nothing measurable: the cost is the JavaScript call, which `Math.max` avoids only because V8 inlines its intrinsic.
  `scripts/05-minmax-shapes.mjs` tried a `less`-predicate interface in the hope of cheapening the rule; the shapes
  came out in noise order (a 1.6–2.5 ns/pair band), so the clearer `compare` interface stayed.

Rejected on principle, not on speed: making `'minimum'` over `NUMBERS` return `Math.max` itself. It is the same
function by definition and would recover the 5× on the primitive, but the number representation would then bypass the
rule the tests hold, and "the two representations are one rule" would stop being an invariant.

## Left out, and where the brief and the repository disagree

- **`num/` is already promised for something else.** `src/stdlib/index.ts`'s "later modules" list (written by
  IRWB-046-B) reserves `num/` for *exact small-number helpers (saturating and wrapping arithmetic)*, and the IRWB-039
  design doc never mentions a binary32 `num`. This step takes the name for binary32; the integer helpers are still
  listed as a later module and will need either a sub-directory (`num/int.ts`) or its own name. Flagging rather than
  deciding: the conflict is between the brief and the skeleton's line, not inside this step.
- **Only min/max is genuinely shared by the two domains, and that is what Tix calls.** The arithmetic (add, sub, mul,
  div) moved into the library but has one client, Typed, because Tix's evaluator computes `Math.fround(a op b)` for
  f32 and the unrounded double for f64 — the rounding decision is Tix's precision flag, not a binary32 operation, and
  the brief scopes this step away from `src/tensor`'s other files. The min/max rule, which is what the brief says
  differs, is shared, one implementation, two representations.
- **`formatF32`, `F32_RESULT`, `F32_OPERANDS`, `F32_FOLDABLE`, `f32Op`, `f2bits`/`bits2f` stay in `src/typed/f32.ts`.**
  They are Typed's vocabulary and policy (opcode names; which operators produce f32; which fold at compile time), not
  arithmetic, and moving them would have made the standard library depend on this IR's spelling of its operators.
- **Not written**: a `check/` module stating the min/max laws as a reusable checker. The admission rule asks for an
  executable test, which `tests/stdlib/num.test.mjs` is; a checker module in `src/stdlib/check/` would be this
  ticket's tests wrapped in a second entry point (one path per job).
- **`FloatOrder.compare` returning `a` on a tie** is unobservable for both representations (a tie means the same
  value), and it is kept only because the sweep it replaces returned `a`. Recorded in the design doc's open questions;
  a representation that ordered equivalence classes rather than values would have to revisit it.
