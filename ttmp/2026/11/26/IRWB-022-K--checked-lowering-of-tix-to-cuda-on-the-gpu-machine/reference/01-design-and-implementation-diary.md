---
Title: Design and implementation diary
Ticket: IRWB-022-K
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Reproduction commands, numerical witness and framework feasibility probe.
LastUpdated: 2026-11-26T15:12:25.156248675-05:00
WhatFor: ""
WhenToUse: ""
---

# Design and implementation diary

## Step 1. Choose a check that can fail on the GB10

I read the stage-1 design and final report at revision `1880fc4`, then followed a function from its native tensor IR through the evaluator and meaning gate. The design question was whether one-thread-per-element CUDA could use the existing exact f32 check. The probe found thousands of reproducible transcendental differences and measured them against the existing f64 budget.

### Prompt context

**User request (verbatim)**

~~~~text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`). Stage 1 built its front end, IR, f32 and f64 evaluators, a meaning contract and two checked passes. Its design and its final report are in ticket IRWB-020-B under `ttmp/2026/11/26/`. Read them first.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-022-K. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-022-K:`. Do not push.
- Final message: the ticket and design paths, the framework and tool changes you propose, the relation you chose for the lowering and the probe that established it, the commit hash.
Your ticket ID is IRWB-022-K. Name the ticket after the stage-2 work (lowering Tix to CUDA, checked, on the GPU machine).
~~~~

The requested checkpoint is a reviewable design with a remote numerical witness. The stage tests the framework's ability to express checked lowering across representations and execution engines.

### What I did and why

- Read the stage-1 sources and ledger. The current artifact already contains the binder identities, result order, read expressions and generated tail bounds required by a direct emitter.
- Built the worktree with `npm ci --offline --no-audit --no-fund` and `npm run build`. Both succeeded. Generated inputs and reference expressions are specified in the probe sources. The Tix functions actually execute through the built public API.
- Used docmgr to create this ticket, its design document and this diary. The runner experiment used a standalone CUDA kernel under the ticket so the reviewed production code still matches the base revision.

### What worked

From the worktree root, after building, run the commands below. They use the existing runner and a ticket-relative probe directory.

```sh
ticket=ttmp/2026/11/26/IRWB-022-K--checked-lowering-of-tix-to-cuda-on-the-gpu-machine
node tools/cuda-remote.mjs "$ticket/scripts/01-gb10" --host manuel@bling
node "$ticket/scripts/02-compare.mjs"
node "$ticket/scripts/03-contract-probe.mjs"
```

The untimed GPU job reported hash `4766f383f795c5ff`, compiled on its first run and reused the binary on its second. Both completed with exit 0 and returned `values.f32`. Its 786,456 bytes have SHA-256 `8b018535f7d8439707fa812261d5a4a6192a186e0c4b222b60408883ceace434`. The binary is reproducible from the committed kernel. CUDA allocation, events, launch, synchronization, binary write and fetch worked on the GB10. The comparison measured the first exp word disagreement and the per-operation maxima recorded in the design. A local Node probe also confirmed asynchronous execFile and byte-preserving file I/O, returning `v24.18.0 80000001`.

### What didn't work

The initial `node "$ticket/scripts/02-compare.mjs"` failed with `ERR_MODULE_NOT_FOUND` for `dist/tensor/index.js`. The relative import had seven parent components instead of six. Correcting it to point inside this worktree made the comparison run. The local tar extraction printed a subsecond file-time-in-the-future warning on the remote receipts. The expected byte count and successful decoding of every word verified the transfer.

### What I learned

The first exp disagreement occurs well inside the numerical range of a typical softmax. Even without contraction, exact host/device transcendental agreement would be an additional implementation obligation. The f64 budget was testable directly, without treating a different bit pattern as a numerical failure.

### What was tricky to establish

