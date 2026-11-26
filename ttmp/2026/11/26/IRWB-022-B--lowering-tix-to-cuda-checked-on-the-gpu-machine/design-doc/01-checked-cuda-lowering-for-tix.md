---
Title: Checked CUDA lowering for Tix
Ticket: IRWB-022-B
Status: complete
Topics:
    - compiler
    - ir
    - verification
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Existing async batching and verdict reuse
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Same-adapter pass boundary
    - Path: repo://src/tensor/evaluate.ts
      Note: Stage 1 reference and concrete iteration order
    - Path: repo://src/tensor/model.ts
      Note: Current artifact and generated reduction bounds
    - Path: repo://tools/cuda-remote.mjs
      Note: Remote compilation and GPU execution
ExternalSources: []
Summary: Direct CUDA C emission, sampled lowering contract, remote execution and corpus timing protocol.
LastUpdated: 2026-11-26T15:12:33.019591158-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked CUDA lowering for Tix

## Representation and public API

Emit CUDA C directly from the selected function in `program.current`. Put the translation unit in a small, content-addressed `tensor.cuda-source@1` contract artifact with the function name and host protocol version. It gives the contract an exact output to identify and execute. It has no kernel IR or v6 graph adapter. A second structured artifact would be useful if this stage rewrote or scheduled kernels independently. Here each IR statement corresponds to one emitted kernel and the Tix IR already contains the order, binders, types and affine accesses needed for emission.

Use the existing cross-kind `defineTransformation` as the checked lowering pass, with a `tensor.tix` input, a function-name input, a CUDA source output and a versioned differential invariant in `ensures`. `AnalysisManager.execute` runs the lowering and awaits the invariant. A single synchronous lowering function constructs the source artifact and serves all three public entry points.

| Export from `dist/tensor/index.js` | Behavior |
| --- | --- |
| `cudaSource(program, fn): string` | Returns the complete translation unit for the named function, including its input/output harness. |
| `runTixCuda(program, fn, inputs, options?): Promise<{shape: number[], data: Float32Array, gpuMs: number}>` | Runs a one-case batch of that translation unit through the tool, with the optional host override. |
| `checkLowering(program, fn): Promise<{accepted: boolean, relation: 'exact' \| 'tolerance', reason?: string}>` | Checks that same source artifact on the default GB10 and reports the sampled tolerance verdict. |

Emission and ordinary execution can be called independently of the sampled check. This keeps the source API synchronous and lets a caller execute inputs of their choice while the check runs a fixed case set. Keep the Stage 1 API as documented. An optimized program lowers the definitions and reduction tree it currently carries, including reassociation that Stage 1 already accepted.

**Supported domain.** Functions from `compileTix` or `optimizeTix`, selected by name. A call supplies the function's row-major Float32Array inputs with finite elements, consistent nonnegative integer shapes and in-bounds executed accesses. Concrete integer shape and affine-address calculations must be exact in the Stage 1 interpreter's safe-integer range. Buffers and launches must fit the host and device, and each transfer archive must fit the tool's 1 GiB buffer. Zero dimensions and a return of a parameter are included. The default runtime is the single GB10 on `manuel@bling` with CUDA 13. An override supplies a host with the same target and tool protocol. Sampling limits apply to `checkLowering`. They are independent of the supported run sizes.

## Mapping Tix to CUDA

Emit one kernel for every statement that exists in the current function. Launch in statement order on one stream, with 128 threads per block and one active thread per output element. Guard the final block and skip a launch with zero output elements. Decode the linear thread ID to row-major output coordinates. Lower affine reads to signed 64-bit address arithmetic and fold the coordinates into a row-major offset. Assign C names by internal slot and binder ID. Source names can collide with C keywords, other namespaces or shadowed binders.

One host-side shape specialization per case binds names from bare parameter axes and computes concrete tensor shapes and sizes. Pass shapes, element count and referenced tensor pointers as kernel parameters. A single device allocation per nonempty tensor lives through the ordered launches. A zero-sized tensor needs no backing allocation. A returned input uses its existing buffer. A device struct would add another buffer and transfer for signatures that fit CUDA's kernel parameter limit.

Emit scalar expressions in evaluation order, introducing temporaries for intermediate values and scoped loops for reductions. In each reduction, the first axis is outermost, and every iteration updates the same accumulator in lexicographic order. Seed sums with positive zero and maxima with negative infinity. For a generated split, use `K / 4 + (K % 4 != 0)` blocks and `min(4, K - 4 * block)` lanes, with an accumulator for each of the two reductions. Use width from the Tix model and honor the IR's bound tags. Composed affine reads from inline and split use the same address emitter.

