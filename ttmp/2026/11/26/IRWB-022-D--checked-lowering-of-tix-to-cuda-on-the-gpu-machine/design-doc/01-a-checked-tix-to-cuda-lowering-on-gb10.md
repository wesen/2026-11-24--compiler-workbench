---
Title: A checked Tix to CUDA lowering on GB10
Ticket: IRWB-022-D
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
      Note: Async batch delegation and keyed verdict replay
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Same-IR runner boundary
    - Path: repo://src/tensor/contract.ts
      Note: Origin-derived f64 sampling and budget
    - Path: repo://tools/cuda-remote.mjs
      Note: Remote compilation, shared paths and timing lock
ExternalSources: []
Summary: Direct-emission pass, remote batch meaning contract, GB10 numerical probe and measurement plan.
LastUpdated: 2026-11-26T15:14:00-05:00
WhatFor: ""
WhenToUse: ""
---

# A checked Tix to CUDA lowering on GB10

**For review; no backend implemented.** Emit the current Tix function directly as a CUDA translation unit. A checked application of the pass accepts those source bytes only after their *compiled GPU result* agrees with the original function in f64 on a batch of small calls. Use the stage-1 absolute-plus-relative error budget. On the GB10, `expf(-3.986328125f)` already differs from `Math.fround(Math.exp(-3.986328125))`; exact f32 words would reject this backend.

## Artifact boundary and public calls

The domain is a function in a checked stage-1 `TixProgram` (including revisions accepted by `inline` and `split-sum`). Calls supply precisely its finite row-major f32 inputs, with ranks and lengths matching their shapes. Bare parameter dimensions bind consistent nonnegative integer shape values; all affine extents and executed reads are valid. Counts, intermediate integer arithmetic and allocations must fit the stage-1 host and target device. Zero is a valid extent. The remote profile here is the specified Linux GB10/CUDA 13 machine or the same profile selected by `host`.

`program.current.value` already has the kernel boundaries, output domains, affine accesses, lexical binder IDs and ordered reductions. A second kernel IR would copy these facts without adding an independently checked rewrite. Keep the lowering result as a *value port* (validated nonempty source string) of a versioned `defineTransformation`, not a second v6 graph. `definePass<S>` and `applyNativePassSync` produce another revision of **S** using the input adapter. Here there are no Tix entities edited or transferred. Teaching that runner to diff CUDA text against tensor definitions would give its write and preservation checks no useful interpretation.

- `cudaSource(program,fn)` is pure, deterministic and synchronous: only `current` and the selected function determine the standalone `main.cu`. This returns a candidate, not evidence of acceptance.
- `runTixCuda(program,fn,inputs,{host}?)` generates that same source and runs a one-case batch; returns only `{shape,data:Float32Array,gpuMs}`. It executes the caller's call even when no contract case has that shape. Neither inspection nor ordinary execution triggers a hidden second run for verification.
- `checkLowering(program,fn)` applies the checked pass: generate source from `current`; bind `origin`, `current`, function and execution profile as transformation inputs; pass the actual string as output to `AnalysisManager.verifyTransformation`. An `ensures` differential invariant decides it asynchronously. Return `{accepted,relation:'tolerance',reason?}`; rejection includes the first useful case/coordinate or execution diagnostic. No local interpreter stands in for the candidate. A test seam takes the candidate string at this boundary so a mutant cannot be accidentally regenerated into a correct program. No stage-1 signature, gate or optimizer behavior changes.

## Code generation

Emit one `__global__` function per statement (even if its definition is dead), launched in definition order on one stream. Each live thread owns exactly one row-major output offset `t = (int64_t)blockIdx.x * blockDim.x + threadIdx.x`. Use 128 threads per block and a ceiling grid; guard `t < count` before decomposing `t` by remainder/division from the last free axis back to the first. Skip zero-count launches. Pass only the needed shapes, read pointers and output pointer, all bound outside the scalar tree. Calculate each load as a row-major multiply/add of its tensor extents and signed affine indices, using signed 64-bit integer arithmetic, not float. Give tensors, symbols, axes and scalar temporaries disjoint generated ordinal names; never paste a user name, literal spelling or a generated `i0/block` ID into C as an identifier.

