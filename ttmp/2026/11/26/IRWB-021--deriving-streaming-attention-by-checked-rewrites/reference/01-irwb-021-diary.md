---
Title: IRWB-021 diary
Ticket: IRWB-021
Status: active
Topics:
    - research
    - compiler
    - verification
    - ir
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-021--deriving-streaming-attention-by-checked-rewrites/scripts/01-f32-step-deviation.mjs
      Note: Per-rule f32 deviation, the bit-exact fusion, the no-max overflow
    - Path: repo://ttmp/2026/11/26/IRWB-021--deriving-streaming-attention-by-checked-rewrites/scripts/02-rescale-count.mjs
      Note: Deviation against the rescale count; refutes the O(#rescales) model
    - Path: repo://ttmp/2026/11/26/IRWB-021--deriving-streaming-attention-by-checked-rewrites/scripts/03-accuracy-vs-origin.mjs
      Note: Derived vs given against the f64 formula over four score ranges
ExternalSources: []
Summary: Chronological diary of the design of a checked rewrite chain that derives streaming attention in Tix, including three f32 probes and one refuted hypothesis.
LastUpdated: 2026-11-26T23:10:00-05:00
WhatFor: ""
WhenToUse: ""
---

# IRWB-021 diary

Worktree: `r1b-ds-x/irwb-021-n`, base commit `19ad269`.

## Step 1: reading the framework the design has to use

The ticket is a research design with no implementation, so the first job was to find out what the design may
claim exists. I read the semantic-contract layer, the rewrite engine, the rule verifier and the f32
semantics, in that order, because the design's checking story is built out of exactly those four.

### Prompt Context
**User prompt (verbatim):** "You are working in a git worktree of the IR Workbench repository (TypeScript,
Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V on a reusable IR framework
(`src/framework/`) in which every optimization pass is checked against the original program. A second domain
is being started on the same framework: tensor programs written in Tix, an index-notation language specified
below, to be compiled to CUDA for an NVIDIA GB10 GPU. The Tix front end, evaluators and a meaning contract
with a tolerance relation are being built in parallel and are not in your worktree. Treat the Tix core below
and its f32 meaning as given. […] Your ticket is IRWB-021-N. Your task is a **research design**: a document,
no implementation. Create the ticket, write the design document, keep a diary, and commit." — followed by the
fixed Tix core (grammar, precedence, reduction-body rule, extent inference, f32 meaning) and the five things
the design must settle: the rewrite rules, what Tix lacks, how each step is checked, generality, and the
experiment.

**Assistant interpretation:** Design only; no code in `src/`. The five bullets are the document's spine.
**Inferred user intent:** Find out whether "compiler derives FlashAttention" is a real research programme on
this framework, and what it costs — with the derivation's *locality* as the thing actually being tested, not
the kernel's speed.

### What I did
- `src/framework/contracts/README.md`, `definitions.ts`, `types.ts`, `differential.ts` — the definition
  APIs, `InvariantDefinition`, `TransformationDefinition`, `differential()` with its `compare` hook,
  `baselineKey`/`subjectKey` reuse, and `assuranceOf`'s `checked-sampled` vs `checked-exact`.
- `src/framework/ir/PATTERNS-AND-REWRITES.md` and `rewrites.ts` — rules as immutable data plus versioned
  guard/replacement, per-step transactions, the seven schedules, budgets, and `host-accepted` needing a
  semantic gate.
- `src/typed/rules/verify.ts` and `semantics.ts` — a rule verified once for every input of its types, with
  the strength order `proof > exhaustive > reduced-width+argument > sampled > by-construction` and the
  `f32-special` method.
- `src/typed/f32.ts` — the bit-exact operator tables, RNE, canonical NaN, "never fuses a product and a sum",
  and the fact that an f32 result is one `Math.fround` of the double result.
- `src/typed/evaluate.ts` — `agrees` (bit-exact) and `meaningKept` as a `differential()` invariant.
- Design docs of IRWB-008 (edit validator, `deriveRevision`, the residual, evidence strength) and IRWB-011
  (tolerance contracts, the paired/independent comparison pair, "a tolerance needs a principled scale").
- Grepped for `tix|flash|attention|cuda|gb10`: nothing. Confirms the Tix side is all Proposed.

### Why
The brief says "each of which is checked" and "the framework's contract has a domain, an observation and a
relation". Those are not metaphors in this repository: `defineInvariant` gives the predicate, `differential()`
gives the domain/observation/relation triple, and `rewrites.ts` gives the per-step acceptance. Designing
against them means the design can say *which* existing object does the checking instead of inventing a
mechanism.

### What worked
Nothing to run; the four layers are already partitioned exactly as the design needs them (algebra here,
sampling there, structure elsewhere), and `verify.ts`'s strength order gives the per-rule obligations a
vocabulary to be ranked in.

### What didn't work
`npm` scripts are unusable in this worktree — no `node_modules`, and `npm run build` would need an install
that the ticket does not need. Kept all probes to plain `node` with no dependencies.

### What I learned
- The framework's contracts know nothing about tolerance: `agrees` is bit equality, and IRWB-011 identified
  `differential()`'s `compare` as the place a tolerance plugs in. So a tolerance relation is *expressible*
  today, and its constants are the design's job, not the framework's.
- IRWB-008's division of labour — exact re-derivation per edit, sampled check per revision — is the shape
  the Tix chain should copy, and it is what makes "local and mechanical" measurable rather than rhetorical.

### What was tricky to build
Nothing yet. The reading did produce the design's central realisation, though: the framework has no
reduction with a non-scalar accumulator anywhere (Typed's IR is statements over value trees; `sum`/`max` in
Tix are scalar-accumulating), so "what Tix lacks" is a genuine gap in *both* languages, not a missing
convenience.

### What warrants a second pair of eyes
The claim that a tolerance plugs into `differential()`'s `compare` without changing the framework. The
`DifferentialSpec.compare` signature takes two outcomes and returns a verdict, which is enough; but
`baselineKey` memoisation assumes the verdict is a function of the origin's outcome and the subject key,
which stays true for a tolerance.

### What should be done in the future
If the design is implemented, the tolerance relation should be a `ValueType` carrying its constants, not a
closure captured in a checker, so that the relation is inspectable in the revision's evidence.

### Code review instructions
Read `src/framework/contracts/differential.ts` (`differential`, `decideCase`, `assuranceOf`) and
`src/typed/rules/verify.ts` (the `Strength` type and `argumentFor`) before judging §18–§21 of the design.

### Technical details
`u = 2^-24 = 5.960464477539063e-8`. `exp` overflows f32 above 88.723, underflows to zero below −103.279
(measured in node; see Step 2).

## Step 2: three f32 probes, and one hypothesis refuted

Before writing anything about f32 differences I wanted numbers, not guesses. The Tix evaluator does not exist
in this worktree, but the f32 meaning is fully specified in the brief, so the four programs the design
compares can be transcribed directly with `Math.fround` and run. That is cheap, it is honest (it measures the
meaning, not an implementation of it), and it turned up something that changed the design.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The tolerance relation's constants have to come from somewhere; measuring them
now is cheaper than designing around a guess.
**Inferred user intent:** A tolerance contract whose constant is a guess is exactly what IRWB-011 warns
against.

### What I did
- `scripts/01-f32-step-deviation.mjs` — transcribes P0 (the given program, literally, with per-term
  divisions per the grammar's reduction-body rule), P1 (only R-hoist applied), P2 (hoisted + fused fold),
  P5 (streaming, running max), P7 (tiled), plus the f64 formula. Reports the drift contributed by each rule
  separately, the number of rescalings per row, an isolating case with the argmax at `j = 0`, a
  bit-identity check on the fusion, and a no-max form for the overflow demonstration. Outputs in
  `various/01-f32-dev-N{128,256,512}-D64-scale{1,4,16}.txt`.
- `scripts/02-rescale-count.mjs` — same score multiset in two orders: increasing in `j` (the running max
  grows at every step, N rescalings per row) and decreasing (one rescaling per row). Output
  `various/02-rescale-count-D32.txt`.
- `scripts/03-accuracy-vs-origin.mjs` — four decades of score range, derived and given each against f64.
  Output `various/03-accuracy-vs-origin.txt`.

### Why
Three specific claims in the design needed evidence, and each is falsifiable on its own: (a) R2/R3 are
bit-exact, so the memory win is numerically free; (b) R4's error is small; (c) R6 fails outside its domain.

### What worked
- (a) confirmed: `R2+R3 = 0.00u` on every run and on a second independent case — bit-identical.
- (c) confirmed, and violently: at `max|s| = 322.9` the no-max form gives **8192 of 8192** non-finite
  outputs where the running-max form gives 0.
- Isolating case: with the argmax at `j = 0` the running max never grows, every rescaling factor is exactly
  `exp(0) = 1`, and P5 is **bit-identical** to P2 on 128, 256 and 512 rows — which pins R4's deviation
  entirely on the rescalings and on the changed exponent origin.
- Per-rule attribution at D = 64, scale 1: R1 2.0–2.9u, R2+R3 0.00u, R4 2.2–2.6u, R5 1.8–2.6u; derived vs
  given 2.4–3.3u; given vs f64 1.9–2.4u; derived vs f64 1.6–2.8u.
- The conditioning law: across score ranges 1.5 → 95 the absolute deviation of *both* forms from f64 is
  ≈ 1.2·u·max|s|·‖v‖∞.

### What didn't work
My working model before probe 2 was "one rounding per rescaling, so the error grows like O(#rescales·u)", and
I expected the increasing-score case to be the worst. It is the *best*: 64–512 rescalings per row give
0.5–1.0u, against 2.2u for the random case with 6 rescalings per row, and exactly 0.00u when nothing
rescales. The model was wrong and is deleted from the design; §17 gives the mechanism instead (the factor
multiplies λ and ν identically, so its rounding error is common-mode and cancels in ν/λ, and the weights
carrying the most rescalings are exponentially the smallest).

### What I learned
- The dominant f32 error in attention is the score's representation, which the given program already pays;
  the derivation's own contribution is the difference of two *correlated* evaluations and is *smaller* than
  either one's distance to the truth. That is what makes a few-ulp tolerance contract non-vacuous.
- A tolerance without a term proportional to the problem's conditioning is either vacuous or fails on sharp
  softmax. This forced the relation's form (`u·(4 + M)`, M = max|s|) rather than a constant κ.
- `exp(-Infinity) === 0` and `Math.fround` of it is 0, so the `-inf` initial state needs no special case.

### What was tricky to build
Attributing the drift per rule required transcribing *P1 as well as* P2, otherwise "R-hoist" and
"fusion" are confounded by the two hoists. The P1 transcription is P0 with only the two divisors lifted,
keeping `e` materialised.

### What warrants a second pair of eyes
The `u·max|v|` normalisation of the drift. It is the right scale for a convex combination of `v`'s, but it
means the numbers are comparable across `D` and not across `‖v‖∞`; §18 states the relation with `‖v‖∞`
explicitly, and the doc says so.

### What should be done in the future
Probe 2 should be repeated on the real Tix evaluator once it exists, so the deviation numbers are attributed
by the compiler's own rule chain rather than by a hand transcription.

### Code review instructions
`node ttmp/2026/11/26/IRWB-021--*/scripts/01-f32-step-deviation.mjs 256 64 1`, then `02-rescale-count.mjs`,
then `03-accuracy-vs-origin.mjs`. Compare against `various/01-f32-dev-N256-D64-scale1.txt`,
`various/02-rescale-count-D32.txt`, `various/03-accuracy-vs-origin.txt`.

### Technical details
The transcription follows the brief's f32 meaning operation by operation: `sum` and `max` accumulate in
increasing lexicographic order from `0` / `-inf` with a rounding after each step; the reduction body extends
to the end of the statement (so both reductions in P0 divide per term); `exp` is `fround(Math.exp(x))`.

## Step 3: the rule set, and why its order is forced

The design's substance is a small rule set whose *ordering* is not free. I wrote the derivation first and
then went looking for the rules, which is the opposite of how the document presents it, and the order only
became visible once the derivation was written end to end.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** "State each rule with side conditions and its exact algebraic argument, then
give the derivation as a sequence of applications."
**Inferred user intent:** If any step needs a hand-written argument, the design has failed the question.

### What I did
- Wrote P0 → P1 → P2 → P3 → P4 → P5 in the extended Tix syntax before naming any rule, then grouped the
  edits into R1 (hoist), R2 (fold-form), R3 (name), R4 (recanon), R5 (reassoc), R6 (drop-max).
- Proved the one lemma everything rests on (the representation lemma, §8) for two parts, and derived
  associativity, the "final state equals the program's triple" consequence, and the gauge invariance from it
  rather than assuming them.
- Checked each of the three joints in the order and wrote down why it cannot move.

### Why
A rule set that can be applied in any order has to be justified by confluence; a rule set whose order is
forced can be justified by three local facts. The second is much cheaper to check and much more informative,
because each forced joint says something about the algorithm.

### What worked
The forced order produced the design's best sentence: **R4 must precede the inlining of `s`**, because `s`
has two consumers (the maximum and the fold) until the maximum moves into the fold's state; so the N×N
tensor exists *because the maximum and the weighted sum are two passes*, and FlashAttention's memory win is
loop fusion followed by dead-store elimination, not "avoiding the matrix".

### What didn't work
The first attempt made R-drop-max the central rule (drop the shift, single additive fold, everything
bit-exact). It is the wrong spine: it only works on a domain with `α²√D ≤ 87`, and probe 1's overflow
(8192/8192 non-finite) shows the failure mode is total. Demoted to optional R6 with a proved range bound,
and R4 — the running maximum — became the central rule.

### What I learned
The interesting rule is not the recombination of partial sums (associativity, which every compiler does) but
the *representation* of the reduction's state: the maximum is mergeable and range-bounding and the other two
components are a gauge orbit under moving it. That is the lemma's content, and it is what the design should
be reused through.

### What was tricky to build
Keeping the fold's *meaning* independent of associativity. A left fold in index order is deterministic and
needs no laws; associativity is then a side condition of R5 only. That inversion (laws on rules, not on
programs) is what let R2/R3 stay bit-exact and R4/R5 be the only value-changing steps.

### What warrants a second pair of eyes
R5's side condition: "associativity and order preservation, not commutativity". A left fold is invariant
under regrouping only within its order, so this is right, but it is the kind of statement that is easy to
get subtly wrong in the other direction (claiming commutativity is needed).

### What should be done in the future
The lemma should be checked by the normaliser on the derived combine for real, not by hand, as soon as the
normaliser exists.

### Code review instructions
§8 (the lemma and its consequences), §12 (R4 and its f32 status), §15 (the chain), and §15's "why the order
is forced" list.

### Technical details
The lemma: for `Z(J) = (max_{j∈J} A_j, Σ_{j∈J} e^{A_j − μ_J}, Σ_{j∈J} e^{A_j − μ_J} W_j)` and disjoint
`J₁, J₂`, `Z(J₁ ⊎ J₂) = κ(Z(J₁), Z(J₂))` with `m = max(μ₁, μ₂)`, `λ = e^{μ₁−m}λ₁ + e^{μ₂−m}λ₂`, and the
same for `ν`; `Z(∅) = (−∞, 0, 0)` with `e^{−∞} = 0`.

## Step 4: the contract, and fitting its constants to what was measured

The checking section had to answer the brief's exact words: a domain, an observation, a relation, exact or
tolerance, per rule. Fitting the relation to Step 2's numbers changed it twice, and the second change is the
one that makes it non-vacuous.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** "For each rule, say how its application is checked: exact argument, tolerance
check against the f64 reference, or both."
**Inferred user intent:** No hand-waving: name the mechanism and the numbers.

### What I did
- Gave every rule both obligations: `realObligation` (an identity for the normaliser) and `f32Status`
  (`bit-exact` / `rounding` / `range-bounded`), and put the division of labour in one table: once per rule
  definition, once per application, once per revision.
- Designed the two comparisons (paired against the origin, independent against f64) and fitted
  `u·(4 + M)` / `u·(8 + 2M)` so that every measurement falls inside with ≥ 1.7× headroom.
- Specified the normaliser's fragment and, more importantly, what it cannot do.

### Why
A tolerance relation with a single constant fails in both directions (vacuous at `κ = 1000`, too tight at
`κ = 20` once the softmax sharpens, both measured). The conditioning term `M = max|s|` is what makes one
statement serve the whole domain.

### What worked
The constants came out small and defensible: the paired deviation is 2.2·u·M at the smallest measured
conditioning, 0.54 at `M = 24`, 0.04 at `M = 95` — the relation is tightest exactly where the problem is
easiest, which is the right shape for a bound with a floor term.

### What didn't work
The first version used a per-element comparison against the origin's own error (a "no worse than the origin,
elementwise" relation). Probe 3 kills it: at every scale some elements have near-zero origin error, so the
per-element ratio is meaningless (largest ratio 6436×) while the max-norm statement is clean and stable
(2.0/2.2, 5.7/7.3, 30.7/30.7, 109.3/109.3). Dropped the per-element form.

### What I learned
The paired and independent comparisons are not redundant here: the paired one measures what the rewrite did,
the independent one catches a shared misreading of the given program — and §1 shows the given program's
literal meaning (per-term division) *differs from the textbook formula*, so a shared misreading is a live
risk, not a hypothetical one.

### What was tricky to build
Stating the observation so the finiteness assertion is not vacuous. On this domain the origin's output is
provably finite (`λ ≥ 1`), so "finite in the origin implies finite in the candidate" is a real constraint and
NaN counts as disagreement rather than as a value that might be close.

### What warrants a second pair of eyes
The interval analysis of R6 is the one place where a *proof* (not a sample) gates acceptance, so its
soundness and its margin matter more than anything else in the design.

### What should be done in the future
A forward error analysis to replace the measured constants; until then the design says plainly that the
bound is measured, not proved (§22).

### Code review instructions
§18 (domain, observation, relation, where the constants come from), §19 (the per-rule table), §20 (the
structural f32 check), §21 (the normaliser's fragment).

### Technical details
Paired: `|o_c − o_0|_∞ ≤ u·(4 + M)·‖v‖∞`. Independent: `|o_c − o_ref|_∞ ≤ u·(8 + 2M)·‖v‖∞` and the same for
`o_0`. `M = max_{i,j}|s_ij| ≤ α²√D` over the domain.

## Step 5: writing the document, and what was deliberately left out

The last step was assembly and a full cross-reference pass: the section numbers were rewritten twice, and
several "§n" references went stale, which I found by grepping every `§` occurrence against the heading list.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** One design document, a diary, a commit, and a final message giving the ticket
path, the rule set one line per rule, and the commit hash.
**Inferred user intent:** A document a reviewer can read end to end and act on, not a sketch.

### What I did
- Wrote `design-doc/01-deriving-streaming-attention-by-checked-rewrites.md` (nine parts: the program and its
  literal meaning; the construct Tix lacks; the six rules with their algebra and f32 status; the derivation;
  checking; generality; the experiment; decisions and alternatives; open questions) and fixed stale section
  references.
- Wrote the "Later" list as one line each, per the brief's instruction to design only what the question needs.
- Kept every claim about `src/` tied to a symbol rather than a line number, since line numbers drift.

### Why
The brief's constraints are a specification for the document's shape: settle five named things, name the
simplest alternative for each significant decision, list what is left out, and say what would refute the
experiment.

### What worked
The document's spine ended up being the f32 status of each rule, because it decided everything else: which
checks are exact, which are sampled, why the memory win is free, and why no bit-exact-only pipeline can
reach the streaming form.

### What didn't work
Two drafting passes claimed "two of five rules are value-changing, three bit-exact" and then the reverse.
The truth is three value-changing (R1, R4, R5) and two bit-exact (R2, R3), and the summary line was wrong
until the third pass. Worth noting because it is exactly the kind of claim a reviewer would check first.

### What I learned
The design's weakest point is not the algebra, which is one lemma, but §20: the structural "same f32 operation
sequence" check that makes R2/R3's bit-exactness exact rather than sampled. It is decidable for Tix's
expression language and it has not been built.

### What was tricky to build
Saying what the framework does *not* have without turning the document into a framework proposal. The rule
was: cite the existing object that does the job, and put anything else in "Later".

### What warrants a second pair of eyes
- Open question 5: the Θ(N·D) traffic claim needs a row-tiled schedule, which is below R5. The design says so
  explicitly and gives the experiment an arm without R5, but it is the easiest place for a reader to think
  the design claims more than it does.
- §26's trap: the device's `expf` is not the meaning's `exp`, so a kernel measurement conflates the
  derivation's error with the device math's.

### What should be done in the future
See the design's "Later" list; the first three items are the ones that unblock everything else (Tix front
end, meaning contract, normaliser).

### Code review instructions
Read the design in order; Parts 1 and 2 are the setup, Part 3 the rules, Parts 4–5 the derivation and its
checking, Parts 6–7 generality and the experiment. Check the three probe outputs against §16–§18, and check
that each rule's f32 status in §19's table matches the prose in §9–§14.

### Technical details
Document: 1,017 lines before the cross-reference pass, nine parts, 29 numbered sections. Probes: three
`.mjs` files, five output files in `various/`, all runnable with plain `node` and no dependencies.
