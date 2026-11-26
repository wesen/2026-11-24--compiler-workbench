---
Title: Implementation diary
Ticket: IRWB-022-E
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
    - Path: repo://ttmp/2026/11/26/IRWB-022-E--lowering-tix-to-cuda-checked-on-the-gpu-machine/scripts/01-fp-probe.cu
      Note: Hand-written CUDA experiment
    - Path: repo://ttmp/2026/11/26/IRWB-022-E--lowering-tix-to-cuda-checked-on-the-gpu-machine/scripts/02-fp-probe.mjs
      Note: Replays and compares the GB10 experiment
    - Path: repo://ttmp/2026/11/26/IRWB-022-E--lowering-tix-to-cuda-checked-on-the-gpu-machine/scripts/03-contract-probe.mjs
      Note: Replays cross-kind contract and reuse experiment
ExternalSources: []
Summary: Design checkpoint and GB10 and framework probe evidence, before implementation.
LastUpdated: 2026-11-26T15:17:00-05:00
WhatFor: Resume and review the Tix CUDA work.
WhenToUse: After the design review or when reproducing evidence.
---

# Implementation diary

## Step 1: Choose a checked emission boundary and test the floating-point relation

I read Stage 1's design and final report first. I then traced the evaluator, both rewrites, the two framework pass runners, the contract manager, and the remote tool. I used two probes to settle the review questions: one exercised the proposed CUDA primitives and sequential softmax on bling, and one exercised a batched cross-kind transformation locally. No backend implementation or corpus timing was done.

### Prompt context

**User prompt (verbatim):**

