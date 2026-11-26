---
Title: 'Sketch guide: image-level contracts for float freedom'
Ticket: IRWB-011
Status: active
Topics:
    - compiler
    - ir
    - candela
    - verification
    - research
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'Intern-grade sketch: why every float result is bit-exact today, IEEE-754 rounding and what reassociation, contraction and reciprocals change, Monte Carlo noise and statistical tests from scratch, the measured noise floor of eight Candela scenes, three measured float transformations judged against it, the design space of a tolerance contract kept apart from the exact pipelines, first experiments and open questions.'
LastUpdated: 2026-11-26T10:02:52.895528747-05:00
WhatFor: ""
WhenToUse: ""
---

# Sketch guide: image-level contracts for float freedom

Every float result this compiler produces is bit-identical to the original program's. That is a strength: every Candela frame rendered from an optimized program is bit-identical to the reference compiler's frame, and the meaning check never has to ask "how wrong is acceptable". It is also a limit. The standard float speedups (fusing a multiply and an add into one instruction, reassociating sums, replacing a division by a multiplication with the reciprocal) all change the last bit of some results, so the bit-exact contract rejects all of them, by design.

This guide records a direction for lifting that limit without weakening the exact pipelines. The idea is a **tolerance contract** judged on what the program is for. For Candela that is the rendered frame. A pass would be accepted when the frames it produces stay within a measured bound of the original's, instead of when every call returns the same bits. The bound needs a principled source, and Candela supplies one. It is a Monte Carlo renderer, so its frames already differ from one random seed to the next, and that difference can be measured. A compile-time error that is small against the renderer's own noise is a defensible trade; one that is not, is not.

This is a **sketch**. Nothing is implemented. The ticket measured the noise floor of eight scenes and three float transformations against it, and those numbers are the core of the guide. Part 1 explains the parts of the system involved. Part 2 gives the background from scratch: IEEE-754 rounding, Monte Carlo estimation, image metrics and statistical tests. Part 3 reports the measurements. Part 4 lays out the design space, Part 5 the first experiments with criteria to continue or stop, and Part 6 the risks, open questions and connections to the other tickets.

**Conventions.**

- **Paths are relative to the repository root.** A number after a colon is a line number at commit `a4beda6`.
- **Everything in Part 1 exists in the code.** Anything that does not is marked **Proposed**.
- **Numbers cite their source.** This ticket's measurements are scripts in `ttmp/2026/11/26/IRWB-011--*/scripts/` with outputs in `various/` beside them; the diary in `log/` records the exact commands. Other numbers cite the IRWB-001, IRWB-005 and IRWB-006 diaries. IRWB-005 is not merged; it was read at commit `d9cf4e9`.

> **The direction in one screen.**
> - **Today every float is exact.** The evaluator defines each f32 operation bit for bit, the backend never fuses, and the meaning check compares bits. The gallery's own C core is compiled with `-ffp-contract=off` "so the device and the host round alike".
> - **The renderer's noise is large.** One pass against another differs by 8.0–17.4 dB PSNR on the displayed image, and two 16-pass accumulations by 10.8–30.5 dB, depending on the scene (section 9).
> - **The proposal** is a contract judged on rendered frames, per scene, at the accumulation depth the gallery displays. It uses two comparisons: a paired one with the same seeds, which detects small systematic changes, and an independent one with different seeds, which asks whether the candidate is the same estimator. It lives in its own pipelines and its own revisions, and never in O2.

# Part 1: The parts of the system you need

## 1. The compiler, and where exactness is enforced

The project compiles **Typed** (a statically typed subset of JavaScript) to **RV32** machine code with the single-precision float extension RV32F. Programs pass through a chain of checked artifacts:

```text
 source ──lift──► typed.blocks r0 ──passes──► rN ──backend──► rv32.image ──emulator──► results, frames
                       │                       │                    │
                       │   typed.meaning-kept: rK vs r0, bit-equal results on generated cases
                       │                       │   rv32.image-agrees: evaluator(rN) vs emulator(image), bit-equal
                       └──────────── Candela frames: every output float bit-identical to the reference ─────┘
```

Exactness is enforced at three places, and a tolerance contract has to say what happens at each:

1. **Per pass.** `meaningKept` (`src/typed/evaluate.ts:587`) evaluates r0 and the candidate on generated cases and compares with `agrees` (`evaluate.ts:554`), which requires equal results and equal written memory. For f32 results that is equality of bit patterns.
2. **Per image.** `imageAgrees` (`src/typed/backend/run.ts:365`) compares the evaluator on the revision with the emulator on the image, again bit for bit.
3. **Per frame.** When a Candela revision is rendered, every output float is compared with the reference compiler's frame. IRWB-001 recorded zero differing floats for every comparison it made: B-01 at stride 4 from r0, from the O2 head and from this compiler's own image (diary steps 17 and 23), and all 18 per-scene programs at stride 8 (step 26). IRWB-001's diary calls rendering "a far stronger whole-program check than sampled function cases", because "bit-identical floats leave no room for tolerance arguments".

## 2. Floats in the IR: bits, and one definition per operator

An f32 value is stored as its IEEE-754 bit pattern read as a signed 32-bit integer, in constants, locals, memory and results (`src/typed/f32.ts:1–4`). JSON cannot represent NaN, infinity or the sign of zero, and those are the values on which float arithmetic differs from real arithmetic, so the bit encoding keeps them exact. Float operators have their own names (`fadd`, `fmul`, `flt`, `f2i`, …), so no integer rule can match them.

