---
Title: 'Implementation diary: F34 honest evidence'
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
    - Path: src/framework/contracts/analysis-manager.ts
    - Path: src/framework/contracts/assurance.ts
      Note: the mapping
    - Path: src/framework/contracts/differential.ts
    - Path: src/framework/contracts/types.ts
    - Path: tests/framework/r3-defects.test.mjs
ExternalSources: []
Summary: 'Chronological record of the F34 step: the probe before the change, the mapping chosen, the test flipped, and the acceptance runs.'
LastUpdated: 2026-11-27T18:10:00-05:00
WhatFor: Reviewing how F34 was done and what evidence it rests on
WhenToUse: When checking IRWB-040-C, or copying the F34 pattern for a later step
---

# Implementation diary: F34 honest evidence

Step F34 of IRWB-039 phase 1b (`design-doc/01-…`, table row F34), under the brief of IRWB-040-C. One session.

## 0. Read the brief and the existing evidence

- Design doc row F34: `contracts/analysis-manager.ts` (the constant at :1177), `contracts/differential.ts`
  (`assuranceOf`), `contracts/types.ts`; acceptance is R3 probe 01.
- `tests/framework/r3-defects.test.mjs:20-72` holds the F34 test with `{ todo: 'F34' }`; it asserts four things:
  the sampled and the exhaustive result differ, two `assuranceOf` calls are not `checked-exact`, and — by the
  `notEqual`/`notDeepEqual` shape — nothing else.
- `grep -rn assurance src/` showed nothing outside `src/framework/contracts/` reads it, so no domain code depends on
  the exact string. Three `tests/framework` asserts do (see step 2).

## 1. The defect, reproduced before the change

```
$ npm run build
$ node ttmp/2026/11/26/IRWB-019-…/various/r3-synthesis/scripts/01-assurance-of-sampled-and-exact.mjs
1. sampled, subject wrong on every even input: ok true | assurance checked | evidence.method sampled
2. exhaustive over u8, subject correct:        ok true | assurance checked | evidence.method exhaustive
   same assurance recorded for both: true
3. assuranceOf(sampled evidence) checked-sampled | assuranceOf(undefined) checked-exact |
   assuranceOf({method:'typo'}) checked-exact | assuranceOf({method:'exhaustive'}) checked-exact
4. every mention of assuranceOf in src/, tests/, tools/:
   src/framework/contracts/differential.ts:378: export function assuranceOf(evidence: unknown): …
   tests/framework/ext-e5.test.mjs … tests/framework/r3-defects.test.mjs …
```

So `assuranceOf` had no caller in `src/` at all.

`node …/02-baselines.mjs check` before any edit (after `npm run build`): `no differences`, 8m59s.

## 2. What the callers require (this fixes the mapping)

Three existing asserts read the recorded assurance:

| Test | Evidence it checks | Asserts |
| --- | --- | --- |
| `tests/framework/contracts.test.mjs:46` | an invariant returning `{delta, tolerance}`, no `method` | `checks[0].assurance === 'checked'` |
| `tests/framework/contracts.test.mjs:38` | a property fact (analysis record) | `fact.assurance === 'checked'` |
| `tests/framework/ext-e4.test.mjs:111` | an analysis record | `a.assurance === 'checked'` |

Only the first one goes through `checkInvariant`. It forces the answer for evidence without a `method`: it must stay
`'checked'`, not a new name. Since that test may not be edited, `'checked'` is the value for "a check whose evidence
names no method the framework knows", and it is distinct from `'checked-exact'`, which is all the F34 test asks for.

## 3. The change

New module `src/framework/contracts/assurance.ts`:

```ts
const EXACT_METHODS = new Set(['exhaustive', 'exhaustive-32', 'proof']);
const SAMPLED_METHODS = new Set(['sampled']);
export function assuranceOf(evidence: unknown): CheckedAssurance {
  const method = (evidence as { readonly method?: unknown } | null | undefined)?.method;
  if (typeof method !== 'string') return 'checked';
  if (SAMPLED_METHODS.has(method)) return 'checked-sampled';
  return EXACT_METHODS.has(method) ? 'checked-exact' : 'checked';
}
```

- `types.ts`: `CheckedAssurance = 'checked' | 'checked-sampled' | 'checked-exact'`, and
  `Assurance = 'declared' | CheckedAssurance | 'transferred' | 'proof'`. No other type changed; `AnalysisRecord`
  keeps `'checked' | 'transferred'` because an analysis record claims only that an analysis ran.
- `analysis-manager.ts:1178`: `assurance: assuranceOf(result.evidence)` in `invariantInternal`, the one place the
  brief names. The other `'checked'` constants are analysis records (:598) and correspondence records (:1463), whose
  evidence has no method and which the brief does not ask about; they stay.
- `differential.ts`: the old `assuranceOf` is replaced by `export { assuranceOf } from './assurance.js';` so
  `dist/framework/contracts/differential.js` still exports it for the two tests that import it there.
- `contracts/README.md`: the assurance bullet list now names the two new values and says an unknown method is never
  exact.

