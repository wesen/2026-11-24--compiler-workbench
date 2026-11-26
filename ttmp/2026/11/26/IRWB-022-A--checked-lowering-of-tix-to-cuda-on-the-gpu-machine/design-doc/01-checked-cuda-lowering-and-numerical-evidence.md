---
Title: Checked CUDA lowering and numerical evidence
Ticket: IRWB-022-A
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Async dispatch and verdict replay
    - Path: repo://src/tensor/contract.ts
      Note: Origin cases and tolerance
    - Path: repo://src/tensor/evaluate.ts
      Note: Reference semantics
    - Path: repo://tools/cuda-remote.mjs
      Note: Execution and output isolation
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T15:12:09.245584546-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked CUDA lowering and numerical evidence

Emit a complete CUDA translation unit from the selected function in `program.current`. Check the emitted text as the output of a versioned transformation. A single untimed GPU invocation decides the outstanding examples for a function. Accept when their returned shapes and elements agree with the original Tix f64 reference under the stage-1 tolerance.

## Calling domain and API

The inputs are programs produced by `compileTix` or `optimizeTix`, a function present in that module, and (for execution) the function's named, row-major Float32Array inputs. Ranks, element counts and direct shape bindings agree with the signature. Shape values are nonnegative integers, affine addresses are in bounds, elements are finite, integer calculations are exactly representable in the stage-1 host domain and the concrete run fits device memory and launch limits. Zero dimensions, empty reductions, returns of parameters, nested shadowing and coincident tensor/index spellings all belong to the domain. Finite inputs can produce nonfinite results.

| Export in dist/tensor/index.js | Behavior |
| --- | --- |
| `cudaSource(program, fn): string` | Pure emission of kernels and binary-file driver. Shapes are runtime values. |
| `runTixCuda(program, fn, inputs, options?): Promise<{shape,data,gpuMs}>` | Run that same source on one case through the tool, passing an optional host. Decode shape, Float32Array and GPU event milliseconds. |
| `checkLowering(program, fn): Promise<{accepted,relation,reason?}>` | Execute the checked pass on that function and report its sampled verdict with relation `tolerance`. |

Raw source and execution are available independently for inspection and measurement. Only the third entry point issues a contract verdict. The stage-1 exports retain their existing entry points.

## Lowering one statement

The native `Fn` already contains definition order, shapes, resolved binder IDs and affine addresses. A second graph of kernels would duplicate each statement, with no consumer between creation and printing. Use the existing tree directly. For each statement generate a kernel taking its output, the distinct tensors it reads and required shape values. Assign C identifiers by ordinal in separate maps for tensors, shapes and binders, including generated IDs containing slashes. Launch 256 threads per block, round the block count up, guard the flat thread index against the element count, then unpack it by remainder and division from the last output axis to the first. Use wide integers from the first multiply for flat indices, shapes, affine arithmetic and row-major strides. For a load, fold `offset = offset * dimension + affine_index` over its axes.

Emit children into scalar temporaries in tree order. Emit a reduction as a fresh local float initialized to +0 or −∞ and increasing loops in listed order, first axis outermost. Reevaluate dependent bounds inside their enclosing loop. A split sum has independent block and lane accumulators, block count rounded as specified by the IR and lane count `min(width, dim-block*width)` using the model's width. Inline substitutions already live in the load's affine terms. Generate a fresh loop scope for each occurrence and bind by ID. A second parser, pattern matching a matmul, or simplifying split folds back to one accumulator would lose information already present in the current artifact.

| Expression | CUDA operation under nvcc -O3 -arch=sm_121 |
| --- | --- |
| Literal, shape, load | Emit literal bits computed by Math.fround(Number(text)) using __uint_as_float. Convert integer shape to nearest float. Load stored float directly. |
| Binary arithmetic, sum step | __fadd_rn, __fsub_rn, __fmul_rn, __fdiv_rn. Explicit rounding prevents multiply/add contraction. |
| Unary minus | Negate the float, preserving the sign change at zero. |
| exp, log, sqrt, tanh | expf, logf, sqrtf, tanhf using the default math mode. |
| min, max, max step | Explicit NaN propagation, then fminf/fmaxf with signed-zero tie handling matching Math.min/Math.max (negative zero wins a min, positive zero wins a max). |

