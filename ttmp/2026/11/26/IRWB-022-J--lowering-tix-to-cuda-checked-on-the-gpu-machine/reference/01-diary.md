---
Title: Diary
Ticket: IRWB-022-J
Status: active
Topics:
    - compiler
    - ir
    - verification
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T15:11:53.886572161-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1 — Design the checked CUDA lowering

I read the Stage 1 notes and traced the executable Tix revision, the pass runners and the differential
checker. I then used the remote tool to test the arithmetic choices and used the built framework to
test the asynchronous transformation boundary. The design is ready for review before implementation.

### Prompt context

The request below is reproduced verbatim.

<details>
<summary>Stage 2 request</summary>

You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`). Stage 1 built its front end, IR, f32 and f64 evaluators, a meaning contract and two checked passes. Its design and its final report are in ticket IRWB-020-B under `ttmp/2026/11/26/`. Read them first.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-022-J. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-022-J:`. Do not push.
- Final message: the ticket and design paths, the framework and tool changes you propose, the relation you chose for the lowering and the probe that established it, the commit hash.
Your ticket ID is IRWB-022-J. Name the ticket after the stage-2 work (lowering Tix to CUDA, checked, on the GPU machine).

</details>

### What I did and why

- Compared the homogeneous `definePass` runners with the mixed-port `defineTransformation` path. The
  latter checks generated text directly, so the CUDA backend needs neither an extra IR nor a framework edit.
- Ran a standalone operation probe and an ordered reduction through the existing tool. I added a
  cancellation example after seeing that exact f32 agreement on the initial ordinary operations did
  little to test where a fixed f64 envelope breaks down.
- Designed a policy that uses the f64 tolerance on coordinates where CPU f32 fits comfortably inside it,
  and retains an f32 obligation on the remaining coordinates.

### Results and limitations

- `npm run build` passed with Node v24.18.0.
- A Node module probe used `AnalysisManager.execute` with a real Tix artifact, a scalar CUDA-text port and
  an asynchronous `decide` hook. Applying the same source twice then a changed source returned two
  successes, two delegate calls total and the rejection `probe.cuda-check: 2/2 sampled cases disagree`.
- The [GB10 probe](../scripts/02-probe-numerics.mjs) compiled and ran successfully. It showed agreement
  for all probed non-NaN f32 words, an observed `log(-1)` NaN word mismatch and the expected cancellation
  difference against f64. An identical replay hit the compile cache and reproduced all numeric observations.
  The executable reported sm_121, CUDA runtime 13.0 and a positive CUDA event interval. The design records the build hash, sample size and error ratios.
- No tool or framework code was changed. The arithmetic probe covers operations and witnesses. Full
  generated-program verification and the six requested workload timings follow implementation.

The initial `git add -- "$ticket"` attempt failed because the sandbox mounted the worktree index
read-only (`index.lock: Read-only file system`). Staging and committing require the escalated Git command.

### Review focus and resume point

Review the baseline choice, when the f64 comparison applies, and whether the proposed tool cache
and invocation isolation are sufficient. Read the [design](../design-doc/01-checked-tix-to-cuda-lowering.md)
and [task list](../tasks.md) before resuming implementation. Replay the numeric probe from the
worktree root with `node <ticket>/scripts/02-probe-numerics.mjs`.

## Step 2 — Incorporate design review

The review clarified the numerical rule boundary and identified CUDA lazy loading inside the first timed
interval. Rule 2 now covers exactly the complement of rule 1. The host harness will call
`cudaFuncGetAttributes` before events even for a one-shot run. The design uses the review’s GB10
measurement as the initial probe and will verify the actual generated path during implementation.

I adopted all three scope cuts. Untimed runs retain their documented lock behavior, completed verdicts
use the existing cache without coalescing in-flight checks, and the full-size benchmark compares timings
without requiring a second reference precision. The Stage 1 revision and replayable GB10 arithmetic probe
remain the starting evidence. See the design for the revised implementation boundary.

## Step 3 — Implement and exercise the CUDA path

The tensor entry point now exports the three fixed CUDA APIs. The emitter walks the current function,
uses one device kernel per statement and keeps the loop tree for nested, multi-axis and split reductions.
The generated host harness preloads active kernels with `cudaFuncGetAttributes`, submits work to one stream
and reads binary f32 results without losing signed zeros. The Stage 1 case generator is shared by the
CUDA contract without changing the synchronous optimizer's case order or RNG streams.

The checked lowering uses the existing v6 transformation and differential APIs. Each cache miss delegates
one batch. The optional standalone-source cache in the remote tool separates nvcc identity from runtime
data, serializes competing builds and uses a private run directory per invocation. Only the measurement
caller takes the GPU lock.

