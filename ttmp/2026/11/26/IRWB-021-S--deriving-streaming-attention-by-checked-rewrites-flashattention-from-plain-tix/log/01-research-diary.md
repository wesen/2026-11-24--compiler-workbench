---
Title: Research diary
Ticket: IRWB-021-S
Status: active
Topics:
    - tix
    - cuda
    - compiler
    - ir
    - verification
    - research
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological, step-numbered research diary of IRWB-021-S: the question (can a compiler derive streaming attention from the plain Tix program by checked rewrites), the rule set and streaming lemma over the reals, the f32/f64 host-simulation probe with its controls, and the research design document (rules, the fold construct, checking, generality, the GB10 experiment)."
LastUpdated: 2026-11-27T00:00:00-05:00
WhatFor: "Resume point and evidence trail for IRWB-021-S (research design only, no implementation)."
WhenToUse: "Read the latest step when resuming; expand earlier steps only as needed."
---

# Research diary

Steps are chronological, oldest first. Scripts are in `../scripts/`, their outputs in `../various/`.

## Step 1: Orientation — the question, the framework's checking machinery, and what is given

The ticket is a research design: can a compiler derive FlashAttention's streaming form from the
plain single-head attention program in Tix, as a sequence of rewrites each of which is checked, with
each step's correctness argument local and mechanical? Nothing is implemented; the deliverables are a
ticket, a design document, this diary, and commits. The Tix front end, evaluators and the meaning
contract with a tolerance relation are built in parallel and are not in this worktree; the Tix core
grammar and its f32 meaning are given in the brief and treated as fixed.

### Prompt Context
**User prompt (verbatim):** "You are working in a git worktree of the IR Workbench repository
(TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V on a
reusable IR framework (`src/framework/`) in which every optimization pass is checked against the
original program. A second domain is being started on the same framework: tensor programs written in
Tix, an index-notation language specified below, to be compiled to CUDA for an NVIDIA GB10 GPU. The
Tix front end, evaluators and a meaning contract with a tolerance relation are being built in
parallel and are not in your worktree. Treat the Tix core below and its f32 meaning as given.

Your ticket is IRWB-021-S. Your task is a **research design**: a document, no implementation. Create
the ticket, write the design document, keep a diary, and commit.

## The question
Single-head attention in Tix, written the plain way, materializes an N×N score matrix:
```
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
  m[i] = max(j) s[i, j];
  e[i, j] = exp(s[i, j] - m[i]);
  l[i] = sum(j) e[i, j];
  o[i, x] = sum(j) e[i, j] * v[j, x] / l[i];
  return o;
}
```
FlashAttention computes the same function in one pass over blocks of j. It keeps a running maximum,
a running normalizer and a running output, rescaled whenever the maximum grows, and never stores `s`
or `e`. Its memory traffic is O(N·D) instead of O(N²). People write it by hand.

Can a compiler **derive** it from the program above, as a sequence of rewrites each of which is
checked, and so that each step's correctness argument is local and mechanical? Design the research
that would answer this." — followed by "What the design must settle" (rewrite rules with side
conditions and exact algebraic arguments; the derivation as a rule sequence; what Tix lacks, namely a
reduction whose state is not a single number, with semantics and f32 meaning; checking per rule —
exact argument, tolerance against the f64 reference, or both, and where the f32 differences come
from; generality — which programs the rule set reaches and which it fails on and why; and the
experiment — falsifiable hypothesis, primary metric (GPU time and bytes moved for the derived kernel
against the unfused lowering and a hand-written streaming kernel on the GB10) and refutation), the
fixed Tix core grammar and f32 meaning, the example softmax program, and the constraints (work from
this worktree and the brief only; design only what the question needs and list the rest under
"Later"; use the docmgr and diary skills; commit with `IRWB-021-S:` prefixes; do not push; final
message with ticket and design paths, the rule set one line per rule, and the commit hash).
**Assistant interpretation:** Produce a research design document, not code: state the rewrite rules in
Tix-level terms with side conditions and their exact arguments over the reals, give the derivation
step by step, specify the IR construct the streaming form needs, say precisely how each rule
application is checked within the framework's contract (domain, observation, relation), characterize
the f32 differences, delimit generality with reached and unreached programs, and design a falsifiable
GB10 experiment.
**Inferred user intent:** Test the workbench's central claim — that optimizations can be *derived*
by small checked rewrites rather than hand-written — on the one program where hand derivation is
famously hard, before any implementation is committed.
**Commit (code):** none in this step.

