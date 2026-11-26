---
Title: Implementation diary
Ticket: IRWB-022-G
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-022-G--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/scripts/01-math-probe/main.cu
      Note: GB10 measurement kernel
    - Path: repo://ttmp/2026/11/26/IRWB-022-G--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/scripts/02-read-probe.mjs
      Note: Stage-1 rounding and budget comparison
ExternalSources: []
Summary: Design checkpoint, reproducible GB10 arithmetic probe, and pre-implementation review boundary.
LastUpdated: 2026-11-26T15:15:00-05:00
WhatFor: Resume this stage from measured evidence and the reviewer's decisions.
WhenToUse: Before implementing or revising the checked CUDA lowering.
---

# Implementation diary

## Step 1: Find the rounding boundary on the actual target

Before writing an emitter I wanted to know what the contract could honestly promise. The GB10 executed small arithmetic probes using the same compiler and flags as a future lowering. The outputs rule out bit identity for standard CUDA float transcendental functions; they also give an output-error measurement relative to the stage-1 tolerance. The probes are fixed expressions, not prototype compiler code.

I then tried the proposed pass boundary locally with a real `AnalysisManager`, Tix input port, text output and an asynchronous test delegate. The existing framework replayed all cases on the second check and rejected a changed candidate. The missing piece is smaller than a remote pass runner: it is the ability to declare a differential check that has **only** a batch implementation.

### Prompt Context

**User prompt (verbatim):**

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`). Stage 1 built its front end, IR, f32 and f64 evaluators, a meaning contract and two checked passes. Its design and its final report are in ticket IRWB-020-B under `ttmp/2026/11/26/`. Read them first.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-022-G. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-022-G:`. Do not push.
- Final message: the ticket and design paths, the framework and tool changes you propose, the relation you chose for the lowering and the probe that established it, the commit hash.
Your ticket ID is IRWB-022-G. Name the ticket after the stage-2 work (lowering Tix to CUDA, checked, on the GPU machine).
````

**Assistant interpretation:** This is the design checkpoint, with enough real machine investigation to choose a numerical contract. Implementation and benchmarks wait for review.

**Inferred user intent:** Identify what a second language and a remote executor actually need from this framework; don't disguise a missing capability by reimplementing it inside Tix.

### What I did