The semantics of each operator are taken from the reference compiler and the reference interpreter (`f32.ts:6–17`):

- `fadd`, `fsub`, `fmul`, `fdiv`, `fsqrt` round to nearest, ties to even (RNE). The reference compiler "names RNE in every rounding instruction and never fuses a product and a sum", so one `Math.fround` of the exact double-precision result is the target's result (`f32.ts:8–10`).
- Any NaN produced by arithmetic is the canonical NaN `0x7fc00000` (`f32.ts:11`).
- `fneg`, `fabs` and `fcopysign` change only the sign bit, so NaN payloads survive. `fmin` and `fmax` order −0 below +0. Comparisons are false on NaN, except `fne`.

The operator tables are `F32_BINARY`, `F32_COMPARE` and `F32_UNARY` (`f32.ts:57`, `:67`, `:76`). `f32Op(op, a, b)` (`:142`) evaluates any of them on bits.

Because every operation is correctly rounded with a fixed rounding mode, a program's float results are a deterministic function of its inputs. That is why bit-exactness is achievable at all. It is also why any transformation that changes the order or number of roundings changes some results.

## 3. The backend's RV32F code, and the instructions that are not used

The backend's f32 tiles are in `src/typed/backend/select.ts:11–20` and `:107–126`. `fadd.s`, `fsub.s`, `fmul.s`, `fdiv.s` and `fsqrt.s` carry RNE in their rounding-mode field. Sign injection implements `fneg` and `fabs`. Comparisons write an integer register. An f32 constant is rebuilt at every use: `lui` (and `addi` if needed) into an integer register, then `fmv.w.x` into a float register.

RV32F also has four fused instructions that compute `±(a × b) ± c` with **one** rounding: `fmadd.s` (a·b + c), `fmsub.s` (a·b − c), `fnmsub.s` (−(a·b) + c) and `fnmadd.s` (−(a·b) − c). The vendored interpreter implements them exactly (`vendor/ds-js-os/bench/host/rv32-interp.js:134–147`; dispatch at `:379–383`), and the reference compiler's instruction table lists them (`vendor/ds-js-os/compiler/typed/typed-rv32.js:157`), but neither compiler emits them. The firmware that runs the gallery on the device makes the same choice explicitly: its renderer core is compiled "with -ffp-contract=off (as the kernel instance), so the device and the host round alike" (ds-js-os `firmware/nucleus/candela_gallery.c:2`, read, not run).

RV32F has no reciprocal or reciprocal-square-root *estimate* instruction. Division and square root are the full-precision `fdiv.s` and `fsqrt.s`. "Approximate reciprocal" on this target therefore means replacing `x / c` by `x · fl(1/c)` for a constant `c`, not an estimate-and-refine sequence.

## 4. Candela: what a frame is

Candela is the gallery's path tracer: 332 functions, about a third of its operations f32 (IRWB-002 guide section 16). `src/typed/candela-render.ts` drives it on any engine (the reference compiler's image on the emulator, this compiler's evaluator, or this compiler's own image):

1. `cdlLayout` and `cdlInit` set up the arena (`CandelaHost.layout`, `candela-render.ts:98`).
2. `bind(scene)` writes the scene's packed buffers and builds the sky table (`:117`).
3. `span(y, x0, x1, frame)` calls `cdlRenderSpan` and returns **12 floats per pixel**: colour rgba, albedo rgba, normal xyz and depth (`:137`, `:154`).

The **frame index** is the only input that differs between two frames of the same scene. `renderPixel` seeds each pixel's random state from its coordinates and the frame index:

```js
// corpus/candela-gallery/kernel.typed:2603
q_k.rngS = pcgH(px + py*9781 + frameIx*6271 + 17) ^ pcgH(frameIx*26699 + 3 + u32(U[96])*7919);
// kernel.typed:54-59: rnd() steps a PCG hash and returns (state >>> 8) / 2^24
```

The gallery renders progressively. "One pass is one sample per pixel. Pass p uses Candela's frame index … 0, then p + 1". It keeps, per pixel, "the sum of colour and the sample count", so "every pixel is displayed as its own mean, at any moment" (ds-js-os `firmware/nucleus/candela_gallery.h:10–14`; `cg_frame_index` at `candela_gallery.c:21`). A scene ends after `TARGET_PASSES = 64` passes (`firmware/port/esp32p4/main/candela_gallery_p4.c:56`). Frame index 1 is never used.

The workbench's preview `viewImage` (`candela-render.ts:190`) maps colour to 8 bits with an automatic exposure (the log-average luminance maps to 0.18), the curve `x / (1 + x)` and the sRGB transfer function. It is not the scene's own tone map. The measurements here use it with the exposure fixed per scene, so that two images of the same scene are mapped identically (section 9).

## 5. Contracts, and where a tolerance would plug in

A sampled check is a `DifferentialSpec` (`src/framework/contracts/differential.ts:31`): ports, a baseline and a subject, a case generator, `run`, and a `compare(baseline, subject, case)` that returns `true` or `{ ok, reason }` (`CaseComparison`, `:26`). Its evidence records how many cases agreed, disagreed or were inconclusive. `assuranceOf(evidence)` (`:325`) maps a sampled check to `checked-sampled` and anything else to `checked-exact`. The vocabulary has no entry for "within a bound".

IRWB-002's item D6 proposed the per-case extension: `compare` returns a `distance`, and the evidence keeps the maximum distance, a histogram and the case that attained it. For f32 results the distance would be in **ulps** (units in the last place, section 6), NaN must match NaN, and traps must match exactly. D6 also proposed "for images, a second metric [that] renders a tile on the emulator with both programs and compares pixels", usable as a constraint in a strategy's `chooseBest`. This ticket develops that second metric into a contract.

