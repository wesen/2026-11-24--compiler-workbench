---
Title: Diary
Ticket: IRWB-021-B
Status: complete
Topics:
    - compiler
    - ir
    - verification
    - research
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Worktree inspection, design decisions and arithmetic evidence for the attention derivation.
LastUpdated: 2026-11-26T12:44:58.453529913-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1. Establish the rewrite and checking boundaries

I checked the framework in this worktree for a way to compare each candidate against both its predecessor and the original program. I used the Tix grammar in the request to pin down the two divisions before doing any algebra.

The main design choice was to derive a centered summary on singleton keys first, then use its real associativity to introduce blocks. That gives the change from whole-row centering, the change in grouping, and the change to a block-local calculation separate checks.

### Prompt context

The user requested a research design they could implement and refute, with a ticket, a diary, and a local commit. Their request follows verbatim.

~~~~text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V on a reusable IR framework (`src/framework/`) in which every optimization pass is checked against the original program. A second domain is being started on the same framework: tensor programs written in Tix, an index-notation language specified below, to be compiled to CUDA for an NVIDIA GB10 GPU. The Tix front end, evaluators and a meaning contract with a tolerance relation are being built in parallel and are not in your worktree. Treat the Tix core below and its f32 meaning as given.

Your ticket is IRWB-021-B. Your task is a **research design**: a document, no implementation. Create the ticket, write the design document, keep a diary, and commit.

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
- Use your docmgr and diary skills. Commit on your current branch with messages starting `IRWB-021-B:`. Do not push.
- Final message: the ticket and design paths, the rule set in one line per rule, the commit hash.
Your ticket ID is IRWB-021-B. Name the ticket after the research question (deriving streaming attention by checked rewrites).
~~~~

### What I did and why

- Created IRWB-021-B with `docmgr ticket create-ticket` and added the design and diary with `docmgr doc add`.
- Read `src/framework/passes/define-pass.ts`, `src/framework/contracts/differential.ts`, and `src/typed/passes.ts` at worktree revision `19ad269`. A domain invariant can check the edit against the predecessor and another can check the candidate against a fixed origin. The existing comparator hook can express the proposed tolerance without a framework API change.
- Chose small typed templates for componentwise addition and the centered summary. The proof is local to the combine and segment partition. A special attention op would eliminate the compiler derivation the experiment needs to test.
- Separated the bounded attention test domain and frozen tolerances from the broader real proofs. The Tix meaning applies at each intermediate revision, while the GPU check covers differences introduced during target lowering.

### What worked and what failed

- Node `v24.18.0` confirmed that `Math.fround` distinguishes a left-fold result of 0 from a regrouped result of 1 for the values `[1e8, 1, -1e8]`. `Object.is(0, -0)` returned false, and `Math.fround(Math.exp(-105))` returned 0.
- A second Node probe used a tied-score row with `l = 3` and payloads `[1, 0.5, -0.5]`. A rounded per-term division produced `0.3333333134651184`, and one rounded division at the end produced `0.3333333432674408`. On tied scores with payloads `[1, -1, 2**-25]`, the singleton fold produced `2.9802322387695312e-8`, while grouping the final two terms first produced 0. These are arithmetic probes within the attention value domain.
- A Node probe for the proposed missing-rescale negative control produced `0.8124083876609802` with rescaling and `0.9696969985961914` without it, compared with the f64 value `0.812408398912325`. The fixture distinguishes the mutant under the proposed budget.
- One exploratory `rg ... src/compiler ...` invocation reported `rg: src/compiler: No such file or directory (os error 2)`. I located the concrete pass contract in `src/typed/passes.ts` using tracked worktree paths.

### What was tricky

- Tix puts both written divisions inside their reductions. Only the output divisor needs to move. The score expression, including its ascending `d` accumulation, remains the same in every template.
- The summary has a tagged empty case so no evaluation computes `-∞ - -∞`. Tied scores still allow nonassociative f32 sums when the maximum never changes.
- Removing the square buffers makes auxiliary global allocation linear in the input/output size or smaller, but query blocks can reread key/value tiles. The experiment measures traffic independently.

### Review and next evidence

Read the [research design](../design-doc/01-research-design-for-deriving-streaming-attention.md), starting with the proof for merging canonical summaries. Trace R1 and R4 against the two f32 counterexamples, then check the benchmark's threshold and fixed reference policy. The arithmetic probes verify specific rounding behavior. The Tix evaluators and CUDA lowering are prerequisites for running the full experiment, and the design lists that work under Later.

## Step 2. Validate the design package

I checked the ticket metadata and links, then closed the design tasks. The package contains the design and its evidence. The GPU measurements remain part of the proposed experiment.

### Evidence

- `docmgr doctor --ticket IRWB-021-B --fail-on warning` reported all checks passed.
- A Markdown check confirmed the six rule entries, the required contract and experiment sections, valid relative links, and clean whitespace.
- The worktree changes are scoped to IRWB-021-B.
- Sandboxed `git add -- <ticket-path>` returned `fatal: Unable to create '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/worktrees/r1-sh-irwb-021-b/index.lock': Read-only file system`. Staging needs write access to the linked worktree’s Git index.
