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

Add one project, `corpus/projects/f32-dsp/`, with two independently callable workloads. The FFT converts a short complex block to its spectrum. The biquad bank runs three second-order filters in parallel on the same real block. Keeping the calls independent gives each kernel its own inputs, oracle and instruction count. The baseline should read like ordinary DSP code with a butterfly helper, straightforward loops and a written-out difference equation. The compiler can then remove call and loop overhead, reuse registers and specialize on configuration data. The same source can also show where single-rounding and reassociation first change the output bits.

## Entry points and memory

Use `buffer` parameters. A buffer has a 32-bit length in u16 cells, followed by the cells. The built-in `getF32(i)` and `setF32(i, x)` read and write one binary32 value at byte offset `4 + 4*i`, checking cell `2*i + 1`. Pack each f32 as the low u16 followed by the high u16. Use `charCodeAt(0)` for the FFT's integer configuration cell. All lengths in the table are values of Typed's `.length`.

| Function | Buffers and valid lengths | Writes and return |
| --- | --- | --- |
| `fft(work: buffer, config: buffer): i32` | `work` is 128 cells, enough for 32 interleaved complex samples. `config` is one cell containing `log2N` in 3–5. | Replace the first `N = 1 << log2N` complex samples in place. Return `N`. Preserve the work tail and config. |
| `biquadBank(signal: buffer, coeff: buffer, out: buffer): i32` | `signal` has an even length from 0 to 64 cells, so `T = signal.length / 2` is 0–32. `coeff` is 30 cells for 15 f32 coefficients. `out` is 192 cells for 96 f32 values. | Write `T` samples per section at f32 indices `32*section + t`. Return `T`. Preserve signal, coeff and the unused tail of each section. |
| `butterfly(work: buffer, left: i32, right: i32, wr: f32, wi: f32): i32` | `work` has the same complex layout. The helper's caller provides two distinct, in-range complex indices and a complex twiddle. | Write both complex results. Return 0. |

The host supplies disjoint allocations for distinct buffer parameters. Both public kernels check the lengths before accessing any elements. The FFT checks the exponent before shifting. On an invalid length or exponent they return `-1` and leave all guest bytes alone. A zero-length signal returns 0 with no writes. A standalone butterfly call has the index precondition in the table and the built-in checked accesses. Keep the coefficient range and non-aliasing requirements in the host fixtures.

Use ordinary f32 expressions, annotated f32 locals where helpful, and `0.0`, `1.0` and `0.5` for float literals. Typed supports buffer loads and stores in the vendored front end's `floatAddress` and `bufferWrite`, used in [Candela's glue](../../../../../../corpus/candela-gallery/glue.typed) and [kernel](../../../../../../corpus/candela-gallery/kernel.typed). The kernel also demonstrates `Math.sqrt` and buffer arguments to helpers. The [lifter](../../../../../../src/typed/lift.ts) lowers f32 loads and stores and maps the arithmetic and square root to f32 IR ops. The two kernels only need scalar locals, loops and checked buffers. Their work space is the caller's memory and their call depth is bounded by the butterfly call.

## FFT

Compute the forward, unnormalized, radix-2 decimation-in-time transform, with natural bin order and negative imaginary phase. A complex sample at index `i` has real and imaginary components at f32 indices `2*i` and `2*i+1`. First reverse the low `log2N` bits of each index with an ordinary shift-and-OR loop. Swap the two complex samples when `i < reverse(i)`, loading both samples before storing.

In each stage of span `m`, form the root `exp(-2πi/m)`. Start with `(-1.0, 0.0)` for span 2 and `(0.0, -1.0)` for span 4. For each later span, halve the previous angle by computing `newC = Math.sqrt((1.0 + c) * 0.5)` and `newS = s / (2.0 * newC)`, then replacing `(c,s)`. This uses the sine double-angle identity and keeps the denominator nonzero. All operations, including root setup and recurrence, round in f32.

