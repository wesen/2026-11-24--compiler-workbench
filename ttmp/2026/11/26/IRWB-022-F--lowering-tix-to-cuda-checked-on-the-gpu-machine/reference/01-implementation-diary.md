---
Title: Implementation diary
Ticket: IRWB-022-F
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
Summary: Design investigation and GB10 numerical probe before implementation.
---

# Implementation diary

## Step 1: Select a numerical relation and a checked pass boundary (2026-11-26)

I read the stage-1 design and report, then traced the current tensor evaluator, pass runner, differential contract and remote harness at `1880fc4`. This checkpoint is design-only. I tried the two uncertain components separately: a cross-kind asynchronous transformation in Node and a numerical kernel on bling.

The GPU probe ruled out swapping the JS intrinsics for CUDA’s f32 intrinsics under an exact relation. The framework probe showed that `defineTransformation` plus the existing async differential callback can check a new artifact kind and replay per-case verdicts without extending the edit runner.

### Prompt Context

**User prompt (verbatim):**

~~~~markdown
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`). Stage 1 built its front end, IR, f32 and f64 evaluators, a meaning contract and two checked passes. Its design and its final report are in ticket IRWB-020-B under `ttmp/2026/11/26/`. Read them first.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-022-F. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-022-F:`. Do not push.
- Final message: the ticket and design paths, the framework and tool changes you propose, the relation you chose for the lowering and the probe that established it, the commit hash.
Your ticket ID is IRWB-022-F. Name the ticket after the stage-2 work (lowering Tix to CUDA, checked, on the GPU machine).
~~~~

**Interpretation and intent:** Submit the backend design and evidence for review, not production code or corpus timing yet. Treat fit or mismatch with the reusable framework as a result, not as something to hide behind tensor-specific adapters.

### What I did and why

- Created the ticket and this diary with `docmgr`, and wrote the [design](../design-doc/01-checked-tix-to-cuda-lowering.md).
- Ran `npm run build` on Node 24.18.0. Probed two numeric artifact types in a `node --input-type=module` snippet. Defined a cross-kind transformation with `cache: 'never'` and a two-case asynchronous `differential` postcondition. Called `AnalysisManager.execute` twice and then `verifyTransformation` with a valid but changed output to see whether replay would mask rejection.
- Ran `node ttmp/2026/11/26/IRWB-022-F--*/scripts/01-probe-numerics.mjs` using the unmodified remote tool without `--timed`. The script embeds a standalone CUDA kernel to compare proposed intrinsics and ordered accumulation with JS, and checks that device event timing works. No lowering code was used.

### What worked

- Build passed. The framework probe produced `{ baselineRuns: 0, subjectRuns: 0, replayed: 2, delegated: 4 }`. The two equal candidates passed and the distinct candidate rejected. The callbacks did not use same-kind edits or publish a rejected result.
- The GPU was NVIDIA GB10, `sm_121`, `nvcc 13.0.88`. `expf` disagreed bitwise with the rounded JS result on 9,821 of 32,768 inputs, but its maximum discrepancy was under 0.64% of the proposed tolerance. `logf` and `tanhf` also disagreed bitwise. The 1024-term dot matched JS f32 and fit the f64 tolerance. The event pair returned a positive interval. The design records the detailed numbers and limits of the evidence.

### What didn't work

The straightforward exact relation fails for the proposed intrinsics. The remote tool also printed `tar: ./results.bin: time stamp 2026-11-26 15:13:57 is 0.145889348 s in the future` (and a similar warning for `.`) on one successful run. The returned bytes decoded correctly; no clock assumption is used by CUDA event timing. No build or probe command failed.

### What I learned / what was tricky

The generic pass runner is an in-kind edit interface, but the contract manager already models cross-kind lowering. Delegated differential checks reuse per-case verdicts, not baseline-outcome slots filled by local `run` calls. Keep references with the baseline cases instead. The tool’s compile cache also doubles as a working directory, so repeat checks need separate staging lifetimes even if executable reuse is safe.

### Review and next checkpoint

Review the current-versus-origin baseline choice, the finite tolerance and nonfinite cases, the short-lived engine identity boundary, and whether the opt-in remote cache/staging change is the smallest safe extension. Re-run the standalone probe from the repo root to reproduce the numeric witness. Wait for review before implementing or measuring the corpus; no production source, existing tests or tools were modified in this checkpoint.

## Step 2: Apply the design review

I adopted the reviewer’s changes: preload every launched kernel before timing, keep warm-up and repetitions in one process, specify a 120-second subprocess timeout, and remove full-size f64 runs, engine epochs and in-flight coalescing. The existing cross-kind pass and delegated verdict cache still fit.

### Prompt Context

**User prompt (verbatim):**

~~~~markdown
A reviewer has read your design for IRWB-022-F. The review:

# Review of your design

## Must change

1. **`gpuMs` includes kernel loading.** "Warm up once, then take three short repetitions". This does not say that the warm-up shares a process with the repetitions, and the one-case `runTixCuda` path has no warm-up at all. Under CUDA 13's default lazy loading, the first launch of each kernel loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. The fixed API excludes start-up. State both points.
2. "asynchronously invoke `tools/cuda-remote.mjs` as a Node subprocess with explicit arguments and bounded execution". "Bounded" is undefined. Give the timeout and say what it returns, or drop the word.

## Cut

1. "Report worst observed error/budget ratio on the six full-sized corpus runs", and "Compute full-size f64 comparison errors outside timing". These are extra full-size f64 interpreter runs beyond the timing table, while your tolerance is a claim about the sampled cases.
2. "a short-lived process-local engine epoch … Scope baseline entries to the same epoch as well". The evidence is already process-local, the tool reports no toolchain version that could bump the epoch, and nothing else defines when it changes.
3. "Coalesce identical in-flight checks in the tensor layer and clear on settlement." No caller of the fixed API needs this.

## Framework and tool changes

- No framework change: correct. Two `defineIR` kinds with `execute` and an async `decide` cover the check, as your probe showed.
- Opt-in standalone mode with a per-invocation directory, an executable cached by source digest, and a compile lock: needed, minimal, correctly placed, and the legacy mode is kept.
- No change missed.

## Keep

Keep the current revision's f64 reference with the f32 fallback for nonfinite elements, the explicit rounding table and JS zero rules, one `decide` batch with the references stored in the cases, and the targeted exact-word tests for split order.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-F:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
~~~~

### Next

Implement the revised backend and opt-in transport, then validate both the fixed API and timed corpus runner. No review items were declined.
