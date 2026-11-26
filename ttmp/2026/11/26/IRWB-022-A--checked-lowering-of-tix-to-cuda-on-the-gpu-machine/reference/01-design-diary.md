---
Title: Design diary
Ticket: IRWB-022-A
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
LastUpdated: 2026-11-26T15:12:09.576592974-05:00
WhatFor: ""
WhenToUse: ""
---

# Design diary

## Step 1 — Choose the contract before implementing the emitter

I read the IRWB-020-B design and final report, then traced the evaluator, optimizer, model, adapter, contract, pass runners and remote helper. The question was whether a change of backend could use an existing checked transformation and how precisely its GPU result could match the reference.

The GB10 disproved exact agreement for standard float intrinsics. The framework already supports a different output type and one async decision for all outstanding cases. The proposed implementation therefore spends its complexity on preserving Tix evaluation order, transporting the actual candidate and isolating concurrent remote runs.

### Prompt context

User request, verbatim:

~~~~
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`). Stage 1 built its front end, IR, f32 and f64 evaluators, a meaning contract and two checked passes. Its design and its final report are in ticket IRWB-020-B under `ttmp/2026/11/26/`. Read them first.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-022-A. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-022-A:`. Do not push.
- Final message: the ticket and design paths, the framework and tool changes you propose, the relation you chose for the lowering and the probe that established it, the commit hash.
Your ticket ID is IRWB-022-A. Name the ticket after the stage-2 work (lowering Tix to CUDA, checked, on the GPU machine).
~~~~

### Experiments and review

From the worktree root, build with npm run build. Set T to this ticket directory, then run:

```sh
node tools/cuda-remote.mjs "$T/scripts/01-gb10"
node "$T/scripts/02-compare.mjs"
node "$T/scripts/03-contract-probe.mjs"
```

The helper returned NVIDIA GB10 sm_121 nvcc 13.0, hash a0e28fa1ac988562, compiled=true and exit 0. The comparator checked each returned word against the JS operations and each value against the f64 budget. See the design for the first exp disagreement and maximum errors. The output binary is regenerated by the first command.

The first invocation of the third command failed with ERR_MODULE_NOT_FOUND for dist/framework/contracts/index.js because its relative import climbed one directory too far. Correcting the path produced one batch [0,1], delegated=2 and replayed=2. The dispatch probe exercises the manager independently of hardware.

For review, follow cases() in src/tensor/contract.ts into the proposed invariant and inspect prepare(), memoKeys() and runDifferentialAsync() in src/framework/contracts/differential.ts. The main correctness questions are whether the cache identifies the actual emitted source and whether the baseline survives a split followed by inline. In the remote helper, trace out/ from deletion through tar retrieval for two concurrent invocations. After review, implement the three exports, exercise the gate with a wrong candidate, and collect the six timing pairs.

## Step 2 — Review revisions

The reviewer measured first-launch overhead on the GB10 (0.115 ms versus 0.003 ms warm, 0.004 ms after cudaFuncGetAttributes). I accepted both requested corrections. Every run now calls for preloading kernel functions before timing. The checker assumes a fixed engine for one process lifetime. Its cache has no driver discovery step. The concurrency test now exercises duplicate calls with identical arguments. The implementation request refers to the three CUDA exports and the six measurements from Step 1.

## Step 3 — Run the emitted CUDA through the checked pass

I implemented the three exports in src/tensor and shared the stage-1 sample generator and comparator between its existing gate and the CUDA invariant. The emitter visits the current expression tree, including split extents and affine loads. The transformation checks the source it actually returned. Node frames complete batches in binary and calls the helper asynchronously. The remote helper compiles under a per-hash flock and gives each run a private workspace through result retrieval.

The standalone cudaFuncGetAttributes probe compiled and ran on GB10 (308603464332bac2). An async Node child-process probe returned v24.18.0. The public runner then returned [1, 2.7182817459106445] for exp([0,1]). The first npm run build reported TS2345 about Buffer<ArrayBufferLike> and Buffer<ArrayBuffer> in the frame encoder. Typing the concatenation list as Buffer[] resolved it, and the build passed. The isolated compile probe launched identical jobs concurrently against cold hash 8865d20ab29c74fe. Exactly one compiled, both exited zero, and both retrieved identical 393216-byte outputs.

Review the timing boundary in cuda-source.ts and the origin and subject bindings in cuda-contract.ts. The latter uses a new manager per invocation and the framework's existing process-local differential memo. All six corpus gates passed on the GB10, and a valid compiled source with its final store changed to zero was rejected at a specific coordinate. No framework edits were needed.

The first sandboxed tmux benchmark session ended before the output file was created. I restarted the interpreter in a persistent tmux server and verified its output in reference/cpu.jsonl. The GPU measurements ran through the helper's timed lock, with one warm-up and three intervals per process.
