---
Title: Checking Tix CUDA lowering on the GB10
Ticket: IRWB-022-L
Status: review
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/analysis-manager.ts
      Note: Cross-type transformation verification
    - Path: repo://src/framework/contracts/differential.ts
      Note: Asynchronous batch delegation and cached verdicts
    - Path: repo://src/tensor/contract.ts
      Note: Source-derived cases and finite f64 tolerance
    - Path: repo://src/tensor/model.ts
      Note: Bound scalar expressions and generated extents
    - Path: repo://tools/cuda-remote.mjs
      Note: Remote execution, compile reuse and shared run-directory finding
ExternalSources: []
Summary: Direct CUDA emission, the measured numerical relation and the remote acceptance gate.
LastUpdated: 2026-11-26T15:20:53.027308001-05:00
WhatFor: ""
WhenToUse: ""
---

# Checking Tix CUDA lowering on the GB10

Emit one CUDA translation unit directly from the selected function in `program.current`. Check the emitted bytes as the output of a framework transformation. Use a **sampled tolerance against the original function evaluated in f64 on identical f32 inputs**. On the GB10, `expf(1 + 2^-23)` gave `0x402df855` where stage-1 f32 gave `0x402df856`. This rules out bit identity for the proposed emitter even with a single operation and no reduction.

## What the lowerer accepts

The input is a stage-1 `TixProgram` from `compileTix` or `optimizeTix(...).program` and the name of a function it contains. Calls supply finite, row-major Float32Array values for the declared parameters. Ranks, lengths and affine dimensions agree, plain parameter axes bind the shape names, extents are nonnegative and all executed reads are in bounds. Dimensions, affine intermediates and linear indices are exactly representable in the stage-1 integer arithmetic, and the live tensors and launch fit the target machine. Any rank in that domain is supported. Zero extents, a return of a parameter, unused statements, nested shadowing and nonfinite *computed* results are included. The contract's small sampled shapes limit the evidence, not which functions can be lowered or run.

Three public operations share one emitter. `cudaSource(program, fn)` returns the complete candidate text synchronously. `runTixCuda(program, fn, inputs, {host}?)` executes that candidate and resolves to the output shape, Float32Array and event time in milliseconds. `checkLowering(program, fn)` applies the checked lowering on the designated GB10 and returns `{accepted, relation:'tolerance', reason?}`. Only this last path labels a lowering accepted. Asking for source or running a particular input should not require executing an unrelated suite of sample inputs. The check executes the actual output port's text through the same batch runner as a one-case call. Regenerating source inside the checker could let it pass a defective candidate.

## From one statement to one kernel

`Fn.statements` already gives the launch order. Each `Statement` has a shape, free axes and a resolved `Expr` with explicit reductions. A second kernel IR and adapter would duplicate those fields for a stage with only one consumer, the CUDA emitter. A native `definePass` would require both sides to share one IR type and adapter. Use `defineTransformation` for the cross-type pass, with input ports for current and origin (`TixIR`) and function name, and a validated string port for CUDA output. The checked pass calls the same synchronous emitter as `cudaSource`, then supplies its output and typed inputs to `AnalysisManager.verifyTransformation` for the differential `ensures` check. This path also allows a test to submit altered CUDA to the real gate.