There is a precedent for a contract that deliberately accepts a program that does not mean the same thing as r0 everywhere. `Program.assume(bindings)` restricts the meaning check to inputs satisfying an assumption, and specialization on outer facts uses it. The assumption is stored with each revision made under it (IRWB-002 guide section 10, "Assumptions"). A tolerance revision needs the same kind of bookkeeping: a revision that is not exact, together with the reason it was accepted.

# Part 2: Background, from scratch

## 6. IEEE-754 single precision, and what three transformations change

A **binary32** value has 1 sign bit, 8 exponent bits and 23 fraction bits. A normal value is (−1)^s × 1.f × 2^(e − 127). Exponent 0 encodes zero and the subnormals. Exponent 255 encodes ±∞ (fraction 0) and NaN (fraction ≠ 0). The spacing between adjacent representable values is one **ulp**: for values in [1, 2) it is 2⁻²³ ≈ 1.19 × 10⁻⁷, and it doubles with each power of two.

**Correct rounding.** Each basic operation (`+ − × ÷ √`) returns the representable value nearest to the exact real result, with ties going to the value whose last significand bit is 0 (round to nearest, ties to even). So each operation has exactly one correct result, and its error is at most half an ulp. A sequence of operations accumulates one rounding per operation, *in the order written*. Change the order or the number of roundings and the result can change. The examples below are computed with the evaluator's own operators by `scripts/04-f32-examples.mjs` (`various/04-f32-examples.json`).

**Reassociation** replaces `(a + b) + c` by `a + (b + c)`. Over the reals these are equal. In binary32:

```text
a = 1, b = 2^24, c = -2^24
(a + b) + c :  1 + 16777216 = 16777216 (rounded: the exact 16777217 is a tie; ties to even)  ->  + c  =  0
a + (b + c) :  16777216 - 16777216 = 0  ->  1 + 0                                            =  1
```

The results differ by the full value of `a`. With small constants the change is usually one ulp. `(x + 0.1) + 0.2` against `x + fl(0.1 + 0.2)` differs on 83 of 256 inputs `x = k/64` in [0, 4), by at most 1 ulp. The first is `x = 0.703125`, giving `1.0031251` against `1.003125`.

**Contraction** replaces `fadd(fmul(a, b), c)`, two roundings, by `fmadd(a, b, c)`, one rounding:

```text
a = b = 1 + 2^-12 (0x3f800800),  c = -(1 + 2^-11) (0xbf801000)
exact a*b = 1 + 2^-11 + 2^-24                      (needs 25 significand bits)
two roundings:  fl(a*b) = 1 + 2^-11  ->  + c  =  0
one rounding:   fl(a*b + c) = 2^-24 = 5.96e-8
```

The relative error of the two-rounding result is 100 %. Contraction is not "within one ulp of the result" in general: under cancellation it changes the result by an amount unrelated to the result's size. It can also change special values. With `x = 3 × 10³⁸`, `x · 2 − x` overflows to `+∞` with two roundings and returns `3 × 10³⁸` with one.

**A reciprocal** replaces `x / c` by `x · fl(1/c)`. `fl(1/3) = 0.33333334`. For `x = 1 … 1000`, `x / 3` and `x · fl(1/3)` differ on 332 inputs, by 1 ulp at most. The first is `x = 5`: `1.6666666` against `1.6666667`. For `c` a power of two, `1/c` is exact and the two agree except where a result would be subnormal.

The three share a pattern. Each is exact over the reals and changes binary32 results in a way that is small in the typical case and unbounded in the worst case. That is why a per-call bound in ulps (D6) is the wrong primary yardstick for a renderer: a worst case of "infinitely many ulps" in a cancellation that the image never shows would reject a harmless transformation, and a typical case of "one ulp" says nothing about what one ulp does after a thousand dependent operations and a branch.

## 7. Monte Carlo rendering, noise and accumulation

A path tracer computes each pixel's colour as an integral over all light paths through that pixel. It does not evaluate the integral exactly. It **estimates** it by sampling: draw a random path, compute its contribution `f(X)`, and average.

```text
estimator with n samples:   I_n = (1/n) Σ_{i=1..n} f(X_i)
unbiased:                   E[I_n] = I
variance:                   Var[I_n] = σ² / n        (σ² = variance of one sample's contribution)
standard error:             σ / √n
```

Each gallery pass contributes one sample per pixel, and the displayed value is the running mean, so after n passes each pixel shows `I_n`. Two consequences follow.

- **The noise halves only when the number of samples quadruples.** The difference of two *independent* n-pass means has variance 2σ²/n, so its mean squared value halves with every doubling of n. In decibels, that is +3.01 dB of PSNR (section 8) per doubling.
- **Rare, large samples dominate.** A path that reaches a small bright light through a chain of reflections has a tiny probability and a huge contribution. These samples are **fireflies**. They make the distribution of `f(X)` heavy-tailed, so σ² is dominated by rare events, the sample variance is itself noisy, and a few pixels carry most of the squared error.

**Same seeds, different programs.** Two programs that compute the same function, run with the same random sequence, produce the same frame. Two programs that differ in the last bit of some operations, run with the same sequence, produce frames that agree almost everywhere. They can still differ completely at a pixel where the small difference changed a discrete decision: a ray hits or misses an edge, or a comparison with a random number goes the other way. From then on, that pixel follows a different path. This is **path divergence**. Using the same random numbers in both runs is a standard variance-reduction device in simulation, called **common random numbers**, and it is what makes small systematic differences visible in a paired comparison (section 15).

