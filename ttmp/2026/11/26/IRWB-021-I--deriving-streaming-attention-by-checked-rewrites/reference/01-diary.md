---
Title: Diary
Ticket: IRWB-021-I
Status: review
Topics:
    - compiler
    - ir
    - verification
    - performance
    - research
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Existing fixed-origin differential hook
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Existing per-application acceptance boundary
    - Path: repo://ttmp/2026/11/26/IRWB-021-I--deriving-streaming-attention-by-checked-rewrites/design-doc/01-deriving-streaming-attention-by-checked-rewrites.md
      Note: Research design and numerical probes
ExternalSources: []
Summary: Source prompt, design decisions and local validation evidence
LastUpdated: 2026-11-26T13:00:34.1436374-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1 — Establish the contract boundary

I created IRWB-021-I and traced the existing framework hooks for checking a transformation against a fixed origin. The worktree has the reusable hooks and a Typed caller to follow. The tensor semantics for this ticket come from the brief.

### Prompt context

**User prompt (verbatim)**

~~~~markdown
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V on a reusable IR framework (`src/framework/`) in which every optimization pass is checked against the original program. A second domain is being started on the same framework: tensor programs written in Tix, an index-notation language specified below, to be compiled to CUDA for an NVIDIA GB10 GPU. The Tix front end, evaluators and a meaning contract with a tolerance relation are being built in parallel and are not in your worktree. Treat the Tix core below and its f32 meaning as given.

Your ticket is IRWB-021-I. Your task is a **research design**: a document, no implementation. Create the ticket, write the design document, keep a diary, and commit.

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
- Use your docmgr and diary skills. Commit on your current branch with messages starting `IRWB-021-I:`. Do not push.
- Final message: the ticket and design paths, the rule set in one line per rule, the commit hash.
Your ticket ID is IRWB-021-I. Name the ticket after the research question (deriving streaming attention by checked rewrites).
~~~~

**Interpretation and intent.** Deliver a ticket that specifies how to test whether a mechanical rewrite pipeline can derive streamed attention and meet numerical and hardware targets.

### What I did

- Created the ticket and its design and diary with `docmgr ticket create-ticket` and `docmgr doc add`.
- Read `applyPass` and its extra input ports, `defineInvariant`, `differential` and the Typed `meaningKept` caller.
- Checked the supplied grammar against both reduction bodies and confirmed Node 24.18.0 provides the rounding operation used by the brief.

### Why

The preceding revision is the right input to the exact application check. All candidates need a common f64 baseline because a tolerance relation does not compose across successive approximations.

### What worked

The repository already supports a structural invariant and a differential invariant at the same transaction boundary. In Node, `Math.fround(0.1)` returned `0.10000000149011612`, `Math.fround(2**-149)` returned `1.401298464324817e-45`, and `Math.fround(2**-150)` returned `0`.

### What did not work

`command -v nvidia-smi` exited 1 with no output, and `command -v nvcc` and `command -v ncu` also found no executable on the command path. The design defers the GPU toolchain and counter probe to the experiment.

### What I learned

The source scales each rounded score term before accumulation and divides each weighted output term before accumulation. Moving score scaling is unnecessary for this derivation.

### What was tricky

A shared sample suite is compatible with local rule checking only if the application checker retains the incoming revision and the numerical gate retains the source as distinct inputs.

### What warrants a second pair of eyes

Review the `input`, `output` and `origin` mappings against `applyPass` and the invariant port bindings.

### What should be done in the future

Integrate the parallel tensor pieces when available, using the existing framework boundaries.

### Review instructions

Start with the design's domain and contract sections, then follow its links to `define-pass.ts` and `differential.ts`.

### Technical details

The current branch is `r1-sx/irwb-021-i`. The starting revision is `19ad269`.

## Step 2 — Specify the rewrites and falsification tests

I wrote four application templates from the source graph to an ordered fold over tiles. Each template has a local real-arithmetic identity and a check that can be run on the matched graph without searching for identities.

### Prompt context

See Step 1 for the original request. The design covers the attention derivation, the required IR state, numerical checks, related programs and the GB10 trial.

### What I did

- Separated quotient hoisting, the bitwise-preserving sum zip, online maximum-relative summaries and tiling.
- Chose a bounded first-trial domain and a single fixed f64 tolerance budget. Specified adversarial samples and the hardware refutation criteria.
- Ran a small Node arithmetic probe for quotient hoisting and for grouping additions. Recorded both outcomes in the design.

### Why

An ordered product-state fold is enough to express the transformations and fixes the f32 schedule. For R3 and R4, the real union identity supplies the mechanical justification and the f64 comparison supplies empirical numerical evidence.

### What worked

In `node --input-type=module`, the hoisting witness returned `0.5833333730697632` and `0.5833333134651184`. With two rounded `exp(Math.fround(Math.log(2**-24)))` weights, the ordered and grouped sums gave `1` and `1.0000001192092896`. Both checks asserted that the results differed.

### What did not work

An initial diary-write tool script failed to parse with `SyntaxError: Unexpected string` because its JavaScript string literal used triple quotes. It wrote no files. A template literal supplied the text on retry.

### What I learned

Removing N×N tensors gives a storage result and removes their traffic. In a GPU grid, separate query tiles can still request the same K/V data, so a DRAM-traffic claim needs a device measurement.

### What was tricky

Empty summaries need a tag and an arithmetic-free identity path. This avoids evaluating a difference between two negative infinities and gives a clear initialization rule at both key and tile granularity.

### What warrants a second pair of eyes

Review whether the use checks rule out leaked weights and whether the exact tile coverage check catches a dropped tail. The fixed tolerance and device time ratios are trial criteria to test.

### What should be done in the future

Run the trial once the Tix and CUDA pieces listed in the design's Later section are available.

### Review instructions

Read R1–R4 in order. Verify that each expected edit includes its surrounding use boundary. Read the experiment's refutation paragraph with the primary shapes and ratios.

### Technical details

R2 preserves the sequence of operations in each scalar accumulator. R3 changes weight evaluation and scaling positions. R4 changes grouping as well as which maximum determines an individual weight.

## Step 3 — Review the design and ticket

The coverage review exposed one detail in the generality example. A separate softmax producer divides the weight before the contraction multiplies it by the payload. I made that graph an explicit R1 variant and documented its distinct rounding order.

### Prompt context

See Step 1. The requested deliverables are the ticket, design, diary and local commit.

### Evidence and decisions

- The local-link check resolved every link in the ticket index and design. It also found all four numbered rules and the requested design sections.
- `docmgr doctor --ticket IRWB-021-I --fail-on warning` passed.
- The design uses a fixed tolerance, bounded inputs and primary shape and timing targets. The numerical and hardware claims remain hypotheses until the trial runs.

### Remaining requirements

Commit the ticket files on the current branch. Tix integration and the GB10 trial are future work recorded in the design.

## Step 4 — Stage the ticket for the local commit

The ticket and completed tasks passed docmgr validation. Git staging in the default sandbox stopped before writing the worktree index. The six ticket files were ready for a retry with access to Git metadata.

### Prompt context

See Step 1 for the request to commit on the current branch.

### Evidence and decisions

- `git add --` with the six ticket paths exited 128 with `fatal: Unable to create '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/worktrees/r1-sx-irwb-021-i/index.lock': Read-only file system`.
- `docmgr doctor --ticket IRWB-021-I --fail-on warning` passed after the final design edit, and `docmgr task list --ticket IRWB-021-I` showed both tasks checked.

### Remaining requirements

Perform the requested local commit with access to the worktree index.