Compile with the tool's existing `nvcc -O3 -arch=sm_121` flags. Emit explicit `__fadd_rn`, `__fsub_rn`, `__fmul_rn` and `__fdiv_rn` for arithmetic, including each sum step. Unary negation flips the sign, `__fsqrt_rn` implements sqrt, `__ll2float_rn` converts shape scalars, and literals are emitted as their Stage 1 f32 bit patterns using `__uint_as_float`. Use `expf`, `logf` and `tanhf`. Implement min and max with NaN propagation and signed-zero selection (AND the sign bits for max, OR them for min). Use the same max helper for a max fold. Default CUDA contraction is harmless at the explicit rounding sites. The probe shows ordinary multiply then add can contract under the current flags. Fast math and flush-to-zero are excluded from this target.

## One harness for execution and checking

The translation unit reads `cases.bin` in declared parameter order. Use a versioned, little-endian format with a case count, the input axes as 64-bit unsigned extents and contiguous f32 words for each tensor. Ranks and parameter order are embedded in the translation unit. Consume and release one case at a time in the generated main. Write `out/results.bin` in the same case order with the result extents, event time and f32 words. The local runner checks the response header, exact case count, complete records and absence of trailing bytes. One-case and multi-case runs use identical source and transport. A source file per shape or embedding input data in CUDA would force a compile per case or batch.

Run the tool asynchronously from Node with a private local directory. Initialize CUDA and load kernels with `cudaFuncGetAttributes` before timing. For a case, allocate and copy inputs and metadata, then record an event before the first kernel and one after the last on the same stream. Wait for the closing event and read elapsed time before copying the output. Record zero for a case that launches no kernels. The interval includes gaps between kernels on the stream. Allocation, host/device transfers, process start-up and SSH are outside it.

## Sampled tolerance

Select cases before submitting the candidate. Reuse Stage 1's deterministic shape assignments (uniform 1, 3, 4, 7, then mixed), stream values and seed 20, including the exact gate's signed-zero stream. Try the all-zero shape assignment last. Use the current selected function for eligibility and reference. Keep the Stage 1 bounds of 4,096 elements per tensor and one million interpreter visits/loop iterations per case. Validate concrete shapes and assess executed addresses with the bounded f64 interpreter. As in the Stage 1 tolerance check, admit a case whose f64 output is finite at every coordinate. A function with no eligible cases has no accepted verdict. Execution itself includes empty reductions and nonfinite outputs, which GPU tests check directly.

Require equal output shape and length. At every coordinate of every submitted case, with `r` the current program's f64 result on the same f32 input words and `g` the GPU result, require **`isFinite(g) && abs(g - r) <= 2e-6 + 2e-5 * abs(r)`**. Report disagreements with function, shape assignment, stream, seed, coordinate and numerical comparison. Transport, compile and malformed-response failures report that the check could not obtain evidence.

Retain Stage 1's absolute term for near-zero results and relative term for values away from zero. On the contract's actual case recipe, the local f32 interpreter used at most 24.67% of that combined allowance across the six original functions and both rewrites in either order. The smaller GPU scalar probes showed where device intrinsics add error. This leaves room to keep the existing constants and verify them on the emitted GPU corpus cases after implementation. A budget scaled by f32 drift could admit cancellation-heavy cases but would shift the contract toward the f32 result. This sampled relation can reject a legitimate lowering when the program's f32 arithmetic is itself outside the f64 tolerance. [Calibration](../scripts/03-corpus-calibration.jsonl)

**GB10 result.** The probe ran the unmodified remote tool on Node 24.18.0 and NVIDIA GB10 sm_121, driver 580.178.04, nvcc 13.0.88. It sampled f32 bit patterns for arithmetic, positive f32 bit patterns for log and sqrt, and values around `[-16,16]` for exp and tanh. It also supplied targeted probes for signed zero, subnormals, overflow and NaNs. Among 65,536 scalar trials per operation, `expf`, `logf` and `tanhf` differed from the rounded JS functions in 19,892, 2,148 and 2,447 trials. The explicit arithmetic, sqrt, extrema, shape casts and literal bit loads had zero mismatches, comparing NaNs by class. A multiply-add was 0 with separate rounding and `2^-46` with default contraction. The width-four split produced 1.000000238418579 on the half-ULP witness, versus 1 for the unsplit fold and 1.0000001788139343 in f64. [Probe script](../scripts/01-gb10-probe/run.mjs)