- Number tensors, shape values, binders and scalar temporaries in separate implementation-owned namespaces. Look up loads by tensor and indices by resolved binder ID, including generated IDs containing `/`. Do not turn a Tix name into C syntax. The host main binds all plain parameter axes before evaluating any affine dimensions. Pass device pointers and shape bindings through launch data with lifetimes covering the launches.
- Allocate an f32 buffer for each parameter and statement, upload inputs, and enqueue one distinct kernel for every statement with elements, on one stream. For matmul, a thread at linear offset `p` writes `y[p]`, with `i=p/N` and `j=p%N`. In general, decode the last axis first by remainder and quotient, guard padding threads, and fold each affine read coordinate into its row-major offset. Use signed 64-bit affine arithmetic and wide linear offsets, including the block-index multiplication. Use a one-dimensional grid of 128-thread blocks. This mapping has exactly one writer per output element.
- Lower each expression recursively to scalar temporaries in evaluation order. A reduction initializes a local accumulator (sum `+0.0f`, max negative infinity), emits the first listed axis as the outermost loop, updates once per body value, then returns its accumulator. Each nested fold owns its initialization. `dim` evaluates the symbolic bound. `blocks` uses integer quotient plus the nonzero-remainder bit for ceil (plain quotient for floor), and `tail` uses `min(width, dim - width*block)`. Use the IR's `width` and composed affine reads. A width-four split of seven terms therefore executes two separately rounded inner folds of lengths four and three. A single flattened sum would lose an accepted stage-1 rewrite.
- Skip zero-byte allocations/copies and zero-grid launches. A nonempty output with an empty reduction still launches and writes the identity. A function with no launched kernels returns its named buffer and `gpuMs = 0`. A returned parameter may also follow statements whose kernels must run and count towards time.

| Scalar in Tix | Device expression under `nvcc -O3 -arch=sm_121` |
| --- | --- |
| Literal, shape, load | Materialize the bits of `Math.fround(Number(text))` as a CUDA float bit-cast, convert an integer shape to nearest f32, or read the stored float. This preserves the literal's JS parse even at a rounding boundary. |
| Negation, `+ - * /`, sum step | Negate the float or use `__fadd_rn`, `__fsub_rn`, `__fmul_rn`, `__fdiv_rn`. Explicit rounding at each node keeps multiplication and addition separate under `-O3`. |
| exp, log, sqrt, tanh | `expf`, `logf`, `__fsqrt_rn`, `tanhf` on the rounded operand. Keep default denormal handling and omit fast-math flags. |
| min, max, max step | Propagate NaN if either operand is NaN. For two zeros choose the sign by bitwise OR for min and AND for max. Otherwise select the numerical min/max. This covers JavaScript's zero ties and NaN behavior even inside another operation. |

## Measured relation

The probe sent 4,096 deterministic pairs of f32 inputs through each of ten expressions, then ran the matching Tix functions with both stage-1 evaluators on Node 24.18.0. Seed 22 supplies signed `x` in [−2,2] and positive `y` in [0.125,2], with two pairs substituted to exercise contraction and subnormal handling. The dot product uses seven consecutive pairs with wraparound. The tool reported NVIDIA GB10, sm_121 and nvcc 13.0.88. The event smoke test timed one warmed launch and obtained 0.005472 ms. [Probe driver](../scripts/02-measure.mjs) · [Recorded result](../scripts/04-probe-result.json)

| Operation | GPU words different from stage-1 f32, out of 4,096 | Largest fraction of the f64 allowance used |
| --- | ---: | ---: |
| exp | 1,243 | 0.00614 |
| log | 294 | 0.00336 |
| tanh | 1,169 | 0.00758 |
| seven-term dot | 0 | 0.15603 |
| mul followed by sub | 0 | 0.02840 |
| individual add, sub, mul, div, sqrt | 0 each | <0.00284 each |

For each finite f64 result `r`, require a finite GPU result `g` of the same shape with `abs(g-r) <= 2e-6 + 2e-5*abs(r)` at every coordinate. This is the stage-1 split budget. The absolute term allows cancellation near zero, which produced the tightest observed fraction in the dot test. The measurements support this budget for the small check cases. They give no uniform error bound for arbitrarily long reductions or ill-conditioned programs. Exact comparison would reject the measured exp witness. Porting a JS math library to CUDA solely for word identity would require a different implementation and evidence. Tests can still require exact results for rounding, signed zeros, and loop order when the selected operations permit it.