### What I did
- Read, in this worktree: `src/framework/contracts/README.md` (definition APIs, assurance levels
  declared/checked/transferred/proof, transactions, the meaning check run against the original
  artifact), `src/framework/contracts/differential.ts` (sampled differential invariants, seeded
  cases, baselineKey), `src/framework/ir/PATTERNS-AND-REWRITES.md` (rules as versioned data, guard,
  replace, schedules, per-step `TransformationResult`, host acceptance gate), and the index summaries
  of IRWB-006 (rules as verified data, once-per-rule evidence), IRWB-008 (exact acceptance of
  rule-citing edits, meaning check v2), IRWB-011 (tolerance contracts calibrated against a measured
  noise floor; the paired-test lesson that a single error budget conflates bias and divergence).
- Created the ticket with `docmgr ticket create-ticket --ticket IRWB-021-S --title "Deriving streaming
  attention by checked rewrites (FlashAttention from plain Tix)" --topics tix,cuda,compiler,ir,verification,research`,
  added vocabulary topics `tix` and `cuda`, added the design-doc and this log via
  `docmgr doc add`, and added six tasks.
- Read `ttmp/_guidelines/design-doc.md` for the required document structure.

### Why
- The design must be stated in the framework's own terms (rules as verified data, per-application
  gates against the original program, contract with domain/observation/relation, assurance levels),
  or it would specify machinery the workbench already has — or contradict it.
- IRWB-011's calibration lesson (measured noise floor, bias vs divergence) decides how the tolerance
  ε is chosen; IRWB-006's once-per-rule evidence decides how a rule's algebraic argument is recorded.

### What worked
- `docmgr status --summary-only` shows the worktree's ttmp root is wired to this worktree; ticket
  creation, doc add and task add all worked first try.

### What didn't work
- No failures. (One shell quoting error while looping `docmgr task add` over semicolon-containing
  texts; fixed with a here-doc loop.)

### What I learned
- The framework already distinguishes exactly what this design needs: per-rule recorded evidence vs
  per-application gates, exact vs sampled checking, and declared/checked/proof assurance. The design
  maps onto these instead of inventing new notions.
- Two brief details matter for the derivation: the reduction body extends as far right as possible,
  so the given program divides by `sqrt(D)` and by `l[i]` *inside* the sums; and max in f32 returns
  one of its operands, so max-reductions are order-insensitive — both shape the rule set.

### What was tricky to build
- N/A this step (no code).

### What warrants a second pair of eyes
- Whether the design's reading of the parallel meaning contract (elementwise tolerance against an
  f64 reference) is the shape actually being built; the design states this as an assumption with a
  stated dependency instead of asserting it.

### What should be done in the future
- Step 2: the rule set and the streaming lemma. Step 3: the numeric probe. Step 4: the document.

### Code review instructions
- N/A.

### Technical details
- Worktree branch: `r1b-g-max/irwb-021-s`, clean at start, on commit `19ad269`.

## Step 2: The rule set and the streaming lemma over the reals

The derivation was worked out by hand before writing anything down. The result: thirteen rule
applications from seven rules, resting on exactly four algebraic facts over ℝ (distributivity of a
constant over a sum; order-preserving index renaming; iterated max/sum over a rectangular index
split; the exponent law exp(a−b) = exp(a−c)·exp(c−b)) plus one lemma — the *streaming lemma*: the pair
(state maximum, rescaled partial sums) forms a commutative monoid under the FlashAttention combine,
and the two-level form (global max, then rescaled block sums) equals any full combination tree of
that monoid over the blocks.

### Prompt Context
**User prompt (verbatim):** See Step 1.
**Assistant interpretation:** Same ticket; this step designs the mathematical content.
**Inferred user intent:** The rules must each be local (small pattern, one-line algebraic identity)
and the whole must reconstruct the known algorithm.
**Commit (code):** none in this step.

