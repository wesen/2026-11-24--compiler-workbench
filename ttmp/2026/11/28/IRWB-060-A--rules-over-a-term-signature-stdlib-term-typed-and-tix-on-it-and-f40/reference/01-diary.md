---
Title: 'Diary: rules over a term signature (IRWB-060-A)'
Ticket: IRWB-060-A
Status: active
Topics:
    - stdlib
    - typed
    - tensor
    - framework
DocType: reference
Intent: short-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "The working diary of IRWB-060-A: one step per significant action, with review instructions per step."
LastUpdated: 2026-11-28T06:30:00-05:00
WhatFor: "Seeing how the lane went, step by step."
WhenToUse: "Reviewing IRWB-060-A's process; resuming follow-up work."
---

## Step 1: read the guide, the R3 row, the sources; the F40 discovery

**Prompt Context** (quoted once, from the task): "Your ticket is IRWB-060-A. … rules over a term
signature (phase 4, item 4.6), and F40 … 1. `src/stdlib/term/`: terms over a signature … 2. Typed on
it … 3. Tix on it … 4. F40: Tix `inline`'s correspondence still says `removed` for a merged statement …
Record it truthfully as `merged`, as IRWB-056-A did … Decision point: measure the rule path against
today's compiled matcher on the O2 corpus … If the library path is materially slower (more than about
10% of compile time), keep Typed's compiled visitor, share only the matcher and the verifier, and
report the numbers."

**What I did.** Created the ticket with docmgr; read the intern guide in full (both parts), the R3
synthesis `terms` row (`l-terms`) and the migration step, then the sources: `src/typed/rules/{form,
compile, verify, simplify}.ts`, `src/typed/tx.ts`, `src/tensor/{model, ir, passes}.ts`,
`src/framework/ir/derivation.ts`, `src/framework/passes/{transformation, define-pass}.ts`, the
baselines' neighbours (`tests/typed/rules.test.mjs`, `tests/typed/derivations.test.mjs`,
`tests/framework/derivation.test.mjs`), and IRWB-056-A's `src/tensor/passes.ts` via
`git show v7-derivations-g-h/irwb-056-a:src/tensor/passes.ts`. Wrote the design note
(`design-doc/01-design-note.md`) and the probe `scripts/01-inline-correspondence-today.mjs`, which
prints today's inline correspondence for `a[i]=x[i]*2; b[i]=a[i]+1`.

**Why.** The guide is the authoritative description of the lane, and the acceptance constraints (the
re-run rule evidence must agree with the recorded evidence; the derivations, edit records and images
must not change) mean every change has to reproduce today's behaviour exactly, which requires reading
today's loops line by line before moving them.

**What worked.** The probe ran on the first try after fixing the import depth (see below) and confirmed
the current correspondence: `f/a → removed`, `f/b → retained`, with the merge link only in the
derivation step (`relation: 'merged'`, `produces: ['f/b']`).

**What didn't work.** The probe's first run failed with
`Error [ERR_MODULE_NOT_FOUND]: … /ttmp/2026/11/28/dist/tensor/index.js` — the ticket's `scripts/`
directory is six levels below the root, not four; fixed with `../../../../../../dist/...`.

**What I learned.** F40 is **not recordable from `src/tensor/passes.ts` alone**. The runner computes a
native result's correspondence from its derivation (`prepareNative` in
`src/framework/passes/define-pass.ts`: "A result gives a derivation or correspondence entries, not
both"), and the framework's `stepEntries` (`src/framework/ir/derivation.ts`) contributes an entry only
for steps with fresh products or for `removed` steps — a `merged` step whose produced entity already
exists in the input (`f/b`) contributes nothing, so the completion says `removed`. IRWB-056-A produced
`merged` because *its* framework used the step's relation for mapped entries; IRWB-056-B moved that
logic into the framework and changed it. The truthful entry needs one branch in `stepEntries`
(a `merged` step maps its antecedent to its surviving products, named by its own relation). That file
is outside my stated scope and F41's lane touches it too — I make the minimal change, flag it in the
report, and note the merge risk. Alternative considered and rejected: drop the derivation and supply
explicit correspondence entries — the derivation steps are pinned (tests, `mergedInto`) and the brief
says the derivations must not change.

