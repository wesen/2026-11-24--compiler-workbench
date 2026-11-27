---
Title: 'Diary: IRWB-021-Q — deriving streaming attention by checked rewrites'
Ticket: IRWB-021-Q
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: log
Intent: short-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-021-Q--deriving-streaming-attention-by-checked-rewrites/design-doc/01-design-deriving-flashattention-from-plain-tix-by-checked-rewrites.md
      Note: The design document this diary records decisions for
ExternalSources: []
Summary: >
  Design-only ticket: derives FlashAttention from plain Tix by a four-rule checked rewrite
  sequence over a fold extension, with per-step syntactic side conditions, real-arithmetic
  lemma certificates and a sampled tolerance gate against an f64 reference; diary records the
  framework mapping and the load-bearing design decisions.
LastUpdated: 2026-11-26T22:05:00-05:00
---

# Diary: IRWB-021-Q — deriving streaming attention by checked rewrites

## Step 1: Orientation — map the question onto the framework's actual checking machinery

The ticket asks for a research design: can FlashAttention be *derived* from the plain Tix
attention program by rewrites whose per-step correctness arguments are local and mechanical?
Before designing rules in the abstract I read the framework layers the design must ride on:
the semantic-contract layer (`src/framework/contracts/`), the pattern/rewrite machinery
(`src/framework/ir/PATTERNS-AND-REWRITES.md`, `rewrites.ts`, `patterns.ts`), and the Typed
domain's concrete meaning contract (`src/typed/evaluate.ts`, `f32.ts`), which is the model any
Tix contract should follow.

### Prompt Context

