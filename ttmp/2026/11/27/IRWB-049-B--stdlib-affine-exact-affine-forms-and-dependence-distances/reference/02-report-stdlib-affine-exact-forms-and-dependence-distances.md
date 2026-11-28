---
Title: 'Report: stdlib affine, exact forms and dependence distances'
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
Summary: "What IRWB-049-B changed, file by file, and the acceptance results: 8 new stdlib tests, no baseline differences, all suites green."
LastUpdated: 2026-11-27
WhatFor: "The report of IRWB-049-B."
WhenToUse: "Reviewing what the affine module delivered."
---

# Report: stdlib affine, exact forms and dependence distances

## What changed, file by file

- `src/stdlib/affine/forms.ts` (new) — `Affine` and `constant`, `variable`, `add`, `substitute`,
  `value`, `plain`, moved out of `src/tensor/model.ts`; `add` combines in BigInt and checks only the
  result, so `add(constant(-MAX_SAFE_INTEGER), constant(4503599627370497), 3).constant` is the exact
  4503599627370500 (doubles gave …501). `value` stays a double evaluation, stated in the comment.
- `src/stdlib/affine/distances.ts` (new) — `distance(axis, index) = axis - index`, `distances`,
  `isZero`, `alignedDepth` (leading positions with distance zero).
- `src/stdlib/index.ts` — `export * as affine` and `export * as dependence`; `affine/` moved from the
  "later modules" list to "what exists now"; the layering rule unchanged.
- `src/tensor/model.ts` — the six functions and the `Affine` type are re-exported from the library (the
  old bodies deleted); every other Tix file's `import … from './model.js'` is untouched.
- `src/tensor/fusion.ts` — only `joinDepth`: its per-read loop (`plain(indices[p]) !== axes[p].id`)
  became `alignedDepth(axes, r.indices)`; the shape check, the reason strings and everything else in the
  file are unchanged.
- `tests/stdlib/affine.test.mjs` (new) — 8 tests: R3's case through `add` (with the double value beside
  it), the coefficient side and through `substitute`, the rejections at the boundary, the canonical
  form, distance vectors on parsed small programs (aligned, shifted, transposed, constant index), the
  three fusion outcomes that follow, the corpus agreement with the old predicate, and the re-export
  identity.
- `ttmp/…/IRWB-049-B…/scripts/01-exactness.mjs`, `02-distances.mjs`, `03-affine-cost.mjs` — the probes:
  old against new `add` on 600 operand combinations (592 agree, 8 differ, all the rounding case); the
  distance vectors and 0 disagreements over 19 statements and 41 reads of the Tix corpus; the per-add
  cost and 12–60 `add` calls per compile.

## Acceptance (checked on the last commit)

- **My tests**: `node --test tests/stdlib/affine.test.mjs` — 8 tests, 8 pass.
- **Baselines**: `node ttmp/2026/11/27/IRWB-039--…/scripts/02-baselines.mjs check` (after
  `npm run build`) — `no differences from …/various/baselines/main.json`, exit 0. RV32 image hashes,
  instruction counts and edit records of every corpus project under r0, O2 and `speed`, and the CUDA
  source and `optimizeTix` revisions of every Tix program are unchanged.
- **Suites** (Node 24, files not directories, no `*-gpu`): `tests/stdlib` 15/15 pass; `tests/tensor`
  minus `*-gpu` 45/45 pass; `tests/framework` 243/243 pass; `tests/workbench` 25 tests, 24 pass,
  1 skipped, 0 fail; `tests/typed` 188 tests, 186 pass, 2 skipped, 0 fail. Totals: 516 tests, 513 pass,
  0 fail, 3 skipped, 0 todo.
- **`npm run check`** (tsc) clean. **`npm run format:check`** warns on the same 9 files that were
  already unformatted before this step; every file this step created or changed passes Prettier.
- **`node tools/build-site.mjs`** — `dist/site built in 2427 ms` (the step changes `src/stdlib/`).

## Left out, and why

- `equal` over forms, and a `sub` helper: no client needs them; `a - b` is `add(a, b, -1)`. The shape
  comparison `joinDepth` makes before its read loop keeps the file's `JSON.stringify` helper, which is
  used in two other places in `fusion.ts` — moving it needs a third client.
- The `lattice`, `num`, `flow`, `ssa`, `term`, `pe`, `check`, `measure` modules remain one-line claims
  in `src/stdlib/index.ts`.
- `src/tensor/evaluate.ts` and `src/tensor/schedule.ts` untouched, per the step's scope.

## Where the brief and the code disagree

- "The leading positions at which every read of the group has distance zero" is `joinDepth`'s read
  loop; `joinDepth` also trims the depth on shape equality and on the statement's rank *before* it, so
  the library's `alignedDepth` is combined with `min(k, …)` rather than replacing the whole function.
  A shifted read of a *member* (`a[i+1]`) is unreachable in Tix — the index would be out of bounds when
  the extents match — so the shape check refuses those statements first; the shifted case is therefore
  pinned at the library level (distance `-1`), not through `planFusion`.
- `plain()` and distance-zero differ on an unnormalised form (`x - x` terms listed twice): the library
  is exact and calls it aligned, `plain()` did not. No corpus program has one, so this is a strict
  improvement with no observable change; it is stated here rather than in a baseline difference.

Nothing in the brief looked wrong otherwise. No existing test asserted behaviour this step changes, so
none was updated and none was weakened.
