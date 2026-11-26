---
Title: Research diary
Ticket: IRWB-021-L
Status: complete
Topics: [compiler, ir, verification, research, performance]
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Decisions and validation for the streaming-attention design.
LastUpdated: 2026-11-26T12:55:21-05:00
WhatFor: Trace the contract boundary and the numerical checks behind the design.
WhenToUse: Reviewing the derivation or preparing the experiment.
---

# Research diary

## Step 1: Find the checker boundary before choosing the rules

I started from the supplied Tix meaning and the reusable framework, not a presumed Tix API. The framework can gate an individual edit and run a seeded comparison against a fixed origin. Neither a successful match nor a sampled comparison establishes a real-number identity. Those need separate evidence.

### Prompt context

**User prompt (verbatim):**

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V on a reusable IR framework (`src/framework/`) in which every optimization pass is checked against the original program. A second domain is being started on the same framework: tensor programs written in Tix, an index-notation language specified below, to be compiled to CUDA for an NVIDIA GB10 GPU. The Tix front end, evaluators and a meaning contract with a tolerance relation are being built in parallel and are not in your worktree. Treat the Tix core below and its f32 meaning as given.

Your ticket is IRWB-021-L. Your task is a **research design**: a document, no implementation. Create the ticket, write the design document, keep a diary, and commit.

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
- Use your docmgr and diary skills. Commit on your current branch with messages starting `IRWB-021-L:`. Do not push.
- Final message: the ticket and design paths, the rule set in one line per rule, the commit hash.
Your ticket ID is IRWB-021-L. Name the ticket after the research question (deriving streaming attention by checked rewrites).
````

**Interpretation:** Deliver the experiment specification and its derivation, not a Tix dialect implementation or a performance result. **Inferred intent:** A reviewer should be able to reject an illegal rewrite or a failed research hypothesis without trusting an attention-specific recognizer.

### What I did

- Created this ticket, design and diary with `docmgr` on the current branch (base `19ad269`). Inspected `define-pass.ts`, `differential.ts` and the framework's contract and directed-rewrite descriptions.
- Probed Node v24.18.0 with `Math.fround`: for three equal logits and values `[1,1,-0.25]`, sum of the three rounded quotients gives `0.5833333730697632`; divide the rounded sum once and it gives `0.5833333134651184`.

### Why

The denominator is *inside* the sum. Treating the two programs as bit-equivalent would fail even on three small finite values.

### What worked

A fixed `origin` contract input exists. `differential()` separates `baseline`, `subject`, `cases`, `run` and `compare`; the tensor observation need not be baked into the rewrite engine.

### What didn't work

The first regrouping probe `f(f(p-p)+1), f(p+f(-p+1))` with `p=f(2**24)` produced `1 1`: `-p+1` is representable. The follow-up with `[1,2**-24,-1]` gave `0` vs `5.960464477539063e-8`. Neither probe is an evaluator test.

### What I learned

A change in parentheses must appear in the candidate IR, even for a real-associative operator. Otherwise the reference checker doesn't know which f32 program it is checking.

### What was tricky to build

A tuple of ordinary sums still depends on a future maximum. Factoring out the change of exponential origin is the step that removes that dependency; packing alone just interleaves work.

### What warrants a second pair of eyes

Check the empty identity before doing arithmetic with a maximum. Check the claimed memory boundary (on-chip tiles, global allocations or measured off-chip transfers).

### What should be done in the future

See the design for the acceptance and measurement protocol; no runtime work belongs in this ticket.

### Code review instructions

Read the proposed rules alongside `src/framework/ir/PATTERNS-AND-REWRITES.md`, especially the transactional verification gate.

### Technical details

The framework tally can agree with some inconclusive cases. A study that requires *all* prescribed cases to pass needs an additional completeness check.

## Step 2: Derive the merge and set the refutation test

I wrote the derivation around two distinct edits: change a block sum to its own reference maximum, then collapse the *outer* maximum and transported sums into a fold. This leaves an inspectable intermediate where each leaf depends on one block. It also explains why removing either edit should prevent the one-pass result.

### Prompt context

See Step 1. The goal here was a research protocol that can distinguish algebraic equivalence, acceptable rounding and actual performance.

### What I did and why

- Wrote out the block invariant and its singleton, concatenation and empty cases. Chose a tagged empty state so handling an empty prefix requires no exponential of a difference of infinities.
- Specified the fold tree as data in the candidate program. Preserved the `d` score expression and made the divisor move on the output an independent edit.
- Reviewed the derivation end to end. Added the key-prefix interpretation of the state and construction of the combine from the matched scale, rather than presenting an unexplained online update. Reversing the two-key example exercises the other child's scale.

### What worked

The same weighted-sum lemma fits the normalizer alone and the packed normalizer/numerator. The hand check with scores `0,log(2)` distinguishes a missing numerator rescale without a large random test.

### What didn't work

No design-validation command failed. A blanket linear-DRAM-traffic prediction did not follow from the loop: distinct query tiles can reload the same keys and values. The experiment measures bytes for this reason.

### What I learned / what was tricky

The tile maximum needs the scores before the tile sum uses them. Holding just a bounded score tile on chip avoids both recomputing the dot products and keeping the row until its final maximum is known. It is *global materialization* that disappears, not the computation of scores.

### Second review and future work

Scrutinize R5's payload independence, R6's prefix law and the exact tree with the last partial block. Treat GB10 results and f32 study-domain coverage as open empirical questions. The design's **Later** section marks the implementation boundary.

### Review instructions and validation evidence

- Read the derivation table across R4 → R5 → R6. Compare the two-key example to the `⊗` expression before reviewing the benchmark thresholds.
- `docmgr validate frontmatter` accepted index, design and diary; `docmgr doctor --ticket IRWB-021-L --stale-after 30` reported all checks passed. A local link check found all eight Markdown file targets in the README, index and design.
- Ticket close operation `close-25f23a492347ab9807c6134ea01601fd` records completion of the design tasks only. No Tix evaluator, CUDA benchmark, build or test suite run is claimed; there are no runtime changes.
