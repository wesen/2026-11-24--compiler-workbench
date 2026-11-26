---
Title: Research diary
Ticket: IRWB-021-A
Status: complete
Topics:
    - compiler
    - ir
    - verification
    - performance
    - research
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Evidence and decisions behind the checked-rewrite design."
LastUpdated: 2026-11-26T12:40:18.5554827-05:00
WhatFor: ""
WhenToUse: ""
---

# Research diary

## Step 1. Establish the contract boundary

The request joins two questions that can have different answers. A local equality over the reals can authorize a candidate expression. A sampled numerical contract then decides whether that candidate is acceptable for Tix. I inspected the existing edit and differential-check paths and tested the distinction on the source's final reduction.

### Prompt context

User request, verbatim.

> You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V on a reusable IR framework (`src/framework/`) in which every optimization pass is checked against the original program. A second domain is being started on the same framework: tensor programs written in Tix, an index-notation language specified below, to be compiled to CUDA for an NVIDIA GB10 GPU. The Tix front end, evaluators and a meaning contract with a tolerance relation are being built in parallel and are not in your worktree. Treat the Tix core below and its f32 meaning as given.
>
> Your ticket is IRWB-021-A. Your task is a **research design**: a document, no implementation. Create the ticket, write the design document, keep a diary, and commit.
>
> ## The question
> Single-head attention in Tix, written the plain way, materializes an N×N score matrix:
> ```
> fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
>   s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
>   m[i] = max(j) s[i, j];
>   e[i, j] = exp(s[i, j] - m[i]);
>   l[i] = sum(j) e[i, j];
>   o[i, x] = sum(j) e[i, j] * v[j, x] / l[i];
>   return o;
> }
> ```
> FlashAttention computes the same function in one pass over blocks of j. It keeps a running maximum, a running normalizer and a running output, rescaled whenever the maximum grows, and never stores `s` or `e`. Its memory traffic is O(N·D) instead of O(N²). People write it by hand.
>
> Can a compiler **derive** it from the program above, as a sequence of rewrites each of which is checked, and so that each step's correctness argument is local and mechanical? Design the research that would answer this.
>
> ## What the design must settle
> - **The rewrite rules.** State each one in Tix-level terms (or in an extension of Tix you define), with its side conditions and its exact algebraic argument over the reals. Give the derivation from the program above to the streaming form as a sequence of rule applications.
> - **What Tix lacks.** The streaming form needs at least a reduction whose state is not a single number. Say precisely what construct the IR needs (for example a reduction over a user-supplied associative combine), its semantics, and its f32 meaning.
> - **Checking.** For each rule, say how its application is checked: an exact argument, a tolerance check against the f64 reference, or both. Say what the f32 differences are and where they come from. The framework's contract has a domain (shapes, input values), an observation and a relation (exact or tolerance).
> - **Generality.** Which other programs does the same rule set reach (for example softmax followed by a contraction, log-sum-exp, layernorm statistics in one pass)? Which plausible programs does it fail on, and why?
> - **The experiment.** State a falsifiable hypothesis, the primary metric (for example measured GPU time and bytes moved for the derived kernel, against the unfused lowering and a hand-written streaming kernel, on the GB10), and what result would refute it.
>
> ## Tix, fixed core (implementations are compared on it)
> ```
> program := fn+
> fn      := 'fn' NAME '(' param (',' param)* ')' ':' type '{' stmt* 'return' NAME ';' '}'
> param   := NAME ':' type
> type    := 'f32' '[' dim (',' dim)* ']'        dim := affine expression of shape names and integers (N, D, H - 2)
> stmt    := NAME '[' NAME (',' NAME)* ']' (':' type)? '=' expr ';'
> expr    := expr ('+' | '-' | '*' | '/') expr | '-' expr | NUMBER | SHAPENAME | ref | call | reduce | '(' expr ')'
> ref     := NAME '[' aff (',' aff)* ']'           aff := affine expression of index names and integers (y + dy)
> call    := ('exp' | 'log' | 'sqrt' | 'tanh') '(' expr ')' | ('max' | 'min') '(' expr ',' expr ')'
> reduce  := ('sum' | 'max') '(' NAME (',' NAME)* ')' expr
> ```
> - Line comments are `//`. Precedence is the usual one: unary minus, then `*` and `/`, then `+` and `-`, all left-associative.
> - A reduction's body extends as far right as possible, to the end of the enclosing parentheses or statement. So `sum(d) x[i, d] / D` sums `x[i, d] / D`, and `(sum(d) x[i, d]) / D` divides the sum.
> - Each statement defines a new tensor, assigned once. Its left-hand index names range over extents inferred from their plain (non-affine) uses on the right. An index used only in affine positions takes its extent from the statement's declared type, which is then required.
> - Reduction indices are bound by their reduction and range over extents inferred the same way. A shape name such as `D` used in an expression denotes its value as a number. A function's shape names are bound by its inputs' shapes when it is called.
> - **f32 meaning:**
>   - every literal, shape value, operation and function result is rounded to f32 (`Math.fround` of the JavaScript double result);
>   - `sum` starts at 0 and `max` at −∞, and both accumulate in increasing lexicographic order of their indices, the first listed outermost, rounding after each step.
>   - Inputs are finite. Behaviour outside the valid domain (inconsistent shapes, an extent that cannot be inferred) is a check error at compile time.
>
> Example:
> ```
> fn softmax(x: f32[N, C]): f32[N, C] {
>   m[i] = max(j) x[i, j];
>   e[i, j] = exp(x[i, j] - m[i]);
>   s[i] = sum(j) e[i, j];
>   y[i, j] = e[i, j] / s[i];
>   return y;
> }
> ```
>
>
> ## Constraints
> - Work from the files in your worktree and this brief. Do not read other git branches, other worktrees, or other agents' tickets.
> - Design only what the question needs; list everything else under "Later", one line each.
> - Use your docmgr and diary skills. Commit on your current branch with messages starting `IRWB-021-A:`. Do not push.
> - Final message: the ticket and design paths, the rule set in one line per rule, the commit hash.
> Your ticket ID is IRWB-021-A. Name the ticket after the research question (deriving streaming attention by checked rewrites).

