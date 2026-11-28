All acceptance items verified on the final commit. 

## Summary

**Ticket:** `ttmp/2026/11/27/IRWB-046-B--a-standard-library-of-compiler-algorithms-the-skeleton-and-liveness-first/`
**Report:** `.../reference/02-report-the-standard-library-skeleton-and-liveness.md` (design: `.../design/01-liveness-in-the-standard-library-interface-scope-decision-layout.md`, diary: `.../reference/01-implementation-diary.md`, probe: `.../scripts/01-liveness-scopes.mjs`)

**Changes, file by file:**
- `src/stdlib/flow/liveness.ts` — new: `liveness(graph, scope)` over `LiveBlock` (upward-exposed `uses`, `defs`, successor indices) / `LiveGraph` (blocks, optional entry, default 0), plus `reachableBlocks`; the scope is a *required* parameter (`'all-blocks'` | `'entry-reachable'`)
- `src/stdlib/index.ts` — new: the index, the layering-D rule, and one line per later module (`graph`, `lattice`, `num`, `flow` solver, `ssa`, `term`, `affine`, `pe`, `check`, `measure`)
- `src/typed/backend/regalloc.ts` — `intervals` calls `liveness(..., 'all-blocks')`, sweep deleted; `Intervals.liveOut` narrowed to `ReadonlySet[]`
- `src/typed/backend/coalesce.ts` — same call for its live-out sets, sweep deleted
- `tests/stdlib/liveness.test.mjs` — new: exact sets on a loop CFG; the trap case under both scopes; upward exposure; non-zero entry; machine scope pinned via `intervals()` on hand-built machine code
- `tests/stdlib/layering.test.mjs` — new: fails if any module under `src/stdlib/` resolves an import outside `src/stdlib/` (covers framework/typed/tensor and every other domain)

**Scope decision:** machine liveness is `'all-blocks'` — the sweeps always ran over every block, an unreachable block is still laid out and needs registers, and byte-identical images require it; `'entry-reachable'` reproduces the framework solver (unreachable blocks keep `{}`). The two differ only on unreachable blocks.

**Acceptance:**
- My tests: 7/7 pass; `tests/typed/backend.test.mjs`: 14/14 pass unchanged
- Baselines check: **`no differences`** (byte-identical images, edits, CUDA sources)
- Suites (typed, framework, workbench, tensor minus `*-gpu`, plus stdlib): **507 tests, 496 pass, 0 fail, 3 skipped (pre-existing env-gated candela), 8 todo** (F27/F33–F38, other steps, untouched)
- `npm run check` clean; `build-site` not run (no `src/framework/` or `src/workbench/` change); `format:check` warns only on 9 pre-existing files I didn't touch

**Left out / notes:** `physicalOccupancy` in regalloc is a third copy of the equations but bitset-packed over physical registers with call-clobber semantics — it needs the `lattice`/`flow` solver (2c), so it stays. No `todo` test existed for this step — the acceptance's tests are the ones added here, so there was no `todo` to remove; nothing in the brief or existing tests looked wrong.

**Last commit:** `39f6c3e`
