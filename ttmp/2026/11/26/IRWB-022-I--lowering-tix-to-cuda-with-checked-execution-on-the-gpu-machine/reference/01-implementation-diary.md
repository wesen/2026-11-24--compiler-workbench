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

## Step 5. Diagnose the independent evaluation and publish the report

I traced the independent results at `dd8b7b6` to the two precision paths. All reported E2E outputs agree with the corresponding f32 interpreter. The nonzero differences were comparisons with f64. I added a replay for the rounding sites on small inputs to the actual corpus IR and ran one untimed GB10 case to check the NaN representation through the generated kernel.

### Prompt context

<details>
<summary>User prompt, verbatim</summary>

Stage 2 of IRWB-022-I has been evaluated independently, at your last commit. Your results:

- **Stage-1 hidden suite:** 25/25 passed. The three API functions are exported.
- **Corpus programs, small sizes, through `runTixCuda`:**
  - matmul: 35/35 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 3.2e-7
  - softmax: 76/76 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 5.3e-8
  - layernorm: 72/72 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 1.3e-7
  - attention: 72/72 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 6.6e-8
  - mlp: 24/24 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 3.6e-7
  - conv: 160/160 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 3.1e-7
- **After `optimizeTix(p, ['inline', 'split-sum'])`, compared with your own f32 run of the optimized program:**
  - matmul: 35/35 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 2.2e-7
  - softmax: 76/76 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 4.9e-8
  - attention: 72/72 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 6.0e-8
  - mlp: 24/24 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 4.6e-7
- **20 random programs from the fixed core:** 20/20 bit-identical to the f32 meaning on every element; largest difference 0.
- **Corpus at the brief's sizes:**
  - matmul: 262144/262144 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 0.197
  - softmax: 4194304/4194304 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 0.785
  - layernorm: 4194304/4194304 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 0.563
  - attention: 65536/65536 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 1.810
  - mlp: 262144/262144 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 1.051
  - conv: 984064/984064 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 0.341
- **`checkLowering` on the six corpus programs and ten random ones:** accepted 16/16, relation tolerance, 2.5 s per check on average.
- **Independently of your work,** the coordinator compared CUDA's double-precision `exp`, `log` and `tanh`, rounded to f32 (`__double2float_rn(exp((double)x))` and so on), with the f32 meaning's `Math.fround(Math.exp(x))` and so on, for all 2³² f32 inputs on the GB10. They agree on every input, with NaN compared as a class. In IEEE mode, `+ − * /` and `sqrtf` are correctly rounded, and the f32 meaning rounds each of them in the same way.

In this turn, do not change any code under `src/`, `tests/`, `corpus/` or `tools/`. The evaluated revision must stay as it is.

1. **Diagnose.** For every result above that is not bit-identical, find which operation in your emitted code causes the difference and state it with `file:line` in your diary. Reproduce it with a short script or GPU probe in your ticket's `scripts/` if that helps; keep GPU runs few and untimed. Then state, in one paragraph, whether the relation your contract checks is the strongest one your implementation and the evidence above support, and why.
2. **Write your final report** as `reference/02-report.md` in your ticket. It is for a reader who knows compilers but not this repository, and it will be published as written. Cover:
   - the lowering and the emitted CUDA (with a short excerpt);
   - the form you chose (kernel IR or direct emission) and why;
   - the contract: relation, cases, batching and reuse, and the probe behind the relation;
   - each framework and tool change and why it was needed;
   - the timing method and the measured times;
   - how you checked the work;
   - the evaluation results above, including every difference and its cause;
   - what you would do differently.

   Write prose first, with at least one diagram (Mermaid). Aim for 2,000 to 3,500 words. Report only what you built and measured.
3. **Commit** (message starting `IRWB-022-I:`). Final message: the report's path, the commit hash, one line per difference cause, and your one-paragraph answer on the relation.

</details>

### Operation-level diagnosis

The f32 interpreter rounds literals, scalar operations and fold steps at `src/tensor/evaluate.ts:65`, `src/tensor/evaluate.ts:80` and `src/tensor/evaluate.ts:85`. Its f64 mode omits those f32 rounding steps. Every nonzero reported gap is already present between these two precision paths, because CUDA matched the f32 outputs. The independent report provides aggregate maximums without the input values, worst coordinates or intermediate traces. The locations below identify reachable rounding sites and the operation isolated on a different, reproducible input for each comparison.

