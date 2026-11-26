---
Title: Diary
Ticket: IRWB-021-H
Status: active
Topics: [compiler, ir, verification, research]
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Design decisions and validation evidence for IRWB-021-H.
LastUpdated: 2026-11-26T12:47:51.833261117-05:00
WhatFor: Preserve the brief, decisions and review evidence.
WhenToUse: Resume or review the research design.
---

# Diary

## Step 1: Derive the summary and identify where to check it

I created the docmgr workspace and used the brief as the source for Tix semantics. I read the Workbench's rewrite and contract interfaces to identify which checks can run at the existing acceptance hook and which require Tix-specific logic.

### Prompt Context

**User prompt (verbatim):**

~~~~text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V on a reusable IR framework (`src/framework/`) in which every optimization pass is checked against the original program. A second domain is being started on the same framework: tensor programs written in Tix, an index-notation language specified below, to be compiled to CUDA for an NVIDIA GB10 GPU. The Tix front end, evaluators and a meaning contract with a tolerance relation are being built in parallel and are not in your worktree. Treat the Tix core below and its f32 meaning as given.

Your ticket is IRWB-021-H. Your task is a **research design**: a document, no implementation. Create the ticket, write the design document, keep a diary, and commit.

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
- Use your docmgr and diary skills. Commit on your current branch with messages starting `IRWB-021-H:`. Do not push.
- Final message: the ticket and design paths, the rule set in one line per rule, the commit hash.
Your ticket ID is IRWB-021-H. Name the ticket after the research question (deriving streaming attention by checked rewrites).
~~~~

**Assistant interpretation:** Specify a research test, not a CUDA pass or a performance result.

**Inferred user intent:** Separate the compiler's actual derivation and checking from the hand-written kernel used as a comparator.

### What I did

- Created the ticket, design and diary with docmgr. Related the design to `PATTERNS-AND-REWRITES.md`, the contracts README and `differential.ts`.
- Worked from the identity for a single shifted exponential contribution to the summary of two disjoint sets, then used that identity twice: to partition and to replace inner merges by local fixed-shift sums.
- Set the numerical contract and GB10 performance gates before any benchmark runs.

### Why

- An ordered tuple fold plus a guarded empty tag gives executable semantics without claiming f32 associativity. An attention intrinsic would only recognize and dispatch, not derive.
- Checking only adjacent f32 results could accumulate drift. Checking each candidate against the original f64 evaluation keeps a fixed target.

### What worked

- The existing rewrite hook and `defineInvariant` can carry the proposed checks; `differential.ts` exposes the original/candidate evaluation and comparison seam. The Tix-specific exact checker is still a proposal.
- A Node 24 `Math.fround` probe with the summands `[1,1,1]` and divisor `fround(sqrt(3))` produced `1.7320507764816284` for ordered sum of rounded quotients and `1.732050895690918` for rounded quotient of the ordered sum. This checks the R1 rounding distinction only, not the derivation or tolerance budget.

### What didn't work

- The first rounding probe with `[0.1,0.1,0.7]` returned `changed: false`; the two orders happened to round to `0.5196152329444885`. Retried with `[1,1,1]` to get a distinguishing case. This was not a compiler test.

### What I learned

- The given reduction grammar puts both divisions inside their sums. The first two rule applications are therefore not f32-preserving canonicalization.
- Removing the quadratic score/weight allocation does not itself imply linear DRAM traffic: K/V tiles may be loaded again for a different query tile.

### What was tricky to build

- Keeping reassociation distinct from memory placement: R4 only groups the fold, R5 changes the tile arithmetic, and R6 changes storage lifetime without changing arithmetic.

### What warrants a second pair of eyes

- Confirm R3 matches the exact same score and reduction domain under the max and exponential, and that R6 prevents escaping uses or repeated per-lane score evaluation.
- Confirm the f64 oracle retains the two original inside-sum divisions and checks the final observed tensor under the same budget at every revision.

### What should be done in the future

- Follow the design's Later list. No Tix implementation, full test suite, or GPU benchmark is part of this change; `nvcc` and `nvidia-smi` were not on PATH in this worktree session.

### Code review instructions

- Read the [design](../design-doc/01-deriving-streaming-attention-by-checked-rewrites.md) in trace order, checking each proof against the preceding program and the numeric check classification.
- Run `docmgr doctor --ticket IRWB-021-H --stale-after 30` and `git diff --cached --check` before commit.

### Technical details

- The candidate and immediate predecessor are needed for exact edit validation; the original and candidate are needed for differential validation. Those are separate relations with separate evidence.

## Step 2: Validate the documentation and stage the ticket

I reviewed the design in trace order and checked the documentation workspace before staging. This checkpoint validates the docs, not the proposed compiler or its performance.

### Prompt Context

**User prompt (verbatim):** See Step 1.

**Assistant interpretation:** Validate and commit the design-only deliverables.

**Inferred user intent:** Leave a reviewable, self-contained ticket on the current branch.

### Evidence and commits

- `docmgr doctor --ticket IRWB-021-H --stale-after 30` reported all checks passed.
- The `docmgr milestone record` dry run showed only task and changelog projections. The applied [receipt](../.docmgr-operations/design-reviewed.json) records completion of `anjm` and `5vzx`.
- `git diff --cached --check` passed on the staged ticket directory.

### Noteworthy decisions or failures

- No benchmark was run; the GB10 thresholds remain hypotheses.

### Remaining requirements and next action

- Review the design before scheduling implementation.