The engine's cost is per remote invocation while the framework reuses evidence per case. I used a tiny cross-representation transformation with two case indices to observe both on the current implementation. A good subject dispatched once, an identical repeat replayed both cases, and a bad subject with a different text key dispatched again and failed the postcondition. The output was `calls: [[0,1],[0,1]], baselineRuns: 0, subjectRuns: 0, replayed: 2, delegated: 4`. Local fallback methods are mandatory in today's type, although this probe never invoked them. This motivated a batch-only type on the async path.

### What warrants a second pair of eyes

Review the boundary between baseline-case reuse and subject verdict reuse, especially the engine version in the subject key. The current CLI shares remote outputs even when two processes use different local directories. Check the proposed run-directory isolation against the fetch phase as well as the launch phase.

### Next work and review instructions

The design's change ledger is the implementation worklist after review. Review the per-operation table and exact witness, then follow the proposed transformation's output text through the batched postcondition. The probe kernel exercises arithmetic only. The six corpus timing rows, generated translation units and deliberate lowering-mutant rejection belong to implementation after review. [Design and evidence](../design-doc/01-checked-cuda-lowering-for-tix.md)

## Step 2. Incorporate the timing and identity review

The reviewer measured 0.115 ms for a cold trivial launch and 0.003 ms on repeat. Querying kernel attributes first reduced the first interval to 0.004 ms. The revised driver preloads every kernel in the process recording events. Benchmarks run the warm-up and three measured sequences in that same process.

The cold check compares the reported host, device name, compute capability and CUDA runtime version. The compiler build and flags belong to the versioned checker configuration. Concurrent cold checks on identical batch bytes motivate isolated runner directories. All review requests were accepted. Implementation starts from design checkpoint 160f768.

## Step 3. Emit and execute the current tensor IR

Implemented direct CUDA emission, the generated binary main, the Node batch codec and the asynchronous runner. A public runTixCuda probe of a 2 × 3 row sum returned [6, 15], shape [2], with a 0.019616 ms event interval. All six benchmark programs then compiled and ran. Each kernel was preloaded in its own process and all four benchmark executions shared a single process and measurement lock. The first run of the TypeScript build found TS2345 on the Buffer array used for concatenation. An explicit Buffer[] accepts both ordinary and shared underlying array buffers.

The runner now creates a private remote job for each call and publishes the compiled binary under a per-key flock via rename. Compilation reuse and the full-input hash retain their existing semantics. Failed fetches throw. The previous shared out directory could race between simultaneous cold checks.

The benchmark driver uses one sample per interpreter workload. The interpreter and GPU consume the same deterministic f32 arrays. Raw measurements and the comparison table will be recorded after the interpreter completes.

## Step 4. Check the emitted source and exercise the rejection path

The CUDA transformation now accepts the current and original Tix artifacts and the function name. Its body emits text. Its postcondition uses the exact text supplied on the output port as the remote main.cu. Each missing case group goes to the runner in one invocation. The stage-1 generator and comparison function are shared at their original precision and budget.

### Review and implementation request (verbatim)

~~~~text
A reviewer has read your design for IRWB-022-K. The review:

# Review of your design

## Must change

1. **Warm up inside the timed process, including in `runTixCuda`.** "Run an untimed warm-up, then three short measured GPU executions under `--timed` … A batch can carry the repetitions." For one-case runs: "Keep allocations, … process startup and context creation outside the events." Under CUDA 13's default lazy loading, the first launch of each kernel in a process loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. Put the warm-up and the three intervals in one batch, and load the kernels before the start event in `runTixCuda`.
2. **Say which tag you compare.** "verify its device/compiler tag on a cold batch before storing verdicts". The executable can report the device and the runtime version (13000), but not "nvcc 13.0.88", and the tool's JSON has no compiler identity. Name the fields you compare, and treat the rest as constants of the checker's version.

## Cut

Nothing material.

## Framework and tool changes

- Batch-only overload in `differential.ts`: a small, real finding. Keep it to a spec type with `decide` required, plus a guard on the sync and worker paths. That is the right place, and your focused test is right.
- Per-invocation directory with a compile lock: with the full-input key kept, two runs collide only if they upload byte-identical directories at the same time, for example two concurrent `checkLowering` calls on one function. It is needed only for that case, and it is minimal. The justification "two legitimate calls with identical files and different program arguments" has no caller here.
- No change missed.

