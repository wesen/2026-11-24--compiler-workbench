---
Title: 'The affine module: exact forms, the BigInt decision, distance vectors, and the two clients'
Ticket: IRWB-049-B
Status: complete
Topics:
    - compiler
    - ir
    - typescript
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/stdlib/affine/forms.ts
      Note: the forms and their operations, exact by construction
    - Path: src/stdlib/affine/distances.ts
      Note: dependence distances, and the aligned depth that joinDepth now reads
    - Path: src/tensor/model.ts
      Note: the domain facade; re-exports the library's functions rather than keeping a copy
    - Path: src/tensor/fusion.ts
      Note: joinDepth (the second client)
    - Path: tests/stdlib/affine.test.mjs
      Note: exactness on large integers, distance vectors on small programs, corpus agreement
ExternalSources: []
Summary: "How the affine forms leave the Tix model for src/stdlib/affine, why add now computes in BigInt, what a dependence distance is, and what each decision cost."
LastUpdated: 2026-11-27
WhatFor: "Reviewing IRWB-049-B, or reusing the affine module from another domain."
WhenToUse: "Before changing affine arithmetic or the fusion join test."
---

# The affine module: exact forms, the BigInt decision, distance vectors, and the two clients

## Executive summary

The affine forms Tix indexes tensors with (`constant`, `variable`, `add`, `substitute`, `value`, `plain`)
move from `src/tensor/model.ts` into `src/stdlib/affine/forms.ts`, and `add` becomes exact: the
combinations run in BigInt and only the result is checked against the safe integers. A second file,
`src/stdlib/affine/distances.ts`, adds the dependence distance — the consumer's axis minus a read's
index form — and the aligned depth, the number of leading positions where a read has distance zero.
`joinDepth` in `src/tensor/fusion.ts` now asks the library for that depth instead of testing each read
index with `plain()`.

The two clients are the Tix model, which keeps its name for every form constructor and operation by
re-exporting the library's functions, and `joinDepth`. Nothing outside `src/stdlib/` keeps a copy: the
old `add` body and the old read-index loop are deleted, not left beside the library.

## The interface

`src/stdlib/affine/forms.ts` — a form is a small shape, no domain type in sight:

```ts
export interface Affine { constant: number; terms: [string, number][] }
export const constant = (value: number): Affine;
export const variable = (name: string): Affine;
export function add(a: Affine, b: Affine, scale = 1): Affine;   // a + scale·b, exact
export function substitute(a: Affine, bindings: Map<string, Affine>): Affine;
export function value(a: Affine, env: Map<string, number>): number;
export function plain(a: Affine): string | undefined;
```

`src/stdlib/affine/distances.ts` — the law a fusion decision needs:

```ts
export function distance(axis: string, index: Affine): Affine;             // axis - index, zero = aligned
export function distances(axes: readonly string[], indices: readonly Affine[]): Affine[];
export function isZero(a: Affine): boolean;
export function alignedDepth(axes: readonly string[], indices: readonly Affine[]): number;
```

`src/stdlib/index.ts` exports each file as a namespace (`affine`, `dependence`) rather than as loose
names, because `value`, `constant` and `distance` are names every later module would also want. The
layering entry (`affine` above `graph`/`lattice`/`num`/`ssa`/`flow`, below `check`/`measure`) is
unchanged; the module is now listed under "what exists", not under "later".

## The exactness decision

The defect (R3): `add` computed `b.constant * scale` and the coefficient sums in doubles, then checked
that the *results* were safe integers. A double product rounds before the check sees it, and the
rounded value can be a safe integer, so the check passes on a wrong answer:

```
add(constant(-(2^53 - 1)), constant(2^52 + 1), 3).constant
  exact                     3·(2^52 + 1) - (2^53 - 1) = 4503599627370500
  doubles, before                                      = 4503599627370501
```

Both are safe integers. The same happens on the coefficient side (`-MAX·x + 3·(2^52+1)·x`), and
`substitute` inherits it because it folds with `add`.