> You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
> - **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
> - **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`). Stage 1 built its front end, IR, f32 and f64 evaluators, a meaning contract and two checked passes. Its design and its final report are in ticket IRWB-020-B under `ttmp/2026/11/26/`. Read them first.
>
> The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.
>
> Your ticket is IRWB-022-E. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.
>
> ## Stage 2 (yours): lowering Tix to CUDA, checked, on the GPU machine
> - **Lower a Tix function to CUDA C:** one kernel per statement, one thread per output element, and each reduction a sequential loop in the order the f32 meaning prescribes. Choose whether the lowered form is a second v6 artifact (a kernel IR) or is emitted directly from the Tix IR, and justify the choice. Programs returned by `optimizeTix` (after `inline` or `split-sum`) must lower too.
> - **Run it on the GPU machine** through `tools/cuda-remote.mjs` (read its header). The tool:
>   - copies a directory containing `main.cu` to `manuel@bling` (an NVIDIA GB10: sm_121, CUDA 13.0, `nvcc` at `/usr/local/cuda-13.0/bin/nvcc`);
>   - compiles with `nvcc -O3 -arch=sm_121`, reusing an earlier compile of identical inputs;
>   - runs the program and copies its `out/` directory back.
>
>   You may extend the tool. Record each change and its reason.
> - **A checked lowering.** The lowering is a pass whose output must keep the stage-1 meaning. Its contract runs the candidate on the remote GPU. Decide which relation holds and establish it by probing on the GB10:
>   - either bit-identical with the f32 meaning, stating under which compiler flags and with which implementation of each operation and intrinsic;
>   - or a tolerance against the f64 reference, justified by an error argument or a measurement.
>
>   The engine is expensive, remote and asynchronous. Design how the contract batches its cases and reuses evidence, and what the framework needs for that.
> - **Measure** the kernel time on the GPU for each corpus program at the sizes below, and the time of the stage-1 f32 interpreter on this machine for the same program.
>
> | Program (`corpus/tensor/<name>/main.tix`) | Sizes, in the program's shape names |
> |---|---|
> | matmul | M = K = N = 512 |
> | softmax | N = 4096, C = 1024 |
> | layernorm | N = 4096, D = 1024 |
> | attention | Q = K = 1024, D = V = 64 |
> | mlp | N = 1024, D = 256, H = 1024, O = 256 |
> | conv2d | N = 8, C = 16, H = W = 64, O = 32 (3 × 3 kernel) |
>
> Later stages, which are not yours: fusion, tiling and shared memory, tensor cores, other thread mappings, streaming attention, autotuning. Do not design them.
>
> ## Tix, fixed core (unchanged from stage 1)
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
> - A reduction's body extends as far right as possible, to the end of the enclosing parentheses or statement.
> - Each statement defines a new tensor, assigned once. Its left-hand index names range over extents inferred from their plain (non-affine) uses on the right. An index used only in affine positions takes its extent from the statement's declared type, which is then required.
> - Reduction indices are bound by their reduction and range over extents inferred the same way. A shape name used in an expression denotes its value as a number. A function's shape names are bound by its inputs' shapes when it is called.
> - **f32 meaning:**
>   - every literal, shape value, operation and function result is rounded to f32 (`Math.fround` of the JavaScript double result);
>   - `sum` starts at 0 and `max` at −∞, and both accumulate in increasing lexicographic order of their indices, the first listed outermost, rounding after each step.
>   - Inputs are finite. Behaviour outside the valid domain (inconsistent shapes, an extent that cannot be inferred) is a check error at compile time.
> - **Three rules stage 1 settled** (the base implements them):
>   - tensor names and index names are separate: `y[x] = x[x] * 2` is valid;
>   - a reduction may rebind an index of an enclosing reduction, and the inner binding shadows the outer (`sum(j) a[i, j] + sum(j) b[i, j]` is a nested reduction);
>   - a shape value may be 0: an empty `sum` is 0 and an empty `max` is −∞.
>
> ## Fixed API (additions in `dist/tensor/index.js` after the build)
> ```ts
> cudaSource(program: TixProgram, fn: string): string
>   // the complete CUDA C translation unit for one function: its kernels and a main that reads the inputs and writes the result
> runTixCuda(program: TixProgram, fn: string,
>            inputs: Record<string, { shape: number[]; data: Float32Array }>,
>            options?: { host?: string }): Promise<{ shape: number[]; data: Float32Array; gpuMs: number }>
>   // runs on the GPU machine; gpuMs is the time of the function's kernels on the GPU (CUDA events), without transfers or start-up
> checkLowering(program: TixProgram, fn: string): Promise<{ accepted: boolean; relation: 'exact' | 'tolerance'; reason?: string }>
>   // your contract's verdict on the lowering of this function
> ```
> Stage 1's `compileTix`, `runTix` and `optimizeTix` keep their signatures and behaviour. Implementations are compared on this API. Anything beyond it is yours to design.
>
> ## Repository facts
> - Build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24 pass files, not a bare directory. Prettier: 110 columns, single quotes.
> - Read `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts` (stage 1 added `applyNativePassSync`), and `src/tensor/`.
> - Your sandbox has network access, so `ssh` to the GPU machine works from it. Run GPU work only through the tool. Other agents share the machine: use `--timed` (a lock, so that measurements do not disturb each other) only for measurements, and keep those runs short.
> - Keep the tests that need the GPU in their own test file, so that the other tests run without the network.
> - In the sandbox, a test that spawns `node` can fail with EPERM. Request escalation for that command.
> - Scope: you may change `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and `src/framework/` and `tools/cuda-remote.mjs` where the stage needs it. Record each framework and tool change in your design. Do not modify `src/typed/`, `corpus/projects/`, other tools or existing tests outside `tests/tensor/`, except framework tests that a framework change makes necessary. Do not run the full suite (`npm test`): many agents share this machine.
> - Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-022-E:`. Do not push.
> - Final message: the ticket and design paths, the framework and tool changes you propose, the relation you chose for the lowering and the probe that established it, the commit hash.
> Your ticket ID is IRWB-022-E. Name the ticket after the stage-2 work (lowering Tix to CUDA, checked, on the GPU machine).

**Assistant interpretation:** Commit the design, not backend source. Probes are evidence for design choices, not corpus timings. **Inferred user intent:** test the framework with an asynchronous, expensive cross-representation check, and surface its fit or friction explicitly.

### What I did and why

- Compared native pass preparation with `AnalysisManager.execute` and the differential invariant's delegated `decide` path. The latter gives typed input/output artifacts and acceptance without forcing an IR edit on a read-only adapter.
- Wrote the [design](../design-doc/01-direct-cuda-emission-and-batched-lowering-checks.md). It describes direct emission, origin f64 as a shared budget with `split-sum`, case batching and evidence reuse, a tool change ledger and the measurement protocol.
- Added runnable ticket-only probes. The FP probe uses ordinary CUDA libm and explicit noncontracting arithmetic intrinsics, separating the exact f32 question from the tolerance question.

### What worked

From the root at base `1880fc4`, Node v24.18.0:

```sh
base=ttmp/2026/11/26/IRWB-022-E--lowering-tix-to-cuda-checked-on-the-gpu-machine
npm ci --no-audit --no-fund
npm run build
node "$base/scripts/03-contract-probe.mjs"
node "$base/scripts/02-fp-probe.mjs"
```

The build passed. The local probe accepted the first output, replayed on a fresh manager without a second batch, and rejected a changed output with `2/2 sampled cases disagree`. On `manuel@bling`, the floating-point probe returned `exit: 0`, `compiled: true`, hash `8c1a89259c7d0e75`, nvcc 13.0.88, runtime and driver API 13000, GB10 `sm_121`. An event pair bracketing four launches returned positive finite time; this was a sanity check, not a timing result. The probe observed 2,467 exp, 721 log, 1,258 tanh, and 3,451 softmax f32 word mismatches in 8,192 per output group. The largest f64 budget fraction was `0.006548763703658809` (exp), with softmax `0.0025684429002208356`. The code prints an input and both words for the first mismatch in each group. No use of `--timed` and no corpus benchmark.

A temporary `main.cu` containing `#include <cstdlib>` and `int main() { return std::system("nvidia-smi --query-gpu=name,uuid,compute_cap,driver_version --format=csv,noheader"); }` ran via `node tools/cuda-remote.mjs "$tmpdir"`. It reported the expected GPU, UUID, compute capability 12.1, and driver 580.178.04. This supports the proposed stamp without direct SSH from the backend.

