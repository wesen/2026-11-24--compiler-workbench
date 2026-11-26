---
Title: Checking a tensor lowering on the GPU that runs it
Ticket: IRWB-022-G
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-source.ts
      Note: Operation and fold emission on the evaluated revision
    - Path: repo://ttmp/2026/11/26/IRWB-022-G--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/scripts/07-isolate-intrinsic.mjs
      Note: Paired single-libcall diagnosis on GB10
ExternalSources: []
Summary: Stage 2 results for revision 252af7a. Direct CUDA emission, a batched semantic contract, timings and diagnosis of numerical differences on GB10.
LastUpdated: 2026-11-26T17:16:00-05:00
WhatFor: Final report on the checked Tix-to-CUDA pass.
WhenToUse: To interpret the independent evaluation or reproduce the numerical diagnosis.
---

# Checking a tensor lowering on the GPU that runs it

On an NVIDIA GB10, our matrix multiplication matched the interpreter on all 262,144 output words. Attention matched on only 10,618 of 65,536. Both programs compute their dot products one multiply and one add at a time, in the prescribed order. The difference begins elsewhere: attention feeds its second set of dot products with weights computed using an exponential. Changing just the `expf` call in a diagnostic copy of the generated CUDA removed every differing attention word in a small reproduction.

Tix is an index-notation language built to test IR Workbench, a compiler framework that represents code as revisioned artifacts and lets passes declare executable conditions on their outputs. Stage 1 gave Tix two interpreters and a checked optimizer. Stage 2, evaluated at revision `252af7a`, added a GPU backend. Its contract runs the **candidate CUDA translation unit** on the target and compares the resulting tensors with a reference. There are two distinct results: what numerical meaning this implementation preserves, and how little the framework had to change to check it on an expensive asynchronous machine.

## From one definition to one kernel

A Tix statement defines a new tensor. In `y[i,j] = sum(k) a[i,k] * b[k,j]`, `i` and `j` identify independent outputs; `k` identifies successive terms of one output. The f32 interpreter rounds each operation separately. The product rounds before the add, which rounds before the next iteration. A multi-index reduction visits tuples in increasing lexicographic order, first index outermost. Parallelizing the output coordinates is consistent with that definition. Parallelizing the reduction as a tree would change it.

The backend emits CUDA C directly from the selected function's **current** IR. The IR already identifies each tensor and index binding, records symbolic extents and affine reads, and contains the scalar expression tree for each statement. A second kernel IR would duplicate those facts without providing another transformation for this stage to perform. The output of the framework transformation is instead an ordinary typed text port. `cudaSource` exposes precisely that complete translation unit; `runTixCuda` runs it for one supplied input; `checkLowering` returns a verdict on it. Merely obtaining source or successfully executing a call is not a passing check.

The generated host binds shape symbols from the input dimensions. It allocates device buffers and launches one kernel per nonempty statement result, in statement order on one stream. A block has 128 threads. Each thread guards its linear index against the element count, decodes a row-major coordinate, and stores once. The following is the inner part of the emitted matmul kernel; the two load statements are elided. `s1` is the runtime value of K, `v3` and `v4` the operand elements, and `I` a signed 64-bit integer.

```cuda
float v0=0.0f;
for(I r1=0;r1<(0LL + 1LL*s1);++r1){
  // ... load v3 = a[i,k] and v4 = b[k,j] ...
  float v2=__fmul_rn(v3,v4);
  v0=__fadd_rn(v0,v2);
}
out[tid]=v0;
```

Subtraction and division likewise use explicit round-to-nearest operations. The emitter embeds a literal's already-rounded f32 word and uses integer arithmetic for addresses. Sum starts at positive zero; maximum starts at negative infinity. Min and max propagate NaNs instead of silently returning the non-NaN operand. An empty reduction returns its initializer. A zero-element result needs no launch, and returning an input needs no copy kernel.

Nothing in that mapping assumes the function still resembles its source spelling. After `inline`, the consumer can contain the producer's expression at a transposed address. After `split-sum`, a single sum can be two nested folds, an outer fold over blocks of four and an inner fold over the valid lanes of each block. Both get their own accumulator. For `[1,0,0,0,2⁻²⁴,2⁻²⁴,2⁻²⁴]`, the sequential f32 sum returns 1, but starting the last three terms in a new accumulator gives a blocked result of `1 + 2⁻²²`. The GPU returned the respective result for each revision. Exactness *as a lowering* would mean matching the f32 interpreter of the **same revision**, not undoing an authorized change in grouping.

