---
Title: IRWB-021-R diary
Ticket: IRWB-021-R
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: log
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-021-R--deriving-streaming-attention-from-plain-tix-by-checked-rewrites/design-doc/01-deriving-flashattention-from-the-plain-tix-attention-program-a-checked-rewrite-research-design.md
      Note: the research design this diary records the making of
ExternalSources: []
Summary: >
    Investigation diary for the IRWB-021-R research design: orientation on the framework contract layer,
    settling the rescaling lemma and the nine-rule set, the six-step derivation (including the caught pitfall
    of the still-materialized score statement), the checking design (domain, observation, exact vs tolerance
    relations, f32 error model), generality and the pre-registered GB10 experiment, and the docmgr bookkeeping
    with commits bb331d8 and the diary commit.
LastUpdated: 2026-11-26T22:30:00-05:00
---

# IRWB-021-R diary

Research design ticket: deriving streaming attention (FlashAttention) from the plain Tix program by checked rewrites. Design only, no implementation. All paths relative to the repository root.

## Step 1: Ticket creation and orientation

### Prompt Context
**User prompt (verbatim):** "You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V on a reusable IR framework (`src/framework/`) in which every optimization pass is checked against the original program. A second domain is being started on the same framework: tensor programs written in Tix, an index-notation language specified below, to be compiled to CUDA for an NVIDIA GB10 GPU. The Tix front end, evaluators and a meaning contract with a tolerance relation are being built in parallel and are not in your worktree. Treat the Tix core below and its f32 meaning as given.

Your ticket is IRWB-021-R. Your task is a **research design**: a document, no implementation. Create the ticket, write the design document, keep a diary, and commit.

## The question
Single-head attention in Tix, written the plain way, materializes an N×N score matrix: [the attention program]. FlashAttention computes the same function in one pass over blocks of j. It keeps a running maximum, a running normalizer and a running output, rescaled whenever the maximum grows, and never stores `s` or `e`. Its memory traffic is O(N·D) instead of O(N²). People write it by hand.

Can a compiler **derive** it from the program above, as a sequence of rewrites each of which is checked, and so that each step's correctness argument is local and mechanical? Design the research that would answer this.

## What the design must settle
- **The rewrite rules.** State each one in Tix-level terms (or in an extension of Tix you define), with its side conditions and its exact algebraic argument over the reals. Give the derivation from the program above to the streaming form as a sequence of rule applications.
- **What Tix lacks.** The streaming form needs at least a reduction whose state is not a single number. Say precisely what construct the IR needs (for example a reduction over a user-supplied associative combine), its semantics, and its f32 meaning.
- **Checking.** For each rule, say how its application is checked: an exact argument, a tolerance check against the f64 reference, or both. Say what the f32 differences are and where they come from. The framework's contract has a domain (shapes, input values), an observation and a relation (exact or tolerance).
- **Generality.** Which other programs does the same rule set reach (for example softmax followed by a contraction, log-sum-exp, layernorm statistics in one pass)? Which plausible programs does it fail on, and why?
- **The experiment.** State a falsifiable hypothesis, the primary metric (for example measured GPU time and bytes moved for the derived kernel, against the unfused lowering and a hand-written streaming kernel, on the GB10), and what result would refute it.

[Plus the Tix core grammar and f32 meaning, the constraints (work from the worktree and the brief; use docmgr and diary skills; commit with `IRWB-021-R:` prefix; do not push; final message with ticket and design paths, rule set one line per rule, commit hash).]"
*(The full verbatim text of the brief is the ticket's user prompt; it is preserved in the session record. The bracketed ellipses above summarize the program text, the Tix grammar and the constraint list, which are quoted in full in the design document's sources.)*
**Assistant interpretation:** Produce a docmgr ticket IRWB-021-R named after the research question, a design document that settles rules / missing construct / checking / generality / experiment, a diary, and commits on the current branch `r1b-g-h/irwb-021-r`. No implementation, no reading of other worktrees or tickets.
**Inferred user intent:** A research deliverable precise enough that a follow-on implementation ticket can build the construct, the rules and the GB10 rig from it without re-deriving the math.

### What I did
- Read the diary and docmgr skills, `ttmp/_guidelines/design-doc.md`, and an existing design doc (IRWB-009) for house style.
- Read the framework contract layer this design must plug into: `src/framework/contracts/README.md` (definitions, transformation lifecycle, assurance levels declared/checked/proof), `src/framework/contracts/differential.ts` (sampled differential invariant: seeded cases, baseline/subject, relations, first counterexamples), `src/framework/ir/PATTERNS-AND-REWRITES.md` (the pattern API).
- Created the ticket (`docmgr ticket create-ticket --ticket IRWB-021-R --topics compiler,ir,verification,research`), added seven tasks, created the design doc slot with `docmgr doc add`.