**What was tricky.** (a) Typed's `Bindings` is a plain object while a generic library wants one
container — I standardise on `Map` in the library and convert where Typed reads a binding by name.
(b) Typed's template constants are *computed* (`{log2}`, `{eval}`), so the library's `Template` is
parameterised by the domain's constant-description type `C`. (c) The verifier's sampling loops are
pinned indirectly by re-run tests (counterexample bindings, NaN payloads), so the campaigns must move
verbatim, including the `Rng` and the crossing cap.

**What warrants a second pair of eyes.** The scope exception for F40 (`src/framework/ir/derivation.ts`,
`stepEntries`): is the coordinator content with a two-branch change there, or should F40 have been
assigned to F41's lane, which owns the file? Also: the F40 entry's relation comes from the step's
`relation` ('merged'), not the derivation label ('inline') — 056-A's semantics — which is a policy
change in the framework, not only an addition.

**Code review instructions.** Read `design-doc/01-design-note.md` sections 1 and 4 against
`src/framework/ir/derivation.ts` (`stepEntries`) and `src/framework/passes/define-pass.ts`
(`prepareNative`); run `node scripts/01-inline-correspondence-today.mjs` on the base commit to see the
pinned `removed` entry.

## Step 2: the library (`src/stdlib/term/`), with its tests

**What I did.** Wrote `src/stdlib/term/types.ts` (the rule shapes: `Pattern`, `Template<C>`, `TermRule<G, C>`),
`terms.ts` (`Signature<T>` with `op`/`args`/`constant?`/`attr?`/`equal?`; `match`; `indexRules`/`firstMatch`
(guards receive the bindings **and the matched term** — Tix's split-sum guard reads the matched reduce's
axes); `instantiate` over a `Build` callback object, children first, left to right; `structuralHash`/
`structuralEqual`; `patternVars`/`templateVars`) and `verify.ts` (`Rng` moved verbatim from Typed's
verify.ts; the campaigns `enumerateCases`, `sampleCases`, `exhaustiveCases` over a domain-supplied
`CaseSemantics`; and `verifyRule`, the Alive-style entry: a rule, an interpretation, a case generator,
refusing an unbound template variable before any case). Exported both from `src/stdlib/index.ts` and
moved `term/` from the "later modules" list to the existing ones. Wrote `tests/stdlib/term.test.mjs`
(six tests: matching incl. `same` and arity, first-match order and guards, instantiation order and the
root/child distinction, the hash/equality laws, verification of a sound rule and refusal of a wrong one
with a counterexample, and the campaigns' guard and seed behaviour).

**Why.** The shapes follow the intern guide's proposal and Typed's existing names so the move is
recognisable; guards stay domain data because `pure` is a Typed fact and "used exactly once" is a fact
about a statement list; `Template` is parameterised by the domain's computed-constant type because
Typed's template constants are computed (`{log2 k}`, `{eval op, args}`).

**What worked.** The tests pass (6/6), the layering test passes (`term/` imports nothing outside
`src/stdlib/`), `npm run check` and Prettier are clean.

**What didn't work.** Three test-time failures, all mine: (a) my `same` example wrapped the repeated
operand in an `add`, so the two sides were *not* structurally equal — the library was right, the test
term was wrong; (b) I forgot that `verifyRule` runs sampling on top of a full enumeration, so the
methods list has both; (c) my sampleCases case count forgot that random draws can fail the side
condition too (deterministically with a fixed seed: 24, not 25). Also three compile errors: `in`-union
narrowing needs the op member as a positive check (I reordered `match` to test `'op' in p` first), and
`TermRule.lhs` had to be typed as the op variant (`OpPattern`) — a rule's left side is never a bare
variable, which Typed's `checkRule` already enforces for its tables.

**What I learned.** The stdlib layering test is a source-level import check, so `types.ts` must not
even type-import from `src/typed/` (my first draft documented the structural correspondence with an
import; deleted).

**What was tricky.** Keeping the campaigns *verbatim* in structure (the `product` order, the guard
before the count, the crossing cap of 200000, `cases + x` on a mid-sweep failure) so Typed's recorded
evidence can reproduce; and the `Rng` belongs to the interface for exactly that reason.

**What warrants a second pair of eyes.** `verifyRule`'s default enumeration budget (2^16) and sampling
default (1e5): the first is the size at which a crossing loop is still a complete check rather than a
sampled one; both are only defaults a caller overrides. Also whether `exhaustiveCases`'s no-guard-check
inner loop (copied from Typed, where the bounded domains fix every input a condition could read)
should be a stated precondition instead.

**Code review instructions.** Read `src/stdlib/term/terms.ts` against `src/typed/rules/compile.ts`'s
`matchPat`/`firstMatch`/`instantiate` (they must agree case for case); read `src/stdlib/term/verify.ts`
against `src/typed/rules/verify.ts`'s methods 4–7 (the loops must be the same); run
`node --test tests/stdlib/term.test.mjs`.

## Step 3: Typed on the library (matcher, verifier, well-formedness queries)

**What I did.** `src/typed/rules/compile.ts`: the pattern walk, the first-match strategy and the template
walk now live in the library — `match`/`firstMatch`/`instantiate` over a `Signature<ValueHandle>`
(`op`, `args`, `constant: isConst ? imm`, and `equal: handle.same`, because Typed's `sameTree` compares
a type the handle does not expose); `indexRules` and `firstMatch` are thin wrappers keeping the exported
signatures; `instantiate` calls the library walk with a `Build` that makes `tx.const`/`tx.make` with the
rule's provenance on the outermost made value only. `Bindings` became the library's `Map`; the one other
reader, `edit-classes.ts`'s `treeBound`, adapted (`b[x]` → `b.get(x)`). `matchPat` is deleted (nothing
outside the module used it). `src/typed/rules/verify.ts`: the four evaluation campaigns (bitwise-w1,
exhaustive-w8, random-32/f32-special, exhaustive-32) now call the library's `enumerateCases`/
`sampleCases`/`exhaustiveCases` with a `campaign(L, R, of)` helper that supplies Typed's semantics (the
variables' `domainAt`/boundary `values`/`draw`, the noTrap-only `holds`, the compiled sides, exact
outcome equality, and `ofIndex: i => i|0` — the sign-extended value a full-range sweep assigns); the
local `Rng` and the campaign loops are gone; the proofs (structural, by-construction, symbolic-linear)
and the method/strength bookkeeping stay. `src/typed/rules/form.ts`: `patternVars`/`templateVars`
delegate to the library's (the same queries over the structurally same shapes).

