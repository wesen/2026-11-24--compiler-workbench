---
Title: Checked CUDA lowering for Tix
Ticket: IRWB-022-K
Status: review
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Batch dispatch and evidence reuse, proposed async-only overload
    - Path: repo://src/tensor/contract.ts
      Note: Origin-derived samples and error budget
    - Path: repo://src/tensor/model.ts
      Note: Executable scalar tree and generated bounds
    - Path: repo://tools/cuda-remote.mjs
      Note: Compile cache and proposed per-invocation output isolation
    - Path: repo://ttmp/2026/11/26/IRWB-022-K--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/scripts/01-gb10/main.cu
      Note: GB10 numerical witness
ExternalSources: []
Summary: Direct CUDA emission, GB10 numerical evidence and an asynchronous checked lowering.
LastUpdated: 2026-11-26T15:12:19.15891425-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked CUDA lowering for Tix

Emit CUDA C directly from the selected function in `program.current`. Check the emitted translation unit by running it on the GB10 and comparing its returned tensor with the original Tix function evaluated in f64. The check is sampled. CUDA's single-precision transcendental functions can disagree with the stage-1 f32 evaluator by a bit even on small, finite inputs.

## Why this relation

The untimed probe compiled with the existing runner's `nvcc -O3 -arch=sm_121`. The device identified itself as NVIDIA GB10, nvcc 13.0.88. For each of 32,769 exactly representable values `x = i/4096`, from −4 through 4 inclusive, a kernel evaluated the six expressions below. Node 24.18.0 ran matching Tix functions through both stage-1 evaluators on identical f32 inputs. Here `p = abs(x) + 0.125`. The last column divides each error by the stage-1 budget at that coordinate and takes the maximum. [Kernel](../scripts/01-gb10/main.cu) · [Tix comparison](../scripts/02-compare.mjs)

| Device expression | Words differing from stage-1 f32 | Largest absolute error vs f64 | Largest fraction of budget |
| --- | ---: | ---: | ---: |
| `expf(x)` | 9,840 | 4.864e−6 | 0.00668 |
| `logf(p)` | 2,786 | 1.238e−7 | 0.00354 |
| `__fsqrt_rn(p)` | 0 | 1.191e−7 | 0.00283 |
| `tanhf(x)` | 5,058 | 8.567e−8 | 0.00663 |
| Ordered sum of `x * ((j−2)/7)`, j = 0…6 | 0 | 4.769e−7 | 0.00663 |
| `(x−p)/p` | 0 | 5.961e−8 | 0.00269 |

At `x = -3.998291015625`, the GPU returned `0x3c964c60` for exp and the f32 evaluator returned `0x3c964c61`. This rules out the exact relation for the proposed emitter. Matching the host math implementation on device would cost substantially more than using libdevice. Adopt the stage-1 output budget for every finite reference coordinate r,

```text
abs(gpu − r) ≤ 2e−6 + 2e−5 × abs(r)
```

The absolute term covers cancellation near zero. The relative term scales with output magnitude. All 196,614 comparisons fit, including the ordered fold. This measures headroom on the probe grid. Deep expressions, long sums and ill-conditioned programs can exceed the budget. Each function must earn its own verdict on its generated cases. The large benchmarks measure speed separately.

## Supported programs and calls

The input is a stage-1 `TixProgram` from `compileTix` or `optimizeTix(...).program` and one of its function names. Calls use finite f32 data in row-major storage, one buffer per parameter with the declared rank, matching length and consistent nonnegative dimensions. A plain parameter axis binds each shape symbol. Affine dimensions and addresses are integral, representable as in stage 1 and in bounds at the call. Tensors and launch dimensions must fit on the GB10. Zero extents, returned parameters, multiple functions, shadowed binder spellings and the generated split bounds are all within scope. Finite inputs can produce infinities, NaNs or signed zero.

Use the following three exports from `src/tensor/index.ts`, hence from `dist/tensor/index.js` after build.