Use `program.origin` as the f64 reference and `program.current` as the code-generation input. This keeps a prior split and the CUDA lowering within one end-to-end budget. A tolerance against the immediate f32 result could spend the budget a second time. Independently test that the CUDA result reproduces the *current* grouping on the seven-term witness, where both groupings satisfy tolerance.

## Execution and evidence

The translation unit reads a little-endian `cases.bin`. Its header holds three u32 fields in order: format version, case count and timed repetitions. Zero repetitions executes once without timing (the contract), one warms once and times once (the public run), and three warms once and times three repetitions (the benchmark). Each record has a u32 case ID and, for each parameter in declaration order, u64 extents (rank known to this function) and the contiguous f32 payload. Encode only a view's own elements, including for subarrays. The program writes `out/results.bin` with the same version, count and IDs, each actual return shape, one f32 millisecond interval per requested timed repetition and the return words. Use fixed-width fields without C struct padding. The runner verifies IDs, sizes and complete framing before comparing. Binary transport preserves zero sign and nonfinite results and keeps the multi-million-element benchmark cases practical. JSON number arrays would lose special values and require considerably more memory.

The Node parent stages each call privately and asynchronously invokes `node tools/cuda-remote.mjs <dir>` as a child, passing `--host` for an explicit target. It checks the tool's exit, receipt and returned file and cleans up the local staging directory. The synchronous operations *inside the child* need no async rewrite. For a timed observation the main allocates all buffers, finishes H2D transfers and warms the complete sequence once before recording a start event. Repetition is safe because each statement overwrites its own buffer from immutable inputs and preceding definitions. Record the stop in the same stream after the last launch, synchronize it, obtain elapsed milliseconds, then copy the return buffer to the host. Check CUDA launch and completion results. The header selects the untimed branch for contract batches. Each public one-case run returns its observed event interval. Only the benchmark requests the runner's exclusive `--timed` lock.

1. In `src/tensor/contract.ts` factor out the existing deterministic origin case generation without changing stage-1 selection. For the lowering, select only the named function, seed 20, the 1/3/4/7/mixed shape assignments and the signed, positive and half-ulp streams. Use the existing origin-side bounds (4,096 elements per tensor, one million visits) and f64 references. Keep finite-reference cases as in stage 1. For a function returning intrinsically nonfinite values, direct GPU execution is still meaningful. Add GPU tests for NaN propagation, signed infinity and empty reductions independently of that finite-reference sample. Zero eligible cases yield an unaccepted check with the function and reason.
2. Define one versioned `differential` invariant. Put each case's origin reference, shape, input bits and replay description in the cases returned by its generator. Use a fixed positive count bound of 15 (five assignments × three streams), allowing the generator to return fewer eligible cases. `decide(inputs,cases,todo)` stages precisely those case IDs in **one** untimed invocation of the candidate translation unit. Match output IDs to `todo` and return a `Decided` per index in that order. Compare every shape and element, reject on the first discrepancy per case and report function, shape assignment, stream/seed, coordinate, reference, observed value and allowance. Require a complete batch; an execution or transfer failure must never become a cached numerical verdict. Surface the diagnostic so the check can be retried.
3. Use the framework's process-local `baselineKey` and `subjectKey`. The baseline key includes origin revision, function name and evaluator profile. The framework adds invariant version, count and seed. The subject key is the SHA-256 of the exact translation-unit bytes. Invariant version 1 fixes the target installation for the checker process lifetime: manuel@bling, GB10, sm_121, nvcc 13.0.88 with the runner’s -O3 flags, the installed driver and protocol version 1. These are assumptions of this version, not dynamically discovered key fields. Restart the process after an installation change and bump the invariant version for changes to the target profile, generator, comparison or ABI. Record current revision as provenance. The baseline key fixes each case's inputs. A warm check can replay its ordered verdicts without SSH while the baseline is resident (the current memo retains four baseline keys). A changed source still reuses the baseline cases but needs new GPU evidence. The remote binary cache is solely a compile shortcut. A cache hit there still executes unverified cases.