Emit each scalar subtree to a fresh `float` local. A reduction emits an accumulator and a sequential loop per axis, first listed outermost; evaluate the body **inside** the innermost loop. Use `+0.0f` for sum and `-INFINITY` for max. Each visit updates the accumulator once, and a nested reduction initializes its own accumulator on each entry. Resolve by binder ID (including shadowing), not spelling. `dim` uses its affine bound; for split-sum `blocks` uses integer ceil or floor of `dim/4` as tagged, `tail` uses `min(4, dim - 4*outerBlock)`; keep the two folds, including both rounding sites. Inlined/offset reads need no special intrinsic. Empty folds return the identity; if the result is a parameter, no copy kernel or artificial statement is needed.

| Stage-1 scalar | CUDA implementation (nvcc `-O3 -arch=sm_121`, no fast math) |
|---|---|
| literal / shape value / load | Emit literal bits from host `fround(Number(text))` via `__uint_as_float`; round integer shape with RN integer-to-float conversion; load binary32 directly. |
| `+ - * /`, sum step | `__fadd_rn`, `__fsub_rn`, `__fmul_rn`, `__fdiv_rn`; explicit rounding prevents multiply-add contraction without changing flags for other users. No reassociation or parallel fold. |
| unary minus | Flip the f32 sign (preserve zero sign). |
| exp, log, sqrt, tanh | Standard device `expf`, `logf`, `sqrtf`, `tanhf`. Not `__expf`, not a host callback. |
| binary min/max and max step | Propagate NaN if either operand is NaN; for a zero tie choose negative sign for min if either is negative, positive sign for max unless both negative; otherwise ordinary comparison. Plain `fmaxf` can hide a NaN. |

This keeps arithmetic f32; tolerance is not permission to use a tree reduction or FMA. Implementing V8 math functions (and their special cases) on the device to chase exact bits would change the experiment. Simply using ordinary C `a*b+c` also risks erasing a rounding site.

## One executable, one or many calls

Use one binary protocol for a single API call, a contract batch and a timing run: `input.bin` with magic/version, case count, and for each case its ordinal, then tensor records in parameter declaration order (rank, extents, raw f32 elements). Use little-endian fixed widths (u32 counts/ranks/ordinals, u64 extents), no decimal floats. The generated `main` binds the symbols from parameter shapes, checks ranks, lengths, repeated bindings, computes affine output shapes and counts before launch. No generator specialized to example values. Return `out/result.bin` with version/count, per-case ordinal, rank/extents, words and elapsed milliseconds (f32 from events); identify the execution profile in stdout. Check framing, multiplication/length limits, completeness, exact expected shape/word count and finite nonnegative time on receipt. A shape with zero elements still has a record. This avoids enormous JSON arrays and preserves nonfinite outputs and negative zero. The exact field order/magic will be documented alongside the codec and emitted `main`.

Allocate inputs and intermediates and copy inputs before the event window. Execute the chain with launch checks and CUDA event start/stop on that stream, synchronize the stop, then read elapsed time and copy back only the return tensor. Free case storage before the next case. Use time zero if there are no launched kernels. Separate optional untimed warm-up from the measured chain; initialize the context and load kernels before measuring. No allocations, transfers or host synchronizations between measured kernels. Use Node asynchronous child-process invocation of `process.execPath` on the repository's `tools/cuda-remote.mjs` with argument array, a fresh local temp directory, and `finally` cleanup. The tool owns SSH, nvcc and `--timed`; tensor code does not issue remote shell commands. Distinguish compile/run/transport or protocol failure from a numerical counterexample. None authorizes a pass; infrastructure failures must be retryable.

## Which relation, and what established it?

For each selected call require the same shape and all finite reference elements `r` to satisfy

```
isfinite(gpu) && abs(gpu - r) <= 2e-6 + 2e-5 * abs(r)
```

Here `r = evaluate(originFn, identicalF32Inputs, 'f64')`, not the result of doing the sum in device double and not an f32 run of the optimized program. This is an end-to-end budget: a split that already spent part of it does not get another allowance at lowering. Keep stage 1's tolerance sampling domain (reference *return* entirely finite); no cases chosen by looking at GPU output. Check nonfinite behavior separately with explicit public execution tests. No accepted verdict for a function with no comparable case. Zero-sized results can check shape and framing but must not replace the nonempty cases when those exist.