## Keep

Keep the origin f64 reference with the unchanged stage-1 budget (on the stage-1 cases, the f32 meaning of every corpus program uses at most 25% of it; my local check), the fixed count of 15, and one `decide` batch per miss group. Also keep the word-level split witness and the dropped-tail mutant run through the real postcondition.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-K:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
~~~~

### Findings and evidence

- The sole framework edit is in src/framework/contracts/differential.ts. BatchDifferentialSpec requires decide and carries the same case and cache keys as a local spec. A union at the async entry point suffices for the proposed overload. Explicit guards reject a batch-only spec passed to sync evaluation or worker-side decideCase. The existing memo retains the baseline references in the generated cases and replays verdicts in case order.
- The focused test exercised partial and full memo hits, a truncated response, a failed batch, retry of the same two missing indices and ordered counterexamples. The real checker accepted all six corpus functions before and after optimization. Concurrent cold checks succeeded. A repeat of the same function replayed its cases without a fresh dispatch.
- The unsplit seven-element witness returned 0x3f800000, the split witness 0x3f800002. Replacing ceiling block count by floor in the emitted source triggered a postcondition rejection with a positive-stream counterexample. The other direct GPU checks cover empty sums/maxima, empty outputs, returned parameters, nested binder scope, transposed inlining, zero signs and NaN propagation.
- The tensor command passed 29/29, the framework command passed 227/227 and the six selected Typed files (meaning-memo, parallel, passes, program, mutate and strategies) passed 37/37.
- Git initially reported a read-only index lock while staging the emitter. The approved git add/commit commands completed the checkpoint as c7824d4. No source changes were lost. The reviewed design revision is 7b3dc67.

Review the actual postcondition in src/tensor/cuda-contract.ts alongside the dropped-tail test in tests/tensor/cuda-gpu.test.mjs. The comparator reports numerical failures. A tool or identity failure rejects the promise before the framework can cache the batch.

The standalone runner probe forced two simultaneous compilations to contend for a fresh full-input key. For key a3ab8cb9c23a302a exactly one run compiled, the other reused the binary, and a third invocation also hit the cache. All three returned the original GB10 probe fingerprint. The checker records its target profile and translation digest with the evidence.

## Step 5. Measure all six programs and close the ticket

At implementation revision 6f94de2, the build and the final 29 tensor tests completed successfully. The final emitter passes only referenced tensor pointers and shape scalars to each kernel. The same final build produced a four-case timed batch for each original corpus program. The benchmark driver reports one warm-up and three subsequent CUDA event intervals. Each requested local interpreter call also finished. Across the six measured workloads the GB10 medians ranged from 0.1700 to 0.9924 ms. Interpreter calls on the shared host ranged from 15.317 to 812.828 seconds.

The additional Typed differential consumers in evaluate-analyses, tape, specialize, f32, bytecode-vm and candela passed 22 tests. The suite skipped its opt-in Candela O2 workload. Combined with the previous Typed run, 59 passed and one skipped. Importing the built tensor entry point returned exactly checkLowering, compileTix, cudaSource, optimizeTix, runTix and runTixCuda.

Reproduce the measurements from the repository root with the ticket's scripts/04-benchmark.mjs, passing cpu or gpu. Both modes construct the same seed-20 inputs. The CPU mode uses the stage-1 interpreter and can take many minutes. The raw results preserve all six shapes and all 18 measured GPU intervals. [Results, commands and framework findings](02-report.md)

## Step 6. Identify the first differing operation

I traced the independently reported output differences at `a441c31` through the generated kernels for both original and optimized functions. The word counts below refer to outputs. Several differing outputs in a normalized row can trace back to a single differing exponential.

### Prompt context

**User request (verbatim)**

~~~~text
Stage 2 of IRWB-022-K has been evaluated independently, at your last commit. Your results:

- **Stage-1 hidden suite:** 25/25 passed. The three API functions are exported.
- **Corpus programs, small sizes, through `runTixCuda`:**
  - matmul: 35/35 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 3.2e-7
  - softmax: 54/76 elements bit-identical to the f32 meaning, largest difference 3.0e-8 (scaled by max(1, |r|)), largest difference from f64 5.3e-8
  - layernorm: 72/72 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 1.3e-7
  - attention: 56/72 elements bit-identical to the f32 meaning, largest difference 6.0e-8 (scaled by max(1, |r|)), largest difference from f64 6.6e-8
  - mlp: 21/24 elements bit-identical to the f32 meaning, largest difference 8.9e-8 (scaled by max(1, |r|)), largest difference from f64 3.6e-7
  - conv: 160/160 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 3.1e-7
- **After `optimizeTix(p, ['inline', 'split-sum'])`, compared with your own f32 run of the optimized program:**
  - matmul: 35/35 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)), largest difference from f64 2.2e-7
  - softmax: 56/76 elements bit-identical to the f32 meaning, largest difference 3.0e-8 (scaled by max(1, |r|)), largest difference from f64 4.9e-8
  - attention: 47/72 elements bit-identical to the f32 meaning, largest difference 3.0e-8 (scaled by max(1, |r|)), largest difference from f64 4.4e-8
  - mlp: 18/24 elements bit-identical to the f32 meaning, largest difference 1.2e-7 (scaled by max(1, |r|)), largest difference from f64 3.4e-7
- **20 random programs from the fixed core:** 16/20 bit-identical to the f32 meaning on every element; largest difference 1.2e-7.
- **Corpus at the brief's sizes:**
  - matmul: 262144/262144 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 0.262
  - softmax: 2616298/4194304 elements bit-identical to the f32 meaning, largest difference 3.7e-9 (scaled by max(1, |r|)); your `gpuMs` 0.461
  - layernorm: 4194304/4194304 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 0.493
  - attention: 10618/65536 elements bit-identical to the f32 meaning, largest difference 3.7e-8 (scaled by max(1, |r|)); your `gpuMs` 1.507
  - mlp: 231045/262144 elements bit-identical to the f32 meaning, largest difference 2.2e-5 (scaled by max(1, |r|)); your `gpuMs` 1.025
  - conv: 984064/984064 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 0.360
- **`checkLowering` on the six corpus programs and ten random ones:** accepted 16/16, relation tolerance, 4.0 s per check on average.
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
3. **Commit** (message starting `IRWB-022-K:`). Final message: the report's path, the commit hash, one line per difference cause, and your one-paragraph answer on the relation.
~~~~

### Diagnosis at the evaluated revision

| Evaluation group | Differing f32 words (small original / small optimized / full-size original) | Source operation, emitter and interpreter |
| --- | --- | --- |
| Softmax | 22/76 · 20/76 · 1,578,006/4,194,304 | Shifted exp at `corpus/tensor/softmax/main.tix:3` selects `expf` at `src/tensor/cuda-source.ts:26`. Tix uses `Math.exp` at `src/tensor/evaluate.ts:16` then rounds at line 81. The row sum at Tix line 4 and divide at line 5 propagate the change. |
| Attention | 16/72 · 25/72 · 54,918/65,536 | Shifted exp at `corpus/tensor/attention/main.tix:4` selects the same `expf` at `src/tensor/cuda-source.ts:26`. Lines 5–7 of that Tix file normalize the affected row and fold weighted values. Its square root at Tix line 2 selects `__fsqrt_rn` at `src/tensor/cuda-source.ts:28`. |
| MLP | 3/24 · 6/24 · 31,099/262,144 | GELU at `corpus/tensor/mlp/main.tix:3` selects `tanhf` at `src/tensor/cuda-source.ts:29`. Host tanh is `src/tensor/evaluate.ts:19`, rounded at line 81. The output dot product at Tix line 4 combines differences across hidden units. |
| Random fixed core | 4/20 programs had at least one difference, maximum 1.2e−7 | The reproducible finite intrinsic discrepancies are `expf` at `src/tensor/cuda-source.ts:26`, `logf` at `src/tensor/cuda-source.ts:27` and `tanhf` at `src/tensor/cuda-source.ts:29`. For log the host path is `src/tensor/evaluate.ts:17` then line 81. The aggregate lacks the individual programs, inputs and divergent expressions. It does not determine which call each of the four executed. |

