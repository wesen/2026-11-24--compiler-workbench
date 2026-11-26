---
Title: Checked Tix to CUDA lowering
Ticket: IRWB-022-F
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/analysis-manager.ts
      Note: Checked cross-kind transformation
    - Path: repo://src/framework/contracts/differential.ts
      Note: Async batch delegation and sample reuse
    - Path: repo://src/tensor/evaluate.ts
      Note: Reference rounding and evaluation domain
    - Path: repo://tools/cuda-remote.mjs
      Note: Remote harness and proposed standalone cache mode
    - Path: repo://ttmp/2026/11/26/IRWB-022-F--lowering-tix-to-cuda-checked-on-the-gpu-machine/scripts/01-probe-numerics.mjs
      Note: Reproduce the numerical witness on GB10
ExternalSources: []
Summary: Direct CUDA emission, a batched sampled tolerance contract, and a GB10 baseline.
LastUpdated: 0001-01-01T00:00:00Z
WhatFor: Review before implementing stage 2.
WhenToUse: When implementing or reviewing the checked CUDA baseline.
---

# Checked Tix to CUDA lowering

**Design for review.** Emit CUDA C directly from the current Tix revision. Wrap the emitted translation unit in a v6 artifact for a checked, cross-kind transformation, but do not introduce a kernel IR. Check it with sampled tolerance against the current revision’s f64 evaluator. The [numeric probe](../scripts/01-probe-numerics.mjs) ran on the GB10 using the existing remote tool; it is not the lowering implementation.

## Domain and entry points

Support the complete stage-1 checked language in its valid calling domain: one selected function; the exact named row-major f32 inputs with finite elements; consistent shape bindings and nonnegative integral extents; in-bounds addresses and representable integer/index arithmetic. Buffers and launches must fit the host/device and launch limits of the simple mapping below. Zero extents and functions returning a parameter are supported. The CUDA environment is Linux little-endian on GB10/sm_121 with CUDA 13.0, Node 24 at the client. The optional host selects a machine with the same target environment. The finite-input rule does not imply finite intermediates or outputs. No changes to `compileTix`, `runTix`, `optimizeTix`, or their validation behavior.

| API | Responsibility |
| --- | --- |
| `cudaSource(program, fn): string` | Deterministic, synchronous emission of the complete translation unit for the selected function. No GPU work. |
| `runTixCuda(program, fn, inputs, options?): Promise<{shape, data, gpuMs}>` | Emit and run one case through the remote tool, decode the f32 result, return the kernel-sequence event interval. No implicit sampling check. |
| `checkLowering(program, fn): Promise<{accepted, relation, reason?}>` | Execute the checked lowering pass for the selected function using the same emitter and runner, with a batch of cases. Return `relation: 'tolerance'`; lack of evidence is not acceptance. |

The baseline for lowering is **`program.current`**, for both shape selection and reference evaluation. The split-sum pass already made and checked its own change of grouping; lowering must not undo it, and comparing against `origin` could charge the lowering for an earlier permitted change. Stage 1’s [design](../../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-semantics-and-checked-tensor-rewrites.md) and [report](../../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/02-report.md) describe that boundary.

## Emission and execution

A kernel IR would duplicate the existing ordered statements, affine reads and ordered reduction trees without any consumer that rewrites device code in this stage. Emit to text instead. The v6 output value contains function identity, target/harness version, and the actual source text; it contains no buffers, device handles or timing. Its validator checks structural metadata; the remote compiler and contract test the source. A plain string would suffice for execution, but the artifact gives the exact candidate a revision and a typed contract port.

