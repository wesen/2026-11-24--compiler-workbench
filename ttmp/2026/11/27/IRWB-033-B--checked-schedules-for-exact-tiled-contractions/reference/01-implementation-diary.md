---
Title: Implementation diary
Ticket: IRWB-033-B
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Design checkpoint, implementation decisions, layout experiments and validation history
LastUpdated: 2026-11-27T10:04:09.014532792-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary


## Step 1. Design checkpoint

The request is “Build a schedule IR, and make it the compiler.” The primary acceptance path is the public synchronous source function and the asynchronous GPU contract consuming the same schedule. I read stages 3b, 3 and 2, the contract and adapter APIs and the named paper. Node reports v24.18.0. The worktree initially had no dependencies. npm ci --offline installed the six locked packages from cache.

The base imports its plan in two places. Consolidating these paths prevents a checker from validating a different compiler than the public API. The stage 3b gate already forces both branches on tiny differential samples. Review the template specialization and the ordered tail when comparing the new paths.

## Step 2. First working schedules

The schedule artifact retains the resolved function and imported fusion groups. Three native passes partition output and K, give a rectangular accumulator patch to each lane, and stage panels in shared memory. A new third forced gate choice checks tiled contraction members when a row group also has two pre-existing paths.

The TypeScript build succeeded. Script 02 ran the GB10 exact checker and one timed call for each changed corpus program. Matmul, attention and MLP passed and matched the base output hashes. The 64-square block at 512 square took 0.0933 ms. Attention and MLP took 0.533 and 0.383 ms by materializing intermediate statements. The resulting gate reports unfused for those runs. Review the distinction between shape-time launch decisions and the identity of the one global definition.

## Step 3. Sharing whole words and retaining fusion

The 4×4 patch exposed enough independent accumulator chains that the operand distribution became important. Comparing executable schedule revisions showed that staging scalar words alone cost performance. Packing the global loads and fetching contiguous register fragments cut the 512-square time from 0.0885 to 0.0517 ms. An 8×8 patch improved a separate 4096-square trial. A smaller block on the skinny attention value product lost. The report records the five-call series and their inputs.

At commit 1aa3b23 the tiled route materialized every member separately. The phase pass now combines equal-coordinate epilogues into their dot and reuses the original shared/scratch row placement across a contiguous normalization phase. The validator reconstructs live-ins and live-outs. Its critical case is a previously in-place tensor crossing a launch. The new phase imports that tensor from its global buffer before the row computation and exports what the next launch reads. The affine convolution takes a different path, hoisting an invariant input read out of four independent channel folds.

## Step 4. Closing the check on the normal entry point

The public source, runner and checker now share compileCudaPipeline. Its correspondence inventory carries individual folds through unchanged v6 IDs. The framework previously let a caller specify the synchronous gate, so running an individual schedule pass elsewhere could omit the intended check. Pass definitions can now own that check. Both application paths enforce it.

The exact contract requests an aligned panel assignment and checks both tiled block sizes. The packed-load mutant was rejected numerically. Full and clipped transposed panels agreed with the interpreter. The original two successful GPU tests are in scripts/17-first-gpu.log. The build succeeded. A first CPU suite launched while tsc was still emitting and used an older transpose matcher. The matching test failed. The rebuilt suite passed. A timed run and a separate mutation test encountered “Connection closed by 100.117.186.55 port 22”. Other jobs reached the device. The checker now submits the forced route batches in sequence, keeping the original differential's shared in-flight checks. Qualification resumes successful calls by source hash and records one retry for a disconnected public call.

Review the orderCheck evidence, the phase live-in copies and the argument used to preload each templated entry. Scripts 03–15 separate layout effects, clock sampling, short shapes, isolated launches and checking costs.

<details>
<summary>Original implementation brief, quoted verbatim</summary>

