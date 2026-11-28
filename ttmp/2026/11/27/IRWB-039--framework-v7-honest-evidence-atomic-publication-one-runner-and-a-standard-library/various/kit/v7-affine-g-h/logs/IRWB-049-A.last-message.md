Done. Everything is committed and the working tree is clean.

**Ticket and report**
- Ticket: `ttmp/2026/11/27/IRWB-049-A--stdlib-affine-exact-affine-forms-and-dependence-distance-vectors/` (index, changelog, tasks, scripts)
- Diary: `.../reference/01-implementation-diary.md`; Report: `.../reference/02-report-the-affine-module-exact-forms-and-distances.md`

**What changed, file by file**
- `src/stdlib/affine/forms.ts` (new) — the six affine forms moved from `src/tensor/model.ts`; **the fix**: `add` computes every coefficient as a BigInt (no intermediate rounding), safe-integer admission and error message unchanged; R3's case now returns the exact 4503599627370500.
- `src/stdlib/affine/distances.ts` (new) — `distanceVector` (consumer's axis minus read's index, per position) and `isZero`.
- `src/stdlib/index.ts` — exports the module; catalogue moves `affine/` to "What exists now".
- `src/tensor/model.ts` — its copy deleted; re-exports the library (first client: the whole Tix domain reads forms through the model).
- `src/tensor/fusion.ts` — only `joinDepth`: read loop rewritten on the distances, reason strings byte-identical (second client).
- `tests/stdlib/affine.test.mjs` (new, 9 tests), plus ticket scripts `01-affine-rounding-probe.mjs` (`WRONG by 1` before, `exact` after) and `02-acceptance-suites.sh`.

**Acceptance (on commit 89abc85)**
- My tests: 9/9 pass.
- Baselines: `02-baselines.mjs check` prints `no differences` (CUDA source and Tix revisions byte-identical).
- Suites: 75 files, 0 failures — typed 37, framework 20, workbench 5, stdlib 3, tensor 10 (no `*-gpu`); the 3 skips are pre-existing, env-gated (`IRWB_CANDELA=1`), untouched.
- `npm run check` clean; Prettier clean on changed files; `tools/build-site.mjs` builds (I changed `src/stdlib/`).

**Notes on the brief**
- `value` keeps its double evaluation (it returns a runtime number, not a form; the brief fixes `add`, and `substitute` is exact through it).
- A shifted read of a same-extent tensor cannot reach `joinDepth` through the parser (bounds checker rejects both `i+1` and `i-1`), so the shifted cases in the client test are hand-built IR; a transposed read needs a square tensor. No existing test was weakened or changed.
- The old `plain(index) === axis` and new `isZero(axis − index)` agree on every canonical form; only hand-built forms with zero-coefficient terms could differ, and nothing builds one.

**Last commit:** `89abc85`
