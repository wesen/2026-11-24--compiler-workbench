---
Title: 'Report: F34 honest evidence for recorded checks'
Ticket: IRWB-040-C
Status: complete
Topics:
    - compiler
    - verification
    - ir
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - src/framework/contracts/assurance.ts
    - src/framework/contracts/analysis-manager.ts
    - src/framework/contracts/differential.ts
    - src/framework/contracts/types.ts
    - src/framework/contracts/README.md
    - tests/framework/r3-defects.test.mjs
ExternalSources: []
Summary: "A recorded invariant check now carries checked-sampled, checked-exact or plain checked, decided from its evidence; sampled and exhaustive are distinguishable and no evidence, no method or an unknown method is ever exact. Baselines unchanged, all suites green."
WhatFor: "Deciding whether step F34 of IRWB-039 is done"
WhenToUse: "Before merging this branch, or when a later step needs to map its own method names to assurance"
LastUpdated: 2026-11-27T18:25:00-05:00
---

# Report: F34 honest evidence for recorded checks

Step F34 of IRWB-039 phase 1b, ticket IRWB-040-C. Diary: `reference/01-implementation-diary-f34-honest-evidence.md`.
Probe: `scripts/01-assurance-mapping.mjs`.

## What was wrong

`AnalysisManager.invariantInternal` stamped every invariant check `assurance: 'checked'`, whatever its evidence said,
and `assuranceOf` — the one function that read `evidence.method` — had no caller in `src/`, answered
`'checked-exact'` for anything whose method was not exactly `'sampled'`, and so called no evidence and a misspelled
method exact. Reproduced before the change with R3's probe:

```
1. sampled …: ok true | assurance checked | evidence.method sampled
2. exhaustive over u8 …: ok true | assurance checked | evidence.method exhaustive
   same assurance recorded for both: true
3. assuranceOf(undefined) checked-exact | assuranceOf({method:'typo'}) checked-exact
```

## What changed, file by file

| File | Change |
| --- | --- |
| `src/framework/contracts/assurance.ts` (new, 22 lines) | `assuranceOf(evidence)`: `sampled` → `checked-sampled`; `exhaustive`, `exhaustive-32`, `proof` → `checked-exact`; no evidence, no `method`, a non-string method or any other name → `checked`. |
| `src/framework/contracts/analysis-manager.ts` | one import, and `assurance: assuranceOf(result.evidence)` in `invariantInternal` (was the constant `'checked'`). |
| `src/framework/contracts/differential.ts` | the old `assuranceOf` body is replaced by `export { assuranceOf } from './assurance.js';`, so `dist/framework/contracts/differential.js` keeps exporting it for the two tests that import it there. |
| `src/framework/contracts/types.ts` | `CheckedAssurance = 'checked' \| 'checked-sampled' \| 'checked-exact'`, and `Assurance = 'declared' \| CheckedAssurance \| 'transferred' \| 'proof'`. |
| `src/framework/contracts/README.md` | the assurance bullet list names the new values, says `assuranceOf` decides them and that an unknown method is never exact. |
| `tests/framework/r3-defects.test.mjs` | F34's test loses `{ todo: 'F34' }`; the only other change is Prettier's re-indent of that block (verified with `git diff -w`). |
| `ttmp/2026/11/27/IRWB-040-C-…/scripts/01-assurance-mapping.mjs` | the probe: 11 evidence shapes through `assuranceOf`, then a sampled and an exhaustive check through one manager. |

`AnalysisRecord.assurance` and the other `'checked'` constants (analysis records at :598, correspondence records at
:1463) are untouched: an analysis record claims only that an analysis ran, and the brief names the invariant path.

## Decisions, and the simpler alternatives

- **`'checked'` is the answer for unknown evidence, not a new `'checked-unknown'`.** `tests/framework/contracts.test.mjs:46`
  asserts exactly `'checked'` for an invariant whose evidence is `{delta, tolerance}` (no `method`). That test is not
  mine to edit, so the only values available for "checked, method unknown" are `'checked'` and `'checked-exact'`; the
  brief rules out the second. `'checked'` is therefore "the checker ran, nothing in its evidence says the claim is
  exact", and it is distinct from `'checked-exact'`, which is what F34's three assertions need.
