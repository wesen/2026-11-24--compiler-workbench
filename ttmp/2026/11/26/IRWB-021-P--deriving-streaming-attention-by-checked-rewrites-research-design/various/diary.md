---
Title: Diary — IRWB-021-P deriving streaming attention by checked rewrites
Ticket: IRWB-021-P
Status: active
Topics:
    - compiler
    - design-doc
    - diary
DocType: diary
Intent: long-term
Owners:
    - manuel
RelatedFiles: []
ExternalSources: []
Summary: >
  Chronological diary for the IRWB-021-P research design: deriving a
  FlashAttention-style streaming kernel from the plain Tix attention program
  via checked rewrites.
LastUpdated: 2026-11-26
---

## Step 1: Ticket created, worktree oriented, rule set and derivation drafted in the design document

Research-design ticket only: no implementation. The goal was a design document
settling the five briefed questions — rewrite rules with side conditions and
real-algebra arguments, the missing Tix construct, per-rule checking tiers,
generality, and the falsifiable experiment — plus a diary and a commit.

### Prompt Context
**User prompt (verbatim):** "Your ticket is IRWB-021-P. Your task is a **research design**: a document, no implementation. Create the ticket, write the design document, keep a diary, and commit. … Can a compiler **derive** it from the program above, as a sequence of rewrites each of which is checked, and so that each step's correctness argument is local and mechanical? Design the research that would answer this." (Full brief in the ticket; five "must settle" bullets, fixed Tix core, constraints on scope and commit message prefix.)
**Assistant interpretation:** Produce a design document (no code) that defines the rewrite rule set, the Tix extension (fold with tuple state + certified combine), the derivation from the plain attention program to the streaming form, per-rule checking tiers mapped onto the existing framework contract machinery, a generality analysis, and a falsifiable GB10 experiment. Create the docmgr ticket, keep this diary, commit on `r1b-gf-h/irwb-021-p` with `IRWB-021-P:` prefix, do not push.
**Inferred user intent:** A reviewable research design that a follow-up implementation ticket could execute directly, with the mathematical obligations stated precisely enough to be checked mechanically.
**Commit (code):** (this step's commit recorded in the next entry)

### What I did
- Oriented in the worktree: `git status`/`log` (branch `r1b-gf-h/irwb-021-p`, clean at `19ad269`); confirmed the framework surface this design targets (`src/framework/contracts/README.md`, `src/framework/ir/PATTERNS-AND-REWRITES.md`) — `defineTransformation` with requires/ensures/correspondence, `defineInvariant`, `PatternPredicateRegistry`, pattern matching with recorded evidence.
- Created the ticket: `docmgr ticket create-ticket --ticket IRWB-021-P --title "Deriving streaming attention by checked rewrites: research design" --topics compiler,design-doc` → `ttmp/2026/11/26/IRWB-021-P--deriving-streaming-attention-by-checked-rewrites-research-design`.
- Authored the design document at `design/deriving-streaming-attention-by-checked-rewrites.md`: seven rules (R1 reduce→fold, R2 division hoisting, R3 producer fusion, R4 fold merge, R5 running-max rescale, R6 blocking, R7 block-body re-expression), the `fold` extension with sequential-override state semantics and certified combine families (Plus / Max / flash / log-domain flash), the 7-step derivation table, the derived program text, the checking plan (EXACT-f32 / EXACT-ℝ+TOL tiers mapped to correspondence records and a two-sided tolerance invariant), generality (softmax+contraction, log-sum-exp, layernorm statistics; refusals: final-mean variance, non-associative combines, non-multiplicative normalizer use, stencils), and the H1/H2/H3 experiment with refutation conditions.

### Why
- The two-tier exactness split (only R5 and R6 leave f32-exactness) is the central decision: it confines tolerance calibration to the two rules where reassociation is inherent, keeping the framework's "checked" guarantee bitwise wherever possible.
- The `fold` semantics deliberately mirrors the core reduce semantics verbatim (same identity, same lexicographic order, same per-step rounding) so R1 is definitional and R7 is its free inverse.
- Certified combine families instead of arbitrary user combines: mechanical associativity checking of arbitrary expressions is undecidable; a vetted family library keeps every obligation dischargeable.

### What worked
- Ticket creation and doc writing completed; the R5 canonical-form induction (exp(a−c)=exp(a−b)·exp(b−c)) covers both the per-element rescale and, at block granularity, the flash combine's associativity, so one algebraic argument serves R5 and R6.
- The `l[i] ≥ 1 > 0` discharge for R2 is exact and mechanical (max attained at some j*, term exp(0)=1, inputs finite).
- IEEE edge case for the first fold step discharged exactly (m=−∞ → g=exp(−∞)=0, 0·0 exact, no NaN pathway since s is finite).

### What didn't work
- Initial mental ordering tried merging the m-fold with the l/u-folds via a general fold-merge before the rescale rule; this is impossible because the l/u steps read m's *final* value (a true dependence). Recovery: R4 is applied to merge l and u first (independent states), and R5 is defined on the two-pass pattern (m-fold; normalized-product folds) and internalizes the m-dependence via the rescale. Recorded in the derivation table and called out explicitly.

### What learned
- R6 (blocking) typically *reduces* accumulated f32 error vs the plain program (ε·(log B + N/B) vs ε·N), which forces the tolerance relation against the plain program to be two-sided — a contract-interface requirement passed to the parallel meaning-contract work.
- The derived program's step body is mostly the original program block-localized; the only new syntax on the page is the fold wrapper and `neg_inf`.

### What was tricky to build
- Keeping the research design within the brief's scope: the experiment's H1/H2 need a CUDA lowering that does not exist in this worktree; resolved by making H3 (checker correctness/mutation suite) the backend-independent primary falsification of the research question itself, and listing the backend as a sibling dependency under Later.

### What warrants a second pair of eyes
- The R5 side-condition formulation (normalized-product form with φ = exp and Plus-family accumulators) — is it tight enough to exclude the layernorm-variance program yet admit all flash instances?
- The op-count tolerance budget β ≈ c·ε·C with C derived symbolically from the derivation: the constant calibration is flagged as an open question in the doc.
- Whether `fold`'s sequential-override step semantics is acceptable to the front-end/contract work (alternative: explicit old()/new() accessors — rejected in the doc as syntax without checkability gain).

### What should be done in the future
- Execute implementation plan steps 1–5 (fold spec promotion, transformation encoding, exact checker, TOL calibration + mutation suite, handoff to CUDA lowering ticket).

### Code review instructions
- Read `ttmp/2026/11/26/IRWB-021-P--deriving-streaming-attention-by-checked-rewrites-research-design/design/deriving-streaming-attention-by-checked-rewrites.md` end to end; check the derivation table against the rule statements and the derived program text.
- No code changes; no tests to run. `docmgr validate frontmatter` on the new docs.

### Technical details
- Ticket path: `ttmp/2026/11/26/IRWB-021-P--deriving-streaming-attention-by-checked-rewrites-research-design`.
- Framework anchors: `src/framework/contracts/definitions.ts` (defineTransformation/defineInvariant), `src/framework/ir/patterns.ts` (match/matchAll, PatternPredicateRegistry), `src/framework/ir/rewrites.ts`.
- Derivation check tiers: R1/R3/R4/R7 EXACT-f32; R2/R5/R6 EXACT-ℝ + TOL.