| Export | Work performed |
| --- | --- |
| `cudaSource(program, fn): string` | Deterministic, shape-parametric translation unit with all statement kernels and a runnable main for this function. |
| `runTixCuda(program, fn, inputs, options?): Promise<{shape, data, gpuMs}>` | Execute that translation unit for one call. Read the actual returned shape, a fresh Float32Array and device kernel time. Forward optional `host` to the runner. |
| `checkLowering(program, fn): Promise<{accepted, relation, reason?}>` | Execute the checked transformation on this function. Return `relation: 'tolerance'` and the verdict, with a replayable reason on rejection. |

The first two exports give direct access to the candidate. The checked pass uses the same emitter, batch driver and result reader. This makes source inspection and execution available for valid functions outside the small sampling budget without coupling every run to a remote evidence check.

## Emission and execution

The current IR already fixes the output axes, tensor shapes, affine loads, expression tree and fold order. A second kernel IR would represent those same decisions again. There is one fixed thread mapping and no kernel-level rewrite to check in this stage. Keep generated text as a scalar contract output. Use a versioned cross-representation transformation in the contracts layer. `definePass<S>` and `applyNativePassSync` both model an edit of one representation through one adapter. Turning CUDA text into a dummy Tix edit would give its diff no useful interpretation.

1. Number parameters, statement results, shape symbols and binder IDs in separate tables. Generate C identifiers from ordinals. This handles CUDA keywords, equal tensor/index names and generated IDs such as `i0/block`. A kernel takes the tensor pointers and bound shape values it uses plus the output size. Bind symbols once from the actual parameter axes in main. Use signed 64-bit arithmetic for affine extents and coordinates and wide products for element counts and byte offsets.
2. Emit one kernel definition for each current statement and launch them in that order in one stream. For output size L, launch ceil(L/256) blocks of 256 threads. Each active thread owns one linear index t. Guard `t >= L`, then unpack t from the last output axis to the first by remainder and quotient. A read at coordinates a uses the row-major recurrence `offset = offset * extent + a`. Allocate one row-major device buffer per tensor and materialize every statement. Empty tensors need no allocation or launch. Their shapes still travel with the result.
3. Emit scalar subexpressions into local float temporaries in tree order. Emit literals from the bits of `Math.fround(Number(text))` using `__uint_as_float`. Convert scalar shape values with round-to-nearest integer-to-float conversion. Loads already yield float. Use `__fadd_rn`, `__fsub_rn`, `__fmul_rn`, `__fdiv_rn`, sign negation, `expf`, `logf`, `__fsqrt_rn` and `tanhf`. Explicit rounded multiply and add prevent contraction even under the stock `-O3`. Keep the stock precision defaults and omit fast math. For scalar and reduction min/max, propagate NaN if either operand is NaN, choose −0 for min or +0 for max on mixed zero signs and preserve equal signs. Bare CUDA min/max alone can swallow a NaN.
4. Each reduce expression emits its own accumulator in its lexical scope, initialized to +0 or −∞. Emit one increasing loop per listed axis, first outermost. Evaluate the body and round the fold step inside the innermost loop. A zero trip count returns the initializer. For `blocks`, implement integer ceil or floor of dim/width as recorded. For `tail`, take min(width, dim − width × the bound outer block). Use the model's width of 4. A split tail starts its own sum, and an inlined load uses its already-composed affine addresses. Flattening the two split sums into one accumulator would erase an observable rounding site.
5. Use one binary batch file, `in.bin`, with a little-endian u32 case count. Each case gives each parameter in declaration order, its u64 dimensions (rank known from the function), then exactly the product of the dimensions in little-endian f32 words. Copy only the supplied typed-array view. Main iterates those cases. It writes `out/results.bin` in matching order, with the count, then actual return dimensions, f32 words and one binary64 gpuMs per case. Result rank comes from the signature. Binary preserves zero signs and nonfinite values, and handles the benchmark inputs without decimal parsing. One call is a batch of length one.
6. In the process that records events, call cudaFuncGetAttributes for each kernel before the first start event. This forces lazy loading even for a single runTixCuda case. Allocate, upload and finish initialization before timing. Use CUDA events immediately before and after the ordered kernel sequence in its stream. Synchronize the stop event and read elapsed milliseconds before copying the result back. A function with no launches reports zero and still returns the correct buffer. Keep allocations, input/output copies, file I/O, compilation, process startup and context creation outside the events. Check CUDA calls, launch status and stop synchronization. Decode exactly one observation per requested case and validate its byte length before comparison.

