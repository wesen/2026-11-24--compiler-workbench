Done. Working tree clean; last commit `a8f7aad`.

## Ticket and report
- Ticket: `ttmp/2026/11/27/IRWB-049-B--stdlib-affine-exact-affine-forms-and-dependence-distances/`
- Design: `…/design-doc/01-the-affine-module-exact-forms-the-bigint-decision-distance-vectors-and-the-two-clients.md`
- Diary: `…/reference/01-implementation-diary.md`; Report: `…/reference/02-report-stdlib-affine-exact-forms-and-dependence-distances.md`
- Probes: `…/scripts/01-exactness.mjs`, `02-distances.mjs`, `03-affine-cost.mjs`

## Changes, file by file
- `src/stdlib/affine/forms.ts` (new) — the forms moved out of the Tix model; `add` combines in BigInt (product and sums exact), one safe-integer check on the result only, same `'Affine integer overflow'` error; `value` stays a double evaluation, documented.
- `src/stdlib/affine/distances.ts` (new) — `distance(axis, index) = axis − index`, `distances`, `isZero`, `alignedDepth` (leading positions with distance zero).
- `src/stdlib/index.ts` — `export * as affine` / `export * as dependence`; `affine/` moved from "later" to "what exists"; layering rule unchanged.
- `src/tensor/model.ts` — re-exports the six functions and the `Affine` type; old bodies deleted (no other Tix file changed its imports).
- `src/tensor/fusion.ts` — only `joinDepth`: the per-read `plain(indices[p]) !== axes[p].id` loop became `alignedDepth(axes, r.indices)`; shape check and reason strings untouched.
- `tests/stdlib/affine.test.mjs` (new) — 8 tests.

## Acceptance
- My tests: `tests/stdlib/affine.test.mjs` 8/8 pass; `tests/stdlib/*.test.mjs` 15/15.
- Baselines (`02-baselines.mjs check` after `npm run build`): `no differences from …/various/baselines/main.json`, exit 0 — run twice (on `39a55d9` and on `be90841`); `src/` is byte-identical in the last commit `a8f7aad`, which only renamed a test variable.
- Suites: typed 188 tests/186 pass/2 skipped; framework 243/243; workbench 25 tests/24 pass/1 skipped; stdlib 15/15; tensor minus `*-gpu` 45/45 — total 516 tests, 513 pass, 0 fail, 3 skipped, 0 todo.
- `npm run check` clean; `npm run format:check` warns on the same 9 pre-existing files only; `node tools/build-site.mjs` → `dist/site built in 2427 ms`.
- Probes: new vs old `add` over 600 operand combinations → 592 agree, 8 differ, all the R3 rounding (old result ±1); distances on the Tix corpus → 19 statements, 41 reads, 0 disagreements with the old `plain()` predicate; a corpus compile performs 12–60 `add` calls (host load average ~28, so per-op timings are noise — counts are the evidence).

## Left out / brief caveats
- No `equal` or `sub` in the library: neither client needs them (`a − b = add(a, b, −1)`); `joinDepth`'s pre-loop shape comparison keeps `fusion.ts`'s `JSON.stringify` helper, used in two other places in that file.
- `joinDepth` is not only the read test: it also trims on shape equality and statement rank first, so the library's depth is combined as `min(k, alignedDepth(...))`, not substituted for the whole function.
- A shifted read of a *member* (`a[i+1]`) is unreachable in Tix (out of bounds when extents match), so the shape check refuses those statements before the read loop; the shifted case is pinned at library level (distance −1) and in tests, not through `planFusion`.
- Distance-zero and `plain()` differ on unnormalised forms (`x − x` listed twice): the library is exact and calls it aligned. No corpus program has one, so it is invisible in the baselines; stated in the report.
- `src/tensor/evaluate.ts`, `src/tensor/schedule.ts` untouched, per scope.

Last commit: **a8f7aad**
