All acceptance items hold on the last commit. Final report:

## Ticket and report

- **Ticket:** `ttmp/2026/11/27/IRWB-048-A--stdlib-lattice-the-lattices-of-dataflow-analysis/` (docmgr, doctor clean, status complete)
- **Report:** `.../reference/02-report-stdlib-lattice-the-lattices-of-dataflow-analysis.md`; diary at `.../reference/01-implementation-diary.md`; probe at `.../scripts/01-sccp-flat-lattice.mjs`

## What changed

- `src/stdlib/lattice/lattices.ts` (new) — the move: `Lattice` interface, set, flat, interval (widen up-to thresholds), map lattices, unchanged except a local one-line `Json` type (the library imports nothing outside `src/stdlib/`)
- `src/framework/dataflow/lattices.ts` — now the re-export seam; solver, analysis, `typed/analyses.ts` and `workbench.ts` keep their imports unchanged
- `src/stdlib/index.ts` — `lattice/` admitted (moved from "Later modules"); names re-exported
- `src/typed/sccp.ts` — **unchanged**: its lattice is the library flat lattice's *dual* — a meet semilattice descending from ⊤ over i32/f32-tagged constants; probe 01 prints both operation tables and shows agreement only under a TOP↔BOT relabeling, so it is not the same lattice (the `Lattice` interface fixes `bottom`/`join` orientation)
- `tests/stdlib/lattice.test.mjs` (new) — the laws on each lattice over generated pools (every pair and triple of a small universe): join commutative/associative/idempotent, bottom identity, chain stabilization, encode/decode round-trips, the map's missing-key-is-inner-bottom case, widening as an upper bound on every generated pair, exact threshold jumps, and stabilization of a chain walking past every threshold; plus the seam identity
- `tests/framework/layering.test.mjs` — the one existing test updated: "framework imports nothing outside src/framework" now admits the `stdlib/` prefix, because the v7 design puts the library below the framework and this step's seam is the first such import; nothing else in any suite changed, no assertion weakened

## Acceptance (on last commit `9a4a447`)

- **My tests:** `tests/stdlib/lattice.test.mjs` 18/18 pass
- **Baselines:** `02-baselines.mjs check` prints **`no differences`**
- **Suites:** stdlib 25/25 · framework 243/243 · typed 186 pass, 0 fail, 2 skipped (pre-existing `IRWB_CANDELA` gates) · workbench 24 pass, 1 skipped (pre-existing) · tensor 45/45 (`*-gpu` excluded)
- `npm run check` clean; `node tools/build-site.mjs` builds (50 projects, 131 source files)

## Left out / notes on the brief

- `flatLattice` moves as the ticket names it but has **no repository caller today** (SCCP was the candidate; see above). The module's clients are `typed/analyses.ts` and `workbench.ts` behind the framework seam, both with their old copy deleted by the move.
- The fixpoint solver and `typed/analyses.ts` untouched — other steps own them now.
- The brief's acceptance list was accurate; the only surprise was that the framework layering test encoded the pre-library import rule, which the seam necessarily breaks (reported above).

**Last commit:** `9a4a447`
