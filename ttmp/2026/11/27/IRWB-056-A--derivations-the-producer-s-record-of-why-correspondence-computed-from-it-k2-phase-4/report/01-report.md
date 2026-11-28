---
title: Report
---

# IRWB-056-A report: derivations

**The task.** A derivation is the producer's own record of *why*: per step, the rule or decision, the site
(consumed and produced entities), the premises. The correspondence is computed from the steps under a
coverage policy, and the existing diff audits it. All items delivered; the acceptance was checked on the
final commit.

## What changed, file by file

- `src/framework/ir/derivation.ts` (new): `DerivationStep` (rule or decision id, site, premises, relation),
  `stepsToCorrespondence` (grouping + rejection of empty and false mappings), `correspondenceOfDerivation`.
- `src/framework/ir/index.ts`: export it.
- `src/framework/passes/define-pass.ts`: `NativeResult.derivation` and `PassResult.derivation`;
  `prepareNative` computes the correspondence from the steps (a hand-written `correspondence` is ignored
  when a derivation is present). These two type declarations live here, not in `transformation.ts`, because
  that is where `NativeResult` and `PassResult` are declared; `transformation.ts` only carries the field.
- `src/framework/passes/transformation.ts`: the runner carries `derivation` into the result.
- `src/typed/tx.ts`: a step per entity made from an input entity and per removed input entity;
  `MakeOptions.rule`, `Tx.cite`; rewrite records cite the rules that fired (`rules`) and the premises the
  walk relied on (`licensed`).
- `src/typed/rules/compile.ts`: the matched rule is cited and threaded into every value the instantiation
  makes — so fold, simplify and identities record the rule that licensed each edit.
- `src/typed/passes.ts`: every Typed pass built by `typedPass` records its derivation (steps ordered as
  the revision's tables name their products, superseded steps dropped); the runner computes the
  correspondence from it, where before it came from `revisionCorrespondence` (still exported, still the
  oracle in the tests and still used by typed `inline`).
- `src/tensor/passes.ts`: `inline` records which statement was merged into which (chains resolved to the
  final survivor); `split-sum` unchanged.
- `tests/framework/derivation.test.mjs`, `tests/typed/derivation.test.mjs`, `tests/tensor/derivation.test.mjs`
  (new): the acceptance below.
- `tests/typed/rules.test.mjs`: the B1 parity comparison strips the two new citation fields from the edit
  records before comparing table vs hand-written passes (records may gain fields; the update is one line,
  documented in the file). No assertion was weakened: revisions and correspondences are still compared in
  full.

## Acceptance results

- **Rule-citing records on the O2 corpus: 0 → 183** (fold 43, simplify 140, no other pass cites; the count
  is exact, no differences to explain). The gate is off in the test — it never changes what a pass edits.
- **Derivation-computed correspondence equals today's for every pass that records one**: every changed
  revision of every corpus project under O2 (195 revisions, 1,475 steps) and — as a one-off probe, too slow
  for a suite — under speed (368 revisions, 9,550 steps): 0 differences
  (`various/02-speed-corpus-equality.txt`). One difference was found on the way (a `licm-traps rotate`
  note-join order) and fixed by ordering the published derivation as the revision's tables name its
  products; `scripts/03-rotate-diff.mjs` reproduces the finding.
- **Empty and false mappings are rejected**: an empty site; an id in neither revision; a produced id the
  diff says was removed; a consumed id that exists only in the output (`tests/framework/derivation.test.mjs`),
  and the runner rejects a doctored derivation through the real pipeline (`tests/tensor/derivation.test.mjs`).
- **Both A0 policies as queries over the same records**: 203 (rule-cited or fact-licensed value rewrites)
  and 395 (IRWB-035-G's classifier over the same before/after/edits) — no class field anywhere.
- **Tix inline records merges**; its correspondence now says `merged` into the consumer instead of
  `removed`. This is the one place the derivation *cannot* equal yesterday's computation — that
  computation is exactly the wrong entry K2 documents (the producer "disappeared" with no link to the
  statement that absorbed it). No test asserted the old entry; the Tix baseline records revisions and CUDA
  source, which do not change.
- **Baselines**: `02-baselines.mjs check` prints `no differences`. The census counts edits per pass, so the
  records' new fields (`rules`, `licensed`) do not appear in it.
- **Suites** (non-gpu): framework 263 pass / 0 fail; stdlib 48/0; tensor 50/0; workbench 24 pass, 1 skip
  (IRWB_FULL), 0 fail; typed 189 pass, 2 skips (IRWB_FULL), 0 fail. `npm test` and the `*-gpu` tests were
  not run, per the brief.
- `npm run check` clean; `node tools/build-site.mjs` builds.
- **Decision point, measured** (`scripts/01-correspondence-cost.mjs`, three interleaved runs per side,
  numbers in `various/01-correspondence-cost.txt`): pipeline medians 9.5 s before and after; today's
  correspondence computation re-measured at 3.8–4.6 s before, 3.4–4.8 s after. Recording derivations is
  indistinguishable from noise, far below the ~2× threshold, so nothing is stored only on demand — and no
  local terms (R3 K5's per-step `before`/`after` JSON) are stored at all.

## Left out, and one quarrel with the brief

- Typed `inline` and `dfe` record no derivations (whole-program passes outside `typedPass`'s `Tx` loop;
  they apply no rules and are outside the named scope). `Program`'s revision records do not carry the
  derivation (`program.ts` is outside the scope; the tests read it off the `TransformationResult`).
  `whyEntity` still walks correspondences, not derivations (R3's `why` over derivations is a later step).
- **The brief's "they must be equal" cannot hold for Tix `inline`**: today's correspondence for it is the
  `removed` entry K2 itself calls wrong. The equality holds everywhere both computations exist (all Typed
  passes); for `inline` the derivation replaces the wrong entry with the truthful `merged` one, and the
  test pins the exact difference.
- **Scope note**: `NativeResult` and `PassResult` (the two declarations the derivation has to travel
  through) live in `define-pass.ts`, which the scope lists only as `transformation.ts`; the change there is
  confined to carrying the derivation (one optional field each) plus `prepareNative` computing from it.
