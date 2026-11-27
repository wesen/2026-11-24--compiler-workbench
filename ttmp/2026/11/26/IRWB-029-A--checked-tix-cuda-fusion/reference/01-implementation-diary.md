---
Title: Implementation diary
Ticket: IRWB-029-A
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T23:01:37.577429178-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## 1. Inspect the existing lowering and commit the design

The two prior stage designs and reports establish the scalar rounding and order guarantees. The current CUDA text artifact, exact differential contract and timed runner already cover the execution boundary. The emitted schedule is the narrowest place to introduce thread ownership and intermediate storage.

[Original task brief](#original-task-brief)

The installed docmgr supports ticket creation with a date path template, document creation and task addition. The local runtime reports Node 24.18.0. The correspondence implementation supports a list of source entities per target entry.

The baseline build passed with `npm run build`. The Git index was read-only in the sandbox, so the requested design commit used the approved Git escalation. Design commit `9c7feca` precedes the source changes.

## 2. Form groups and validate the first implementation

The planner walks resolved read sites and checks tensor ownership and lifetime before emitting a group. The per-element mapping keeps repeated uses of a producer in a single local float. The row mapping uses a block-wide barrier after every intermediate stage and before the first reader of a cooperatively staged input. The wide-row test used 32,768 columns, which requests 128 KiB of scratch per row and exercises device-backed scratch on this target.

The build, 23 network-free tensor tests and the initial 12-test isolated GB10 file passed. The first paired corpus run matched all full-size output SHA-256 digests. It exposed a softmax regression at 0.908 ms fused versus 0.779 ms unfused. Layernorm ran in 0.211 ms fused versus 0.472 ms unfused. This made the cost of the sequential maximum loop the next question.

## 3. Probe the maximum and row mapping

[The softmax experiment](../scripts/05-row-performance.mjs) changed one fold at a time. The exact CUDA contract accepted the existing helper, the NaN-propagating PTX maximum, and the same instruction with four-way loop unrolling. All three full-size digests matched. Their CUDA event medians were 0.9082, 0.3871 and 0.4477 ms respectively. The instruction replaces a step in the sequential fold. Loop unrolling was left out because it increased the measured time.

The row body was then parameterized by its address space so the compiler could emit direct shared-memory access for the common path. The wrapper still defines one kernel and uses the same schedule for device-backed scratch. It grid-strides only when the number of rows exceeds the device grid limit. The shared array is reused after a block barrier in that case.

[The block-width experiment](../scripts/06-row-block-width.mjs) ran the same specialized row program with eight, four and two warps per block. All output digests stayed equal within each workload.

| Threads | Softmax ms | Layernorm ms | Attention ms |
| ---: | ---: | ---: | ---: |
| 256 | 0.35658 | 0.25939 | 0.81040 |
| 128 | 0.36282 | 0.18378 | 0.94752 |
| 64 | 0.37302 | 0.18032 | 0.77453 |

The fixed two-warp width gives more blocks room to reside while only one warp does the serial fold. It had the lowest sum of the three observed workload times. The existing per-element path retains its original width. Separate tests exercise the maximum instruction on signed zeros, generated NaNs and a subnormal, and ask the exact contract to reject a valid fused kernel with the fold reversed.

## 4. Verify and record the selected lowering

Implementation commit `da82bb5` holds the selected code and six numbered scripts. The TypeScript build and the 23 network-free tensor tests passed. The final 13-test GB10 suite passed in the `irwb029a-validation` tmux session. The suite accepted both shared and device-backed schedules and rejected the reversed fold; the PTX maximum witness preserved the expected zero signs, subnormal and NaN class.

The random replay passed 12 exact checks across contraction epilogues, affine same-row reads and rejected transposes. The paired benchmark compared output digests for all six full-size calls. The first-call and replay measurements ran after the benchmark in a fresh Node process. The [report](02-checked-fusion-results.md) records timings and kernel counts alongside the independent traffic calculations.

## Original task brief

<details>
<summary>Verbatim implementation request</summary>

You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`).

Tix has been built in two stages, each merged from one of several independent implementations:
- **Stage 1** (ticket IRWB-020-B): the front end, an IR as a v6 artifact, f32 and f64 evaluators, a meaning contract, and two checked passes (`inline`, `split-sum`).
- **Stage 2** (ticket IRWB-022-I): lowering to CUDA, one kernel per statement and one thread per output element, run and checked on an NVIDIA GB10.

Both tickets are under `ttmp/2026/11/26/`. Read their designs and final reports first, then the code.

Since stage 2, these changes have landed:
- the lowering is checked under the exact relation: bit-identical with the current revision's f32 meaning, NaN compared as a class;
- the stage-1 meaning gate gives every shape symbol a distinct size, and checks empty extents;
- `optimizeTix` steps carry `changed` and `reason`;
- concurrent checks share an in-flight GPU batch;
- `tools/cuda-remote.mjs` takes `--link <lib>`.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-029-A. This is an **implementation stage**, in one session. Write a short design first and commit it. Then implement, test, measure, and write a final report in the ticket.

## Stage 3 (yours): checked fusion
Stage 2 launches one kernel per statement. Every intermediate tensor goes through global memory, and the row reductions run one thread per row, with uncoalesced reads. Stage 3 fuses statements into fewer kernels **without changing any result bit.**

- **Fuse what the IR shows can be fused,** keeping each output element's evaluation order exactly as the f32 meaning prescribes. That covers:
  - elementwise chains;
  - epilogues: a pointwise statement over a reduction's result, such as `mlp`'s bias and GELU after its contraction;
  - row reductions with their producers and consumers: `softmax`'s max, exp, sum and divide, and `layernorm`'s mean, variance and normalization.
- **The thread mapping may change** where fusion needs it: for example, a block per row, with the row staged through shared memory so that loads are coalesced. Every reduction must still accumulate sequentially, in the meaning's order. Record each change and its reason.
- **Legality is decided from the Tix IR,** before a fusion is applied. A fusion that cannot be shown to keep the order is not applied. `checkLowering` checks the fused lowering on the GPU under the exact relation.
- **Decide where fusion lives,** and justify the choice: a pass on the Tix IR, a second v6 artifact (a kernel IR) between Tix and CUDA, or the emitter. The framework's correspondence may have to express many statements becoming one kernel. If it cannot, that is a finding.
- **Not yours:** anything that reassociates a reduction (parallel tree reductions, split-K), tiling of contractions for data reuse, FMA contraction, tensor cores, streaming attention, autotuning. Later stages cover them.

**What is known:**
- **The base is bit-exact,** so an order-preserving fusion can be checked under the exact relation, with no tolerance to justify.
- **Streaming bandwidth is 244 GB/s** (a `y = 2x` kernel). For `softmax` and `layernorm` at the sizes below, one read and one write of the 16 MB input take about 0.14 ms.
- **An earlier prototype** outside this repository fused `softmax` exactly (rows staged through shared memory) and ran 4.25× faster than stage 2, bit-identical.

**The stage-2 kernels,** single timed runs (they vary by up to 2×):

| Program (`corpus/tensor/<name>/main.tix`) | Sizes, in the program's shape names | Stage-2 GPU time |
|---|---|---|
| matmul | M = K = N = 512 | 0.197 ms |
| softmax | N = 4096, C = 1024 | 0.785 ms |
| layernorm | N = 4096, D = 1024 | 0.563 ms |
| attention | Q = K = 1024, D = V = 64 | 1.81 ms |
| mlp | N = 1024, D = 256, H = 1024, O = 256 | 1.05 ms |
| conv2d | N = 8, C = 16, H = W = 64, O = 32 (3 × 3 kernel) | 0.341 ms |

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
- **`fuse`** defaults to `true`, your fused lowering. `fuse: false` is stage 2's lowering, one kernel per statement, unchanged.
- **`gpuMs`** is, as before, the time of the function's kernels on the GPU (CUDA events), without transfers or start-up.
- **`benchmark: true`** times one warm-up launch and reports the median of three timed runs, under the tool's `--timed` lock. The base's `runCudaBatch` already does this; expose it.
- **The kernel count** of a lowering is the number of `__global__` function definitions in `cudaSource`.

`compileTix`, `runTix` and `optimizeTix` keep their signatures and behaviour, and so does every function the base exports. Implementations are compared on this API, by hidden tests:
- fused results bit-identical to the f32 meaning, on the corpus and on random programs;
- `checkLowering` accepting the fused lowering as `exact`;
- kernel count;
- benchmark time at the sizes above.

## Measure and report
For each corpus program at the sizes above, fused and unfused, measure:
- the kernel count;
- the benchmark GPU time;
- the bytes each kernel reads and writes in global memory, by your count;
- the time those bytes would take at 244 GB/s.

Also report:
- which fusions applied, and which legal-looking fusions you refused and why;
- the framework and tool changes, each with its reason;
- what the contract checks and what it costs.

Put the final report in the ticket. Say which results you measured and which you only argued.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Prettier: 110 columns, single quotes; run it only on files that were formatted before you changed them.
- **Read first:** `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts`, and `src/tensor/`.
- **The GPU machine** is reached only through `tools/cuda-remote.mjs` (read its header). About twelve agents share it: use `--timed` (or `benchmark`) only for measurements, and keep those runs short. Keep tests that need the GPU in their own test file, so that the other tests run without it.
- **Sandboxed sessions:** your sandbox has network access, so `ssh` works. A test that spawns `node` can fail with EPERM. Request escalation for that command.
- **Scope:** you may change `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and `src/framework/` and `tools/cuda-remote.mjs` where the stage needs it. Do not modify `src/typed/`, `corpus/projects/`, other tools or existing tests outside `tests/tensor/`, except framework tests that a framework change makes necessary. Do not run the full suite (`npm test`): other agents share this machine.
- **Scripts:** put every probe, benchmark and temporary program you write in your ticket's `scripts/` directory, numbered in the order you write them (`01-name.mjs`), and commit them. Nothing you ran should exist only in a scratch directory or a one-off command.
- **Tickets and commits:** use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-029-A:`, as you go, so that your last commit always holds working code. Do not push.
- **Outside your worktree,** use only the GPU machine.

## Final message
- the ticket, design and report paths;
- where fusion lives, and why;
- the kernel counts and benchmark times, fused and unfused, per corpus program;
- the framework and tool changes;
- the last commit hash.

</details>