- Generate identifiers from numeric slots and lexical binder IDs, never from source spelling. Map shape names, tensor names and binders independently. Emit each expression to ordered scalar temporaries, placing reduction body temporaries in the lexical loop body. Bind each reduction separately, including shadowing and generated IDs like `i0/block`. Resolve affine reads through the actual scoped binder IDs; fold offsets row-major using concrete dimensions and wide integer arithmetic.
- Generate a kernel per **current** statement with only its referenced buffers, the output buffer, and needed shape metadata. A 1-D launch of 128-thread blocks covers the linear output range once; guard the padded tail and unflatten by quotient/remainder from the last axis to the first. Keep offset and grid arithmetic wide until checking launch limits. Skip the launch for zero outputs before unflattening. Materialize each nonempty result in source order on one CUDA stream; retain buffers through the final result copy. Empty buffers are never dereferenced on valid input. A direct parameter return may have no launches; report 0 ms if none ran.
- Emit one increasing loop per reduction binder in listed order. Initialize one accumulator outside that loop nest and update only at its innermost body. A nested reduction initializes its own accumulator at its expression site, once per enclosing evaluation. Split bounds use integer `K/4 + (K%4 != 0)` for ceil, `K/4` for floor, and `min(4, K - 4*block)` for the tail. Respect both folds, even where collapsing the loops would visit the same elements. Inline-substituted affine addresses need no special path.
- Use one versioned little-endian binary case bundle (`cases.bin`) and response (`out/results.bin`): record count, case indices, dimensions in parameter order, and raw f32 words; responses contain index, return dimensions, f32 words and kernel ms. The generated main binds shapes from direct input axes, checks repeated bindings and affine parameter dimensions, and computes statement extents and allocation sizes. No shape specialization or recompilation per case. Node validates record IDs, shape and byte counts before using any result. Binary rather than JSON tensor values preserves signed zero, infinity and NaN and avoids large text round trips. Use temporary local directories and asynchronously invoke `tools/cuda-remote.mjs` as a Node subprocess with explicit arguments and bounded execution; no independent SSH path.

## Numerical rule and the GB10 probe

Keep the source tree, loop order, and f32 rounding sites under `nvcc -O3 -arch=sm_121`, without fast math or FTZ. Emit literal bits using Node’s `Math.fround(Number(text))` at emission, and shape-to-scalar conversions using round-to-nearest f32 integer conversion. Loads and stores are f32. Emit `__fadd_rn`, `__fsub_rn`, `__fmul_rn`, `__fdiv_rn` for the four operators, and `__fadd_rn` for sum steps, so a multiplication feeding an addition cannot become an FMA. Negation flips the sign, `sqrt` uses `__fsqrt_rn`, and the other unary intrinsics use `expf`, `logf`, `tanhf`. For `max` and `min` (calls and max folds) explicitly propagate NaN and resolve zero ties as JS does (`max(-0,+0)=+0`, `min(-0,+0)=-0`); bare `fmaxf`/`fminf` can suppress a NaN operand. Preserve the +0 and −∞ initial accumulators. No claim of portable NaN payload identity.

The probe used seed 20 and 32,768 inputs per intrinsic on NVIDIA GB10, sm_121, nvcc 13.0.88. `log` and `sqrt` used positive arguments. The same default compiler flags will be used for emission.

| Operation | Bit mismatches vs `Math.fround(JS)` | Largest fraction of proposed f64 budget |
| --- | ---: | ---: |
| `expf` | 9,821 | 0.00635 |
| `logf` | 2,257 | 0.00354 |
| `tanhf` | 1,976 | 0.00677 |
| `__fsqrt_rn` | 0 | 0.00283 |

For example, `exp(9.289331436157227)` rounded in JS is `10821.9462890625`, versus `10821.947265625` on device. A sequential 1024-term signed dot product gave GPU = JS f32 = `5.511519432067871` vs f64 `5.511516308124524` (2.8% of the budget). The half-ULP sequential sum, normal-to-subnormal multiplication, negative-zero addition and division probes returned `3f800000`, `00400000`, `80000000`, `3eaaaaab` respectively. A device event pair around the probe kernel returned a positive interval; that was a functional probe, not a benchmark.

