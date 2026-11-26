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