### What I did
- Fixed the derivation order and the exact before/after program for each step:
  inline (exact) → factor-const ×2 (hoist `1/sqrt(D)` out of the score sum and `1/l[i]` out of the
  output sum; tolerance) → split-index `j = B·jt + jj` (exact) → nest-max (exact) → exp-shift with the
  block maximum (tolerance) → nest-sum + factor-const on the block sums (tolerance) → fold-intro
  (tolerance; the streaming lemma as a rewrite).
- Stated the streaming lemma precisely and proved it over ℝ by induction over any combination tree:
  combining (m₁,l₁,acc₁) with (m₂,l₂,acc₂) to frame M = max(m₁,m₂) rescales both sides by
  exp(mᵢ−M) (an instance of the exponent law), so any full combination of block elements
  (mb_t, lb_t, ob_t) evaluates to (max_t mb_t, Σ_t exp(mb_t−M)·lb_t, Σ_t exp(mb_t−M)·ob_t) — which is
  exactly the two-level form the previous steps produced. Identity is (−∞, 0, 0).
- Identified what Tix lacks: reductions whose state is a single f32. The streaming form needs a
  reduction over a user-supplied *associative combine* on a tuple state — the `fold` construct —
  plus scalar-tuple combine functions, a `-inf` literal for the identity, and shape specialization
  for the block size (T = N/B is not an affine dim expression, so the derived program is specialized
  per shape class; the check domain is per-shape anyway).
- Verified by hand that the derived combine is overflow-safe in f32 regardless of the scores:
  both rescale factors are exp(≤0) ≤ 1, and the element's exp arguments are ≤ 0 *only because* the
  shift is the block maximum — so the max-ness is a finiteness/domain side condition, not an
  algebraic one (exp(a−b) = exp(a−c)·exp(c−b) holds for any c).
- Checked the l ≥ 1 invariant: the global-max block contributes exp(0)·lb ≥ 1 and is never rescaled
  down afterwards (later rescale factors are exp(0)=1 once M is the global max), so the final
  normalizer is ≥ 1 in f32 too and the final division is well-conditioned.

### Why
- The brief asks for local, mechanical arguments. Splitting the derivation into small rules with
  one-line identities is what makes each step's argument local; a single fused "attention template"
  rule would match one program, while the pieces generalize (softmax, log-sum-exp, layernorm).
- The monoid observation is what makes blocking a *lowering* decision rather than a *correctness*
  one: once the combine's associativity is verified once, any block partition and any evaluation
  order is algebraically the same, and only the f32 tolerance distinguishes them.

### What worked
- The derivation reaches exactly the FlashAttention-1 shape: per-block scores, block max, block exp
  (values in (0,1]), block normalizer and output accumulator, one fold over blocks with rescaling,
  final division. `s` and `e` never survive a block.

### What didn't work
- No failures; hand algebra. (An earlier attempt to keep the derivation shape-polymorphic in N failed
  for a structural reason: the block count T = N/B is not an affine dim expression in Tix's type
  grammar, so the derived program must be specialized per shape. Recorded as a design decision with
  the derived-shape alternative listed under Later.)

### What I learned
- The exp-shift identity is the only step that needs a *numerical* side condition (block max), and it
  is needed for the f32 domain (finiteness), not for the ℝ identity. This splits checking cleanly:
  the algebra is checked once per rule; the domain condition is checked per application (guard +
  differential cases); the tolerance relation catches anything the guard misses.
- The original program's `/l[i]` inside the output sum (an artifact of the reduction-body rule)
  means the derivation must hoist the division *out* — a factor-const step in the "reverse" direction,
  which is fine over ℝ but tolerance-checked in f32.

### What was tricky to build
- Getting the fold's reference semantics right so that blocking stays a lowering decision: the fold
  is defined as a sequential left fold over the block index (per free-index instance), which matches
  the core's ordered-reduction convention; reassociation is then a *lowering* freedom justified by
  the once-verified associativity and checked under tolerance, not a change of meaning.

### What warrants a second pair of eyes
- The streaming lemma's edge case at the identity: combine((−∞,0,0), (m,l,acc)) = (m, 0·exp(−∞−m) +
  l·exp(0), …) = (m,l,acc) — requires exp(−∞) = 0 in f32 (true: Math.exp(-Infinity) = 0) and no
  −∞ − (−∞) NaN (excluded by the domain: block maxima are finite because scores are finite).