For each finite f64 reference element `r`, require a finite GPU element `g` with `abs(g - r) <= 2e-6 + 2e-5 * abs(r)`, with identical output shapes and lengths. This starts from stage 1’s sampled error budget: the absolute term matters near zero; the measured single-op errors and representative ordered dot fit it with margin. This is a sampled criterion, not a bound on long sums, overflow or ill-conditioned valid programs. For a nonfinite f64 element, check GPU output against the current f32 output’s NaN class or signed infinity, or compare against that f32 value with the same tolerance if f32 is finite. A finite f64 value and a nonfinite GPU value fail the tolerance check, even if the CPU f32 also overflows. The runtime still executes such valid inputs. Targeted edge tests check signed zero directly, since the finite tolerance metric does not. Bit identity would require matching JS transcendental implementations and specifying NaN bits; the probe rejects the simple exact alternative. Report worst observed error/budget ratio on the six full-sized corpus runs as a second evidence point, without enlarging the budget just to accept a failing case.

## Checked pass, batching and evidence

Use a versioned `defineTransformation` from `TixIR` plus a function selector to `CudaSourceIR`, with the emitter as its `run` and a `differential` postcondition over the two artifacts and execution configuration. `AnalysisManager.execute` validates and checks the candidate before accepting the lowering. The actual postcondition runs the source bytes in the output artifact, never re-emits the baseline to check it. The API can return compact verdicts; internal evidence retains seed, case descriptions, counts and first counterexamples with coordinate/value/budget or nonfinite class. Remote/compile/transport/partial-batch errors do not count as decided cases or become reusable verdicts. No eligible case means unverified, not accepted.

1. Factor out stage-1-style deterministic case generation without altering the existing optimizer’s case schedule or comparison. Seed 20; try all symbols at 0, 1, 3, 4, 7 and mixed rectangular assignments, plus per-axis zero where valid. Add negative/positive zero and subnormal probes to the usual signed, positive and half-ULP inputs. Keep the existing bounded-work and small-buffer approach (up to 4,096 elements per tensor and 10^6 evaluation steps per reference case); invalid shapes/addresses are excluded by baseline evaluation alone. Empty results check the shape; do not silently drop nonfinite coordinates. The sample set should distinguish a wrong transpose, a dropped split tail, and wrong empty-fold identities. Focused GPU tests separately use an order-sensitive witness, since tolerance alone cannot distinguish the half-ULP bit change.
2. Use `DifferentialSpec.decide(inputs, cases, todo)` to send only uncached case indices in one bundle and remote process per candidate/function. Compute/run the local references by index, compare returned records in order, and return exactly one verdict per `todo` entry, only after the full batch has been validated. Retain CPU case/reference data in the baseline’s cached case list (the delegated path does not populate the framework’s baseline-outcome array). No one-SSH-per-case loop and no shape-dependent source.
3. Use `baselineKey` for current revision, function and reference environment (Node/V8 and sample-policy version); `subjectKey` for candidate source revision plus harness/engine configuration. Include resolved host, architecture, compiler path/flags, transport protocol version, and a short-lived process-local engine epoch under the fixed GB10/13.0 environment assumption. Record observed device/toolchain versions on actual runs; a host/toolchain change invalidates the epoch. No cross-process/persistent GPU verdicts or claim of live host attestation on replay. Coalesce identical in-flight checks in the tensor layer and clear on settlement. Scope baseline entries to the same epoch as well, so the existing baseline LRU can evict old verdict maps wholesale. Do not reuse timings as evidence, or use verdicts from a previous baseline/candidate/environment. Transformation `cache: 'never'` keeps accepted-output caching distinct from sample replay: even a repeat traverses the postcondition and obtains either freshly decided or exactly keyed sampled evidence.

