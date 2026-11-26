---
Title: f32 DSP corpus project
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
    - Path: repo://corpus/candela-gallery/kernel.typed
      Note: Working examples of f32 math and buffer arguments
    - Path: repo://corpus/reference.md
      Note: Project metadata, generated input specs and inspection APIs
    - Path: repo://src/typed/evaluate.ts
      Note: Case generation, step budget and bit-preserving meaning check
    - Path: repo://src/typed/lift.ts
      Note: Typed tape lowering for binary32 arithmetic and checked memory access
    - Path: repo://src/typed/passes.ts
      Note: Pipeline definitions for the exact baseline and speed experiments
    - Path: repo://src/typed/specialize.ts
      Note: Current bindings and the boundary of memory specialization
    - Path: repo://tools/reference-check.mjs
      Note: Reference compiler and RV32 emulator comparison pattern
ExternalSources: []
Summary: Design for an in-place binary32 FFT and a parallel biquad bank with bitwise and numerical oracles.
LastUpdated: 2026-11-26T10:34:36.554729446-05:00
WhatFor: Implement a small DSP corpus project for exact, specialized, and tolerance-checked optimization.
WhenToUse: When building or measuring the f32 DSP optimization playground.
---

# f32 DSP corpus project

Add one Typed project, `corpus/projects/f32-dsp/`, with a radix-2 FFT and a bank of two parallel biquads. Measure the kernels separately. Keep the FFT's butterfly helper and the bank's explicit state updates so the baseline gives the compiler calls, loops, copies and f32 expression trees to work on. The FFT size and filter coefficients come from input buffers so the same source can run with dynamic data or with those bytes bound for specialization.

## Typed interface

A `buffer` has a 32-bit length in u16 cells. Pack each f32 as low u16 then high u16. Typed's `getF32(i)` and `setF32(i,x)` access a word at byte offset `4 + 4*i` and check cell `2*i+1`. These operations, buffer arguments and `Math.sqrt` are used in the [Candela kernel](../../../../../../corpus/candela-gallery/kernel.typed) and lower to checked addresses and f32 operations in [lift.ts](../../../../../../src/typed/lift.ts).

| Function | Valid inputs | Observable result |
| --- | --- | --- |
| `fft(work: buffer, config: buffer): i32` | `work` has 64 f32s. `config.charCodeAt(0)` is `log2N` in 3–5, stored in a one-cell buffer. | Return `N = 1 << log2N` and replace the first `2*N` f32s. Complex sample or bin `i` occupies f32 indices `2*i` and `2*i+1`, real first. |
| `biquadBank(signal: buffer, coeff: buffer, out: buffer): i32` | `signal` has `T = signal.length / 2` f32s for `T` in 0–32. `coeff` has 10 f32s and `out` has 64. | Return `T` and write the prefix of `2*T` f32s, one contiguous block of `T` per section. |
| `butterfly(work: buffer, left: i32, right: i32, wr: f32, wi: f32): i32` | Same work layout, distinct complex indices in 0–31 and an f32 twiddle. | Replace the two complex values and return 0. |

The host provides buffers of the stated shapes and disjoint allocations for distinct parameters. All bytes outside each function's output region are preserved, including headers, read-only inputs and any unused output tail. For an empty signal the bank returns 0 and writes no output.

## Iterative FFT

Compute the forward unnormalized transform in natural bin order. Reverse the low `log2N` bits of each sample index with a shift-and-OR loop, then swap the corresponding complex values if the original index is smaller than its reversal. Load both samples before storing either one.

Use decimation in time with a stage root `(c,s)` and a twiddle `(wr,wi)`. Initialize `(c,s)` to `(-1.0,0.0)` for span 2. For each later stage take the half angle using the preceding `c`. Calculate both new components before assigning either one. All operations below use f32 for the complex arithmetic.

```text
for m = 2; m <= N; m = m * 2:
    if m > 2:
        newC = Math.sqrt((1.0 + c) * 0.5)
        newS = -Math.sqrt((1.0 - c) * 0.5)
        (c, s) = (newC, newS)
    (wr, wi) = (1.0, 0.0)
    for j = 0; j < m / 2; j = j + 1:
        for left = j; left < N; left = left + m:
            butterfly(work, left, left + m / 2, wr, wi)
        nextR = wr*c - wi*s
        nextI = wr*s + wi*c
        (wr, wi) = (nextR, nextI)
```

