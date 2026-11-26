---
Title: Design and implementation diary
Ticket: IRWB-022-K
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
