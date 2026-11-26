---
Title: f32 DSP corpus program
Ticket: IRWB-016
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://corpus/candela-gallery/glue.typed
      Note: Corpus precedent for packed f32 buffer access
    - Path: repo://corpus/reference.md
      Note: Corpus project and workbench conventions
    - Path: repo://src/typed/evaluate.ts
      Note: Packed f32 case generation and the bitwise pass gate
    - Path: repo://src/typed/lift.ts
      Note: f32 memory and arithmetic lowering into Typed Blocks
    - Path: repo://src/typed/passes.ts
      Note: Checked speed pipeline
    - Path: repo://src/typed/specialize.ts
      Note: Current binding scope for specialization
    - Path: repo://tools/reference-check.mjs
      Note: Reference compiler image comparison on the emulator
ExternalSources: []
Summary: Design for a radix-2 FFT and three-channel biquad bank as one checked Typed corpus project.
LastUpdated: 2026-11-26T11:54:37.88063017-05:00
WhatFor: ""
WhenToUse: ""
---

# f32 DSP corpus program

Add one project, `f32-dsp`, with two independently callable kernels. The FFT provides complex arithmetic, nested loops and a small table of constant stage roots. The biquad bank provides a multiply/add chain with loop-carried state and coefficients shared across samples. Independent entry points let us attribute instruction counts and numerical error to each kernel. Piping the filter output into the FFT would make a plausible application but would mix their costs and obscure which kernel introduced an error.

## Supported calls and memory layout

All buffers in one call are distinct, as allocated by the case generator. A `buffer` stores a 32-bit length in u16 cells followed by the cells. A packed f32 starts at byte `4 + 4*i`, with its low u16 first. Use `getF32(i)` and `setF32(i, x)` for samples and coefficients and `charCodeAt(0)` for the exponent. `buffer.length / 2` is the number of packed floats. For example, a buffer of 64 floats has `length == 128`. The front end bounds-checks the high cell of a float access. The lifter preserves f32 loads, stores and arithmetic. These operations are used by Candela, and a small probe ran them together with a value-record return through the workbench and the reference compiler. [Candela glue](../../../../../../corpus/candela-gallery/glue.typed), [Typed front end](../../../../../../vendor/ds-js-os/compiler/typed/typed-wasm.js), [lifter](../../../../../../src/typed/lift.ts)

| Function | Buffer inputs and supported values | Observable result |
| --- | --- | --- |
| `fft(work: buffer, size: buffer, roots: buffer): i32` | `work` has 64 floats, with real and imaginary parts at `2*i` and `2*i+1`. Each component is finite in [−1, 1]. `size` has one u16 exponent in {3, 4, 5}, giving N = 8, 16 or 32. `roots` has 10 floats holding five complex stage roots. | Return N and replace the first N complex samples with the unnormalized forward transform in natural bin order. Preserve the remaining buffer cells. |
| `biquadBank(signal: buffer, coeff: buffer, out: buffer): i32` | `signal` has M packed floats, 8 ≤ M ≤ 32, finite in [−1, 1]. `coeff` has 15 packed floats, three rows in `[b0, b1, b2, a1, a2]` order, each finite in [−0.25, 0.25]. `out` has 96 packed floats and arbitrary initial cells. | Return M and write channel c, sample i at float index `c*M+i` for c = 0, 1, 2. Preserve the unwritten suffix. |

The other argument buffers and all length words stay byte-identical. Neither kernel allocates guest memory or recurses. Caller-supplied packed buffers are simpler here than frame arrays because generated cases can initialize them and the checker can observe every output word. The design covers finite block DSP with zero initial filter state. Streaming state, inverse FFT, and a separate hand-tuned project are outside this design because the two forward kernels suffice for the experiments.

## FFT

Use radix-2 decimation in time. Bit-reverse the low `size[0]` bits of each index by shifting one bit at a time in a short inner loop. Swap the two complex samples when `i < reversed`, loading both before storing. The in-place layout makes each swap and butterfly visible in the same buffer and removes the need for a second workspace.

For each stage with width m = 2, 4, 8, 16, 32 up through N, read one complex root `exp(-2πi/m)` from `roots` in ascending width order. Store each component rounded once to f32. Use exact pairs (−1, +0) for m = 2 and (+0, −1) for m = 4. Start each stage with w = (1, +0). Visit the lane j before visiting the blocks so each w can serve all butterflies in that lane.

