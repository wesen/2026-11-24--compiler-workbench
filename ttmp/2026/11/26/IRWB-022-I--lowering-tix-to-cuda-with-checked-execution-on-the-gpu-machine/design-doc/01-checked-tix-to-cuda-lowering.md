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
4. Use one versioned little-endian binary request file with a case count, then each case's shapes and f32 words in parameter/rank order. Use 64-bit counts and dimensions. Write responses in the same order to `out/results.bin`, with case count, returned shape, f32 words and f64 `gpuMs` for each case. The translation unit knows ranks from the function. Include the timing value independently of tensor data. One-file-per-tensor would add paths and file operations for each case. A one-case run uses the batch format with count one. The TS wrapper writes a fresh request directory, asynchronously invokes the tool, validates the returned case count, shapes and byte lengths, and cleans up its directory.

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

Use a versioned `defineTransformation` from the existing Tix IR contract type plus selected function to a typed CUDA source artifact. Its body calls the same emitter as `cudaSource`. Its `ensures` invariant is async and runs the **candidate artifact's** source with the case batch. `AnalysisManager.execute` waits for the invariant before accepting the output. `checkLowering` surfaces the verdict and distinguishes a numerical counterexample from unavailable execution evidence in `reason`. The transformation uses `cache: 'never'`. Model the pinned device/compiler configuration as a versioned read-only resource in `MemoryResources`. The tensor runner issues ephemeral execution requests using that profile.

**Framework change ledger.** No source edits proposed. `definePass` writes a revision through the same IR adapter, and `applyNativePassSync` needs a synchronous two-artifact check. Extending either would require defining cross-kind diffs or another generic acceptance path. The existing transformation has independent input and output ports and an awaited postcondition. The [cross-kind probe](../scripts/02-contract-probe.mjs) ran on the worktree build and showed async acceptance, rejection of a different output artifact and re-execution of the invariant on repeat. The manager records checked evidence, while its transformation body cache would not save a repeated GPU postcondition. Putting the GPU batch and its memo in the tensor invariant avoids modifying the generic differential loop that Stage 1 uses per case.

- **Batch construction.** Reuse the Stage 1 deterministic sample recipes and safety limits for the selected current function. Use shape assignments 1, 3, 4, 7 and mixed, plus all-zero and one-zero-at-a-time assignments to exercise empty outputs and reductions with nonempty outputs. Deduplicate shapes. Use seed 20, signed and positive data, the half-ULP sequence and signed zero. Select cases with valid source shapes/addresses, at most 4,096 elements per tensor and at most 10^6 metered evaluator steps per case. Keep the Stage 1 optimizer's existing streams and selection behavior. The CUDA check must have at least one eligible case. Record each case's shape assignment, stream and seed and compare every output of the single remote batch.
- **Evidence reuse.** Retain a bounded process-local memo of completed semantic verdicts and share one in-flight Promise per identical check. Key it by the exact Tix revision, selected function, CUDA artifact revision, case-batch digest, checker/recipe version, Node version and pinned engine profile. Record the case count, measured max error/budget fraction, first mismatch coordinates and reported execution identity. A completed disagreement is evidence too. A transport, compile or malformed-output failure supplies no reusable result. The pinned configuration is a process lifetime assumption. Verify the reported engine profile on fresh runs and start a new session when it changes. A persistent memo would need live engine identity and a storage policy. The runner's binary cache is independent and can save compilation across different case data.

## Proposed runner changes

| Change in `tools/cuda-remote.mjs` | Reason and simpler alternative |
| --- | --- |
| Allow explicit runtime-only paths, e.g. `--runtime-input inputs.bin`. Hash build file names and bytes together with architecture, compile options and remote nvcc path/version. Keep files classified as build inputs by default. Allow a pinned `--nvcc` path for the contract. Include execution identity in results and surface upload/compile/run/fetch failure to the caller. | The current all-file hash is useful for self-contained fixtures. It recompiles identical `main.cu` for every new tensor input and can select a binary made with a different nvcc at the same path. No new floating-point flag is needed. |
| Use a per-invocation remote working directory through upload, launch and fetch. Share only the compiled binary by build key. Use a per-key compile lock and install a successful binary by rename before other jobs can use it. | Today concurrent identical runs share `out/` and may delete or fetch each other's files. A lock around only `./prog` leaves the upload/fetch race. Isolation also lets different inputs reuse the binary. |
| Take a shared GPU lock for ordinary runs and an exclusive lock for `--timed`. Keep compilation and transfers to/from the caller outside the GPU lock. | The existing exclusive timed lock coordinates timed callers, but ordinary runs can still launch inside a measurement. Shared locks retain concurrency between ordinary runs. The guarantee applies to callers using the updated tool. |

The worktree probes exercised the unmodified runner, async Node invocation, nvcc's remote version query, and local `flock` shared/exclusive behavior. Verify build reuse when only input data changes, invalidation when a build input changes, isolation for simultaneous runs and the two lock modes after implementing the runner changes.

## Verification and measurements after review

- Build with `npm run build` and test the Stage 1 tensor files plus the local CUDA emitter, protocol and check orchestration tests. Use a fake batch engine to verify one batch, repeat/concurrent evidence reuse, failure retry and cache-key changes. Test that a valid CUDA artifact with an index or tail mutation fails the same invariant.
- Keep remote assertions in their own `tests/tensor/cuda-gpu.test.mjs`. Check each small corpus function before and after actual accepted rewrites, including permuted inline addresses and the split half-ULP witness. Check nested shadowing, affine convolution offsets, empty outputs, empty reductions, a direct parameter return, signed zeros, NaN propagation and changed compiler inputs. Run only the relevant Node test files.
- Benchmark original Stage 1 corpus programs on identical seeded f32 input buffers. Use small signed values and a positive eps for layernorm. Run the interpreter once at full size per function, timing `runTix` with a local monotonic clock after input preparation and compilation. On the GB10 use one short `--timed` invocation per function, with one warmup and three kernel timings in the same executable. Record CUDA events on the function's stream immediately before the first launch and after the last launch. Synchronize the final event outside the timed interval and take the median. Keep allocation, copies, process startup, compilation and SSH outside the interval. Report CPU wall ms, GPU kernel ms, timing sample counts, machine/toolchain and a value comparison using the retained results. The standalone public runner reports a kernel interval for its own call.

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