The driver binds symbolic sizes from plain parameter axes, specializes each intermediate's dimensions, and allocates buffers before launching. Copy inputs to the device once. Launch nonempty statements in definition order on one stream. A zero-size output needs no storage or launch. Empty reduction domains still write the initial value to each existing output element. Resolve the return tensor by name (possibly an input), copy its bytes back and release per-case resources. With zero launches report zero kernel time.

## Transport and measurement boundaries

Use one small binary format for single runs and contract batches. The proposed little-endian input file begins with a u32 case count. For each case, write each parameter in signature order as u32 rank, u64 dimensions, then their product in binary32 words. Return one output file under out/ with the same count and ordering, one shape and payload per case followed by f32 elapsed milliseconds. Binary words carry negative zero, infinities and NaNs through the transport. ASCII floats or JSON number arrays add conversion costs and cannot represent all these observations. The Node wrapper creates a private temporary directory per invocation, writes main.cu and inputs, awaits a child Node process running tools/cuda-remote.mjs, verifies tool exit and complete result framing, and removes the directory after reading. The tool's own synchronous subprocesses therefore do not block the caller's event loop.

Record CUDA start and stop events on the launch stream around the contiguous kernel sequence. Synchronize the stop event and use cudaEventElapsedTime. Keep allocation, input/output copies, file I/O and warm-up outside the interval. This is elapsed GPU time for the sequence, including any gaps between kernels. The helper's runMs measures a different interval.

## Evidence for the relation

With nvcc 13.0 on NVIDIA GB10 sm_121, the untimed probe compiled under the tool's default flags and exited 0 (input hash a0e28fa1ac988562). For each i from 0 through 8191 it evaluated x=(i−4096)/1024 and y=(i+1)/1024. These inputs are exactly representable. Node 24.18.0 computed both per-operation f32 and unrounded f64 references. The twelfth column accumulates x*(y/j) for j=1…7, in order. Each row below groups 8,192 observations per operation.

| Operation | Unequal to stage-1 f32 | Largest fraction of f64 allowance |
| --- | ---: | ---: |
| expf | 2468 | 0.006160 |
| logf | 626 | 0.003535 |
| tanhf | 1262 | 0.006001 |
| Seven-term fold | 0 | 0.009670 |
| Other eight scalar operations combined | 0 | 0.002835 |

At x=−3.986328125, expf returned 0.01856776885688305. Rounding Math.exp(x) gave 0.0185677669942379. Exact agreement would reject this implementation even before composition. For each finite reference element r use the existing bound

    abs(gpu - r) <= 2e-6 + 2e-5 * abs(r)

All 98,304 observations passed. The absolute term permits small cancellation residuals and the relative term scales with magnitude. This establishes a measured budget for sampled checks. Longer reductions and ill-conditioned expressions can spend more than this allowance. Their verdict comes from running the contract, not from extrapolating the probe. The corpus timing sizes are a separate experiment. Reproduce from the ticket with scripts/01-gb10/main.cu via the remote helper and scripts/02-compare.mjs locally.

## Checked pass and framework finding

Define a transformation in src/tensor with inputs for original and current TixIR artifacts and the function name, and a scalar text output for the complete source. Its run body calls the pure emitter on current. Bind original, function and the actual output text into an ensures clause using differential(). Checking code reconstructed from the input inside the invariant would miss a broken pass output. Use AnalysisManager.execute and a versioned text port. The same-adapter definePass/applyPass pair prepares another artifact of the input kind and checks a graph diff. applyNativePassSync additionally requires a synchronous gate. Neither models a Tix-to-text boundary. A transformation with typed ports already does.

Extract the existing case generator and tolerance comparator in src/tensor/contract.ts for reuse. Generate only the named origin function's cases using seed 20, singletons, dimensions 3, 4, 7 and asymmetric mixed dimensions, signed/positive/half-ulp streams, existing size/work and finite-f64 filters. Compute references with the origin function as both case-generator arguments on identical f32 input bits. Origin remains the reference across split-sum and subsequent inline. Comparing to current f32 alone would erase the cumulative numerical obligation. The relation covers every element of each selected finite-reference output. Empty max returning −∞ is outside this numerical sample; test it explicitly through execution. Zero comparable cases cannot accept.

