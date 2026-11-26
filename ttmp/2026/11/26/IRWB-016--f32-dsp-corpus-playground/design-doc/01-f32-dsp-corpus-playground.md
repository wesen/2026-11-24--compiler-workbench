---
Title: f32 DSP corpus playground
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
    - Path: repo://corpus/reference.md
      Note: Corpus project and workbench APIs
    - Path: repo://src/typed/evaluate.ts
      Note: Float buffer generation and per-pass budget
    - Path: repo://src/typed/lift.ts
      Note: Front-end operations and Typed Blocks lifting
    - Path: repo://src/typed/project.ts
      Note: Project loading and metadata
    - Path: repo://src/typed/reference.ts
      Note: Signature-aware reference execution
    - Path: repo://src/typed/specialize.ts
      Note: Scalar binding path
    - Path: repo://tools/reference-check.mjs
      Note: Corpus reference checker integration
ExternalSources: []
Summary: Design for an iterative complex f32 FFT and two-band biquad bank in the optimization corpus.
LastUpdated: 2026-11-26T10:57:58.594360545-05:00
WhatFor: Specify the kernels, case generator, oracles and measurements for the f32 DSP project.
WhenToUse: Implementing the f32 DSP corpus project or running its optimization experiments.
---

# f32 DSP corpus playground

## Goal

Add one project, `corpus/projects/f32-dsp/`, with two independently callable kernels. `fft` computes a forward complex radix-2 transform in place. `biquadBank` applies two independent second-order filters to the same real block and writes both channels. The butterfly provides straight-line complex arithmetic inside nested loops. The filter provides multiply-add chains and loop-carried state. Keep the source in the usual textbook form so the compiler sees the copies, address calculations and arithmetic it would see in application code.

A single filter stage or FFT butterfly would expose the arithmetic, but would miss the loops, recurrence and argument specialization that make the full kernels useful. Running the filters and FFT as separate entries keeps their instruction counts and numerical errors attributable to the respective kernel.

- **IRWB-003** exercises inlining at the filter's dot product, loop rotation in both kernels, and backend copy coalescing and constant register homes.
- **IRWB-006** gets typed arithmetic for verified rules and loop-carried definitions for the SSA view.
- **IRWB-007** gets the FFT length as a scalar fact and the twiddle and coefficient tables as candidate constant memory.
- **IRWB-008** gets bit-exact cases for the sampled gate alongside any rule-backed exact evidence a pipeline can produce.
- **IRWB-010** gets small, pure arithmetic windows in the butterfly and filter sum for rewrite search.
- **IRWB-011** gets output vectors whose error can be bounded when an arithmetic rewrite changes the last bits.

## Data and entries

Use ordinary `buffer` parameters and `getF32(i)` / `setF32(i, v)`. One float occupies two u16 cells, low half first. Its data starts at byte `4 + 4*i` from the buffer base. `buffer.length` counts u16 cells, so the FFT takes its length as a scalar `n: i32`. Supply separate guest buffers for each parameter. `getF32` and `setF32` perform checked addressing via the second u16 cell of each pair. The following sizes and value ranges define the experiment.

| Entry | Parameter | Layout and access |
| --- | --- | --- |
| `fft(...): i32` | `work: buffer` | 32 f32 slots, real/imaginary pairs. Read and overwrite the first `2*n` floats. |
| | `twiddles: buffer` | 16 f32 slots, eight complex roots for a size-16 forward transform. Read only. |
| | `n: i32` | One of 8 or 16. Return `n` after writing the transform. |
| `biquadBank(...): i32` | `samples: buffer` | 16 real f32 inputs shared across both bands. Read only. |
| | `coefficients: buffer` | 10 f32 slots, two consecutive rows of `b0, b1, b2, a1, a2`. Read only. |
| | `output: buffer` | 32 f32 slots, band-major. Store sample `i` of band `b` at `16*b+i`. Return 16. |

The simplest external representation is the packed float buffer already used by Candela. It makes results observable and keeps tables available as experiment inputs. Use one maximum-size work buffer for both FFT lengths so `casesFrom` can choose length and data independently. Exactly-sized buffers would require correlated specifications. A single fixed transform length would remove the general versus specialized comparison. The filter uses a fixed 16-sample block and two bands because bank size and block size need no additional experiment.

### FFT