| Independent comparison | Largest f64 gap | Emitted rounding sites and reproduced difference |
| --- | ---: | --- |
| Original matmul | 3.2e-7 | `src/tensor/cuda-source.ts:195` rounds each product and `src/tensor/cuda-source.ts:231` rounds the row sum. A single `(1 + 2^-23) * (1 - 2^-23)` isolates the multiply, with f32 result 1 and f64 result `1 - 2^-46`. |
| Original softmax | 5.3e-8 | `src/tensor/cuda-source.ts:193` rounds the shift, `src/tensor/cuda-source.ts:205` rounds the exponential, `src/tensor/cuda-source.ts:231` rounds the denominator fold, and `src/tensor/cuda-source.ts:197` rounds division. For logits `[0,-1]`, the first gap is at the exponential, 0.3678794503211975 versus 0.36787944117144233. |
| Original layernorm | 1.3e-7 | `src/tensor/cuda-source.ts:193`, `src/tensor/cuda-source.ts:195`, `src/tensor/cuda-source.ts:231` and `src/tensor/cuda-source.ts:197` round the centering, products, reductions and divisions. The `variance + eps` addition and final scale and shift also round. With mean and variance exactly one and epsilon one, `src/tensor/cuda-source.ts:201` is the first differing step. It rounds sqrt(2) to 1.4142135381698608, versus the f64 root 1.4142135623730951. |
| Original attention | 6.6e-8 | `src/tensor/cuda-source.ts:195` and `src/tensor/cuda-source.ts:231` round both contractions. Score scaling uses `src/tensor/cuda-source.ts:201` and `src/tensor/cuda-source.ts:197`. The softmax has the same sites as above. Feature width one and scores 1 and 0 isolate the first gap at `src/tensor/cuda-source.ts:205`, which rounds exp(-1). |
| Original mlp | 3.6e-7 | `src/tensor/cuda-source.ts:195`, `src/tensor/cuda-source.ts:231` and `src/tensor/cuda-source.ts:191` round the dense products, folds and biases. In GELU, `src/tensor/cuda-source.ts:124` rounds constants, scalar arithmetic rounds, and `src/tensor/cuda-source.ts:205` rounds tanh. An exact dense input of one exposes 0.79788456 becoming 0.7978845834732056 before the activation arithmetic. The final activation is 0.8411920070648193 in f32 versus 0.8411919903841787 in f64. |
| Original conv2d | 3.1e-7 | `src/tensor/cuda-source.ts:195` and `src/tensor/cuda-source.ts:231` round products and each step of the channel and spatial fold. A single nonzero tap isolates the same `1 - 2^-46` product rounding as matmul. |
| Optimized matmul | 2.2e-7 | `src/tensor/cuda-source.ts:231` rounds both levels of the split fold. The seven-term witness first differs at the outer addition of 1 and `3 * 2^-24`. The result is 1.000000238418579 in f32 and 1.0000001788139343 in f64. Product rounding remains reachable at `src/tensor/cuda-source.ts:195`. |
| Optimized softmax | 4.9e-8 | `src/tensor/cuda-source.ts:231` now rounds the two denominator folds. The shifted exponential at `src/tensor/cuda-source.ts:205` is still the first differing step on the two-logit witness, and normalization at `src/tensor/cuda-source.ts:197` rounds again. |
| Optimized attention | 6.0e-8 | The score, denominator and value folds at `src/tensor/cuda-source.ts:231` have the split grouping. The inlined weighting division still uses `src/tensor/cuda-source.ts:197`. The width-one witness still first differs at the exponential conversion at `src/tensor/cuda-source.ts:205`. |
| Optimized mlp | 4.6e-7 | The inlined GELU still rounds its literals at `src/tensor/cuda-source.ts:124`, its arithmetic and its tanh at `src/tensor/cuda-source.ts:205`. Dense sums round in both levels at `src/tensor/cuda-source.ts:231`. The single-activation witness isolates the same GELU difference as the original. |

The independent comparison treated NaNs as a class in its intrinsic sweep. In a separate API witness, `src/tensor/cuda-source.ts:201` emitted `__fsqrt_rn` for an input of `-2^-149`. The CPU and GPU returned NaNs with words `0xffc00000` and `0x7fffffff`, respectively. Square root of negative zero and positive zero returned the corresponding zero words on both sides.

### Relation supported by this evidence

The implemented sampled f64 tolerance is weaker as a claim about preservation of the Tix f32 calculation. The coordinator's exhaustive rounded transcendental comparison, the correctly rounded IEEE arithmetic and square root, the emitted rounding sites, and the whole-program comparisons together support checking output shape and exact f32 words where the output is numeric, including signed zeros and infinities, with NaNs compared by class. The generated square-root replay rules out strict NaN word equality. Comparing to the current f32 tree would enforce its actual roundings and fold order, while the existing f64 budget measures numerical accuracy across precisions and can accept a different f32 result or reject a correct f32 result with a large f64 gap. That stronger sampled relation is a recommendation for a subsequent revision.

### Replay and scope

`npm run build` succeeded. `node <ticket>/scripts/04-rounding-witnesses.mjs --nan-gpu` passed ten CPU corpus witnesses and the single untimed GPU probe above. The new [publication report](02-report.md) records the independent evaluation separately from our measurements. The evaluated source, tests, corpus and tools were preserved at `dd8b7b6`.
