---
Title: Implementation diary
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
      Note: the library module, moved from framework/dataflow/lattices.ts
    - Path: src/framework/dataflow/lattices.ts
      Note: now a re-export shim
    - Path: src/typed/sccp.ts
      Note: second client, on the library's flat lattice
    - Path: tests/stdlib/lattice.test.mjs
      Note: the laws, the widening and the one-copy test
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T20:10:00-05:00
WhatFor: ""
WhenToUse: ""
---


# Implementation diary: stdlib/lattice

## Step 1 — reading the ground, and what the brief asks that the code does not do yet

Read `src/stdlib/index.ts` (admission rule R3: a named algorithm or law, two clients, an executable
test; the layering D), `src/stdlib/flow/liveness.ts` and `tests/stdlib/` (the layering test is a
source-import check: no `.ts` under `src/stdlib/` may resolve a relative import outside `src/stdlib/`).
Read `src/framework/dataflow/lattices.ts` (157 lines: `Lattice<V>`, `setLattice`, `flatLattice` with
`TOP`/`BOT` and `Flat<T>`, `intervalLattice` with the up-to widening and thresholds, `mapLattice`, the
`lattice` aggregate) and `src/typed/sccp.ts` (the three-level private lattice `Lat` with `TOP`/`BOT` as
`{k:'top'}`/`{k:'bot'}`, `same`, `meet`, used at six places in `sccpOf`).

Two constraints came out of the reading, and both changed what I had to touch:

1. The lattices module imports `Json` from `../core/types.js`, and the library may not import it. So
   the library declares its own `Json`. Probe `scripts/01-flat-json-constraint.ts` (tsc, `--strict`,
   exit 0) confirms the two declarations are mutually assignable and that an SCCP constant shape
   `{ v: number; t: 'i32' | 'f32' }` satisfies `T extends Json` — a **type alias** gets an implicit
   index signature, an interface would not.
2. `tests/framework/layering.test.mjs` asserted that `src/framework/**` imports nothing outside
   `src/framework`. A framework re-export of a library module cannot satisfy that. This is a test
   asserting exactly the behaviour the step changes, so it is amended rather than worked around, and
   named in the report.

## Step 2 — the move itself

`src/stdlib/lattice/lattices.ts`: the module, copied from the framework file (interface, four
lattices, aggregate, thresholds widening — all unchanged) with a new header stating the lattice laws
it serves, the "same lattice" criterion (element set, order through `join`/`equal`, height), and why
`Json` is declared locally. `src/stdlib/index.ts` gains the exports and its "what exists now" line.

Then the probe already paid off: the first shim import was `'../stdlib/lattice/lattices.js'` from
`src/framework/dataflow/lattices.ts`, which resolves to `src/framework/stdlib/...`. `npm run check`
said `TS2307` for every caller; the fix is two levels (`../../stdlib/...`). `npm run check` then
clean, and `typed/analyses.ts` and `workbench/workbench.ts` compiled without a single edit — the
re-export does keep its callers working, as the brief requires.

`tests/framework/layering.test.mjs`: the rule becomes "nothing outside `src/framework` except
`src/stdlib/`", with the reason in the header comment (the library sits below the framework and
imports nothing outside itself).

## Step 3 — SCCP, and the naming trap

The SCCP lattice is the flat lattice: three levels, constants compared structurally, JSON-encodable
elements. So `Lat = Flat<Const>` with `Const = { v: number; t: 'i32' | 'f32' }`, and `meet` is the
library's `join`. The element spelling changes (`{k:'const',v,t}` -> `{value:{v,t}}`), and one existing
assertion spells the element out; `tests/typed/ssa.test.mjs:102` is updated to the new shape and named
in the report.

The trap the extraction has, which the brief asks for: the names are **not** a mechanical rename.
Wegman and Zadeck put "not yet seen to execute" at ⊤ and "varies" at ⊥, i.e. the *opposite* of the
join order, and `sccp.ts` used those names literally: its `TOP` is the lattice's bottom and its `BOT`
the top. My first pass at the port swapped `BOT`/`TOP` at only some of the six uses, and the A2 test
failed immediately:

```
✖ A2: sccp finds the constant behind a decided branch, which constprop cannot see
  actual: 'varies'   expected: { value: { v: 7, t: 'i32' } }
```

The phi accumulator went to the top instead of the bottom. Corrected mapping, by use: a parameter is
the top (it varies), every other name starts at the bottom; an unfolderable operator and a trapping
division are the top; an argument at the top makes the result the top and one at the bottom makes it
the bottom; the phi accumulator starts at the bottom; a *varying* condition marks both edges. The
header comment now records the reversal, so the next reader does not repeat it.