## 8. Image metrics

For two 8-bit images with N channel values each:

```text
MSE   = (1/N) Σ (a_i - b_i)²
PSNR  = 10 · log10( 255² / MSE )          in dB; identical images give +∞
max   = max_i |a_i - b_i|                  in 8-bit levels
```

+6.02 dB is a halving of the RMS difference, and +3.01 dB a halving of the MSE. PSNR is a property of a *pair* of images and of the mapping from radiance to 8 bits. It depends on exposure and tone curve, and saturates where the curve clips.

PSNR against a reference answers "how different", not "different in what way". A candidate that adds unbiased noise and one that shifts every pixel by a small bias can have the same PSNR against the reference, and they are not equally acceptable. The noise disappears with more passes; the bias does not (section 16). This is why the brief asks for the error to be judged against the estimator's own sample variance, with a statistical test across seeds or frames, and not only by PSNR to a reference.

Linear-radiance metrics (MSE of the raw floats, the maximum absolute error) are worse still for a path tracer, because single fireflies dominate them. Section 9 measures this.

## 9. Statistical tests across seeds

Suppose two programs each render n passes with *different* frame indices, giving per pixel and channel a mean `A`, `B` and a sample variance `s_A²`, `s_B²`. Under the hypothesis that both are the same estimator,

```text
z = (A - B) / sqrt( s_A²/n + s_B²/n )
```

is approximately standard normal for each channel value: about 0.27 % of values have |z| > 3, and the mean of z² over all values is about 1.

- **Multiple comparisons.** With 1,200 channel values (400 pixels × 3), about 3 exceed |z| > 3 by chance. A test must look at the distribution of z, for example the share beyond 3 or the mean of z², not at the largest z.
- **Absence of evidence.** "The test did not reject" does not mean "the programs are equivalent". With few passes the test has no power, and everything passes. A contract that accepts must use an **equivalence test**: accept only if the data show the difference is *smaller* than a stated margin δ. The two one-sided tests procedure (TOST, introduced by Schuirmann in pharmacokinetics in 1987) is the standard form. It rejects "difference ≤ −δ" and "difference ≥ +δ" separately. In practice this means the contract states the smallest effect it could detect at its n and refuses to accept when that is larger than the budget.
- **Heavy tails.** Fireflies inflate `s²` and make z conservative. The test then rejects less often, which is the safe direction for a null of "same", but the unsafe direction for an equivalence claim.

A **paired** comparison is the other tool. Render candidate and exact with the *same* frame indices and look at `D = candidate − exact` per pixel. Common random numbers cancel the noise wherever the paths agree, so `D` is exactly 0 where nothing diverged and small where only rounding differs. Large values of `D` mark divergence. Paired comparisons are very sensitive to systematic change and say nothing direct about whether diverged pixels are "the same estimator", which is what the independent test is for.

# Part 3: What was measured

## 10. The noise floor of eight scenes

`scripts/01-render-passes.mjs` rendered eight scenes on the reference emulator, the reference compiler's `kernel` image, which is bit-identical to the evaluator on these scenes (IRWB-001 diary step 26). It rendered every pixel of a 20 × 20 grid (stride 8 for the 160 × 160 scenes, stride 4 for the 80 × 80 ones), 32 passes (X-03: 16) with the gallery's frame indices 0, 2, 3, …. The harness reproduces IRWB-001's numbers: B-01's pass 0 executes 3,430,936 instructions, IRWB-001's figure for the same frame. `scripts/02-noise-floor.mjs` compares the accumulation of passes [0, n) with the independent accumulation of passes [n, 2n), on the display mapping of section 4 with one exposure per scene. Output: `various/02-noise-floor.txt` and `.json`; commands and timings: the diary, step 2.

| scene | what it is | instructions per pass | PSNR, 1 pass vs 1 | max diff (of 255) | PSNR, 16 vs 16 | one pass's relative std (median / p90) |
|---|---|---:|---:|---:|---:|---:|
| B-01 | Hello, sphere | 3,430,936 | 15.2 dB | 188 | 24.5 dB | 0.78 / 1.45 |
| R-01 | The Cornell box | 6,564,752 | 16.7 dB | 205 | 27.0 dB | 0.68 / 1.71 |
| L-03 | The sun and the sky | 2,657,652 | 17.4 dB | 120 | 30.5 dB | 0.48 / 0.70 |
| G-01 | Analytic primitives | 5,253,890 | 15.9 dB | 154 | 27.9 dB | 0.59 / 0.75 |
| V-02 | Phase functions | 9,146,151 | 11.6 dB | 254 | 15.0 dB | 2.23 / 4.02 |
| S-02 | Diamond fire (spectral) | 10,400,281 | 8.4 dB | 254 | 10.8 dB | 2.23 / 3.52 |
| V-04 | A cloud | 33,997,576 | 16.2 dB | 158 | 25.9 dB | 0.15 / 1.45 |
| X-03 | A procedural planet | 121,148,536 | 8.0 dB | 255 | 17.6 dB (8 vs 8) | 0.91 / 2.23 |

The relative standard deviation is per pixel, of one pass's luminance over all passes, divided by its mean.

