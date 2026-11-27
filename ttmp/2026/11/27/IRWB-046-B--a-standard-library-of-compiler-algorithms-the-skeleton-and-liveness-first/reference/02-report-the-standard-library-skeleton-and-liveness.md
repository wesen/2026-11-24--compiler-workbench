---
Title: 'Report: the standard library skeleton and liveness'
Ticket: IRWB-046-B
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
Summary: "What IRWB-046-B built: src/stdlib with liveness as its first primitive, both clients on it, byte-identical images."
LastUpdated: 2026-11-27
WhatFor: "The report of IRWB-046-B."
WhenToUse: "Reviewing what the standard library's first step delivered."
---

# Report: the standard library skeleton and liveness

## What changed

- `src/stdlib/flow/liveness.ts` — the primitive: `liveness(graph, scope)` over `LiveBlock` (upward-
  exposed `uses`, `defs`, successor indices) and `LiveGraph` (blocks, optional entry, default 0), with
  `reachableBlocks` for the entry-reachable scope. Backward sweeps from the empty sets, unchanged in
  shape from the code it replaces.
- `src/stdlib/index.ts` — the index: what exists now, the layering rule (layering D), and one line per
  later module: `graph` dominators and loops, `lattice`, `num`, the `flow` fixpoint solver, `ssa`,
  `term`, `affine`, `pe`, `check`, `measure`.
- `src/typed/backend/regalloc.ts` — `intervals` calls `liveness(..., 'all-blocks')`; the hand-written
  sweep is deleted. `Intervals.liveOut` narrows to `ReadonlySet<number>[]` (nothing outside the file
  reads it; the fold, interval stretch and `touch` walk are untouched).
- `src/typed/backend/coalesce.ts` — `coalesceCopies` makes the same call for its live-out sets; the
  hand-written sweep is deleted, the per-instruction interference walk is untouched.
- `tests/stdlib/liveness.test.mjs` — exact in/out sets on a CFG with a loop; the trap case under both
  scopes; upward exposure; a non-zero entry; the machine scope pinned through `intervals()` on
  hand-built machine code of the trap shape.
- `tests/stdlib/layering.test.mjs` — fails if a module under `src/stdlib/` resolves an import outside
  `src/stdlib/` (which covers `src/framework/`, `src/typed/`, `src/tensor/` and every other domain),
  plus one end-to-end import of the index.
- `scripts/01-liveness-scopes.mjs` — the probe: the trap case printed under both scopes.

## The scope decision, and why the machine clients use 'all-blocks'

The interface takes a *required* scope. On the trap case (block 0 jumps to the join; block 1, which
no path from the entry reaches, also jumps to the join; the join uses 64 and 65):

- `'all-blocks'`: block 1's live-out is the join's live-in, `{64, 65}` — what the machine sweeps have
  always produced, and what `regalloc` and `coalesce` now ask for. An unreachable block is still laid
  out and its instructions still need registers, so its live-out is computed like any other block's.
- `'entry-reachable'`: block 1's sets stay empty — the framework solver's answer.

The two differ only on unreachable blocks (a reachable block's successors are reachable, so no
reachable block ever joins a fact from an unreachable one). Byte-identical images require
'all-blocks'; the uniqueness of the least fixpoint guarantees the move itself changes no set.

## Acceptance (on the last commit)

- `tests/stdlib/*.test.mjs`: 7 tests, 7 pass.
- `tests/typed/backend.test.mjs`: 14 tests, 14 pass, unchanged.
- Baselines: `node .../IRWB-039.../scripts/02-baselines.mjs check` (after `npm run build`) prints
  `no differences` — the RV32 images, instruction counts and edit records of every corpus project and
  the CUDA sources and revisions of every Tix program are unchanged, so the allocator and coalescer
  produce byte-identical output.
- Suites (`tests/typed`, `tests/framework`, `tests/workbench`, `tests/tensor` minus `*-gpu`, plus
  `tests/stdlib`): 507 tests, 496 pass, 0 fail, 3 skipped (candela, env-gated before this step),
  8 todo (F27, F33–F38: the other steps' tests, untouched).
- `npm run check` (tsc) is clean; `npm run format:check` warns on 9 files that were already
  unformatted before this step and that it does not touch. `tools/build-site.mjs` was not run: this
  step changed no `src/framework/` or `src/workbench/` file.

## Left out, on purpose

- `physicalOccupancy` in `regalloc.ts` is a third copy of the same equations, but packed into
  bitsets over *physical* registers with call-clobber semantics and a per-instruction walk; the
  interface it needs (a join over bitsets, or a generic value type) is the `lattice`/`flow` solver's
  job, so it stays a domain copy until that module exists (the design doc's 2c decision point: an
  adapter larger than the algorithm it replaces is not an extraction).
- A generic value type (strings as well as numbers): both clients and Typed's analyses number their
  names; the primitive grows the parameter when a client needs it.
- The later modules in `index.ts` are one-line claims only; each enters under the admission rule
  (named algorithm, two clients, an executable test).

Nothing in the brief or the existing tests looked wrong. No `todo` test existed for this step: the
acceptance's tests are the ones this step adds, so there was no `todo` option to remove.