## Acceptance and evidence

Define `tensor.lower.cuda@1` with typed inputs for the current Tix artifact, its origin and the selected function name, and a string output for the emitted source. Its body calls the emitter. Bind a relational postcondition to the origin, name and **actual output text**. A subject may be mutated in a test without regenerating it in the checker. Let `AnalysisManager.execute` verify that postcondition. Use a translation digest in evidence. The contract can reject a function even though the C compiles and every launch succeeds.

Use the original function as the f64 reference on the same f32 input words, also after split-sum or inline. The original anchors the end-to-end error budget across optimizations. Comparing only to the current f32 function would discard the chosen f64 relation. Separately test that the emitter follows the *current* tree with a split witness whose two f32 words differ and with a transposed inlined read.

- Factor the existing per-function generator and comparator out of `src/tensor/contract.ts` for internal reuse. Preserve stage-1 iteration and random-stream order in its own gate. For this one-function lowering use seed 20, the uniform symbol assignments 1, 3, 4, 7 and the mixed 3/5/7 assignment in sorted symbol order. Deduplicate, use signed, positive and half-ULP streams, retain the 4,096-element and one-million-visit limits and screen shapes/addresses using the origin. Cache the generated f32 inputs and finite f64 references together. Require at least one comparable case for the selected function. Add explicit zero-extent execution tests alongside these samples.
- The async spec receives all missing case indices in order. Pack just those cases into one directory, write the supplied source as `main.cu` and invoke `tools/cuda-remote.mjs` once via asynchronous Node child-process execution. The CLI can block inside its own process. Use a fresh local directory per invocation. Match results to indices, require equal shapes, counts and finite candidate values, then compare every coordinate with the budget above. Report function, shape assignment, seed, stream, coordinate, expected, actual and allowed error for the first disagreement. Empty arrays still require shape equality. Reference cases with nonfinite returns fall outside this tolerance sample as in stage 1. Direct GPU tests exercise empty max, NaNs and zero signs.
- Use the framework's process-local differential reuse. Give the spec a fixed count of 15 (five assignments × three streams), even when screening produces fewer cases. This lets the memo look up the case set before running the generator. Its baseline key comprises origin revision and function name, with generator, f64 evaluator, relation and wire versions covered by the versioned spec. Its subject key comprises a digest of the exact CUDA bytes and the fixed engine profile (host, GB10/sm_121, nvcc 13.0.88, flags and runner version). Pin the checked engine to this configuration and on every delegated batch compare the tool's host to manuel@bling and the executable's cudaGetDeviceProperties name, major and minor and cudaRuntimeGetVersion to NVIDIA GB10, 12, 1 and 13000. Treat nvcc 13.0.88, flags and runner semantics as versioned configuration constants. The memo lives only for the process using that fixed engine. The optional host override on direct runs supplies no checked evidence. A changed function, case set, relation, source or engine identity misses the corresponding evidence. Case order and indices are part of the framework memo. A full hit avoids SSH entirely. On a partial hit the batch contains only misses. A remote failure or incomplete batch supplies no numerical verdict to cache. Keep the GPU clock measurement out of this memo.
- Bind evidence to the sampled method, case counts and counterexamples. Expose a semantic rejection through the fixed verdict and include the first counterexample when available. Keep transport and tool errors distinguishable from numerical disagreement and retryable. The executable cache only saves compilation. Finding a binary on the server supplies no evidence that a case passed.

## Framework and runner change ledger