```text
PSNR of n-pass vs n-pass (dB)      n = 1     2     4     8    16
  L-03  ............................  17.4  21.1  24.7  27.3  30.5     +13.1 over 4 doublings
  G-01  ............................  15.9  19.1  22.0  25.7  27.9     +12.0
  R-01  ............................  16.7  18.8  20.6  24.4  27.0     +10.3
  V-04  ............................  16.2  17.6  19.8  23.0  25.9     +9.7
  B-01  ............................  15.2  16.7  20.2  22.1  24.5     +9.3
  X-03  ............................   8.0   9.3  14.0  17.6           +9.6 over 3
  V-02  ............................  11.6  11.3  11.5  12.8  15.0     +3.4
  S-02  ............................   8.4   8.3   8.8   9.4  10.8     +2.4
  expected for variance ∝ 1/n: +3.01 per doubling, +12.0 over four
```

Five findings follow from these tables, and each shapes the design of Part 4.

1. **The noise is large.** One pass differs from another by 8 to 17 dB, and single pixels by up to the full 255 levels. A compile-time change whose frames differ from the exact frames by, say, 40 dB is far below the noise of any single pass.
2. **It depends strongly on the scene.** At 16 passes the scenes span 10.8 to 30.5 dB. A single threshold for all scenes would be too loose for L-03 or too tight for S-02. **Budgets must be per scene.**
3. **Accumulation works, mostly as theory says.** Five scenes gain 2.3 to 3.3 dB per doubling of passes, close to the 3.01 dB of variance ∝ 1/n. V-02 and S-02 gain far less (0.6 to 0.9 dB per doubling). Their per-pixel spread is three times the others' (median relative std 2.23). The gallery's 64 passes would add about another 6 dB to the well-behaved scenes. That is an extrapolation at 3 dB per doubling, not a measurement.
4. **Linear metrics are decided by fireflies.** In S-02, one sample in pass 30 has luminance 7.39 × 10⁵, while the frame mean in the other passes inspected is 5.8 to 11.2. That one sample makes the linear RMS difference of the two 16-pass means larger than that of two single passes (relative RMS 2.4 against 0.021). In B-01 and S-02, the largest 1 % of squared differences carry 87 % of the total at n = 1. **A tolerance must be stated on the displayed image (or a robust statistic), not on raw radiance.** S-02 also shows that spectral rendering produces negative colour channels: about 380 of its 400 pixels have a negative r, g or b in every pass, which the display map clamps to 0.
5. **The z test behaves on the well-behaved scenes.** Between the two halves (16 passes against 16), 0.25 % to 0.58 % of channel values have |z| > 3, against 0.27 % for a normal distribution, and the mean z² is 1.02 to 1.14. On V-02 and S-02 no value exceeds 3, because the fireflies inflate the variance estimates. X-03 (8 against 8) has 1.09 % and a mean z² of 1.27, the fewest passes and the noisiest scene.

## 11. Three float transformations, judged against the noise

CANDIDATES-PLACEHOLDER

# Part 4: The design space

## 12. The contract's shape

**Proposed.** An image-level contract is a check over a whole program, not over one function's cases. One possible form:

```ts
// Proposed: a contract judged on Candela frames
interface FrameContract {
  id: 'candela.frames-within';  version: string;
  scenes: readonly SceneId[];                    // all 18 for acceptance; fewer for a quick filter
  grid: { stride160: number; stride80: number }; // pixels per scene (20 x 20 here)
  passes: number;                                // the accumulation depth at which it judges (64 = the gallery's)
  reference: 'r0';                               // always the exact original, never the previous revision
  budget: Readonly<Record<SceneId, Budget>>;     // per scene, in units of that scene's own noise (section 14)
  tests: { paired: PairedSpec; independent: IndependentSpec };
}
interface FrameEvidence {                         // what the revision records
  method: 'frames';  scenes: number;  passes: number;  seedsPaired: number[];  seedsIndependent: number[];
  perScene: Record<SceneId, { pairedPsnr: number; pairedMax: number; divergedPixels: number;
                              zOver3: number; meanZ2: number; noisePsnr: number; budget: Budget; ok: boolean }>;
  worst: { scene: SceneId; margin: number };
}
```

It differs from a `DifferentialSpec` in that a "case" is a whole frame of a scene, the comparison is statistical over many pixels and passes, and the evidence is a table per scene rather than a count of agreeing cases. It can still be expressed as a framework invariant, because a scene is a case and `compare` can return a structured verdict. It is far more expensive than a per-function check (section 18).

## 13. What exactly is compared

| choice | options | recommendation |
|---|---|---|
| outputs | colour only; colour, albedo and normal (a denoiser reads all three) | colour first; albedo and normal must be checked too if a denoiser is ever used |
| domain | linear radiance; display (tone-mapped, 8-bit); a robust statistic on linear values | display, as measured (§10, finding 4) |
| reference | r0 exact; the previous revision | r0, always: errors cannot compound across passes (§17) |
| pixels | a 20 × 20 grid; every pixel | the grid as a filter; more pixels for acceptance, because divergence is rare and local |
| scenes | a sample; all 18 | all 18 for acceptance (budgets are per scene) |
| depth | 1 pass; the gallery's 64 | judge at the depth the user sees (§16) |

## 14. Per-scene budgets in noise units

The measured noise floor turns the question "how wrong is acceptable?" into a choice of one dimensionless number. **Proposed:** a candidate is acceptable for scene `s` at depth `n` if its *systematic* difference from the exact program is at most a fraction `f` of scene `s`'s own noise at depth `n`:

```text
budget_s(n) = f · σ_s / √n          (per pixel and channel, display domain)
equivalently, in PSNR:  PSNR_paired(candidate, exact; n) ≥ PSNR_noise_s(n) + 20·log10(1/f) dB
```