- **A new module rather than importing `differential.ts` from the manager.** `differential.ts` already imports
  `ContractError` from `analysis-manager.ts`; the reverse import would make a runtime cycle that happens to work
  today (hoisted function declaration) but that the site bundle also has to reproduce. The one-way dependency was
  cheaper than reasoning about the cycle. The alternative of putting the mapping in `types.ts` was rejected because
  that file holds types, not policy about evidence.
- **An explicit list of exact methods, and `'checked'` for every other name.** The alternative — "exact unless it
  says `sampled`", the old rule — is the defect. The other alternative, "domain names too", cannot be honest: Typed's
  `exhaustive-w8` on a width-generic rule says nothing about 32 bits without the rule's argument
  (`src/typed/rules/verify.ts:11-19`), so the framework must not promote a method name it cannot read. Typed's
  `structural`, `exhaustive-w8`, `random-32` and `f32-special` therefore map to plain `'checked'` today; the probe
  pins `random-32` at `'checked'` so the choice is visible rather than accidental.

## Acceptance

**The test** (`npm run build`, then `node --test tests/framework/r3-defects.test.mjs`):

```
✔ F34: sampled and exhaustive checks record different assurance; unknown evidence is never exact (10.4ms)
ℹ tests 4  ℹ pass 1  ℹ fail 0  ℹ todo 3     (the 3 todos are F33 ×2 and F35, other steps)
```

**The baselines** (`node ttmp/2026/11/27/IRWB-039-…/scripts/02-baselines.mjs check`, after `npm run build`):

```
no differences from …/IRWB-039--.../various/baselines/main.json
timing: inline on attention 0.527 -> 1.998 ms per application
```

The same command printed `no differences` before the change as well, so RV32 images, instruction counts, edit
records, CUDA source hashes and `optimizeTix` revisions are all unchanged by this step.

**The suites** (Node 24, files not directories, no `*-gpu.test.mjs`):

| Suite | tests | pass | fail | skipped | todo |
| --- | --- | --- | --- | --- | --- |
| `tests/framework/*.test.mjs` | 242 | 239 | 0 | 0 | 3 (F33 ×2, F35) |
| `tests/typed/*.test.mjs` | 188 | 183 | 0 | 2 | 3 (F36, F37, F38) |
| `tests/workbench/*.test.mjs` | 25 | 24 | 0 | 1 | 0 |
| `tests/tensor/*.test.mjs` minus `-gpu` | 45 | 44 | 0 | 0 | 1 (F27) |

`npm run check`: clean. `node tools/build-site.mjs`: `dist/site built in 2335 ms: app.js 3094 KiB, app.css 80 KiB,
50 projects, 17 chapters, 132 source files`.

## Left out, and what I think of the brief and the test

- **Left out on purpose: "records carry `method` and `scope`"** (design-doc row F34) and **"Typed's rule strength
  flows into a pass's evidence"**. Neither is needed by F34's test and both need a producer (`scope` has no meaning
  in any current evidence, and Typed's `Strength` lives in `src/typed/`, outside this brief's scope). The mapping
  table in `assurance.ts` is the seam they will plug into: a domain that starts emitting exact evidence names its
  method there.
- **The test is weaker than the property.** It only asserts the two assurances differ and that unknown evidence is
  not `'checked-exact'`; `{method:'typo'}` and `{method:'exhaustive'}` both returning `'checked'` would still pass.
  My probe asserts the stronger claims (sampled is the weaker one, exhaustive is exact), so a later regression in
  the opposite direction would be caught there rather than here. I left the test as it is.
- **`'checked'` reads ambiguously.** A consumer that once treated `'checked'` as "exact" would now be wrong about a
  method-less check, which is intended but is a silent semantic change for outside callers. Nothing in this
  repository reads it except the three asserts above, so nothing here breaks.
- **Prettier.** `src/framework/contracts/differential.ts` was not Prettier-clean at HEAD (`npm run format:check`
  already listed it among 9 files), so per the brief I did not reformat it; my edit there is 6 lines. My other
  changed files are Prettier-clean, and `r3-defects.test.mjs` was clean at HEAD so I let Prettier re-indent the F34
  block after removing the `todo` option.
