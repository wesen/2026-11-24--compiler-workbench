---
Title: Implementation diary
Ticket: IRWB-022-I
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-022-I--lowering-tix-to-cuda-with-checked-execution-on-the-gpu-machine/scripts/01-fp-probe.mjs
      Note: Recreates inputs and compares GB10 results
    - Path: repo://ttmp/2026/11/26/IRWB-022-I--lowering-tix-to-cuda-with-checked-execution-on-the-gpu-machine/scripts/02-contract-probe.mjs
      Note: Exercises existing cross-kind async contract execution
    - Path: repo://ttmp/2026/11/26/IRWB-022-I--lowering-tix-to-cuda-with-checked-execution-on-the-gpu-machine/scripts/fp-probe/main.cu
      Note: Handwritten arithmetic and dot-product witnesses
ExternalSources: []
Summary: Stage 2 design checkpoint, CUDA and framework probe evidence, and reviewer handoff.
LastUpdated: 2026-11-26T15:11:53.44490389-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1. Design checkpoint and GB10 probes

I read the Stage 1 design and final report, then traced the evaluator, generated reduction bounds, pass runner and tool. I used two small replays to check the main design choices. One executes an async cross-kind framework transformation, and the other compares GB10 arithmetic with Node and actual Stage 1 reductions.

The [design](../design-doc/01-checked-tix-to-cuda-lowering.md) proposes direct CUDA emission and a checked transformation with one remote batch per sampled function. The worktree at entry was `1880fc4` on `t2-sh/irwb-022-i`.

### Prompt context

<details>
<summary>User prompt, verbatim</summary>

You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`). Stage 1 built its front end, IR, f32 and f64 evaluators, a meaning contract and two checked passes. Its design and its final report are in ticket IRWB-020-B under `ttmp/2026/11/26/`. Read them first.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-022-I. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-022-I:`. Do not push.
- Final message: the ticket and design paths, the framework and tool changes you propose, the relation you chose for the lowering and the probe that established it, the commit hash.
Your ticket ID is IRWB-022-I. Name the ticket after the stage-2 work (lowering Tix to CUDA, checked, on the GPU machine).

</details>

The implementation, timing runs and report follow the review. The design turn needs executable evidence for the relation and framework decision.

### Work and rationale

- Read the Stage 1 [design](../../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-semantics-and-checked-tensor-rewrites.md) and [report](../../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/02-report.md). Generated uses of `blocks` and `tail` made grouping preservation a backend requirement.
- Exercised the existing heterogeneous transformation with two artifact kinds, a read-only resource and an actual async invariant. Used the same manager to reject a replacement output. The result favored the contract API over extending the same-IR edit runner.
- Compiled and ran a standalone numerical probe through the existing CUDA tool. The GPU received actual f32 words, and the Node harness compared the returned raw f32 words before interpreting numerical deviations.

### Results and recovery

- `npm ls --depth=0` initially reported `ELSPROBLEMS` and four missing dependencies in the fresh worktree. `npm ci --cache /tmp/irwb-022-i-npm-cache --no-audit --no-fund` installed them, then `npm run build` succeeded. The three explicit Stage 1 tensor test files passed all 16 tests. The optional esbuild postinstall warning did not affect the TypeScript build.
- `node <ticket>/scripts/02-contract-probe.mjs` printed `Async cross-kind check accepted, mutant rejected, repeat re-evaluated the invariant`. Repeating the transformation called the invariant again, so evidence reuse belongs inside the domain check.
- `node <ticket>/scripts/01-fp-probe.mjs` compiled and ran via the default tool on GB10 sm_121, nvcc 13.0.88, reported driver API version 13000. The probe's remote nvcc version query also reported compiler build `36424714_0`. The design records the operation counts. Sequential and split variants matched all eight CPU f32 words and spent at most 1.38% of the proposed f64 tolerance. NaN encodings differed even when both results were NaN.
- A local `flock` probe using two acquisitions on one temporary lockfile succeeded for shared/shared and correctly blocked exclusive/shared. The new runner semantics still need an integration test on GB10.

- The sandboxed `git add -- <ticket>` failed to create the worktree Git index lock with `Read-only file system`. Repeating that scoped staging command with escalation succeeded. The staged diff contains only the ticket and its probes.

### Experiment identity

The GPU run used the tool's `nvcc -O3 -arch=sm_121` and Node 24.18.0. The sample stream is xorshift32 seeded with `0x20c0ffee` plus the fixed witnesses in the replay. Remote job hash `72700c930da364c2` reported `compiled: true` and `exit: 0`. The digests cover the exact raw input and GPU output. A second replay reported `compiled: false` for the same job and returned the identical digest and comparison results. It exercised the existing identical-input compile cache.

| Bytes | SHA-256 |
| --- | --- |
| `inputs.bin` | `747aec57f583162148d95bf94ac449d0fb020445f12c90743f407dcae380547a` |
| `out/outputs.bin` | `5703980963e26aab99d9923a4fc381de65ead61ba503dd4eb2ee248efc3de6aa` |