With `f = 0.1` the candidate's paired difference must be at least 20 dB below the scene's noise at the same depth. The choice of `f` is the one policy decision. It is a statement of the form "the compiler may add at most a tenth of the noise the renderer already has", and it can be reviewed without knowing anything about floats. Because the budget scales with σ_s, noisy scenes (S-02, V-02) tolerate more absolute change than clean ones (L-03). That is the intended behaviour: a change invisible under S-02's noise may be visible in L-03's sky.

## 15. Two tests, because there are two questions

```text
 paired test (same frame indices)                  independent test (different frame indices)
 ───────────────────────────────                   ──────────────────────────────────────────
 D = candidate_n - exact_n  per pixel               z = (cand_n - exact'_n) / se   per channel value
 noise cancels where paths agree                    noise does not cancel
 detects: systematic change (bias), divergence       detects: a different estimator (bias beyond se)
 accept if: PSNR(D) clears the budget AND            accept if: share(|z|>3), mean z² match the
            diverged pixels <= a share                          exact-vs-exact null of the same scene
 cost: n passes of the candidate                     cost: n passes of the candidate + 2n of exact
       (exact passes reused)                               (exact passes reused from the noise floor)
```

The paired test is the sensitive one. It decides most candidates, because a transformation that changes only the last bit shows up as tiny paired differences far below any budget. The independent test settles the cases where many pixels diverge. A diverged pixel is a different sample of what should be the same distribution, and only a comparison across seeds can say whether it is. Section 11 measured both for the three transformations.

## 16. Accumulation: why the budget must be set at the displayed depth

A compile-time change typically adds two things to a pixel: a **bias** `b`, the same in every pass, and some **extra variance** from divergence. Noise shrinks with accumulation and bias does not:

```text
after n passes:   noise σ/√n,   bias b
bias becomes visible when  b > σ/√n,  i.e. after  n* = (σ/b)²  passes
```

A bias at 1 % of a single pass's noise becomes as large as the noise after 10,000 passes, and is far below it at 64. A bias at 10 % of single-pass noise matches the noise at 100 passes and is already a third of it at the gallery's 64. The contract must therefore judge at the depth the gallery displays (64 passes), or at a smaller depth with the budget scaled by √(64/n). A candidate accepted at 1 pass with `f = 0.1` could be visible at 64. Extra variance from divergence behaves like noise: it slows convergence slightly and does not shift the mean, so it is judged by the independent test.

## 17. A tolerance revision: provenance, composition and frozen pipelines

**The revision.** A pass accepted under the frame contract produces an ordinary `typed.blocks` revision, but its evidence is a `FrameEvidence` record with assurance `checked-tolerance` (**Proposed**; `assuranceOf` knows only `checked-sampled` and `checked-exact`). `Program.why` on a value it changed shows the pass, the rule or site, and the contract with its worst scene and margin. A fused instruction in the image covers both the product and the sum values, so the image correspondence still reaches both source lines.

**Composition.** Every frame check compares with **r0**, never with the previous revision, so errors cannot accumulate unseen. Exact passes that run after a tolerance revision cannot be checked against r0 by `meaningKept`, because the tolerance revision itself already differs from r0. Two designs are possible:

```text
 (a) re-anchor:   r0 ─exact─► r5 ─tolerance─► r6 ═══ exact passes checked against r6 ═══► r9
                  final:  frames(r9) vs frames(r0) within budget        (r6 is the "anchor")
 (b) all-frames:  every pass after r6 is checked by the frame contract against r0
```

(a) keeps the cheap exact check for exact passes. Its anchor is a recorded revision, so every exact pass still has a bit-exact reference, and the end-to-end frame check covers the composition. (b) is simpler and much more expensive. (a) is the recommendation, with the final check mandatory.

**Frozen pipelines.** O2, O2+ and every pipeline whose numbers are tests stay exact and unchanged. A tolerance pipeline has its own name (for example `O2-float`, **Proposed**), its own revisions, and images that record their contract. The bit-identity checks of IRWB-001 (frames identical to the reference) apply to exact images only. For a tolerance image the reference comparison is the frame contract itself. Nothing in the exact world reads a tolerance revision as its origin.

```text
          exact world (today, unchanged)                tolerance world (Proposed, separate)
 r0 ─O2─► rN ─► image          frames == reference      r0 ─O2-float─► rF ─► image_F
   meaning-kept (bits), image-agrees (bits)               exact passes vs anchor; tolerance passes:
                                                          frame contract vs r0; final frame contract
```

## 18. Cost, and a cheap filter in front

A full frame check is expensive. At 20 × 20 pixels, a single pass costs from 2.7 million instructions (L-03) to 121 million (X-03) on the emulator (section 10). The eight-scene, 32-pass noise floor took 14 minutes of rendering (diary step 2). The contract therefore needs a cheap filter in front of it:

1. **Per-call ulp distance (D6)** on the existing generated cases rejects gross errors, such as an operator swap, in seconds. It should not be used to accept.
2. **The paired frame test on a few scenes at low depth** rejects most bad candidates in minutes.
3. **The full contract** (all 18 scenes, the displayed depth, both tests) runs once per pipeline result, not per pass.

The exact noise passes are computed once per scene and reused for every candidate, as IRWB-004 already does for r0's per-case outcomes.

## 19. Which RV32F instructions make which transformation pay