The composed `tanhf` sum in the numerical probe used up to 27% of the fixed budget. A different cancellation-heavy fold exceeded that budget even with bit-identical f32 results. These microbenchmarks exercise the arithmetic and its limitations. The corpus calibration above uses the smaller contract cases themselves. Double CUDA transcendentals followed by f32 rounding also had zero sampled differences. Choosing them for exact checking would need evidence for bit identity across input words, including JS NaN representation. [Probe data](../scripts/01-gb10-probe/observed.json)

## Framework and tool changes

| Location | Decision and reason |
| --- | --- |
| `src/framework/passes/define-pass.ts` | **No change proposed.** `applyNativePassSync` is synchronous and same-adapter. `applyPass` is asynchronous but also produces an artifact of the input adapter's kind and starts a graph edit. The existing `AnalysisManager.execute` accepts independently typed inputs and outputs and waits for `ensures`. A cross-adapter extension to the edit runner would add machinery beyond this source emitter. |
| `src/framework/contracts/differential.ts` | **No change proposed.** Use `decide` for one async GPU batch over the uncached indices. Use `baselineKey` for CPU cases and references, and `subjectKey` for decided comparisons. Await the whole response before returning the verdict array in case order. Per-case async evaluation would multiply SSH and process start-up. The local [contract probe](../scripts/02-contract-probe.mjs) verified cross-kind checking, a two-case batch, replay on a warm check, and fresh checks for changed output or engine. |
| `tools/cuda-remote.mjs` | Add `--input cases.bin` to declare a runtime file. Stage it with the job and exclude it from the compile key. Include compile-file names and contents, nvcc identity and the effective compilation flags in that key. This reuses the executable across different cases for identical source. Preserve existing invocations that omit the option. |
| `tools/cuda-remote.mjs` | Give each invocation a unique remote working directory for uploads, execution and output fetch. Share the keyed executable in the compile cache, with a per-key compile lock and atomic installation after successful compilation. Clean up the invocation directory after fetching. The current hash directory doubles as a working directory, so even identical concurrent runs can delete or fetch each other's `out/`. Locking the whole invocation on the compile key instead would serialize unrelated GPU runs of one binary during upload and fetch. |

Set the transformation's computational cache to `never`. Use the current revision and function as the baseline key under the versioned invariant, seed and sample policy. Use CUDA artifact revision as the subject key. `checkLowering` uses a fixed target and the memo lives in one process, so reuse assumes the target stays stable for that process. A warm check makes zero remote calls. Concurrent duplicate checks may submit separate batches. Replay completed decisions, including disagreements. Transport failures throw before the batch returns decisions, so a retry reruns those cases.

The design probe exercised a binary batch response and a positive CUDA-event interval using the current tool. The reviewer measured a 0.115 ms first launch and a 0.003 ms second launch, with the first at 0.004 ms after preloading via `cudaFuncGetAttributes`. Keep the preload and reserve `--timed` for benchmarks.

## Verification and corpus measurements after review

Build with `npm run build`. Keep GPU integration in a dedicated tensor test file, and run existing local tensor tests by filename. Use local tests for deterministic source generation, protocol serialization, sampled comparison and memo invalidation. GPU tests cover small versions of the corpus, actual changed revisions after inline and split, a negative test with a changed generated kernel, and small witnesses for rounding sites, transposed/affine accesses, shadowing, multi-index order, zero extents and parameter returns. The tolerance can accept a one-bit change, so check exact bits separately for the chosen multiply-add and ordered/split sum witnesses.

Measure the original corpus functions on identical deterministic finite f32 inputs on each side, with positive layernorm epsilon. Warm the GPU with one execution and report the median of five CUDA-event intervals in one short `--timed` job per program. The tool lock serializes timed invocations. On this machine, warm the interpreter on a smaller case, then report one full-size `runTix` f32 wall-clock reading per function, including its own allocations. The corpus report will carry hardware, seed, versions, shape, samples and units. Use the measured interpreter outputs for a same-input f32 cross-check of the GPU output.

| Program | Concrete shapes |
| --- | --- |
| matmul | M = K = N = 512 |
| softmax | N = 4096, C = 1024 |
| layernorm | N = 4096, D = 1024 |
| attention | Q = K = 1024, D = V = 64 |
| mlp | N = 1024, D = 256, H = 1024, O = 256 |
| conv2d | N = 8, C = 16, H = W = 64, O = 32, 3 × 3 kernel |

Implement emission and local checks first, then remote isolation and the shared harness, then the lowering invariant and GPU tests. Run the corpus timings once the checked path works. Leave a general kernel IR, persistent verdict storage and further scheduling optimizations outside this stage because the fixed mapping and process-local evidence cover the requested backend.

The implementation and measurements follow this design. [Verification and results](../reference/02-cuda-verification-and-corpus-timings.md)