```text
for m = 2; m <= N; m = m * 2:
    (c, s) = root for this stage, as specified above
    (wr, wi) = (1.0, 0.0)
    for j = 0; j < m / 2; j = j + 1:
        for left = j; left < N; left = left + m:
            right = left + m / 2
            butterfly(work, left, right, wr, wi)
        nextR = wr*c - wi*s
        nextI = wr*s + wi*c
        (wr, wi) = (nextR, nextI)
```

The butterfly loads `(ur,ui)` at `left` and `(vr,vi)` at `right`. Compute `tr = wr*vr - wi*vi` and `ti = wr*vi + wi*vr`, then store `(ur+tr,ui+ti)` to the left and `(ur-tr,ui-ti)` to the right. Load both operands before any stores. Call the helper at statement root, for example `const done = butterfly(...)` with the result unused, so it is an inlining candidate. Each stage computes a twiddle once per column and shares it among groups. Fixing the size cell lets partial evaluation resolve the stage and column loops and precompute the twiddles. For exact folding, reproduce the f32 recurrence and preserve its bits, including signed zero. Recalculating a twiddle by taking a float64 sine and cosine and rounding once may produce different bits.

## Biquad bank

The sections are parallel, each with zero initial state per call and the same input. Each row in `coeff` contains `[b0,b1,b2,a1,a2]` for a monic denominator `1 + a1*z^-1 + a2*z^-2`. Run one section at a time. Read its five coefficients before its sample loop, keep `x1,x2,y1,y2` as the previous two inputs and outputs, and use the direct form I equation in this order:

```text
y = ((((b0*x + b1*x1) + b2*x2) - a1*y1) - a2*y2)
out.setF32(section*32 + t, y)
x2 = x1
x1 = x
y2 = y1
y1 = y
```

Make each state local f32 and initialize it to `0.0`. The feedback uses the just-computed f32 output on the next sample. The copy assignments make the state progression readable and give copy coalescing and SSA a real loop-carried example. Generated banks use coefficients in `[-0.25,0.25]`, so `|a1|+|a2| <= 0.5`. With bounded input and zero initial state this gives a convergent feedback bound. A fixed bank for replay and specialization uses these rows, in order:

```text
[0.25,  0.125,  0.0625, -0.25,  0.125]
[0.125, 0,     -0.125,   0.25, -0.125]
[0.25, -0.25,   0.125,  -0.125, 0.25]
```

## Corpus files and generated cases

Put the three functions in `main.typed`. Put the layout, two run examples and the exact versus tolerance contract in `notes.md`. Use `scripts/explore.js` for workbench inspection, showing a small FFT or a short biquad block and the hot lines before and after `speed`. Put the full numerical reference, case replay and measurement in an executable Node script under `scripts/`, with the main entry documented in `notes.md`. The Node script works over the raw run objects. The workbench's `p.exec()` truncates displayed buffer cells, so its preview alone would miss part of the FFT or filter output. Node discovers the new directory through [tools/corpus.mjs](../../../../../../tools/corpus.mjs). During implementation, check for corpus-wide assertions whose expected totals include the newly discovered project, such as the full comparison in [rules.test.mjs](../../../../../../tests/typed/rules.test.mjs).

Start with this `project.json`. Update `focus` to the actual butterfly product line in the joined source when writing `main.typed`.

