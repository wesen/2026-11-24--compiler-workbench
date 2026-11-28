---
Title: '01 implementation diary'
Ticket: IRWB-049-A
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
LastUpdated: 2026-11-27
WhatFor: ""
WhenToUse: ""
---

# 01 implementation diary

## Step 0: the task, as given

The ticket brief (verbatim summary of the assignment): move the affine forms from `src/tensor/model.ts`
into `src/stdlib/affine/` and make them exact — today `add` checks only that the final coefficients are
safe integers, while it computes `b.constant * scale` and the sums in doubles, so an intermediate can
round (R3: `add(constant(-MAX_SAFE_INTEGER), constant(4503599627370497), 3).constant` is one more than
the exact value); reject a result that is not a safe integer with an ordinary error, as today. Add
dependence distance vectors: for a statement with axes and a read with affine indices, the distance at
each position is the consumer's axis minus the read's index, zero meaning aligned; rewrite
`joinDepth` (`src/tensor/fusion.ts`) on the library's distances — its join test is exactly the leading
positions at which every read of the group has distance zero (R3 verified agreement on 13 of 13
programs). Acceptance: stdlib tests (large-integer arithmetic including R3's case; distance vectors
with known answers), the coordinator's baselines check `no differences`, the non-GPU suites pass,
`tsc` clean, `build-site` builds.

## Step 1: reproduce the rounding (script 01)

`scripts/01-affine-rounding-probe.mjs` runs R3's case against the current build:

```
exact  : 4503599627370500 true
add gives: 4503599627370501 safe: true
WRONG by 1
```

The intermediate `3 * 4503599627370497` is odd and above 2^53, so the double rounds it up by one;
`MAX_SAFE_INTEGER` is then subtracted and the wrong result is still a safe integer, so the old check
admitted it. After the move (step 2) the same probe prints `exact`.

## Step 2: the library module

- `src/stdlib/affine/forms.ts`: the six forms (`constant`, `variable`, `add`, `substitute`, `value`,
  `plain`) moved from `src/tensor/model.ts`, not rewritten. `add` now computes every coefficient as a
  BigInt — no intermediate can round — and the safe-integer admission check is unchanged (same
  message, `Affine integer overflow`). A BigInt beyond the safe range cannot convert to a safe
  integer (a double's spacing past 2^53 is at least 2), so the check sees the true result. A
  non-integer input has no exact integer value, so `BigInt(n)` rejects it (no caller passes one: the
  parser checks literals, and every scale in the domain is an integer).
- `src/tensor/model.ts`: its copy is deleted; it imports and re-exports the library's forms, so every
  Tix file that reads affine arithmetic through the model now calls the library.
- `src/stdlib/index.ts`: exports the forms and `Affine`, and the catalogue moves `affine/` from
  "Later modules" to "What exists now".

Decision: `value` keeps its double evaluation. It evaluates a form at concrete environment values and
returns that number; the brief fixes the exactness defect in `add` (and, through it, `substitute`),
and changing `value`'s arithmetic could not change any baseline anyway (its callers pass ordinary
shape values), so the smaller diff wins.

## Step 3: distances and the second client

- `src/stdlib/affine/distances.ts`: `distanceVector(axes, indices)` — `axes[p] - indices[p]` per
  position — and `isZero`. Pure forms in, forms out; no domain types.
- `src/tensor/fusion.ts`: `joinDepth`'s read loop is rewritten on the distances: a read joins at
  depth `k` exactly where its leading `k` distances are zero. The reason strings are byte-identical
  to the old ones (`plain(index) === axis` and `isZero(axis - index)` agree on every canonical form;
  a hand-built form with zero coefficients could tell them apart, and nothing builds one).

## Step 4: the tests, and what the parser taught me

`tests/stdlib/affine.test.mjs` (9 tests). While writing the client-level tests through `compileTix`
I hit the parser's bounds checker:

- `z[i] = y[i+1]` fails `Index outside axis` (the shifted index can exceed the extent) and
  `y[i-1]` fails too (the constant `-1` makes the low bound negative). So **no shifted read of a
  same-extent tensor can reach `joinDepth` through the parser**; those two statements are built as IR
  by hand in the test.
- A transposed read `y[j,i]` needs a square tensor (`x:f32[N,N]`), because a bare index name must keep
  one extent across the tensors it indexes (`Inconsistent extent` otherwise).
- The refusal's index text is the binder's internal id (`i3`), not the source name — unchanged from
  before, since `text` and the ids are untouched.

Known answers asserted: aligned joins (thread mode, depth 1); shifted refuses at position 0;
transposed refuses at position 0; constant index refuses at position 0; a shift in a trailing
position narrows the block domain to depth 1 (block mode) with the narrowing reason.

## Step 5: acceptance

- `npm run build` and `npm run check` (tsc): clean.
- Baselines (`ttmp/2026/11/27/IRWB-039--.../scripts/02-baselines.mjs check`): `no differences`
  (run after the source change; CUDA source and Tix revisions byte-identical).
- Suites: see the report for the per-file table (script 02).
- Prettier: clean on all changed `src/` files.
