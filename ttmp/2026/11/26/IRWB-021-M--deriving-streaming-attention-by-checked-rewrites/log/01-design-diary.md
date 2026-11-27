---
Title: Design diary — deriving streaming attention by checked rewrites
Ticket: IRWB-021-M
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
    - performance
DocType: log
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-021-M--deriving-streaming-attention-by-checked-rewrites/scripts/01-f32-probe.mjs
      Note: the probe written in step 3 and iterated three times
    - Path: repo://ttmp/2026/11/26/IRWB-021-M--deriving-streaming-attention-by-checked-rewrites/various/01-f32-probe.txt
      Note: the recorded output the design's Part 3 cites
ExternalSources: []
Summary: >
  Chronological design diary: orientation in the framework and IRWB-006/008/011, the twelve-probe
  f32 measurement (and the three metric/construction mistakes it took to get it right), the design
  with its forced rule order and its two abandoned drafts, and the bookkeeping.
LastUpdated: 2026-11-26T22:45:00-05:00
---

# Diary — IRWB-021-M, deriving streaming attention by checked rewrites

Design ticket. No implementation. The deliverable is one design document, one measurement script,
and this diary.

---

## Step 1: Orientation — the framework, and the three prior tickets this design leans on

The ticket is a research design, so the first job was to find out what the workbench already has
for "a rewrite whose application is checked", because the question is exactly that question asked
of a new language. Three prior tickets turned out to carry the vocabulary: IRWB-006 (rewrite rules
as verified data, with an evidence record per rule pinned to a fingerprint and a strength drawn
from `proof > exhaustive > reduced-width+argument > by-construction > sampled`), IRWB-008 (exact
re-derivation of rule-backed edits, and the discipline of reporting step-level and chain-level
strength separately), IRWB-011 (float-exactness in Typed, why the f32 world is not exact, and the
proposal for a *tolerance* contract with an assurance value the framework does not yet have).

### Prompt Context
**User prompt (verbatim):** "You are a coding assistant running inside pi, a coding agent
harness. Help users inspect files, run commands, and modify code. […] Your ticket is IRWB-021-M.
Your task is a **research design**: a document, no implementation. Create the ticket, write the
design document, keep a diary, and commit." The full brief follows (Tix core, f32 meaning, the
five things the design must settle, the constraints); it is the ticket's user message and is
quoted in part above, and it is referenced, not repeated, from here on.

**Assistant interpretation:** Produce a design document that answers whether FlashAttention can be
*derived* from the plain Tix attention program by a sequence of checked rewrites, covering the five
listed items (rules, the missing construct, checking, generality, the experiment), in a docmgr
ticket with a diary, committed but not pushed.

**Inferred user intent:** The user is starting a second domain on the same IR framework and wants
to know, before building, whether the framework's central claim (every optimization step is
checked, locally) survives contact with a float GPU domain where the interesting rewrites are not
bit-exact. The brief's insistence on "exact algebraic argument over the reals" plus "say what the
f32 differences are" suggests the answer is expected to be a *mixed* one, not a yes.

**Commit (code):** none yet at this step.

### What I did
- `git status`, `git log --oneline -5`, `ls src`, `ls src/framework`, `ls ttmp/2026/11/*`.
- Read `src/framework/contracts/types.ts` (full), the head of `contracts/differential.ts`,
  `contracts/index`, and the line counts of `contracts/*` and `ir/*`.
- Read the headings of every design doc in `ttmp/2026/11` to find the nearest neighbours, then
  read IRWB-006 §8–16 (rule form, rule compiler, verification methods, evidence records),
  IRWB-008 §5–9 and §16–22 (applyPass, meaning contract v1, the memo, v2, rules as data, the edit
  validator, regional obligations, evidence-strength order, contract v3), and IRWB-011 §5–19
  (contracts and where a tolerance plugs in, IEEE-754 and what reassociation/contraction/reciprocal
  change, the tolerance revision, cost).
- Read `ttmp/vocabulary.yaml`, `docmgr --help`, `docmgr ticket create-ticket --help`.

### Why
- The design's checking section has to name concrete framework objects (`CaseComparison`,
  `assuranceOf`, `DifferentialSpec`, `TransformationDefinition`, the evidence strength order),
  otherwise it is a proposal for a different system.