### Validation

- Installed the repository's declared dependencies with `npm ci --no-audit --no-fund`. The Node 24
  little-endian word probe preserved the sign of zero and `npm run build` passed.
- `node --test tests/tensor/*.test.mjs` passed all 31 tests in the first run. The six corpus contracts
  agreed on GB10. The changed-read mutant failed its real remote-backed postcondition. Ordered and split
  reductions produced their expected distinct result words.
- The two additional remote transport cases passed when run by name. Distinct payloads sent concurrently
  with the same source compiled once and returned separate outputs. An executable that removed its output
  directory produced a fetch-phase failure.
- The targeted Prettier check and `git diff --check` passed. A complete tensor rerun including the new
  transport cases precedes the retained GPU timing run so this ticket's untimed checks cannot overlap it.
  No framework source changed.
- The first full-size interpreter matmul run took 177,804 ms on the shared machine. I kept that completed
  trial and switched the benchmark to one CPU trial per workload instead of the design's three, which
  would repeat several very long runs. The GPU benchmark retains one warmup and five event measurements.

### Review and resume

Review the [design](../design-doc/01-checked-tix-to-cuda-lowering.md) alongside
`src/tensor/cuda-source.ts`, `src/tensor/cuda-contract.ts` and `tools/cuda-remote.mjs`.
The [benchmark driver](../scripts/03-benchmark.mjs) runs from the worktree root after the build.
The remaining deliverables at this checkpoint are the final test result and the timing table.

## Step 4 — Validate the final revision and finish measurement

The final `node --test tests/tensor/*.test.mjs` run passed all 33 tests. It ran before the retained GPU
benchmark so this ticket's untimed GPU checks would not overlap the recorded event intervals. The Node
export probe resolved all six fixed Stage 1 and CUDA API functions from `dist/tensor/index.js`.

All six GPU and local interpreter workloads finished at the requested sizes. The largest local run was
MLP at 828 seconds. Conv2d finished at 394 seconds. Each of the GPU trials took under 1.2 ms for the
kernel interval. The [verification and timing report](02-cuda-verification-and-corpus-timings.md) records
the input seed, timing boundaries, full table and raw intervals for implementation commit `daa175f`.

## Step 5 — Diagnose the independent results and publish the report

The coordinator evaluated `dcc3de3`. Every reported GPU result word matched the corresponding
Stage 1 f32 result. Ten small-case comparisons against f64 had nonzero maxima. I traced the precision
difference through the corpus expressions, the emitter and the two interpreter modes. The evaluator
provided aggregate maxima without the tensors or coordinates at those maxima. The source identifies
where rounding enters each computation. Selecting one site as the source of an individual maximum
would require the missing execution data.

### Prompt context

<details>
<summary>Independent evaluation and report request</summary>

Stage 2 of IRWB-022-J has been evaluated independently, at your last commit. Your results:

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
  - matmul: 262144/262144 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 0.234
  - softmax: 4194304/4194304 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 0.941
  - layernorm: 4194304/4194304 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 1.775
  - attention: 65536/65536 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 7.311
  - mlp: 262144/262144 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 1.027
  - conv: 984064/984064 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 0.350
- **`checkLowering` on the six corpus programs and ten random ones:** accepted 16/16, relation tolerance, 3.1 s per check on average.
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
3. **Commit** (message starting `IRWB-022-J:`). Final message: the report's path, the commit hash, one line per difference cause, and your one-paragraph answer on the relation.

</details>

### Precision differences and emission sites

The interpreter selects `Math.fround` for f32 and an identity function for f64 at
`src/tensor/evaluate.ts:26`. The rounded sites are literal conversion and scalar shape conversion
at `src/tensor/evaluate.ts:65` and `src/tensor/evaluate.ts:67`, scalar operations at
`src/tensor/evaluate.ts:80`, and fold steps at `src/tensor/evaluate.ts:85`. The GPU matches the f32 mode
in the reported comparisons. The table identifies the active rounding sites that can account for the
reported f64 gaps, without assigning an individual maximum to an unobserved intermediate.

