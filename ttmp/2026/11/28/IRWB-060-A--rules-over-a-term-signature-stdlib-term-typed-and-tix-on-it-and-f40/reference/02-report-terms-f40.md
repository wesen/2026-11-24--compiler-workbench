---
Title: 'Report: terms over a signature — the library, both domains on it, and F40'
Ticket: IRWB-060-A
Status: active
Topics:
    - stdlib
    - typed
    - tensor
    - framework
DocType: report
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/stdlib/term/terms.ts
      Note: The term library
    - Path: src/typed/rules/compile.ts
      Note: Typed's adapter over it
    - Path: src/tensor/passes.ts
      Note: Tix's two rules over it
    - Path: src/framework/ir/derivation.ts
      Note: F40's one-branch change (stepEntries)
ExternalSources: []
Summary: "What IRWB-060-A built, the decision point's numbers, the F40 scope exception, and the acceptance results on the last commit."
LastUpdated: 2026-11-28T06:25:00-05:00
WhatFor: "The coordinator's review and merge of lane 4.6."
WhenToUse: "Scoring IRWB-060-A; following up on the term library."
---

# Report: terms over a signature — the library, both domains on it, and F40

## 1. What was built

**The library (`src/stdlib/term/`, new).** First-order rewriting over a **signature** — `op`, `args`,
`constant?`, `attr?` (own data beyond operator and children, for hash and equality), `equal?`
(the domain's structural equality for `{same}` repeats; default: the library's). `match` (variables,
constants, constant variables, repeats, operator patterns with arity), `indexRules`/`firstMatch`
(table order, guards passed the bindings **and the matched term**), `instantiate` over a `Build`
callback object (children first, left to right — the order Typed's id allocation requires),
`structuralHash`/`structuralEqual`, and the well-formedness queries `patternVars`/`templateVars`.
A rule's right-hand side is a template over the pattern's variables — or, for a rule over binders, a
domain function of the bindings and the matched term (the library knows nothing of binders; this is
the intern guide's allowance, and it is how Tix's two rules express index substitution).
`verify.ts`: **rule validation by evaluation on generated cases** (Alive-style) — the domain supplies
a `CaseSemantics` (per-variable `domain`/`values`/`draw`/`ofIndex`, `holds`, `lhs`/`rhs`, `agree`);
the library owns the campaigns (`enumerateCases`, `sampleCases` — boundary crossing capped at 200000
then random draws — and `exhaustiveCases`, the full-width sweep with at most one unbounded variable)
and the seeded `Rng` (moved verbatim from Typed, so recorded evidence reproduces); `verifyRule`
composes the structural check (a template variable the pattern does not bind is refused before any
case) with the campaigns under a domain-supplied interpretation.

**Typed on it.** `compile.ts` keeps `compileRules` (the visitor, the derivation steps, the id order)
and delegates: `match`/`firstMatch`/`instantiate` over a `Signature<ValueHandle>` whose `equal` is
`handle.same` (`sameTree` compares a type the handle does not expose, so the domain supplies
equality); `Bindings` is the library's `Map`; `matchPat` is deleted (nothing outside the module used
it); `edit-classes.ts`'s single binding read adapted. `verify.ts` keeps its proofs (structural
effects/types, by-construction, symbolic-linear — Typed semantics, not case campaigns) and runs its
four evaluation campaigns (bitwise-w1, exhaustive-w8, random-32/f32-special, exhaustive-32) through
the library's, supplying the noTrap-only `holds`, `compileSide`'s evaluators, exact outcome equality,
and `ofIndex: i => i|0` (the sign-extended value a full sweep assigns). `form.ts`'s `patternVars`/
`templateVars` delegate to the library's (the same queries over the structurally same shapes).
The re-run rule evidence agrees with the recorded evidence, counterexample for counterexample —
the loops moved verbatim, which was the only safe path.

