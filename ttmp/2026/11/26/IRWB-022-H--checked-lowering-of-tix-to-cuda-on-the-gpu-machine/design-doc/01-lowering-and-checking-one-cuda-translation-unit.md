---
Title: Lowering and checking one CUDA translation unit
Ticket: IRWB-022-H
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/README.md
      Note: Async transformation guarantees and analysis reuse
    - Path: repo://src/tensor/contract.ts
      Note: Stage-1 numerical budget and origin-derived cases
    - Path: repo://tools/cuda-remote.mjs
      Note: Compiler cache and remote run isolation
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T15:11:51.948392056-05:00
WhatFor: ""
WhenToUse: ""
---

# Lowering and checking one CUDA translation unit

**For review.** Emit CUDA C directly from the selected function in `program.current`. Check the emitted bytes by executing them on the GB10, comparing their returned tensor to the original function evaluated in f64. This is sampled numerical agreement, not bit equivalence or a bound on arbitrary Tix expressions.

### Why tolerance: a GB10 result before implementation

At `x = -7.998046875`, `Math.fround(Math.exp(x))` is 0.0003361184790264815; GB10 `expf(x)` returned 0.00033611844992265105. The probe used Node 24.18.0 and the tool defaults, `nvcc` 13.0.88 `-O3 -arch=sm_121`, no fast math. It sampled 16,384 exactly representable x values spaced by 1/1024 starting at −8. Log and sqrt used x+9. Here a budget unit is `2e-6 + 2e-5*abs(JS double reference)` as in stage 1.

| Device op | Outputs differing from rounded JS | Largest absolute error / budget |
|---|---:|---:|
| expf | 5007 | .006570 |
| logf | 902 | .003529 |
| sqrtf | 0 | .002899 |
| tanhf | 1264 | .006001 |

Keep this budget rather than introducing a second one for the backend. The measurement supports the intrinsic choice on this sample; it does **not** bound cancellation or long sums. Check whole outputs, including compounded errors, without enlarging the budget when they fail. Record maximum budget fraction and coordinate per corpus check. Software emulation of the Node math library might support a stronger contract but is unnecessary for this relation. [Replay and raw-output digest](../reference/01-stage-2-diary.md).

### Translation and execution

Support checked Tix modules, including multiple functions, optimized trees, and returns of parameters. Use finite row-major Float32Array inputs of the declared concrete shapes, consistent directly bound shape names, valid affine accesses, nonnegative extents and representable sizes, addresses and device allocations. Bind and validate dimensions before launching. Case-generation work caps are not runtime shape limits.

No kernel IR: the current IR already has materialization boundaries, resolved affine reads, lexical binder identities and ordered folds. A second editable representation would add an adapter, validator and identities without a transformation to perform there. Instead produce a deterministic complete translation unit, indexed by function and independent of concrete sizes/values. `cudaSource` exposes those exact bytes, not a checked verdict. `runTixCuda` executes the same candidate on the supplied case; `checkLowering` is the separate checked pass. No changes to the three existing synchronous APIs.

- Generate identifiers by ordinal in separate tensor, shape, binder and temporary tables; do not interpolate Tix names as C identifiers. Emit one global kernel per current definition. A linear thread id below the result size decodes output coordinates by repeated division/remainder from last dimension to first. Use signed 64-bit affine arithmetic and row-major offsets. One output store, no atomics. Skip launches with zero output elements.
- Recursively emit scalar temporaries. A reduction declares a fresh accumulator (+0 or −∞), then one increasing loop per axis, first axis outermost; emit its body inside the innermost loop. Nested folds initialize on each invocation. A `blocks` extent uses its IR rounding mode on dim/4; `tail` depends on the bound outer block. An inlined load uses the rewritten coefficients unchanged. Shadowed source spellings never identify loop variables.
- Emit literal bits from `Math.fround(Number(text))`, convert shape scalars to nearest f32. Use float negation, explicit CUDA round-to-nearest add/sub/mul/div intrinsics (also add for sum) to prevent contraction; `expf/logf/sqrtf/tanhf`, no fast math or FTZ flag. Implement min/max with NaN propagation and JS zero tie rules (−0 wins min, +0 wins max), including maximum fold. Tolerance is not permission to regroup reductions.
- Main reads a versioned little-endian binary packet (case count then, per case, parameter dimensions and f32 bytes in declaration order); result packet in `out/` carries case ordinal, concrete shape, f32 bytes and event milliseconds. No text float serialization. Use one buffer per materialized tensor, copy inputs, launch in definition order on one stream, then copy only the return, including a parameter return. Empty tensors need neither a nonzero-length copy nor a zero-byte allocation. Check CUDA calls, launches and synchronization. Validate packet lengths, expected case count/IDs and sizes before using any observation.
- Allocate and transfer before recording the start event; record stop after the last kernel on that stream, synchronize stop before elapsed-time query and D2H. No kernels means zero milliseconds. `runTixCuda` uses a fresh local temporary directory, invokes the existing tool as an **asynchronous child** with argv (forward optional host), verifies status, metadata and downloaded files, cleans up. No blocking child in the caller's event loop. Keep generated `main` and marshalling identical for one or many cases.

### Checked pass and reuse boundary

