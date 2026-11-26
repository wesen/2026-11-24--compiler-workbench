---
Title: Implementation diary
Ticket: IRWB-022-B
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
Summary: Design checkpoint and evidence for the first GB10 and cross-kind framework probes.
LastUpdated: 2026-11-26T15:12:33.262379464-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1 — Decide the lowering boundary and numerical relation

I read the Stage 1 design and final report before inspecting the compiler and remote tool. The checked pass can use the existing contract manager across artifact kinds. The lowering will emit CUDA source from the selected Tix revision, so it needs neither a kernel IR nor changes to the v6 edit runner.

The GB10 probes measured which rounding sites survived the current compiler flags and how far CUDA's intrinsics differed from Node. The proposed contract compares the GPU output with f64, using the current Tix f32 result to account for drift attributable to the Tix arithmetic and its reduction order.

### Prompt context

**User prompt (verbatim)**

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`). Stage 1 built its front end, IR, f32 and f64 evaluators, a meaning contract and two checked passes. Its design and its final report are in ticket IRWB-020-B under `ttmp/2026/11/26/`. Read them first.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-022-B. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-022-B:`. Do not push.
- Final message: the ticket and design paths, the framework and tool changes you propose, the relation you chose for the lowering and the probe that established it, the commit hash.
Your ticket ID is IRWB-022-B. Name the ticket after the stage-2 work (lowering Tix to CUDA, checked, on the GPU machine).
````

**Interpretation.** Deliver a reviewable design and its evidence on the current branch. Use standalone ticket probes to answer the numerical and framework questions before implementing the public API and timing the corpus.

### Evidence and recovery

- Ran `npm run build` on Node 24.18.0, the three existing tensor test files by name and `node --test tests/framework/ext-e5.test.mjs`. All 16 tensor tests and four E5 tests passed.
- Ran `node ttmp/2026/11/26/IRWB-022-B--*/scripts/02-contract-probe.mjs`. The asynchronous cross-kind invariant generated its cases once and submitted three two-case batches across four checks. It replayed two decisions on the second check, rechecked a new engine identity and rejected changed code.
- Ran `node ttmp/2026/11/26/IRWB-022-B--*/scripts/01-gb10-probe/run.mjs` through the unchanged `tools/cuda-remote.mjs`. The probe used Node's async `execFile` and the rerun exercised the existing compile cache. The final receipt contains versions, inputs and output hashes, sample counts and error fractions. The GPU was used for conformance without a timing lock. [GB10 receipt](../scripts/01-gb10-probe/observed.json)
- While extending the probe from three to four fold observations per row, the JavaScript decoder stopped with `Error: Unexpected output length`. The compiled harness still sized its output for three fold observations. I fixed the buffer sizing and reran the probe before using the observations.

### Design decisions and review

The default tool key couples input bytes to compilation and puts concurrent jobs with the same key in the same working directory. The proposed runtime-input option and per-invocation workspace let one binary process many distinct batches and keep output fetches independent. The driver and compiler queries ran on the remote host through the probe. A versioned engine identity gives verdict replay a boundary independent of the compile cache.

The numerical review should focus on the treatment of cancellation and nonfinite results, plus the choice of the current revision as the reference for optimized functions. The staged implementation can then exercise the proposed comparison on emitted CUDA and produce full-size timings. [Design](../design-doc/01-checked-cuda-lowering-for-tix.md)

## Step 2 — Apply the review and calibrate the proposed relation

The reviewer asked for a single distance-to-f64 relation, no identity round trip or in-flight coalescing, and ordinary kernel arguments. I adopted all of those changes. The contract uses the existing Stage 1 absolute and relative budget directly on finite f64 references from the selected revision.

### Review and evidence

**User prompt (verbatim)**

````text
A reviewer has read your design for IRWB-022-B. The review:

# Review of your design

## Must change

1. **State the relation you actually enforce.** "For finite `s`, require finite `g` and `abs(g - s) <= B(s)`. When `r` is also finite, require `abs(g - r) <= max(B(r), abs(s - r) + B(s)/8)`." By the triangle inequality the second clause holds whenever `abs(g - s) <= B(s)/8`. So the governing bound is the distance to the f32 result, not a tolerance against f64 as the brief asks. The 1/8 constant is justified on "2,048 rows of 32 values … with corpus verification still to come", not on the contract's own cases. Write the relation in one line and justify its constants on the cases `checkLowering` generates. For reference (my local check): on the stage-1 tolerance cases, the f32 meaning of every corpus program (original and optimized) uses at most 25% of `B(r)` against f64.

## Cut

1. "Add an `--identity` query and an optional `--expect-identity` … On a warm check the identity query runs". The memo is process-local; this adds an SSH round trip per check to catch a mid-process toolchain change.
2. "The local runner also coalesces identical in-flight checks under the same keys". No caller of the fixed API needs this.
3. "A small device struct carries bound dimensions and a pointer per tensor." The parameter-block worry is speculative; pass shapes and pointers as kernel parameters.

## Framework and tool changes

- No framework change: correct. `execute` takes differently typed ports and awaits an async `ensures`. `decide`, `baselineKey` and `subjectKey` already batch the cases and replay verdicts.
- `--input cases.bin`, kept out of the compile key: needed, minimal, correctly placed.
- Per-invocation directory, compile lock, atomic install: needed once the data leaves the key.
- `--identity`: not needed.

## Keep

Keep the `__f*_rn` rounding sites, the literal bits, the JS min/max rule, the single `decide` batch, and "load kernels with `cudaFuncGetAttributes` before timing". In my probe on the GB10, a kernel's first event interval in a process was 0.115 ms and its second 0.003 ms; with that preload the first was 0.004 ms.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-B:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
````

`node ttmp/2026/11/26/IRWB-022-B--*/scripts/03-corpus-calibration.mjs` exercised the selected case recipe across all six corpus functions, original and with both optimization orders. It found 16–24 admitted cases per variant and a largest f32-to-f64 error of 24.67% of the existing tolerance, in conv2d. The earlier cancellation microbenchmark shows why that tolerance is a sampled obligation. The end-to-end GPU checks will measure the same recipe against emitted code. [Calibration results](../scripts/03-corpus-calibration.jsonl)

Design revision `4a00e67` — `IRWB-022-B: Revise CUDA lowering design after review`.

## Step 3 — Implement direct emission and the checked remote path

The emitter materializes statements in the current revision, generates scoped C++ loops from the binder IDs, and implements the f32 rounding points explicitly. The generated main and the Node runner share the binary case protocol. The same translation unit runs a single user input, a sampled batch, or repeated event intervals for timing.

The checked transformation uses `AnalysisManager.execute` and the existing differential invariant with an async `decide`. I extracted the Stage 1 input generation and tolerance into `src/tensor/samples.ts`, preserving the existing optimizer's case order. The CUDA check adds the zero-dimension assignment and uses the current f64 reference to screen cases. The remote tool uses the compile file key for reuse and a private job directory for data and results.

### Build and recovery

`npm run build` initially reported TS2339 for `axes`, `body` and `op` inside the emitter's nested loop function and for `revision` on the differential framework's union of port values. I captured the narrowed reduction fields before defining the nested function and read the typed `subject` input inside `subjectKey`. The next build and the three local CUDA tests passed.

The CPU timing job runs in tmux with one measured Stage 1 f32 execution per shape. `node --test tests/tensor/*.test.mjs` passed all 25 tests, including original and optimized corpus lowerings, semantic witnesses, an altered kernel's rejection, memo replay, and isolation between jobs sharing a compile key.