**Framework change ledger (proposed: none).** Both `applyPass` and `applyNativePassSync` take one native IR/adapter for input and output; the async runner also opens a rewritable edit. Treating CUDA as a pseudo-edit would require rebuilding Tix or inventing an artificial union IR, neither of which fits. The contract layer already exposes the cross-kind checked pass boundary. A Node probe used two distinct `defineIR` kinds, `AnalysisManager.execute`, and an async `differential.decide`: two delegated cases on first check, two replayed on repeat, and two freshly delegated for a distinct rejected output via `verifyTransformation`. This stage exercises a composition of existing APIs, not a second async-native runner or a framework-level remote execution cache. The generic manager does not model remote host drift; record that assumption explicitly at the domain boundary.

## Remote tool change ledger

**Propose one opt-in mode in `tools/cuda-remote.mjs` for standalone `main.cu`** (update its header and usage). Today the hashed remote directory serves as the compile cache, working directory and `out/` staging location: different case files miss the compile cache, and concurrent identical invocations can remove or fetch each other’s outputs. In the new mode, stage each invocation in its own remote directory; clean it after fetch. Cache only the executable by full source digest, architecture, compiler identity (path/version) and flags. Serialize compilation per key and publish the executable atomically after success. Report transfer/fetch errors rather than accepting an incomplete result. Keep the legacy invocation and its full-directory cache behavior unchanged, for programs with other compile-time files. Keeping today’s layout with a per-call nonce would isolate runs but recompile every time; a local mutex would not protect different worktrees. Neither the source cache nor the per-key compile lock is the GPU timing lock. Use `--timed` only for the short measurement runs. No new `nvcc` flag interface is required by the numeric recipe.

## Validation and measurement after review

- Offline: build; run the explicit local tensor test files with Node 24. Test deterministic and function-specific source, one kernel per current statement, symbol separation and fresh binder identities, ordered/nested loops and block/tail lowering, zero handling and binary round trips. Use a fake transport for batched cases, wrong/missing records, reuse, in-flight coalescing, retry after transport failure and cache misses after changing a candidate or engine epoch. Keep any real remote execution in `tests/tensor/cuda-gpu.test.mjs`.
- GPU: check all six small corpus instances and original/changed optimized programs. Include hand or f32-interpreter oracles for convolution affine addressing, a transpose inline, scoped nested and multi-index reductions, a partial split tail, known split vs. unsplit f32 results using exact word comparisons as **targeted** tests, empty folds/extents, parameter return, and exceptional values. Route a compilable emitted mutant that drops the last term of a positive sum through the actual contract and require a coordinate counterexample. Test cold/warm compile and distinct same-source bundles (including concurrent invocations); assert each gets its own output. Do not run the full suite.
- Benchmarks use **unoptimized** corpus functions and deterministic finite f32 inputs (seed recorded, with positive layernorm epsilon). Allocate and copy inputs before timing. Warm up once, then take three short repetitions for each function (report samples and median). GPU events on the execution stream surround only each whole ordered kernel sequence; synchronize the stop event before reading it, and copy the result after timing. Include launch gaps in the event span, not SSH, allocation, transfers, compilation, or process startup. Acquire `--timed` only for these runs; the tool’s lock serializes other timed clients, not untimed activity. Record variability instead of assuming isolation from all load. On this local machine, warm Node on a small input, time `runTix` f32 on the same full-sized buffers with `performance.now()`, and report the evaluator’s call cost including its normal allocations, not fixture generation. Compute full-size f64 comparison errors outside timing. Report Node/CPU and GPU/toolchain versions, shapes, sample policy, kernel counts and both timings.

| Program | Shape bindings for measurement |
| --- | --- |
| matmul | M = K = N = 512 |
| softmax | N = 4096, C = 1024 |
| layernorm | N = 4096, D = 1024 |
| attention | Q = K = 1024, D = V = 64 |
| mlp | N = 1024, D = 256, H = 1024, O = 256 |
| conv2d | N = 8, C = 16, H = W = 64, O = 32; fixed 3 × 3 |

## Later

Fusion, tiling/shared memory, tensor cores, other thread mappings, streaming attention and autotuning are outside this stage.
