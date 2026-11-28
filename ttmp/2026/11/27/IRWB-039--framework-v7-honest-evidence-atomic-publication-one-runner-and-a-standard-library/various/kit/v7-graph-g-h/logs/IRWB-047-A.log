Done. The working tree is clean, the coordinator's ticket is untouched, and every acceptance item was verified on the final code state.

## Ticket and report

- Ticket: `ttmp/2026/11/27/IRWB-047-A--stdlib-graph-depth-first-orders-dominators-natural-loops/`
- Report: `.../reference/02-report-graph-in-the-standard-library.md` (diary: `.../reference/01-implementation-diary.md`; design: `.../design/01-...md`; probe: `.../scripts/01-graph-clients.mjs`)

## What changed

- `src/stdlib/graph/orders.ts` (new) — `Digraph {nodes, entry, succ}` and `depthFirst`: postorder, reverse postorder, retreating edges (successors outside `nodes` are not walked, replacing `cfgOf`'s dangling-jump guard)
- `src/stdlib/graph/dominators.ts` (new) — `dominators` (CHK, verbatim, with `rounds`), `domTree` (children + `dominates`), `naturalLoops` (one loop per header, all latches); predecessors derived internally
- `src/stdlib/index.ts` — exports the graph module; moves it from "later" to "exists now"
- `src/typed/analyses.ts` — `cfgOf` takes the rpo from the walk; `dominatorsOf`/`domView` are thin adapters over the library; `loopsOf` takes head/latches/body from `naturalLoops` (preheaders/exits/assigned stay); new `digraphOf(f)`; all old copies deleted
- `src/typed/ssa.ts` — calls `dominators(digraphOf(f))` directly (second client of the dominators module)
- `src/framework/dataflow/solver.ts` — `depthFirst` is an adapter over the library walk (loop heads = retreating-edge targets); only change in `src/framework/`
- `tests/framework/layering.test.mjs` — the one existing test this step is meant to change: framework may now import `src/stdlib` (the v7 plan's phase 2c moves "the framework solver's helpers"; stdlib is below framework)
- `tests/stdlib/graph.test.mjs` (new) — every primitive on small graphs, plus the three required cases with a statement per primitive

## Acceptance results

- **My tests:** 9 new graph tests, all pass (incl. unreachable block, two-back-edge header, irreducible cycle, solver adapter pin); probe on the corpus: 135 functions, 80 loops, no invariant violations, adapter≡library on idom+rounds
- **Baselines:** `02-baselines.mjs check` → `no differences`
- **Suites:** typed 186 pass / 0 fail / 2 skipped (pre-existing Candela-gated); framework 243 pass; workbench 24 pass; stdlib 16 pass; tensor non-gpu 45 pass
- **`npm run check`** clean; **`build-site`** builds (app.js 3108 KiB); Prettier clean on all files touched (9 untouched files elsewhere in `src/` still drift as before)

## Left out / notes on the brief

- Dominance frontiers stay in `ssa.ts` (they run over Typed's virtual `^entry`); `backend/frequency.ts` keeps its own rpo (appends unreachable blocks — a scheduling choice, and outside the named scope); `labs/expressions.ts` postorder stays
- The brief understates one thing: the framework layering test forbade the solver from importing the library, so making the solver a client required changing that boundary (one line, reported above), which the v7 plan's phase 2c sanctions

**Last commit:** `435ef9c` (code commit: `0207526`)