### What should be done in the future
- Step 3: measure the f32 behaviour of the whole chain in a host simulation before writing the
  document's checking section.

### Code review instructions
- N/A (no code yet).

### Technical details
- Rules (names used in the design document): `inline` (exact), `factor-const` (tolerance),
  `split-index` (exact), `nest-max` (exact), `exp-shift` (tolerance, guard: shift = block max),
  `nest-sum` (tolerance), `fold-intro` (tolerance, requires a once-verified combine monoid).

## Step 3: Numeric probe — host f32/f64 simulation of P0→P8 plus negative controls

Before writing the checking section, the design's empirical claims were probed with a host
simulation implementing the brief's f32 semantics exactly (Math.fround after every operation,
ordered reductions, sum from 0, max from −∞). The probe compares the original program P0, the
canonical form P2, the split form P3, the streaming fold form P8, and an f64 reference, over
10 shape configurations (N ∈ {128,256,512}, D ∈ {32,64}, B ∈ {16,32}), 4 input distributions and
2 seeds = 80 rows, and runs three negative controls.

### Prompt Context
**User prompt (verbatim):** See Step 1.
**Assistant interpretation:** The design must not rest on unmeasured f32 claims; probe first.
**Inferred user intent:** A design that cites measured evidence for its tolerance calibration and its
exactness claims, per the repo's evidence discipline.
**Commit (code):** recorded in Step 5 (committed together with the document).

### What I did
- Wrote `scripts/01-numeric-probe.mjs` (~370 lines): f32 evaluators for P0/P2/P3/P8, an f64
  reference, three controls (min-shift, broken combine — the accumulated state not rescaled —
  and mean-shift), four distributions (uniform ±1, N(0,1), "hot" with q scaled 4×, "extreme" with
  q scaled 24× so score rows span ≈ ±90), and metrics: max relative error and the *mixed* load factor
  against the tolerance relation |cand−ref| ≤ 2^-20 + epsRel·|ref|.
- Ran it: `node scripts/01-numeric-probe.mjs > various/01-probe-results.txt` — 72 s wall, exit 0,
  8/8 sanity checks pass. Summary over the 80 rows (see `various/01-probe-results.txt`):

  | distribution | max mixed(P0) @epsRel 2^-10 | max mixed(P8) | max mixed(P8)/mixed(P0) | max mixed(P8)/mixed(P2) |
  |---|---|---|---|---|
  | uniform | 0.028 | 0.020 | 1.13 | 0.98 |
  | normal | 0.099 | 0.099 | 1.31 | 1.26 |
  | hot | 1.063 | 1.048 | 2.87 | 1.17 |
  | extreme | 9.481 | 4.390 | 2.78 | 1.01 |

- `split-index` is bit-identical (o, l, m) in all 80 rows — the order-preserving-rename claim holds
  exactly in f32, not just over ℝ.
- Attribution: `P2` (inline + factor-const only) already carries most of the drift — its mixed load
  reached 2.6× P0's on hot inputs — and the streaming steps add at most 1.26× on top of `P2`
  (worst over all 80 rows). The fold itself is not the numerical risk; the hoisting steps are the
  movers, and even they stay within the ε calibration.
- Controls: the broken combine errs by 10²–10⁴× P0 everywhere (any tolerance rejects it);
  min-shift and mean-shift stay finite and accurate on tame inputs (they are algebraically exact
  over ℝ — any shift c works) but leave the finite domain on extreme scores (thousands of
  non-finite outputs), while P8 stays finite there. The max-shift guard is thus a *finiteness*
  condition, and the differential check's domain is what enforces it.
- maxRel(P0) can reach 9.68 on uniform inputs — an artifact of near-zero reference elements — which
  is why the design's relation is ε_abs + ε_rel·|ref|, not pure relative error (IRWB-011's
  bias-vs-divergence lesson again).

### Why
- The design claims (a) three of the derivation steps are bit-exact, (b) the tolerance steps move
  f32 error by a small factor, and (c) the checks are not vacuous. All three are measurable on the
  host without any GPU or front end, per the addendum's probe-before-relying rule.

### What worked
- All sanity checks pass: split bit-identical; P8 finite on the standard domain; P0 passes the draft
  tolerance ε_rel = 2^-10 on uniform/normal (its own noise floor); P8's tolerance load stays within
  10× P0's (worst observed 2.87×); the broken combine exceeds tolerance by >10×; min/mean-shift go
  non-finite exactly where the max-shift form stays finite.