All three choices above become device calls at `src/tensor/cuda-source.ts:103`. For the optimized comparisons the interpreter and GPU consume the same tree. The blocked sum is constructed at `src/tensor/passes.ts:67` and the GPU rounds its accumulator at `src/tensor/cuda-source.ts:114`. Reassociation changes the tree relative to the original but is shared by the two sides of this comparison.

**Differences from f64.** The f32 and f64 interpreters select different rounding policies at `src/tensor/evaluate.ts:27`; arithmetic and folds round at lines 81 and 86. Exact f32 agreement for matmul, layernorm and conv2d leaves their nonzero differences from f64 intact. For matrix products and convolution, rounded multiplication (`src/tensor/cuda-source.ts:23`) and accumulation (line 114) are precision boundaries. Layernorm also rounds division (line 24), its epsilon literal (line 87) and square root (line 28). The small f64 differences for softmax, attention and MLP can include ordinary f32 rounding as well as the selected math call. Output maxima alone do not identify a unique term responsible for each f64 discrepancy. The two reference comparisons and all the supplied maxima are recorded in the [publication report](02-report.md).

### Reproduction and evidence

I printed the kernels returned by `cudaSource` for each named nonmatching function, before and after the two rewrites. Softmax had four kernels in both cases. Attention had six then five. MLP had three then two. Each retained its suspect intrinsic call. Running `node "$ticket/scripts/02-compare.mjs"` on the retained probe bytes reproduced the grid results, including these first differing words (host → GPU).

| Operation | Input | f32 words |
| --- | --- | --- |
| exp | −3.998291015625 | 0x3c964c61 → 0x3c964c60 |
| log | abs(−3.985595703125) + 0.125 | 0x3fb4efcb → 0x3fb4efcc |
| tanh | −3.69189453125 | 0xbf7faea0 → 0xbf7fae9f |

For a paired intervention, run `node "$ticket/scripts/06-isolate-math.mjs"` from the worktree root with the evaluated build. The script uses the actual emitted functions, fresh seed-20 f32 inputs, a shared host/device runtime and private names for each generated kernel sequence. Its diagnostic copy substitutes only the selected scalar math implementation. One untimed runner job (`f18b8be41eb9c276`, NVIDIA GB10, 12.1, runtime 13000) executed all pairs. Stock differed on 69/152 and 65/152 softmax words, 84/143 and 87/143 attention words, and 28/84 and 24/84 MLP words (original then optimized). The double-call copies, rounded to f32 at the original operation boundary, matched every word. This is a reproduction of the mechanism on known inputs. The coordinator supplied the independent counts and the exhaustive scalar comparison.

### Strength of the relation

Of the brief's two uniform relations, sampled tolerance to original f64 is the strongest justified for this emitter across the fixed core. A single `expf` witness falsifies universal f32 equality, and the same issue occurs for `logf` and `tanhf`. A conditional exact check against current f32 is stronger on computations using only matching operations in the prescribed order, treating NaNs as a class. The coordinator's exhaustive result supports exact intrinsic agreement for a different implementation using double calls followed by f32 rounding. It does not transfer those words to the shipped calls or prove a tight global tolerance to original f64.

### Review and follow-up

Inspect the three operation selections, the full-program paired comparison and the two separate reference columns in the report. An exact lowering check against current f32 and an origin-f64 budget after split-sum would make the two obligations separately visible. Attaching a per-program identifier and the first divergent operation to future random-evaluation summaries would make every failure replayable.

The final publication check resolved all ticket links, matched the CUDA excerpt against generated matmul, validated the independent word-count rows and passed docmgr doctor. A path-scoped diff against a441c31 was empty for src, tests, corpus and tools.
