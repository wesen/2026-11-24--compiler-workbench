---
Title: Checked Tix to CUDA lowering
Ticket: IRWB-022-C
Status: active
Topics:
    - compiler
    - ir
    - verification
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/analysis-manager.ts
      Note: Checked transformation acceptance boundary
    - Path: repo://src/framework/contracts/differential.ts
      Note: Async batch delegation and case verdict reuse
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Same-IR native and edit pass runners contrasted with emission
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Checked transformation and batch comparison
    - Path: repo://src/tensor/cuda-source.ts
      Note: Direct CUDA emission, kernel loading and event timing
    - Path: repo://src/tensor/evaluate.ts
      Note: Stage-1 f32 and f64 reference execution
    - Path: repo://src/tensor/model.ts
      Note: Domains and generated split bounds
    - Path: repo://tools/cuda-remote.mjs
      Note: GPU compile, execution and result retrieval
ExternalSources: []
Summary: Direct CUDA emission, GPU-backed lowering contract and corpus measurement plan.
LastUpdated: 2026-11-26T15:41:42.841137187-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked Tix to CUDA lowering

Emit CUDA C directly from the selected function in `program.current`. The CUDA program materializes each tensor in order, with one thread per output element and sequential reductions. A framework transformation checks the emitted translation unit by running it on GB10 against deterministic examples from the Tix f64 evaluator. The standalone math probe supports a sampled tolerance, not a cross-engine bit-identity claim.

## Domain and public API

The input is a `TixProgram` from `compileTix` or `optimizeTix` and a function name in that program. Keep the stage-1 calling domain: exactly the named, finite, row-major inputs, positive rank with nonnegative integer dimensions, consistent concrete shape bindings, and in-bounds affine accesses. For CUDA the inputs are `Float32Array`s. Concrete shape arithmetic, sizes and addresses must be representable in the interpreter's safe-integer domain and buffers and launches must fit the CUDA device. This includes functions returning parameters, all-empty outputs, and meaningful infinities or NaNs *produced* from finite inputs. Source diagnostics and the existing three public functions do not change.

- `cudaSource(program, fn)` synchronously emits the complete, shape-generic `main.cu` for that function. It is a preview of the candidate, not a check.
- `runTixCuda(program, fn, inputs, options?)` executes that same source on the given case using `tools/cuda-remote.mjs`, returning the shape, f32 data and kernel-event milliseconds. `options.host` is forwarded when supplied. This API executes a user case; it does not stand in for a contract verdict.
- `checkLowering(program, fn)` applies the checked pass and returns `{ accepted, relation: 'tolerance', reason? }`. Its guarantee runs the exact text produced by the pass. A numerical mismatch, no eligible cases or a failed/incomplete remote check cannot count as acceptance. Report the difference between a counterexample and an execution failure in `reason`.

## Emission and execution

**Representation.** The existing Tix IR already specifies all iteration bounds, tensor edges and expression grouping this mapping needs. A second adapted kernel IR would reproduce those facts plus launch syntax; there is no kernel-to-kernel pass to inspect or modify in this stage. Emit from the validated Tix value via small functions for scalar expressions, loop extents, statements and the host driver. The final source is a versioned contract *value*, not a second native IR or a CUDA parser. Generate CUDA-safe identifiers by ordinals (not Tix names); lookup maps for shapes, tensors and binders remain separate.

| Tix structure | CUDA emission |
| --- | --- |
| Function | Own device buffers for inputs and intermediates. In a single stream, launch in statement order; transfer back the returned tensor, which can be a parameter. |
| Statement | One kernel definition, one 1D launch of blocks of exactly 128 threads when the output has elements. Guard the flat thread ID against the output size. Unflatten from the last axis by remainder and quotient; store at the original flat index. Skip launches for zero-sized outputs. |
| Read | Fold the affine coordinates into a row-major offset using the *read tensor's* extents. Integer address and extent math use signed 64-bit intermediates; widen CUDA block/thread arithmetic before multiplication. |
| Reduction | Emit a fresh local accumulator in the enclosing expression scope, then nested loops in the recorded axis order. Evaluate the body inside the innermost loop; each fold updates once. Bound variables use binder IDs, not source spelling, including shadowing. `blocks` uses quotient plus a remainder bit for ceiling, quotient for floor; `tail` is `min(width, dim - width * block)`. A nested sum from `split-sum` has its own accumulator and is *not* flattened. |
| Scalar expression | Emit child computations before use; each child yields a rounded `float`, including a reduction nested inside an argument. The inliner has already composed affine loads, so no CUDA-specific reconstruction of producer indices is needed. |

