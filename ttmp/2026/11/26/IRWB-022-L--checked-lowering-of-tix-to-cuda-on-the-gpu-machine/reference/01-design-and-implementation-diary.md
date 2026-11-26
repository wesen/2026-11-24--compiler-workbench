---
Title: Design and implementation diary
Ticket: IRWB-022-L
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
Summary: Probe configuration, observations and review handoff.
LastUpdated: 2026-11-26T15:12:25.834050174-05:00
WhatFor: ""
WhenToUse: ""
---

# Design and implementation diary

## Step 1. Choosing the numerical relation and checking the pass boundary

At base `1880fc4` the unresolved question was whether CUDA's ordinary float intrinsics could implement the f32 contract exactly. I compiled a single arithmetic probe on the target and compared all returned words with the actual stage-1 evaluators. Three intrinsic functions differed, while even the seven-term dot product stayed inside the existing f64 error budget on these samples. The design uses that measured tolerance.

The other question was where the remote acceptance check belongs. A Tix artifact and a CUDA text candidate fit the existing transformation and asynchronous differential APIs. The tool needs private run directories because two invocations with identical staged files currently share writable output paths. [Design](../design-doc/01-checking-tix-cuda-lowering-on-the-gb10.md)

### Prompt context

The requested deliverable is a design for review in this session, backed by a real GPU probe. The authored request is reproduced at the end of this entry. Implementation and corpus benchmarking depend on that review.

### What I did and why

- Read the stage-1 design and final report, then traced `evaluate`, `meaningGate`, the two rewrite bodies, the v6 contract/IR descriptions, `applyNativePassSync`, `runDifferentialAsync` and the remote tool. The emitter needs the current scalar trees and extent records, while reference selection needs the origin artifact.
- Created this ticket with docmgr. Installed locked build dependencies with `npm ci --offline --no-audit --no-fund`, then ran `npm run build`. Both succeeded. The probes import the built repository code on Node v24.18.0.
- Used a hand-written probe kernel so that a decision about numerical semantics could be made before implementing the compiler. The input seed, two exceptional pairs, operations, flags, f32/f64 comparisons, hashes and counterexamples are preserved with the probe. [CUDA probe](../scripts/01-numeric-probe.cu) · [Driver](../scripts/02-measure.mjs) · [Results](../scripts/04-probe-result.json)

### What worked

From the worktree root, reproduce the device experiment and the framework probe with these commands.

```sh
ticket=ttmp/2026/11/26/IRWB-022-L--checked-lowering-of-tix-to-cuda-on-the-gpu-machine
npm run build
node "$ticket/scripts/02-measure.mjs"
node "$ticket/scripts/02-measure.mjs" --events
node "$ticket/scripts/03-contract-probe.mjs"
```

The first numerical run used the tool's default flags without the timing lock. The final probe source added an optional timing mode. A locked run of that source reported `compiled:true`, one warmed event interval of 0.005472 ms and identical output bytes to the original probe. Rerunning the final source without timing reported `compiled:false`, hash `2ecf3f06e2f561a1`, and the same output digest. The tool's 285 ms locked run time includes process overhead; it is a different measurement from the event interval. The local tar client noted a subsecond remote timestamp skew on extraction. Both invocations completed and produced the expected byte count and digest.

The final Node driver also returned the same 40,960 words using asynchronous `execFile` to invoke the tool. The local framework probe checked three case IDs. Its text-candidate transformation dispatched all three once, replayed all three on the second check and dispatched all three again for changed candidate bytes. With case 1 deliberately marked disagreeing, the same transformation rejected. [Framework probe](../scripts/03-contract-probe.mjs)

### What did not work

Bit identity failed under `/usr/local/cuda-13.0/bin/nvcc -O3 -arch=sm_121`. For example, the command `node "$ticket/scripts/02-measure.mjs"` returned `different: 1243` for exp; input word `0x3f800001` gave GPU `0x402df855` and stage-1 `0x402df856`. Log and tanh had 294 and 1,169 differences respectively. The numeric experiment itself exited successfully. This is a falsifier of the exact relation for this implementation.

### What I learned

All 40,960 comparisons had finite f64 reference values. The largest observed budget fraction was 0.156025 for dot window 1,648. Its GPU result was −0.10265588760375977 (equal to the f32 evaluator) versus f64 −0.10265525521730723. The explicit multiply/subtract rounding sites gave positive zero on the contraction witness. A product using the least positive subnormal and one returned `0x00000001`.

### What was tricky

The stage-1 split is allowed to change a sum's bits. The benchmark must execute the selected revision, and the correctness gate needs to measure its total error against the origin. The seven-term fixture tests the current fold grouping even when both answers satisfy tolerance. Reuse also has two distinct owners. A cached binary saves nvcc time; only a replayed verdict for the correct baseline, cases, source bytes and target can save a GPU check.

### Review and next work

Review the finite-reference sample domain and numerical budget first, then the typed output port and `decide` batch in the design's ledger. The proposed runner test uses identical input files with distinct program arguments to expose the shared-directory race. After review, implement the lowering, run the local and GPU tests separately and fill the six timing rows at the requested sizes. The probe interval is solely the event-clock check.

### User request (verbatim)

~~~~text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`). Stage 1 built its front end, IR, f32 and f64 evaluators, a meaning contract and two checked passes. Its design and its final report are in ticket IRWB-020-B under `ttmp/2026/11/26/`. Read them first.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-022-L. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-022-L:`. Do not push.
- Final message: the ticket and design paths, the framework and tool changes you propose, the relation you chose for the lowering and the probe that established it, the commit hash.
Your ticket ID is IRWB-022-L. Name the ticket after the stage-2 work (lowering Tix to CUDA, checked, on the GPU machine).
~~~~