Use `defineTransformation` on named ports: origin and current Tix artifacts plus function name → CUDA source (validated contracts artifact of immutable text). This is a pass between representations, not an edit to the tensor artifact. Its body is the same emitter as `cudaSource`. Its `ensures` is an asynchronous `defineInvariant` binding these inputs and the **actual output**. Run through `AnalysisManager.execute`; never regenerate a presumed candidate in the checker. A rejected guarantee returns a negative verdict with reason, not an accepted lowering. Keep tool/transport failure distinguishable from numerical disagreement; neither supports acceptance. No CPU fallback.

Refactor stage-1 case/compare helpers locally without changing their existing streams or verdicts. For the selected function seed 20, deduplicate original shapes (1,3,4,7,mixed); signed, positive and half-ulp f32 streams; retain original-domain in-bounds cases, ≤4096 elements per tensor and ≤1M evaluation steps. Oracle = **origin f64 on identical input words** even after accepted split-sum, not current f32 plus a second budget. Selection uses only the origin; require comparable finite reference observations and at least one observed element when a nonempty result is possible. Empty shapes are also checked structurally. Require same concrete shape and every candidate element finite and within budget. Keep case identity, seed, coordinate, reference, actual, allowance, maxima and sample counts. Test nonfinite semantics and signed zero separately with direct f32 examples: a finite-only numerical gate cannot certify them.

Prepare all eligible cases locally, issue one untimed remote invocation per function/check, compare by case ID. Never invoke the tool per element/case. Invariant calls a versioned async `ctx.analysis` on the CUDA artifact, with canonical JSON parameters encoding the small packet (base64), function, protocol/engine profile and host. Return observations as shape and f32 words, not JSON NaN or timings. Process-local manager scoped to the fixed GB10/toolchain session; a changed host, nvcc path/version, flags, architecture, driver or protocol starts a new profile/manager. Pin/verify the environment fingerprint at session creation through the tool; no persistent verdict cache. Record profile in evidence. Reuse completed validated observations by candidate revision, engine and exact case bytes through the manager; evaluate the current invariant on them, so changes of baseline or comparator do not silently inherit a verdict. Do not cache transport failures or use this path for timing. Sequential repeated successful checks must not execute the batch twice. If concurrent callers share an outstanding invocation, coalesce only identical full keys and discard failed promises.

### Change ledger (proposed, not implemented)

| Location | Decision and reason | Verification |
|---|---|---|
| `src/framework/` | **No source edits proposed.** `applyNativePassSync` cannot await a GPU and `applyPass<S>` has one input/output adapter. Neither fits lowering. Heterogeneous transformation ports, async invariant checks and revision/parameter-keyed analyses already supply the needed gate and evidence lifetime. Synchronous `runDifferential` is per case; batching belongs in the domain invariant, not an async copy of the entire pass runner. | Use a counting mock batch engine: one invocation for many cases, warm reuse, changed candidate/input/profile misses, rejected mutation and failed run retried. Record any actual gap here before extending the framework. |
| `tools/cuda-remote.mjs` | Keep compile flags, full-input compile cache and timed lock. Isolate each invocation's input/output directory from other callers with the same hash; publish a completed binary under a per-build-key lock. Today `rm -rf out` races another fetch. Include compiler identity/flags in compile key and expose engine fingerprint (host, device/arch, driver and nvcc version) in metadata with a lightweight profile query for evidence reuse. No Tix formats in this tool. | Same packet twice reuses compile, overlapping invocations get their own outputs, compiler/profile change invalidates reuse. Profile query does not compile or run a Tix case. |

### Acceptance and measurement after review

Build with `npm run build`. Keep network-free emitter, packet, rejection/reuse and stage-1 tests separate from a dedicated GPU test file. Test rectangular strides, affine convolution, shape scalars, all scalar ops, return-input/no statements, zero output and empty reductions, tensor/index name collisions and nested shadows, inline transpose and split tails (K=7) on real optimized programs. Check independent small corpus oracles and all six real gates. Inject a valid but wrong CUDA candidate (omit split tail or swap coordinates); demonstrate the remote gate rejects with the first divergent case, and that an earlier accepted source cannot authorize it. Run explicit test files only, request escalation on child EPERM; no full suite.

Benchmark the unoptimized corpus, one program at a time, with reproducible bounded f32 inputs on both engines. Use a ticket script, seed and input digest; compile and prepare inputs outside the stopwatch. Small warmup on CPU, one full-size `performance.now()` interval around stage-1 `runTix` f32 including its normal allocations. Do not substitute a specialized interpreter even for the two large MLP multiplies. On GPU use `--timed` only for measurement: one warmup then three event intervals for the full kernel sequence on resident inputs, report median plus range. If one iteration is long, cap repetitions and report count. No transfer, process startup or compilation in `gpuMs`. Run the following exact shapes, not scaled estimates:

| function | dimensions |
|---|---|
| matmul | M=K=N=512 |
| softmax | N=4096, C=1024 |
| layernorm | N=4096, D=1024 |
| attention | Q=K=1024, D=V=64 |
| mlp | N=1024, D=256, H=1024, O=256 |
| conv2d | N=8, C=16, H=W=64, O=32, kernel 3×3 |

Report both times in ms, shapes, host/device/compiler/Node, repetition counts and a result sanity comparison. These are baseline measurements, not a throughput target. Sequence: emitter and local tests → packet/remote runner → async gate, mutation and reuse tests → measurements and as-built ledger. No scheduling or further GPU optimization in this ticket.