- IRWB-011 is the only place in the repository that has thought about a relation that is not bit
  equality, and its conclusion ("no vocabulary entry for 'within a bound'") is the gap this domain
  falls into. Starting from it avoided inventing a parallel contract vocabulary.

### What worked
- The framework is domain-parametric at exactly the seams this ticket needs: an IR type and
  adapter, an evaluator, a differential spec and its keys, and rule tables. The only three missing
  pieces are a distance-carrying `compare`, a `checked-tolerance` assurance, and a budget that is a
  function of the program rather than of a scene (design §2).
- IRWB-008's warning — report a step's strength and a chain's strength separately — transferred
  directly and became §14.5.

### What didn't work
- Nothing failed at this step. One dead end: I first looked for a "float domain" abstraction in
  `src/framework` that could already express a tolerance relation. There is none; `CaseComparison`
  is `{ ok, reason? }` (`differential.ts:26`), and `assuranceOf` (`:325`) has exactly two
  outcomes. Recorded as design §2 rather than worked around.

### What I learned
- The Typed pipeline's exact checking works *because* its rules are bit-exact: an i32 rule sound
  for every 32-bit input can be re-derived without sampling. That argument does not transfer to a
  float tensor domain, and the reason is not philosophical — it is that `exp` is not rational and
  a rescale is not a no-op. This became design §7's three grades.

### What was tricky to build
- Nothing at this step.

### What warrants a second pair of eyes
- The claim that nothing in the framework *assumes* bit-exact meanings. It looked true from
  `types.ts` and `differential.ts`; someone who knows `analysis-manager.ts` should confirm that no
  cache key or transfer rule bakes in "equal".

### What should be done in the future
- If the Tix track proceeds, `checked-tolerance` and a distance-carrying `CaseComparison` are
  framework changes, not domain changes; they should be their own ticket rather than smuggled into
  `src/tix`.

### Code review instructions
- Compare design §1's file-and-line references against `src/framework/contracts/types.ts`,
  `contracts/differential.ts`, `passes/define-pass.ts` and `ir/adapters.ts` at `19ad269`.

### Technical details
- `assuranceOf` maps sampled evidence to `checked-sampled` and everything else to
  `checked-exact` (`differential.ts:325`).
- `Assurance = 'declared' | 'checked' | 'transferred' | 'proof'` (`types.ts:161`).
- `applyPass` is `define-pass.ts:190`; `createIRArtifact` is `ir/adapters.ts:128`.

---

## Step 2: Creating the ticket, and deciding what the document must contain

The ticket was created with the standard nine-directory layout. I chose the title the brief named
("Deriving streaming attention by checked rewrites") and the topics compiler/ir/verification/
research/performance, the last because the experiment's primary metric is measured device time and
bytes.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Same brief; this step is bookkeeping plus document skeleton.
**Inferred user intent:** The ticket should be findable by the question it answers, not by the
language it happens to use.

### What I did
- `docmgr ticket create-ticket --ticket IRWB-021-M --title "Deriving streaming attention by
  checked rewrites" --topics compiler,ir,verification,research,performance`.
- `docmgr doc add --ticket IRWB-021-M --doc-type design-doc --title "Intern guide and research
  design: deriving streaming attention by checked rewrites"`.
- Skimmed `ttmp/_templates/design-doc.md` and the house style of the long guides (IRWB-006/008/
  009/011 are 500–1000 lines, part-structured, with an intern-guide framing, a "what was measured"
  part, and decisions-with-alternatives).

### Why
- The repository's design docs are *intern guides*: they explain the system from scratch and then
  propose. Matching that form matters here because the audience for a research design on a
  not-yet-built domain is someone who will build it.
- The brief's five asks map to sections; putting that map in the front matter (design "How to read
  this guide") makes the document checkable against the brief.

### What worked
- `docmgr` created the workspace and a frontmatter-valid document stub; `docmgr validate
  frontmatter` accepts the final frontmatter.