- Started on `t2-pi-ax/irwb-022-g`, base `1880fc4`, Node v24.18.0. Read the stage-1 design/report first, then the requested framework docs, both pass paths, `differential.ts`, the tensor sources, fixtures and remote tool. Created the design and diary with `docmgr`.
- `npm ci --ignore-scripts --no-audit --no-fund && npm run build` succeeded. No full suite. Created only ticket-local reproducible design probes. Ran GPU jobs only via the stock tool, without `--timed`.
- Reproduce from worktree root (new local directories so an old `out/` can't furnish the answer):

```bash
P=$(echo ttmp/2026/11/26/IRWB-022-G*/scripts)
d=$(mktemp -d); cp "$P/01-math-probe/main.cu" "$d/"
node tools/cuda-remote.mjs "$d"
node "$P/02-read-probe.mjs" "$d/out/grid.bin"
sha256sum "$d/out/grid.bin"
d2=$(mktemp -d); cp "$P/03-platform-probe/main.cu" "$d2/"
node tools/cuda-remote.mjs "$d2" && node tools/cuda-remote.mjs "$d2"
node "$P/04-contract-probe.mjs"
rm -rf "$d" "$d2"
```

### Why

The straightforward candidate is a translation unit, so the useful question for the framework is whether it can check a differently typed output before accepting the transformation. A same-kind graph pass and a serial per-case interpreter both obscure that question. The arithmetic experiment asks a different question: whether the outputs of the chosen *actual* math implementations have the same words as Node's.

### What worked

- Math probe job `40108c4e0ad53bc2`, exit 0, retrieved `grid.bin` (393,240 bytes; SHA-256 `68a79b66fef3ab3a23f00e8ba899ed284dfc783a8043ab5d0a2aebe1ddda172a`). No output binary committed. Node computed the f32 and f64 references on the exactly specified grid; the design gives the per-expression mismatch counts and worst utilization.
- Platform probe job `a715b343ac3259a7`: first compiled, second `compiled:false`; both exit 0. NVIDIA GB10 12.1, driver 580.178.04, CUDA release 13.0 V13.0.88 build `cuda_13.0.r13.0/compiler.36424714_0`. Result `00000000 a8800000 00000002 00000000 80000000 events OK` (separate multiply/add, FMA, subnormal, max of opposite zeros, min of opposite zeros). These are operation/capability checks, not kernel timings.
- Local stand-in delegate, **not** GPU validation: two misses sent together, no delegate call on second check of identical text, both cases sent for mutated text. Manager output `commit: accepted` twice, then `reject: probe.diff: 1/2 sampled cases disagree`. Stats `{ baselineRuns: 0, subjectRuns: 0, replayed: 2, delegated: 4 }`.

### What didn't work

- The hypothesis of standard-library f32 bit identity failed. Example from the reader: `x=-7.998046875`, `exp` expected `39b0390f`, GPU `39b0390e`. Switching off FMA would not fix this scalar operation. The planned relation is against f64 instead.
- No probe command failed. The math fetch printed `tar: ./grid.bin: time stamp 2026-11-26 15:12:54 is 0.278453013 s in the future` (and similar directory mtime notices). Exit, byte length, digest and decoded results were checked; mtimes are not part of the evidence key.

### What I learned

The largest measured fraction of stage 1's `2e-6 + 2e-5*abs(r)` budget was 0.0210662 (rounded up), on the seven-term signed dot rather than any single intrinsic. This measures a sampled regime only. `baselineKey` caches the *cases* across delegated checks; the local baseline-outcomes array isn't filled by `decide`. Storing small reference outcomes with their origin-derived cases avoids rerunning the evaluator. `AnalysisManager` accepts a text port without a fake CUDA graph schema.

### What was tricky to build

The experiment must separate `Math.fround` after every operation (for the bit comparison) from Node double evaluation (for the budget). Comparing final GPU words only to rounded f64 for a composite expression would incorrectly count expected intermediate roundoffs as intrinsic discrepancies. The reader computes both paths. Similarly an origin f32 comparison after `split-sum` would measure an authorized prior change along with lowering error.

### What warrants a second pair of eyes

Review the finite-reference domain and choice of original f64 baseline, the limited framework change for a mandatory batch decider, and whether the tool identity check and per-job output separation justify their cost. The design separates inspect/execute from *accept*: the asynchronous transformation postcondition must see the very C text it claims to check. Watch that invariant in mutant tests.

### What should be done in the future

Wait for review **before** editing source. After review implement the approved ledger, run offline and GPU tests separately, measure all six full-size GPU/CPU pairs, and record actual changes and their reasons against the design. No performance evidence yet.

### Code review instructions

Start with [the design](../design-doc/01-lowering-tix-statements-to-cuda-with-a-batched-gpu-meaning-check.md), especially its two change ledgers. Compare the `decide` and `prepare` paths in `src/framework/contracts/differential.ts` with the contract probe, and the per-hash cwd/compile command in `tools/cuda-remote.mjs` with the proposed tool changes. Re-run the four small scripts with the commands above if needed.

### Technical details

No production source, existing tool, tests or corpus files changed at this checkpoint. The design gives the supported input domain, marshalling, expression/loop mapping, cache keys, case/evidence protocol, failure tests and scoped benchmark plan.

## Step 2: Review revision

Accepted both timing corrections and the proposed cut: preload functions before normal timing, emit `--benchmark` in the same main, and reuse process-local verdicts without remote identity queries. Runtime arguments change execution but not compilation. Keep per-job directories for concurrent identical inputs. The reviewer measured 0.115 vs 0.004 ms before/after preload on GB10. Base design: `35e01c4`. Next: implement and check the reviewed stage.

### Prompt context for Step 2 (user, verbatim)

````text
A reviewer has read your design for IRWB-022-G. The review:

# Review of your design

## Must change

1. **Benchmark mode is unspecified.** "In benchmark mode only, copy inputs once, launch a warm-up sequence then three measured sequences using the same allocated buffers". The unit has a single `main`. The design never says how this mode is selected (a program argument, or a field in `in.bin`) or whether `cudaSource` emits it. Program arguments are not part of the tool's hash. Specify the switch.
2. **`gpuMs` of `runTixCuda` includes kernel loading.** "`gpuMs` is the elapsed time between events on that stream immediately surrounding the sequence". Outside benchmark mode, nothing loads the kernels before timing. Under CUDA 13's default lazy loading, the first launch of each kernel loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. The fixed API excludes start-up.

## Cut

1. "`--describe` below is one cheap identity lookup per check even on replay", and the stamp in the run JSON. The memo is process-local, so an SSH query on every replay buys little.

## Framework and tool changes

- Batch-only `differential` variant: a small, real finding, since today's type forces placeholder `run`/`compare` when `decide` decides everything. Keep it to a spec type with `decide` required and no `run`/`compare`, plus guards on the sync and worker paths. It belongs in `differential.ts`; your tests are right.
- Compiler build and flags in the compile key: fine. `--describe`: not needed.
- Private invocation directory with a per-content compile lock: with the full-input key, two runs collide only if they upload byte-identical directories at the same time, for example two concurrent `checkLowering` calls on one function. It is needed only for that case, and it is minimal. Your test uses "different echoed arguments", but nothing in the design passes arguments.

## Keep

Keep the rounding-site table, the origin f64 budget with "do not increase the budget", the single `decide` batch with the references in the cases, failing the batch before memoizing anything, and the mutant submitted through `verifyTransformation`.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-G:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
````

## Step 3: Batch-only differential engine

Implemented the approved spec variant and guards in `differential.ts`; no change to local worker execution. An initial `npm run build` reported TS2345 on `runDifferential(spec, ...)` because the sync entry accepted only local specs. Narrowing inside that entry makes the runtime sync-mode diagnostic reachable for both TS and JS callers. Rebuild passed. `node --test tests/framework/batch-differential.test.mjs` passed cold, replay, partial replay, failure/retry and forbidden sync paths. Wider regressions follow integration.

## Step 4: From the current revision to a running GPU unit

`cuda-source.ts` emits each statement and its scoped private folds; `cuda-runtime.ts` supplies input, preload/events, repeated launch and output. `cuda-run.ts` executes one binary batch through the revised tool, validates its framing and copies f32 words without text conversion. `cuda-check.ts` binds the actual text output to an origin-derived f64 batch using the contract variant in `de9177a`. The existing sampler/comparator are shared; stage-1 execution is unchanged.

An actual GB10 smoke run on shape [3] returned [2,4,-6] and event time 0.017312 ms. All six corpus checks and the K=7 changed-split/mutant check then passed; the framework regression (227 tests) and selected Typed regression (36 tests) passed. More GPU edge tests and the long full-size local runs continue. The tool now obtains the compiler build inside the compile step, publishes a successful binary under a per-key lock, and fetches only the private job output; shell arguments for host/file operands are separated from options. No remote lookup on evidence replay.

## Step 5: Exercise the pass and its falsifier

At backend `abcbdfd`, the corpus oracles are shared between a network-free test and a separately runnable GPU test. The GPU tests submit a valid tail-dropping unit through `verifyTransformation`, then inspect rejected evidence for a coordinate; another checks that blocked K=7 really changed the bits. The concurrent normal/benchmark test compares the returned binary median to the benchmark stdout, so a swapped `out/` is observable.

`npm run build` passed; `node --test tests/tensor/*.test.mjs` passed 31/31, including the GB10 runs. `node --test tests/framework/*.test.mjs` passed 227/227. `node --test tests/typed/{meaning-memo,parallel,evaluate-analyses,passes,mutate,strategies}.test.mjs` passed 36/36. No EPERM, skipped case reported as success, or full-suite invocation. Next: record the six benchmark pairs and separate sampled-budget audit.

## Step 6: Measure the straight lowering, without extrapolating the interpreter

All six full-size CPU runs completed using the stage-1 evaluator, and each matched the input digest of its locked GB10 job. The [report](02-cuda-lowering-results-and-timing-protocol.md) gives every GPU sample and median, CPU wall time, and full-result comparison. The CPU machine was busy; the times are observed wall times, not exclusive CPU timings. Maximum absolute difference from the full f32 returns ranged from 0 to 1.43e-6. This is a diagnostic separate from the versioned tolerance relation.

`05-benchmark.mjs` ran `cpu`, `gpu`, then `compare` (comparison outside both timers). `06-budget.mjs` audited 86 eligible small cases; the worst fraction of the f64 budget was 0.246678 on conv2d. No tolerance adjustment. Build, scoped regression results and probe reproduction are recorded above and in the report. Test commit: `9d5130b`. No production deviations from the revised design.

## Step 7: Locate the first possible disagreement, not the last add

The evaluator's word counts looked quite different for matmul and attention, even though both use ordered dot products. I traced the current IR's operations and tested a paired intervention on generated kernels: change only the precision of the relevant library call. That sufficed to eliminate the mismatches on fresh inputs to the affected corpus functions. No change to the evaluated backend, tests, fixtures or tool.

### Prompt context (user, verbatim)

````text
Stage 2 of IRWB-022-G has been evaluated independently, at your last commit. Your results:

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
  - matmul: 262144/262144 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 0.246
  - softmax: 2616298/4194304 elements bit-identical to the f32 meaning, largest difference 3.7e-9 (scaled by max(1, |r|)); your `gpuMs` 0.396
  - layernorm: 4194304/4194304 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 0.476
  - attention: 10618/65536 elements bit-identical to the f32 meaning, largest difference 3.7e-8 (scaled by max(1, |r|)); your `gpuMs` 1.569
  - mlp: 231045/262144 elements bit-identical to the f32 meaning, largest difference 2.2e-5 (scaled by max(1, |r|)); your `gpuMs` 1.000
  - conv: 984064/984064 elements bit-identical to the f32 meaning, largest difference 0 (scaled by max(1, |r|)); your `gpuMs` 0.350
- **`checkLowering` on the six corpus programs and ten random ones:** accepted 16/16, relation tolerance, 3.2 s per check on average.
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
3. **Commit** (message starting `IRWB-022-G:`). Final message: the report's path, the commit hash, one line per difference cause, and your one-paragraph answer on the relation.
````

### Diagnosis at evaluated revision `252af7a`

The interpreter rounds at `src/tensor/evaluate.ts:80` (`round` selected at `src/tensor/evaluate.ts:26`); the selected JS library calls are at `src/tensor/evaluate.ts:15–18`. In CUDA the emitter renders the selected call at `src/tensor/cuda-source.ts:103`.

| Observed GPU ≠ f32 (small original; small optimized; full original) | Source and lowering site | Path to the return |
| --- | --- | --- |
| softmax (22/76; 20/76; 1,578,006/4,194,304 different) | `corpus/tensor/softmax/main.tix:3` → `src/tensor/cuda-source.ts:19`, `expf` | The max-shifted exp can already differ given identical operands. The row sum changes the divisor used at every output. |
| attention (16/72; 25/72; 54,918/65,536 different) | `corpus/tensor/attention/main.tix:4` → `src/tensor/cuda-source.ts:19`, `expf` | Exponentiate shifted scores, normalize, multiply by values, fold. The sqrt in the score and ordered dot products are not competing transcendental approximations. |
| mlp (3/24; 6/24; 31,099/262,144 different) | `corpus/tensor/mlp/main.tix:3` → `src/tensor/cuda-source.ts:21`, `tanhf` | GELU's tanh changes the hidden activation before the second affine layer. Its final maximum scaled Δ32 of 2.2e-5 is not a single-call error for tanh. |
| Random (4/20 programs had at least one different word; max 1.2e-7) | `src/tensor/cuda-source.ts:19` (`expf`), `:20` (`logf`), `:21` (`tanhf`) are the three identified finite libcall mechanisms in the fixed core. | Without the four programs/inputs or a first-divergence trace, the counts cannot be disaggregated. In particular, none of the named corpus paths uses `logf`; a separate log-only witness is evidence for a mechanism, not identification of a hidden program. |

**Against f64 instead:** `src/tensor/cuda-source.ts:15` (`__fmul_rn`) and `:122` (fold `__fadd_rn`) introduce f32 roundings in matmul, conv, scores and both MLP layers; `:13–16` and `:22` implement rounded scalar arithmetic/division and sqrt in normalization. Layernorm also rounds the epsilon expression and subsequent scale/shift; MLP rounds nonrepresentable literal constants (`src/tensor/cuda-source.ts:84–86`). The reference in f64 retains double results. Thus even each 100%-f32-match row can have nonzero Δ64, without a GPU error. In softmax, attention and MLP the f64 residual includes ordinary per-operation roundoff *as well as* the libcall choices. The split rewrite at `src/tensor/passes.ts:70` nests the fold; this can change the Δ64 numbers but cannot be an extra discrepancy from the *optimized* f32 comparator. It uses the same fold tree. The supplied maxima do not identify which individual multiply or add rounded a worst-case f64 residual.

### Probe, result and limits

To isolate each suspect operation from all these downstream roundings I kept the same current function, buffers, expressions, loops and compiler flags. A ticket-local script assembles stock and diagnostic copies of the generated units in separate namespaces with independent output files. Only the diagnostic copy substitutes `__double2float_rn(op((double)arg))` at the one libcall. A single invocation of `node ttmp/2026/11/26/IRWB-022-G*/scripts/07-isolate-intrinsic.mjs` used the standard remote tool, **untimed** on GB10; job `5b78c7031a4836bed5b1c1dee3ecf3c36b3ca34d03fac20af3326dc168350808` exited 0. No production patch, benchmark or hidden test rerun. The script asserts f32 *word* counts, not approximate agreement.

| Fresh example | Stock differing words (original, optimized) | Only the named call widened |
| --- | --- | --- |
| softmax, 171 outputs | 51, 70 | 0, 0 |
| attention, 117 outputs | 46, 57 | 0, 0 |
| mlp, 143 outputs | 8, 13 | 0, 0 |
| log of inputs `1+i/1024`, 16,385 outputs | 902 (original only) | 0 |

The standalone grid and the paired corpus outputs worked on the first run. The informative failure is the stock word comparison, not a transport failure. To review, run the script from repo root after the build and compare `src/tensor/cuda-source.ts:19–22` with the call replacement. A future independent run should retain a minimized failing source, input and intermediate word for each random case; output counts alone cannot recover them.

**Strength of the relation.** Of the two uniform API choices, `tolerance` is the one supportable for this evaluated emitter: its float exp/log/tanh have concrete counterexamples to exact f32 lowering. That is not a proof that the numerical constants are tight or that the budget holds on unsampled inputs. An exact-to-current-f32 check could be stronger on the finite arithmetic-only subset. The coordinator's exhaustive comparison supports targeting exactness on GB10 with different calls (double exp/log/tanh followed immediately by f32 rounding), NaNs compared as a class. It does not establish bit identity for the shipped calls, NaN payload equality, or equality to the unsplit origin after a permitted reassociation. See the [final report](02-report.md).