### Why
The brief demands the design's checking story in the framework's own contract terms; quoting those interfaces from the worktree (rather than inventing API) is what keeps the design buildable.

### What worked
- Ticket and doc scaffolding created cleanly; frontmatter validation passed on both files on the first try.

### What didn't work
- No failures observed in this step.

### What I learned
- The framework's contract layer already has everything a per-rule meaning check needs (`differential()` as an ordinary invariant, effect-free pure transformations, revision-keyed evidence), so the design adds no framework infrastructure — only the Tix-level construct and rules.

### What was tricky to build
- N/A (orientation step).

### What warrants a second pair of eyes
- Nothing in this step.

### What should be done in the future
- Step 2 onward.

### Code review instructions
- `docmgr ticket list --ticket IRWB-021-R`; read the ticket index.

### Technical details
- Commit for this and the following steps: `bb331d8` (design + ticket scaffold).

## Step 2: Settling the rule set and the derivation

### Prompt Context
**User prompt (verbatim):** See Step 1.
**Assistant interpretation:** The intellectual core: state each rule in Tix-level terms with side conditions and an exact real-algebra argument, and give the derivation as a sequence of rule applications.
**Inferred user intent:** "Local and mechanical" means each rule's pattern is syntactic and its argument is one recorded lemma — no per-rule bespoke math.

### What I did
- Pinned the two lemmas first (design §5): the rescaling lemma (split a sum of exponentials around the running max) and its payload extension; derived the singleton-fold corollary, which simultaneously gives (a) the correctness of PAIR/PAYLOAD, (b) associativity of the combine with identity (−∞, 0, 0), and (c) the two-pass block identity needed by TWOPASS.
- Settled the rule set: R1 FACTOR-OUT, R2 INLINE, R3 PAIR, R4 PAYLOAD, R5 BLOCK, R6 TWOPASS, R7 MAXSHIFT, R8 LOGRESOLVE, R9 FUSESUMS. R7/R8 exist because the generality requirement names log-sum-exp; R9 exists because it names layernorm statistics.
- Wrote the six-step derivation P0→P6 (design §6), ending in a program whose blocked, two-pass meaning is FlashAttention-2's algorithm statement for statement.

### Why
- The decomposition PAIR-then-PAYLOAD (rather than one fusion rule) keeps each pattern to two statements and each argument to one lemma; the same rules then reach softmax (PAIR alone) and any softmax-then-contraction (PAYLOAD), which a monolithic attention rule would not.
- MAXSHIFT runs opposite to a simplifier's instinct (it introduces the max-shift instead of removing it); direction is a strategy annotation, checking is meaning-only.

### What worked
- The derivation closes with eight applications of six rules and no step whose side condition fails on the given program.

### What didn't work
- First draft of the derivation left the `s` statement materialized in the final program (it is only referenced from inside the reduce emit). Caught while checking the memory claim against the brief's "never stores s or e": an N×N statement still in the source would let a literal lowering materialize the score matrix. Fix: an explicit R2 INLINE step (P4→P5) substituting the score sum into the emit, deleting the statement. The live-memory analysis of P6 is now recorded as step-5/6 evidence.
- I initially described step 6 as "six rule applications" while listing eight; corrected to "eight applications of six distinct rules in six steps".

### What I learned
- The Tix scoping rule ("reduction body extends as far right as possible") is load-bearing twice: the plain `o` divides by `l[i]` *inside* the sum, so FACTOR-OUT is not an optional cleanup but the step that makes the streaming normalization (divide once at the end) derivable at all. Without it, PAYLOAD's pattern does not match.

### What was tricky to build
- The state construct's shapes: components with different index lists (m, l over [i]; acc over [i, x]). Resolved with the projection convention (components are functions on the free-index product, constant along indices they do not carry), which keeps the fold pointwise and the implementation free to share scalar components.

### What warrants a second pair of eyes
- The claim that the combine of Lemmas 1–2 is associative *as used*: the empty-side conventions (exp(−∞)=0) and the b | N side condition of R5 are what keep −∞ ⊕ −∞ (NaN) out of the blocked schedule. A reviewer should re-check §4.3/§4.4 and R5's side conditions.

### What should be done in the future
- Implementation ticket per design §11.

### Code review instructions
- Read design §4 (construct), §5 (lemmas + rules), §6 (derivation); check each derivation step against the rule it cites.