### Review and continuation

Review the finite f64 budget and nonfinite rule, the exact revision of the candidate source used for checks, and the separation between a shared compiled binary and a run directory. The probe covered arithmetic and reduction grouping. GPU launcher behavior, runner changes, corpus cases and performance measurements remain for implementation after review.

## Step 2. Incorporate design review

The reviewer pointed out that the differential invariant already delegates a batch and reuses decided verdicts. I switched the design to that path, cut the redundant tensor memo and its resource and identity plumbing, and retained the tool’s existing timed-only GPU lock. I also verified the reviewer’s lazy-loading observation on the GB10.

### Prompt context

The review in this session asks for the design revision and commit, followed by implementation, focused verification, and the corpus measurements. It calls for the framework’s `decide`, `baselineKey` and `subjectKey`, for preloading kernels before public timing, and for keeping the index and tail mutants.

### Evidence and decisions

- An inline Node probe used `differential` and `AnalysisManager.checkInvariant` with three cases and two subject keys. Four checks generated cases once and delegated two batches of three. Both true and false verdicts replayed. The Node little-endian unsigned 64-bit read/write round trip also passed.
- The CUDA launch timing probe ran through `tools/cuda-remote.mjs <probe-dir> --timed`. GB10 event intervals were 0.060768 ms for a cold launch, 0.003584 ms for its repeat, and 0.003360 ms for the first launch of a second kernel after `cudaFuncGetAttributes`. Generated code will preload each launched kernel before the event interval.
- The revised design uses the differential memo's existing lifetime and accepts duplicate concurrent cold checks. The remote per-invocation directory and compile lock handle those concurrent requests.

## Step 3. Implement the CUDA backend and remote runner

The emitter now turns the selected current Tix function into a standalone translation unit. Its expression walk generates one guarded row-major kernel per definition, evaluates affine indexing separately from f32 operations, and preserves both ordinary and split reduction folds. Generated code preloads each nonempty launch's kernel before recording CUDA events. The TypeScript wrapper uses a versioned batch file and a new local working directory for each call.

### Implementation and framework findings

- `src/tensor/cuda-source.ts` emits CUDA helpers, kernels, and the batch host program. `cuda-runtime.ts` encodes and decodes requests and invokes the remote tool asynchronously. `cuda-contract.ts` defines the heterogeneous pass and delegates via the existing differential invariant.
- `src/tensor/contract.ts` shares the Stage 1 sampling recipe with the new check. CUDA includes empty shape assignments and keeps nonfinite f64 observations for classification. The Stage 1 optimizer's original recipe is unchanged.
- `tools/cuda-remote.mjs` now accepts repeatable runtime-only files, uploads each job to a unique remote directory, and installs and links cached binaries under a compile lock. It propagates copy and fetch errors. The GPU lock is still specific to timed runs. No framework file changed.

### Validation in progress

The first standalone API smoke command raced the TypeScript build and imported the prior `dist` output. Node reported that `checkLowering` was missing. The build then completed, the export was present, and the focused test run started from the rebuilt output. The arithmetic replay also ran successfully through the revised remote tool.

### Validation results

- `npm run build` succeeded. `node --test tests/tensor/*.test.mjs` passed all 29 tests, including ten GB10 tests. All six corpus functions passed before and after their Stage 1 pass sequence. The same contract rejected the CUDA transposed-index and truncated-tail candidates.
- The remote runner test issued simultaneous jobs with different runtime bytes and one build key. Exactly one compiled, both got their own responses, and a header change produced a new build key and output.
- A final packet-allocation adjustment sizes f32 payloads from the number of four-byte words actually written. The subsequent build and the four network-free tensor test files passed all 19 tests. Full-size CPU and GPU runs use the same input recipe and run separately.

## Step 4. Verify the committed backend and measure the corpus

The final test rerun on `be85ba9` passed all 29 tensor tests. The six GPU measurements ran separately from those tests, one `--timed` invocation per function. Each invocation warmed up once and took the median of three CUDA event intervals with the generated kernels preloaded.

The interpreter runs the same full-size input recipe. The original serial benchmark captured matmul, softmax, layernorm and attention. I stopped it after the attention record so it would not repeat the separately started MLP and conv2d measurements. The long CPU jobs use tmux and overlap on the shared host, so their figures are observed wall times. A detached sandbox tmux launch exited with the sandbox before writing a log. Keeping the invoking shell active with `tmux wait-for` allowed the final tests and the split benchmark jobs to run and report their exit status.

The [timing report](02-cuda-lowering-verification-and-corpus-timings.md) records all six CPU and GPU results and links the replay script. CPU and GPU shapes and byte digests matched on every measured case. MLP was the last interpreter job to finish and took 1,285,227.803 ms. Its median GPU kernel interval was 0.957664 ms.