Use differential's cases callback to construct reusable samples including references. Its count parameter is a fixed positive generator configuration, with actual total taken from returned cases. Supply a baselineKey covering origin revision, function, case generator and reference version. Use subjectKey covering a digest of the actual source, runner/ABI version and pinned engine configuration (host, GPU/architecture, toolkit and flags). Scope reuse to a process with a fixed execution environment, refreshing the namespace if the engine changes. The framework also keys by invariant ID/version, seed and count. No persisted verdicts. Its decide callback receives all missing indices at once. Send those cases as one batch, require one correctly shaped, correctly sized result per case in order, compare with cached f64 references, and return a Decided per index. A nonfinite candidate against a finite reference fails. A transport, compile or malformed-output failure cannot supply numeric evidence or enter the verdict cache. Include the first differing case, coordinate, reference, observed value and allowed error in the rejection reason. Run errors should identify the failing engine step. Cache neither timings nor transient errors as agreement.

**Proposed framework source changes: none.** The ticket's scripts/03-contract-probe.mjs exercises a transformation from a real Tix artifact to a scalar through an async differential ensures. It delegated indices [0,1] once and replayed both on repeat, with zero local runs. It uses synthetic decisions to isolate dispatch from numeric evidence. A general async native pass, new differential batch API or separate tensor verdict cache would duplicate working behavior. Record any implementation finding that changes this ledger.

## Remote tool change ledger

Propose one isolation change in tools/cuda-remote.mjs. Today identical invocations share a hash directory for upload, compilation, execution and retrieval, and each deletes out/ before running. One job can erase another's result between execution and download. Keep the current hash-of-inputs compile reuse. Give each invocation its own remote working directory through retrieval, lock cache population per hash and publish a completed executable atomically. Compile from that invocation's uploaded files on a miss, then run the cached executable with its private directory as cwd. Clean up the private directory on completion. Preserve the existing CLI, default flags and --timed semantics. A lock around prog execution alone leaves the subsequent tar fetch exposed. Changing the hash to ignore data would also change the helper's behavior for main.cu that includes other uploaded files. Defer that optimization; the batch already amortizes compilation across cases. Verify with two simultaneous jobs on identical files and distinct program arguments writing distinguishable outputs, including a cold compile.

## Verification and measurement after review

1. Exercise the public exports, binary framing, kernel count, generated names, shape binding, zero output and return-of-input locally. Test the actual async gate with a fake batch runner for partial/missing results, rejected numeric cases, source/key changes and replay. Build with npm run build and pass explicit local test filenames to node --test.
2. Keep live checks in tests/tensor/cuda-gpu.test.mjs. Run all six small corpus checks. Include a pointwise transposed inline, the split K=7 witness and tail, nested shadowing, ordered multi-index cancellation, affine convolution, an empty fold with nonempty output, NaN propagation and signed zeros. Exercise original, inline, split-sum and chained programs. Use a valid but wrong generated source (e.g. a dropped final lane) through the same gate and assert a coordinate-level disagreement.
3. Measure original corpus functions with identical seeded asymmetric Float32Array inputs on both machines (set layernorm eps to a small positive constant). Generate inputs before starting either timer. On the GB10 use the tool's --timed mode for a short warm-up and three event-timed repetitions in one process, report the median. Run one local stage-1 f32 call per requested size after a small warm-up, timing runTix with performance.now() outside input generation and compilation. Report the single local wall time explicitly, plus event median, units, seed, revisions and shapes. Retain returned tensors long enough to compare shapes and inspect numerical output. Use tmux for long interpreter runs.

| Function | Shape assignment |
| --- | --- |
| matmul | M=K=N=512 |
| softmax | N=4096, C=1024 |
| layernorm | N=4096, D=1024 |
| attention | Q=K=1024, D=V=64 |
| mlp | N=1024, D=256, H=1024, O=256 |
| conv2d | N=8, C=16, H=W=64, O=32, kernel 3×3 |

The implementation, live lowering tests and timing table await design review. Fusion, alternative thread mappings, tiling, shared memory, tensor cores, streaming attention and autotuning belong to later stages.