Use iterative decimation in time with an unnormalized forward transform and natural-order output. First walk `i = 0 .. n-1` and reverse its low `log2(n)` bits. Start `j = 0`, copy `i` to `sourceBits`, and loop over `bits = n; bits > 1; bits = bits >> 1`, adding `sourceBits & 1` to `2*j` and shifting `sourceBits` right once per iteration. Swap the two complex samples only if `i < j`. Load both pairs before writing either.

Next double `span` from 2 through `n`. For each group beginning at `base = 0, span, 2*span, ...`, run `j` from 0 to `span/2 - 1`. Use integer `half = span / 2`, `stride = 16 / span`, and read the table pair at float slots `2*(j*stride)` and `2*(j*stride)+1`. The table pair at root index `k` is `cos(-2πk/16), sin(-2πk/16)` rounded to f32. Set root 0 to `(1, 0)` and root 4 to `(0, -1)` exactly. Load `(ur, ui)` at complex index `base+j` and `(vr, vi)` at `base+j+half`, then perform this butterfly with f32 temporaries.

```text
tr = wr*vr - wi*vi
ti = wr*vi + wi*vr
work[base+j]      = (ur+tr, ui+ti)
work[base+j+half] = (ur-tr, ui-ti)
```

The pair notation denotes two sequential float slots. Leave the products and additions as ordinary operations with source evaluation order. The simple out-of-place alternative would need another complex buffer. The in-place permutation adds control flow and uses the same observed buffer as the butterfly. Computing roots from a recurrence would introduce a second source of numerical error and remove the read-only twiddle experiment.

### Biquad bank

Use direct form I with `a0 = 1` and the denominator convention `1 + a1*z^-1 + a2*z^-2`. Loop over the two bands. Load that band's five coefficients once, initialize `x1, x2, y1, y2` to `0.0`, and loop over the block. For input `x`, write the result below, then shift the histories with `x2 = x1`, `x1 = x`, `y2 = y1`, `y1 = y` in that order. Each call begins with fresh state.

```text
dot3(a, b, c, d, e, f) = (a*b + c*d) + e*f
feed = dot3(b0, x, b1, x1, b2, x2)
y = (feed - a1*y1) - a2*y2
```

Declare all six `dot3` parameters and its result as f32. This small helper is a natural inlining site for the feed-forward sum. Putting all five products in the loop body would leave the arithmetic window but remove that call. Keep the histories as four f32 locals. An array of histories would add storage and indexing for state that fits naturally in locals.

## Corpus files and generated cases

Create `main.typed` with the two entries and `dot3`. In `project.json` set title to “f32 DSP”, group to `Programs`, sources to `["main.typed"]`, pipeline to `speed`, and focus to the line computing `tr`. Put the kernel conventions and a short exploration of the butterflies and filter call in `notes.md`. Add `scripts/compare.js` as a fresh workbench script following Blend's `scripts/explore.js`. Supply one fixed input for each entry, compile before and after the checked pipeline, and show the emulator instruction counts. The Node test can use the APIs below to check complete guest memory.

Use these `inputs` entries directly, substituting the two packed arrays for the table placeholders. The `dot3` spec is required because ordinary projects generate cases for all functions, including helpers.

```json
{
  "fft": {
    "work": { "floats": [32, 32], "range": [-1, 1] },
    "twiddles": { "cells": "<32 u16 cells>" },
    "n": { "oneOf": [8, 16] }
  },
  "biquadBank": {
    "samples": { "floats": [16, 16], "range": [-1, 1] },
    "coefficients": { "cells": "<20 u16 cells>" },
    "output": { "buffer": [64, 64], "cell": [0, 0] }
  },
  "dot3": {
    "a": [-1, 1], "b": [-1, 1], "c": [-1, 1],
    "d": [-1, 1], "e": [-1, 1], "f": [-1, 1]
  }
}
```

For the coefficient table pack `[0.19, 0.31, 0.12, -0.37, 0.14, 0.48, -0.72, 0.24, -0.26, 0.095]` with `DataView.setFloat32(0, value, true)`, then read the two halves with `getUint16(0, true)` and `getUint16(2, true)`. Both denominator rows satisfy `abs(a1)+abs(a2)<1`, including after f32 rounding. Choose one stable bank for generation. Sampling coefficients independently would need a stability restriction, while these rows already give both feedback and cancellation. Similarly, `cells` keeps the roots fixed and avoids generating invalid twiddle tables. Explicit finite ranges keep the generated f32 inputs numerical. See [case generation](../../../../../../src/typed/evaluate.ts) and the [project reference](../../../../../../corpus/reference.md).

## Oracles and acceptance

