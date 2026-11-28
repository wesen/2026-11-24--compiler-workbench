---
Title: Implementation diary
Ticket: IRWB-049-B
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
Summary: "Chronological record of IRWB-049-B: reading, the exactness decision, the distance law, the tests and the acceptance runs."
LastUpdated: 2026-11-27
WhatFor: "Reconstructing how the step went, including what failed."
WhenToUse: "Reviewing IRWB-049-B, or repeating a similar extraction."
---

# Implementation diary — IRWB-049-B

## 1. Reading, and the shape of the step

Read `src/stdlib/index.ts` (the admission rule: a named algorithm or law, at least two clients, an
executable test; layering D), `src/stdlib/flow/liveness.ts` as the pattern from IRWB-046-B,
`src/tensor/model.ts:1-30` (the forms), `src/tensor/fusion.ts:70-110` (`joinDepth`),
`tests/stdlib/layering.test.mjs` (no import outside `src/stdlib/`), and the IRWB-046-B report for the
house style.

The step has two named things, not one: the forms (a small shape plus operations) and dependence
distances (a law over them). They are two files under one module, because the second is stated over the
first and neither is useful alone.

## 2. The exactness decision

R3's case reproduced before touching code:

```
node -e 'const M=Number.MAX_SAFE_INTEGER,b=4503599627370497; ...'
  double: -M + 3b = 4503599627370501   exact: 3b - M = 4503599627370500   safe: true
```

The rounded value is a safe integer, so the old result check could not reject it. Chose BigInt for the
combinations and a single safe-integer check on the result (design doc, "The exactness decision", for
the two alternatives and why they lose). `value` stays a double evaluation: it reads a form for the
tensor runtime and never builds one.

First version of `src/stdlib/affine/forms.ts` was written, then the facade:

```
src/tensor/model.ts  →  export { add, constant, plain, substitute, value, variable, type Affine } from '../stdlib/affine/forms.js'
tsc: src/tensor/model.ts(15,25): error TS2304: Cannot find name 'Affine'  (six times)
```

`export { … type Affine } from …` re-exports the type without binding it locally, and the rest of
`model.ts` annotates with `Affine`. Fixed with `import type { Affine } …; export type { Affine };`.
`npm run build` clean; `npm run format:check` warns on the same 9 files that were already unformatted
before this step (IRWB-046-B's report says 9), and on none of mine.

## 3. The distance law and the second client

`src/stdlib/affine/distances.ts`: `distance(axis, index) = add(variable(axis), index, -1)`,
`distances`, `isZero`, `alignedDepth`. `joinDepth`'s per-read loop became:

```ts
const d = alignedDepth(axes, r.indices);
if (d < k) { const at = text(r.indices[d]); [k, reason] = [d, `reads ${r.name} at index ${at} in position ${d}, not its own axis there`]; }
```

The reason string and the shape check that runs before it are untouched, so the only difference the
plan can see is the predicate itself — and on the corpus there is none (below).

## 4. Probes, and three things that went wrong

`scripts/01-exactness.mjs` — the old `add` reimplemented beside the new one.

- First run: my "must be accepted" cases were wrong (I scaled the wrong operand:
  `add(term(-1), term(3), 4503599627370497)` throws, correctly). Fixed the cases, kept the error as
  evidence that the probe is not rigged.
- Over 10 constants × 10 constants × 6 scales = 600 combinations: **592 agree, 8 differ**, and all 8
  are the R3 rounding (old result one more or one less than exact).

`scripts/02-distances.mjs` — distance vectors on small programs, then the old predicate against the
library over the corpus.

- `y[i] = x[i + 1]` with `x: f32[N]` is rejected by the parser: `1:50 Index outside axis`. A shifted
  read has to be in bounds, so its statement declares the smaller extent:
  `fn shifted(x: f32[N]): f32[N-1] { y[i]: f32[N-1] = x[i + 1]; return y; }`.
- `y[i,j]: f32[N,M] = x[j,i]` with `x: f32[M,N]` first failed as `1:88 Inconsistent extent`, because the
  second read of the same statement (`x[i,j]`) binds the axes to the other extents. `b[i,j] = a[i,j]`
  (a transposed read of the *member*, square shapes) is the case that reaches `joinDepth`'s read loop.
- Result: `aligned: distance [0], depth 1`; `shifted: [-1], depth 0`; `transposed:
  [i0-i1, -i0+i1], depth 0`; `constant index: g[0] gives [i0] and x[i,j] gives [0,0]`. Corpus:
  **19 statements, 41 reads, 0 disagreements** with the `plain()` predicate.

`scripts/03-affine-cost.mjs` — the cost of exactness.

- The host's load average was 27 to 30 (other agents), so per-operation times are noise (0.8x to 2.2x
  between runs for the same pair of functions; `new Map([...])` alone measured 0.67 µs). Reported the
  ratio only and made the *counts* the evidence: a compile performs **12 to 60 `add` calls** and no
  `substitute` calls, against compiles of 10 to 170 ms. The counts come from a patched copy of `dist/`
  in a temp directory (a counting wrapper around the forms module), not from `src/`.

## 5. The tests

`tests/stdlib/affine.test.mjs`, 8 tests: R3's constant case (and the double value beside it, to show why
the check could not see it); the coefficient side and `substitute`; the rejections at the boundary; the
canonical form; the four distance cases from parsed programs; the three fusion outcomes (aligned group
at depth 2, transposed member read refused at position 0, constant member index refused at position 0,
plus a three-member aligned group); the corpus agreement; and the re-export identity
(`model.add === stdlib.affine.add`).

One failure on the first run: `TypeError: Cannot mix BigInt and other types` — my `exactOf` helper
returned a Number and I subtracted a BigInt from it. Fixed the helper.

No existing test asserted the behaviour this step changes: `tests/tensor/fusion.test.mjs` asserts group
depths and reasons, which are unchanged. No test was weakened.

## 6. Acceptance, in order

1. `npm run build` — clean. `npm run check` — clean.
2. Baselines: `02-baselines.mjs check` → `no differences from …/various/baselines/main.json` (exit 0).
3. Suites, file lists on Node 24, no `*-gpu`:
   - `tests/stdlib/*.test.mjs` 15 tests, 15 pass;
   - `tests/tensor/*.test.mjs` minus `*-gpu` 45 tests, 45 pass;
   - `tests/framework/*.test.mjs` 243 tests, 243 pass;
   - `tests/workbench/*.test.mjs` 25 tests, 24 pass, 1 skipped;
   - `tests/typed/*.test.mjs` 188 tests, 186 pass, 2 skipped.
4. `npm run format:check`: the same 9 pre-existing files, none of them touched by this step.
5. `node tools/build-site.mjs`: `dist/site built in 2427 ms` (the step changes `src/stdlib/`).

## 7. What I would say at review

The move and the exactness fix are one change: the library file states its integer domain, so the check
belongs there with the arithmetic in one place. The distance law earns its keep by replacing a
position-by-position loop with one named number, and by being exact on forms instead of on `plain()`.
The one thing the brief calls a "correctness fix" that is invisible in the plan is exactly that: no
corpus program has an unnormalised form, so the baseline has nothing to say about it; the tests and
`scripts/02-distances.mjs` are what pin it.