```text
for each stage m:
    step = roots[stage]                   # one complex pair
    half = m / 2
    w = (1.0, 0.0)
    for j = 0 .. half-1:
        for base = 0; base < N; base += m:
            lo = base + j
            hi = lo + half
            u = load work[lo]             # real and imaginary parts
            v = load work[hi]
            t = complexMul(v.re, v.im, w.re, w.im)
            store work[lo] = (u.re + t.re, u.im + t.im)
            store work[hi] = (u.re - t.re, u.im - t.im)
        next = complexMul(w.re, w.im, step.re, step.im)
        w = (next.re, next.im)
```

Use ordinary i32 loop counters, shifts and indices. The two calls to `complexMul` use separate f32 products and a subtraction or addition, in the order shown below. Keep the helper call as the whole right side of a local declaration so the current inliner can see it. Use two scalar locals for w and assign both from the returned pair once both components have been computed.

```text
value record Complex { re: f32; im: f32; }
complexMul(ar: f32, ai: f32, br: f32, bi: f32): Complex
    return Complex(ar*br - ai*bi, ar*bi + ai*br)
```

A full twiddle lookup table would be the simpler execution path. Five stage roots plus a recurrence deliberately leave f32 work for partial evaluation. A future specialized kernel can fold the recurrence to the exact f32 values produced by r0 on that configuration. Substituting fresh sine and cosine values for those powers would change the rounding history.

## Biquad bank

Run three parallel direct-form I sections on the same input. Loop over channels, loading the five coefficients once at the start of each channel. Initialize `x1`, `x2`, `y1`, `y2` as f32 +0 at the start of each channel. For sample i, use this exact source grouping, with separately rounded f32 operators.

```text
x = signal.getF32(i)
y = (((b0*x + b1*x1) + b2*x2) - a1*y1) - a2*y2
out.setF32(channel*M + i, y)
x2 = x1
x1 = x
y2 = y1
y1 = y
```

One section would be simpler but would exercise only one coefficient set per block. Direct form I makes the history and coefficient signs clear and leaves a straight-line window of five multiplies and four adds or subtracts. The coefficient box gives `abs(a1)+abs(a2) ≤ 0.5`, so the feedback history stays bounded. Keep the natural history assignments and the baseline grouping. Register coalescing, unrolling, and alternative groupings belong to the experiments.

## Corpus files and generated cases

Use `corpus/projects/f32-dsp/main.typed` for the two kernels and helper, `notes.md` for the buffer layout and experiment instructions, and `scripts/explore.js` for a fresh workbench run that displays selected outputs and before/after RV32 counts. Use `project.json` as below, with `focus` set to the implemented butterfly call's source line. The directory loader discovers the project. Add it to `corpus/projects/index.json` only if placing it explicitly in the book order. [Project conventions](../../../../../../corpus/reference.md), [project source assembly](../../../../../../src/typed/project.ts), [corpus loader](../../../../../../tools/corpus.mjs), [Blend script](../../../../../../corpus/projects/blend/scripts/explore.js)

```json
{
  "title": "f32 DSP",
  "about": "Compare exact optimization of an FFT and a biquad filter bank.",
  "group": "Programs",
  "sources": ["main.typed"],
  "pipeline": "speed",
  "focus": 1,
  "scripts": { "explore": { "about": "Compare r0 and speed on fixed inputs", "fresh": true } },
  "inputs": {
    "complexMul": { "ar": [-32, 32], "ai": [-32, 32], "br": [-2, 2], "bi": [-2, 2] },
    "fft": {
      "work": { "floats": [64, 64], "range": [-1, 1] },
      "size": { "buffer": [1, 1], "cell": [3, 5] },
      "roots": { "cells": [0, 49024, 0, 0, 0, 0, 0, 49024, 1267, 16181, 1267, 48949, 33630, 16236, 61205, 48835, 5310, 16251, 50626, 48711] }
    },
    "biquadBank": {
      "signal": { "floats": [8, 32], "range": [-1, 1] },
      "coeff": { "floats": [15, 15], "range": [-0.25, 0.25] },
      "out": { "buffer": [192, 192], "cell": [42405, 42405] }
    }
  }
}
```