## What a passing check means

Before choosing a contract, we ran a fixed arithmetic probe through the same remote tool and compiler as the backend: CUDA 13.0.88, `nvcc -O3 -arch=sm_121`, no fast math. For `x=(i−8192)/1024` at 16,385 points, we compared CUDA results with JavaScript double operations rounded at the specified f32 sites. `expf(x)` differed in 5,007 words, `logf(9+x)` in 902 and `tanhf(x)` in 1,264; the square roots all matched. At `x = −7.998046875`, for instance, `expf` produced `0x39b0390e`, while `Math.fround(Math.exp(x))` produced `0x39b0390f`. There is no reduction, fusion or address calculation to blame in that comparison.

We kept stage 1's output-error budget. Run the **original** function in f64 on the *same f32 input bytes*. For each eligible returned tensor, require the same shape and length and, at every coordinate with reference `r`, a finite GPU value `g` satisfying

```
abs(g - r) <= 2e-6 + 2e-5 * abs(r)
```

The absolute term matters near cancellation; the relative term matters as the output grows. Using the origin avoids resetting the budget after `split-sum`. The probe, which also included a seven-term normalized exponential and a signed dot product, used at most 2.11% of this allowance. Our later audit of the six corpus functions found a higher maximum: 24.67%, at a convolution output with f64 value `0.05228970081938111` and GPU value `0.052288949489593506`. We did not increase the allowance. These numbers characterize a sample, not an error theorem for long or ill-conditioned reductions.

```mermaid
flowchart LR
  O[Original Tix revision] --> R[Generate cases and f64 references]
  C[Current Tix revision] --> U[Emit complete CUDA unit]
  R --> D[Look up case verdicts]
  U --> D
  D -->|missing indices and input bytes| G[Run one batch on GB10 with a new or cached binary]
  G --> V[Compare returned elements locally]
  V --> T[Tally in case order]
  D -->|already decided| T
  T --> P[Pass accepted or rejected]
```

The checker generates cases for the named function from the origin alone. It tries dimensions 1, 3, 4 and 7 and a mixed assignment cycling through 3, 5 and 7 in sorted symbol order. These include complete blocks and partial tails. At each eligible shape it uses deterministic signed and positive streams and a repeating half-ulp witness, with seed 20. The sampler limits tensors to 4,096 elements and reference evaluation to one million visits and loop iterations per case. It excludes out-of-domain samples and whole nonfinite reference returns. A nonfinite *candidate* on a finite reference is a failure, not grounds to drop the sample. If the function has no comparable case, verification fails. The six unoptimized functions contributed 86 eligible cases in our audit.

All missing cases go into **one** remote job, not one invocation of SSH and `nvcc` per shape or stream. The binary protocol carries case IDs, ranks, extents and little-endian f32 words; the response adds the event interval for each case. The local runner checks IDs, shapes, lengths, timings and complete consumption of the reply before returning observations. A failed transfer, compile, launch or decode is not evidence about the numerical relation. A numerical mismatch, by contrast, produces a verdict with the case and the failing coordinate.

## The framework and the remote tool

An existing framework transformation can already take ports of different types and await a relational postcondition. We used `defineTransformation` and `AnalysisManager` rather than fitting `Tix module → CUDA text` into a same-kind graph edit. The differential checker already knew how to delegate a list of missing indices, restore case order and reuse decided verdicts. Its **type**, however, still required synchronous `run` and `compare` methods, even when the delegate decided everything. The first prototype supplied methods whose only honest implementation was to throw.

`src/framework/contracts/differential.ts` gained a batch-only specification: `decide` is required; there is no local evaluator or comparator. Synchronous execution and worker extraction reject such a specification, and a missing delegate result cannot silently select local execution. That was the only framework source change; `src/framework/contracts/README.md` documents the interface. In-process replay keys cover the origin revision, function, case identity and versioned sampling policy on the reference side; on the candidate side they include the emitted text and configured host, compiler path, architecture, flags and ABI. The f64 results live with the cases. A warm check can thus reuse both the reference work and the verdict without making a remote identity query. This assumes the target installation stays stable during the process. No verdict survives a restart.

`tools/cuda-remote.mjs` has a different cache, for **binaries**. It hashes the staged filenames and file contents, compiler path/build and compilation recipe, including flags and architecture. Including all files matters because an input file can participate in the build. The tool serializes publication of a missing binary under a per-key lock. Two simultaneous callers with identical input bytes use the same binary but get private staging and output directories, so one caller cannot clear the other's result before fetch. The tool separates operands from shell options, restricts staging permissions, and reports output-fetch failures. The GPU timing lock remains separate from the build lock. A binary hit saves compilation; it is never a cached semantic verdict.

