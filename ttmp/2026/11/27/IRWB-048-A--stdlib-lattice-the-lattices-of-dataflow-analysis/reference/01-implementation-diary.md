---
Title: Implementation diary
Ticket: IRWB-048-A
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
Summary: Diary of IRWB-048-A
LastUpdated: 2026-11-27
WhatFor: "The step-by-step record of the lattice extraction into the standard library."
WhenToUse: "Resuming or reviewing IRWB-048-A."
---

# Implementation diary

## Step 1: ticket, orientation

- Created the ticket with `docmgr ticket create`. Read `src/stdlib/index.ts` (admission rule R3,
  layering D, `flow/liveness.ts` as the one existing module), the IRWB-039 design doc's phase 2c
  ("graph, lattice, ssa, moved, not rewritten; decision point: if an adapter is larger than the
  algorithm it replaces, keep the domain copy"), and `src/framework/dataflow/lattices.ts` in full:
  the `Lattice` interface, `setLattice`, `flatLattice`, `intervalLattice` (with widening up-to
  thresholds, IRWB-043-B) and `mapLattice`.
- Mapped the importers: `solver.ts` and `analysis.ts` take the `Lattice` *type*; `typed/analyses.ts`
  calls `setLattice`/`mapLattice`/`intervalLattice` (liveness, reaching, ranges); `workbench.ts`
  exposes them as `wb.lattice.*` to workbench analyses. Nothing in the repository calls
  `flatLattice` yet — its intended second client is SCCP, which the brief tells me to check.

## Step 2: the move, the seam (8799cc4)

- `src/stdlib/lattice/lattices.ts`: the file moved as it was — every function and comment
  unchanged — with one seam change: the framework's `Json` type (`core/types.js`) is defined
  locally in the module (structurally identical, one line), because the library may import nothing
  outside `src/stdlib/` (`tests/stdlib/layering.test.mjs`).
- `src/framework/dataflow/lattices.ts` becomes the re-export seam: `export *` of the library
  module, so `solver.ts`, `analysis.ts`, `typed/analyses.ts` and `workbench.ts` keep their imports
  unchanged. `dataflow/index.ts` keeps `export * from './lattices.js'`, so `dist/framework/dataflow`
  still exports `lattice`, `I32_MAX`, … with the same names.
- `src/stdlib/index.ts`: the lattice module enters under the admission rule — the `lattice/` line
  moves from "Later modules" to "What exists now", and the index re-exports its names.
- **The layering surprise:** `tests/framework/layering.test.mjs` asserts "framework sources import
  nothing outside src/framework", and the seam imports `../../stdlib/lattice/lattices.js`. The
  assertion encodes the pre-library world; the v7 design puts the library *below* the framework, and
  this step's seam is the first framework→stdlib import. Updated the test to admit `stdlib/` as an
  allowed prefix (comment updated to say why), keeping everything else it checks. Reported below.
- The first `node --test tests/framework` run found this; nothing else in the suites changed.

## Step 3: SCCP, the second client — checked, and left

- The brief: make SCCP use the library's flat lattice *if it is the same lattice*. Probe
  `scripts/01-sccp-flat-lattice.mjs` prints SCCP's `meet` table next to the library's flat `join`
  table: the two agree on every generated pair only under the relabeling TOP↔BOT. SCCP is a
  reductive analysis: names start at ⊤ and `meet` descends (identity ⊤, absorbent ⊥); the
  library's flat lattice ascends from 'unknown' with `join` (identity ⊥, absorbent 'varies'). Same
  three levels, **opposite order** — the dual lattice — and SCCP's constants carry an i32/f32 tag
  (`const(1:i32) ≠ const(1:f32)`) that `Flat<T>` would wrap and compare as untyped JSON. The
  `Lattice` interface fixes the orientation (`bottom()`, `join`), so using it would mean calling
  `join` for `meet` and `bottom` for ⊤: the library's names inverted, per the design doc's decision
  point the case to keep the domain copy. Left `src/typed/sccp.ts` unchanged; the probe is the
  evidence.

## Step 4: the tests

- `tests/stdlib/lattice.test.mjs`: the laws on each lattice over *generated* pools — every element
  of a small universe (all 8 subsets of {1,2,3} for `set`; bottom, top and 9 JSON values for `flat`;
  9 intervals for `interval`; 8 maps for `map(set)`, one with a key present at the inner bottom) —
  so every pair and triple is a case: join commutative, associative, idempotent, bottom its
  identity; an increasing chain joined element by element stabilizes within the pool's size;
  encode/decode round-trips. Widening: an upper bound of both arguments on every generated pair of
  both the plain and the threshold interval lattice; a chain `[0, i]` walking past every threshold
  stabilizes at the top within `thresholds.length + 2` steps; exact threshold jumps (nearest
  threshold, not the extreme; past every threshold the extreme in one step). The seam is pinned:
  the framework's exports are the library's function objects, not copies.
- My own mistakes while writing them, both mine (the lattices were right): `down(-5)` with
  all-positive thresholds is the min, so the threshold set gained `-10`; `up(2)` is the nearest
  threshold *above* 2, and a bound stays only when it did not climb past the old one.
- The map lattice's careless-extraction case is explicit: a key present with the inner bottom
  equals the key missing (`equal`, `join`, and `encode` must all read it that way).

## Step 5: acceptance

- `npm run build` and `npm run check` clean; `npx prettier --check` clean on every source file I
  touched (the new `src/stdlib/lattice/lattices.ts`, `src/stdlib/index.ts`, the seam, and
  `tests/framework/layering.test.mjs`, which was formatted before; the new test files formatted to
  match).
- `02-baselines.mjs check`: **no differences** — RV32 image hashes, instruction counts, edit
  records, CUDA sources, `optimizeTix` revisions all unchanged (the move changed no code paths).
- Suites: stdlib 25/25, framework 243/243, typed 186 pass + 2 pre-existing env-gated skips
  (`IRWB_CANDELA`), workbench 24 pass + 1 skip, tensor 45/45. `tools/build-site.mjs` builds
  (131 source files).
