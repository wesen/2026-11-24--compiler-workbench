---
Title: Diary
Ticket: IRWB-021-K
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
    - performance
DocType: analysis
Intent: short-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Investigation and validation log for the research design.
LastUpdated: 2026-11-26T12:54:47.257587879-05:00
WhatFor: Record the reasoning, checks, and review instructions for the design.
WhenToUse: When reviewing or resuming this ticket.
---

# Diary

## Step 1: Separate the real rewrite laws from f32 acceptance

I read the local rewrite and contract APIs to find the smallest place to attach checks. I then walked the source to a tile loop without changing the score expression: partition the sums, change each tile's anchor, and replace the separate global-max and weighted-sum passes with one product fold.

### Prompt Context

**User prompt (verbatim):**

~~~~markdown
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V on a reusable IR framework (`src/framework/`) in which every optimization pass is checked against the original program. A second domain is being started on the same framework: tensor programs written in Tix, an index-notation language specified below, to be compiled to CUDA for an NVIDIA GB10 GPU. The Tix front end, evaluators and a meaning contract with a tolerance relation are being built in parallel and are not in your worktree. Treat the Tix core below and its f32 meaning as given.

Your ticket is IRWB-021-K. Your task is a **research design**: a document, no implementation. Create the ticket, write the design document, keep a diary, and commit.

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
- Use your docmgr and diary skills. Commit on your current branch with messages starting `IRWB-021-K:`. Do not push.
- Final message: the ticket and design paths, the rule set in one line per rule, the commit hash.
Your ticket ID is IRWB-021-K. Name the ticket after the research question (deriving streaming attention by checked rewrites).
~~~~

**Assistant interpretation:** Deliver a design and review trail, not a Tix or CUDA prototype.

**Inferred user intent:** Test whether the compiler can derive the recurrence with local proof obligations and competitive generated code, rather than recognizing and replacing a named attention idiom.

### What I did

- Read `src/framework/ir/PATTERNS-AND-REWRITES.md`, `src/framework/ir/rewrites.ts`, `src/framework/contracts/README.md`, `src/framework/contracts/differential.ts`, and the `meaningKept` integration in `src/typed/evaluate.ts` at worktree base `19ad269`.
- Created the ticket, design and diary with docmgr. Linked the rewrite API, differential checker, and Typed integration to the design using `docmgr doc relate`.
- Replayed the rule sequence on paper, including `N=1`, clipped tiles, tied maxima, a new winning maximum, and the maximum projection needed by log-sum-exp.

### Why

R4 gives the change-of-anchor identity its own visible step; R5 then proves only the summary-combine law. This makes a checker smaller than a symbolic equivalence prover and avoids collapsing the whole transformation into an attention-specific rule. Comparing every revision with a single f64 origin, rather than spending tolerance at each adjacent step, avoids using a nontransitive relation as an equality.

### What worked

- Found the existing `applyOnce` verification hook and the `differential()` baseline/subject API. The latter lets the domain provide both evaluator and comparator; the Typed contract shows how it pins the origin and caches its case outcomes.
- A Node v24.18.0 arithmetic probe showed per-term division vs factored division giving `0.7000000476837158` vs `0.699999988079071`, and sequential vs two-tile summation giving `0` vs `1`. This is an arithmetic sanity check, not a Tix run or observed error on an attention input:
  ```sh
  node -e 'const f = Math.fround, s = xs => xs.reduce((a,x)=>f(a+x),0); const xs = [2**24,1,1,-(2**24)]; const a = s([f(1/10),f(6/10)]), b = f(s([1,6])/10), linear = s(xs), grouped = s([s(xs.slice(0,2)),s(xs.slice(2))]); console.log({divideInside:a,divideOutside:b,linear,grouped,maxZeroOrder:Object.is(Math.max(-0,+0),Math.max(+0,-0))}); if (a===b || linear===grouped) process.exitCode=1'
  ```
  `maxZeroOrder` was `true` for that tie probe.

### What didn't work

The first arithmetic probe used undistinguishing examples. The command below printed `{ divideInside: 1, divideOutside: 1, linear: 1, grouped: 1, negativeZero: true }` and set the Node process exit status to 1. The successful probe above uses different terms and splits into equal consecutive subranges.

```sh
node -e 'const f = Math.fround; const a = f(f(1/3)+f(2/3)), b = f(f(1+2)/3); const linear = [2**24,1,-(2**24),1].reduce((a,x)=>f(a+x),0), grouped = f(f(2**24+1) + f(-(2**24)+1)); console.log({divideInside:a,divideOutside:b,linear,grouped,negativeZero:Object.is(Math.max(-0,-0),-0)}); if (linear === grouped) process.exitCode=1'
```

No runtime experiment was attempted. `command -v nvcc`, `command -v ncu` and `command -v nvidia-smi` returned no paths here; the design does not infer GB10 timing or profiling support from the local environment.

### What I learned

An exact proof about an associative combine over reals does not determine the f32 evaluation order. Even a bit-preserving IR step must still satisfy the experiment's origin gate. Also, removing global score writes does not bound total DRAM traffic by compulsory input/output bytes: multiple query blocks can reload the same K and V tiles.

### What was tricky to build

The brief's reduction grammar puts the divisions in both bodies. I preserved the score division and made factoring the output division its own checked application. R5 removes the global anchor dependency but does not by itself make the score producer tile-local; R6 binds the tile max and scores locally and checks that all uses are covered before removing their global definitions.

### What warrants a second pair of eyes

Check R4's shared anchor and matched domains, and R5's tagged identity, group invariant, and exact projections. In the experiment, check whether the f64-origin tolerance qualifies the unmodified program first and whether the GB10 can supply the required off-chip byte counters.

### What should be done in the future

Run the evaluator qualification and then the GB10 study once the parallel Tix components are available. Other scope is listed under “Later” in the design.

### Code review instructions

Start with [the derivation table and checker design](../design-doc/01-deriving-streaming-attention-by-checked-rewrites.md). Run `docmgr doctor --ticket IRWB-021-K --fail-on warning` and `git diff --cached --check` before commit. There are no source changes to build or test.

### Technical details

The proposed exact checker replays versioned local schemas against exact revisions. The numerical oracle evaluates the original parse in f64 on f32 input values. The benchmark counts device-resident latency and off-chip traffic separately from scratch capacity and cache load requests.

## Step 2: Validate the documentation package

I checked the ticket's metadata and relationships and updated the docmgr projections. This checkpoint validates the documentation, not the proposed transformations or their performance.

### Prompt Context

**User prompt (verbatim):** See Step 1.

**Assistant interpretation:** Deliver the design, diary, and ticket together in a documentation-only commit.

**Inferred user intent:** Leave a reviewable record of what was designed and what is still untested.

### Evidence and commits

- `docmgr validate frontmatter --doc <design-path>` reported `Frontmatter OK`.
- `docmgr milestone record --ticket IRWB-021-K --operation-id streaming-attention-design ...` committed the task/changelog projections with task `v95y` complete. See the ticket-local receipt for the exact request.
- `docmgr doctor --ticket IRWB-021-K --fail-on warning` reported `All checks passed`.

### Noteworthy decisions or failures

The first `git diff --cached --check` reported `index.md:38: new blank line at EOF.` I removed the extra blank line. No checker or CUDA kernel was implemented or measured.

### Remaining requirements and next action

Review the design; qualify the revision chain and then measure CUDA artifacts in the future study.