The butterfly loads `(ur,ui)` at the left and `(vr,vi)` at the right. Compute `tr = wr*vr - wi*vi` and `ti = wr*vi + wi*vr`, then store `(ur+tr,ui+ti)` and `(ur-tr,ui-ti)`. Call the helper at statement root, for example as `const done = butterfly(...)`, for inlining. With a fixed size, staging the loops can fold the twiddles. Exact specialization must reproduce the baseline's f32 operation order and rounding, including signed zero.

## Parallel biquads

Each section reads one coefficient row `[b0,b1,b2,a1,a2]` at f32 offset `5*section` before its sample loop and processes the same signal from zero initial state. Use scalar f32 locals for the coefficients and the delay state. Keep the direct form I evaluation order explicit:

```text
y = ((((b0*x + b1*x1) + b2*x2) - a1*y1) - a2*y2)
out.setF32(section*T + t, y)
x2 = x1
x1 = x
y2 = y1
y1 = y
```

Initialize `x1,x2,y1,y2` to `0.0` for each section. Generated coefficients satisfy `|a1|+|a2| <= 0.5`, giving a bounded feedback response for the generated signal. The two sections exercise runtime coefficient selection and distinct output blocks.

## Project files and cases

Put the functions in `main.typed`, buffer packing and replay instructions in `notes.md`, and the raw replay, independent oracle and measurement in one Node script, `scripts/check.mjs`. The project directory is discovered by [tools/corpus.mjs](../../../../../../tools/corpus.mjs). Check corpus-wide tests for expected totals that count projects. Use [corpus/reference.md](../../../../../../corpus/reference.md) for the metadata and input format.

```json
{
  "title": "f32 DSP",
  "group": "Programs",
  "pipeline": "speed",
  "focus": 1,
  "inputs": {
    "fft": {
      "work": { "floats": [64, 64], "range": [-1, 1] },
      "config": { "buffer": [1, 1], "cell": [3, 5] }
    },
    "biquadBank": {
      "signal": { "floats": [0, 32], "range": [-1, 1] },
      "coeff": { "floats": [10, 10], "range": [-0.25, 0.25] },
      "out": { "buffer": [128, 128], "cell": [42405, 42405] }
    },
    "butterfly": {
      "work": { "floats": [64, 64], "range": [-1, 1] },
      "left": [0, 15],
      "right": [16, 31],
      "wr": [-1, 1],
      "wi": [-1, 1]
    }
  }
}
```

Set `focus` to the butterfly product line once the source exists. The default checker includes the helper. Its spec guarantees distinct indices, and internal calls exercise the other index pairs. Because argument specs generate independently, the work and output buffers reserve maximum capacity. The output sentinel makes missing stores and tail writes visible. For specialization, use `{ "cells": [5] }` for a 32-point FFT and freeze one generated bank's coefficient cells. Reuse those bytes for the general and specialized runs, with fresh variable signals.

## Correctness

Generate the inputs once with [casesFrom](../../../../../../src/typed/evaluate.ts) and start each engine from the same original bytes. Use `Case.items` and a little-endian `DataView` to decode raw memory. The workbench preview clips buffer contents.

- **Exact.** Leave the per-pass `meaningKept` gate on. For each measured exact revision, replay the generated and fixed cases against r0 and the stock reference RV32 image, using `referenceCompile` and `referenceRun` from [reference.ts](../../../../../../src/typed/reference.ts). Require successful termination, equal integer returns and byte identity over the entire guest memory, including signed zeros and NaN payloads. The standalone butterfly uses the reference signature to place its f32 arguments. See [reference-check.mjs](../../../../../../tools/reference-check.mjs) for the same-case comparison pattern.
- **Float64 oracle.** Decode the original f32 inputs and coefficients and compute in JavaScript `Number`. For the FFT, independently compute every bin by summing `(xr + i*xi) * (cos(2πkt/N) - i*sin(2πkt/N))` over input index `t` for bin `k`. For each bank section use transposed direct form II with `z1 = z2 = 0`. At each sample compute `y = b0*x + z1`, then `nextZ1 = b1*x - a1*y + z2` and `nextZ2 = b2*x - a2*y` before updating the state.
- **Tolerance.** Require finite outputs, the expected integer return and byte identity outside the active output. For each FFT's interleaved vector and each biquad section's output vector, compute `20*log10(max(abs(got-ref))/max(rms(ref),1e-3))`. Start with a bound of −100 dB per vector. Here `rms(ref)` is the square root of the mean squared reference values. Zero error gives −∞ dB. For empty vectors check the return and untouched bytes. Validate the proposed bound against r0 first. Diagnose any baseline miss before revising the budget. Compare each tolerance candidate and its final RV32 image directly with the same float64 reference. Use a genuine single-rounding FMA when measuring contraction.