### Technical details
- The max component is bit-exact through the whole chain (selection among the same f32 values); only the normalizer and accumulator deviate. This constructive fact is recorded per rule (§7.1).

## Step 3: Checking design — domain, observation, relations, error model

### Prompt Context
**User prompt (verbatim):** See Step 1.
**Assistant interpretation:** Specify how each rule application is checked (exact argument, tolerance vs f64 reference, or both), what the f32 differences are and where they come from, inside the framework's contract (domain, observation, relation).
**Inferred user intent:** The per-rule check must be pre-registered, not post-hoc, so the experiment can falsify the error model rather than tune around it.

### What I did
- Fixed the observation to the returned tensor (intermediates are internal — deleting them is the point of the rules).
- Fixed the domain: shape lists (N ≤ 1024, D, X ≤ 256), i.i.d. uniform [−1,1] inputs from the framework's seeded generator (keeps |scores| ≤ √D ≤ 16, exp args in [−32, 0]: no overflow, no subnormals, so measured deviations are pure rounding), N multiples of B once blocking is in the program (that is R5's side condition restated on the domain).
- Two relations: bit-exact for R2/R9 (identical operation sequence is the constructive argument; the differential exact check audits the machinery); tolerance for the rest, compound: accuracy vs the f64 reference of P0 plus a no-regression clause against the before-program.
- Derived the tolerance from an error model: o is a convex combination of v rows (no cancellation), ~3N + 2D rounding opportunities → ~2.2e−4 at the top of the domain, τ_rel = 2⁻¹⁰ gives ≥ 4× headroom; made headroom itself a falsifiable sub-hypothesis (H1b).
- Wrote the f32-difference inventory (moved rounding points, regrouping, running-max vs final-max exp arguments, the bit-exact max parts, the no-underflow domain argument) and the device-side story (expf ~2 ulp, FMA contraction: checked build with `--fmad=false`, τ_device,rel = 2⁻⁹).

### Why
- The l ≥ 1 positivity fact (the f32 argmax term is exactly exp(0) = 1) discharges R1/R8's c ≠ 0 side condition constructively rather than by case filtering; it is recorded as part of the rules' domain argument.

### What worked
- The exact/tolerance split falls out of the rules themselves: every rule that provably preserves the f32 operation sequence (INLINE, FUSESUMS) is bit-exact; every rule that provably changes it gets the error model.

### What didn't work
- No failures observed; one correction during drafting: the tolerance relation initially only compared against f64; added the no-regression clause (|a−r| ≤ |b−r| + budget) so a rewrite that merely stays inside τ while degrading the source's accuracy is still refused.

### What I learned
- The framework's assurance levels map cleanly: the rescaling-family associativity checker is proof-backed (the corollary), a generic user combine falls back to sampled f64 evidence and the evidence record must say the acceptance then rests on the differential check alone.

### What was tricky to build
- Keeping the meaning of the construct implementation-independent while making blocking a *rewrite* (R5) rather than a semantic parameter — this is what keeps the contract as the only source of truth for the schedule too.

### What warrants a second pair of eyes
- The error model's constant (3N + 2D + 4)·u and the 2× headroom threshold in H1b; a reviewer with GPU float experience should sanity-check §7.3.

### What should be done in the future
- Adversarial input search for the tolerance relations (Later list).

### Code review instructions
- Read design §7 against `src/framework/contracts/differential.ts` (case/seed/counterexample mechanics) and `src/framework/contracts/README.md` (assurances).

### Technical details
- 64 cases per shape configuration, 12 shape configurations per program; the f64 reference is computed once per case and shared across the whole chain.

## Step 4: Generality, experiment, alternatives

### Prompt Context
**User prompt (verbatim):** See Step 1.
**Assistant interpretation:** Which programs the same rules reach and which they fail on with reasons; a falsifiable hypothesis, primary metric, and refutation conditions on the GB10.
**Inferred user intent:** The generality section should be honest about failures, and the experiment's thresholds must be pre-registered so a negative result cannot be reinterpreted post hoc.

