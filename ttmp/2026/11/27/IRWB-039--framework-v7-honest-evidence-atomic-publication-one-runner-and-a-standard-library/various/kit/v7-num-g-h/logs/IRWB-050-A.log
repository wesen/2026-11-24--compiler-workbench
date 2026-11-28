Done. IRWB-050-A is complete and committed.

## Ticket and report
- **Ticket:** `ttmp/2026/11/27/IRWB-050-A--stdlib-num-binary32-min-and-max-with-the-profile-explicit/` (closed `complete`, docmgr doctor clean)
- **Report:** `.../reference/02-report-stdlib-num-binary32-min-and-max-with-the-profile-explicit.md` (design: `.../design-doc/01-...md`, diary: `.../reference/01-implementation-diary.md`)

## What changed
- `src/stdlib/num/minmax.ts` (new) — the IEEE 754-2019 min/max family as four **named operations**: `maximumNumber`/`minimumNumber` (RV32F profile) and `maximum`/`minimum` (JavaScript profile); the profile is the operation name, so there is no unqualified `max` to call
- `src/typed/f32.ts` — `fmin`/`fmax` call the library across the bits↔number boundary; the bit-level `order`/`minmax` helpers deleted
- `src/tensor/evaluate.ts` — ops table maps `max: maximum, min: minimum`; the `max` reduction calls `maximum`; direct `Math.max`/`Math.min` deleted
- `src/stdlib/index.ts` — exports the four operations; `num/` moved to "What exists now"
- `tests/stdlib/minmax.test.mjs` (new) — every operation on every ordered pair of the binary32 special values in both orders (JavaScript profile bit-exact vs `Math.max`/`Math.min` via `Object.is`), plus both clients through their own representations
- Ticket `scripts/01-evaluator-speed.mjs`, `scripts/02-minmax-micro.mjs` — committed speed probes

**Scope decision:** only the min/max family moves — Tix's ops table is precision-generic (rounds outside the op), so a library binary32 add would either break f64 mode or be `a + b` itself, and Typed would be its only client (fails the two-client admission rule).

## Acceptance (on the last commit)
- **My tests:** 5 tests in `minmax.test.mjs`, all pass — including `max(NaN, 7)` (7 under `maximumNumber`, NaN under `maximum`) and `max(-0, +0)` (+0 under both)
- **Baselines:** `02-baselines.mjs check` → **no differences** (re-verified after the final commit)
- **Suites:** typed 186 pass/2 skipped/0 fail; framework 243/0/0; workbench 24/1 skipped/0; stdlib 12/0/0; tensor (non-gpu) 45/0/0 — no assertion weakened
- `npm run check` clean; my files Prettier-clean (the 9 warned files pre-date this step); `tools/build-site.mjs` builds
- **Speed:** `attention` f32 evaluate best-of-batches before 128–140 ms, after 125–187 ms (shared machine, medians swing ±50%); micro-probe: per-call deltas all negative (library ops inline where the builtin indirection doesn't) → no measurable slowdown

## Left out / caveats
- No library binary32 add/sub/mul/div/sqrt (needs a per-precision story and a second client); Typed's remaining RV32F semantics stay in `f32.ts`
- Nothing in the brief proved wrong (its line references check out at the base commit)

**Last commit:** `a2e40c4` (worktree clean; not pushed)