| Comparison | Largest f64 gap | Difference mechanism and emitter location |
| --- | ---: | --- |
| Matmul small | 3.2e-7 | Product and sequential sum rounding via `__fmul_rn` at `src/tensor/cuda-source.ts:7` and `__fadd_rn` at `src/tensor/cuda-source.ts:100`. |
| Softmax small | 5.3e-8 | Shift subtraction, rounded exp, sum and division at `src/tensor/cuda-source.ts:6`, `src/tensor/cuda-source.ts:195`, `src/tensor/cuda-source.ts:100` and `src/tensor/cuda-source.ts:191`. |
| Layernorm small | 1.3e-7 | Mean and variance fold rounding, centering, squaring, sqrt, division and scale/bias operations at `src/tensor/cuda-source.ts:100`, `src/tensor/cuda-source.ts:5`, `src/tensor/cuda-source.ts:6`, `src/tensor/cuda-source.ts:7`, `src/tensor/cuda-source.ts:195` and `src/tensor/cuda-source.ts:191`. |
| Attention small | 6.6e-8 | Rounded score and weighted-value dot products, sqrt scaling, shifted exp, normalization sums and division at `src/tensor/cuda-source.ts:7`, `src/tensor/cuda-source.ts:100`, `src/tensor/cuda-source.ts:6`, `src/tensor/cuda-source.ts:195` and `src/tensor/cuda-source.ts:191`. |
| MLP small | 3.6e-7 | Rounded products, sums and biases, with GELU literal conversion and rounded tanh at `src/tensor/cuda-source.ts:5`, `src/tensor/cuda-source.ts:7`, `src/tensor/cuda-source.ts:100`, `src/tensor/cuda-source.ts:40` and `src/tensor/cuda-source.ts:195`. |
| Conv2d small | 3.1e-7 | Rounded products and ordered channel/row/column accumulation at `src/tensor/cuda-source.ts:7` and `src/tensor/cuda-source.ts:100`. |
| Matmul optimized | 2.2e-7 | Rounded products and separate inner and outer sum steps at `src/tensor/cuda-source.ts:7` and `src/tensor/cuda-source.ts:100`, using split bounds emitted at `src/tensor/cuda-source.ts:66`. |
| Softmax optimized | 4.9e-8 | The shift, exp and divide round at `src/tensor/cuda-source.ts:6`, `src/tensor/cuda-source.ts:195` and `src/tensor/cuda-source.ts:191`. The denominator rounds in the split accumulators at `src/tensor/cuda-source.ts:100`. |
| Attention optimized | 6.0e-8 | Dot-product multiplication and split sum steps round at `src/tensor/cuda-source.ts:7` and `src/tensor/cuda-source.ts:100`. The shift, sqrt, exp and divide round at `src/tensor/cuda-source.ts:6`, `src/tensor/cuda-source.ts:195` and `src/tensor/cuda-source.ts:191`. |
| MLP optimized | 4.6e-7 | Split affine accumulators round at `src/tensor/cuda-source.ts:100`. Affine and GELU arithmetic, literal conversion and tanh round at `src/tensor/cuda-source.ts:5`, `src/tensor/cuda-source.ts:7`, `src/tensor/cuda-source.ts:40` and `src/tensor/cuda-source.ts:195`. |

The earlier GB10 probe had one additional kind of difference. The double `log` call and f32
conversion emitted at `src/tensor/cuda-source.ts:193` and `src/tensor/cuda-source.ts:195` preserve
a different NaN word for `log(-1)` than the Node reference in that run. The observed words were
GPU `0xffc00000` and Node `0x7fe00000`. Both denote NaN. This earlier observation is distinct from
the ten f64 gaps and the independent evaluation's zero f32 mismatches.

### Relation supported by the evidence

The shipped tolerance is weaker than the strongest sampled relation the evidence supports on the
evaluated GB10 and compiler policy. A stronger checker would require identical f32 words for
non-NaNs, including signed zeros and infinities, and compare NaNs as a class. The coordinator's
exhaustive intrinsic comparison, the matching IEEE arithmetic, the emitted order of f32 rounding
and the zero reported program-level mismatches support that rule. The earlier log probe rules out
raw equality of all NaN words, and sampled end-to-end checks leave untested programs outside the
observations. The f64 reference remains useful for judging a numerical rewrite or characterizing
precision loss.

### Checks and evidence

- Printed the matmul kernel with `cudaSource` from the evaluated build and checked the report excerpt
  against it.
- Ran `node <ticket>/scripts/04-rounding-witnesses.mjs`. Fresh local Tix examples reproduced f32
  versus f64 differences at subtraction, multiplication, a fold step, division, sqrt, exp, tanh and
  literal conversion. The cancellation example returned f32 `0` and f64 `1`. These are witnesses
  for the rounding mechanisms. They do not identify the inputs used by the independent evaluator.
- Reused the archived GB10 probe and timing observations. No new GPU runs were needed for the
  diagnosis. The [publication report](02-report.md) records the result scope and the stronger
  relation supported by the new evidence.