**Experiment, not a universal bound.** [Device kernel](../scripts/01-probe.cu) and [Node comparison](../scripts/02-probe.mjs) ran through the unmodified tool, untimed, on NVIDIA GB10 sm_121, nvcc 13.0.88, driver API 13000, Node 24.18.0. For `i=0..8191`, `x=(i-4096)/1024`, `p=(i+1)/1024`; all inputs are exactly representable. Compare individual results to f32 JS at every step and to the f64 formula. Last column is the largest measured absolute f64 error divided by the proposed per-element allowance (1 would use the whole budget).

| Expression | f32 differences / 8192 | Max fraction |
|---|---:|---:|
| `exp(x)` | 2468 | 0.006160 |
| `log(p)` | 626 | 0.003535 |
| `sqrt(p)` | 0 | 0.002787 |
| `tanh(x)` | 1262 | 0.006001 |
| seven-step sum of `exp(x+k/16)` | 1763 | 0.007094 |
| `(1+p*2^-23)*(1-p*2^-23)-1`, explicit rounding | 0 | 0.029803 |

First exp difference: GPU `0.01856776885688305`, JS f32 `0.0185677669942379`. Reusing the stage-1 budget is supported for these samples, including cancellation; neither this sweep nor a compiler option proves that all valid inputs agree. In particular long sums, ill-conditioned divisions and f32 overflow can exceed it. Report the worst observed error/budget fraction for the six contract batches at implementation time; if a case fails, retain the witness, do not silently expand the bound. Check performance on the requested larger inputs independently of the sampled contract.

## How a remote decision becomes evidence

1. Use deterministic seed 20 and origin-derived calls for the named function only. Factor stage-1 case construction/comparison into tensor-local helpers where equivalent. Keep shapes 1, 3, 4, 7 and a mixed 3/5/7 assignment, and the signed, positive and seven-element half-ulp streams; add single-axis-zero shapes for empty loops where legal, deduplicating fixed dimensions. Bound sample shapes (4096 elements per tensor) and metered origin work (one million visits); omit only source-ineligible calls, as in stage 1. Precompute the f64 observation with the case. An empty case list must fail even if execution has nothing to do.
2. Use the existing async `differential({cases,decide,...})` invariant with heterogeneous ports. The sync `run` path for the GPU is unavailable (throw on accidental use). `decide(ports,cases,todo)` encodes only missing indices, invokes the tool **once per function/batch**, compares decoded records to the corresponding references, returns one `Decided` per `todo` index in its order. No one-process-per-input loop, no case-count inference from returned records. A wrong coordinate returns `disagree` with shape, stream, seed, expected, actual, allowed. An incomplete run throws *before returning any verdicts*, not `inconclusive` (the framework accepts some mixtures of agree and inconclusive). The framework tallies and records `method:'sampled'` under the transformation's `ensures`; do not publish inferred whole-program equivalence.
3. Keep case/reference generation inside `cases`, so `baselineKey` reuse actually saves that work. Key by origin revision, function and suite version (spec ID/version, seed/count included by the framework). Use a fixed positive nominal count/case bound; evidence total is the actual eligible count. `subjectKey` includes SHA-256 of the **actual** source bytes, current revision, codec and runner versions, profile identity (host, GPU/arch, compiler build/path/flags, driver) and relation version. Use unambiguous tuple encodings. No reuse across unverified engine profiles. For the fixed machine, identify a profile once per verification session via a tiny tool-run identity probe; verify cold batch metadata matches it. Session reuse assumes stable machine/toolchain until the session ends. Use process-local reuse only, no on-disk verdict store. `cache:'never'` for transformation execution; replay only exact-keyed deterministic numerical verdicts, never event times. A second identical check should delegate zero cases. Changed source, baseline, engine, or budget cannot replay prior success. The compile cache is an independent optimization; a warm executable does not certify any outputs.

### Framework and tool change ledger (proposal)