## Verification and independent results

The build succeeded and 31 tensor tests passed, with network-dependent tests in their own file. They include six independent small numerical oracles, checks on actual optimized revisions, zero extents, signed zero, NaN propagation, index shadowing, malformed batch replies and concurrent jobs on identical input files. One deliberately incorrect CUDA unit changed the generated block count from ceiling to floor. Submitted through the real `verifyTransformation` postcondition, it compiled and ran but lost the tail at K=7; the recorded counterexample included a coordinate. All 227 framework tests and 36 selected Typed-language tests passed. The independent stage-1 hidden suite passed 25/25, and the evaluator found all three new public API functions.

Here are the independent small-program comparisons. The f32 column counts identical output **words**, and Δ32 is the evaluator's maximum difference scaled by `max(1, |r|)` against the corresponding f32 run. Δ64 is its reported largest difference from the f64 reference. In the second group the f32 comparator ran the optimized revision after `inline` and `split-sum`.

| Revision | Function | Identical / total | Δ32 | Δ64 |
|---|---|---:|---:|---:|
| Original | matmul | 35/35 | 0 | 3.2e-7 |
| Original | softmax | 54/76 | 3.0e-8 | 5.3e-8 |
| Original | layernorm | 72/72 | 0 | 1.3e-7 |
| Original | attention | 56/72 | 6.0e-8 | 6.6e-8 |
| Original | mlp | 21/24 | 8.9e-8 | 3.6e-7 |
| Original | conv2d | 160/160 | 0 | 3.1e-7 |
| Optimized | matmul | 35/35 | 0 | 2.2e-7 |
| Optimized | softmax | 56/76 | 3.0e-8 | 4.9e-8 |
| Optimized | attention | 47/72 | 3.0e-8 | 4.4e-8 |
| Optimized | mlp | 18/24 | 1.2e-7 | 3.4e-7 |

The independent full-size results below use the original corpus functions. The sizes are expressed in their source shape names. The third column is the evaluator's returned `gpuMs`; it is not a repeat of our benchmark median.

| Function and dimensions | Identical to f32 / total | `gpuMs` | Δ32 |
|---|---:|---:|---:|
| matmul M=K=N=512 | 262144/262144 | 0.246 | 0 |
| softmax N=4096 C=1024 | 2616298/4194304 | 0.396 | 3.7e-9 |
| layernorm N=4096 D=1024 | 4194304/4194304 | 0.476 | 0 |
| attention Q=K=1024 D=V=64 | 10618/65536 | 1.569 | 3.7e-8 |
| mlp N=1024 D=256 H=1024 O=256 | 231045/262144 | 1.000 | 2.2e-5 |
| conv2d N=8 C=16 H=W=64 O=32, 3×3 | 984064/984064 | 0.350 | 0 |

Tracing the operands of the first differing operations narrows the diagnosis to three library calls. Two occur in the corpus; the third is available to other Tix programs:

- **Softmax and attention:** `src/tensor/cuda-source.ts:19` selects `expf`. The row maximum and subtraction determine its operand. A change to one exponential can change the row sum and hence other normalized weights. Attention then multiplies these weights by values and sums them. A majority of output words can change even when the largest scaled difference is only `3.7e-8`.
- **MLP:** `src/tensor/cuda-source.ts:21` selects `tanhf` in the GELU approximation. The f32 interpreter uses the *same GELU formula*; the difference is the implementation of tanh inside it. The following affine layer mixes changed activations, so the final `2.2e-5` scaled difference is not an estimate of tanh's single-call error. Nor is it a failed contract case: it compares a full-size result to f32, not a sampled result to origin f64.
- **Logarithm:** `src/tensor/cuda-source.ts:20` selects `logf` rather than a double log rounded to f32. No corpus fixture calls log. Among 20 independent random fixed-core programs, 16 matched f32 at every element and the largest difference was `1.2e-7`. The known sources of finite arithmetic discrepancies are `expf`, `logf` and `tanhf`. The aggregate supplies neither the four differing programs nor their operands, so it does not identify which of these sites each executed. In particular it is not evidence that any one of the four used log.