| Proposed change | Repository finding, simplest alternative and test |
| --- | --- |
| `src/framework/contracts/differential.ts` — allow a batch-only specification at the async runner | `runDifferentialAsync` already computes missing indices, calls `decide` once, checks the result count and reconstructs ordered evidence. Its type still requires synchronous `run` and `compare`, because today's delegate may decline a batch. Add an async-only overload accepting the existing case/key/description fields and a required `decide(...) => Promise<readonly Decided[]>`. Share the existing preparation, memo and tally path. Guard synchronous evaluation and worker-side single-case evaluation against batch-only specifications. A throwing placeholder callback would misrepresent how GPU checks can run. No new scheduler or cache is needed. Use this overload inside the CUDA postcondition's `defineInvariant`. Test full and partial replay, failed batch retry, result-count mismatch and ordered counterexample reporting in a focused framework test. |
| `tools/cuda-remote.mjs` — isolate each invocation's files, retain the shared compiled binary | The current tool uploads into the shared hash directory, compiles to `prog`, removes `out` there and fetches it via a later SSH call. Two concurrent cold checkLowering calls on the same function upload identical files and can compile, clear, run and fetch in that directory concurrently. A unique *local* temporary directory alone cannot isolate their remote results. Stage files in a private remote run directory per invocation. Serialize compile misses with a per-key lock, compile there, atomically publish a successful binary into the hash cache, and run that binary as the job's `./prog`. Fetch only this job's output and clean up the job. Preserve the existing CLI, architecture option, full-input compile reuse and measurement-only GPU lock. Surface unsuccessful fetches. Test overlapping cold checks on byte-identical input directories, then replay identical files and observe a compile hit. |

The existing manager already accepts artifact-to-text transformations with async postconditions. A local probe accepted a good text candidate, replayed its two cases without dispatch, and rejected changed text after one further dispatch. Its counts were four delegated and two replayed. This leaves the pass runner, IR adapter and analysis manager intact. No framework changes were made during design. [Contract probe](../scripts/03-contract-probe.mjs)

## Validation and measurements after review

Build once with `npm run build`. Keep GPU tests in `tests/tensor/cuda-gpu.test.mjs`. Offline tests inspect emission, statement counts and identifier hygiene, check binary round trips including subarray offsets, and exercise a delegated fake engine. Run the named tensor files and the affected framework tests, including the existing differential checks. On the GPU, compare all six fixtures before and after optimization at small asymmetric shapes. Include a parameter return, nested shadowing, zero output, empty sum/max, positive and negative zero, NaN propagation, non-multiple block tail and multi-axis convolution. Reject real, compilable candidate text with a dropped tail on positive inputs. Use the seven-element half-ULP witness to check the returned GPU *words* for ordinary versus split sums. This tests order beyond what the tolerance can distinguish.

Benchmark the original corpus sources. For each row below, generate the f32 inputs once locally in parameter order with seed 20, bounded signed values and positive layernorm epsilon (`1e-5` rounded to f32). Reuse the same words for both engines. In one process under `--timed`, execute one warm-up and three measured kernel sequences on the same input and report the median of the three event intervals. A separate warm-up process would lose the loaded modules. Warm the interpreter on a small instance, then time one complete public `runTix(..., {precision:'f32'})` at the requested size with `performance.now()`. Mark that column as one wall-time sample including interpreter allocations. Generate inputs outside both intervals. Record result shape, timing units, repetition count and interpreter-to-GPU time ratio with the benchmark driver and raw measurements in the ticket. For the ratio “speedup”, divide CPU ms by GPU ms.

| Function | Concrete dimensions |
| --- | --- |
| matmul | M = K = N = 512 |
| softmax | N = 4096, C = 1024 |
| layernorm | N = 4096, D = 1024 |
| attention | Q = K = 1024, D = V = 64 |
| mlp | N = 1024, D = 256, H = 1024, O = 256 |
| conv2d | N = 8, C = 16, H = W = 64, O = 32, kernel = 3 × 3 |

Implement the emitter and driver first, then the batch-only contract path and checked transformation, then mutation tests and benchmarks. Record each actual framework and runner edit with its reason in the diary and final stage report. The present ticket contains the numerical and framework feasibility probes. The review accepted the lowering and numerical relation with the timing and engine identity revisions above.

## Later

- Fusion, tiling/shared memory, tensor cores, other thread mappings, streaming attention and autotuning belong to subsequent stages.