### What didn't work
- First probe run (before the mixed metric): a sanity assertion "P8 within 2× of P0 error" failed on
  hot inputs (ratio up to 7.5 under pure relative error). Diagnosis: the error growth happens at the
  *factor-const* steps (hoisting 1/sqrt(D) out of the score sum), not at the fold — under the mixed
  metric the worst P8/P2 ratio is 1.26 on the whole grid. The claim was corrected to what the data
  supports: the tolerance is calibrated against P0's measured error with a safety factor (10×
  measured, worst-case observed need 2.87×), and accuracy-neutrality is measured against the
  *hand-written streaming kernel* (same algorithm), not against P0.
- The second run initially dropped the P2 columns when switching metrics, which would have left the
  design's attribution claims ("the fold is not the error mover") without saved evidence; the
  columns were restored and the run repeated before writing the document.
- maxRel as printed first was dominated by near-zero reference elements (9.68 on uniform); replaced
  by the mixed metric for all conclusions.

### What I learned
- The tolerance contract must be calibrated per input class: ε_rel = 2^-10 covers P0 and P8 on
  uniform/normal/hot up to N=512; the extreme distribution exceeds it for *both* P0 and P8 (P0's own
  mixed load 9.5), so extreme scores are outside that ε's domain, not a refutation of the derivation.
- The min-shift control *passes tolerance on tame inputs* — an honest limitation of sampled checking
  that the design states: the guard (shift = block max) carries the domain argument structurally;
  the differential check enforces it only when the case generator reaches wide-range scores.

### What was tricky to build
- The exp-shift overflow demonstration required tuning the input scale: with q ~ 4σ the score range
  is ~±15 and exp(s − min) does not overflow f32 (f32 exp overflows past ≈88.7); σ=24 pushes score
  rows to ≈±90 and the controls explode while the max-shift form stays finite.

### What warrants a second pair of eyes
- The probe's P8 evaluator computes the element arrays (mb, lb, ob) before the fold — the reference
  semantics — while the GPU lowering fuses element evaluation into the fold loop; the design argues
  bit-identity (element values are state-independent), and the probe's P8 also recomputes exp per
  combine; a reviewer should check the evaluator matches the fold semantics stated in the document.

### What should be done in the future
- Step 4: write the design document citing these numbers; Step 5: relations, changelog, commit.

### Code review instructions
- Start from `scripts/01-numeric-probe.mjs`; validate with `node scripts/01-numeric-probe.mjs`
  (exit 0, 8 PASS lines) and compare `various/01-probe-results.txt`.

### Technical details
- f32 ops: `fadd/fmul/fdiv = fround(a op b)`, `fexp(a) = fround(Math.exp(a))`, reductions accumulate
  in increasing lexicographic order with rounding after each step; inputs rounded to f32 at
  generation; seeds 1 and 2; the mixed metric uses ε_abs = 2^-20.

## Step 4: The research design document

The design document was written against the brief's five required settlements and the repo's
design-doc guidelines, with the probe's numbers in place of estimates. Structure: problem and
given context (with the assumption about the parallel meaning contract stated as an assumption);
preliminaries and the valid domain; the seven rules (pattern, replace, side conditions, exact
argument over the reals, f32 effect, check); the thirteen-application derivation with complete
programs at each milestone; the `fold` construct (syntax, reals semantics, f32 meaning, monoid
declaration, once-per-combine verification, lowering rules L1–L4); checking (per-rule table, f32
difference sources, ε calibration, the chain of meanings, negative controls); generality (reached
and not-reached with reasons); the experiment (hypothesis, arms, domain, metrics, protocol,
refutation, phases, open questions); design decisions with alternatives; Later; references.

### Prompt Context
**User prompt (verbatim):** See Step 1.
**Assistant interpretation:** Write the design document; cite the probe's measured numbers.
**Inferred user intent:** A document a second researcher could implement from, with no unstated
mathematics and no unmeasured numerical claims.
**Commit (code):** recorded in Step 5.

### What I did
- Wrote `design-doc/01-research-design-deriving-streaming-attention-by-checked-rewrites.md`
  (~19 KB): the rule set with exact statements; the derivation P0→P8; the fold construct; the
  checking design; generality; the GB10 experiment; decisions/alternatives; Later; references.