### What didn't work

Exact agreement with native f32 intrinsics was falsified (see design table). The first probe copy-back printed GNU tar's `time stamp ... is 0.473071702 s in the future` warning for `./softmax.f32`; tool exit was 0 and the driver checked the bytes. The final probe run did not print it. No source or tool bug fix was made for the warning. `npm ci` also reported its usual pending allow-scripts warning for esbuild; the TypeScript build succeeded. The first `git diff --cached --check` flagged spaces on two otherwise blank blockquote lines in this diary; stripping those spaces preserved the quoted prompt text and cleared the check.

### What I learned and what was tricky

Strict rounding at the arithmetic sites did not solve libm equivalence. At `a=0.10959365218877792`, expf differed by one word (`0x3f8ed356` vs `0x3f8ed357`). The edge outputs were `00000002 00000000 80000000 80000000 7fffffff 7f800000 3f800000 00000000 4b800000` (hex): gradual underflow, signed-zero extrema/negation, a NaN, f32 overflow, original ordered fold, non-contraction, and rounded integer shape conversion. The overflow witness has finite f64 value `4.489612819174345e+38`; tolerance cannot honestly claim all-domain equivalence to f32. The split witness also shows why a tolerance gate needs independent structure-sensitive tests: the wrong grouping can still fit its budget.

The tool's shared hash directory currently doubles as compile and execution storage. Reusing a compile across different case batches requires breaking that link. Separately, the framework's differential summary can agree with some inconclusive cases; a failed remote invocation must not turn into partial passing evidence.

### What warrants a second pair of eyes

Review whether the terminal source artifact and typed transformation boundary are sufficient as a pass, whether origin f64 is the desired budget after a rewrite, and the stamp/run-directory boundaries in the proposed tool changes.

### Next step and code review instructions

Wait for the user's design review. Start from the design's pass and tool ledgers and the two script commands above. No production code or existing tests were changed; GPU integration tests, independent structure-sensitive checks and full-size measurements belong to implementation after review.

## Step 2: Apply the design review

The review found that CUDA 13 lazy module loading could be charged to the first event interval. I accepted all review items. The design now fixes 256 threads per block and preloads kernels with `cudaFuncGetAttributes` before recording events.

### Prompt context

**User prompt (verbatim):**

