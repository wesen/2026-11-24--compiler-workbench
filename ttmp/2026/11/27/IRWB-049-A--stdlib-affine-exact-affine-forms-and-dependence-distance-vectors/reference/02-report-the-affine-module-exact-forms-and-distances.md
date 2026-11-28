---
Title: '02 report: the affine module, exact forms and distances'
Ticket: IRWB-049-A
Status: active
Topics:
    - compiler
    - ir
    - typescript
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27
WhatFor: ""
WhenToUse: ""
---

# 02 report: the affine module, exact forms and distances

## What changed, file by file

- `src/stdlib/affine/forms.ts` (new): the affine forms (`constant`, `variable`, `add`, `substitute`,
  `value`, `plain`) moved from `src/tensor/model.ts`. **The correctness fix:** `add` computes every
  coefficient as a BigInt, so no intermediate can round; the admission check — every coefficient a
  safe integer, error `Affine integer overflow` — is unchanged. R3's case
  `add(constant(-MAX_SAFE_INTEGER), constant(4503599627370497), 3).constant` now returns the exact
  4503599627370500 instead of one more.
- `src/stdlib/affine/distances.ts` (new): `distanceVector(axes, indices)` — the dependence distance
  at each position, the consumer's axis minus the read's index — and `isZero`. Pure forms in, forms
  out; no domain types, imports nothing outside `src/stdlib/`.
- `src/stdlib/index.ts`: exports the module; the catalogue moves `affine/` to "What exists now".
- `src/tensor/model.ts`: the domain copy is deleted; the model imports and re-exports the library's
  forms, so every Tix file (parser, passes, ir, contract, evaluate, cuda-*) calls the library. First
  client.
- `src/tensor/fusion.ts`: only `joinDepth` — the read loop is rewritten on `distanceVector`/`isZero`
  (a read joins at depth `k` exactly where its leading `k` distances are zero); the reason strings
  are byte-identical. Second client.
- `tests/stdlib/affine.test.mjs` (new): 9 tests — R3's case, the same rounding on a term coefficient,
  overflow rejection, moved-behaviour sanity (terms combine/cancel/sort, substitute, plain, value),
  distance vectors with known answers (aligned, shifted, transposed, constant index), and the client
  through `planFusion` (aligned joins; shifted, transposed and constant refuse with the old reasons;
  a trailing shift narrows the block domain to block mode).
- `scripts/01-affine-rounding-probe.mjs`: reproduces R3's case (prints `WRONG by 1` on the old code,
  `exact` after).
- `scripts/02-acceptance-suites.sh`: runs the acceptance suites one file at a time (no `*-gpu` files)
  into `various/suite-results.txt`.

Admission rule: named algorithms (exact affine arithmetic; dependence distance vectors), two clients
(the Tix model's re-export, used by the whole domain, and `joinDepth`), executable tests, code moved
not copied, no existing test weakened.

## Acceptance results

- **My tests:** `node --test tests/stdlib/affine.test.mjs` — 9/9 pass.
- **Baselines:** `02-baselines.mjs check` prints `no differences` (RV32 image hashes, instruction
  counts and edit records under r0/O2/`speed`; CUDA source and `optimizeTix` revisions for every Tix
  program — byte-identical).
- **Suites** (script 02, `various/suite-results.txt`): 75 files, 0 failures — typed 37, framework 20,
  workbench 5, stdlib 3, tensor 10 (no `*-gpu`). Three pre-existing, env-gated skips
  (`IRWB_CANDELA=1`), untouched by this step.
- `npm run check` (tsc): clean. `npm run build`: clean. Prettier: clean on all changed `src/` files.
- `node tools/build-site.mjs`: builds (site rebuilt, 50 projects).

## Notes for the brief

- `value` keeps its double evaluation: it evaluates a form at concrete environment values and returns
  that number, and the brief fixes the defect in `add` (R3's case is `add`'s constant). `substitute`
  is exact through `add`.
- A **shifted read of a same-extent tensor cannot reach `joinDepth` through the parser**: the bounds
  checker rejects `i + 1` (can exceed the extent) and `i - 1` (negative at the axis start), so the
  shifted cases in the client test are hand-built IR (documented in the test). A transposed read
  needs a square tensor (`Inconsistent extent` otherwise). Nothing in the corpus exercises these
  paths; the baselines confirm.
- `joinDepth`'s old test `plain(index) === axis` and the new `isZero(axis - index)` agree on every
  form the constructors build; only a hand-built form with zero-coefficient terms could tell them
  apart, and nothing builds one.