I interpreted the deliverable as a reviewable derivation and an experiment someone can run when the Tix pieces arrive. The worktree supplies the framework half of the design.

### What I did and why

- Created the ticket and its design and reference documents with `docmgr`. Used the repository vocabulary and resolved the docs root to this worktree's `ttmp`.
- Read `rewrites.ts`, `differential.ts` and `03-strategy-contracts.ts` to find where a domain can check an individual candidate before accepting its revision.
- Ran the existing conformance example on Node v24.18.0. This exercises a real edit acceptance hook independently of the proposed Tix rules.

### What worked

The conformance run reported three accepted transactions, three rewrite applications and one deliberately rejected edit (`postcondition`). The original input remained intact. A minimal `registerHooks` probe resolved `node:path` successfully before the source run.

### What didn't work

`ls -d dist node_modules 2>/dev/null` exited 2 with no output. `command -v tsc` exited 1. I ran the existing TypeScript example directly with Node's type transform and a process-local relative import resolver. No dependency install was needed.

### What I learned

For three equal weights and values [1,1,3], dividing each term by three and summing in f32 gives 1.6666667461395264. Summing first and dividing once gives 1.6666666269302368. This is already a one-row witness on finite bounded inputs. The grouping of the *score* division can stay exactly as submitted.

### What was tricky and what warrants review

A row-wide anchor can survive ordinary producer fusion and tiling. A reviewer should look for the step that removes its dependency on unvisited blocks, and check that its precondition can be read from the IR. The more subtle performance question is how often different query tiles reload K and V.

### Future work and review instructions

Consider the proposed experiment after the Tix entry points arrive. To reproduce the framework probe from the worktree root, run the following command.

```sh
node --experimental-transform-types --input-type=module -e 'import {registerHooks} from "node:module"; registerHooks({resolve(s,c,next){return next(s.startsWith(".") && s.endsWith(".js") ? s.slice(0,-3)+".ts" : s,c)}}); await import("./src/conformance/03-strategy-contracts.ts");'
```

### Technical details

The differential invariant accepts a custom generator, separate baseline and subject evaluation, and a comparison callback. The domain must decide on the observation and relation. The exact-rewrite audit also needs access to the immediate predecessor after an earlier step has introduced rounding differences.

## Step 2. Derive the merge and review the experiment

I split block formation, exponential rebasing and summary folding into separate edits. This exposes an intermediate program that uses block-local maxima but still reads every summary twice. The fold removes that second traversal because its state represents any prefix at that prefix's own maximum.

### Prompt context

See Step 1 for the request. The design must let a reviewer distinguish a legal real-algebra edit from numerical acceptance of the compiled function.

### What I did and why

I traced all six rules on the parsed attention source, worked through a two-block example with a rising maximum and a signed value, and specified a bounded input domain. I chose a tagged empty state to avoid evaluating a difference of two negative infinities. The traffic estimate explicitly counts K,V reads per query tile so the hardware experiment can falsify the traffic claim independently of the allocation claim.

### What worked

- The actual framework function `runDifferential` on Node v24.18.0 reported `agree` at absolute tolerance 1e-5 and `disagree` at zero for the three-equal-scores division witness. The baseline was the source-order f64 result and the candidate was the f32 result after division hoisting.
- `docmgr doctor --ticket IRWB-021-A --stale-after 30` passed. Frontmatter validation passed for the index, design and diary. A filesystem check resolved all eight relative Markdown links in the ticket.

### What didn't work

No additional failures occurred during this step. The witness exercised the existing differential API. The numerical acceptance of the Tix revisions and the GB10 measurements are future experiments.

### What I learned and what warrants review

A common maximum is sufficient for comparing two states, even when neither is the final row maximum. Review R5 for the restriction on payload dependence and R6 for scaling both lanes of each operand. Check that the experiment compares every accepted candidate with the same source f64 result, including the unmodified source run in f32.

### Future work and review instructions

Read the design from the parsed program through the two-block trace, then audit the domain, tolerance and primary-shape performance thresholds. The design's Later section names the dependencies for carrying out the experiment.

### Technical details

In the trace the second block sets a new maximum. The first block's mass 2 and weighted sum 4 both get multiplied by exp(−1). For the GPU experiment the durable row state has D+2 numeric components, regardless of how many key blocks have been consumed.

## Step 3. Validate and stage the ticket

The ticket passed docmgr's checks after closure. The first staging attempt reached a read-only shared Git index. Staging the same ticket through the approved Git write path succeeded.

- Prompt and intended deliverable are recorded in Step 1.
- `git add -- ttmp/2026/11/26/IRWB-021-A--deriving-streaming-attention-by-checked-rewrites` initially reported `fatal: Unable to create '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/worktrees/r1-ah-irwb-021-a/index.lock': Read-only file system`. The escalated retry exited 0.
- The remaining publication step was the requested local commit.