**User prompt (verbatim):** "You are working in a git worktree of the IR Workbench repository
(TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V
on a reusable IR framework (`src/framework/`) in which every optimization pass is checked
against the original program. A second domain is being started on the same framework: tensor
programs written in Tix, an index-notation language specified below, to be compiled to CUDA
for an NVIDIA GB10 GPU. The Tix front end, evaluators and a meaning contract with a tolerance
relation are being built in parallel and are not in your worktree. Treat the Tix core below
and its f32 meaning as given.

Your ticket is IRWB-021-Q. Your task is a **research design**: a document, no implementation.
Create the ticket, write the design document, keep a diary, and commit.

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
FlashAttention computes the same function in one pass over blocks of j. It keeps a running
maximum, a running normalizer and a running output, rescaled whenever the maximum grows, and
never stores `s` or `e`. Its memory traffic is O(N·D) instead of O(N²). People write it by
hand.

Can a compiler **derive** it from the program above, as a sequence of rewrites each of which
is checked, and so that each step's correctness argument is local and mechanical? Design the
research that would answer this.

## What the design must settle
- **The rewrite rules.** State each one in Tix-level terms (or in an extension of Tix you
  define), with its side conditions and its exact algebraic argument over the reals. Give the
  derivation from the program above to the streaming form as a sequence of rule applications.
- **What Tix lacks.** The streaming form needs at least a reduction whose state is not a
  single number. Say precisely what construct the IR needs (for example a reduction over a
  user-supplied associative combine), its semantics, and its f32 meaning.
- **Checking.** For each rule, say how its application is checked: an exact argument, a
  tolerance check against the f64 reference, or both. Say what the f32 differences are and
  where they come from. The framework's contract has a domain (shapes, input values), an
  observation and a relation (exact or tolerance).
- **Generality.** Which other programs does the same rule set reach (for example softmax
  followed by a contraction, log-sum-exp, layernorm statistics in one pass)? Which plausible
  programs does it fail on, and why?
- **The experiment.** State a falsifiable hypothesis, the primary metric (for example measured
  GPU time and bytes moved for the derived kernel, against the unfused lowering and a
  hand-written streaming kernel, on the GB10), and what result would refute it.

## Tix, fixed core (implementations are compared on it)
[... the Tix grammar and semantics block as specified in the ticket, including the f32
meaning (fround of the double result; sum starts at 0, max at −∞, increasing lexicographic
order, rounding after each step; maximal-munch reduction bodies; inputs finite; outside the
domain a compile-time check error) and the softmax example ...]

## Constraints
- Work from the files in your worktree and this brief. Do not read other git branches, other
  worktrees, or other agents' tickets.
- Design only what the question needs; list everything else under "Later", one line each.
- Use your docmgr and diary skills. Commit on your current branch with messages starting
  `IRWB-021-Q:`. Do not push.
- Final message: the ticket and design paths, the rule set in one line per rule, the commit
  hash.
Your ticket ID is IRWB-021-Q. Name the ticket after the research question (deriving streaming
attention by checked rewrites)."

**Assistant interpretation:** Produce a design document (no code) that settles: the rewrite
rules with side conditions and real-arithmetic arguments; the Tix extension the streaming form
needs; the per-rule checking scheme (exact vs tolerance vs both, with the f32 deltas
explained); generality and failure cases; and a falsifiable GB10 experiment. Track it all in
a docmgr ticket with a diary, and commit.

**Inferred user intent:** A rigorous, self-contained research design that a later implementation
ticket could execute without re-deriving the mathematics — grounded in this framework's actual
contract/rewrite APIs, honest about what is proved, what is sampled, and what Tix cannot say.

### What I did

- Read `src/framework/contracts/README.md`, `differential.ts`, `definitions.ts`: the contract
  layer has versioned invariants, the sampled `differential()` mechanism (cases, seed,
  counterexamples, baseline/subject caching keys, worker decision), `defineTransformation`
  with requires/ensures/preserves/correspondence, and proof records with an explicit external
  verifier trust boundary.
- Read `src/framework/ir/PATTERNS-AND-REWRITES.md` (and skimmed `rewrites.ts`,
  `patterns.ts`): versioned rules with `match`/`guard`/`replace`/`preserves`, applied as one
  transaction per step, with per-step evidence — exactly the granularity "each step's
  correctness argument is local" needs.
- Read `src/typed/evaluate.ts` (`meaningKept`, `MeaningParams`) and `src/typed/f32.ts`: the
  Typed domain's contract shape (deterministic seeded cases, roots, cached keys) and the f32
  op semantics (RNE per op, `Math.fround` of the double result) that the Tix f32 meaning
  parallels.

### Why

The design must name where each check runs. Grounding it in the real APIs (differential
invariants, rewrite transactions, proof records) keeps the design implementable rather than
aspirational, and the Typed contract is the in-repo precedent for how a domain defines cases,
observation and relation.

### What worked

The framework already provides every mechanism the design needs; nothing in the framework
needs to change for the Tix domain — a finding recorded in the design's §5.

### What didn't work

No failures. One constraint honored: I did not read other tickets (IRWB-008's title is visible
in `docmgr ticket list` output, but I did not open it).

### What I learned

The framework separates *assurances* (declared / checked / transferred / proof) and its proof
records are explicitly not a theorem prover — so "exact argument" in the design must mean
audited induction dossiers attached as versioned certificates, with the sampled tolerance check
as the executable safety net. That honesty shaped the checking section.

## Step 2: The mathematical design — the load-bearing decisions

This step is the substance of the ticket: deriving the rule set, the fold extension and the
checking scheme, and deciding the places where a wrong choice would make the derivation
unsound or unmechanical.

### Prompt Context

See Step 1.

**Assistant interpretation / Inferred user intent:** As Step 1.

### What I did

Worked out the derivation by hand on paper-in-the-editor before writing the design, checking
each identity over the reals and each f32 consequence. Key decisions, in the order they
arose:

1. **Read P0 exactly as written.** Maximal munch puts `/sqrt(D)` *inside* the `d`-sum and
   `/l[i]` *inside* the `j`-sum of `o`. This matters twice: it makes R1 (scale-in) a
   per-term regrouping (not a hoist of a computed `s`), and it makes R2 (div-hoist) a
   necessary step *before* fusion — the fold cannot accumulate `o` while dividing by a
   final `l` that does not exist yet.
2. **The derivation needs only four rules** (scale-in, div-hoist, flash-fuse, tile), with a
   generic sibling (fuse-folds, f32-exact) and an optional variant (normalize-in-fold, the
   FA2 placement). I resisted adding a `max-scale` rule (pulling `c` through the max): once
   the constant is folded into `k`, the max runs on the already-scaled scores and the rule is
   dead weight; positivity would also have been a spurious side condition.
3. **The extension is `step` + `combine`, not a builtin online-softmax op.** A builtin would
   hardcode one algorithm's correctness into the IR; step+combine makes reassociation licensed
   by a *certificate on the combine* (associativity over the reals), so the tiling rule is
   justified by nothing but that lemma — and log-sum-exp, layernorm, etc. reuse the same
   construct with different combines.
4. **Parallel assignment in the step body** (all reads see the entry state) is what makes the
   step a pure `(state, element) → state` function — the precondition for even being able to
   *state* associativity. This is stated in the extension's semantics.
5. **The two exact anchors.** `m` is bit-identical through the whole derivation (max never
   rounds, and the step computes the same `s` values in the same order), and R5 (generic
   fold fusion) is bit-identical by construction. Both give cheap exact probe checks inside an
   otherwise tolerance-gated derivation — worth stating because they are the derivation's only
   f32-exact facts.
6. **The rescale-underflow benignity argument.** When the running max jumps by ≥ ~104, `α =
   exp(m − m')` underflows to 0 in f32 and the accumulated state is dropped. This is benign:
   the discarded true mass is ≤ e⁻¹⁰⁴·|state|, the f64 reference carries it at ~1e−46, and the
   atol floor absorbs it. Without this observation the design would have had to either
   constrain the domain artificially or leave an unexplained NaN path.
7. **NaN-aware tolerance relation.** Within the domain the only NaN source is total underflow
   of `l` (every exp argument < −104 in f32), where the plain form, the derived form and the
   f64 reference all produce `0/0`. The relation admits NaN∼NaN and otherwise requires
   finiteness of the reference — stated as part of the contract rather than left implicit.
8. **Step-0 gate.** The plain program's own f32-vs-f64 drift must fit the tolerance before any
   rule fires; the final `rtol` must be ≥ 4× the step-0 observed maximum. The exp-argument
   rounding costs relative error ≈ ε·|argument| (exp amplifies argument error by the
   derivative), which bounds the plain drift at ~1e−5 for the generator's score spreads — so
   `rtol = 1e-4` initial is calibrated, not guessed.
9. **Consumer side conditions on R3** are what keep the rule mechanical: the exp-argument
   identity must hold *structurally* (the exp's argument minus `m` is the same expression as
   the max's body), extents must be inferred identically, and external consumers of `e` must
   be absent (with one sanctioned epilogue escape for plain softmax's `y`).
10. **Generality/failure boundary.** The flash rule's power is exactly "the running maximum is
    carried into the accumulation"; R5 covers the uncoupled case (layernorm). Failures:
    max/sum index-domain mismatch, self-referential normalization, negative scale crossing a
    max, exact-f32 contracts (reassociation changes bits — the derivation exists only under
    tolerance), cross-row coupling. Each declined *mechanically* by a side condition, which is
    the right kind of failure.
11. **Causal masking is reachable** under the `-inf` extension — Lemma 3 extends verbatim
    (masked `s = −∞` no-ops the max and contributes `exp(−∞ − m) = 0`) — a small generality win
    worth stating because it falls out of the conventions rather than requiring a rule.

### Why

Each decision is recorded because a later implementer will hit the same forks: the
maximal-munch reading changes which rules exist; the step+combine shape determines whether
tiling needs a new lemma; the NaN and underflow conventions determine whether the tolerance
relation is well-defined on the domain's edges.

### What worked

The four-lemma structure (scale/div-distributivity; streaming-rescale induction; combine
associativity; the FA2 corollary) collapses all the real-arithmetic content into finite
inductions using only exp-additivity and distributivity — each auditable in minutes, and each
proved once per rule rather than per application.

### What didn't work

Two drafts of the rule count: an early draft had six derivation rules including `max-scale`
and a separate epilogue/projection rule; both collapsed (max-scale is unnecessary under the
fold-into-`k` placement; projection is extension syntax, not a rewrite). Recorded here so the
implementer does not re-inflate the set.

### What warrants a second pair of eyes

- Lemma 3's induction, especially the `m = −∞` base case and the claim that `α·l = 0·0 = 0`
  involves no NaN path.
- The claim that the fused step's `s_j` is bit-identical to P0's materialized `s[i,j]` (same
  expression, same op order — this rests on the extension's rule that nested reductions in
  step bodies follow the plain order/rounding).
- The tile-bound side condition (union of `[t·T, min(t·T+T, N))` covers `[0, N)` exactly) and
  the integer-exactness of `ceil(N/T)`.

### What should be done in the future

The design's §9 lists the Later items one line each; the first two are the Tix front end
adapter and the f64 reference interpreter, both parallel-work dependencies.

## Step 3: Write-up, ticket bookkeeping, commit

Wrote the design document into the ticket's `design-doc/` directory following
`ttmp/_guidelines/design-doc.md` (executive summary, problem statement, proposed solution,
design decisions, alternatives, implementation plan, open questions) with the brief's five
required settlements as its core sections (§2–§8). Created the ticket, added three tasks,
related six framework files to the ticket index, updated the ticket index overview and the
changelog, and wrote this diary.

### Prompt Context

See Step 1.

### What I did

- `docmgr ticket create-ticket --ticket IRWB-021-Q --title "Deriving streaming attention by
  checked rewrites" --topics compiler,ir,verification,research`.
- `docmgr doc add --doc-type design-doc` and wrote
  `design-doc/01-design-deriving-flashattention-from-plain-tix-by-checked-rewrites.md`.
- `docmgr doc relate` for: `src/framework/contracts/differential.ts`,
  `src/framework/contracts/definitions.ts`, `src/framework/ir/rewrites.ts`,
  `src/framework/ir/patterns.ts`, `src/framework/ir/PATTERNS-AND-REWRITES.md`,
  `src/typed/evaluate.ts`.
- `docmgr task add` ×3; `docmgr changelog update` with the design summary and the design-doc
  file note; ticket `index.md` overview written; this diary written.

### Why

docmgr conventions (subdocument-first relating, tight RelatedFiles, task/changelog
bookkeeping) per the docmgr skill; the diary in investigation mode because the design
decisions in Step 2 are the ticket's substantive content.

### What worked

All docmgr commands behaved as documented; the design doc frontmatter validated on write
(fields preserved from the template).

### What didn't work

No failures observed.

### What should be done in the future

Run `docmgr doctor --ticket IRWB-021-Q` when the ticket resumes; the implementation items of
design §9 are each their own future ticket.
