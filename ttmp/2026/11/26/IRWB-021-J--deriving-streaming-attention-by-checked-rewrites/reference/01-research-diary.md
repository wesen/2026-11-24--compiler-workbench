---
Title: Research diary
Ticket: IRWB-021-J
Status: complete
Topics:
    - research
    - compiler
    - ir
    - verification
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://tests/framework/ext-e5.test.mjs
      Note: Worktree tests used to verify fixed-baseline differential evidence.
    - Path: repo://tests/framework/ir-rewriting.test.mjs
      Note: Worktree tests used to verify guarded rewrites and pre-publication checks.
ExternalSources: []
Summary: Decisions, local probes, and review notes for the streaming attention design.
LastUpdated: 2026-11-26T13:02:34.196482831-05:00
WhatFor: ""
WhenToUse: ""
---

# Research diary

## Step 1 — Establish the check boundary

The design needs two kinds of evidence. The generic IR can already gate one provisional edit and retain its evidence. The tensor-specific proof instances and numerical observations have to be specified from the supplied Tix meaning. I checked the first claim with the existing framework tests and used a ten-element row to test an assumption about the second.

### Prompt context

User request, verbatim.

~~~~text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V on a reusable IR framework (`src/framework/`) in which every optimization pass is checked against the original program. A second domain is being started on the same framework: tensor programs written in Tix, an index-notation language specified below, to be compiled to CUDA for an NVIDIA GB10 GPU. The Tix front end, evaluators and a meaning contract with a tolerance relation are being built in parallel and are not in your worktree. Treat the Tix core below and its f32 meaning as given.

Your ticket is IRWB-021-J. Your task is a **research design**: a document, no implementation. Create the ticket, write the design document, keep a diary, and commit.

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
- Use your docmgr and diary skills. Commit on your current branch with messages starting `IRWB-021-J:`. Do not push.
- Final message: the ticket and design paths, the rule set in one line per rule, the commit hash.
Your ticket ID is IRWB-021-J. Name the ticket after the research question (deriving streaming attention by checked rewrites).
~~~~

I interpreted this as a request for a reviewable derivation and an experiment that could disprove its usefulness. The deliverable is the design, with future measurements identified as such.

### Investigation

- Started from clean revision `19ad269`. The local `.ttmp.yaml` selects `ttmp`. `docmgr --help` and the create/add help confirmed the local ticket and document commands. Created IRWB-021-J with the repository's research, compiler, IR, verification and performance topics.
- Read the generic rewrite gate, transaction types and differential checker, plus their focused tests. A revision's predecessor is available at the gate. The driver must separately bind the immutable original to the f64 baseline for every step.
- Rejected a single pattern for the entire attention function. A tuple of ordinary sums, the identity for changing the center of an exponential, and induction over neighboring blocks each have smaller, replayable premises.

### Probes and recovery

`tsc --version` reported `zsh:1: command not found: tsc`. `ls -d node_modules dist` reported both paths absent. For the two existing framework test modules, Node v24.18.0 could load the worktree sources directly. The one-off resolver maps their build-output imports to the corresponding source modules. The following probe passed all 38 tests. This covers generic framework behavior.

```sh
node --experimental-transform-types --disable-warning=ExperimentalWarning --input-type=module <<'NODE'
import { registerHooks } from 'node:module'
registerHooks({ resolve(spec, ctx, next) {
  if (spec === '../../dist/framework/ir/index.js' || spec === '../../dist/framework/contracts/index.js' || spec.startsWith('../../dist/labs/')) spec = spec.replace('../../dist/', '../../src/')
  if (spec.startsWith('.') && spec.endsWith('.js')) spec = spec.slice(0, -3) + '.ts'
  return next(spec, ctx)
} })
await import('./tests/framework/ext-e5.test.mjs')
await import('./tests/framework/ir-rewriting.test.mjs')
NODE
```

For a Tix row with ten equal scores and all values one, a Node probe of the two f32 expression trees produced different results. The original returned `1.0000001192092896` and the hoisted division returned `1`. This makes an exact-f32 contract for the hoist untenable.

```sh
node --input-type=module -e 'const r=Math.fround; let a=0, b=0; for(let j=0;j<10;j++){a=r(a+r(1/10)); b=r(b+1)} console.log(a,r(b/10),r(Math.exp(-110)))'
```

### Review and next step

Review the proposed denominator guard against Tix's greedy reduction scope. Inspect `src/framework/ir/types.ts` (`EditOptions.verify`) and `src/framework/contracts/differential.ts` (`baseline`, `subject`, `compare`). The remaining design question is how a local change of center lets the compiler remove the dependency on the future row maximum while retaining a defined f32 order.

## Step 2 — Derive the combine and test its failure modes

The question in Step 1 becomes tractable after splitting each sum into consecutive blocks. Each block can move its weights to its own center. The outer sum then depends on only a block maximum and its moments. Writing the same expression for the concatenation of two neighboring segments produces the combine and its proof in one step.

### Decisions and evidence

- Wrote the [design](../design-doc/01-from-materialized-scores-to-a-checked-streaming-fold.md) with a fixed f32 order for every candidate. A separate reassociation step makes a change of grouping visible to the checker. An empty tag supplies an identity without evaluating an exponential of an undefined difference.
- Checked the short-tail example against the proposed value domain. Chose values `(0,1,1)` so the numerical control is an actual supported input. For a last key of `f32(log(2))`, the Node scalar probe below produced reference `0.7500000002380818`, merged result `0.75`, missing old numerator scale `1`, and dropped tail `0.5`. This checks three closed-form expressions, not a Tix execution.
- Counted full-row input/output storage separately from repeated reads of K and V across query tiles. Even a kernel with no square allocation can reread those arrays once per query tile. The experiment therefore measures physical read/write bytes and total device time for each variant.

```sh
node --input-type=module <<'NODE'
const f = Math.fround, hi = f(Math.log(2)), a = f(Math.exp(f(0-hi)))
const expected = (Math.exp(-hi)+1)/(2*Math.exp(-hi)+1)
const mass = f(f(a*2)+1)
console.log({expected, merged:f(f(f(a*1)+1)/mass), lostScale:f(f(1+1)/mass), lostTail:f(1/2)})
NODE
```

### Review instructions

Start with R5 and verify the scalar multiplies the signed numerator as well as the positive mass. For R6 expand a concatenation of unequal block maxima. Then inspect the f32 comparison ports and ensure they use an immutable original at every step. In the experiment, compare the model of one K/V scan per query tile with measured off-chip reads on the same shape.

The probes substantiate the framework and scalar examples. The numeric thresholds and GB10 ratios are hypotheses for a future run. The design's Later section records its implementation dependencies.

## Step 3 — Validate the design ticket

I checked the deliverables against the request in Step 1 and closed the design ticket. The experiment remains prospective.

`docmgr validate frontmatter` accepted the index, design and diary. `docmgr doctor --ticket IRWB-021-J --stale-after 30` passed after closure. A file check resolved all ten relative Markdown links and found the six numbered rule schemas in order. The source tree at `19ad269` supplied the probes in Steps 1 and 2.