Outside the generated cases, replay a shifted impulse and a complex bin-centered tone at each FFT size to expose bin order, phase and scaling. For the bank replay an empty block and a 32-sample impulse through distinct coefficient rows. Put signed zeros, subnormals, infinities and a non-canonical NaN into raw-word exact-only cases for both kernels. One additional finite bank case distinguishes exact and tolerant modes. Set `x[0] = 1`, `x[1] = 1 - 2^-23`, `b0 = (1 + 2^-23)/8`, `b1 = -1/8` and the other coefficients in section 0 to zero. At sample 1, separately rounding `b0*x` gives a sum of zero. Fusing that product with `b1*x1` gives `-2^-49`, a bit difference within the numerical budget.

## Step budget

At N = 32 the FFT executes at most 160 bit-reversal iterations, 32 outer reversal iterations, 80 butterflies and 31 twiddle updates across five stages. Allowing 10, 25, 50 and 20 lifted statements respectively, plus 250 for stage setup, puts the estimate under 7,300 statements. The bank runs at most 64 sample iterations. Allowing 30 statements each plus 200 for section setup gives about 2,100. These are estimates for a 20,000-statement limit. Measure the maximum-size cases at r0 and after each changed pass, counting the butterfly calls, and keep the worst observed case under 10,000 with zero inconclusive cases.

## Experiments and implementation order

| Work | Experiment |
| --- | --- |
| IRWB-003 | Measure butterfly inlining and loop rotation in `speed`. Compare it with the backend's `chains`, `coalesce` and `homes` enabled together to expose the cost of branches, state copies and f32 constant materialization. |
| IRWB-006 and IRWB-008 | Trace SSA definitions of the twiddle and filter state. Inspect evidence for exact constant folds and guarded rules. The sampled agreement gate and rule evidence answer different questions. |
| IRWB-007 | Bind the config or coefficient buffer header and bytes per entry. Require the bound region to be read-only and disjoint from writable data. Check within that binding against r0 and measure removed loads and twiddle work. Fixed generator cells supply test cases. Memory proof and staging require compiler support beyond current scalar bindings. |
| IRWB-010 | Use the butterfly products and biquad sum for rule discovery, equality saturation or RV32 window search. Keep loads and stores outside the first search windows and use the exact edge cases to test candidate identities. |
| IRWB-011 | Compare reassociation and multiply-add contraction. Record changed output words, worst numerical error and executed instructions. |

1. Add the files and lift `main.typed` through `Program.fromProject`. Confirm checked f32 accesses, the statement-root butterfly call and the bank state updates. Check the output spans and tails with the fixed cases.
2. Implement the replay and oracle, record r0's numerical error and verify the step headroom. Run O0, O2 and `speed` on the same cases with default backend options, plus the separate stock reference image. Require exact agreement with zero unexpected traps, faults or limits. Pin the seed or fixture bytes and record each revision, options, instructions per call by N or T, and image bytes.
3. Compare the extra speed backend options, then add specialization and tolerance runs when supported. Report the worst dB error with its case and component and compare general and specialized images on the same restricted cases.

## Cuts from self-review

- Removed the third biquad because two sections already exercise distinct coefficient rows and output blocks.
- Packed each section at stride `T` so each call has one contiguous output prefix and one sentinel tail.
- Replaced invalid-input returns and their tests with host shape preconditions because this corpus measures valid DSP calls.
- Replaced the special span-4 branch and sine division with one half-angle update for all stages after span 2.
- Reused a generated coefficient bank for specialization because an extra hand-picked table adds no coverage to the paired speed comparison.
- Removed the workbench exploration script and redundant metadata because one raw Node replay covers the measurements.
- Dropped the standalone butterfly oracle and alternate reference-run route because the two kernel oracles and signature-aware exact replay cover the helper.
- Replaced the RMS and peak gates with one peak-error bound scaled by reference RMS, which also bounds RMS error.
- Trimmed overlapping fixtures and sampling schedules because generated cases plus targeted endpoints, spectral fixtures and the FMA witness cover the relevant failures.
- Condensed the step worksheet into a sizing estimate and measured headroom check because lifted counts determine acceptance.
- Dropped guarded specialization, the hand-tuned sibling project and exhaustive backend ablations because paired images already measure the proposed changes.
- Removed the repeated reference section and duplicate reporting requirements because implementation links and result fields live next to the steps that use them.