| Location | Decision, why, and falsifier |
|---|---|
| `src/framework/contracts/` | **No change.** `DifferentialSpec.decide` already batches pending indices asynchronously; `baselineKey`/`subjectKey` cover reproducible inputs and decided verdicts, and `verifyTransformation` supports an IR input and scalar output. A local probe at `1880fc4` delegated 3 mock cases, replayed all 3 for identical text, rejected changed text with 3 fresh disagreements. Test this with an injected counting batch runner, real tensor cases, changed candidate, malformed/failed batch and retry. A new async per-case runner or independent tensor evidence cache would duplicate machinery or incur repeated SSH. |
| `src/framework/{core,ir,passes,dataflow,strategy}/` | **No change.** Use validated `TixIR`, typed source port and a cross-type transformation rather than extending same-kind graph edits. No scheduling decision or flow analysis to abstract. Stage 1 keeps its synchronous path. |
| `tools/cuda-remote.mjs` | **Isolate each remote invocation's writable files.** Currently identical hashes share `prog` and `out/`; `rm -rf out` can race the previous invocation's fetch, and `--timed` locks only the program, not publication of outputs. Stage input in a private run directory, compile under a per-build-key file lock and publish the finished executable atomically, run it with the private directory as cwd, fetch only that directory's `out/`, then clean up. Keep the existing CLI, stdout JSON and measurement lock. Cache key should include the compiler path/build (`nvcc --version`), flags/arch and length-framed file names and contents: changing toolchain must not return an older executable. Keep hashing all input files; different data can recompile but batching amortizes that. No general build system or arbitrary flag plumbing. Test concurrent identical directories with different program arguments producing distinguishable bytes, plus a repeat compile hit. Simply generating local temp directories does not isolate the remote pathname. |

As built, record every deviation/file/reason and its test here. At review time the only committed changes should be ticket materials. The numerical probe used neither a new tool flag nor a framework change.

## Acceptance and measurements after review

- Offline after `npm run build`: existing `tests/tensor/{corpus,language,passes}.test.mjs`; add source/codec/contract tests for function selection, kernel count, unique identifiers, argument ordering, length/framing, zero-size, async batching/replay/transport failure. Pass explicit file names to Node 24. Keep a counting fake transport for memoization tests only, with distinct cache namespace from the real GPU.
- In a separate `tests/tensor/cuda-gpu.test.mjs` run untimed small calls: six corpus functions vs independent small oracles and the actual contract; original, changed inline with transposed indices, changed split with tail; nested and shadowed reductions, ordered multi-axis sum, min/max NaN/signed zero, empty result/sum/max, direct parameter return, each intrinsic. Check the seven-term witness *in words* before/after split and a no-FMA witness: tolerance alone does not test execution order. Compile an intentionally wrong candidate (e.g. matmul reading row 0 on every row or omitted reduction tail) through the **same pass gate**, require rejection with a reproducible coordinate. Verify an infrastructure error doesn't become reusable evidence. No GPU lock for correctness or probing.
- For timings use unoptimized `compileTix` and precisely the sizes below, seeded nonuniform finite f32 data, same bytes for local and remote. Record seed/distribution, machine/Node, compiler/device/profile, revision and concrete output shape. One short `--timed` run per program; e.g. one warm chain and three event samples, report median and samples in ms, reducing repetitions if needed to keep the lock short. This is kernel-chain time (including launch gaps on the stream), not the tool's `runMs`. CPU: separately time one full `runTix(...,{precision:'f32'})` with `performance.now()` around evaluation only; warm on a smaller legal call first, exclude parsing, input generation and reporting. Record actual elapsed time even for slow shapes; don't extrapolate from a reduced workload. Compare returned arrays outside the timers and record maximum deviation and coordinate; distinguish this comparison to local f32 from the small f64 contract. No concurrent GPU measurements.

| Corpus `main.tix` | Shape bindings |
|---|---|
| matmul | M=512 K=512 N=512 |
| softmax | N=4096 C=1024 |
| layernorm | N=4096 D=1024 |
| attention | Q=1024 K=1024 D=64 V=64 |
| mlp | N=1024 D=256 H=1024 O=256 |
| conv2d | N=8 C=16 H=W=64 O=32; 3×3 kernel, valid output |

Deliver in order: emitter and codec; isolated tool and remote runner; asynchronous pass, evidence/rejection tests; reproducible timing harness in the ticket and measured results. Stop here for review. No changes to Typed, whole-suite run, general CUDA IR, or later-stage GPU optimizations.