You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`).

Tix has been built in four stages, each merged from one of several independent implementations:
- **Stage 1** (ticket IRWB-020-B): the front end, an IR as a v6 artifact, f32 and f64 evaluators, a meaning contract, and two checked passes (`inline`, `split-sum`).
- **Stage 2** (ticket IRWB-022-I): lowering to CUDA, one kernel per statement and one thread per output element, run and checked on an NVIDIA GB10.
- **Stage 3** (ticket IRWB-029-D): checked fusion. `planFusion` (`src/tensor/fusion.ts`) decides groups from the Tix IR, and the emitter prints each group as a thread-mode kernel (registers) or a block-mode kernel (one block per row, rows in shared memory or global scratch). Every corpus program lowers to one kernel, bit-identical to the f32 meaning; `fuse: false` is stage 2's lowering.

- **Stage 3b** (ticket IRWB-030-E): fusion that is never slower. A reduction with a costly body computes its terms in parallel and one thread adds them in order; a launch-time gate runs a group's statements as stage-2 kernels where fusing would be slower, and `checkLowering` checks both sides; rows are written in place where nothing reads them later.

Stages 1 to 3 are under `ttmp/2026/11/26/`, stage 3b under `ttmp/2026/11/27/`. Read stage 3b's and stage 3's designs and final reports first, then stage 2's, then the code.

Since stage 2, these changes have landed besides stages 3 and 3b:
- the lowering is checked under the exact relation: bit-identical with the current revision's f32 meaning, NaN compared as a class;
- the stage-1 meaning gate gives every shape symbol a distinct size, and checks empty extents;
- `optimizeTix` steps carry `changed` and `reason`;
- concurrent checks share an in-flight GPU batch;
- `tools/cuda-remote.mjs` takes `--link <lib>`.
- an IR type may enumerate its entities (`entities(value)` on `defineIR`); the contracts manager then checks every correspondence's entity lists and entry IDs against both artifacts, and `TixIR` and `CudaIR` enumerate their statements and kernels;
- `runTixCuda` reports, for a source with gated kernels, which side each gated kernel took (`gates`);
- the differential checker detects a spec whose cases do not depend on its `baselineKey` alone.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-033-B. This is an **implementation stage**, in one session of up to four hours. Write a design first and commit it. Then implement, test, measure, and write a final report in the ticket.

## Stage 6 (yours): a schedule IR, and exact tiled contractions through it
The current lowering computes a contraction such as `c[i, j] = sum(k) a[i, k] * b[k, j]` with one thread per output element, which loads two floats from global memory per multiply-add. At 512³ that takes about 0.20 ms, 6× slower than cuBLAS (0.0329 ms). Stage 6 makes contractions fast **without changing any result bit.**

- **Keep each output's order.** Every output element still accumulates its terms one at a time in the meaning's order (k = 0, 1, …), rounding the product and the sum separately, as the f32 meaning prescribes. Within that, everything about how the work is laid out may change, for example:
  - shared-memory tiling of the operands;
  - register tiling, so that each thread computes a patch of outputs;
  - vector and coalesced loads, a transposed tile, double buffering;
  - tile sizes chosen per shape.

  Record each choice and its reason.
- **Build a schedule IR, and make it the compiler.** This stage is about compiler structure as much as about speed. Until now every lowering decision lived in a plan and an emitter: nothing checked them one at a time, and the framework's passes were barely used. Stage 6 adds a **schedule IR as a v6 artifact between Tix and CUDA**, in the spirit of Halide's and TVM's split between algorithm and schedule.
  - The pipeline is Tix → schedule IR → CUDA source. The emitter only prints a schedule; it makes no decisions.
  - **Scheduling steps are passes on the schedule IR:** for example tile, split, reorder, bind to block or thread, stage in shared memory or registers, vectorize, unroll, double-buffer. Each is a v6 pass with its own legality, decided from the IR before it is applied, and a correspondence to the revision before it.
  - **Each step is checked.** At least, the lowering of the final schedule passes `checkLowering` under the exact relation. Better, where the IR lets you show that a step keeps every output's accumulation order, make that argument part of the check, and say what it covers and what the GPU check still has to cover.
  - **The existing fusion decisions** (stage 3's groups, 3b's staged terms and gate) either become schedule-IR constructs and passes, or feed the schedule IR from their plan. Choose, and justify the choice.
  - **The rule that picks a schedule** for a program and shapes is a strategy over these passes. Use or extend `src/framework/strategy` if it fits, and say where it does not.
- **New approaches are welcome.** Beyond the required structure, try ideas that make the compiler better, not only its kernels faster, and report what worked and what did not. Examples, none required:
  - legality and order preservation proven from the schedule IR, so that a step needs no GPU check;
  - a correspondence that follows each output element's accumulation through every schedule step;
  - schedule rewrites that one IR lets you share between contractions and the fused row kernels;
  - an IR-level cost model, checked against measurement.
- **Framework changes are primary results.** Where the framework does not fit a second IR, passes between IR kinds, or schedule strategies, change it and record each change with its reason.
- **Keep what stages 3 and 3b gained.** Fusion, staged terms and the gate keep working, contractions inside fused groups (attention, mlp) included, and no program may become slower than it is now.
- **Every program the language accepts must still lower and run,** at any shape, including shapes that are not multiples of a tile size and contractions over a short or a single index.
- **Not yours:** anything that reassociates a reduction (split-K, parallel tree reductions), FMA contraction, tensor cores or reduced precision, and autotuning by measured search. Later stages cover them, and the schedule IR should leave room for them. A rule or a strategy that picks schedules from the shapes, without timing candidates, is yours.
- **Known prior art, read before designing:** Yang, Riasanovsky, Deng and Sarkar, "Taming Bitwise Behavior in GPU Kernels with Tensor Core", arXiv 2609.11356 (2026). It reconstructs cuBLAS's GEMM reduction order and checks bitwise equivalence between compiled kernels, and restricts Triton's autotuner to one bit-equivalence class.

**What is known:**
- **cuBLAS** (pedantic FP32, no TF32; median of 20 timed runs):
  - matmul 512³: 0.0329 ms, 8.15 TFLOP/s;
  - attention's two GEMMs: 0.0177 + 0.0216 ms;
  - mlp's two GEMMs: 0.0423 + 0.0475 ms;
  - 4096³: 19.2 TFLOP/s.

  cuBLAS uses fused multiply-add, so it is a speed reference, not a bit reference.
- **The arithmetic ceiling of the meaning:** separate multiply and add issue two instructions per multiply-add. Measured on this GPU: FFMA 26.98 TFLOP/s, FMUL + FADD 14.39 TFLOP/s.
- **Earlier experiments outside this code base** (a research round): exact tiled 512³ matmul kernels written by hand took 0.054–0.058 ms, bit-identical to the meaning, about 3.7× faster than the current lowering. One tuned exact GEMM reached 10.3 TFLOP/s at large sizes.

**Sizes,** in the corpus programs' shape names (`corpus/tensor/<name>/main.tix`):

| Program | Sizes |
|---|---|
| matmul | M = K = N = 512, and M = K = N = 4096 |
| softmax | N = 4096, C = 1024 |
| layernorm | N = 4096, D = 1024 |
| attention | Q = K = 1024, D = V = 64 |
| mlp | N = 1024, D = 256, H = 1024, O = 256 |
| conv2d | N = 8, C = 16, H = W = 64, O = 32 (3 × 3 kernel) |

**How to time (measured for this stage, 2026-11-27: 12 interleaved `benchmark: true` calls per program and side, 14 series).** Each `runTixCuda(..., { benchmark: true })` call already returns the median of three timed launches after a warm-up. Take the median of **5** such calls, alternating the two variants you compare (A B A B ...), and treat differences under **5%** as noise. Across those series the coefficient of variation was 0.2-1.7% (3.4% for attention), max/min at most 1.12, and a median of 5 calls fell within 2% of the median of 12 in at least 81% of subsets on every program (100% on 12 of 14 series) and within 5% always. SM clock held at 2411 MHz throughout, so there is no thermal drift at these sizes; for 4096^3 matmul, check it yourself. The hidden evaluation times this way.

## Tix, fixed core (unchanged)
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
- **f32 meaning:** every literal, shape value, operation and function result is rounded to f32. `sum` starts at 0 and `max` at −∞, and both accumulate in increasing lexicographic order of their indices, the first listed outermost, rounding after each step.
- **Everything else** (precedence, a reduction's body extent, extent inference, shadowing, empty extents) is as in stage 1 and the base implements it.

## Fixed API (in `dist/tensor/index.js` after the build)
```ts
cudaSource(program: TixProgram, fn: string, options?: { fuse?: boolean }): string
runTixCuda(program: TixProgram, fn: string,
           inputs: Record<string, { shape: number[]; data: Float32Array }>,
           options?: { host?: string; fuse?: boolean; benchmark?: boolean })
  : Promise<{ shape: number[]; data: Float32Array; gpuMs: number }>