To test causality we compiled one untimed GB10 job with pairs of generated kernels on fresh inputs. In each pair the only numerical edit was to evaluate the one suspect function in CUDA double and immediately round its result with `__double2float_rn`. The reference was the unchanged f32 interpreter on the same current revision. In the stock small softmax, attention and MLP cases we saw 51/171, 46/117 and 8/143 **differing** words; on their optimized counterparts, 70/171, 57/117 and 13/143. In all six diagnostic copies that count became zero. A standalone log grid went from 902/16,385 differing words to zero. This [one-call-site experiment](../scripts/07-isolate-intrinsic.mjs) reproduces the mechanism, not the evaluator's private inputs. It changes no shipped code.

The nonzero Δ64 values have a second, expected source: the f32 computation rounds literals, arithmetic and each fold step, whereas the f64 evaluator retains double results. Matmul and convolution separate the rounded product from the rounded accumulator update. Layer normalization also rounds its mean, variance, square root, division and affine scale and shift. These three programs had *no* GPU-versus-f32 mismatch. Softmax, attention and MLP incur the same precision distinction in addition to their intrinsic differences. Splitting a sum can change rounding relative to the original reference; it cannot explain a mismatch between two executions of the same optimized fold. The reported output maxima do not locate a unique addition responsible for an f64 residual.

Independent `checkLowering` calls accepted the six corpus functions and ten random ones, 16/16 under `tolerance`, averaging 3.2 seconds per check. That figure includes the remote verification path; it is not how long a kernel takes. Conversely, agreement of every output word on a particular run is stronger evidence about that run than acceptance by the sampled budget.

## Cost of the straightforward mapping

For each full-size fixture we timed the original function on the same deterministic f32 input bytes on both machines. On the GB10, every generated main preloads each kernel with `cudaFuncGetAttributes`: with lazy loading, placing events around the first launch alone can include module startup. The benchmark invokes the tool with `--timed -- --benchmark`, copies inputs once, warms one complete sequence and measures three sequences using the same buffers. CUDA events on the launch stream enclose just the ordered kernels, including any inter-kernel gaps. The table gives their median. The normal API uses a single preloaded sequence. Neither interval includes allocation, file IO, copies or SSH.

On the local i7-1165G7 with Node v24.18.0, we warmed the interpreter on a small legal shape, then measured one **full-size** `runTix` call with a monotonic wall clock. This includes the interpreter's own copies and materialization, not fixture parsing or input generation. The host was shared and busy during these measurements. These are observed times, not isolated CPU throughput, and dividing columns would not give an end-to-end application speedup.

| Full-size function | Kernels | Our GPU median (ms) | Local f32 interpreter (ms) |
|---|---:|---:|---:|
| matmul | 1 | 0.230080 | 120,606 |
| softmax | 4 | 0.454080 | 18,581 |
| layernorm | 4 | 0.434880 | 32,522 |
| attention | 6 | 0.889216 | 860,698 |
| mlp | 3 | 0.852032 | 1,655,120 |
| conv2d | 1 | 0.160928 | 456,591 |

The [measurement record](02-cuda-lowering-results-and-timing-protocol.md) includes the three individual intervals, input digests and reproduction commands. On those inputs our largest absolute GPU-versus-f32 difference was `1.43e-6` in MLP. Those absolute differences, the independent evaluator's scaled differences, and the checker's f64 budget answer three different questions.

## The contract I would choose next time

For the evaluated backend, tolerance is the defensible choice of the two uniform API relations: a single `expf` counterexample rules out whole-language bit identity to current f32. That does not make the chosen constants a tight global bound. There is stronger evidence for the finite-result subset without the three approximate library calls, including exact arithmetic-only corpus runs. More importantly, the coordinator compared **double** CUDA `exp`, `log` and `tanh` followed by one f32 rounding against the corresponding f32 meaning on **all 2³² f32 inputs** on GB10. They agreed everywhere with NaNs compared as a class; IEEE-mode basic arithmetic and square root also have the required rounding. This supports an exact-to-current-f32 relation on this target for a lowering using those calls, not a retroactive exact verdict on our float calls, not NaN payload identity, and not exactness to the origin after a reassociation.

I would test both precision choices before committing to an error budget. An exact-to-current check would catch a one-word lowering regression independently of the optimizer's separate origin-f64 budget. I would retain a failing program, input and first differing intermediate alongside each aggregate mismatch count: that would turn the random-suite attribution from a set of candidate call sites into a reproducible diagnosis. The cost of double transcendental functions in these kernels was not benchmarked. The timings above belong exclusively to the implementation we evaluated.