| transformation | instructions before → after | what it saves on this target | status |
|---|---|---|---|
| contraction `a·b ± c` | `fmul.s` + `fadd.s`/`fsub.s` → one `fmadd.s`/`fmsub.s`/`fnmsub.s` | one instruction per site, and the product's register | measured in §11 |
| constant reassociation `(x ⊕ c1) ⊕ c2` | two ops and two constants → one op and one constant | one operation and one constant rebuild (2–3 instructions) per site | measured in §11; 10 sites in Candela at O2 (IRWB-010 census) |
| reciprocal `x / c` | `fdiv.s` → `fmul.s` | **no instruction**: the emulator counts instructions, so the gain is invisible to the project's metric; only a cycle count on the device shows it | measured in §11 (error only) |
| general reassociation | same count | latency or parallelism only | not measured |
| reciprocal / square-root estimates | none on RV32F | none | not applicable |

Two points need care. First, the project measures **instructions** on an emulator, and division costs one instruction there regardless of its latency on the chip. A reciprocal is therefore a pure loss in this metric: error with no gain. Its value can only be shown by the user-run device timing that IRWB-001 lists as an open task (`tasks.md`, task `xzzl`). Second, **exact** float rewrites also exist, for example `x · 2.0 → x + x`, which removes a constant rebuild and is exact for every bit pattern. Those belong to the exact world and to IRWB-010, not here.

# Part 5: First experiments and decision criteria

**E0. The noise floor (done, §10)** and **E0b. three candidates against it (done, §11).**

**E1. The noise floor at the displayed depth, on all 18 scenes.**
- *Setup.* `scripts/01-render-passes.mjs` with 128 passes (64 + 64 independent) on every scene at a 20 × 20 grid, and on two scenes at full resolution.
- *Measure.* PSNR of 64 against 64 per scene; the per-pixel σ; the gain per doubling up to 64.
- *Continue if* the 64-pass PSNR is stable across two disjoint halves to within 1 dB, which is needed for a budget.
- *Stop if* it is not, for example because fireflies dominate. Then the budget needs a robust statistic (a trimmed MSE, or a per-pixel median of means) before anything else.

**E2. The paired test as a contract on fused multiply-adds.**
- *Setup.* `O2-float` (**Proposed**) = O2 plus a contraction step in the backend, behind an option. The frame contract on all 18 scenes at 64 passes with `f = 0.1`.
- *Measure.* Per scene: paired PSNR against the budget; diverged pixels; instructions per pixel saved.
- *Continue if* every scene clears its budget and the saving is at least the 1–2 % that §11's dynamic counts predict.
- *Stop if* any scene fails at `f = 0.1`. Then look at which sites cause the divergence and whether excluding those sites, for example in comparisons that steer branches, keeps the gain.

**E3. The independent test's power.**
- *Setup.* Inject a known bias, for example multiply one light's intensity by `1 + ε` in a copy of a scene, and run the independent test at increasing n.
- *Measure.* The smallest ε detected at 64 passes. That is the contract's minimum detectable effect.
- *Continue if* the minimum detectable effect is at or below the budget.
- *Stop if* it is above. Then the independent test cannot support an equivalence claim at that depth, and either n must grow or acceptance must rest on the paired test alone.

**E4. Mutation score of the frame contract (with IRWB-005).**
- *Setup.* IRWB-005's float mutants of Candela functions (its 83 float mutants that the default gate accepted, among others) run through the frame contract.
- *Measure.* The kill rate. Ulp-sized mutants should be accepted, as within tolerance by design. Operator swaps should be killed.
- *Continue if* every mutant that the per-function gate kills is also killed by the frame contract or by its ulp filter.
- *Stop if* the frame contract accepts gross mutants. Then a mutant can live in code a scene never reaches, and the contract's coverage, meaning which functions and branches the scenes execute, must be part of its evidence.

**E5. A cycle measurement for the reciprocal.**
- *Setup.* The user-run device task (IRWB-001, `xzzl`).
- *Measure.* Real time per pixel with and without the reciprocal variant.
- *Continue if* the reciprocal saves measurable time.
- *Stop if* it saves none. Then drop the reciprocal: it costs error and gains nothing.

# Part 6: Risks, open questions and connections

## 20. Risks

| risk | why it is real | mitigation |
|---|---|---|
| the scenes do not cover the code | a transformation in code no scene reaches is accepted unseen | record coverage (functions and branches executed) in the evidence; keep the per-call ulp filter for all functions |
| the budget is set at the wrong depth | bias becomes visible as passes accumulate (§16) | judge at 64 passes or scale the budget by √(64/n) |
| fireflies decide the verdict | linear metrics are dominated by single samples (§10) | display domain; robust statistics; E1 |
| "not rejected" is read as "equivalent" | low power at small n | equivalence test with a stated minimum detectable effect (E3) |
| tolerance leaks into the exact world | a tolerance revision used as an origin | separate pipelines; assurance `checked-tolerance`; no exact pipeline reads it |
| the display mapping changes | `viewImage` is a preview, not the scene's tone map | state the mapping in the contract's version; re-measure the noise floor when it changes |
| device and host round differently | the gallery compiles with `-ffp-contract=off` for exactly this reason | the frame contract judges the emulator, which implements fused instructions exactly; a device run (E5) checks the hardware |

## 21. Open questions