The generated `main` reads a versioned binary `inputs.bin`: case count, and for each case the input shapes and raw LE f32 words in parameter order. Ranks are known from the function. It binds names from bare input axes, checks consistent shapes and calculates the output shapes and byte sizes. The launch arguments carry the required concrete dimensions and buffers (shape values are **not** baked into the source). It avoids `cudaMalloc(0)` and zero-byte transfers. One `out/result.bin` contains one record per case in the same order: result rank, extents, `gpuMs`, result words. Check count, shape, lengths, and complete file consumption before comparing; keep f32 bits across the wire (no JSON numbers for tensors). A standalone text/JSON data format would be easier to inspect but slower at the required sizes and would need extra conventions for signed zero, infinities and NaNs.

Initialize the CUDA context and load each kernel with checked `cudaFuncGetAttributes` before the first start event. The reviewer's GB10 probe found 0.115 ms for a trivial first launch versus 0.003 ms for the second (0.004 ms for a first launch after preloading). Allocate buffers and copy inputs outside the event span; record a stop event in the same stream after the last launch, synchronize and read elapsed CUDA-event time before copying the result. Check CUDA calls including launches and event synchronization. Report `0` when no kernels launch. `runTixCuda` uses an asynchronous child process for the tool and a unique local temporary directory; no SSH calls bypass the tool. The contract sends a batch in that same format to amortize the child process, round trips, CUDA context setup and compilation. It runs cases one at a time inside the one executable, not as a different thread mapping.

## Numerical choice and GB10 evidence

Use `nvcc -O3 -arch=sm_121` (default FTZ off; no fast math) and the following primitives. Relying on plain C arithmetic at `-O3` could contract a multiply and add; explicit round-to-nearest intrinsics encode the rounding sites in the source without a tool-wide flag change.

| Operation | Implementation |
| --- | --- |
| Literal / scalar shape | Convert literal in Node via `Math.fround(Number(text))` and emit its f32 word, including overflow. Round integer shape values with `__ll2float_rn`. |
| `+`, `-`, `*`, `/`, unary `-` | `__fadd_rn`, `__fsub_rn`, `__fmul_rn`, `__fdiv_rn`, and sign-bit flip, respectively. Do not use FMA. |
| `sqrt` | `__dsqrt_rn(double(x))`, then `__double2float_rn`. |
| `exp`, `log`, `tanh` | CUDA double `exp`, `log`, `tanh` on the already-rounded child; `__double2float_rn` on the result. |
| `min`, `max` | Explicit NaN propagation; order signed zero as in JS (max of mixed zeros is +0; min is −0), otherwise compare. CUDA `fminf`/`fmaxf` alone have different NaN behavior. |
| `sum`, `max` folds | Start at +0 or −∞ respectively; use the same rounded add or JS-style max for each step. Empty loops leave the initial word. |

[The design probe](../scripts/01-probe-gb10-math.mjs) compiled and ran on `manuel@bling` using the unmodified remote tool: NVIDIA GB10 sm_121, nvcc 13.0.88, driver/runtime API 13000, Node 24.18.0 (V8 13.6.233.17-node.50). It compared 98,181 finite inputs per intrinsic (random f32 bit patterns, targeted ranges and edge values). Mismatches against `Math.fround(Math[op](x))` below compare NaN by class and distinguish signed zeros.

| Intrinsic | CUDA float mismatches | CUDA double then f32 mismatches | Worst finite fraction of proposed f64 budget, widened |
| --- | ---: | ---: | ---: |
| `exp` | 19,304 | 0 | 0.002973 |
| `log` | 2,275 | 0 | 0.002951 |
| `sqrt` | 0 | 0 | 0.002960 |
| `tanh` | 2,210 | 0 | 0.002418 |

For instance `expf(-1)` returned `0x3ebc5ab3`, one word above the Node result `0x3ebc5ab2`. The same run (`9c45bcb28076192b`) distinguished separate multiplication/addition from FMA (`0x00000000` versus `0xa8800000`), retained the two-minimum-subnormals sum (`0x00000002`), and showed why `fmaxf(NaN,x)` cannot implement JS max. The probe also successfully recorded and synchronized CUDA events. It did not run generated Tix kernels or establish any workload timing.