For exact pipelines, run the ordinary per-pass gate with 40 cases per function and seed 7. It compares each changed revision against r0 using the same arguments and initial guest memory. Require no rejected passes. In the final check, require every case decided with no trap or fault, and bit-identical return and memory, including the FFT's unused tail at `n=8`. Compare r0 with the stock reference compiler using `referenceCompile` and `referenceRun`. Also compare each measured workbench image with r0 using `lowerToImage` and `runImage`. These sampled checks and the second compiler check cover different failure modes.

Build one independent numerical oracle in JavaScript with binary64 arithmetic. Decode the actual input cells before Typed mutates its copy. For FFT, compute each bin directly from the complex sum with angle `-2πkt/n`; use binary64 sine and cosine and the original samples. This catches errors shared by any two compilers of the same Typed source, including the sign and bin ordering. The smallest independent transform is the dense DFT at these sizes. For the bank, decode the actual rounded coefficient words and compute each band independently into a JS array with zero prehistory, indexing the prior input and output samples directly. This gives a direct check against an incorrectly shifted register history.

For the FFT's active float slots and for each filter band separately, compute
`20*log10(rms(actual-expected) / max(rms(expected), 1e-6))`.
RMS is the square root of the mean of squared lane errors or reference amplitudes. A zero numerator gives negative infinity. Require finite output lanes and an error of at most **−100 dB** per block or band. This is a proposed tolerance for the narrow input domain. Verify the r0 baseline fits it. Relative error per float is a simpler calculation, but bins and filter samples can be close to zero. The RMS denominator and floor make those cases meaningful. Today this oracle verifies numerical accuracy in a test alongside the exact gate. For tolerance runs, keep the integer return, all bytes outside the result region and successful completion exact. Apply the dB bound only to the active FFT output or the filter output.

## Size, probe and integration

At size 16 the FFT reverses at most 64 individual bits, swaps six pairs and executes 32 butterflies in 15 groups. The bank executes 32 filter steps and makes 32 helper calls. A budget of 20 lifted statements per bit step, 50 per swap, 80 per butterfly and 500 for loop setup and transitions gives an FFT planning estimate below 5,000 statements. Allowing 70 per filter step including the helper and 250 for overhead gives a bank estimate below 2,500. The evaluator counts lifted statements across calls. Check the estimates with actual runs at both FFT lengths and require the measured kernels and their checked revisions to complete within the unchanged 20,000-statement cap.

A small probe used `tools/node-vendor.mjs`, `projectSource` and `Program.fromProject` to ingest float loads and stores, an i32 loop with division and bit operations, and a six-f32 helper. Each function agreed on 10 generated cases with the reference and workbench RV32 runners. The explicit packed-buffer call took 81 evaluator statements and returned the expected cells. Binding the probe's scalar length and running `speed` produced 11 revisions with zero rejections and retained 10/10 exact and RV32 agreement per function. These are feature probes. The sizing estimates above are for the proposed kernels.

The generic `tools/reference-check.mjs` currently wraps the reference image without passing signatures. The probe exposed this on the standalone f32 helper. For corpus integration, keep the tool's reference compilation policy and delegate its reference runs to the existing signature-aware `referenceRun`. The case generator and project metadata already support this project.

## Implementation and measurement

1. Add the corpus files and pack both tables into the metadata. Ingest the project at r0 and run the FFT and biquad against the numerical oracle. Include a shifted complex impulse at both FFT sizes to exercise phase and bin order, a filter impulse to exercise the feedback history, and silence for both kernels. Run the generated cases and check their statement counts.
2. Run the checked `speed` pipeline and the exact comparisons in both RV32 paths. Use fresh copies of guest memory for each image. Use the stock reference only as an oracle.
3. Measure executed RV32 instructions per call for the general r0 and general `speed` images. Use the same backend options for both, with `chains`, `coalesce` and `homes` enabled. Report the FFT counts by size and the bank count separately.
4. On a fresh copy, use `createArtifact(BindingsIR, ...)` and `Program.specialize` with `{ fn: "fft", param: "n", value: 16, entity: "f32-dsp#fft16" }`. Rerun `speed` under the resulting narrowed case spec and compare general and specialized images on identical size-16 inputs. This isolates scalar specialization. Inspect the pipeline edits for what actually folds.

## Later

- Constant-memory specialization could fold twiddle and coefficient loads when table bytes and addresses become known.
- Fused multiply-add emission could contract a multiply and add to one rounding.
- A tolerance acceptance path could permit reassociation and contraction under the DSP dB bound.