1. What is `f`? 0.1 (20 dB below the noise) is a starting point, not a derivation.
2. Should the budget be per scene only, or per region (sky, surfaces, volumes)? A uniform per-scene budget lets a large error hide in a noisy region.
3. Which depth should the contract judge at? The gallery shows every pass from 1 to 64. A candidate within budget at 64 may be visible at 4 in a clean region, though at 4 the noise is also larger.
4. How should albedo and normal outputs be judged if a denoiser is ever added? They are nearly noise-free, so their budget cannot come from noise.
5. Does the anchor design of §17 (a) need the anchor's meaning check to be stronger than sampled, given that every later exact pass trusts it?
6. Should a strategy's `chooseBest` be allowed to trade instructions against frame error under this contract, as D6 proposed, or should the contract be a pure constraint?
7. What does a tolerance revision mean for IRWB-008's exact checking? An edit that cites an inexact rule has no exact proof, only a frame-level verdict.

## 22. How this connects to the other tickets

- **IRWB-010** (rewrite search on SSA and verified rules) owns the exact f32 rules (such as `x · 2.0 → x + x`) and has the census of where the inexact patterns are. The census counts 820 contraction sites and 10 constant-reassociation sites across Candela at O2 (IRWB-010 diary step 2). An e-graph with inexact rules would be usable only under this ticket's contract, and its explanations would cite the contract's verdict rather than a proof.
- **IRWB-008** (exact checking for edits that cite verified rules, and version 2 of the meaning check for new pipelines) is the exact counterpart. A tolerance pipeline is a new pipeline, so its exact passes run under version 2. Its tolerance passes are exactly the edits IRWB-008 cannot discharge.
- **IRWB-007** (specializing Candela on its scene data) produces per-scene programs. A per-scene program needs only its own scene's budget, which makes the frame contract cheaper and better matched, one scene instead of eighteen.
- **IRWB-009** (a function-incremental framework) matters because the frame contract is a whole-program check. Incrementality cannot shrink it below "render the scenes", but a store of exact passes per scene lets every candidate reuse them.
- **IRWB-005** (not merged, `d9cf4e9`) supplies the float mutants and the finding that the default per-function gate accepts 85 wrong mutants of 3,931 on 18 Candela functions, 83 of them float mutants in shading and distance code (its diary step 18). Its operators include one-ulp constant changes, which a tolerance contract must accept by design. E4 needs exactly that distinction.
- **IRWB-002** items D6 (tolerance contracts, per call) and B6 (float rewrites that change the last bit) are the agenda entries this sketch develops.

# Appendix A: API reference

| symbol | file:line | role here |
|---|---|---|
| `F32_BINARY`, `F32_COMPARE`, `F32_UNARY`, `f32Op`, `toBits`, `fromBits` | `src/typed/f32.ts:57`, `:67`, `:76`, `:142`, `:32`, `:27` | f32 semantics on bits |
| `F32_EDGES`, `casesFrom`, `agrees`, `meaningKept` | `src/typed/evaluate.ts:196`, `:232`, `:554`, `:587` | the exact per-pass gate |
| `DifferentialSpec`, `CaseComparison`, `assuranceOf` | `src/framework/contracts/differential.ts:31`, `:26`, `:325` | where a tolerance would plug in |
| `F_BINARY` (f32 tiles) | `src/typed/backend/select.ts:108` | the instructions emitted |
| `lowerToImage`, `runImage`, `heat`, `imageAgrees` | `src/typed/backend/compile.ts:429`, `run.ts:74`, `run.ts:175`, `run.ts:365` | images, runs, the image check |
| `codeBytes`, `toBase64`, `ImageInsn` | `src/typed/backend/image.ts:132`, `:100`, `:32` | patching an image (measurement only) |
| `CandelaHost`, `renderScene`, `viewImage` | `src/typed/candela-render.ts:74`, `:166`, `:190` | frames |
| `engineFor`, `candelaScenes` | `tools/candela-render.mjs:28`, `:19` | engines and scenes |
| `renderPixel`, `rnd`, `pcgH` | `corpus/candela-gallery/kernel.typed:2599`, `:54`, `:49` | where the frame index enters |
| `fma` (interpreter) | `vendor/ds-js-os/bench/host/rv32-interp.js:135` | the fused instructions' semantics |

# Appendix B: Files

| path | why it matters |
|---|---|
| `src/typed/f32.ts` | the definition of every f32 result |
| `src/typed/evaluate.ts` | the exact gate |
| `src/typed/backend/select.ts` | the RV32F tiles; no fusion |
| `src/typed/candela-render.ts`, `tools/candela-render.mjs` | the frame protocol |
| `corpus/candela-gallery/kernel.typed` | the renderer, its RNG |
| ds-js-os `firmware/nucleus/candela_gallery.{h,c}` (read only) | the gallery's passes and accumulation; `-ffp-contract=off` |
| this ticket's `scripts/01–04`, `various/01-passes/` | the noise floor and the candidates; the saved passes for reuse |
| `ttmp/2026/11/24/IRWB-002--*/design-doc/01-*.md` | items B6 and D6 |

# Appendix C: Glossary

- **ulp.** The spacing between adjacent binary32 values at a given magnitude (§6).
- **RNE.** Round to nearest, ties to even (§6).
- **contraction, fused multiply-add.** Computing `a·b + c` with one rounding (`fmadd.s`) instead of two (§6).
- **pass (gallery).** One sample per pixel; the gallery averages passes (§4). Not to be confused with a compiler pass.
- **noise floor.** The difference between two renders of the same program with different frame indices (§10).
- **paired / independent comparison.** Same frame indices (noise cancels) or different ones (noise does not) (§9, §15).
- **path divergence.** A pixel whose path changes because a small float difference flipped a discrete decision (§7).
- **budget.** The largest acceptable systematic difference for a scene, in units of its own noise (§14).
- **tolerance revision.** A revision accepted by the frame contract rather than by bit equality (§17).