**Relation.** For a finite f32 semantic result with finite f64 reference `r`, require a finite GPU result `g` and `abs(g - r) <= 2e-6 + 2e-5 * abs(r)`. Evaluate the *immediate input revision* in f64 on exactly the uploaded f32 words. Comparing optimized CUDA to the origin would conflate the new lowering with a reassociation already checked by stage 1. Widened intrinsics leave margin in the probe, but zero sampled mismatches are not a guarantee about V8 and libdevice rounding near every f32 midpoint. A bit-identity contract would need that guarantee or an implementation of the matching host functions on device. The budget reuses the stage-1 small-case envelope: the relative term is about 336 f32 unit roundoffs; short, well-conditioned sums have error on the scale of their length times one unit roundoff, and the absolute term allows small cancellation residuals. The probe supports the intrinsic part of this budget. It is not a universal forward-error bound; long or ill-conditioned programs can exceed it even with a faithful lowering. Record the observed maximum error/budget fraction on the full lowered contract cases during implementation and do not silently relax the bound.

Use the f32 interpreter as a secondary oracle for cases not expressible as a finite f64 error (e.g. f32 overflow on finite f64 values, empty max, `0/0`): require the same nonfinite class, including infinity sign but not NaN payload. If f64 is nonfinite and f32 is finite, compare f32 words. Check zero signs when both f32 and GPU return zeros. Also exercise exact f32 witnesses separately for reduction order and absence of FMA; a difference smaller than the f64 budget alone need not fail the sampled tolerance. For empty results, equality is of shape and zero elements.

## Contract, batching and reuse

**Use `defineTransformation` + `AnalysisManager.execute`.** The versioned `tensor.lower-cuda` pass has an input IR port for the current `TixIR` artifact, a function-name value port and a typed source-text output port. Its body invokes the emitter. Its `ensures` binds the input and emitted text to an async invariant. `definePass`/`applyPass` is for revision-to-revision graph edits: currently it has only one adapter/type parameter and opens a rewritable edit before entering the kernel. Generalizing it or wrapping source as a dummy one-node graph solely to use that runner would add infrastructure without enabling any check here. The source transformation uses the framework acceptance boundary without claiming graph writes or correspondence.

1. Generate bounded deterministic cases using the stage-1 shape/stream ideas: 1, 3, 4, 7 and a nonuniform assignment over symbols, plus feasible zero-extent assignments. Stream signed and positive asymmetric values, the half-ulp sequence, and signed zeros, with a fixed seed and stable parameter ordering. Include positive layernorm epsilon via the positive stream; keep nonfinite-producing cases for the secondary oracle. Filter from the selected Tix function's dimensions, access domain and work limit (stage-1 per-tensor 4,096 elements and one million work units per case), never by what the candidate does. Deduplicate shapes, retain case descriptors, inputs, and reference results, and decline if there are no eligible cases. Reuse stage-1 sampling code where it does not change `optimizeTix`'s case set or ordering.
2. Use `runDifferentialAsync` with `decide` to send **one batch per selected function / cache miss group**, not one SSH session per case. `decide` awaits one remote invocation for the outstanding case indices and returns its compared verdicts in that order. The invariant accepts only complete coverage of the chosen cases. Transport, compilation and incomplete results throw before returning a verdict array, so no success or semantic failure is memoized for an infrastructure failure. Include function, shape assignment, stream, seed, first mismatching coordinate and expected/actual values or words in evidence; keep it finite JSON (nonfinite values as strings).
3. With `baselineKey`, reuse case inputs and their two host references for current revision, selected function, Node/V8 and sampling version/seed. With `subjectKey`, reuse decided verdicts for those same cases plus exact source SHA-256, ABI, host and engine profile. Key directly on the configured host, architecture, nvcc path/flags and tool revision; no revisioned resource is needed for this fixed configuration. The transformation uses `cache: 'never'`, since cached source is not evidence. Reuse verdicts only in the current process under a stable host/toolchain/driver profile; record the observed CUDA/device metadata from the executable. There is no cross-process verdict cache or live re-attestation on hits. The caller must start a fresh process or change the profile if the remote environment changes. Concurrent cold checks may send independent batches; no in-flight deduplication is needed. Benchmark timings are always fresh, never memoized.

