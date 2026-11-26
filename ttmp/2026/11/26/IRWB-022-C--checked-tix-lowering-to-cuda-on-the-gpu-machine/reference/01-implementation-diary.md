---
Title: Implementation diary
Ticket: IRWB-022-C
Status: active
Topics:
    - compiler
    - ir
    - verification
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-022-C--checked-tix-lowering-to-cuda-on-the-gpu-machine/scripts/01-probe-gb10-math.mjs
      Note: GB10 arithmetic and event evidence
    - Path: repo://ttmp/2026/11/26/IRWB-022-C--checked-tix-lowering-to-cuda-on-the-gpu-machine/scripts/02-probe-contract.mjs
      Note: Framework async batch and reuse evidence
ExternalSources: []
Summary: Chronological design, GPU probes, review, and implementation checkpoints.
LastUpdated: 2026-11-26T15:12:26.293173225-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1: Probe the GPU and the contract boundary before designing the lowering

I read the stage-1 design and final report first, then the tensor implementation, framework IR/contract docs and pass runner, the corpus, and the CUDA tool. Two questions determined the design: whether ordinary CUDA operations already matched the interpreter, and whether a remote guarantee required changing the framework. I ran standalone probes for both; no backend implementation or workload benchmark has started.

### Prompt context

**User prompt (verbatim):**

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`). Stage 1 built its front end, IR, f32 and f64 evaluators, a meaning contract and two checked passes. Its design and its final report are in ticket IRWB-020-B under `ttmp/2026/11/26/`. Read them first.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-022-C. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-022-C:`. Do not push.
- Final message: the ticket and design paths, the framework and tool changes you propose, the relation you chose for the lowering and the probe that established it, the commit hash.
Your ticket ID is IRWB-022-C. Name the ticket after the stage-2 work (lowering Tix to CUDA, checked, on the GPU machine).
````

**Interpretation:** Stop after a design commit. Use probes to answer design questions now; implement, test the backend, and collect the six benchmark results after review. Base revision: `1880fc4`.

### What I did and why

- `docmgr ticket create-ticket` and `docmgr doc add` established the design and diary. Read the stage-1 sample policy and the produced `blocks`/`tail` bounds. The input to codegen and to the reference must be `current`, rather than `origin`; using the origin would charge CUDA for a legitimate split-sum reassociation.
- Wrote [01-probe-gb10-math.mjs](../scripts/01-probe-gb10-math.mjs) to test numeric options under the actual tool's flags and to check CUDA event calls. It makes a temporary `main.cu` and binary input; it is not a lowering implementation.
- Wrote [02-probe-contract.mjs](../scripts/02-probe-contract.mjs) to exercise an async child process, a revisioned read, batched verdict reuse, and rejection of differently supplied output through the existing contract manager. This avoids proposing a generic cross-IR graph runner without evidence of need.
- The remote tool currently conflates build identity and working directory. Pure source caching is useful for batching only if runs also get independent directories and concurrent compilation is safe; proposed both changes together, leaving the default cache policy intact.

### Evidence

- `npm run build` passed on Node 24.18.0.
- `p=$(find ttmp/2026/11/26 -path '*IRWB-022-C*/scripts/01-probe-gb10-math.mjs'); node "$p"` passed on `manuel@bling` (GB10, nvcc 13.0.88, CUDA 13.0). The event-enabled run hash was `9c45bcb28076192b`. Over 98,181 input words per operation, float exp/log/tanh differed from the interpreter rounding 19,304 / 2,275 / 2,210 times; the widened versions and widened sqrt had zero sampled mismatches up to NaN class. The worst finite error for any widened intrinsic was 0.002973 of the proposed f64 tolerance. FMA and non-FMA gave different words on the witness, and separate rounded operations retained subnormals. The return words, input generator and flag details are in the probe and [design](../design-doc/01-checked-tix-to-cuda-lowering.md). This supports a tolerance, not a portable exact relation.
- `p=$(find ttmp/2026/11/26 -path '*IRWB-022-C*/scripts/02-probe-contract.mjs'); node "$p"` produced accepted, accepted, rejected, with two async batches, two verdicts replayed and four delegated. A local `flock` + temporary-file `mv` smoke test succeeded. No `--timed` runs, backend tests or full suite ran in the design phase.