checkLowering(program: TixProgram, fn: string, options?: { fuse?: boolean })
  : Promise<{ accepted: boolean; relation: 'exact' | 'tolerance'; reason?: string }>
```
- **`fuse`** defaults to `true`, your lowering (the merged one, improved). `fuse: false` is stage 2's lowering, one kernel per statement, unchanged.
- **`gpuMs`** is, as before, the time of the function's kernels on the GPU (CUDA events), without transfers or start-up.
- **`benchmark: true`** times one warm-up launch and reports the median of three timed runs, under the tool's `--timed` lock. The base's `runCudaBatch` already does this; expose it.
- **The kernel count** of a lowering is the number of `__global__` function definitions in `cudaSource`.

`compileTix`, `runTix` and `optimizeTix` keep their signatures and behaviour, and so does every function the base exports. Implementations are compared on this API, by hidden tests:
- fused results bit-identical to the f32 meaning, on the corpus and on random programs;
- `checkLowering` accepting the fused lowering as `exact`;
- kernel count;
- benchmark time at the sizes above and at other shapes, on the corpus programs, on variants of them, and on other contractions, fused against unfused.

## Measure and report
For matmul at both sizes, and for the contractions inside attention, mlp and conv2d, at the sizes above, fused and unfused, measure:
- the benchmark GPU time, following the timing protocol above;
- TFLOP/s (2 M N K over the time) and the ratio to cuBLAS where it is given;
- the schedule chosen (tile sizes, staging, mapping) and why.

Also report:
- times for every corpus program, fused and unfused, against the base, so that no program got slower;
- the schedule IR: its constructs, its passes, their legality and checks, and what you considered instead;
- which new approaches you tried, and what they gave;
- which schedule choices you refused and why;
- the framework and tool changes, each with its reason;
- what the contract checks and what it costs.

Put the final report in the ticket. Say which results you measured and which you only argued.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Prettier: 110 columns, single quotes; run it only on files that were formatted before you changed them.
- **Read first:** `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts`, and `src/tensor/`.
- **The GPU machine** is reached only through `tools/cuda-remote.mjs` (read its header). About eleven agents share it: use `--timed` (or `benchmark`) only for measurements, and keep those runs short. Keep tests that need the GPU in their own test file, so that the other tests run without it.
- **Sandboxed sessions:** your sandbox has network access, so `ssh` works. A test that spawns `node` can fail with EPERM. Request escalation for that command.
- **Scope:** you may change `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and `src/framework/` and `tools/cuda-remote.mjs` where the stage needs it. Do not modify `src/typed/`, `corpus/projects/`, other tools or existing tests outside `tests/tensor/`, except framework tests that a framework change makes necessary. Do not run the full suite (`npm test`): other agents share this machine.
- **Scripts:** put every probe, benchmark and temporary program you write in your ticket's `scripts/` directory, numbered in the order you write them (`01-name.mjs`), and commit them. Nothing you ran should exist only in a scratch directory or a one-off command.
- **Tickets and commits:** use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-033-B:`, as you go, so that your last commit always holds working code. Do not push.
- **Outside your worktree,** use only the GPU machine. Do not fetch this repository, its branches or its files from GitHub or any other remote.

## Final message
- the ticket, design and report paths;
- the schedule IR, its passes, and the strategy that picks a schedule;
- the new approaches tried, and their results;
- per contraction: benchmark time fused and unfused, TFLOP/s, and the ratio to cuBLAS where given;
- the framework and tool changes;
- the last commit hash.

</details>

## Step 5. Qualifying the selected schedules

The five-pair qualification recorded 70 public calls. Script 18 checked their output hashes against the base and the 40 isolated contraction measurements against their whole-function outputs. Matmul took 0.0522 ms at 512³ and 14.5144 ms at 4096³. One large fused call was slower than the other four. The independent clock trace found only 6 MHz of variation. All nine representative pass prefixes produced exact GPU verdicts. Cold and replay costs are in the results table.

The final source review found that a manually supplied deep register tile could exceed shared capacity when passed to stage-panels. Commit d5e4269 preflights the candidate layout using the same budget as artifact validation. The regression test applies the pass to a legal unstaged deep tile and checks that it declines to stage it. The final build and all 68 scoped host tests passed. Replaying script 16 still found all 70 cached source hashes from the measured series.
The scoped GB10 suite passed all 23 tests in 616 seconds, including the final three staged-term regressions. Scripts 17 and 18 reproduce the verification and the report tables.