### What didn't work
- `RelatedFiles` written with bare `src/...` paths validates but does not match the repository's
  convention, which is `repo://src/...` (as in IRWB-011's frontmatter). Fixed after the first
  validation pass.

### What I learned
- The doc skeleton (`Executive Summary`, `Problem Statement`, `Proposed Solution`) does not fit a
  research design; I replaced it with the house part structure. The template is a starting point,
  not a schema.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- Nothing.

### What should be done in the future
- The design-doc template could offer a research-design variant; the current one pushes toward an
  executive-summary shape that the long guides all ignore.

### Code review instructions
- `docmgr validate frontmatter --doc ttmp/2026/11/26/IRWB-021-M--*/design-doc/01-*.md`.

### Technical details
- Ticket path: `ttmp/2026/11/26/IRWB-021-M--deriving-streaming-attention-by-checked-rewrites`.

---

## Step 3: The probe — twelve measurements, and two of them changed the design

The brief asks the design to "say what the f32 differences are and where they come from", and the
repository's habit is to measure rather than assert. I wrote one dependency-free Node script that
evaluates the plain program, the offset form, the carry fold and the blocked fold under the brief's
exact f32 meaning (`Math.fround` everywhere, left-to-right accumulation), compares each against a
binary64 evaluation of the same statements, and reports the differences three ways.

This step is the one that produced the design's substance. Two results contradicted what I expected
and changed the rule set.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The f32 claims in the document must be measured, not asserted, and
the measurements must be reproducible from the ticket's own scripts directory.
**Inferred user intent:** The user expects a design that knows which rewrite is expensive, because
that is the difference between a usable rule table and a plausible one.

### What I did
- Wrote `scripts/01-f32-probe.mjs` (no dependencies, deterministic mulberry32, ~700 lines).
- Twelve probes: (0) self-checks, (1) baseline error, (2) each derived form, (3) re-association by
  block width, (4) associativity of the combine in f32, (5) a staircase adversary for the running
  max, (6) the subnormal rescale, (7) dropping the offset, (8) the division slide alone, (9) input
  classes, (10) the traffic model under two cache assumptions, (11) the tolerance relation's
  constants, (12) the two division slides separately.
- Ran it, iterated three times on the *metrics* (see below), and kept the outputs in
  `various/01-f32-probe.txt` and `.json`.

### Why
- The f32 error of a rewrite cannot be argued from the algebra: it is a property of the arithmetic.
- Three different ways of reporting the error were needed, because the first two were misleading
  (see "What didn't work").

### What worked
- **Probe 0(c)**: the offset form at `u` = the *final* max is **bit-identical** to the plain
  program (0 of 2048 elements differ). So the entire f32 difference of the derivation is
  attributable to the *running* max and the re-association, not to the quotient form. That is a
  much sharper statement than "the derived form is within tolerance", and it is what design §9.2
  and §12 (R2) rest on.
- **Probe 0(a)**: fusion of the score definition into the fold's element is bit-identical, so the
  only rule that changes memory traffic costs nothing in accuracy.
- **Probe 4**: the combine is *not* associative in f32 — 82.3 % of 20 000 random triples of
  singleton states differ between the two parenthesations, worst normalizer relative difference
  1.33e-7. So R5's obligation can never be discharged by an exact f32 argument, and must be a real
  proof plus a measured tolerance. This is the single most important negative result in the ticket.
- **Probe 7**: dropping the offset (`u = 0`) when scores are 282.8 yields **256 of 256 outputs
  inf/NaN** while the reference is exact. The rewrite is exact over ℝ and fatal in f32; the side
  condition is a *value* condition. On N(0,1) inputs the same rewrite is within tolerance (probe 2),
  which is why a per-rule sampled check could never have found it.
- **Probe 12**: the division slide the streaming form *forces* (moving `/l[i]` out of the `j`-sum)
  costs ≤ 10 ulps of the row scale; the slide it does *not* need (moving `/sqrt(D)` out of the
  `d`-sum) costs 173 ulps at 256×128 on wide inputs, because `exp` amplifies an absolute score
  perturbation by `|s|`. **This changed the rule set**: R1 is in the chain exactly once, on the
  output, and the score-side application is a separate rule that is off by default.
- **Probe 6**: the subnormal rescale — the one place where the streaming form could be
  qualitatively worse than the reference — is invisible (relative difference exactly 0 at every gap
  from 10 to 160 nats), and there is a bound that explains why: the mass before a rescale of
  `exp(−Δ)` is at most `N`, so the loss is at most `N·exp(−Δ)`, and a *subnormal* rescale forces
  that below 2e-31 for `N ≤ 2²⁴`, seven orders below an ulp of the normalizer. Recorded as a
  bounded risk rather than as a reason to exclude R3.

### What didn't work
- **First run: the metrics were wrong.** I reported `|a−b|/|b|` per element, and got "max relative
  error 3.5e-2" for the *plain* program — a number that says nothing, because attention's output
  has elements that cancel to near zero and the row is otherwise accurate to 1e-6 of its scale.
  Fixed by reporting (i) absolute, (ii) relative to the row's largest element, (iii) a ratio to the
  plain program's own error with the denominator floored at one ulp of the row scale. The third
  metric's first version floored at 1e-12·scale, which produced ratios like 212301 — also
  meaningless. The ulp floor fixed it.
- **Second run: a self-check passed for the wrong reason.** Probe 0(c) ran at `D = 16`, where
  `sqrt(16) = 4` is exact, so the score's division slide was *nil* and the comparison was trivial.
  Noticing this is what led to probe 12, which separates the two slides at shapes where `sqrt(D)` is
  inexact. A "passing" check with a degenerate parameter is worse than no check.
- **Third run: two probes did not reach the regime they were built for.** Probe 6 (late maximum)
  showed a relative difference of 0 at every gap, which I first read as a failed probe; it is a
  real result (with the bound above), but the *first* construction also had `v` all ones, which
  made the output insensitive. And probe 7's first version used `q = k = 3, D = 8`, giving scores
  of 25.5 — below the 88.7 at which `exp` overflows — so nothing overflowed and the probe "passed".
  Fixed by `q = k = 10` (scores of 282.8).

### What I learned
- One mechanism explains nearly every number in the probe: **`exp` amplifies an absolute
  perturbation of a score by the score's magnitude.** A rewrite that touches the scores pays
  `|s|·ε`; a rewrite that only reassociates the weights or the final division pays `ε`. That split
  is the design's "score-side vs state-side" distinction (§9.12, §12), and it is not something I
  would have predicted from the algebra, where every one of these rewrites is an identity.
- The plain program's own error (1e-6 to 1.7e-6 of the row scale on N(0,1)) is the yardstick any
  budget has to be stated against; a contract tighter than that rejects the program the derivation
  starts from.

### What was tricky to build
- The f32 semantics had to match the brief *exactly*, including "the reduction's body extends as
  far right as possible": `sum(d) q*k/sqrt(D)` sums `(q*k)/sqrt(D)` **per term**, not the sum then
  divided. Getting that wrong would have made the plain program bit-equal to the slid form and
  hidden the whole point of R1. The two forms are implemented separately (`scoreRow32` with the
  division inside, `scoreRowNoDiv32` without) and probe 12 compares them.
- The blocked fold must reproduce the flat fold exactly at `B = 1` and `B = N`; that pair is the
  probe's self-check for the implementation of R5 (probe 3, both 0 of 8192 differing).

### What warrants a second pair of eyes
- The claim that a *subnormal* rescale can never change the f32 output for `N ≤ 2²⁴` (probe 6 +
  the bound). It is an argument from two inequalities, checked numerically at seven gaps, and it is
  the only place in the design where a risk is dismissed rather than bounded and recorded.
- The tolerance constants (κ = 2, f_rms = 2, f_el = 16) are derived from the *minimum* floor with
  no violation over 6 shapes × 3 classes on random inputs. A distribution with much larger score
  ranges or heavier cancellation would raise them. They belong in the contract's version key for
  exactly that reason.
- `Math.exp` rounded by `Math.fround` is not a CUDA `expf`. Every number in Part 3 is a statement
  about the host's `exp`. Design risk 4 and risk 8 record this; a reviewer should decide whether
  the design's conclusions survive a different `exp` (I believe they do — they are about orders of
  magnitude and about *which* rewrite is expensive — but it is an assumption).