**Why.** This is the brief's item 2: the tables match and instantiate through the library, and the
verifier verifies through the library's interface with Typed's semantics — the case campaigns are the
domain-independent part; the interpretation of operators, the value domains and the evidence's method
names are Typed's.

**What worked.** Everything that pins behaviour passes unchanged on the first run after the change:
`tests/typed/rules.test.mjs` 10/10 (including "the fast methods, re-run, agree with the recorded
evidence", and the deliberately unsound rules' pinned counterexamples — NaN payloads included),
`tests/typed/guards.test.mjs` (14 with rules), `derivations` 12/12 (the 183 rule-citing O2 records),
`edit-classes`/`missed`/`passes` 14/14, and **the baselines check prints `no differences`**.

**What didn't work.** Three compile-time stumbles: the library's `Counterexample` name-collided with
verify.ts's own evidence type (imported as `TermCounterexample`); the by-construction proof still
wanted the old 5-argument failure recorder (kept as `counterWith`, with `failWith` wrapping the
campaign's report); and the stdlib's layering test forbids even a *type* import of `Pat` from
`src/typed/` in `types.ts` (caught at step 2 already).

**What I learned.** The re-run evidence agreeing with the recorded evidence is a strong equality check:
it pins the exact case sequences (the crossing cap, the seed, the draw order), so moving the loops
verbatim was the only safe path — and it worked, which says the campaigns are genuinely
domain-independent.

**What was tricky.** `ofIndex`: the current exhaustive-32 sweep assigns `x | 0` (sign-extended), not
the raw index — a detail the generic campaign could not know, so the variable interface carries it.
Also the i32 `draw`'s two-rng-call bias (`(rng.next() & 3) === 0 ? rng.next() % 17 | 0 : rng.next()`)
had to be reproduced operator-for-operator inside the domain's `draw`.

**What warrants a second pair of eyes.** The bitwise-w1 campaign now checks `holds` (the noTrap-only
`guardsHold`) where the old loop checked nothing; for every bitwise-eligible rule (and-or-xor roots,
no constant variables) the guard sets are only `pure`, which `guardsHold` ignores, so the case sets are
identical — worth a glance at `BITWISE`-eligible rules in `simplify.ts` if a new one ever carries a
`noTrap` guard.

**Code review instructions.** Read `src/typed/rules/compile.ts` against the library's
`match`/`firstMatch`/`instantiate`, and `src/typed/rules/verify.ts`'s four campaign blocks against
`src/stdlib/term/verify.ts`; then run `node --test tests/typed/rules.test.mjs tests/typed/guards.test.mjs tests/typed/derivations.test.mjs` and the baselines check.

## Step 4: Tix on the library (inline and split-sum as rules over the expression signature)

**What I did.** `src/tensor/passes.ts`: a `Signature<Expr>` (the operator is the kind, with a load's
tensor name and a reduction's op folded in; a reduction's child is its body, a load's indices are its
own data); `split-sum` as the rule `{op: 'reduce:sum', args: [{var: 'body'}]}` with the guard
"exactly one axis, a `dim` extent" (read off the matched term, which is why the library's guard
callback receives it), applied by a `mapExpr` walk through the library's `firstMatch`; `inline` as a
rule *instance* per producer — pattern `load:<producer>`, template a domain function that substitutes
the producer's expression under the read's indices — with the pointwise/single-use/not-the-result
conditions still the driver's (facts about the statement list, exactly as the intern guide says). The
library's rule type gained the guide's allowance: the right-hand side may be a domain function
(`Rhs<T, C> = Template<C> | ((b, matched) => T)`), because the library knows nothing of binders.

**Why.** Item 3 of the brief: both Tix rewrites become rules through the same library Typed's tables
use, and the revisions must not change, so the drivers keep today's statement order and merge
recording verbatim.

**What worked.** All 39 non-GPU tensor tests pass (passes, language, plans, r3-tix-in-plans, fusion,
corpus), `tests/typed/derivations.test.mjs` passes, and the baselines check prints `no differences`
(the `optimizeTix` revisions and CUDA sources are byte-identical).

**What didn't work.** Only a quote-character syntax error in a string I edited in the library
(`the domain's` inside single quotes); and Prettier flagged `src/tensor/passes.ts`, which turns out to
have been one of the seven files the repo keeps unformatted — my rewrite is now formatted, which the
report notes (the diff shows the old file's formatting noise, not a semantic change).

**What I learned.** The subtlety that kept revisions identical: `mapExpr` walks post-order, so the
matched reduce's body binding is the *already split* body — the rule sees exactly what today's inline
callback saw. And a load's indices cannot be pattern children (they are affine forms, not
expressions), which is why the pattern is the bare load and the template function reads the matched
node's indices.

**What was tricky.** Typing a rule whose right-hand side is a function without disturbing Typed's
table types: `TermRule` gained a third parameter `T` (default `unknown`) used only by the function
form, so Typed's `Rule` still fits structurally and Tix writes `TermRule<SplitGuard, never, Expr>`.

**What warrants a second pair of eyes.** Tix's rules are verified only by the meaning gate, not by
the library's verifier: `split-sum` is a tolerance rule (its exact-equality check would be the wrong
job), and a rule-level checker for `inline` would duplicate what the gate already checks on every
application — the guide's open question 3, answered here. If the coordinator wants Alive-style
per-rule verification for Tix later, the case generator must produce shaped tensors, not scalars.

**Code review instructions.** Read the three rule definitions in `src/tensor/passes.ts` against
`corpus/tensor/` (each program's revisions are pinned by the baselines); run
`node --test tests/tensor/passes.test.mjs tests/tensor/corpus.test.mjs` and the baselines check.

## Step 5: F40 — the merged statement's correspondence entry says `merged`

**What I did.** One branch in `stepEntries` (`src/framework/ir/derivation.ts`): a step with relation
`merged` whose produced entities are in the target maps its antecedent (the consumed statement) to the
entities it produced — which the output already had — and the entry is named by the step's own relation
(`merged`), not the derivation's label; a group's relation is the label unless a merge names it. Updated
the module comment. Updated the three tests that pinned the 056-B decision:
`tests/framework/derivation.test.mjs` ("a merge records the link without changing the correspondence"
→ "a merge records the consumed statement as merged into its consumer", and the runner test's
`squareCopy` entry) and `tests/typed/derivations.test.mjs:182` (now asserts
`{from: ['f/a'], to: ['f/b'], relation: 'merged', note: '…substituted into…'}`).

**Why.** The brief requires F40 and points at IRWB-056-A's `src/tensor/passes.ts`; but as established in
step 1, the recording (the derivation step) was already truthful — 056-B's framework simply dropped the
merge from the correspondence, and a native result cannot give both a derivation and explicit entries.
The truthful entry needs the framework to read `merged` steps; without that branch the deliverable is
impossible from `src/tensor/passes.ts` alone. This is the one place this lane steps outside its stated
file scope (`src/framework/ir/derivation.ts`, `stepEntries` only), and it is flagged for the
coordinator: F41's lane owns the file's coverage parts; my change touches `stepEntries`, and both can be
merged by union.

**What worked.** All 266 framework tests pass (with the two updated assertions), the 12 derivation
tests pass, and the baselines still print `no differences` (the correspondence is not part of them —
the Tix revisions and CUDA bytes are unchanged, as required).

**What didn't work.** The updated equality test failed once on a detail I had not expected: the merged
entry also carries the step's `note` ("f/a is substituted into f/b, which returns its result") — the
step's note rides to the correspondence entry exactly as a `modified` step's does. The test now asserts
it; it is evidence, not noise.

**What I learned.** The framework tests *documented* the 056-B decision ("a merge records the link
without changing the correspondence") — F40 reverses a recorded design decision, which is why the test
names were updated rather than the assertions alone: the reader should see that the policy changed, and
where.

**What was tricky.** Keeping `modified` steps' entries named by the label (`simplify`, `fold`) — using
the step's relation for every entry, as 056-A did, would have changed every Typed correspondence's
entry relations from the pass's label to `modified` and broken the derivation-equals-today check. So
only `merged` steps name their entry; the comment says why (the entry states what happened to the
consumed side, which the label does not describe).

**What warrants a second pair of eyes.** (a) The scope exception itself, and whether the coordinator
would rather have had F40 in F41's lane. (b) A merge chain (`a` into `b`, then `b` into `c`) now yields
two merged entries (`a→b`, `b→c`) rather than 056-A's resolved final survivor — today's derivation
records direct consumers (pinned), so the correspondence follows the steps; tracing through both hops
reaches `c`. (c) The merged entry's `to` names an entity another entry (`retained`) also names as `to`
— allowed by `validateCorrespondence` (each side must be *covered*, not partitioned), but worth a look.

**Code review instructions.** Read the `merged` branch in `stepEntries` against the `removed` branch
below it and the 056-A version (`git show v7-derivations-g-h/irwb-056-a:src/framework/ir/derivation.ts`,
`stepEntries`); run `node --test tests/framework/derivation.test.mjs tests/typed/derivations.test.mjs`;
then re-run probe 01 to see the new entry.

## Step 6: the decision point — the library rule path against today's compiled matcher, interleaved

**What I did.** Probe `scripts/03-o2-rule-path-vs-compiled-matcher.mjs`: one process, the whole corpus
(50 projects), each compiled through the full O2 pipeline (16 steps, the meaning contract on every
application) once with today's `PASSES` (whose fold/simplify now match through the library) and once
with a verbatim copy of the pre-IRWB-060-A matcher (from commit 5d52199's `compile.ts`) built into
equivalent fold/simplify bodies. The order alternates each round (library-first, then direct-first);
both runs of each round are compared for revision equality. Three runs: 3 rounds, 5 rounds, 5 rounds
(outputs in `scripts/*.out`).

**Why.** The brief's decision point: if the library path is materially slower — about 10% of compile
time — Typed keeps its compiled visitor and only the matcher and verifier are shared.

**What worked.** No revision differences in any run. The numbers:
- run 1 (3 rounds): whole pipeline library 32.6 s vs direct 31.5 s (+3.4%); fold+simplify 7.27 s vs 8.42 s (−13.7%).
- run 2 (5 rounds): 52.1 s vs 49.5 s (+5.2%); 12.55 s vs 12.14 s (+3.4%).
- run 3 (5 rounds): 51.6 s vs 50.3 s (+2.7%); 12.31 s vs 12.71 s (−3.2%).

**What didn't work.** The first probe draft had a syntax error (a broken template literal) and read
`PASSES.fold.writes` from the transformation object instead of `PASSES.fold.typed` (the wrapper); both
fixed before the measurements. The per-pass `ms` numbers turned out to jitter by several percent in
both directions (they include the meaning contract, which dominates), so the fold+simplify-only column
oscillates in sign between runs — it is reported but not the decision number.

**What I learned.** The library path is *not* materially slower: the whole-pipeline deltas over three
runs are +3.4%, +5.2% and +2.7% — around the measurement's own run-to-run spread, and well under the
~10% threshold. The decision: **Typed keeps the library path** (no fallback to a private matcher);
the numbers are reported either way, as the brief requires. The residual cost is the signature
indirection (a `Map` per rule attempt where the old matcher allocated a plain object, and `sig.op`/
`sig.args`/`sig.constant` callbacks where it read fields).

**What was tricky.** Making the comparison honest on a loaded machine: both paths in one process
(warm caches equal), the order alternated per round, the whole pipeline measured (the contract is part
of "compile time", and it is the same work for both), and the revisions compared so the probe cannot
reward a faster-but-wrong path.

**What warrants a second pair of eyes.** Whether ~3–5% of O2 compile time is an acceptable standing
cost for one shared matcher (I believe it is: the threshold the brief sets is ~10%, and the drift
between runs is of the same order as the delta). If the coordinator disagrees, the fallback is
mechanical: restore the copied matcher from the probe into `compileRules` and keep the library's
verifier and Tix rules.

**Code review instructions.** Run `node scripts/03-o2-rule-path-vs-compiled-matcher.mjs` (about
2 minutes; from the repository root) and compare with `scripts/03-o2-rule-path-vs-compiled-matcher.out`;
check that the copied "direct" matcher in the probe matches commit 5d52199's `compile.ts` line for line.

## Step 7: the Tix terms test, the site build, the acceptance sweep

**What I did.** Wrote `tests/tensor/terms.test.mjs`: for every Tix corpus program, the recorded
revision after `inline` and after `split-sum` (from probe 04), the plan's agreement with the per-pass
applications, `inline`'s merges equal to an independent single-use-pointwise analysis of the original
statements (each merged statement gone, its consumer kept, the F40 correspondence entry saying the
merge), and `split-sum` leaving no one-axis dimension-bound `sum` with one blocks/tail pair per matched
reduction. Ran `node tools/build-site.mjs` (stdlib changed). Then the acceptance sweep on the last
commit: `npm run check`, `npm run build`, the suites, the baselines.

**Why.** The acceptance asks for my own tests pinning the Tix revisions and the F40 entry, and the site
must be rebuilt when `src/stdlib/` changes.

**What worked.** The terms test passes (3/3); the site builds (50 projects, 134 source files); the
full sweep (below) is green.

**What didn't work.** Two test-draft bugs: the recorded-revision table was filled with placeholder
hashes before probe 04 printed the real ones (replaced), and my first `expectedMerges` helper counted
a statement's reads in *all* statements instead of the later ones (inline's own condition), which made
the expectation disagree with the pass on chain-merging programs; and `conv2d` has no one-axis `sum`
(its convolution reduces over two axes), so the "the split reductions are there" assertion had to
become "one pair per matched reduction, and the corpus matches at least one somewhere".

**What I learned.** `optimizeTix`'s step records do not carry the intermediate revision, so the
recorded-revision test applies the passes itself (`applyNativePassSync`) — which also exercises the
runner path the plan uses.

**What was tricky.** Nothing new; the acceptance numbers are in the report.

**What warrants a second pair of eyes.** The recorded revisions in the test duplicate (in short form)
what the coordinator's baselines pin; if a later lane legitimately changes Tix revisions, both places
must change — the test says so in its comment.

**Code review instructions.** `node --test tests/tensor/terms.test.mjs`; then the full sweep as in
the report.