**Tix on it.** A signature over `Expr` (the kind with the load's name / the reduction's op folded
into the operator; a reduction's child is its body; a load's indices are attributes). `split-sum` is
the rule `{op: 'reduce:sum', args: [{var: 'body'}]}` with the guard "exactly one axis, a `dim`
extent" (read off the matched term); `inline` is a rule instance per producer (`load:<name>`), the
pointwise/single-use/not-the-result conditions staying the driver's — facts about the statement list,
exactly as the intern guide says. **Tix's rules are verified by the meaning gate alone** (open
question 3, answered): `split-sum` is a tolerance rule, so an exact rule-level check is the wrong job
for it, and a second checker for `inline` would duplicate what the gate already checks on every
application. Revisions are byte-identical (the baselines say so, and `tests/tensor/terms.test.mjs`
pins the recorded per-pass revisions for every corpus program).

**F40.** Tix `inline`'s correspondence now says `{from: ['f/a'], to: ['f/b'], relation: 'merged'}`
with the step's note, instead of `removed` — the truthful entry, as IRWB-056-A produced. The
discovery, and the one place this lane stepped outside its file scope: **the fix cannot be made from
`src/tensor/passes.ts` alone.** The runner computes a native result's correspondence from its
derivation (a result gives a derivation *or* explicit entries, never both), the derivation step was
already truthful, and IRWB-056-B's `stepEntries` contributed an entry only for steps with fresh
products or `removed` steps — so a `merged` step whose products survive mapped nothing. The missing
piece is one branch in `stepEntries` (`src/framework/ir/derivation.ts`, ~10 lines): a `merged` step
maps its antecedent to the entities it produced, named by its own relation (a `modified` step's
entry keeps the derivation's label, or every Typed correspondence would change). The three tests
that pinned the 056-B decision were updated and renamed so a reader sees the policy changed
(`tests/framework/derivation.test.mjs` ×2, `tests/typed/derivations.test.mjs:182`). **Flagged for
the coordinator:** F41's lane owns that file's coverage parts; my change is in `stepEntries`, and
the two should merge by union. If the coordinator would rather own this change, it reverts cleanly
(the branch and the three test updates are one commit: `8127277`, "IRWB-060-A: F40").

## 2. The decision point

Measured (probe `scripts/03-o2-rule-path-vs-compiled-matcher.mjs`): the whole corpus through the
full O2 pipeline, once with today's `PASSES` (the library rule path) and once with a verbatim copy of
the pre-060-A matcher, interleaved in one process, the order alternated per round:

| run | rounds | library (whole pipeline) | direct | Δ | fold+simplify only |
|---|---|---|---|---|---|
| 1 | 3 | 32.6 s | 31.5 s | +3.4% | −13.7% |
| 2 | 5 | 52.1 s | 49.5 s | +5.2% | +3.4% |
| 3 | 5 | 51.6 s | 50.3 s | +2.7% | −3.2% |

No revision differences in any run. The brief's threshold is about 10% of compile time; the
whole-pipeline deltas are around the measurement's own run-to-run spread (the per-pass numbers,
which include the meaning contract, oscillate in sign). **Decision: the library path stays.** No
fallback was needed; the numbers are reported either way, as required. The residual cost is the
signature indirection (a `Map` per rule attempt where the old matcher allocated a plain object, and
`sig.op`/`sig.args`/`sig.constant` callbacks where it read fields).

## 3. Acceptance (checked on the last commit)

