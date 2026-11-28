---
Title: 'Report: stdlib/lattice, the lattices of dataflow analysis'
Ticket: IRWB-048-A
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "What IRWB-048-A built: the framework's lattices moved to src/stdlib/lattice, the framework re-exporting them at a seam, the lattice laws as tests, and why SCCP's lattice is not the library's flat lattice."
LastUpdated: 2026-11-27
WhatFor: "The report of IRWB-048-A."
WhenToUse: "Reviewing what the standard library's lattice step delivered."
---

# Report: stdlib/lattice, the lattices of dataflow analysis

## What changed

- `src/stdlib/lattice/lattices.ts` (new) — the move, not a rewrite: the `Lattice` interface,
  `setLattice`, `flatLattice`, `intervalLattice` (with widening up-to thresholds) and `mapLattice`
  from `src/framework/dataflow/lattices.ts`, byte-for-byte except that the framework's `Json` type
  is defined locally (one line, structurally identical), because the library imports nothing
  outside `src/stdlib/`.
- `src/framework/dataflow/lattices.ts` — now the seam: a doc comment and `export *` of the library
  module. Its callers (`solver.ts`, `analysis.ts`, `typed/analyses.ts`, `workbench.ts`) keep their
  imports and behaviour unchanged; `dist/framework/dataflow` still exports every old name.
- `src/stdlib/index.ts` — `lattice/` moves from "Later modules" to "What exists now" and its names
  are re-exported from the index.
- `src/typed/sccp.ts` — **unchanged**; see below.
- `tests/stdlib/lattice.test.mjs` (new) — the lattice laws over generated pools (below).
- `tests/framework/layering.test.mjs` — updated, the one existing test this step changes (below).
- Ticket: this diary, this report, and `scripts/01-sccp-flat-lattice.mjs`.

## Clients

The library module is admitted with the framework's dataflow layer as its seam-carrying client and
two callers behind that seam, both with their old copy deleted by the move: `typed/analyses.ts`
(`setLattice` for liveness and reaching, `mapLattice(intervalLattice(...))` for ranges) and
`workbench.ts` (`wb.lattice.set/map/interval` for user-defined analyses); `solver.ts` and
`analysis.ts` take its `Lattice` type. `flatLattice` moves as part of the module the ticket names
but has no repository caller today — SCCP was the intended one, and it stays on its own lattice
(below); its first caller will be whatever needs an ascending flat lattice.

## Why SCCP does not use the library's flat lattice

The brief: "make it use the library's flat lattice if that is the same lattice; if it is not, say
why in your report and leave it." It is not the same lattice, so it is left. `scripts/01-sccp-flat-lattice.mjs`
prints both operation tables side by side: they agree on every generated pair only under the
relabeling TOP↔BOT. SCCP is a *reductive* analysis — names start at ⊤ and descend by `meet`, whose
identity is ⊤ and whose absorbent (two distinct constants) is ⊥ — while the library's flat lattice
ascends from 'unknown' by `join` (identity ⊥, absorbent 'varies'). The same three levels in the
opposite order are the **dual** lattice, and `Lattice` fixes the orientation (`bottom()`, `join`):
using it would mean calling `join` for `meet` and `bottom` for ⊤, the library's names inverted.
SCCP's constants also carry an i32/f32 tag (`const(1:i32) ≠ const(1:f32)`) that `Flat<T>` would
wrap in a value object and compare as untyped JSON. This is the design doc phase-2c decision point:
the adapter does not retire the domain copy, so the domain copy stays.

## The lattice laws (tests/stdlib/lattice.test.mjs)

Each lattice is checked over a *generated* pool — every element of a small universe, so every pair
and triple is a case, not a sample:

- `set`: all 8 subsets of {1,2,3}. `flat`: bottom, top and 9 JSON values. `interval`: 9 intervals
  within i32. `map(set)`: 8 maps over keys {a,b,x}, one with a key present at the inner bottom —
  the case a careless extraction gets wrong: a missing key *is* the inner bottom under `equal`,
  `join` and `encode`.
- Laws per lattice: join commutative, associative, idempotent; bottom its identity; an increasing
  chain joined element by element stabilizes within the pool's size (the termination the
  round-robin solver rests on); encode/decode round-trips every value.
- The interval widening, plain and with thresholds [-10, 3, 7, 42] over [-100, 1000]: an upper
  bound of both arguments on every generated pair; a moved bound jumps to the nearest threshold
  (not the extreme); past every threshold, the extreme in one step; a bound that did not climb
  past the old one stays; the chain `[0, i]`, i = 1..1001 stabilizes at the top within
  `thresholds.length + 2` widening steps and is then stable under further climbing.
- The seam is pinned: `framework/dataflow` re-exports the library's function objects, not copies.

## The one existing test changed

`tests/framework/layering.test.mjs`, "framework sources import nothing outside src/framework":
the seam's `export * from '../../stdlib/lattice/lattices.js'` violates the old rule, which encoded
the pre-library world. The v7 design puts the standard library below the framework (layering D),
and this step's seam is the first framework→stdlib import, so the test now admits the `stdlib/`
prefix (its comment says why); the other two assertions in the file are untouched. Nothing else in
any suite changed: no assertion was weakened, and the baselines print **no differences** — the
move changes no code path, so every RV32 image hash, instruction count, edit record and CUDA
source is bit-identical.

## Acceptance

- Your tests: `tests/stdlib/lattice.test.mjs` — 18/18 pass (laws ×4 lattices, chain stabilization,
  round-trips, the map bottom-key case, widening upper bounds ×2 variants, threshold jumps,
  chain stabilization under widening, the seam).
- Baselines: `02-baselines.mjs check` prints "no differences" after `npm run build`.
- Suites: stdlib 25/25 pass; framework 243/243; typed 186 pass, 0 fail, 2 skipped (pre-existing,
  `IRWB_CANDELA`-gated); workbench 24 pass, 1 skipped (pre-existing); tensor 45/45 (the `*-gpu`
  files excluded, as instructed).
- `npm run check` (tsc) clean; `node tools/build-site.mjs` builds (50 projects, 131 source files).

## Left out

- `flatLattice` has no repository client yet (SCCP was the candidate; see above). It moves because
  the ticket names it; if a later step wants it gone, deleting it touches only this module and the
  index.
- The fixpoint solver (`dataflow/solver.ts`) and `typed/analyses.ts` are other steps' scope now;
  the solver could later become the `flow/` fixpoint module listed in the index, over this
  library's `Lattice`.
- `physicalOccupancy`-style bitset lattices and any narrowing operator: not named by the ticket.
