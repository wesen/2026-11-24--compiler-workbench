---
Title: Design and implementation diary
Ticket: IRWB-022-D
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-022-D--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/scripts/01-probe.cu
      Note: Device arithmetic and identity probe
    - Path: repo://ttmp/2026/11/26/IRWB-022-D--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/scripts/02-probe.mjs
      Note: Reproduce the numerical comparison from the worktree root
ExternalSources: []
Summary: Chronological decisions, probes, failures and review checkpoints.
LastUpdated: 2026-11-26T15:16:00-05:00
WhatFor: ""
WhenToUse: ""
---

# Design and implementation diary

## Step 1: Test the numerical relation and the contract boundary before writing a backend

At `1880fc4` I read the IRWB-020-B design and final report first. Stage 1 deliberately allows `split-sum` to change f32 words. I wanted to distinguish that prior numerical decision from one introduced by the device itself. I compared both a single intrinsic and a short ordered fold to Node on identical inputs. The very first failing `exp` argument needs no optimizer to reproduce it.

A second, local probe asked whether the proposed cross-representation pass actually requires a new framework API. The existing differential invariant accepted a scalar source port, delegated a batch, replayed its verdicts, and checked changed text afresh. That is stronger evidence for leaving the framework alone than the existence of an `async` keyword.

### Prompt context

<details><summary>User prompt (verbatim)</summary>

You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`). Stage 1 built its front end, IR, f32 and f64 evaluators, a meaning contract and two checked passes. Its design and its final report are in ticket IRWB-020-B under `ttmp/2026/11/26/`. Read them first.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-022-D. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-022-D:`. Do not push.
- Final message: the ticket and design paths, the framework and tool changes you propose, the relation you chose for the lowering and the probe that established it, the commit hash.
Your ticket ID is IRWB-022-D. Name the ticket after the stage-2 work (lowering Tix to CUDA, checked, on the GPU machine).

</details>

**Interpretation and intent.** Commit a reviewable plan with measured design evidence. Do not ship the lowering yet. The question is what machinery is reusable across domains and what would need to change, not just whether CUDA can run a tensor loop.

### What I did and why

- Inspected `evaluate.ts` (per-node round), `model.ts`/`passes.ts` (explicit block/tail bound trees), `contract.ts` (finite-origin tolerance cases), the IR/pass and contract interfaces, and the complete remote tool. Created the ticket with `docmgr`. Chose direct emission from `current` and checking the actual candidate text rather than an intermediate kernel representation.
- Ran `npm ci --no-audit --no-fund && npm run build`. Probed `AnalysisManager.verifyTransformation` in Node with `TixIR` input, `defineType<string>` output, `cache:'never'`, a differential `ensures`, three mock cases, a throwing synchronous fallback and `decide: async (...) => todo.map(...)`. Keyed on input revision and output text, ran `good`, `good`, `wrong`.
- Ran `node ttmp/2026/11/26/IRWB-022-D*/scripts/02-probe.mjs` from the root (twice). The script invokes only `tools/cuda-remote.mjs`, with **no** `--timed`; the device code checks event synchronization and the comparison reads returned f32 bytes. This run tests numerical behavior, not performance.

### What worked

Remote hash `125ce3e8145a4c95`, exit 0, first compile 649 ms, second `compiled:false`. All 8192 × 6 outputs returned. See the [design's measurement table](../design-doc/01-a-checked-tix-to-cuda-lowering-on-gb10.md#which-relation-and-what-established-it) for the evidence: 2468 f32 mismatches for exp, largest measured fraction of the f64 budget below 0.03 across all columns. The mocked framework probe reported `(delegated,replayed)` of `(3,0)`, `(0,3)`, `(3,0)` respectively. Last check rejected with `ContractError: probe.batch: 3/3 sampled cases disagree` as intended.

Baseline `node --test tests/tensor/corpus.test.mjs tests/tensor/language.test.mjs tests/tensor/passes.test.mjs`: 16/16 pass. No stage-2 code or large timings yet.

### What didn't work

Bit identity with standard device libm didn't hold even for a single exp (see the first failing argument in the design). The transport didn't fail; the first fetch printed `tar: ./probe.bin: time stamp 2026-11-26 15:12:47 is 0.621681124 s in the future`. Exit, output length and comparison were normal. No EPERM or escalation.

### What I learned / what was tricky

Executable reuse is not evidence reuse. The tool hashes *data* as well as source; it also shares a writable remote `out/` between calls with identical hashes. Meanwhile `differential` already hands all unseen case indices to a single async decision. To reuse only the right verdicts, key on candidate bytes and the identified remote profile, not just a Tix revision. Transport failure must not produce an array of inconclusive or cached numerical verdicts.

### Second pair of eyes

Review the choice of the origin f64 budget after `split-sum`, the finite-reference sample domain, the stable-profile assumption for process-local reuse, and the proposed tool change for shared-machine output isolation. The probe measures a candidate policy on specific arguments, not an error theorem about arbitrary Tix programs.

### Next / review instructions

Read the design and replay the two probe files from the root if needed; the scripts are standalone, not the implementation. Await review before changing `src/`, tests or the tool. Implementation tests must include a structurally plausible wrong *compiled* candidate, not just a mocked GPU returning bad values.

## Step 2: Accept review before coding

I revised the profile contract: no preparatory remote probe, process-local stability, explicit sources for the configured profile and observed versions. The concurrency test now uses the real identical-batch collision, not different argv. No review item was declined. Implementation means the reviewed CUDA stage, leaving stage 1 behavior intact. Design checkpoint `f85f8bc`.

<details><summary>Review and instruction (verbatim)</summary>

A reviewer has read your design for IRWB-022-D. The review:

# Review of your design

## Must change

1. **Name the source of each identity field.** "profile identity (host, GPU/arch, compiler build/path/flags, driver)". A CUDA program, including your "tiny tool-run identity probe", can report the device, the driver and the runtime version (13000), but not the `nvcc` build. Your tool change computes `nvcc --version` for its compile key, but the ledger does not put it in the tool's JSON. Either add it there in the same change, or declare the compiler build a constant of the checker's version for the life of the process.

## Cut

1. "identify a profile once per verification session via a tiny tool-run identity probe; verify cold batch metadata matches it." Reuse is "process-local reuse only", so the process already pins the profile. The extra remote compile and run guard only against a toolchain change in the middle of a session.

## Framework and tool changes

- No framework change: correct. `decide` batches the pending indices, `baselineKey`/`subjectKey` replay verdicts, and `verifyTransformation` takes an IR input with a scalar output.
- Per-invocation directory with a build lock and atomic publication: with the full-input key kept, two runs collide only if they upload byte-identical directories at the same time, for example two concurrent `checkLowering` calls on one function. It is needed only for that case, and it is minimal and correctly placed. Your test's "different program arguments" has no caller in this design.
- `nvcc --version`, flags and length-framed names in the compile key: fine.
- No change missed.

## Keep

Keep the explicit rounding sites, the literal bits, the JS NaN and zero rules, and the origin f64 reference as one end-to-end budget. That budget has margin: on the stage-1 cases, the f32 meaning of every corpus program uses at most 25% of it (my local check). Also keep throwing before returning any verdict on an incomplete batch, and "initialize the context and load kernels before measuring". In my probe on the GB10, a kernel's first event interval in a process was 0.115 ms and its second 0.003 ms.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-D:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.

</details>
