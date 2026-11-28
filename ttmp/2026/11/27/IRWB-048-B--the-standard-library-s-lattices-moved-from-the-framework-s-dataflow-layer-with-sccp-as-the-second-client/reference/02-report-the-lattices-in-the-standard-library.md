---
Title: 'Report: the lattices in the standard library'
Ticket: IRWB-048-B
Status: active
Topics:
    - compiler
    - ir
    - typescript
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/stdlib/lattice/lattices.ts
      Note: the moved module
    - Path: src/framework/dataflow/lattices.ts
      Note: the re-export shim
    - Path: src/typed/sccp.ts
      Note: the second client
    - Path: tests/stdlib/lattice.test.mjs
      Note: the laws and the widening
    - Path: tests/framework/layering.test.mjs
      Note: amended import rule
    - Path: tests/typed/ssa.test.mjs
      Note: one assertion on the lattice element's shape
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T20:30:00-05:00
WhatFor: ""
WhenToUse: ""
---


# Report: `stdlib/lattice`

## What this step is

The framework's dataflow lattices moved into the standard library, unchanged, and the framework's
`dataflow` layer re-exports them, so the framework's callers and the workbench's `wb.lattice` bind
them with no edit at all. The second client is SCCP (`src/typed/sccp.ts`), which now runs on the
library's flat lattice. The solver (`src/framework/dataflow/solver.ts`) and `src/typed/analyses.ts`
are untouched, as the brief requires.

## Files, one line each

- `src/stdlib/lattice/lattices.ts` (new): `Lattice<V>` and the set, flat, interval (with the up-to
  widening and thresholds) and map lattices plus the `lattice` aggregate, moved from the framework's
  file; new header stating the laws, the "same lattice" criterion and why `Json` is declared locally.
- `src/stdlib/index.ts`: exports the lattice module and records it under "what exists now".
- `src/framework/dataflow/lattices.ts`: now one `export * from '../../stdlib/lattice/lattices.js'` and
  a header saying where the lattices went; 157 lines down to 10.
- `src/typed/sccp.ts`: `Lat = Flat<Const>`, `meet = flatLattice<Const>().join`, and the top/bottom
  naming corrected at all six uses (the W-Z names are the reverse of the join order).
- `tests/stdlib/lattice.test.mjs` (new): 17 tests — the join laws on every triple of each lattice's
  element domain, bottom identity, widening an upper bound of its arguments, widening chains that
  stabilize, encode/decode round trips, the threshold cases, and the framework re-export being the
  same functions.
- `tests/framework/layering.test.mjs`: the import rule now allows `src/stdlib/` (see below).
- `tests/typed/ssa.test.mjs`: one assertion updated to the flat lattice's element shape (see below).
- ticket `scripts/`: `01-flat-json-constraint.ts` (the type probe), `02-sccp-flat-lattice-equivalence.mjs`
  (old lattice vs library lattice, 25 pairs), `03-sccp-corpus.mjs` with its `before`/`after` outputs
  (SCCP over all 50 corpus projects, identical).

## Is SCCP's lattice the flat lattice? Yes

Three levels, constants compared structurally, elements finite JSON — with one reversal of names.
Wegman and Zadeck write "not yet seen to execute" as ⊤ and "varies" as ⊥, which is the opposite of
the join order; `sccp.ts` used those names literally, so its `TOP` was the lattice's **bottom** and its
`BOT` the **top**. The port maps old-⊤ → `BOT`, old-⊥ → `TOP`, old constant → `{value: {v, t}}`, and
`scripts/02-sccp-flat-lattice-equivalence.mjs` checks all 25 pairs of the old element domain: join
agrees with the old `meet`, equality agrees with the old `same`. The only behavioural risk left was
the mapping at each of the six uses, and `scripts/03-sccp-corpus.mjs` closes it: all 50 projects
accept the pass and verify, 155 constants written across 15 projects, and the per-project
fingerprints are byte-identical to the run against the pre-change sources (`03-sccp-corpus.before.txt`
vs `.after.txt`).

SCCP's element spelling did change: a value is now `{value: {v, t}}` / `'unknown'` / `'varies'`
instead of `{k:'const', v, t}` / `{k:'top'}` / `{k:'bot'}`. `src/typed/sccp.ts` is the only reader of
that shape.

## Two existing tests changed, with reasons

- `tests/framework/layering.test.mjs` asserted that `src/framework/**` imports nothing outside
  `src/framework`. A framework re-export of a library module cannot satisfy that; the step's brief
  requires the re-export. The rule is now "nothing outside `src/framework`, except `src/stdlib/`", the
  direction being framework → library while the library imports nothing outside itself (still checked
  by `tests/stdlib/layering.test.mjs`). Nothing else about the assertion was weakened: every other
  outside import still fails it.
- `tests/typed/ssa.test.mjs:102` asserted the phi's lattice value as `{ k: 'const', v: 7, t: 'i32' }`.
  The fact it asserts (name is 7, typed i32) is unchanged; the element is now
  `{ value: { v: 7, t: 'i32' } }`. No other assertion in the suites was touched.

## Acceptance

- **Tests** (`tests/stdlib/lattice.test.mjs`, 17): pass. Laws checked exhaustively over the element
  domains (8 set values / 512 triples, 5 flat, 16 map, 16 interval / 4096 triples); widening an upper
  bound of both arguments for every pair; chains stable within the number of generated values (the
  argument is in the module comment of the test); the threshold widening: 5..7 → 10, 10..15 → 20,
  20..40 → 50, 50..90 → 100, a bound past every threshold → the extreme in one step, and a growing
  loop bound walking `[0,5], [0,10], [0,20], [0,30], [0,40], [0,100]`.
- **Baselines**: `node .../IRWB-039.../scripts/02-baselines.mjs check` after `npm run build` →
  `no differences from .../various/baselines/main.json` (RV32 image hashes, instruction counts and
  edit records at r0, O2 and `speed`; CUDA sources, fused and unfused, and `optimizeTix` revisions).
- **Suites** (files given explicitly, `*-gpu.test.mjs` excluded): `tests/stdlib` + `tests/framework`
  267 pass / 0 fail; `tests/workbench` 24 pass / 0 fail / 1 pre-existing skip (`IRWB_FULL=1`);
  `tests/typed` 186 pass / 0 fail / 2 pre-existing skips (`IRWB_CANDELA=1`); `tests/tensor`
  (corpus, cuda, fusion, language, passes, r3-tix-in-plans, schedule) 45 pass / 0 fail.
- `npm run check` clean; `node tools/build-site.mjs` builds (`131 source files`);
  `prettier --check "src/**/*.ts"` clean on every file this step touched.

## Left out, and one thing to know

- **Later:** the solver (`solver.ts`) and `analyses.ts` are another step's, so the lattice module
  exposes `widen` exactly where it did before (on the interval lattice and on the map's inner
  lattice's height) and nothing else; a `widen` on the `Lattice` interface itself, which would let a
  solver widen any lattice, is not this step.
- **Not in the brief, worth a line:** the framework now depends on `src/stdlib/`, one direction only.
  If the intended layering is that the framework has no dependency at all on the library, the
  re-export the brief asks for contradicts it, and one of the two has to give.
- The interval lattice's `widen` is defined on an ascending pair within `[min, max]`; a `next` outside
  the lattice's range (as in my first, wrong test case `widen([0,100], [1000,2000])` on a `[0,100]`
  lattice) is not an input of that lattice, and the upper-bound property does not hold there.