**Chosen: BigInt for every combination, one check on the result.** `constant`, every coefficient and
`scale` are converted with `BigInt`, products and sums are exact, and the result is rejected with the
same ordinary error as before, `'Affine integer overflow'`, if any constant or coefficient lies outside
`±(2^53 - 1)`. The domain is stated and enforced elsewhere: Tix's IR validator already requires every
index and extent form to have a safe-integer constant and coefficients (`src/tensor/ir.ts`,
`checkForm`), and the parser rejects a non-integer literal ('Invalid integer').

Alternatives, and why not:

- *Check magnitudes before multiplying and throw early.* Rejects the same inputs, but needs a bound
  argument for each of the three combinations (constant product, coefficient product, sums) and still
  computes the sum in doubles; two rules to keep in step where BigInt needs none.
- *Fast path in doubles when `|a|·|b| < 2^53` from the operand magnitudes, BigInt otherwise.* Two
  implementations of one job, and the fast path is what has to be argued correct. The measurement below
  says the cost it would save is not measurable in a compile.
- *Double-double (two-double) arithmetic for the products and sums.* Exact for this domain and no
  allocation, but a fallback still has to exist past the exponent range, so it is the fast path under
  another name, with more code than BigInt and no second reader.

Cost: one compile of a corpus program performs 12 to 60 `add` calls and no `substitute` calls
(scripts/03-affine-cost.mjs), so exactness cannot show up in a compile time of 10 to 170 ms; the
baselines (below) confirm the images. `value` is deliberately *not* made exact: it evaluates a form in
an environment for the tensor runtime, never builds one, and its callers want a number.

## Dependence distances

A statement is indexed by axes `a₀ … aₙ₋₁`; a read it makes is indexed by one form per position. The
distance at position p is the consumer's axis minus the read's index, `aₚ - iₚ`, as a form: zero means
the read touches the element the consumer computes at that axis value (aligned), and a non-zero
distance is how far apart producer and consumer are along that axis. Transposed reads give `a₀ - a₁`
and `a₁ - a₀`; a constant index gives the axis itself; a shifted read gives the constant offset with
the sign of "consumer minus read".

`alignedDepth` is the leading positions with distance zero, i.e. every read of a statement is aligned
in each of them. That is precisely `joinDepth`'s per-read condition (`plain(index) === own axis`), and
`joinDepth` now computes `min(k, alignedDepth(axes, read.indices))` per read, keeping the same reason
string and the same shape check before it. Rewriting the test on forms rather than on `plain()` is also
strictly more exact: two forms whose coefficients cancel to zero are aligned, which `plain()` — it
requires a literal single term with coefficient 1 — could not see for an unnormalised form. No corpus
program has one (19 statements, 41 reads, no disagreement), so nothing observable changes today.

## What is not in this step

- `equal`/ordering laws over forms, and a `sub` helper: not needed by either client; `a - b` is
  `add(a, b, -1)`. `joinDepth`'s shape comparison keeps its own `JSON.stringify` equality, which is
  outside `joinDepth`'s read loop and used elsewhere in the file (an extra client would be needed
  before moving it).
- Extent inference, `solveFor` and partial evaluation over forms (`pe` in the index) are later modules.
- `src/tensor/evaluate.ts` and `src/tensor/schedule.ts` are untouched, per the step's scope.

## Implementation plan (as executed)

1. `src/stdlib/affine/forms.ts`: the forms, moved; `add` in BigInt; the module comment states the
   domain, the R3 case and why `value` stays a double evaluation.
2. `src/stdlib/affine/distances.ts`: `distance`, `distances`, `isZero`, `alignedDepth`.
3. `src/stdlib/index.ts`: the namespaces and the layering entry updated.
4. `src/tensor/model.ts`: re-exports the library's six functions and the `Affine` type; the old bodies
   deleted.
5. `src/tensor/fusion.ts`: `joinDepth`'s read loop replaced by `alignedDepth`; nothing else.
6. `tests/stdlib/affine.test.mjs`: exactness (R3's case through `add`, the coefficient side, through
   `substitute`), the rejections, canonical form, distance vectors on parsed small programs (aligned,
   shifted, transposed, constant index), the fusion consequences, corpus agreement with the old
   predicate, and the re-export identity.
7. Probes in `scripts/`: `01-exactness.mjs` (old against new on 600 operand combinations: 8 differ, all
   the rounding case), `02-distances.mjs` (distance vectors, and 0 disagreements over the corpus),
   `03-affine-cost.mjs` (counts per compile).