- Corrected two number claims after re-checking them against the saved probe file
  (`various/01-probe-results.txt`): "factor-const dominates" is 2.6× P0 (mixed metric), not 8.1×
  (that figure was from the first run's pure-relative column, since replaced); and the streaming
  steps add ≤ 1.26× on top of P2 (also from the re-run with restored P2 columns).

### Why
- The design must survive its own refutation criteria: every number it cites is either measured
  (probe) or marked as an assumption with a stated dependency (the shipped tolerance relation's
  shape).

### What worked
- The document's five brief settlements map one-to-one onto Parts 3–8; the addendum's contrastive
  requirement is met by Part 9 (each decision names the simplest alternative and why it falls
  short).

### What didn't work
- The two number corrections above (caught by re-reading the probe file before committing —
  exactly the discipline the diary is for).

### What I learned
- Writing the checking section forced the honest split the probe had already suggested: exact
  gates for rules 1/3/4, tolerance for 2/5/6/7, and the *finiteness* part of the domain (not
  tolerance) as what rejects the shift mutations.

### What was tricky to build
- The fold's reference semantics: it must pin enough to be checkable (sequential left fold) while
  leaving reassociation to the lowering, where the once-verified associativity licenses it.

### What warrants a second pair of eyes
- The streaming lemma's induction (Part 3.7) and the l ≥ 1 invariant (Part 2.2) — both are short,
  both are load-bearing for the domain argument.

### What should be done in the future
- Step 5: relations, changelog, index, tasks, commits.

### Code review instructions
- Read the design doc against the brief's five settlements; every empirical number should trace to
  `various/01-probe-results.txt`.

### Technical details
- The document uses the repo's design-doc frontmatter; docmgr will own RelatedFiles via
  `docmgr doc relate`.

## Step 5: Relations, changelog, tasks, commits

### Prompt Context
**User prompt (verbatim):** See Step 1.
**Assistant interpretation:** Finish the ticket's bookkeeping and commit with `IRWB-021-S:`
prefixes; do not push.
**Inferred user intent:** The ticket should be resumable from its index, diary and changelog alone.
**Commit (code):** see the git log on branch `r1b-g-max/irwb-021-s` (`IRWB-021-S:` prefixes).

### What I did
- `docmgr doc relate` for the probe script, the probe results, the three framework files the rules
  and gates target, and the diary; `docmgr changelog update` for the document; task checks;
  index overview text; commits.
- Reviewed the whole document once before committing: fixed three cross-references (the domain
  grid is section 8.3, the ε calibration is 6.4), the arm list in 8.2 (the blocked two-level form
  is arm 4; the vendor routine is informational), and the lowering-rule count in 5.6 (four, not
  three; L4 optional). `docmgr validate frontmatter` passes on the design doc.

### Why
- Per the docmgr skill: RelatedFiles tight (3–7), absolute paths, subdocument-first links.

### What worked
- Relations, changelog, index and task updates all landed on the first try (the only wrinkle:
  `docmgr doc relate` appended its notes to frontmatter entries written by hand, so the notes were
  deduplicated by editing the frontmatter once — frontmatter still validates).

### What didn't work
- The first `docmgr doc relate` batch on the design doc duplicated two notes (see above); fixed by
  editing the frontmatter.
- One `edit` call with a non-matching block was rejected wholesale (good: no partial application);
  the three real fixes were re-issued and applied.

### What I learned
- `docmgr doc relate` merges by file path and appends notes rather than replacing them when the
  frontmatter was authored by hand — write RelatedFiles by hand or via relate, not both.

### What was tricky to build
- Keeping every empirical claim in the document traceable to `various/01-probe-results.txt`: two
  numbers changed between draft and commit because the evidence file, not memory, is the source.

### What warrants a second pair of eyes
- N/A (bookkeeping).

### What should be done in the future
- Phase 1 of the design's implementation plan (the fold construct + combine verifier).

### Code review instructions
- `docmgr doctor --ticket IRWB-021-S`; `docmgr task list --ticket IRWB-021-S`; `git log
  --oneline --grep IRWB-021-S`.

### Technical details
- Final commit hash recorded in the ticket changelog.
