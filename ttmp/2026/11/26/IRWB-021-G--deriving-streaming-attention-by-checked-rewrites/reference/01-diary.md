---
Title: Diary
Ticket: IRWB-021-G
Status: review
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Prompt, design decisions, and validation notes for the streaming attention research ticket.
LastUpdated: 2026-11-26T12:47:51.873067566-05:00
WhatFor: Preserve the work history and evidence for IRWB-021-G.
WhenToUse: When reviewing or resuming this research design.
---

# Diary

## Step 1: Design and review the checked derivation

I traced the two reductions that use the stabilized exponential weights back to their common row maximum. The merge identity for maximum-relative sums gives a local proof for the streaming state; exposing that state as a structured fold lets the proof and the CUDA schedule be reviewed separately.

I checked the existing contract hooks on the current worktree and kept the scope to the research document. No source, test suite, or CUDA benchmark was added.

### Prompt context

**User prompt (verbatim):**

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V on a reusable IR framework (`src/framework/`) in which every optimization pass is checked against the original program. A second domain is being started on the same framework: tensor programs written in Tix, an index-notation language specified below, to be compiled to CUDA for an NVIDIA GB10 GPU. The Tix front end, evaluators and a meaning contract with a tolerance relation are being built in parallel and are not in your worktree. Treat the Tix core below and its f32 meaning as given.

Your ticket is IRWB-021-G. Your task is a **research design**: a document, no implementation. Create the ticket, write the design document, keep a diary, and commit.

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
FlashAttention computes the same function in one pass over blocks of j. It keeps a running maximum, a running normalizer and a running output, rescaled whenever the maximum grows, and never stores `s` or `e`. Its memory traffic is O(N·D) instead of O(N²). People write it by hand.

Can a compiler **derive** it from the program above, as a sequence of rewrites each of which is checked, and so that each step's correctness argument is local and mechanical? Design the research that would answer this.

## What the design must settle
- **The rewrite rules.** State each one in Tix-level terms (or in an extension of Tix you define), with its side conditions and its exact algebraic argument over the reals. Give the derivation from the program above to the streaming form as a sequence of rule applications.
- **What Tix lacks.** The streaming form needs at least a reduction whose state is not a single number. Say precisely what construct the IR needs (for example a reduction over a user-supplied associative combine), its semantics, and its f32 meaning.
- **Checking.** For each rule, say how its application is checked: an exact argument, a tolerance check against the f64 reference, or both. Say what the f32 differences are and where they come from. The framework's contract has a domain (shapes, input values), an observation and a relation (exact or tolerance).
- **Generality.** Which other programs does the same rule set reach (for example softmax followed by a contraction, log-sum-exp, layernorm statistics in one pass)? Which plausible programs does it fail on, and why?
- **The experiment.** State a falsifiable hypothesis, the primary metric (for example measured GPU time and bytes moved for the derived kernel, against the unfused lowering and a hand-written streaming kernel, on the GB10), and what result would refute it.

## Tix, fixed core (implementations are compared on it)
```
program := fn+
fn      := 'fn' NAME '(' param (',' param)* ')' ':' type '{' stmt* 'return' NAME ';' '}'
param   := NAME ':' type
type    := 'f32' '[' dim (',' dim)* ']'        dim := affine expression of shape names and integers (N, D, H - 2)
stmt    := NAME '[' NAME (',' NAME)* ']' (':' type)? '=' expr ';'
expr    := expr ('+' | '-' | '*' | '/') expr | '-' expr | NUMBER | SHAPENAME | ref | call | reduce | '(' expr ')'
ref     := NAME '[' aff (',' aff)* ']'           aff := affine expression of index names and integers (y + dy)
call    := ('exp' | 'log' | 'sqrt' | 'tanh') '(' expr ')' | ('max' | 'min') '(' expr ',' expr ')'
reduce  := ('sum' | 'max') '(' NAME (',' NAME)* ')' expr
```
- Line comments are `//`. Precedence is the usual one: unary minus, then `*` and `/`, then `+` and `-`, all left-associative.
- A reduction's body extends as far right as possible, to the end of the enclosing parentheses or statement. So `sum(d) x[i, d] / D` sums `x[i, d] / D`, and `(sum(d) x[i, d]) / D` divides the sum.
- Each statement defines a new tensor, assigned once. Its left-hand index names range over extents inferred from their plain (non-affine) uses on the right. An index used only in affine positions takes its extent from the statement's declared type, which is then required.
- Reduction indices are bound by their reduction and range over extents inferred the same way. A shape name such as `D` used in an expression denotes its value as a number. A function's shape names are bound by its inputs' shapes when it is called.
- **f32 meaning:**
  - every literal, shape value, operation and function result is rounded to f32 (`Math.fround` of the JavaScript double result);
  - `sum` starts at 0 and `max` at −∞, and both accumulate in increasing lexicographic order of their indices, the first listed outermost, rounding after each step.
  - Inputs are finite. Behaviour outside the valid domain (inconsistent shapes, an extent that cannot be inferred) is a check error at compile time.