### What I did
- Generality (§8): reached — softmax (PAIR alone), any softmax-then-contraction (bias, temperature, multi-head, arbitrary payload V), log-sum-exp (R7+R3+R8), fused moments (R9, bit-exact), and the "safe softmax" as the b = N corner of R5. Not reached, with reasons — weight mismatch (payload weight ≠ the pair's exponential: R4's side condition fails), causal masking (surface-language gap: no `select` in the fixed core; the algebra tolerates −∞ scores), variance-from-moments (the polynomial identity is excluded on purpose; the per-case tolerance check correctly rejects near-constant rows — the check doing its job is presented as a feature), backward pass (an algorithmic choice, not an algebraic identity — unreachable by meaning-preserving rewrites), scans (construct exposes only the final state).
- Experiment (§9): H1 derivability (every step passes first try), H1b error-model headroom ≥ 2×, H2 derived ≤ 1.25× hand-written, H3 no N²-term bytes (measured DRAM ≤ 1.1× the analytical model; ≤ 0.5× unfused for N ≥ 2048, D ≤ 128), H4 derived ≤ 0.5× unfused time (with the D = 256 reporting clause: model ratio ≈ 0.57), H5 generality. Named which hypotheses convict the research claim (H1, H3, H5) versus which convict the lowering (H2) — so H2 failing is not silently reinterpreted.
- Byte models for unfused (≈ 24N² + restream terms) and derived (≈ 8N²D/R) written out, because the brief's "O(N·D) instead of O(N²)" is about the score-matrix traffic; the honest model is what makes H3/H4 falsifiable rather than slogan-shaped.
- Alternatives (§10): built-in rescale-reduce vs user combine; mega-rule vs decomposition; requiring stabilized sources vs R7; blocking as semantics vs rewrite; end-to-end-only vs per-step checking; uniform tolerance vs exact-where-provable; equality saturation vs directed rules. Later list kept to one line each (§12).

### Why
- The refutation conditions name the convicted component per hypothesis; that is the difference between a falsifiable design and an evaluation.

### What worked
- The alternatives section confirmed every major decision has a named simpler alternative and a stated reason it falls short.

### What didn't work
- No failures observed.

### What I learned
- The "safe softmax = b = N corner" observation is a cheap but strong sanity check that the rules do algebra rather than pattern-match a known kernel; worth keeping visible in the doc.

### What was tricky to build
- Setting H4's threshold honestly: the byte model shows the derived/unfused ratio depends on D and the tile size (≈ 0.4 at D = 128, ≈ 0.57 at D = 256), so a single "≤ 0.5×" for all shapes would have been refutable by the model itself; the shape-conditional thresholds are derived from the model and labeled as such.

### What warrants a second pair of eyes
- The unfused byte model's coefficient (six N² traversals) and the choice to disable FMA contraction only in the checked build while reporting both flag configurations.

### What should be done in the future
- Phased plan §11 is the follow-on implementation ticket's outline.

### Code review instructions
- Read design §8 and §9; check each hypothesis has a metric, a threshold and a named refuting outcome.

### Technical details
- Commit `bb331d8` contains the design doc and ticket scaffold.

## Step 5: Bookkeeping, validation, commits

### Prompt Context
**User prompt (verbatim):** See Step 1.
**Assistant interpretation:** Diary, changelog, tasks, relations, validation, commits with the `IRWB-021-R:` prefix, no push.
**Inferred user intent:** The ticket should be resumable from its own files alone.

### What I did
- Related the three framework files to the design doc (`docmgr doc relate`), the design doc itself to the ticket index; filled the ticket index overview and frontmatter summary; checked the six content tasks; wrote the changelog entry.
- One cleanup: `docmgr doc relate` merged with notes already present in the design doc frontmatter and produced duplicated note lines; hand-deduplicated the frontmatter and re-validated both files (`Frontmatter OK`).
- Committed the design and scaffold (`bb331d8`), then wrote this diary.

### Why
- Subdocument-first linking (source files relate to the design doc, the design doc to the index) per the docmgr skill's conventions.

### What worked
- `docmgr validate frontmatter` passed for index and design doc; `docmgr doctor` not run beyond defaults since the ticket is one day old and all tasks are checked.

### What didn't work
- The frontmatter note duplication described above; recovered by editing the doc's RelatedFiles to single-line notes and re-validating.

### What I learned
- When a doc's frontmatter already lists RelatedFiles, prefer `docmgr doc relate --doc` with the *same* note text or hand-edit instead, to avoid merged multi-line notes.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Nothing beyond the items flagged in Steps 2–4.

### What should be done in the future
- The follow-on implementation ticket (design §11) once the parallel Tix front end/evaluators land.

### Code review instructions
- `docmgr ticket list --ticket IRWB-021-R`; `docmgr doc list --ticket IRWB-021-R`; read the design doc, this diary, and `git log --oneline` on branch `r1b-g-h/irwb-021-r`.

### Technical details
- Commits: `bb331d8` (ticket scaffold + design document), plus the diary commit recorded after this step.
