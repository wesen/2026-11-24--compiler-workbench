---
Title: Lowering Tix statements to CUDA with a batched GPU meaning check
Ticket: IRWB-022-G
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
      Note: Existing delegate and evidence reuse; proposed batch-only mode
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Same-kind edit boundary
    - Path: repo://src/tensor/contract.ts
      Note: Origin sampler and f64 budget
    - Path: repo://src/tensor/model.ts
      Note: Resolved expression and extent vocabulary
    - Path: repo://tools/cuda-remote.mjs
      Note: Target identity and per-run working directories
ExternalSources: []
Summary: Proposed direct emission, measured GB10 tolerance, asynchronous pass contract and measurement protocol.
LastUpdated: 2026-11-26T15:15:00-05:00
WhatFor: Review before implementing stage 2.
WhenToUse: When reviewing the lowering, its evidence boundary, or the planned framework and runner changes.
---

# Lowering Tix statements to CUDA with a batched GPU meaning check

**Revised after review.** Emit CUDA C directly from the selected *current* function. Treat the complete translation unit as the output port of a checked transformation, not as another editable kernel IR. Use one remote execution for the missing cases of a check. Compare the returned tensors to the original function evaluated in f64 on the same f32 input bytes. This is a sampled tolerance contract, not a claim of bitwise equivalence. On the specified GPU, `expf(-7.998046875f)` already differs by one bit from the f32 meaning.

