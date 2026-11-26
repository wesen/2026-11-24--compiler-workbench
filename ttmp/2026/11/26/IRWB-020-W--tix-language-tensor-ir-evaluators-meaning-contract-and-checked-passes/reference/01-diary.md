---
Title: Diary
Ticket: IRWB-020-W
Status: active
Topics:
    - compiler
    - ir
    - verification
    - typescript
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'Design and implementation checkpoints for Stage 1 Tix.'
LastUpdated: 2026-11-26T14:45:44.08161177-05:00
WhatFor: 'Trace design decisions, evidence and handoffs.'
WhenToUse: 'Review or resume work on IRWB-020-W.'
---

# Diary

## Step 1: Inspect v6 and prepare the design for review

I traced Typed's native pass pipeline and the framework's sampled contract runner before choosing the Tix
representation. The main mismatch is lifecycle rather than semantics: native artifacts and configurable
comparison already fit, but the existing checked application is async and the specified API is synchronous.
The design proposes one shared preparation seam. This checkpoint changes documentation only.

### Prompt Context

**User prompt (verbatim):**

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-W. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

## Stage 1 (yours): the language, its IR, evaluators, a contract, two passes
- **Tix,** a small index-notation language, specified below. Parse it and check it (shapes, index extents, single assignment), with errors that give `line:col`.
- **Its IR as a v6 artifact** in `src/tensor/`, using `src/framework` (artifacts, IR definitions, contracts, passes). Choose the IR's form.
- **Two evaluators:** f32 (the program's meaning, defined below) and f64 (a reference for tolerance checks).
- **A meaning contract for tensor passes.** It needs a domain (which shapes and input values to check on), an observation (what is compared) and a relation. The relation is either exact (bit-identical f32 outputs) or a tolerance against the f64 reference. Choose the tolerance and justify it.
- **Two checked passes** that exercise the contract:
  - `inline`: substitute a pointwise statement with a single use into its consumer. Its f32 results must be bit-identical.
  - `split-sum`: rewrite a `sum` reduction over one index into a two-level reduction (blocks, then within blocks). It reassociates the sum, so f32 results change, and it must be accepted only under the tolerance relation.

  Show that the exact relation rejects `split-sum`, that the tolerance relation accepts it, and that the contract rejects a deliberately wrong variant of each pass.
- **A corpus** under `corpus/tensor/<name>/main.tix`, with at least: matmul, softmax (max-shifted), layernorm (gamma, beta, eps), single-head attention, an MLP block with tanh-GELU, and conv2d (NCHW, stride 1, no padding).

Later stages, which are not yours: lowering to CUDA and running it on the GPU machine, fusion, tiling of contractions, attention-specific rewrites. Do not design them. Do not let them bend this stage, beyond keeping the IR suitable for loop-level lowering.

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

## Fixed API (in `dist/tensor/index.js` after the build)
```ts
compileTix(source: string): TixProgram      // throws Error whose message contains line:col on invalid source
runTix(program: TixProgram, fn: string,
       inputs: Record<string, { shape: number[]; data: Float32Array | Float64Array }>,
       options?: { precision?: 'f32' | 'f64' }): { shape: number[]; data: Float32Array | Float64Array }
optimizeTix(program: TixProgram, passes: string[]): { program: TixProgram; steps: { pass: string; accepted: boolean }[] }
```
`runTix` takes row-major data. `optimizeTix` runs the named passes in order, each checked by your contract, and returns a program `runTix` can run. Anything beyond this API is yours to design.

## Repository facts
- Build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`. See `tests/framework/core.test.mjs` for the pattern. Prettier: 110 columns, single quotes.
- Read `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/strategy/README.md`, and enough of `src/typed/` (for example `src/typed/passes.ts`, `src/typed/evaluate.ts`, `src/typed/project.ts`) to see how one domain uses the framework.
- Nothing checks tensor programs yet. The Typed corpus-wide tests cover only `corpus/projects`. Your tests are the only checks on your work, so put them where the risk is.
- In the sandbox, a test that spawns `node` can fail with EPERM. Request escalation for that command.
- Scope: you may add `src/tensor/`, `tests/tensor/` and `corpus/tensor/`, and change `src/framework/` where the tensor domain needs it. Record every framework change in your design. After the implementation, run `node --test tests/framework/` and the tests in `tests/typed/` that cover what you changed. Do not modify `src/typed/`, `tools/`, `corpus/projects/` or existing tests, except framework tests that your framework change makes necessary.
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-W:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-W. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
````

**Assistant interpretation:** Set up a ticket and reviewable design now, then stop for review. Plan the
implementation, corpus and tests, but do not write them yet.

**Inferred user intent:** Use a genuinely different IR to learn which workbench parts generalize and which
need a change, with that framework delta visible to the reviewer.

### What I did

- Read the framework contracts, IR and strategy READMEs, then inspected `define-pass.ts`, `differential.ts`,
  and Typed's passes, evaluator and project driver. Reviewed the framework E3 and E5 tests.
- Created the ticket, design, and diary using `docmgr`. Wrote the representation, compiler checks, numerical
  policy and validation plan in the [design](../design-doc/01-stage-1-design-tix-and-checked-tensor-passes.md).
- Ran a standalone Node calculation on the proposed reduction witness and tail test. No source was added.

### Why

The fixed sync API does not justify cloning contract execution or making the semantic manager synchronous.
A shared native preparation helper gives both domains the same structural validation, diff, correspondence
and write checks. `runDifferential` already does the pure, synchronous evidence work. Keeping the origin
reference as well as the immediate pass input distinguishes exact preservation from accumulated error.

### What worked

- Node v24.18.0 at pre-design revision `19ad269`: the scalar-only probe measured sequential f32 `1`
  (`0x3f800000`), blocked f32 `1.000000238418579` (`0x3f800002`), and f64 `1.0000002980232239`. The isolated
  last term distinguished the correct block loop from a dropped tail (`1` vs `0`). The rounding probe also
  observed distinct stored words for `-0` and `+0`, and the runtime evaluated exact BigInt shape algebra.
- `docmgr doctor --ticket IRWB-020-W --stale-after 30`: all checks passed. The arithmetic probe is evidence
  for the fixture and proposed storage/arithmetic choices, not for a Tix implementation. The build and test
  suites are deferred until implementation after review.

### What didn't work

- An exact-replacement edit to the draft included a stray `oldText: "counts"`. The edit tool reported
  `Could not find edits[0]` and made no changes. Reran with only the two intended replacements successfully.
- Two exact-replacement batches for `index.md` failed with `Could not find edits[2]` on the optional template
  cleanup. Reran the two overview/link edits without that replacement and left the template section in place.

### What I learned

- The workbench does not encode exactness in `differential`'s case runner; the domain supplies `compare`.
  Bit equality and an output-space tolerance can therefore share the same framework contract machinery.
- The final half-ULP in the order witness is unobservable in the blocked f32 result. Using it alone for tail
  coverage would let a dropped final iteration look correct; keep the separate tail-only fixture.

### What was tricky to build

- Source checks must distinguish symbolic mismatches from call-dependent bounds. Declared free extents are
  needed for the affine window of a convolution, but do not infer reduction extents; those need RHS witnesses.
- Exact-checking an inline against r0 after a correct reassociation would reject a good pass. Exact against
  the step input plus tolerance against r0 keeps both guarantees on the same cases.

### What warrants a second pair of eyes

Review the scope of `prepareNativePass`, the source-check/shape-precondition boundary, and the finite-output
requirement and error budget for the tolerance relation. In particular, decide whether the small domain covers
all behaviors needed from the corpus without mistaking sampled agreement for a proof.

### What should be done in the future

Wait for the reviewer reply before implementation. On resume, use the design's implementation order; extend
this diary with actual changed framework files, corpus error measurements and validation results.

### Code review instructions

Read the design's “Framework changes proposed” table first. Compare it to `applyPass`'s native branch and
`runDifferential` in this checkout. Then read the shape rules, relation table and negative-test fixtures.
No compiler build is required to review this documentation-only checkpoint.

### Technical details

Standalone arithmetic probe (Node v24.18.0):

```sh
node --input-type=module -e 'const f=Math.fround, xs=[1,0,0,0,...Array(5).fill(2**-24)], sum=ys=>ys.reduce((a,b)=>f(a+b),0), block=ys=>sum(Array.from({length: Math.ceil(ys.length/4)},(_,b)=>sum(ys.slice(b*4,b*4+4)))); console.log({order: [sum(xs),block(xs),xs.reduce((a,b)=>a+b,0)], tail:[block([0,0,0,0,0,0,0,0,1]),block([0,0,0,0,0,0,0,0])], bits:[...new Uint32Array(Float32Array.of(sum(xs),block(xs),-0,0).buffer)].map(x=>x.toString(16))}); console.log({affineInteger:(3n*BigInt(Number.MAX_SAFE_INTEGER)-2n).toString()});'
```