Example:
```
fn softmax(x: f32[N, C]): f32[N, C] {
  m[i] = max(j) x[i, j];
  e[i, j] = exp(x[i, j] - m[i]);
  s[i] = sum(j) e[i, j];
  y[i, j] = e[i, j] / s[i];
  return y;
}
```

## Constraints
- Work from the files in your worktree and this brief. Do not read other git branches, other worktrees, or other agents' tickets.
- Design only what the question needs; list everything else under "Later", one line each.
- Use your docmgr and diary skills. Commit on your current branch with messages starting `IRWB-021-G:`. Do not push.
- Final message: the ticket and design paths, the rule set in one line per rule, the commit hash.
Your ticket ID is IRWB-021-G. Name the ticket after the research question (deriving streaming attention by checked rewrites).
````

**Assistant interpretation:** Specify a reproducible research test of automatic derivation and checked GPU lowering, not a Tix implementation.

**Inferred user intent:** See whether local, reusable rewrite rules rather than an attention-specific replacement can yield the hand-written streaming algorithm, and set criteria that could disprove the performance claim.

### What I did

- Created the ticket, design and diary with `docmgr ticket create-ticket` and `docmgr doc add`; related the three framework files used for the design with `docmgr doc relate`.
- Read `src/framework/contracts/README.md`, `src/framework/contracts/differential.ts` and `src/framework/passes/define-pass.ts` on starting revision `19ad269`. Used their existing gating and evidence vocabulary for the proposed checker.
- Wrote the five-rule chain, tile state semantics, numerical acceptance gate, generality limits and the GB10 comparison in the [design](../design-doc/01-deriving-streaming-attention-by-checked-rewrites.md).

### Why

A two-sweep tiled lowering can already avoid full-sized buffers, but does not derive one pass over the keys. A tagged reduction state avoids treating negative infinity as an ordinary score. The bounded vector state and explicitly ordered schedule separate exact-real reasoning from any claim about rounded operations.

### What worked

- Node `v24.18.0`: an inline `node --input-type=module` probe, using a resolution hook for this checkout's `.js` specifiers pointing at `.ts` sources, ran `runDifferential(differentialSpec(inv), {origin: 0, candidate: …})`. With one deliberately inconclusive case, `0.001` agreed, `0.01` disagreed at a threshold of `0.002`, confirming both custom comparison and the need for a stricter mandatory-case gate. This was a scalar framework probe, not Tix validation.
- `docmgr milestone record --ticket IRWB-021-G --operation-id research-design-reviewed --summary 'Wrote and reviewed the checked streaming-attention research design; no compiler or CUDA implementation' --phase validate --task-id 2jpu --next 'Review the design before starting the future Tix/CUDA experiment' --dry-run` resolved the expected task and changelog projections. The real command committed both projections; `docmgr doctor --ticket IRWB-021-G --stale-after 30` reported all checks passed.

### What didn't work

- The first inline probe called `runDifferential(inv, {origin: 0, candidate: 0.001})` directly. It exited 1 with `TypeError: spec.cases is not a function` at `src/framework/contracts/differential.ts:172:46`. It had passed the invariant wrapper rather than the spec. Unwrapping with `differentialSpec(inv)` fixed the probe; no framework edit was needed.
- An attempted exact-text edit of the generated index failed twice with `Could not find edits[3]` (template cleanup hunk). No partial edit was observed; replaced the whole generated index with the ticket's overview and links. A draft edit of the design also rejected an extraneous `The scale` hunk (`Could not find edits[1]`); retrying only the intended paragraph edit succeeded.
- `command -v nvidia-smi`, `command -v ncu`, and `command -v nvcc` found none on PATH. CUDA validation, timings and byte counts are deferred by the design-only scope, not claimed as results.

### What I learned

Tix's reduction grammar puts both source divisions inside their respective sums; only moving the normalization division is part of this derivation. The unmaterialized score/weight matrices reduce footprint but do not guarantee linear total DRAM traffic: separate CTAs may reload the same keys and values.

### What was tricky to build

Keep the proof and rounding stories distinct across R2–R4. A singleton left fold, a fold of tile folds, and an expanded tile summary all compute the same real summary but need separate acceptance checks against the same source reference. R5 differs: the intended substitution leaves all rounding and order unchanged.

### What warrants a second pair of eyes

Review the match constraints for R2 and the absence of live score/weight consumers for R5. Check the proposed experiment's input bounds, threshold choices, and ability to measure device bytes on GB10 before running it.

### What should be done in the future

See the design's **Later** list. The proposed tolerance relation and all hardware targets remain unmeasured.

### Code review instructions

Start with the [design](../design-doc/01-deriving-streaming-attention-by-checked-rewrites.md), then examine the related contract and pass files. `docmgr doctor --ticket IRWB-021-G --stale-after 30` checks ticket metadata; `git diff --cached --check` checks the staged documentation diff. Full compiler build/tests are not required for this document-only change.

### Technical details

The reference uses the untouched source AST, with inputs widened from f32 bits. The exact local proof is over reals; rounding differences are checked empirically on every accepted revision, not inferred from real associativity or from adjacent f32 comparisons.