The starting point is [stage 1's design](../../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-semantics-and-checked-tensor-rewrites.md) and [report](../../IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/02-report.md). In particular, `TixProgram.origin` and `.current` need not have the same reduction tree.

## What is lowered

Support the stage-1 checked module (including modules with multiple functions), a named function in it and valid concrete calls: f32 row-major buffers in parameter order by name, finite input values, nonnegative integral extents, consistent direct bindings of shape symbols, matching ranks, affine dimensions and lengths, in-bounds addresses. Empty dimensions are valid. Integer intermediate values, byte sizes and launches must be representable on the host and device, and tensors must fit memory. Target this ticket's GB10/CUDA 13.0 configuration; a host override selects a compatible remote. The contract's *sample budget* below is not a limit on execution. No grammar, optimizer or interpreter change is needed.

`cudaSource(program, fn)` returns the deterministic shape-polymorphic `main.cu` candidate, not a verdict. The same emitter supplies the transformation body. `runTixCuda(program, fn, inputs, {host}?)` executes that unit on the supplied call, returns the result buffer/shape and CUDA-event milliseconds. It is a runner, not evidence for other inputs. `checkLowering(program, fn)` invokes the checked pass and returns `{accepted, relation:'tolerance', reason?}`. Only that path claims acceptance. In particular, compiling successfully or getting a timing is not passing the contract. Checking uses the same batch runner on the **actual output port text**, not a call back into `cudaSource` on the baseline. One may inspect or run a candidate even if there is no eligible small check case. Nothing replaces the program's current or origin revision.

### Mapping from `Fn` to a unit

Generate ordinal-based C identifiers for parameters, definitions, axes, shapes and temporaries; never use source names, even for the host filenames. Tensor and index namespaces differ; reduction lookup uses resolved binder IDs, not spellings. Reserve one kernel per `Statement` (including unused definitions), global storage for its result and one ordered launch per nonempty result on one stream. A function returning a parameter needs no extra copy kernel. There is no launch for a zero-element output, and no zero-byte `cudaMalloc`/`cudaMemcpy` is necessary.

1. Bind symbols from **all** plain input axes, then specialize every param and statement dimension from its `Affine`. Check ranks, consistency, nonnegative shapes and lengths before launching. Use signed wide integers for affine arithmetic and indices; preflight concrete shapes, strides and byte/count products (checked intermediates). Lower the checked IR on its in-bounds address domain. No second symbolic bounds prover; the origin evaluator checks each visited address when admitting a contract sample. Use integer row-major strides; a shape used as a scalar instead converts to float.
2. Launch `ceil(numel/128)` blocks of 128 threads (fixed here, no tuning). A wide linear thread id past the end returns. Decode it into free coordinates by quotient and remainder, last dimension fastest. Matmul, for instance, decodes `i=t/N,j=t%N`, folds `a[i*K+k]*b[k*N+j]` at increasing `k` into a private float and writes `out[t]` once. No two threads update the same accumulator. Materialize successive definitions in source order on that stream; create buffers before the timed region.
3. Emit scalar trees in postorder into local floats, not algebraically simplified C expressions. A load uses the resolved tensor and one affine form per coordinate. An inlined load can transpose or compose those forms; no pass-name special case is allowed. For a reduce node allocate its own float accumulator (`+0.0f` or `-∞`), emit nested increasing `for` loops, first axis outermost; evaluate the body **inside** the innermost loop, round the update there. An empty loop returns its initializer. Nested or shadowed reductions have distinct lexical temporaries.
4. A `dim` bound is the evaluated dimension; `blocks` uses the stored ceil/floor division by `width` (ceil via quotient + nonzero remainder for nonnegative extents); `tail` is `min(width, dim-width*boundBlock)` in integer arithmetic. In particular, for `split-sum` start a new inner sum for **each** block, then add that result to the outer sum. A single running accumulator across both loops would not lower the current revision. Keep the stage-1 `width` constant as the single source of truth.

| Scalar | Proposed instruction/implementation on this target |
| --- | --- |
| Input/load/store; literal; shape | Preserve f32 storage bits; emit the word for `Math.fround(Number(text))` via bitcast (no second decimal parser); integer-to-float RN for scalar shapes. |
| `+ - * /`, negation | `__fadd_rn`, `__fsub_rn`, `__fmul_rn`, `__fdiv_rn`; unary float `-`. Fold sum uses the same add. The explicit rounding sites prevent multiply/add contraction with `-O3`. |
| `exp log sqrt tanh` | Standard `expf`, `logf`, `__fsqrt_rn`, `tanhf`. No fast-math flag or approximate `__expf`. |
| `max min`, max fold | Match JS: NaN propagates, including in a fold. For zeros select +0 for max if either sign is +, −0 for min if either sign is −; other cases compare normally. CUDA `fmaxf`/`fminf` alone ignore a lone NaN. |

Use the tool's existing `nvcc -O3 -arch=sm_121` profile (in particular no fast math or flush-to-zero option). Outside floating computation, do **not** approximate indices with floats. The emitter is the only new lowering representation: `Fn` already has order, shapes, dependencies, binder IDs and fold bounds. A second graph artifact would copy them into a representation with no editor or transformation consuming it in this stage. Embedding hard-coded case values or sizes in C would instead force a different candidate for the contract and for the caller.

### One runtime ABI for one case or many

In a fresh local temp directory write the unit and `in.bin`. Specify a versioned little-endian format in the generated main and in the TS codec. Header: magic, version, case count; per case: ordinal case ID, then in declared parameter order rank, extents, f32 words in row-major order (rank/count/ID u32, extents u64, checked byte length implicit in shape). Output `out/result.bin` carries its own magic/version/count and, per case, the echoed ID, rank/extents, elapsed milliseconds (f64), and result words. No user-controlled path names. Select parameter/return shapes from the unit's interface, not from a guessed manifest on the Node side. Check whole records, exact lengths/count/IDs, no missing or stale file, shape and timing before using results. A text/JSON array of numbers would greatly inflate corpus inputs and lose zero signs and nonfinite results. Binary transport of `Float32Array` **slices** must respect `byteOffset` and `byteLength`.

The generated main handles input and H→D copy, launch sequence, events and D→H copy per case; check every CUDA/IO call and launch, synchronize the stop event before consuming its result, release per-case resources. Pass read pointers plus output pointer and the needed integer shape metadata to each kernel. In both modes call `cudaFuncGetAttributes` on every kernel before recording events: under lazy loading the first launch otherwise includes module startup. `gpuMs` is the elapsed time between events on that stream immediately surrounding the sequence, no file IO, allocations/frees or transfers between the events; zero for no launches. This measures a sequence (including any inter-kernel gaps), not the whole process or sum of SSH timings. Resolve the tool relative to the installed build in this repo; spawn `process.execPath` with an argv array and **await** completion. The tool may use synchronous children in its own process; the public call does not block Node waiting for SSH. Check both subprocess and tool result; remove local temp files in `finally`. Honor `--host` or the tool default/environment. Correctness runs never take `--timed`.

## Which numerical relation?

The probe was run through the **unmodified** tool, untimed, on NVIDIA GB10, sm_121, nvcc 13.0.88, runtime/driver API 13000, driver 580.178.04. The [arithmetic kernel](../scripts/01-math-probe/main.cu) emits six floats for each `x=(i-8192)/1024`, `i=0..16384`. All inputs are exactly representable. The [Node 24 reader](../scripts/02-read-probe.mjs) independently calculates each expression (1) rounding at stage-1 sites, and (2) without those roundings. `softmax7` returns the last of seven normalized exponentials; `dot7` has signed weights and cancellation. These two expressions test a chain with an ordered sum, not just intrinsics in isolation.

| Output | Different f32 words / 16,385 | Max absolute error vs f64 | Max fraction of proposed error budget |
| --- | ---: | ---: | ---: |
| `exp(x)` | 5,007 | 3.5041e-4 | .00657 |
| `log(9+x)` | 902 | 1.416e-7 | .00353 |
| `sqrt(9+x)` | 0 | 2.383e-7 | .00290 |
| `tanh(x)` | 1,264 | 7.704e-8 | .00601 |
| `softmax7` | 6,019 | 3.857e-8 | .00678 |
| `dot7` | 0 | 9.483e-8 | .02107 |

`expf(-7.998046875f)` returned word `39b0390e`; `Math.fround(Math.exp(x))` returned `39b0390f`. The [platform probe](../scripts/03-platform-probe/main.cu) also distinguishes separate RN multiply + add (`00000000`) from FMA (`a8800000`) and finds gradual underflow (`00000002` for twice the least subnormal). CUDA events work on this stream. See the [diary](../reference/01-implementation-diary.md) for reproduction. These are probe results, **not** corpus timings or evidence about an as-yet unwritten emitter.

**Decision:** for each sampled returned tensor require equal shape/length and, for *each* finite f64 reference element `r`, finite GPU `g` with `abs(g-r) <= 2e-6 + 2e-5*abs(r)`. Use the original function in f64 on the very same f32 inputs, **not** the GPU or current f32 as oracle. This keeps the original budget through an accepted `split-sum`, rather than granting two successive error allowances. The absolute floor accommodates cancellation; the relative term scales for e.g. `exp(8)`. This is stage 1's existing budget: the largest measured utilization in the probe is 2.11%, leaving room for short composed computations. Record the worst utilization again on the actual six lowered functions after review. The budget is falsifiable, not a universal error bound on arbitrary conditioning, depths or benchmark sizes. A correct ordered-f32 implementation can exceed it; reject/report that case, do not increase the budget until it passes.

Use stage 1's finite-reference case selection for the numerical budget; never skip a nonfinite candidate on such a case. Test empty max (−∞), NaN propagation from finite inputs and signed-zero rules **separately**, by running GPU edge fixtures and checking classification or bit words. A tolerance test alone could miss a changed zero sign or fold order. Trying to port Node's transcendental library to guarantee exact words (including exceptional values) adds a second math implementation, with no such guarantee from CUDA; the measured mismatch rules out exact for the selected operations.

## Pass, evidence and replay

Implement a versioned `defineTransformation` with inputs `{current:TixIR, origin:TixIR, fn:Name, target:TargetIdentity}` and scalar output `{unit:CudaSourceText}` (`defineType<string>`, not a kernel adapter). Its body emits from `current`; its `ensures` binds the unit, origin, function and target to a differential invariant. `AnalysisManager.execute` awaits verification before acceptance. Use `cache:'never'` on the transformation; replay checked case verdicts, not a promise that an old unit is still acceptable. For mutant tests, `verifyTransformation` can submit a different actual `unit` to that same postcondition. Each definition/version is stable, not a closure secretly carrying changing programs/targets. `applyNativePassSync` cannot await the GPU, and `applyPass<S>` diffs within one adapter and opens an edit. Neither models `Module → string`. Named, differently typed transformation ports already do; no fake graph edit, correspondence, preservation assertion or GPU-specific scheduler is needed.

1. Factor the stage-1 shape/input sampler without changing `meaningGate` behavior. For this selected name, generate from the **origin alone** with its own seeded stream (20), all symbols 1, 3, 4, 7 then mixed 3/5/7 in sorted-name order. Use asymmetric signed, positive and half-ulp streams on f32 storage. Deduplicate concrete shapes, validate all extents and use the origin evaluator's sampling limits (4,096 elements/tensor, one million visits/iterations, skip out-of-domain addresses). Keep only whole finite reference returns. Include legal zero-extent examples in edge tests; require a comparable case with at least one output element unless the return has a statically zero dimension (then require a legal case with exactly the expected empty shape). Report no evidence rather than checking a different function. Emit seed, shape bindings, stream, ordinal IDs and reference in the stable case list (typed buffers stay out of artifact/evidence JSON).
2. The async `decide(inputs,cases,todo)` packs just those indices in order into **one** run of the candidate on the remote machine. No loop of 15 SSH/compile calls. No CPU fallback. Read the returned IDs; map one result to each requested index, compare locally and return ordered `Decided` values. The framework tallies these with replayed verdicts in original case order. Record the first differing coordinate, shape/stream/seed, expected, observed and bound in the mismatch reason; keep identifiers/hashes and counts, not input/output buffers, in the execution evidence. The public reason should surface the counterexample, not only the number of disagreements. Transport/compile/CUDA failure, absent/truncated output, missing case or unavailable identity must not become agreement/inconclusive. Fail the batch before memoizing any of it; return nonacceptance with the failing stage. `runTixCuda` itself rejects a failed execution. A failed infrastructure attempt must be retryable.
3. Use the existing bounded in-process differential memo (`prepare`, `memoKeys`, `tally`). Baseline key: digest of origin revision, selected name and sampler/reference policy version; spec id/version/count/seed also namespace it. Cache the f64 references *in the generated cases*; delegated checks do not compute local `reuse.outcomes`. Subject key: digest of the exact emitted unit, configured target (host, compiler path, arch/flags), binary protocol/runner and comparison versions. The case index is part of the framework key. Do not key by function name or pass name alone. No remote identity query on replay: assume the configured host's hardware and software installation are stable within the process lifetime; restart after updates. Changing the subject, target or contract must miss; changing an unrelated current function need not miss if the unit and baseline key are unchanged. On a warm hit skip both remote execution and output transfer; no disk cache of verdicts/timings. An evicted key may rerun. The tool's separate compile cache saves compilation, not verification.

### Framework change ledger (proposed; none made yet)

| File | Finding, proposed delta and test |
| --- | --- |
| `src/framework/contracts/differential.ts` | `decide` **already** supports an async batch and per-case replay. But the spec still requires synchronous `run` and `compare`, and `undefined` delegation silently selects that local path. A remote-only engine has no truthful sync implementation. Add a batch-only spec variant for `differential`/the async runner: shared case/key/description fields, mandatory `decide → Promise<readonly Decided[]>`, no local `run/compare`. Distinguish it by absence of `run`; keep the existing sync and optional-delegation variant untouched. Guard sync execution/extraction for local workers and no-delegate fallback on a batch-only spec with an explicit unsupported-mode error. Share existing async memo/order/tally logic; do not turn `run` into a per-case promise or duplicate a verdict cache. Tests: one batch on cold, pure replay on warm, changed target/source misses, rejection on missing/wrong length or thrown batch, no sync fallback; retry after failed batch. Existing Typed worker and tensor synchronous checks still build/run unchanged. Document the variant in `src/framework/contracts/README.md`. |

A local [probe with the current API](../scripts/04-contract-probe.mjs) verified a `TixIR → string` transformation twice and rejected a changed string. Stats: 4 delegated, 2 replayed, zero local runs. It needed dummy throwing `run`/`compare` methods. That is the small interface mismatch to fix. A tensor-local map of Promises or an entirely new async analysis manager is unnecessary. No other proposed framework changes; if implementation changes the ledger, record the concrete reason, tests and commit here and in the diary.

### Remote tool change ledger (proposed; probe used stock tool)

| Change to `tools/cuda-remote.mjs` | Reason and acceptance check |
| --- | --- |
| Bind the binary cache key to compiler path, `nvcc --version`, recipe flags and framed file names/content digests, inside the remote compile script. Keep hashing **all** staged inputs. No describe command or stamp in the run JSON. | The installed compiler can change under a persistent binary cache. Identical inputs/build hit; changed build misses. Program arguments do not affect compilation. |
| Separate a private per-invocation remote working directory (including `out/`) from the cached executable. Serialize population of a missing binary with a **per-content** compile lock, install only a successful build, run in the private cwd, fetch its `out/`, clean up. Keep `--timed`'s existing GPU lock around execution only. | Today `rm -rf out` and subsequent tar fetch refer to a shared `~/irwb-cuda/<hash>/out` even if two callers have different program args. Identical concurrent checks must not read each other's output. Test concurrent normal and benchmark executions on byte-identical files: only benchmark stdout may contain the three measured intervals. A global GPU lock for every check both violates the sharing rule and doesn't protect a later fetch. |

Keep existing invocation, environment knobs and JSON fields compatible. Do not add a serial SSH call per tensor, persistent service, independent SSH client in the tensor module, or a source-only compilation cache that assumes other input files cannot affect a build. The design assumes the tool's trusted remote account and stage-owned job directories, not an untrusted CUDA execution service.

## Validation and measurements after review

1. Build with `npm run build`. Offline: run `node --test tests/tensor/{language,passes,corpus,cuda}.test.mjs` (add `cuda.test.mjs`); test determinism, kernel counts/order before and after real optimizer changes, scalar name collisions, adapter/port selection, affine/tail emission, complete/framed binary IO including subarray and zero lengths, target keys, mock malformed/reordered/failing replies. Mock runner tests are not GPU evidence. Run the changed framework tests and differential consumers, including `tests/framework/{ext-e5,native-pass-sync}.test.mjs`, and targeted existing Typed meaning/execution tests. No `npm test`.
2. Keep all network-dependent tests in `tests/tensor/cuda-gpu.test.mjs` (explicit file invocation). Execute all six corpus functions small on GB10 and apply the real postcondition. Compare to independent small expected outputs as well as the f64 oracle. Exercise direct parameter return, empty output, empty sum/max, NaNs, zero signs, max/min, FMA witness, nested shadowing, different axis lengths and 3-axis convolution, an inline transpose, `split-sum` K=7 **actual changed revision** with exact expected blocked-vs-sequential bits. Include an exp/log/tanh test across the probe mismatch region. Submit a valid compilable wrong unit (e.g. use floor block count, dropping K=7's last block on positive inputs); require rejection and replayable coordinate. Verify cold/warm delegated counts and changed-unit invalidation. Request escalation for sandbox child-process EPERM. Keep correctness invocations untimed.
3. Once checked, measure **original** corpus programs (no optimizer passes) at exactly the following shapes. Keep a reproducible benchmark driver under this ticket's `scripts/`, not in the default test suite. Use deterministic f32 input bytes (seed recorded, bounded nonuniform values, positive `eps` for layernorm), same bytes for host and device. Record input digest and output shape, and sanity-check returned values against the local result. Separately record maximum finite error vs f64/budget on the small contract suites; do not report that as a bound on large workloads.

| Function | Symbol bindings | Kernels per call |
| --- | --- | ---: |
| matmul | M=K=N=512 | 1 |
| softmax | N=4096, C=1024 | 4 |
| layernorm | N=4096, D=1024 | 4 |
| attention | Q=K=1024, D=V=64 | 6 |
| mlp | N=1024, D=256, H=1024, O=256 | 3 |
| conv2d | N=8, C=16, H=W=64, O=32; fixed 3×3 | 1 |

One short `--timed` job per program. Every `cudaSource` main accepts a runtime `--benchmark` switch (`node tools/cuda-remote.mjs DIR --timed -- --benchmark`); normal runs omit it. It is not a compiler flag or part of the compile key. Only benchmark mode prints the three individual intervals to stdout and puts their median in the ordinary result record. In benchmark mode only, copy inputs once, launch a warm-up sequence then three measured sequences using the same allocated buffers, report individual CUDA-event intervals and median (if long, use one measured sequence and say so). Allocations, H↔D, compile, tool `runMs` and SSH do not belong in `gpuMs`. On this machine time one complete stage-1 `runTix(..., {precision:'f32'})` at the **full shape** using `performance.now()`, excluding fixture parsing/compilation, input generation, IO and GPU calls; warm with a small legal case and report the repetition count. This includes the interpreter's own copies/materialization; do not replace it with BLAS, an estimated MAC rate or extrapolated timing. Run local workloads sequentially; some interpret hundreds of millions of scalar products. Publish a six-row results table with GPU ms and local interpreter ms, revision/host/Node version, flags/device identity and measurement boundaries. No timing claims in this design.

**Review gate:** agree on the cross-port pass boundary, measured tolerance/evidence keys and ledger before implementation. Later optimizations listed in the brief are out of scope; this stage measures the straightforward mapping as the baseline.

## As built

`de9177a` implements the batch-only spec and guards in `src/framework/contracts/differential.ts`, with usage in the contracts README and retry/replay/worker tests in `tests/framework/batch-differential.test.mjs`. No other framework layer changed. `abcbdfd` implements the GPU pass and both tool ledger items. The tool frames the hash with per-file digests, keeps the binary under a build-keyed lock, forces private staging permissions, delimits SSH/tar operands, and reports fetch failures. The normal-run and benchmark mains are the same text; only runtime arguments differ. No `--describe`, hardware query or emitted target stamp.

See the [measurement report](../reference/02-cuda-lowering-results-and-timing-protocol.md) for observed results and reproduction.
