---
Title: Implementation diary
Ticket: IRWB-022-G
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-022-G--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/scripts/01-math-probe/main.cu
      Note: GB10 measurement kernel
    - Path: repo://ttmp/2026/11/26/IRWB-022-G--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/scripts/02-read-probe.mjs
      Note: Stage-1 rounding and budget comparison
ExternalSources: []
Summary: Design checkpoint, reproducible GB10 arithmetic probe, and pre-implementation review boundary.
LastUpdated: 2026-11-26T15:15:00-05:00
WhatFor: Resume this stage from measured evidence and the reviewer's decisions.
WhenToUse: Before implementing or revising the checked CUDA lowering.
---

# Implementation diary

## Step 1: Find the rounding boundary on the actual target

Before writing an emitter I wanted to know what the contract could honestly promise. The GB10 executed small arithmetic probes using the same compiler and flags as a future lowering. The outputs rule out bit identity for standard CUDA float transcendental functions; they also give an output-error measurement relative to the stage-1 tolerance. The probes are fixed expressions, not prototype compiler code.

I then tried the proposed pass boundary locally with a real `AnalysisManager`, Tix input port, text output and an asynchronous test delegate. The existing framework replayed all cases on the second check and rejected a changed candidate. The missing piece is smaller than a remote pass runner: it is the ability to declare a differential check that has **only** a batch implementation.

### Prompt Context

**User prompt (verbatim):**

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`). Stage 1 built its front end, IR, f32 and f64 evaluators, a meaning contract and two checked passes. Its design and its final report are in ticket IRWB-020-B under `ttmp/2026/11/26/`. Read them first.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-022-G. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

## Stage 2 (yours): lowering Tix to CUDA, checked, on the GPU machine
- **Lower a Tix function to CUDA C:** one kernel per statement, one thread per output element, and each reduction a sequential loop in the order the f32 meaning prescribes. Choose whether the lowered form is a second v6 artifact (a kernel IR) or is emitted directly from the Tix IR, and justify the choice. Programs returned by `optimizeTix` (after `inline` or `split-sum`) must lower too.
- **Run it on the GPU machine** through `tools/cuda-remote.mjs` (read its header). The tool:
  - copies a directory containing `main.cu` to `manuel@bling` (an NVIDIA GB10: sm_121, CUDA 13.0, `nvcc` at `/usr/local/cuda-13.0/bin/nvcc`);
  - compiles with `nvcc -O3 -arch=sm_121`, reusing an earlier compile of identical inputs;
  - runs the program and copies its `out/` directory back.

  You may extend the tool. Record each change and its reason.
- **A checked lowering.** The lowering is a pass whose output must keep the stage-1 meaning. Its contract runs the candidate on the remote GPU. Decide which relation holds and establish it by probing on the GB10:
  - either bit-identical with the f32 meaning, stating under which compiler flags and with which implementation of each operation and intrinsic;
  - or a tolerance against the f64 reference, justified by an error argument or a measurement.

  The engine is expensive, remote and asynchronous. Design how the contract batches its cases and reuses evidence, and what the framework needs for that.
- **Measure** the kernel time on the GPU for each corpus program at the sizes below, and the time of the stage-1 f32 interpreter on this machine for the same program.

| Program (`corpus/tensor/<name>/main.tix`) | Sizes, in the program's shape names |
|---|---|
| matmul | M = K = N = 512 |
| softmax | N = 4096, C = 1024 |
| layernorm | N = 4096, D = 1024 |
| attention | Q = K = 1024, D = V = 64 |
| mlp | N = 1024, D = 256, H = 1024, O = 256 |
| conv2d | N = 8, C = 16, H = W = 64, O = 32 (3 × 3 kernel) |

Later stages, which are not yours: fusion, tiling and shared memory, tensor cores, other thread mappings, streaming attention, autotuning. Do not design them.

## Tix, fixed core (unchanged from stage 1)
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
- A reduction's body extends as far right as possible, to the end of the enclosing parentheses or statement.
- Each statement defines a new tensor, assigned once. Its left-hand index names range over extents inferred from their plain (non-affine) uses on the right. An index used only in affine positions takes its extent from the statement's declared type, which is then required.
- Reduction indices are bound by their reduction and range over extents inferred the same way. A shape name used in an expression denotes its value as a number. A function's shape names are bound by its inputs' shapes when it is called.
- **f32 meaning:**
  - every literal, shape value, operation and function result is rounded to f32 (`Math.fround` of the JavaScript double result);
  - `sum` starts at 0 and `max` at −∞, and both accumulate in increasing lexicographic order of their indices, the first listed outermost, rounding after each step.
  - Inputs are finite. Behaviour outside the valid domain (inconsistent shapes, an extent that cannot be inferred) is a check error at compile time.
- **Three rules stage 1 settled** (the base implements them):
  - tensor names and index names are separate: `y[x] = x[x] * 2` is valid;
  - a reduction may rebind an index of an enclosing reduction, and the inner binding shadows the outer (`sum(j) a[i, j] + sum(j) b[i, j]` is a nested reduction);
  - a shape value may be 0: an empty `sum` is 0 and an empty `max` is −∞.

## Fixed API (additions in `dist/tensor/index.js` after the build)
```ts
cudaSource(program: TixProgram, fn: string): string
  // the complete CUDA C translation unit for one function: its kernels and a main that reads the inputs and writes the result