```json
{
  "title": "f32 DSP",
  "group": "Programs",
  "about": "A short complex FFT and a parallel biquad bank in f32.",
  "sources": ["main.typed"],
  "pipeline": "speed",
  "focus": 1,
  "scripts": {
    "explore": { "about": "Inspect a DSP block and its hot instructions.", "fresh": true }
  },
  "inputs": {
    "fft": {
      "work": { "floats": [64, 64], "range": [-1, 1] },
      "config": { "buffer": [1, 1], "cell": [3, 5] }
    },
    "biquadBank": {
      "signal": { "floats": [0, 32], "range": [-1, 1] },
      "coeff": { "floats": [15, 15], "range": [-0.25, 0.25] },
      "out": { "buffer": [192, 192], "cell": [42405, 42405] }
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

`casesFrom` generates each parameter separately. Fixed work capacity makes every combination of generated size and work buffer valid. All functions get specs because the ordinary project checks include the helper. A `floats` length counts f32 elements and a `buffer` length counts u16 cells. The explicit float ranges keep nonfinite values out of the numerical domain. The sentinel in `out` makes omitted stores and overruns visible. Replay a fixed config as `{ "cells": [5] }` and a fixed coefficient bank as `{ "cells": [low0, high0, ...] }` with the placeholders replaced by packed words. Use the same signal and work cases for general and specialized images. See [the API reference](../../../../../../corpus/reference.md) and the [actual input generator](../../../../../../src/typed/evaluate.ts).

## Exact and numerical checks

Generate each case once and use a fresh copy of its argument memory for every run. Decode input from the original bytes with a little-endian `DataView`; use `Case.items` to locate buffers. Compare return values and status exactly. For successful exact calls, compare the raw guest memory byte for byte against r0, including the output f32 bit patterns, buffer headers and unused bytes. This detects signed-zero and NaN payload differences. Run every changed exact pass through the normal r0-based `meaningKept` gate, and replay fixed cases outside the default generator as well. Separately require valid cases to succeed, since the generic comparator can agree on two traps. Invalid public inputs must produce the specified `-1` and unchanged memory.

Use the reference compiler's stock RV32 image as the second exact oracle. Follow [tools/reference-check.mjs](../../../../../../tools/reference-check.mjs) for same-case evaluator/image comparison. Use `referenceCompile` and `referenceRun`, or pass `ref.signatures` to `imageFromCode` as in the [f32 backend tests](../../../../../../tests/typed/f32-backend.test.mjs), because the standalone butterfly uses float argument registers. Compare r0 evaluator, reference RV32, and workbench RV32 at each measured exact revision on the same bytes. Record the first differing result or byte, whether there was a trap or an ABI fault, and the case seed and index.

In addition, compute an independent float64 result in JavaScript using the decoded binary32 inputs and coefficients. Keep all arithmetic in JS `Number` through the comparison.

- **FFT** computes a direct DFT in O(N²). For each bin `k`, sum `(xr + i*xi) * (cos(2πkt/N) - i*sin(2πkt/N))` over input indices `t`. Check the real and imaginary parts of every bin. This catches ordering, phase, normalization and in-place overwrite errors independently of bit reversal or the f32 twiddle generator.
- **Biquads** use transposed direct form II in float64 with `z1 = z2 = 0` for each section. For each sample compute `y = b0*x + z1`, then `nextZ1 = b1*x - a1*y + z2` and `nextZ2 = b2*x - a2*y`. Commit the new state after both calculations and compare every `y` at the section's output index.
- **Standalone butterfly** can use a fixed-case direct complex multiply and complex sum/difference in JS for layout tests. The tolerance measurements are for the two public kernels. Every butterfly they call is observed through their output.

For finite-domain cases, form one real vector per FFT (the `2*N` interleaved components) and one vector per biquad section (the `T` samples). For each vector set `e = got - ref`. Use these starting acceptance budgets, checked independently for each vector:

```text
rmsDb  = 20*log10(rms(e)  / max(rms(ref), 1e-3)) <= -100 dB
peakDb = 20*log10(peak(e) / max(peak(ref), 1.0))  <=  -90 dB
```

`rms(v) = sqrt(sum(v[i]^2)/v.length)` and `peak(v) = max(abs(v[i]))`. Zero error is negative infinity dB. An empty vector has no numerical score and must produce no writes. The floors give defined error limits near silence. The peak limit catches a single bad bin or sample that a block average could hide. Require finite reference and candidate outputs, the expected integer return, no traps, faults or limits, and byte identity with r0 outside the active output regions. Report the worst dB scores and the corresponding case, section and index. Measure r0 against these proposed budgets first. If r0 misses, diagnose the formula, indexing and twiddle rounding before revisiting and documenting a budget.

For a future tolerance pipeline, compare every tolerance candidate and its final RV32 image directly against the same float64 oracle. An exact pass after a tolerance edit can check against that accepted revision for bit preservation and still run the end-to-end numerical check. Keep the tolerance result and its policy with the image. Use actual single-rounding emulator FMA for the FMA experiment when the backend can emit it. The existing backend option `fuse` fuses comparisons into branches.

## Step budget

The checker counts executed lifted statements, including helper bodies, with a limit of 20,000 per case. Use the bounds below as planning estimates. Inspect the actual lifted listing and count the maximum case at r0 and after each changed pass, since buffer addressing and loop lowering can introduce statements.

| Work at the maximum size | Count | Allowance for planning |
| --- | ---: | ---: |
| FFT bit reversal outer iterations and potential swaps | 32 | 25 statements per outer iteration |
| FFT reversal bit iterations | 160 | 10 each |
| FFT butterfly calls, including caller control and callee loads/stores | 80 | 42 each |
| FFT twiddle updates | 31 | 18 each |
| FFT stage setup, guards and exit | 5 stages | 225 total |
| Biquad sample iterations | 96 | 25 each |
| Biquad section setup, guards and exit | 3 sections | 175 total |

The estimates are roughly 6,550 statements for a 32-point FFT and 2,575 for a 32-sample bank. Verify that the worst measured case stays under 10,000 for headroom and that all generated checks decide. Test FFT size 32 explicitly, using values that distinguish the permuted positions, and test the 32-sample bank. Use evaluator counts for this check and RV32 instruction counts for speed. A limit hit is inconclusive in the framework and fails the corpus sizing check.

## Optimization experiments and measurements

| Work item | What to inspect in this project |
| --- | --- |
| IRWB-003 | Compare `speed` with O2 on the butterfly call, rotated loops, samples' state copies and repeated f32 constants. Test `chains`, `coalesce` and `homes` as backend switches. |
| IRWB-006 and IRWB-008 | Follow the SSA definitions of phase and sample state. Track exact constant folds and guarded rewrite provenance. Check the result bytes on generated and edge cases. Treat sampled checks and independently demonstrated exact rules as distinct forms of evidence. |
| IRWB-007 | Specialize `fft` on config length and cell value and `biquadBank` on coefficient length and 15 exact words. Test whether staging removes config loads and twiddle calculations, and whether section specialization removes coefficient loads. Keep signal values dynamic. |
| IRWB-010 | Start search in the pure butterfly products and the biquad sum windows, with loads and stores at their boundaries. Inspect rule evidence and the selected RV32 cost. Test exact f32 identities with their guards and exercise cancellation and special values to find invalid rewrites. |
| IRWB-011 | Try reassociation and multiply-add contraction one site or rule family at a time. Count changed output words on the exact replay and report independent dB scores, including the last biquad samples where feedback has had time to propagate. |

Memory specialization follows IRWB-007's proposed per-entry promise. Freeze the headers and contents of `config` or `coeff`, require disjoint writable data and show that no store can change the frozen region. Check specialized revisions on fresh cases within that binding against the original r0 with the same frozen bytes. Report any specialization guard and fallback cost if testing a guarded version. The current `specialize.ts` binds scalar parameters or integer record fields. Changing a generator spec to fixed cells supplies test data and does not itself establish memory facts for a pass. Budget code growth when staging loop iterations. Record which loads, stage computations and branches were removed and the corresponding fact or edit evidence.

Measure O0, O2 and `speed` with identical backend options first. Then compare the `speed` image with each of `chains`, `coalesce` and `homes` enabled individually and together. Include the stock reference image, general versus specialized images on identical restricted cases, and any tolerance image that passes the numerical gate. Report instructions per FFT at each N and per bank block at T = 0, 1, 8, 16 and 32. For T > 0 also report instructions per sample per section. Report median and max for generated cases, image bytes, spill slots or spill instructions, and hot lines where counts move. Keep fixture bytes or a seed plus case spec and record the revision and backend options. A later hand-optimized ceiling can live in a separate project with fixed f32 twiddles and coefficient rows, identical output packing and the same oracle for the applicable contract.

## Implementation order and acceptance

1. Add the corpus files and smoke-check the actual frontend through `Program.fromProject`. Confirm that the butterfly call, f32 operations, checked addresses and stores appear in the IR. Verify the no-write error paths and packed buffer layout.
2. Build the Node reference and raw replay. For FFT use silence, DC, impulses at index zero and a nonzero index, and a complex bin-centered tone at every size. For the bank use silence, impulse, step, alternating signs and a fixture that distinguishes the sections. Sweep T = 0, 1, 8, 16 and 32 with sentinel tails. Require r0 to match both the analytical fixtures and the float64 budgets. Include wrong-size buffers, an invalid exponent and an odd signal length for the error paths.
3. On top of generated cases, replay signed zero, subnormal, infinities and a non-canonical NaN as raw words in exact-only cases. Include a finite FMA witness in section 0 using `x[0] = 1`, `x[1] = 1 - 2^-23`, `b0 = (1 + 2^-23)/8`, `b1 = -1/8` and the other coefficients zero. At sample 1 the first separate multiply/add gives zero, while contracting `b0*x + b1*x1` gives `-2^-49`. Check that a candidate making this contraction changes the bits and stays within the numerical budget for that fixture. Preserve the witness in the fixed replay, since uniform cases may miss it.
4. Require zero unexpected traps, faults or inconclusive cases for r0, O2 and `speed`. Check exact agreement with both RV32 images and capture the evaluator step maxima. Record the initial instruction counts and size measurements.
5. Add specialization and tolerance measurements as the relevant compiler support becomes available. Use the replay and the same workload sizes to judge those changes, so a new optimization can be compared with the initial measurements without changing the signal or the checker.

## Repository references

- [Corpus input and inspection API](../../../../../../corpus/reference.md), [histogram project](../../../../../../corpus/projects/histogram/project.json), and [Candela's Typed math](../../../../../../corpus/candela-gallery/math.typed).
- [Exact case generation and agreement](../../../../../../src/typed/evaluate.ts), [binary32 operation semantics](../../../../../../src/typed/f32.ts), [pipeline definitions](../../../../../../src/typed/passes.ts), and [reference execution](../../../../../../src/typed/reference.ts).
- [IRWB-003](../../../25/IRWB-003--closing-the-speed-gap-inlining-copy-coalescing-float-constants-in-registers-loop-rotation/index.md) and [IRWB-006](../../../25/IRWB-006--rewrite-rules-as-verified-data-and-a-single-assignment-view-of-typed-blocks/index.md).
- [IRWB-007](../../IRWB-007--specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory/index.md), [IRWB-008](../../IRWB-008--exact-checking-for-edits-that-cite-verified-rules-and-version-2-of-the-meaning-check-as-the-standard-for-new-pipelines/index.md), [IRWB-010](../../IRWB-010--sketch-rewrite-search-on-ssa-and-verified-rules-rule-discovery-equality-saturation-a-window-superoptimizer/index.md), and [IRWB-011](../../IRWB-011--sketch-image-level-contracts-for-float-freedom-tolerance-contracts-judged-on-rendered-frames/index.md). The IRWB-007 guide was consulted at `69ae7a0` and the IRWB-010 and IRWB-011 guides at `d0e6415`.
