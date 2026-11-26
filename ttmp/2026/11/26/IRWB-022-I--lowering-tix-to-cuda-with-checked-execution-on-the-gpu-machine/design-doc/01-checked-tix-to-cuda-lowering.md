---
Title: Checked Tix to CUDA lowering
Ticket: IRWB-022-I
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
      Note: Awaits the cross-kind lowering postcondition
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Same-adapter edit runner used by Stage 1
    - Path: repo://src/tensor/contract.ts
      Note: Deterministic case recipe and existing tolerance
    - Path: repo://src/tensor/evaluate.ts
      Note: Stage 1 f32 meaning and f64 reference
    - Path: repo://src/tensor/model.ts
      Note: Resolved scalar trees, affine forms and generated bounds
    - Path: repo://tools/cuda-remote.mjs
      Note: Remote execution and proposed cache and isolation changes
ExternalSources: []
Summary: Direct CUDA emission, batched GB10 tolerance checking, runner changes and a corpus timing protocol.
LastUpdated: 2026-11-26T15:11:52.868981794-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked Tix to CUDA lowering

## Domain and API

Lower the named function in `program.current` from a `compileTix` or `optimizeTix` result. Support the Stage 1 checked core, including affine shapes and addresses, shadowed reduction indices, zero extents, and generated block/tail bounds. Concrete calls have the same valid shapes, finite f32 inputs and in-bounds row-major reads as Stage 1. The target is a GB10 CUDA 13.0 environment with sufficient memory and launch capacity for the selected function and shape. Finite inputs can produce signed zeros, infinities and NaNs. The contract's sampled domain is specified below.

| Export from `dist/tensor/index.js` | Behavior |
| --- | --- |
| `cudaSource(program, fn)` | Emit the complete deterministic CUDA C++ translation unit, including a standalone batch-file reader and output writer. |
| `runTixCuda(program, fn, inputs, options?)` | Execute one case of that translation unit via `tools/cuda-remote.mjs`, honoring `options.host`. Return the actual shape, `Float32Array` and CUDA-event `gpuMs`. |
| `checkLowering(program, fn)` | Apply the checked lowering pass on the default GB10 and return `{ accepted, relation: 'tolerance', reason? }`. The check is per named function and revision. |

Source emission and a concrete run are independently accessible through the fixed API. The checked pass gives the lowering its sampled meaning verdict. Stage 1 exports keep their behavior and signatures.

## Emit directly from Tix IR

Emit CUDA text from the resolved Stage 1 function. The ordered definitions, explicit axes and expression trees already determine every kernel and loop. A kernel IR would restate that information and add a validator and emitter. There is a typed CUDA *source* artifact for the framework's output port. Its payload contains the function name and translation unit. It has no kernel graph or editable adapter.

1. Generate a C++ symbol for each tensor and binder from its identity. The C++ host binds shapes from bare axes in the input headers, evaluates affine dimensions and prepares row-major buffers. Emit integer shape and address arithmetic separately from scalar f32 expressions. Use signed 64-bit intermediates for affine expressions and 64-bit flattened offsets.
2. Emit and materialize one kernel for each statement in the current revision, in definition order. Launch 256 threads per block, guard against the element count, and decode the linear thread number to row-major coordinates. Pass each kernel the shape values and pointers it needs. A single CUDA stream orders writes and later reads. Skip a launch with zero output elements. Empty buffers need no data copy, and a function returning an input directly can execute with zero launches and report zero kernel milliseconds.
3. Emit a tree walk with a temporary for each scalar operation. For every reduction, nest sequential loops with the first binder outermost. Initialize the accumulator to `+0.0f` or `-INFINITY` and round every fold. An inner reduction gets a fresh accumulator inside the enclosing body. An empty loop returns its initializer. The three IR extent kinds emit affine dimensions, the specified integer ceiling/floor division by `width`, and `min(width, dim - width * block)`. This keeps both levels of a split sum and its short final block. Inline's composed affine addresses use the same emitter as source addresses.
4. Use one versioned little-endian binary request file with a case count, then each case's shapes and f32 words in parameter/rank order. Use 64-bit counts and dimensions. Write responses in the same order to `out/results.bin`, with case count, returned shape, f32 words and f64 `gpuMs` for each case. The translation unit knows ranks from the function. Before measuring, initialize CUDA and call `cudaFuncGetAttributes` for each kernel that will launch to force lazy module loading outside the event interval. Include the timing value independently of tensor data. One-file-per-tensor would add paths and file operations for each case. A one-case run uses the batch format with count one. The TS wrapper writes a fresh request directory, asynchronously invokes the tool, validates the returned case count, shapes and byte lengths, and cleans up its directory.