### What should be done in the future
- When the Tix evaluator exists, run the probe against it (not against this model) and against the
  device's `expf`; any disagreement is a finding about the evaluator's `exp`, not about the rules.
- Extend the probe to D = 256 and to multi-head shapes, where `sqrt(D)` is exact (16² ) and the
  slide's cost should vanish — a prediction the current data partially supports (D = 16, 64 exact).

### Code review instructions
- `node scripts/01-f32-probe.mjs` from the ticket directory; ≈5 s; compare against
  `various/01-f32-probe.txt`.
- The implementations to check first are `plain32` (must match the brief's order exactly),
  `foldCarry32` (the identity's first step), and `foldBlocked32` (its `B = 1`/`B = N` equality with
  `foldCarry32` is the self-check).

### Technical details
- `/usr/bin/time` reported 4.98 s wall for the full run on `v24.18.0`.
- Key figures: baseline maxRowRel 1.03e-6 (256×32); fold 1.39e-6; blocked fold in 16s 0.98e-6;
  associativity 82.3 % of triples differ; `u = 0` 256/256 non-finite; traffic ratios 15×/57×/57×/
  113× (K,V resident) and 3.33×/3.45×/1.75×/1.75× (streamed).

---

## Step 4: Writing the design

With the numbers in hand the document could be written to a decision rather than to a menu. The
structure follows the house intern-guide form: system, background, measurements, design,
experiment, decisions and risks.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Write the five items the brief lists, and nothing else as design.
**Inferred user intent:** A document that a builder can execute, and that a reviewer can argue with.

### What I did
- Wrote `design-doc/01-intern-guide-and-research-design-deriving-streaming-attention-by-checked-rewrites.md`,
  1 650 lines in six parts plus three appendices.
  - §11 the construct: a `fold` statement with a tuple carry (grammar, inherited extent inference,
    f32 semantics, the `identity`/`assoc`/`commute` obligations as *declarations*, and the
    deliberate omissions). Plus extension E2 (shape names in `aff`, `blocks(B)`) for the blocked
    kernel.
  - §12 six rules: R0 α-renaming, R1 slide, R2 offset, R3 fold extraction, R4 fusion, R5
    re-association — each with side conditions, a real argument, its measured f32 behaviour, and
    how an application is checked.
  - §13 the derivation A0 → A5 as five rule applications, with the programs written out, the side
    conditions discharged one by one, and the chain-of-strength picture; plus the *other* direction
    (R2 derives A0 itself from the naive form).
  - §14 checking: three separate claims, the contract's domain/observation/relation with measured
    constants, per-rule application checks, evidence and version keys, the chain-level warning.
  - §15 generality: six programs the rule set reaches, seven it fails on with the reason.
  - §16 the experiment: three hypotheses, the primary metric (DRAM bytes, time second), four
    kernels plus two ablations, and a refutation table whose rows each name a section.
- Decided the derivation's artifact naming (`A0…A5`) after a collision with the probe's `P0…P5`.

### Why
- The order R4, R1, R3, R4, R5 is forced by the rules' side conditions: R3 requires the output
  summand's factor not to mention a value the group defines (so R1 must move `/l` out first), and
  R3's pattern needs the `exp` visible (so the first R4 must substitute `e`). Recording *why* the
  order is forced is half the design.
- R4 first rather than R3 first is not cosmetic: a checker that unfolds definitions on its own is a
  checker whose reach cannot be stated, so the unfolding is a recorded rule application.

### What worked
- Making the two obligations (`identity`, `assoc`) *declarations on the statement* rather than
  laws built into the construct's meaning resolved the apparent contradiction at the heart of the
  problem: the construct has a total f32 meaning for any combine, and only the re-association rule
  needs associativity. With that split, R3's proof became a three-line prefix induction and R5's a
  one-line consequence of Fact 2/3.
- Stating the relation's *floor* in units of the row scale, and measuring it (probe 11), turned the
  checking section from a wish into a number: 16 ulps elementwise, 2 ulps row-RMS, insensitive to κ.

### What didn't work
- First draft put R2 on the derivation path as a separate step "generalize the offset to a
  parameter and fill it later". That split R3 into two rules and made both arguments longer; the
  prefix induction does not mention a final max at all, so R2 is not needed on the path. It stayed
  in the rule set because it justifies R5's combine renormalisation and it is what derives the
  plain program's own `max` — but as a lemma, not a step.
- First draft of §15.2 item 4 claimed that a summand multiplying two `j`-dependent factors breaks
  R3. It does not: the factor passes through the `exp` untouched. Replaced with the real boundary
  (a windowed sum whose offset is not the prefix maximum).
- First draft's §13 said "R3 consumes the `e` statement whole". It cannot: `e` is a separate tree.
  The unfolding is now its own R4 application with its stated cost (a second `exp` in the
  intermediate program, removed again by R3).

### What I learned
- The plain program's `max` is *itself* an instance of R2 (`u = max`), and the `u = 0` variant is
  the same rule without its guard. That puts the program we start from, the streaming form and the
  failure case on one axis, which is the strongest generality argument the rule set has.

### What was tricky to build
- Keeping "what is proved over ℝ", "what is bit-exact in f32" and "what is measured" apart in every
  section. The document's three-grade table (§7) is the discipline that made it possible; every
  rule row in §12 has four columns and none of them may borrow from another.
- The blocked form needs `j = b·B + t` inside a `ref`, which the core's `aff` cannot express. Making
  that a named, minimal extension (E2) with a stated cost (annotation instead of inference) was
  easier than pretending the core suffices.

### What warrants a second pair of eyes
- R3's recovery: the claim that the induction is discharged by a *complete* normalizer for a
  fixed fragment (sums of `exp(score − offset)` times arbitrary factors, plus maxima). The
  completeness claim is the load-bearing one; §12 states the fragment and the residual obligation,
  and risk 3 asks for a test corpus just outside it.
- The decision that R2's range condition is discharged *structurally* when `u` is the fold's
  running max. That is what makes the derivation self-guarding and it is the design's main claim
  about why *deriving* beats *choosing* an offset. It depends on §11.4's invariant being right.
- The budget's looseness: 16 ulps of the row scale is ~2e-6 relative, i.e. the derived kernel is
  allowed two fewer decimal digits than the plain program. Risk 1 states it; a reviewer should
  decide whether that is acceptable for the intended use, or whether the streaming form is simply
  unavailable under a tighter contract. I believe the latter is true (the forced slide), but it is
  a consequence a user should see before accepting the design.

### What should be done in the future
- The `Later` list (§19) is 12 one-line items; the ones that would change the design if they came
  first are: masks as range predicates, and range analysis for R2's guard.
- The experiment's first deliverable should be the device-vs-evaluator `exp` gate, before any
  timing (§16.4, last row).

### Code review instructions
- Read §10 (what the numbers decided) and §17 (decisions against alternatives) first; they are the
  argument. Then §12–13 for the rules and the derivation, then §14 for what is actually guaranteed.
- Cross-check the rule list in §12 against the derivation in §13: every rule applied there must
  have its side conditions discharged in the text, and every rule in the table that is *not*
  applied must be explained (R0, R2).

### Technical details
- Document: `design-doc/01-intern-guide-and-research-design-deriving-streaming-attention-by-checked-rewrites.md`,
  1 648 lines, ~16 600 words.
- Rule summary (§12): R0/structural-exact, R1/real-proof+tolerance, R2/real-proof+range obligation,
  R3/real-proof (induction)+tolerance, R4/bit-exact, R5/real-proof (assoc)+tolerance.

---

## Step 5: Bookkeeping and commit

Tasks, index, changelog and file relations, then one commit on `r1b-ds-h/irwb-021-m`.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Finish the ticket state and commit with the `IRWB-021-M:` prefix, no
push.
**Inferred user intent:** The ticket should be resumable by someone else without reading this
session.

### What I did
- `docmgr task add` ×5, `docmgr task check` ×3 (the diary and commit tasks close with them).
- `docmgr doc relate` for the six files the design actually rests on (the framework files it cites
  and the three prior designs), `docmgr changelog update`, `docmgr doctor`.
- Committed.

### Why
- `RelatedFiles` is kept to the six files a reviewer should open; the commit itself is the full
  changed-path inventory.

### What worked
- `docmgr doctor --ticket` reports no stale docs; frontmatter validates.

### What didn't work
- Nothing.

### What I learned
- Nothing new.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- Nothing.

### What should be done in the future
- The design is `draft`-quality in one respect only: the device half of the experiment has no
  measurements, because nothing in this worktree reaches a GPU. That is stated in §9.11 and §16.5
  rather than papered over.

### Code review instructions
- `git show --stat HEAD`; then `docmgr doctor --ticket IRWB-021-M`.

### Technical details
- Commit: see `git log --oneline -1`.