### Why a new module rather than importing differential from the manager

`differential.ts` already imports `ContractError` from `analysis-manager.ts`; importing `assuranceOf` back would make
the pair a runtime cycle. It would work (`assuranceOf` is a hoisted function declaration, and the tests do not
execute during module init), but the site bundle (`tools/build-site.mjs`, esbuild) also builds this code, and a
one-way dependency is both smaller to reason about and usable by the manager without pulling in the
sampled-check machinery. The alternative — putting the mapping in `types.ts` or `definitions.ts` — was rejected
because those modules hold types and definition factories, not policy about evidence.

### Which method names are exact, and which are not

The framework knows the methods it produces itself: `sampled` from `differential()`, `exhaustive` from any checker
that says it exhausted the domain, plus `exhaustive-32` and `proof` (the Typed rule verifier's names for "every
32-bit assignment" and "proved", `src/typed/rules/verify.ts`). Everything else is `'checked'`, including Typed's
`'structural'`, `'exhaustive-w8'`, `'random-32'` and `'f32-special'`. That is deliberate: `verify.ts:11-19` says
8-bit exhaustion implies nothing at 32 bits without the rule's stated argument, so the framework cannot promote a
name it cannot read. Mapping a domain's names to exactness is that domain's job when its rule strength flows into a
pass's evidence — the second half of the F34 row in the design doc, which this brief leaves out of scope (see the
report's "left out").

## 4. The test

`tests/framework/r3-defects.test.mjs`: removed `{ todo: 'F34' }` in the same commit as the fix. Nothing else in the
test file changed (`git diff -w` shows only the option removal).

```
$ node --test tests/framework/r3-defects.test.mjs
✔ F34: sampled and exhaustive checks record different assurance; unknown evidence is never exact
⚠ F33 … # F33   ⚠ F33 … # F33   ⚠ F35 … # F35      (other steps' todos)
ℹ tests 4  ℹ pass 1  ℹ fail 0  ℹ todo 3
```

## 5. Prettier: differential.ts was not formatted before the change

I ran `npx prettier --write` on `differential.ts` and the test file and it reformatted 56 lines of
`differential.ts` (unrelated code, e.g. `subjectKey`'s signature). Restoring both files and checking the HEAD
version showed `differential.ts` is **not** Prettier-clean at HEAD with the repo's `.prettierrc.json`
(`printWidth: 110`), so per the brief I did not reformat it; my edit is 6 lines and no other line moved. The test
file *was* clean at HEAD, so I ran Prettier on it: removing the `todo` option lets the call collapse to one line and
its body re-indents by two spaces. `git diff -w` confirms that is the only textual change there.

## 6. Probe after the change (this ticket's `scripts/01-assurance-mapping.mjs`)

```
$ node ttmp/2026/11/27/IRWB-040-C--…/scripts/01-assurance-mapping.mjs
1. evidence shapes -> assurance
ok   assuranceOf(undefined) = checked      ok   assuranceOf(null) = checked
ok   assuranceOf({}) = checked             ok   assuranceOf({ method: 'typo' }) = checked
ok   assuranceOf({ method: 7 }) = checked  ok   assuranceOf('sampled') = checked
ok   assuranceOf({ method: 'sampled' }) = checked-sampled
ok   assuranceOf({ method: 'exhaustive' }) = checked-exact
ok   assuranceOf({ method: 'exhaustive-32' }) = checked-exact
ok   assuranceOf({ method: 'proof' }) = checked-exact
ok   assuranceOf({ method: 'random-32' }) = checked
2. a sampled differential and an exhaustive invariant, through one AnalysisManager
   sampled: ok true | assurance checked-sampled | evidence.method sampled
   exhaustive: ok true | assurance checked-exact | evidence.method exhaustive
   evidence without a method: ok true | assurance checked | evidence.method undefined
ok   a sample and an exhaustion record different assurance
ok   the sampled check is the weaker one
ok   unknown evidence is never exact
all claims hold
```

R3's own probe on the same build now prints `same assurance recorded for both: false`,
`assuranceOf(undefined) checked`, `assuranceOf({method:'typo'}) checked`, and lists
`analysis-manager.ts:3` and `:1178` as callers.

## 7. Acceptance runs

- `npm run check`: clean.
- `npm run build` then the suites (Node 24, files not directories, no `*-gpu`):
  - `tests/framework/*.test.mjs` — tests 242, pass 239, fail 0, todo 3 (F33 ×2, F35).
  - `tests/typed/*.test.mjs` — tests 188, pass 183, fail 0, skipped 2, todo 3 (F36, F37, F38). 8m28s.
  - `tests/workbench/*.test.mjs` — tests 25, pass 24, fail 0, skipped 1, todo 0.
  - `tests/tensor/*.test.mjs` without the `-gpu` files — tests 45, pass 44, fail 0, todo 1 (F27).
- `node tools/build-site.mjs`: `dist/site built in 2335 ms: app.js 3094 KiB … 132 source files`.
- `node ttmp/2026/11/27/IRWB-039--…/scripts/02-baselines.mjs check`: see the report.
