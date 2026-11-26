---
Title: Research diary
Ticket: IRWB-021-D
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-021-D--deriving-streaming-attention-by-checked-rewrites/design-doc/01-deriving-streaming-attention-by-checked-rewrites.md
      Note: Research decisions and proposed experiment
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T12:40:09.97074151-05:00
WhatFor: ""
WhenToUse: ""
---

# Research diary

## Step 1 — Establish the contract and derive the streaming fold

I traced the framework's existing original-program gate and used it to separate two obligations. Each application checks its algebraic premises locally, then compares the resulting program against the pinned f64 evaluation. The source's reduction scope makes factoring the normalizer an explicit numeric change.

### Prompt context

User prompt, verbatim

~~~~text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V on a reusable IR framework (`src/framework/`) in which every optimization pass is checked against the original program. A second domain is being started on the same framework: tensor programs written in Tix, an index-notation language specified below, to be compiled to CUDA for an NVIDIA GB10 GPU. The Tix front end, evaluators and a meaning contract with a tolerance relation are being built in parallel and are not in your worktree. Treat the Tix core below and its f32 meaning as given.

Your ticket is IRWB-021-D. Your task is a **research design**: a document, no implementation. Create the ticket, write the design document, keep a diary, and commit.

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
- Use your docmgr and diary skills. Commit on your current branch with messages starting `IRWB-021-D:`. Do not push.
- Final message: the ticket and design paths, the rule set in one line per rule, the commit hash.
Your ticket ID is IRWB-021-D. Name the ticket after the research question (deriving streaming attention by checked rewrites).
~~~~

I interpreted the request as a design deliverable and a protocol for a later experiment. The question is whether an ordinary source expression can produce a fast streaming kernel through inspectable steps.

### What I did and why

- Created the ticket and its design and diary with docmgr on branch `r1-sm/irwb-021-d` from `19ad269`.
- Read `differential.ts`, `define-pass.ts` and the Typed optimization contract. The existing pass ports let the proposed checks see the preceding revision and the pinned original at the same time.
- Made the reduction order part of the new fold IR and wrote its real invariant over summarized positions. This exposes the legality of regrouping independently of any CUDA schedule.
- Chose a bounded dense domain so the initial experiment can attribute divergences to rounding and tiling while still exercising underflow and cancellation.

### What worked

- `node --version` reported `v24.18.0`. A temporary invocation of `node --disable-warning=ExperimentalWarning --experimental-transform-types --input-type=module` used a resolution hook for relative `.js` imports to load the checked-in TypeScript without build artifacts. The actual `differential()` and `AnalysisManager.checkInvariant` accepted 1.125 and rejected 1.5 against 1 with an absolute bound of 0.25.
- An inline `node --input-type=module` probe using `Math.fround` found different f32 sums for `[1, 2**-24, 2**-24]` when grouped left to right versus adding the two small terms first.
- A second inline f32 probe swept the last value of `[1, 1, f32(k/100)]`; `k=9` showed that factoring the divisor 3 changes the result from 0.6966667175292969 to 0.6966666579246521.

### What did not work

An initial fixed example with `[1,1,f32(0.01)]` produced equal rounded results and threw `Error: expected different results` in the inline Node probe. The sweep above supplied a reproducible distinguishing input. The CUDA experiment remains unrun because the referenced domain and backend are future work.

### What I learned

The source score division and output division both occur inside their respective reductions. The plan only factors the output denominator. The old weighted terms can be replaced locally because the same shift appears in both contractions. The liveness check is what makes the final change remove square allocations.

### What was tricky to specify

The exact summary operator is associative over disjoint sets of positions. In f32 the block summary uses a different sequence of elementary operations, so block regrouping has its own acceptance step. Keeping the empty state tagged gives a defined identity without subtracting infinite sentinels.

### What warrants review

Walk through the normalizer's binding in Rule 1, the exact score binding in Rule 3, and the last partial tile in Rule 4. Check that the GPU comparison measures all unfused launches and that repeated K/V loads are included in the measured byte count.

### Future work and review instructions

Start with the [design](../design-doc/01-deriving-streaming-attention-by-checked-rewrites.md). The practical follow-ups are listed under Later there. The performance thresholds and tolerance are design choices for the experiment, with no measured result claimed.

### Technical details

The proposal uses a componentwise exact argument for zipping and a substitution argument for sinking. All candidates also go through the original f64 comparator. The two invariants answer different questions about the same candidate revision.

## Step 2 — Validate the ticket

The completed design includes the final tiled row program, the checks for each of the five edits, and the criteria that would refute the proposed correctness or performance result.

### Evidence

- `docmgr task check --ticket IRWB-021-D --id wltr,1gdz` completed both documentation tasks.
- `docmgr ticket close --ticket IRWB-021-D` recorded the ticket as complete.
- `docmgr doctor --ticket IRWB-021-D --stale-after 30 --fail-on warning` passed after closure.

The prompt and research scope are in Step 1. The GB10 measurements are the proposed experiment.