The placeholder `focus: 1` is replaced once the source exists. `floats` lengths count f32s, while `cells` and `buffer` lengths count u16s. Use a fixed-capacity FFT work buffer so size and buffer length can be generated independently. Derive M from the signal buffer to avoid a separate length argument that the generator cannot correlate with the buffer. Give the helper its own specs because the regular project checks exercise every function directly as well as through its callers.

For a fixed-configuration experiment, restrict `fft.size` to `{"cells":[5]}` and keep the same roots. Restrict `biquadBank.coeff` to `cells` made by packing these three rows as f32, low u16 then high u16.

```text
[0.25,  0.125,  0.0,   -0.25,   0.125]
[0.125, -0.25,  0.125,  0.125, -0.125]
[0.125,  0.0,  -0.125, -0.125,  0.25]
```

Keep samples variable in both profiles. These overrides define an exact case suite and the data a future specialization pass would consume. The existing `specialize` pass can bind scalar parameters and integer record fields. It cannot bind buffer contents, so the fixed profile today runs the same general code on those inputs. [Case generator](../../../../../../src/typed/evaluate.ts), [current specialization pass](../../../../../../src/typed/specialize.ts)

## Correctness and accuracy

**Bit-exact optimization.** Keep `meaningKept` on for every accepted pipeline pass. It compares r0 and the candidate on `casesFrom` cases, including result words and guest memory. Separately compare both the workbench RV32 image and the reference compiler's RV32 image with the r0 evaluator. Follow the `tools/reference-check.mjs` pattern for this project, running both images on the same original case bytes. A baseline and a candidate can agree on a trap, and a limit hit is inconclusive. Require all scheduled cases to complete successfully and agree, with zero traps, faults and inconclusives. Check the full memory image, including inactive tails, rather than the workbench's preview of buffer cells. [Evaluator and comparison](../../../../../../src/typed/evaluate.ts), [reference image runner](../../../../../../tools/reference-check.mjs)

**Independent numerical reference.** Write a JavaScript float64 oracle in a small Node test or runner patterned after the existing Node corpus tools. Decode the original f32 inputs with little-endian `DataView`. Compute the forward DFT directly with float64 `cos` and `sin` and sums over all n, using phase `-2π*k*n/N`. Use the mathematical roots. For the bank, build each float64 impulse response with `h[n] = b[n] - a1*h[n-1] - a2*h[n-2]`, where negative history is zero and b[n] is zero beyond index 2. Compute each output by convolving that impulse response with the input block. Use the exact decoded coefficient values in the oracle. A second FFT or direct form I could share an indexing or update-order bug. At 32 samples, both quadratic algorithms are cheap enough to run per case.

Check r0 and the reference image against this oracle before using it to judge optimization. For the FFT, use the complex magnitude of each bin's error and peak reference magnitude. For each filter channel, use the absolute sample error and that channel's peak absolute reference. For each case and each such output vector calculate

```text
E = max component error magnitude across the vector
S = max(1.0, peak reference magnitude)
error_dB = 20*log10(E/S)       # E=0 gives -Infinity
accept when error_dB <= -100  # equivalently E <= 1e-5*S
```

Reject non-finite output values and keep return counts, lengths, read-only input bytes and inactive output bytes exact. Use the peak error so a bad bin or a single bad sample cannot hide in an RMS average. The unit floor supplies an absolute error bound for silence and deep cancellation. Treat −100 dB as the initial contract for this bounded corpus and verify that r0 meets it on every fixture. The float64 test covers the kernels during initial implementation. Integrating this predicate into pass acceptance requires the opt-in tolerance contract. A tolerance pass must compare against this fixed independent reference at every accepted revision, so small changes cannot accumulate unchecked from pass to pass. Separate multiplies and adds schedule two roundings, and a fused multiply-add schedules one. Reassociation moves rounding points too. Either can fail the bit-exact gate while meeting the numerical bound.

## Sizing and measurement