### Framework and tool change ledger

| Component | Proposed edit and reason | Acceptance evidence |
| --- | --- | --- |
| `src/framework/` | **None.** `applyNativePassSync` handles same-IR synchronous rewrites. Typed transformation ports already cross the Tix/text boundary, and `differential` already delegates all missing indices asynchronously and replays decided evidence. A new async pass runner or batch API would duplicate these facilities. | A real Tix artifact, text output and three local case stand-ins passed `verifyTransformation`. Cold, warm, then altered text gave accepted, accepted, rejected; six delegated cases, three replayed, zero synchronous runs. [Framework probe](../scripts/03-contract-probe.mjs) |
| `tools/cuda-remote.mjs` | **Isolate concurrent invocations of identical inputs.** Today upload, `prog`, `rm -rf out`, run and fetch share a hash directory. Even the timing lock does not cover output preparation or fetch. Stage files and run/fetch in a private remote invocation directory. Retain the input-hash compile cache, coordinate compilation per hash and publish a successful binary by atomic rename. Use that binary from the private cwd. Remove only that invocation's scratch directory once fetch finishes. Preserve the CLI, timing lock and receipt. | Run two concurrent cold checks of the same function, using identical staged files. Both must fetch complete matching results; repeat with the binary cached. A failed compile must be retryable. |

A local promise map would only protect calls in one process. Giving every input batch a unique file in its hash would avoid collisions by throwing away compile reuse. Keep the current all-input compile key for the fixed target installation. Different payloads can cause a recompile, but batching pays that cost once per group. A source-only cache would need rules for additional compile inputs that this stage does not require.

## Verification and measurements after review

Local tensor tests will cover the three exports, code generation from both optimized revisions, binary round-trips, subarray offsets, returned parameters, empty outputs, zero-case evidence, and cold/warm/changed-source behavior with a counting batch runner. A dedicated `tests/tensor/cuda-gpu.test.mjs` will run all six small corpus fixtures and focused cases through the real tool. Include a shadowed reduction and colliding tensor/index names, affine/transposed reads, nonfinite min/max, signed zeros, a contraction-sensitive multiply/subtract, an empty sum/max, and a split tail. Feed a compilable candidate dropping that tail to the same checked pass. It must be rejected on positive data after a passing check of the correct bytes. Run the build, explicit network-free tensor test files, and the GPU file separately.

Benchmark the **original** compiled corpus functions with reproducible f32 input bytes shared between backends (seed 22, uniform [−1,1], positive layernorm epsilon `1e-5`). Compile, generate inputs and perform file I/O outside both intervals. On the GPU, warm once and record three individual event intervals for the complete sequence of statement kernels in one short locked run per function. Report the median and retain the samples. Locally warm `runTix` on a small valid fixture, then time one complete default-f32 `runTix` at the actual size with a monotonic clock. Include the interpreter's own allocations and copies. The ticket report will identify Node, GPU and compiler versions, source revision, seeds, sizes, kernel counts and both times in ms. A wall clock around SSH would measure compilation, transfers and startup as well.

| Program | Shape bindings | Kernels at this size |
| --- | --- | ---: |
| matmul | M = K = N = 512 | 1 |
| softmax | N = 4096, C = 1024 | 4 |
| layernorm | N = 4096, D = 1024 | 4 |
| attention | Q = K = 1024, D = V = 64 | 6 |
| mlp | N = 1024, D = 256, H = 1024, O = 256 | 3 |
| conv2d | N = 8, C = 16, H = W = 64, O = 32, fixed 3 × 3 kernel | 1 |

The full-size timings belong to the implementation report, after emitted kernels exist. Fusion, tiling/shared memory, tensor cores, alternative thread mappings, streaming attention and autotuning belong to later stages.