runTixCuda(program: TixProgram, fn: string,
           inputs: Record<string, { shape: number[]; data: Float32Array }>,
           options?: { host?: string }): Promise<{ shape: number[]; data: Float32Array; gpuMs: number }>
  // runs on the GPU machine; gpuMs is the time of the function's kernels on the GPU (CUDA events), without transfers or start-up
checkLowering(program: TixProgram, fn: string): Promise<{ accepted: boolean; relation: 'exact' | 'tolerance'; reason?: string }>
  // your contract's verdict on the lowering of this function
```
Stage 1's `compileTix`, `runTix` and `optimizeTix` keep their signatures and behaviour. Implementations are compared on this API. Anything beyond it is yours to design.

## Repository facts
- Build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24 pass files, not a bare directory. Prettier: 110 columns, single quotes.
- Read `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts` (stage 1 added `applyNativePassSync`), and `src/tensor/`.
- Your sandbox has network access, so `ssh` to the GPU machine works from it. Run GPU work only through the tool. Other agents share the machine: use `--timed` (a lock, so that measurements do not disturb each other) only for measurements, and keep those runs short.
- Keep the tests that need the GPU in their own test file, so that the other tests run without the network.
- In the sandbox, a test that spawns `node` can fail with EPERM. Request escalation for that command.
- Scope: you may change `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and `src/framework/` and `tools/cuda-remote.mjs` where the stage needs it. Record each framework and tool change in your design. Do not modify `src/typed/`, `corpus/projects/`, other tools or existing tests outside `tests/tensor/`, except framework tests that a framework change makes necessary. Do not run the full suite (`npm test`): many agents share this machine.
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-022-G:`. Do not push.
- Final message: the ticket and design paths, the framework and tool changes you propose, the relation you chose for the lowering and the probe that established it, the commit hash.
Your ticket ID is IRWB-022-G. Name the ticket after the stage-2 work (lowering Tix to CUDA, checked, on the GPU machine).
````

**Assistant interpretation:** This is the design checkpoint, with enough real machine investigation to choose a numerical contract. Implementation and benchmarks wait for review.

**Inferred user intent:** Identify what a second language and a remote executor actually need from this framework; don't disguise a missing capability by reimplementing it inside Tix.

### What I did

- Started on `t2-pi-ax/irwb-022-g`, base `1880fc4`, Node v24.18.0. Read the stage-1 design/report first, then the requested framework docs, both pass paths, `differential.ts`, the tensor sources, fixtures and remote tool. Created the design and diary with `docmgr`.
- `npm ci --ignore-scripts --no-audit --no-fund && npm run build` succeeded. No full suite. Created only ticket-local reproducible design probes. Ran GPU jobs only via the stock tool, without `--timed`.
- Reproduce from worktree root (new local directories so an old `out/` can't furnish the answer):

```bash
P=$(echo ttmp/2026/11/26/IRWB-022-G*/scripts)
d=$(mktemp -d); cp "$P/01-math-probe/main.cu" "$d/"
node tools/cuda-remote.mjs "$d"
node "$P/02-read-probe.mjs" "$d/out/grid.bin"
sha256sum "$d/out/grid.bin"
d2=$(mktemp -d); cp "$P/03-platform-probe/main.cu" "$d2/"
node tools/cuda-remote.mjs "$d2" && node tools/cuda-remote.mjs "$d2"
node "$P/04-contract-probe.mjs"
rm -rf "$d" "$d2"
```

### Why

The straightforward candidate is a translation unit, so the useful question for the framework is whether it can check a differently typed output before accepting the transformation. A same-kind graph pass and a serial per-case interpreter both obscure that question. The arithmetic experiment asks a different question: whether the outputs of the chosen *actual* math implementations have the same words as Node's.

### What worked

- Math probe job `40108c4e0ad53bc2`, exit 0, retrieved `grid.bin` (393,240 bytes; SHA-256 `68a79b66fef3ab3a23f00e8ba899ed284dfc783a8043ab5d0a2aebe1ddda172a`). No output binary committed. Node computed the f32 and f64 references on the exactly specified grid; the design gives the per-expression mismatch counts and worst utilization.
- Platform probe job `a715b343ac3259a7`: first compiled, second `compiled:false`; both exit 0. NVIDIA GB10 12.1, driver 580.178.04, CUDA release 13.0 V13.0.88 build `cuda_13.0.r13.0/compiler.36424714_0`. Result `00000000 a8800000 00000002 00000000 80000000 events OK` (separate multiply/add, FMA, subnormal, max of opposite zeros, min of opposite zeros). These are operation/capability checks, not kernel timings.
- Local stand-in delegate, **not** GPU validation: two misses sent together, no delegate call on second check of identical text, both cases sent for mutated text. Manager output `commit: accepted` twice, then `reject: probe.diff: 1/2 sampled cases disagree`. Stats `{ baselineRuns: 0, subjectRuns: 0, replayed: 2, delegated: 4 }`.

### What didn't work

- The hypothesis of standard-library f32 bit identity failed. Example from the reader: `x=-7.998046875`, `exp` expected `39b0390f`, GPU `39b0390e`. Switching off FMA would not fix this scalar operation. The planned relation is against f64 instead.
- No probe command failed. The math fetch printed `tar: ./grid.bin: time stamp 2026-11-26 15:12:54 is 0.278453013 s in the future` (and similar directory mtime notices). Exit, byte length, digest and decoded results were checked; mtimes are not part of the evidence key.

### What I learned

The largest measured fraction of stage 1's `2e-6 + 2e-5*abs(r)` budget was 0.0210662 (rounded up), on the seven-term signed dot rather than any single intrinsic. This measures a sampled regime only. `baselineKey` caches the *cases* across delegated checks; the local baseline-outcomes array isn't filled by `decide`. Storing small reference outcomes with their origin-derived cases avoids rerunning the evaluator. `AnalysisManager` accepts a text port without a fake CUDA graph schema.

### What was tricky to build

The experiment must separate `Math.fround` after every operation (for the bit comparison) from Node double evaluation (for the budget). Comparing final GPU words only to rounded f64 for a composite expression would incorrectly count expected intermediate roundoffs as intrinsic discrepancies. The reader computes both paths. Similarly an origin f32 comparison after `split-sum` would measure an authorized prior change along with lowering error.

### What warrants a second pair of eyes

Review the finite-reference domain and choice of original f64 baseline, the limited framework change for a mandatory batch decider, and whether the tool identity check and per-job output separation justify their cost. The design separates inspect/execute from *accept*: the asynchronous transformation postcondition must see the very C text it claims to check. Watch that invariant in mutant tests.

### What should be done in the future

Wait for review **before** editing source. After review implement the approved ledger, run offline and GPU tests separately, measure all six full-size GPU/CPU pairs, and record actual changes and their reasons against the design. No performance evidence yet.

### Code review instructions

Start with [the design](../design-doc/01-lowering-tix-statements-to-cuda-with-a-batched-gpu-meaning-check.md), especially its two change ledgers. Compare the `decide` and `prepare` paths in `src/framework/contracts/differential.ts` with the contract probe, and the per-hash cwd/compile command in `tools/cuda-remote.mjs` with the proposed tool changes. Re-run the four small scripts with the commands above if needed.

### Technical details

No production source, existing tool, tests or corpus files changed at this checkpoint. The design gives the supported input domain, marshalling, expression/loop mapping, cache keys, case/evidence protocol, failure tests and scoped benchmark plan.