**Framework change ledger:** no `src/framework/` changes proposed. Scalar ports already let the manager gate emission; `decide`, `baselineKey` and `subjectKey` already supply async delegation and evidence reuse. The [local probe](../scripts/02-probe-contract.mjs) observed `accepted, accepted, rejected` for two identical emissions and a different supplied candidate. Only two async batches were dispatched; the second check replayed both case verdicts. No graph adapter or manager cache extension is needed.

## Remote tool change ledger

Only `tools/cuda-remote.mjs` changes. Keep the existing defaults, `--host`, `--arch`, `--timed`, program args and report fields. In particular, `--timed` remains for measurements only; other agents' untimed tool use does not take that lock.

| Proposed edit | Reason / simpler alternative |
| --- | --- |
| Add opt-in `--cache-main` for self-contained `main.cu`. Hash source independently of case data in that mode; otherwise key on the full staged directory as before. Include effective flags, architecture and nvcc path/version in the build key. | All-input caching suffices for identical reruns but would recompile the same shape-generic source for each changed batch or a benchmark. In the default mode additional files can be compile dependencies, so do not ignore them. |
| Separate the per-build binary from a unique per-invocation remote working directory. Under a per-build lock, compile to a temporary binary and publish by rename only after success. Keep the run directory through result fetch, then clean it independently of the binary. | The current shared `out/` and `prog` can race even for identical input directories, and source-only keys enable more sharing. Local serialization cannot synchronize other agents. The per-build lock protects compilation only; the separate timing lock keeps its current purpose. |

Run the existing design probe with the default mode after the change. Check that differing case data reuses a build only in the opt-in mode and that concurrent invocations retrieve their own results. No new SSH client or additional remote service.

## Tests and measurements after review

Build with `npm run build`. Run local tensor tests by file and keep GPU tests in `tests/tensor/cuda-gpu.test.mjs`, explicitly run/opted in for the remote machine. Local tests cover code generation and ABI (including identifier separation and shadowing, zero extents, signed zeros and exact byte views). GPU tests cover arithmetic witnesses, row-major rectangular and affine reads, multi-axis and nested reductions, empty sum/max, parameter return, all six corpus fixtures at small shapes, and programs with *actually changed* `inline` and `split-sum` revisions. Reject a structurally valid wrong source (e.g. tail drop on a positive stream) through the same `ensures` gate using `verifyTransformation`, not just a comparator test. Exercise cold, warm, concurrent and failed check paths and record their batch counts. Run affected tests only, not `npm test`.

Measure the baseline corpus sources, unoptimized, in a repeatable tensor benchmark. Bind these sizes and generate the same seeded nonuniform f32 inputs for Node and CUDA (positive `eps`, and bounded logits/weights). Record the generator and seed. Compare the outputs to the f32 interpreter at the measured sizes and record the largest deltas rather than assuming acceptance from the small cases. Use one warm-up and exactly five recorded GPU repeats in the same process using the same device buffers, and one recorded interpreter run per program. Report GPU median and range and the observed Node wall time. Node timing is wall time around `runTix` with parsing and input generation outside. GPU timing is the CUDA-event span, excluding allocations, setup, transfers, compilation, and SSH. Keep `--timed` runs short and separate from correctness checks; note any timing spread and interference, since the existing lock excludes other timed clients only. Put counts, milliseconds and the CPU/GPU ratio beside the versions, flags and workload inputs in the report.

| Program | Shape bindings at measurement |
| --- | --- |
| matmul | M = K = N = 512 |
| softmax | N = 4096, C = 1024 |
| layernorm | N = 4096, D = 1024 |
| attention | Q = K = 1024, D = V = 64 |
| mlp | N = 1024, D = 256, H = 1024, O = 256 |
| conv2d | N = 8, C = 16, H = W = 64, O = 32; fixed 3 × 3 kernel |

Implement emitter and ABI first, then remote isolation/cache, then the invariant and falsification tests, then measurements. No backend code or corpus measurement is part of this design checkpoint.

## Later

Fusion, tiling/shared memory, tensor cores, other thread mappings, streaming attention and autotuning are out of scope.

## References

- Stage 1: [design](../../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-semantics-and-checked-tensor-rewrites.md) and [final report](../../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/02-report.md).
- [Implementation diary](../reference/01-implementation-diary.md).