### What didn't work

The first file-based invocation of `02-probe-contract.mjs` failed with `ERR_MODULE_NOT_FOUND`: the import resolved to `ttmp/dist/framework/contracts/index.js`. The original inline probe (run from the root) had passed. Corrected the relative import to ascend from the script past `ttmp` and reran the saved probe successfully.

### What was tricky and what needs review

- The existing graph pass runner is same-representation; the existing semantic transformation runner isn't. A typed source port plus an async postcondition fits without another adapter or framework change. The contract's timing-independent evidence and the tool's compiled-binary cache are separate mechanisms.
- An f64 tolerance can miss small reorderings even though the emitter must preserve the f32 loop order. Review the tolerance's limits and the plan for independent exact rounding/order witnesses, including `split-sum` tails and empty reductions.
- Review the engine stability assumption for process-local verdict replay and how isolated run directories interact with compile and timed locks. No evidence from the design probes establishes correctness of those future tool edits.

### Resume after review

Start at the [design](../design-doc/01-checked-tix-to-cuda-lowering.md) and [tasks](../tasks.md). Build the direct emitter and ABI before connecting the transport and semantic gate. Run the documented focused tests and then measure the six required unoptimized corpus cases. Await the review before any stage-2 implementation.

## Step 2: Review resolved the timing boundary and removed unused caching machinery

The reviewer approved direct CUDA emission and both proposed tool edits. Their timing probe showed why allocation and input transfer alone were insufficient: the first launch included lazy module loading. I adopted all review changes. No implementation changes are in this checkpoint.

**User review and request (verbatim):**

```text
A reviewer has read your design for IRWB-022-C. The review:

# Review of your design

## Must change

1. **`gpuMs` includes kernel loading, and the warm-up is unspecified.** "Allocate buffers and copy inputs before recording a start event", and for the benchmark, "Run one warmup and a few repeats". Under CUDA 13's default lazy loading, the first launch of each kernel in a process loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. A one-case `runTixCuda` therefore reports start-up, which the fixed API excludes. Load the kernels before the start event, run the warm-up in the same process as the repeats, and fix "a few".
2. "one 1D launch of fixed blocks (e.g. 128 threads)". Fix the number.

## Cut

1. "a versioned read-only engine profile (`MemoryResources`, declared read in the invariant and transformation)". The `subjectKey` already carries these values. The resource adds effect declarations, and nothing ever writes a new revision of it.
2. "A small in-flight map keyed by the same complete pass identity shares concurrent identical checks". No caller of the fixed API needs this.

## Framework and tool changes

- No framework change: correct. Scalar ports with `execute`, `decide`, and `baselineKey`/`subjectKey` cover the batch and the replay.
- Opt-in `--cache-main`, which hashes the source apart from the case data: needed, minimal, correctly placed, and the default mode is kept.
- Per-invocation directory with a build lock and publication by rename: needed once the data leaves the key.
- No change missed.

## Keep

Keep the CUDA double `exp`/`log`/`tanh` and `__dsqrt_rn`, each rounded once, and the error argument for the budget ("about 336 f32 unit roundoffs"). Also keep comparing against the immediate revision with the f32 secondary oracle for nonfinite and zero-sign cases, and the separate exact witnesses for order and FMA.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-C:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
```

**Revision:** Fix 128 threads and call checked `cudaFuncGetAttributes` for every generated kernel outside the event span. Benchmark one warm-up and five recorded repeats in the same CUDA process with the same buffers, and one recorded interpreter run given the size of the workloads. Include the host and tool configuration in `subjectKey` directly. Keep process-local replay, without coalescing concurrent cold checks. `git diff --check` and the Docmgr review task update passed. Implementation now follows the reviewed design.