## Numerical relation

Use a tolerance against `runTix` in f64 on the **current revision**, fed the same f32 input words. Each candidate must return the reference shape and element count. For every finite reference element `r`, require a finite candidate `g` and

```text
abs(g - r) <= 2e-6 + 2e-5 * abs(r)
```

For a nonfinite reference, require the same signed infinity or that both values are NaN. This covers an empty maximum and domain errors such as a negative square root. The tolerance gives zero sign and NaN payload no checking role. The emitter still implements signed-zero semantics. An already ill-conditioned f32 program can exceed the finite budget even when correctly lowered. This bound is for the contract's reproducible cases. A universal forward-error bound would depend on sizes, conditioning, intermediate overflow and the operations involved.

Keep Stage 1 f32 rounding sites despite the tolerance. Use the runner's `nvcc -O3 -arch=sm_121`, with the default gradual underflow and no fast-math flag. Emit f32 literal words computed from `Math.fround(Number(text))`, round shape values from integer with `__ll2float_rn`, and load and store f32. Use `__fadd_rn`, `__fsub_rn`, `__fmul_rn`, `__fdiv_rn`, unary sign flip and `__fsqrt_rn`. The explicit add/multiply intrinsics prevent contraction at the Tix rounding sites, including reductions. Compute `exp`, `log` and `tanh` on double arguments with the CUDA double routines and round once with `__double2float_rn`. Implement min/max with NaN propagation and tie handling that chooses +0 for a mixed-zero max and -0 for a mixed-zero min. Use that same max operation for the reduction fold.

### Evidence from the GB10

The [replay script](../scripts/01-fp-probe.mjs) runs a handwritten CUDA probe through the current tool. It compares 102,461 f32 triples covering raw finite words, bounded intrinsic ranges, zeros, subnormals, overflow and a multiply-add witness. It also computes four dot products of length 1023 twice, with sequential folding and then with the actual `split-sum` grouping including the three-element tail. Those eight outputs are compared to Stage 1 on Node 24.18.0. The physical device reported NVIDIA GB10, sm_121, nvcc 13.0.88 and driver API version 13000.

| Probe | Observation |
| --- | --- |
| Explicit arithmetic, separate multiply/add, double transcendental path | Zero non-NaN word mismatches against the JS f32 reference. The worst selected primitive used about 0.30% of the finite tolerance. |
| Plain `a*b+c` and CUDA single-precision transcendentals | Plain arithmetic differed in 2,556 cases. `expf`, `logf` and `tanhf` differed on 16,615, 2,255 and 3,553 non-NaN results respectively. |
| NaN encodings | For `sqrt(-2^-149)` the GPU wrote `0x7fffffff` and JS wrote `0xffc00000`. The NaN word differences make strict bit equality unsuitable for the whole domain with these operations. |
| Ordered and split reductions | All eight matched the respective Stage 1 f32 words. The largest absolute error against the respective f64 reference was 6.95e-5 at a reference of about 400.62. The worst budget fraction across the eight was 1.38%. The half-ULP row gave 1 sequentially and 1.000000238418579 when split. |

Reuse the Stage 1 tolerance at this scale based on these measured margins. A looser tolerance would discard sensitivity without a need demonstrated by the probe. Corpus-wide validation of the emitted program belongs to implementation. Run `npm run build`, then `node <ticket>/scripts/01-fp-probe.mjs` to reproduce.

## Checked pass and reuse

Use a versioned `defineTransformation` from the existing Tix IR contract type plus selected function to a typed CUDA source artifact. Its body calls the same emitter as `cudaSource`. Its `ensures` invariant is `differential` with asynchronous `decide`. `AnalysisManager.execute` waits for the invariant before accepting the output. The body uses `cache: 'never'`. `checkLowering` surfaces the first numerical counterexample or the execution failure.

**Framework change ledger.** No source edits are required. The existing heterogeneous transformation accepts separate input and output kinds, and `runDifferentialAsync` delegates undecided cases together and records their verdicts. A direct probe issued four checks against two subjects, generated cases once, issued two batches, and replayed both accepted and rejected verdicts. The same-adapter edit pass and a separate tensor verdict cache would duplicate facilities already present here.