## Step 2. Incorporating review

Accepted all four edits. The checker version now owns the process-lifetime target assumption. The binary header selects zero, one or three timed repetitions, every timed case warms once, and the launch grid is one-dimensional. The isolation regression exercises the actual caller, two identical simultaneous checks. The design commit before review was `b82a504`.

### User request (verbatim)

~~~~text
A reviewer has read your design for IRWB-022-L. The review:

# Review of your design

## Must change

1. **The subject key names inputs that nothing supplies.** "the target profile (host, architecture, toolchain, flags, runner/protocol version)". The tool reports neither the toolchain nor the driver, and your ledger adds no way to obtain them. Either declare them constants of the checker's version for the life of the process, or name the source of each one.
2. **Say how `main` decides whether to warm up and time.** "For a timed observation the main allocates all buffers, finishes H2D transfers and warms the complete sequence once before recording a start event … The batch check can omit timing." The single generated `main` must learn this from somewhere, for example a field in `cases.bin`, or it must always warm up and time. Otherwise the implementation guesses. The warm-up itself is right: in my probe on the GB10, a kernel's first event interval in a process was 0.115 ms and its second 0.003 ms.

## Cut

1. "flatten the grid over a second block dimension if needed". A one-dimensional grid allows 2³¹−1 blocks, and no corpus size or contract case needs a second dimension.

## Framework and tool changes

- No framework change: correct. Typed transformation ports, `decide` over all missing indices, and `baselineKey`/`subjectKey` replay cover the check, as your probe showed.
- Isolating invocations is the only tool change. With the full-input key kept, two runs collide only if they upload byte-identical directories at the same time, for example two concurrent `checkLowering` calls on one function. It is needed only for that case, and it is minimal and correctly placed. Your test's "distinct program arguments" has no caller in this design.
- No change missed.

## Keep

Keep the restraint: no kernel IR, no framework edits, one tool change. Keep the origin f64 reference with the unchanged stage-1 budget, which the f32 meaning of every corpus program meets with at least 4× margin on the stage-1 cases (my local check). Also keep the warmed timing for each public run and the dropped-tail mutant fed through the checked pass.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-L:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
~~~~

## Step 3. Direct emission and isolated execution

Revision `196e944` incorporates all review items. The new emitter walks the current statement trees and uses the same generated translation unit for warm public runs and untimed batch execution. The binary view encoder preserves an input subarray's exact data range. The remote tool now uploads into a UUID-named run directory, uses a per-hash compile lock and publishes only a finished executable.

A first build exposed a TypeScript 5.9 inference issue in `cuda-run.ts`: “Argument of type 'Buffer<ArrayBufferLike>' is not assignable to parameter of type 'Buffer<ArrayBuffer>'.” Typing the list of input chunks as `Buffer[]` resolved it. `npm run build` passed. The generated kernel for `y[i]=x[i]*2` returned shape [2] and values [6, −2] on the GB10, with a 0.005664 ms warmed interval. The numeric probe through the isolated runner reused the existing binary and reproduced the original output digest. The requested benchmarks are running in ticket-specific tmux sessions.

The checked pass uses `verifyTransformation` on the emitted bytes and shares the stage-1 sample generator and comparison. On the network-free gate, all 19 tests passed, including rejection when a fixed input shape exceeds the evidence domain. The built tensor barrel exports the required three additional functions. No framework source edits were needed.

## Step 4. Exercising the pass and the remote runner

The backend commit is `4546491`. All six origin-f64 corpus checks passed both before and after optimization. Concurrent identical checks retrieved complete evidence in two consecutive pairs. Two separate checks of the same intentionally uncompilable source returned the nvcc diagnostic and compile exit 97 each time, with zero replayed verdicts.

The first `node --test tests/tensor/*.test.mjs` run had 28 passes and one failed assertion. The compiler correctly rejected the dropped-tail candidate at [0], with reference 0.5052213072776794, result 0 and allowance 0.00001210442614555359. The test expected JSON keys in the order `shapeValues.*stream.*seed`. The framework encoded `{"fn":"f","seed":20,"shapeValues":[1],"stream":"signed"}`. The test now parses that replay description and compares its fields, then checks the numerical diagnostic separately. A full rerun uses the same GPU test file and the original stage-1 tensor tests.

The sandbox reported `index.lock': Read-only file system` while staging the backend. The authorized escalated Git commands completed the commit. The CPU benchmark initially lost its detached tmux session when the launching shell exited. It is now running at an explicit worktree path with a live `tmux wait-for` client. The GPU measurement session used the same arrangement and completed all six rows.

The corrected `node --test tests/tensor/*.test.mjs` run passed all 29 tests with zero skipped in 249.0 s. The corpus checks, split mutant, binary identities, empty reductions and concurrent retrieval ran on the GB10. The pass reused all previously decided cases on the warm check and ran the changed source against the cached origin cases. [Test receipt](../various/tensor-tests.log)

## Step 5. Timing the six corpus functions

The GB10 regression commit is `ad1502a`. The benchmark script uses the encoded repetition count three and the runner's exclusive timing lock, and stores each event interval, input digest and output shape. All six GPU measurements completed. Their medians span 0.166208 ms for conv2d to 0.988288 ms for MLP. The host uses the stage-1 f32 interpreter at the exact same input sizes, with no extrapolation. The first host row (512³ matmul) took 813945.980 ms. [Benchmark harness](../scripts/05-benchmark.mjs) · [Device observations](../scripts/07-gpu.jsonl)

