---
Title: Research diary
Ticket: IRWB-021-C
Status: active
Topics:
    - compiler
    - verification
    - research
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T12:40:12.397505005-05:00
WhatFor: ""
WhenToUse: ""
---

# Research diary

## Step 1. Establish the observation and derive the block law

I traced the two divisions through the Tix grammar before choosing a summary. The score can keep its original d loop. Moving the output division exposes a pair of weighted sums, and changing their reference maximum supplies the missing merge law.

### Prompt context

User request, verbatim:

~~~~text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V on a reusable IR framework (`src/framework/`) in which every optimization pass is checked against the original program. A second domain is being started on the same framework: tensor programs written in Tix, an index-notation language specified below, to be compiled to CUDA for an NVIDIA GB10 GPU. The Tix front end, evaluators and a meaning contract with a tolerance relation are being built in parallel and are not in your worktree. Treat the Tix core below and its f32 meaning as given.

Your ticket is IRWB-021-C. Your task is a **research design**: a document, no implementation. Create the ticket, write the design document, keep a diary, and commit.

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
- Use your docmgr and diary skills. Commit on your current branch with messages starting `IRWB-021-C:`. Do not push.
- Final message: the ticket and design paths, the rule set in one line per rule, the commit hash.
Your ticket ID is IRWB-021-C. Name the ticket after the research question (deriving streaming attention by checked rewrites).
~~~~

I interpreted the deliverable as a reviewable derivation and experimental protocol. A future implementation should be able to reject a bad rewrite independently of GPU speed.

### What I did and why

- Probed docmgr help, created the ticket, and inspected the pass and differential invariant definitions. The existing origin port and comparator hook cover the checking workflow.
- Chose a tagged identity and fixed fold order so an evaluator can replay the exact rounding schedule. An implicit reduction tree would make two different candidates look like the same revision.
- Chose separate traffic and storage measurements because reuse across query tiles depends on the schedule and the device.

### What worked and what did not

Node v24.18.0 evaluated `Math.fround(Math.exp(-104))` to zero. Seven equal f32 terms of 1/7 happened to sum to one in the initial probe and did not distinguish division placement. The following probe produced `1.0000001192092896 1` and became the design's ten-key example.

~~~sh
node -e 'let s=0; for(let j=0;j<10;j++) s=Math.fround(s+Math.fround(1/10)); console.log(s,Math.fround(10/10))'
~~~

### What I learned and what was tricky

A partial numerator has meaning only relative to its own maximum. Carrying that maximum makes associativity a corollary of a disjoint-union equation. Reusing the equation as an f32 equality would silently admit arbitrary reassociation.

### Review and future work

Review the two source divisions, the empty identity, and the rule 4 certificate first. Follow the contract through `PassSpec`, `contractInputs` and `DifferentialSpec.compare`. The design's Later list identifies the implementation dependencies for the experiment.

## Step 2. Validate the ticket

I linked the design to the three framework files used in the checking protocol and marked the design task complete. The deliverable for the request in Step 1 is ready for review.

- `docmgr doctor --ticket IRWB-021-C` reported all checks passed.
- The numeric probe is host-side evidence only. The thresholds and device measurements in the design are proposed experimental criteria.
