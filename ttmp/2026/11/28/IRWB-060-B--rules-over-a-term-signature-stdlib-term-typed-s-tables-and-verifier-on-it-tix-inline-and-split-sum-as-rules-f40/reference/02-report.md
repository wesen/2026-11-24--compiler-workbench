---
Title: 'Report: rules over a term signature (stdlib/term), Typed and Tix on it, F40'
Ticket: IRWB-060-B
Status: active
Topics:
    - framework
    - compiler
    - stdlib
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/stdlib/term/signature.ts
      Note: The term signature, structural key/hash/equality and size
    - Path: src/stdlib/term/pattern.ts
      Note: Patterns and templates, match and instantiate, the Builder hook
    - Path: src/stdlib/term/rules.ts
      Note: Rules as data, indexed by root operator, first match with the domain's guards
    - Path: src/stdlib/term/verify.ts
      Note: Alive-style rule validation over generated cases, with a counterexample
    - Path: src/typed/rules/compile.ts
      Note: Typed's rule tables over the library; the ValueHandle signature and the transaction builder
    - Path: src/typed/rules/verify.ts
      Note: Two enumeration methods through the library's verifyRule; the proofs stay
    - Path: src/tensor/rules.ts
      Note: Tix's expression signature, the split-sum and inline rules, and the expression rewrite
    - Path: src/tensor/passes.ts
      Note: The two Tix passes built on those rules; F40's merged correspondence entries
ExternalSources: []
Summary: "The library module src/stdlib/term and its two domain ports (Typed's tables and verifier, Tix's inline and split-sum), F40 (the merged correspondence entry), and the decision point: the library path is not slower than the pre-change matcher (-0.28 % of O2 compile time), so the port stands."
LastUpdated: 2026-11-28T03:10:00-05:00
WhatFor: "Reviewing IRWB-060-B; continuing it."
WhenToUse: "At merge, and before extending the term module."
---

# Report: rules over a term signature, and F40

Last commit: `a0354bb` + the report commit (see the final message in the ticket). All acceptance checks below were run
on it.

## What changed, file by file

| File | Change |
|---|---|
| `src/stdlib/term/signature.ts` (new) | `Signature<T>` (`op`, `args`, optional `constant`); `equalStructure`, `structuralKey` (canonical text), `structuralHash` (FNV-1a over the key), `size` |
| `src/stdlib/term/pattern.ts` (new) | `Pattern<T>`, `Template<T>` (with a computed constant and a domain `build` node), `Builder<T>` (`attrs`, `outermost`), `match`, `instantiate`, `patternVariables`, `templateVariables`, `patternOp` |
| `src/stdlib/term/rules.ts` (new) | `Rule<T,G>`, `indexRules`, `firstMatch` (domain guard function, domain equality, the matched node); a guarded rule reached without a guard function is an error |
| `src/stdlib/term/verify.ts` (new) | `CaseGenerator<V>`, `RuleSemantics<V>`, `verifyRule` — the Alive-style loop, the case count, the first counterexample, and the generator/rule variable law |
| `src/stdlib/index.ts` | exports the four modules; the `term/` line moves from "later modules" to "what exists now" |
| `src/typed/rules/compile.ts` | `valueSignature` (a `ValueHandle` as a term), `sameHandle` (sameTree), `libraryPattern`/`libraryTemplate`/`libraryRule` (memoised conversion), `firstMatch`/`indexRules` and `instantiate` now the library's, with a per-firing `Builder<ValueHandle>` that allocates through the transaction and puts the rule's provenance on the root only; `matchPat` deleted |
| `src/typed/edit-classes.ts` | the third matcher client (over its own `Tree`) uses the library's `firstMatch` and `instantiate`; its own template instantiation deleted |
| `src/typed/rules/verify.ts` | `exhaustive-w8` and `random-32`/`f32-special` run through the library's `verifyRule` (an `onCases` adapter: Typed's generators, Typed's compiled sides); methods 1–4 and `exhaustive-32` unchanged |
| `src/tensor/rules.ts` (new) | `exprSignature` (an `Expr` as a term, labels carrying reads' names and arities), `splitSumRule`, `inlineRule(producer)`, `rewriteExpr`/`rewriteFn` (`mapExpr` + the library's first match and instantiation), `replaceIndices` |
| `src/tensor/passes.ts` | `inline` and `split` built on those rules (the two hand-written `mapExpr` bodies are gone); F40: `mergeEntries` and `inlinePass.prepare` supply `merged` correspondence entries instead of a derivation; `mergedInto` answers from a correspondence's `merged` entries or a derivation's `merged` steps |
| `tests/stdlib/term.test.mjs` (new) | the library's laws (structural key/equality/hash, size), matching and instantiation on a small signature, a rule verified and a wrong rule refused with a counterexample, a guard that narrows a rule, the interface's variable law; Tix revisions against the coordinator's baselines for every corpus program; F40's entry (and a chain, and a rejected entry) |
| `tests/typed/derivations.test.mjs` | the F40 test now asserts the truthful entry (this is the test the brief allows updating; see "Tests I changed") |
| `ttmp/…/scripts/01-rule-path-measurement.mjs` (+ `.output.txt`) | the decision-point probe and its output |

