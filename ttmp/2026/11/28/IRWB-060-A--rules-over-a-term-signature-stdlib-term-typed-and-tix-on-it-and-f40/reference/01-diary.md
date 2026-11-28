# Diary — IRWB-060-A

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