Probe `scripts/02-sccp-flat-lattice-equivalence.mjs` settles the question the brief asks ("is it the
same lattice"): it enumerates the old element domain (5 values: ⊤, ⊥, three constants) and checks all
25 pairs under the mapping old-⊤ -> `BOT`, old-⊥ -> `TOP`, constant -> `{value}`: join agrees with the
old `meet` and `equal` agrees with the old `same`. Output:
`the flat lattice is SCCP's lattice: 25 pairs agree on join and equal; the old top is BOT, the old bot is TOP`.

## Step 4 — the tests

`tests/stdlib/lattice.test.mjs`, 17 tests, with the law checked on **every** triple of a finite
element domain (the laws are universal statements; a sample is only evidence):

- set (`subsets([1,2,3])`, 8 values, 512 triples), flat (`BOT`, `TOP`, three constants, 5 values),
  map (`mapLattice(flat)` over two keys, 16 values), interval (`intervalLattice(-4, 4, [-2, 2])`,
  16 values, 4096 triples): join commutative, associative, idempotent; bottom the left and right
  identity; encode/decode a round trip.
- widening, on each lattice: an upper bound of both arguments and a member of the lattice, for every
  pair; then a chain from the bottom that joins the next generated value and widens, for every value
  and again for as many steps: non-decreasing, and constant from the step at which every generated
  value has been joined once. That step count is the number of generated values, and it is an
  argument, not a round number: `widen(x, y) ⊒ x` and `⊒ y`, so once every value has been joined the
  accumulator is above all of them and nothing moves again. For the finite lattices the widening is
  the join (their chains terminate because the lattice is finite); the interval lattice passes its own
  `widen`, which a solver must use.
- the interval thresholds: a moved upper bound jumps to the next threshold up (5..7 -> 10, 10..15 ->
  20, 20..40 -> 50, 50..90 -> 100 with thresholds 10/20/50), a moved lower bound to the next threshold
  down, an unmoved bound stays, a bound past every threshold reaches the extreme in one step, and the
  bottom on either side. All cases are inside the lattice's own range: I first wrote
  `widen([0,100], [1000,2000])` on a `[0,100]` lattice and it correctly failed the upper-bound check,
  because a `next` outside `[min, max]` is not an input of this lattice.
- a growing loop bound widened at a loop head walks the thresholds one at a time and stops:
  `[0,5], [0,10], [0,20], [0,30], [0,40], [0,100]`.
- the aggregate `lattice` exposes the four constructors and both flat values, and
  `dist/framework/dataflow/index.js` exports the **same** functions — one copy, not two.

## Step 5 — acceptance runs

- `npm run build`, then the coordinator's baselines:
  `no differences from .../various/baselines/main.json` — RV32 image hashes, instruction counts and
  edit records for r0, O2 and `speed` on every corpus project, and the CUDA source and `optimizeTix`
  revisions for every Tix program.
- `npm run check`: clean. `node tools/build-site.mjs`: `dist/site built in 2169 ms ... 131 source files`.
- `npx prettier --check "src/**/*.ts"`: only the files that were already unformatted; the four files I
  touched (three sources plus `sccp.ts`, which was formatted at HEAD and so was formatted again) pass.
- suites, files passed explicitly as Node 24 requires, `*-gpu.test.mjs` excluded:
  - `tests/stdlib/*.test.mjs tests/framework/*.test.mjs`: 267 pass, 0 fail (my 17 included);
  - `tests/workbench/*.test.mjs`: 24 pass, 0 fail, 1 skipped (`IRWB_FULL=1` gate, pre-existing);
  - `tests/typed/*.test.mjs`: 186 pass, 0 fail, 2 skipped (`IRWB_CANDELA=1` gate, pre-existing);
  - `tests/tensor/{corpus,cuda,fusion,language,passes,r3-tix-in-plans,schedule}.test.mjs`: 45 pass, 0 fail.
- `scripts/03-sccp-corpus.mjs` over all 50 corpus projects: every `sccp` application accepted, every
  program verifies, 155 constants written across 15 projects. Run once against the pre-change sources
  (`git checkout 3ba86fc -- src/typed/sccp.ts src/framework/dataflow/lattices.ts src/stdlib/index.ts`,
  rebuild) and once against the step's sources: `03-sccp-corpus.before.txt` and `.after.txt` are
  **identical**, per-project fingerprints included.

## What did not go well, and what I would do differently

- The BOT/TOP swap: I mapped the lattice values by *name* instead of by *use* on the first edit. The
  existing A2 test caught it in seconds, which is the argument for porting a client with its test
  running rather than after the migration.
- The chain-stabilization bound: my first version was "stable by step `height`", which is a bound on
  the number of *changes*, not on the step index, and it failed on the set lattice (the third element
  arrived at step 5). The correct statement is about the number of generated values; the per-lattice
  heights are the reason a limit exists, not the reason the step count bounds it.
- I trusted `prettier --check` on stdin for `sccp.ts` and it reported nothing; `--check` with
  `--stdin-filepath` is not meaningful, comparing the piped output to the file is. `sccp.ts` was
  formatted at HEAD, so it had to be formatted again after my edit.