- **Batch construction.** Reuse the Stage 1 deterministic sample recipes and limits for the selected current function. Use shape assignments 1, 3, 4, 7 and mixed, plus all-zero and one-zero-at-a-time assignments to exercise empty outputs and reductions with nonempty outputs. Deduplicate shapes. Use seed 20, signed and positive data, the half-ULP sequence and signed zero. Select cases with valid source shapes/addresses, at most 4,096 elements per tensor and at most 10^6 metered evaluator steps per case. Keep the Stage 1 optimizer's streams and selection behavior. Generate the f64 reference with the samples. The CUDA check must have at least one eligible case. `decide` sends the cases at the undecided indices in one request, compares every returned result, and returns verdicts in index order.
- **Evidence reuse.** Key the framework's baseline cache by current revision and function. Key the subject by CUDA artifact revision and execution profile. The framework already includes the checker version and seed, and retains the case list, reference values in the cases and decided verdicts. Use a process-stable profile for the GB10 runner settings, including its existing compiler and host overrides. Start a new process when changing those settings. Transport, compilation and malformed output errors throw from `decide` before it returns verdicts, so a later check can retry. Two concurrent cold checks can both run. Sequential repeated checks replay the completed evidence.

## Proposed runner changes

| Change in `tools/cuda-remote.mjs` | Reason and simpler alternative |
| --- | --- |
| Add repeatable `--runtime-input <relative-path>`. Keep those files in the job upload and outside the compile key. Retain the existing environment defaults and JSON shape. | The current all-file key recompiles identical source for each new tensor input. Defaulting every file to build input preserves header and fixture behavior. |
| Use a unique per-invocation remote working directory through upload, launch and fetch. Share only the compiled binary by build key. Use a per-key compile lock and install successful binaries by rename. | Concurrent jobs with identical build inputs must keep their input and output files separate. A lock around only `./prog` leaves the upload and fetch race. |
| Surface copy, compilation, run and fetch errors to the caller. Keep the GPU lock exclusive and specific to `--timed`. | The contract needs to distinguish unavailable evidence from successful execution. Ordinary runs retain the tool's documented behavior. |

The launch probe on GB10 recorded 0.060768 ms on a cold launch, 0.003584 ms for its repeat, and 0.003360 ms on the first launch of another kernel after querying its attributes. The generated launcher preloads kernels for public single-case calls as well as for benchmarks. Verify binary reuse when only input data changes, invalidation for changed build inputs and isolation for simultaneous jobs.

## Verification and measurements after review

- Build with `npm run build` and test the Stage 1 tensor files plus the local CUDA emitter, protocol and check orchestration tests. Use a fake batch engine to verify one batch, repeat evidence reuse, failure retry and cache-key changes. Test that a valid CUDA artifact with an index or tail mutation fails the same invariant.
- Keep remote assertions in their own `tests/tensor/cuda-gpu.test.mjs`. Check each small corpus function before and after actual accepted rewrites, including permuted inline addresses and the split half-ULP witness. Check nested shadowing, affine convolution offsets, empty outputs, empty reductions, a direct parameter return, signed zeros, NaN propagation and changed compiler inputs. Run only the relevant Node test files.
- Benchmark original Stage 1 corpus programs on identical seeded f32 input buffers. Use small signed values and a positive eps for layernorm. Run the interpreter once at full size per function, timing `runTix` with a local monotonic clock after input preparation and compilation. On the GB10 use one short `--timed` invocation per function, with one warmup and three kernel timings in the same executable. Record CUDA events on the function's stream immediately before the first launch and after the last launch. Synchronize the final event outside the timed interval and take the median. Keep allocation, copies, process startup, compilation and SSH outside the interval. Report CPU wall ms, GPU kernel ms, timing sample counts, machine/toolchain and a value comparison using the retained results. The public runner preloads its kernels and reports one measured invocation.

| Corpus function | Full-size bindings |
| --- | --- |
| matmul | M = K = N = 512 |
| softmax | N = 4096, C = 1024 |
| layernorm | N = 4096, D = 1024 |
| attention | Q = K = 1024, D = V = 64 |
| mlp | N = 1024, D = 256, H = 1024, O = 256 |
| conv2d | N = 8, C = 16, H = W = 64, O = 32, kernel 3 × 3 |

## Later

- Implement and measure after design review. The GB10 probe is numerical evidence for the proposed lowering and does not supply corpus kernel timings.
- Fusion, tiling and shared memory, tensor cores, other thread mappings, streaming attention and autotuning are deferred by the stage scope.