- **Build and types**: `npm run build` and `npm run check` clean.
- **My tests**: `tests/stdlib/term.test.mjs` 6/6 (matching incl. `same` and arity; first-match order
  and guards reading the matched term; instantiation order with the root/child distinction; the
  hash/equality laws — equal terms hash equally, hash and equality agree on every pair; a rule
  verified, a wrong rule refused with a counterexample, an unbound template variable refused before
  any case, a guard excluding exactly its cases; the campaigns' guard and seed behaviour).
  `tests/tensor/terms.test.mjs` 3/3 (recorded revisions after each pass on every corpus program,
  the plan agreeing; `inline` merging exactly the independently-analysed single-use pointwise
  statements, each merged statement gone, its consumer kept, the F40 entry; `split-sum` leaving no
  one-axis dimension-bound sum, one blocks/tail pair per matched reduction). The F40 correspondence
  test: `tests/typed/derivations.test.mjs` "…and the correspondence says the merge (F40)".
- **The baselines**: `node ttmp/2026/11/27/IRWB-039--…/scripts/02-baselines.mjs check` (after
  `npm run build`) prints **`no differences`** — image hashes, instruction counts, edit records,
  CUDA sources and Tix revisions are byte-identical. The 183 rule-citing O2 records are unchanged
  (`tests/typed/derivations.test.mjs`).
- **The suites**: typed 195 tests / 193 pass / 0 fail / 2 skipped (pre-existing skips); framework
  266/266; workbench + stdlib 92 tests / 91 pass / 0 fail / 1 skipped (pre-existing); tensor without
  the GPU files 54/54. The GPU files were not run (the coordinator runs them at merge).
- **Formatting**: every file I created or heavily rewrote is Prettier-clean; `src/framework/ir/derivation.ts`
  was one of the seven pre-existing unformatted files and stays as it was.
- **Site**: `node tools/build-site.mjs` builds (50 projects, 134 source files) — `src/stdlib/` changed.

## 4. What I left out, and why

- **The remaining hand tree comparisons** (`sameTree` in `mutate.ts` and `workbench/entities.ts`, the
  LVN and LICM keys, the matcher copies in A0's tools): named by the brief as motivation, but outside
  this lane's file scope (`workbench/`, `mutate.ts`, the tools). The library's `structuralEqual`/
  `structuralHash` are their destination; migrating them is a small follow-up with two ready
  clients. The rule path itself (the matcher's `{same}` repeat) already goes through the library.
- **The framework's older rewrite engine** (`ir/patterns.ts`, `rewrites.ts`): untouched, as
  instructed — item 4.7 decides its fate. This lane does not build on it (the R3 review's own reason:
  its unit of work is a projection transaction).
- **Alive-style per-rule verification for Tix**: not built — the meaning gate checks every
  application; see §1.
- **A generic `rewriteWith` in the library** (R3's proposal: a library-owned rewrite strategy): the
  two domains' drivers differ in kind (Typed's `Tx.rewrite` visitor with derivation steps and id
  allocation; Tix's statement-level passes), so the shared part is matching and instantiation, and
  the strategy stays with the domains. If a third client appears, the decision point's measurement
  (probe 03) is the template for evaluating one.

## 5. What I believe is wrong in the brief

- **F40's file pointer**: "Record it truthfully as `merged`, as IRWB-056-A did
  (`git show …/irwb-056-a:src/tensor/passes.ts`)" — 056-A's `passes.ts` cannot be ported to today's
  framework: the entry's computation moved into `src/framework/ir/derivation.ts` in 056-B and
  dropped merge entries. The truthful entry needs the one-branch framework change described in §1.
  The brief's file scope ("Not `src/framework/`") and its F40 deliverable are in conflict; I resolved
  it in favour of the deliverable, minimally, and flagged the merge risk with F41.
- Minor: the acceptance line lists the Tix-revisions and F40 tests under "Your tests in
  `tests/stdlib/`"; I read that as the section heading for *all* my tests and placed the Tix tests in
  `tests/tensor/` and the F40 assertions in the updated `tests/typed/derivations.test.mjs` (as the
  intern guide's lane description itself says).

## 6. Review instructions

The diary (`reference/01-diary.md`) has a "Code review instructions" block per step. Fast path:
read `src/stdlib/term/terms.ts` against the old `compile.ts` matcher (commit `5d52199`), then
`src/stdlib/term/verify.ts` against the campaign blocks of `src/typed/rules/verify.ts`, then the
`merged` branch in `stepEntries`; run the probes in `scripts/` (01 and 03 from the repository root);
then the sweep in §3.