The checker limit is 20,000 executed IR statements per case, including calls. Expression nodes are part of their containing statements. For N = 32 there are 160 bit-reversal iterations, at most 16 swaps, 80 butterflies, 31 twiddle updates and five stage setups. Budget 20 statements per reversal iteration, 50 per swap, 100 per butterfly, 30 per twiddle update and 200 total for outer work outside those iterations, about 13,200 statements. Charge loop control and buffer address checks to their iterations. At M = 32 the bank runs 96 sample iterations. Budget 100 statements per iteration including history, address checks and loop control, and 300 for channel setup and return, about 9,900. These are planning estimates. Measure r0 and each accepted revision with `evaluate` at N = M = 32, across both case profiles. Target a measured maximum of 15,000 for margin. If it is exceeded, inspect executed statement counts before reducing the corresponding corpus cap and adjusting its fixtures. Keep the normal limit.

Run the generated exact checks at 40 cases per function, seed 7, during the pipeline, and 100 cases per function at seeds 7 and 19 in the corpus test for each profile. Add deterministic cases at every FFT size, including zero, an impulse away from sample zero, DC, and a positive complex single-bin tone. Check the forward sign and natural bin order explicitly. Exercise the bank at M = 8 and 32 with silence, impulse, alternating signal, and feedback coefficients on the box boundary. Use a negative oracle test such as swapping FFT bins or reversing a feedback sign. Use a rounding witness in the bank with ε = 2⁻²³, M = 8, signal `[1, 1−ε, 0, …]` and first-row coefficients `[0.25*(1−ε), −0.25*(1−2ε), 0, 0, 0]`. At sample 1 the two separately rounded products cancel to zero. Fusing `b0*x + b1*x1` gives 2⁻⁴⁸. Reproduce that value in a test fixture with float64 then one f32 rounding, and verify that this output fails exact comparison while passing the dB contract.

For performance, reuse the exact case bytes across r0, O2, `speed`, and the reference image. Measure `speed` with default backend options and then with `chains`, `coalesce` and `homes`. Report per kernel and size the median and maximum dynamic RV32 instructions, code bytes, and spill counts. Report exact verdicts and worst dB error separately from speed. Count only completed runs and report any emulator limit hits, using the reference tool's 200,000-instruction cap. Inspect hot-loop instructions and provenance to connect changes to inlining, loop rotation, copies or constant materialization. A fixed-input run of the general image is the baseline for any future specialized image on those same bytes. [Pipeline definitions](../../../../../../src/typed/passes.ts), [backend switches](../../../../../../src/typed/backend/options.ts)

## Compiler work fed by the corpus

- **IRWB-003** can inline the pair-return helper, rotate the counted loops and measure the effect of coalescing moves and keeping repeated constants, such as +0 and +1, in registers. Compare instruction deltas with the backend options off and on.
- **IRWB-006 and IRWB-008** can use pure expression subtrees from the butterfly and biquad for typed rules and edit validation, with loop-carried FFT and filter values as SSA examples. Evidence for exact integer index rewrites and f32 constant folding can be checked independently of the sampled verdict. Floating reassociation needs a different justification.
- **IRWB-007** has a small constant-memory case with immutable size, stage roots and coefficient rows, while samples stay dynamic. The exact comparison suite for a specialized image must generate or replay only cases matching its declared buffer bindings.
- **IRWB-010 and IRWB-011** can use the same complex product and multiply/add window to compare expression candidates whose rounding differs. The fixed float64 reference supplies a separate numerical verdict on the complete kernels, including the filter's accumulated feedback error.

## Implementation order

1. Add the project metadata and buffer fixtures. Implement `complexMul`, then the FFT and filter kernels with the specified source grouping. Run the project on the evaluator and verify the full outputs, including tails.
2. Add the float64 DFT and convolution oracle and deterministic fixtures. Verify r0, the reference image and the workbench r0 image, and record the measured statement headroom.
3. Run the exact pipelines on both case profiles, compare their RV32 images against r0, and add the workbench exploration script. Record baseline instruction counts per kernel and size.

## Later

- IRWB-007 requires extending binding facts and checked-case assumptions to immutable buffer bytes, then folding stage-root powers and coefficient reads under those facts.
- IRWB-006, IRWB-008 and IRWB-010 can attach their rule, validation and search infrastructure when available and run it on the expression windows above.
- IRWB-011 requires a per-project tolerance contract for accepted passes and a fused operation modeled in both the IR evaluator and RV32 lowering before testing FMA in a tolerance pipeline.
- A separate hand-optimized ceiling can unroll fixed configurations and precompute twiddles after the ordinary corpus baseline establishes the comparison.