## Acceptance

### My tests (`tests/stdlib/term.test.mjs`, 9 tests)

```
✔ term: structural key, equality and hash, and the law that equal terms hash equally
✔ term: matching binds variables, constants, constant variables and repeats
✔ term: instantiation makes the replacement children first, and flags its root
✔ term: rules are indexed by root operator and tried in table order, guards are the domain's
✔ term: a rule is verified over generated cases, and a wrong rule is refused with a counterexample
✔ Tix: inline and split-sum give the revisions the baselines record, on every corpus program
✔ Tix: split-sum and inline are rules over the expression signature, and fire where they used to
✔ F40: Tix inline says `merged` for the statement it substituted, and names the reader
✔ Tix: split-sum applied to a program with no single-dimension sum is the identity
ℹ pass 9, fail 0
```

The Tix revision test reads the coordinator's `various/baselines/main.json` (read only) and compares `optimizeTix(p,
['inline'])` and `optimizeTix(p, ['inline', 'split-sum'])` for every corpus program.

### Baselines

`node ttmp/2026/11/27/IRWB-039--…/scripts/02-baselines.mjs check`, after `npm run build`:

```
no differences from …/various/baselines/main.json
timing: inline on attention 0.562 -> 0.608 ms per application
```

Images, instruction counts, Typed edit censuses, the CUDA source hashes and the `optimizeTix` revisions are unchanged.
The `tests/typed/derivations.test.mjs` test "edit records that cite a rule: 183 under O2" passes unchanged, so the
derivations the brief pins did not move.

### Suites (built first; no `*-gpu` file run afterwards)

| Suite | Result |
|---|---|
| `tests/typed/*.test.mjs` | 195 tests, 193 pass, 0 fail, 2 skipped (the pre-existing `IRWB_CANDELA=1` gates) |
| `tests/framework/*.test.mjs` | 266 tests, 266 pass, 0 fail |
| `tests/workbench/*.test.mjs` | 25 tests, 24 pass, 0 fail, 1 skipped (pre-existing) |
| `tests/stdlib/*.test.mjs` | 70 tests, 70 pass, 0 fail |
| `tests/tensor/*.test.mjs` without `*-gpu` | 51 tests, 51 pass, 0 fail |

`npm run check` is clean. `node tools/build-site.mjs` builds (`dist/site built in 262 ms: … 134 source files`).
`npm run format:check` reports the seven files that were already unformatted and nothing of mine.

## The decision point

Measured with `scripts/01-rule-path-measurement.mjs` (50 Typed projects, O2, 3 interleaved rounds, minimum per
project; both paths produce the same revision on all 50):

| | |
|---|---|
| rule passes (fold, simplify, identities), today's matcher | 1665 ms |
| rule passes, the library (`stdlib/term`) | 1625 ms |
| difference | −40 ms (−2.4 % of the rule passes) |
| O2 compile time, whole pipeline | 14100 ms |
| difference as a share of O2 compile time | **−0.28 %** |
| threshold (withdraws the Typed port) | more than about 10 % |

**Decision: the library path stays for Typed.** It is not materially slower — it is inside the noise, and a second
run without the probe's revision check gave −0.10 %. The rule passes are about 11 % of O2 compile time and the
matcher is a small part of them; the transaction dominates, so the library's two extra allocations per made node (a
`Map` of bindings, a `ValueHandle` per node) do not show.

## Answers to the lane's open questions

- **Open question 3 — are the Tix rules verified?** No. `split-sum` is a reassociation over a binder whose sides
  agree only within the tolerance the pass declares, and `inline` is a use-count property of a statement list, not an
  equation between terms. The pass-level `tix.meaning-gate` (exact for `inline`, within a bound for `split-sum`) stays
  the only check, as before. The library's `verifyRule` is exercised by Typed's two enumeration methods and by the
  library's own test.
- **Open question 4 — the threshold.** Fixed by the brief at about 10 %; measured −0.28 % (above).
- **F40's premise.** The brief says `inline`'s correspondence "still says `removed`" and asks for `merged` "as
  IRWB-056-A did". In *this* framework a derivation cannot produce that entry: `correspondenceFromDerivation` keeps
  only steps that make an entity the output did not have, and drops a `merged` step whose target already existed
  (`tests/framework/derivation.test.mjs:207` pins that). A native result carries a derivation **or** correspondence
  entries, never both (`prepareNative`, `define-pass.ts:205`). Since `src/framework/` is out of scope, the merge link
  moved into the correspondence: `inline` now supplies the entries and no longer emits a `Derivation`. `mergedInto`
  accepts either shape. **This is the one place where the brief's instruction could not be followed literally.**

## What I left out, and why

- **A library traversal** (`rewrite`, greedy bottom-up). Typed's traversal is `Tx.rewrite` — it allocates value ids
  and records derivation steps, so a library walker would duplicate it; Tix's is `mapExpr`, five lines, and it also
  knows where its binders are. One client today, which the admission rule in `src/stdlib/index.ts` does not admit.
  The shared strategy is the first-match rule index, which both clients use.
- **`exhaustive-32` through the library.** Its complete enumeration runs a *fused* loop over one full 32-bit variable
  and counts cases by arithmetic (`cases + x`); the library's interface hands one assignment over at a time, so 2^32
  yields would cost minutes. It stays in Typed, with the reason in the code.
- **LVN and LICM keys, `sameTree`'s other copy, A0's matcher copies** (R3's motivation for the row). The library now
  offers the equality and hash they would use, but replacing them changes what those caches key on, and the baselines
  pin their output. One line each: LVN/LICM keyed on `structuralHash`; `typed/tx.ts`'s `sameTree` as
  `equalStructure` over the store's signature; A0's copies of the matcher replaced as `edit-classes.ts`'s were (that
  one I did, because it was the same file's matcher).
- **Per-module `src/stdlib/term/index.ts`.** The library has none per module (only `src/stdlib/index.ts`); callers
  import the file, as `src/tensor/model.ts` does for `affine`.

## Tests I changed

- `tests/typed/derivations.test.mjs`, "Tix inline records which statement was merged into which, and its
  correspondence is unchanged" → now "Tix inline says `merged` for the statement it substituted, and names the reader
  it went into (F40)". **Why:** the test asserted the old, untruthful entry (`{from:['f/a'], to:[], relation:
  'removed'}`) and the derivation steps that carried the link; F40 changes exactly those. The replacement asserts the
  truthful entry, the link, and that a bogus entry is refused — strictly more than before on the entry, less on the
  derivation (which no longer exists).

No other existing test was touched, and no assertion was weakened.

## Framework gaps this lane met (for F41 or later)

1. **A merged step cannot map.** `ir/derivation.ts`'s `stepEntries` could give a `merged` step an entry with
   `relation: 'merged'` when its produced entity already existed in the input. That would let a domain state a merge
   in a derivation and have the correspondence say so, instead of choosing one record shape. Second client: any pass
   that merges (Typed's `cse`/`licm` merges, Tix's `inline`).
2. **A result cannot carry both record shapes.** `prepareNative` refuses `derivation` + `correspondence`. If (1)
   were fixed, that refusal would be avoidable for a pass that has both kinds of change.

## Files to look at first in review

`src/stdlib/term/pattern.ts` (the `Builder`/`build` seams), `src/typed/rules/compile.ts` (`builderFor` and the
conversion memo), `src/tensor/rules.ts`, and `src/tensor/passes.ts`'s `mergeEntries`/`inlinePass.prepare`. The diary
(`reference/01-diary.md`) has the reason for each decision and the two failures worth knowing about (a glob that ran
the GPU tests once, and the F40 premise above).