> A reviewer has read your design for IRWB-022-E. The review:
>
> # Review of your design
>
> ## Must change
>
> 1. **`gpuMs` includes kernel loading.** "For each case, allocate and transfer before recording the start event." Under CUDA 13's default lazy loading, the first launch of a kernel in a process loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. A one-case `runTixCuda` therefore reports start-up, which the fixed API excludes. Say how kernels are loaded before the start event.
> 2. "using a fixed block size (e.g. 256)". Fix the number.
>
> ## Cut
>
> 1. "Add a `--describe` target stamp … Refuse to cache evidence from a different stamp", and the stamp in the subject key. The evidence is process-local, so this adds a remote query to every check.
> 2. "Use a shared GPU run lock for untimed runs". This changes the tool's documented behaviour ("untimed runs do not wait for it") for every user. The brief asks only that measurements use `--timed`.
> 3. "use an in-process single-flight map keyed by full check identity". No caller of the fixed API needs this.
> 4. "Check full-size outputs against current f32 and, for evidence about tolerance, origin f64". These are extra full-size f64 interpreter runs, beyond the timing table. The tolerance concerns the sampled cases.
>
> ## Framework and tool changes
>
> - No framework change: correct. Cross-kind `defineTransformation` with `execute`, `decide`, `baselineKey` and `subjectKey` covers the check.
> - A runtime-data directory kept out of the compile key: needed, minimal, opt-in.
> - Isolated invocation directory, build lock and atomic publication: needed once the data leaves the key.
> - `--describe` and the shared lock: not needed.
>
> ## Keep
>
> Keep the origin f64 reference with the unchanged stage-1 budget. It has margin: on the stage-1 tolerance cases, the f32 meaning of every corpus program, original and optimized, uses at most 25% of it (my local check). Also keep the single `decide` batch with the references precomputed in the cases, and keep aborting a failed batch without memoizing any verdict.
>
> Now do the following in this session:
> 1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
> 2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-E:`, and keep the diary at each significant step.
> 3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
> 4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.

**Interpretation:** Implement the reviewed CUDA stage (Stage 2), preserving the Stage 1 API and behavior.

### Decision and review instructions

The review's event probe was sufficient to change the timing boundary; the generated CUDA will exercise this path in integration tests. Removed remote stamp queries, shared untimed locks, single-flight and extra full-size interpreter validation. Kept process-local evidence and origin f64, and retained per-run isolation and build serialization. See the revised design; no code changed in this checkpoint.

## Step 3: Implement direct emission, isolated execution and the checked pass

I implemented the three CUDA entry points over one emitter, with no edits to `src/framework/`. Preloads and event setup happen before timing in the emitted host code. The optional benchmark mode uses the same kernels and allocates and uploads only once for one warm-up and five timed repetitions.

### Prompt context

See Step 2. Design revision commit: `dc87f19`.

### What I did

- Added `cuda-emit.ts` for one kernel per statement, device-side affine indexing with unsigned arithmetic, checked host dimension arithmetic, and the case/result ABI. The ABI groups a case's dimensions before its payloads, so its shape can be validated before copying data.
- Added `cuda-run.ts` for the versioned binary frames and asynchronous remote dispatch. The runner uses a private local directory and does not read a result unless the child reports success.
- Added `cuda-pass.ts` for the terminal source artifact and sampled, batched invariant. Stable case references are computed once per origin/function memo entry. A changed source revision misses the memo; an incomplete/failed batch rejects without supplying verdicts. The Stage-1 contract now shares the stream values and numerical allowance without changing its samples or comparator behavior.
- Added `--runtime-dir` to `tools/cuda-remote.mjs`, a private remote run directory, and locked atomic executable install. The build key includes the real nvcc version; `--timed` is unchanged. Fetch errors are failures rather than silently leaving a usable old `out/`.
- Added offline and GPU tests, and the corpus benchmark driver at `corpus/tensor/benchmark-cuda.mjs`.

### Initial checks and fixes

- The modified tool successfully reran `scripts/02-fp-probe.mjs`, reproducing the design's numerical results.
- Initial `npm run build` attempts hit the 15 s and 60 s command limits on the shared host. The uninterrupted run exposed `TS2304: Cannot find name 'EOF'` in `cuda-pass.ts` (stray delimiter) and `TS2345` at `cuda-run.ts:87` (inferred `Buffer<ArrayBuffer>[]` could not accept a `Buffer<ArrayBufferLike>` from a typed-array view). Removed the delimiter and explicitly typed the chunks as `Buffer[]`; `npm run build` then passed.
- The first `node --test tests/tensor/*.test.mjs` hit `ReferenceError: EOF is not defined` loading each new test file; removed their stray delimiters too. The 16 preexisting tensor tests passed on that attempt. See the verification checkpoint next for the rerun.

### Review instructions

Start at `src/tensor/index.ts` for the fixed API and `src/tensor/cuda-pass.ts` for the actual acceptance path. The GPU falsifier alters just the emitted ceiling bound, so it still exercises the real cross-kind postcondition. The independent seven-element split witness detects changes the f64 tolerance alone would not notice.

## Step 4: Verify and measure the implementation

Backend commit: `aa14d97`. The corrected `node --test tests/tensor/*.test.mjs` run completed with 24 passed, 0 failed, including five GPU tests. The entire run took about 280 seconds on the shared hosts. No framework source changed, so the additional framework and Typed suites were not run.

`node corpus/tensor/benchmark-cuda.mjs` exited 0 on all six programs. The slow part was the unmodified local interpreter, not the locked GPU intervals. GPU medians ranged from 0.171 to 0.976 ms; local interpreter wall times ranged from 44 to 962 seconds under shared-host load. The [verification and timings report](./02-cuda-verification-and-corpus-timings.md) gives the individual results, ranges, command, environment and caveats. No full-size f64 or additional interpreter correctness run was performed.

The as-built ABI groups all dimensions before data, and `--benchmark` fixes five measured iterations after a warm-up. The design now spells out both details; there are no other deviations from the reviewed design.
