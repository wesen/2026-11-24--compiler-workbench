---
Title: Sketch guide diary
Ticket: IRWB-011
Status: active
Topics:
    - compiler
    - ir
    - candela
    - verification
    - research
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological investigation diary for the IRWB-011 sketch guide (image-level contracts for float freedom): what was read, the Monte Carlo noise-floor measurement, a first measured float transformation judged against it, the writing and the upload."
LastUpdated: 2026-11-26T12:00:00-05:00
WhatFor: "Evidence trail behind every number in the IRWB-011 guide; resume point."
WhenToUse: "Read the latest step when resuming; expand earlier steps only as needed."
---

# Sketch guide diary

Steps are chronological, oldest first. Every number in a step comes from the command shown in it or from the file it cites. Scripts are in `../scripts/`, measurements in `../various/`. The worktree is `.claude/worktrees/agent-a6dc8f9fd165045d9`, branched from `a4beda6` on `irwb-001/import-v6-prototype`. The reading shared with IRWB-010 is recorded in IRWB-010's diary, Step 1; this step records what is specific to floats and frames.

## Step 1: Read the float semantics, the backend, the renderer and the gallery's accumulation

The brief asks for a sketch guide on tolerance contracts judged on rendered frames, kept separate from the exact pipelines, with the Monte Carlo noise floor as the natural scale of a tolerance. This step reads what defines a float result today, how frames are produced and accumulated, and what the exact gate does with floats.

The reading settles three facts the guide rests on. Every f32 operation is defined bit for bit and the backend never fuses; the gallery itself compiles its C core with `-ffp-contract=off` so that device and host round alike; and a frame is one sample per pixel whose random sequence is seeded by the frame index, so two frames are two independent realizations of the same estimator.

### Prompt Context
**User prompt (verbatim):** see IRWB-010's diary, Step 1 (the same request covers both sketch tickets).
**Assistant interpretation:** IRWB-011 is sketch ticket 5: a tolerance contract (IRWB-002 D6) that accepts a pass when the rendered frames stay within a measured bound, with the coordinator's framing (judge compile-time error against the estimator's own variance, per-scene budgets, accumulation, which RV32F instructions make which transformation pay, what a tolerance revision means for provenance and frozen pipelines).
**Inferred user intent:** Record the idea with the one measurement that makes it concrete: how large the renderer's own noise is.
**Commit (code):** none (reading only).

### What I did
- Read `src/typed/f32.ts` (all 161 lines), `src/typed/evaluate.ts` (`F32_EDGES` at `:196–199`, `makeF32` `:206`, `agrees` `:554`, `meaningKept` `:587`).
- Read `src/typed/backend/select.ts:1–32` and `:107–126` (the f32 tiles), `src/typed/backend/run.ts` (`runImage`, `heat`), `image.ts:32–98`.
- Read the vendored interpreter's float core (`vendor/ds-js-os/bench/host/rv32-interp.js:60–180`, `:379–383`): exact BigInt rounding for every operation and `fma(a, b, c, negP, negC, rm)` with one rounding.
- Read `src/typed/candela-render.ts` (all), `tools/candela-render.mjs` (all), `renderPixel` (`corpus/candela-gallery/kernel.typed:2599–2640`), `rnd` and `pcgH` (`:49–59`).
- Read (did not run) the gallery's progressive renderer in the ds-js-os repository: `firmware/nucleus/candela_gallery.h:1–14` and `candela_gallery.c:1–21`, `:83`.
- Read IRWB-001 diary step 17 (rendering), steps 23–27, report 3's float sections (`go-go-parc/Projects/2026/11/24/PROJECT REPORT - IR Workbench - Candela on the Kernel - …md`, section 1).
- Read IRWB-005 (not merged, `d9cf4e9`) diary steps 10, 14, 18 for the float mutation operators and their kill rates.

### Why
- A tolerance contract replaces `agrees` for floats; the guide has to say exactly what `agrees` demands now, where float results come from, and what a frame is.

### What worked
- Facts the guide will cite:
  - `fadd`, `fsub`, `fmul`, `fdiv`, `fsqrt`: one `Math.fround` of the exact double result, which is the target's RNE result because double rounding is innocuous for these five (`f32.ts:8–10`); a NaN result is canonical `0x7fc00000` (`:11`).
  - The backend names RNE in every rounding instruction and emits no fused multiply-add (`select.ts:13`, `:107–115`); the interpreter implements `fmadd.s` etc. with one rounding (`rv32-interp.js:134–147`).
  - `agrees` demands equal results and equal written memory (`evaluate.ts:554–560`); for f32 that is bit equality.
  - `cdlRenderSpan(K, out, y, x0, x1, frame)` writes 12 floats per pixel: colour rgba, albedo rgba, normal xyz and depth (`candela-render.ts:4–16`, `:154`).
  - The per-pixel random state is `pcgH(px + py·9781 + frame·6271 + 17) ^ pcgH(frame·26699 + 3 + U[96]·7919)` (`kernel.typed:2603`); `rnd` steps a PCG hash and returns `(state >>> 8) / 2^24` (`:54–59`). So the frame index is the only input that differs between two frames of the same scene.
  - The gallery renders "one pass is one sample per pixel", pass p uses frame index 0 for p = 0 and p + 1 afterwards (`cg_frame_index`, `candela_gallery.c:21`), and keeps per pixel the sum of colour and the sample count, displaying each pixel as its own mean (`candela_gallery.h:10–14`, `candela_gallery.c:83`). It stops a scene at `TARGET_PASSES = 64` (`firmware/port/esp32p4/main/candela_gallery_p4.c:56`).
  - The gallery core is compiled "with -ffp-contract=off (as the kernel instance), so the device and the host round alike" (`candela_gallery.c:2`).
  - `viewImage` maps colour with automatic exposure (log-average luminance to 0.18), `x / (1 + x)`, the sRGB curve, 8 bits (`candela-render.ts:185–225`); it is a preview, not the scene's own tone map.
  - The four real-valued identities that are wrong for IEEE floats (`x + 0 → x`, `x · 0 → 0`, `x − x → 0`, `!(a < b) → a ≥ b`) and the edge sweep that made the gate reject them (report 3, section 1).
  - IRWB-005 at `d9cf4e9`: on the f32 fixture the default gate kills 32 of 32 non-equivalent float mutants (step 10); on 18 Candela functions it accepts 85 wrong mutants, 83 of them float mutants, among them 14 `ulp` and 22 `f32 sign` variants (step 18).
  - Per-frame cost at stride 8 on the reference emulator, from IRWB-001's `various/experiments/06-candela-per-scene.json`: B-01 3,430,936 instructions, R-01 6,564,752, X-03 29,541,285 (100 pixels), G-03 76,674,259 (100 pixels).

### What didn't work
- Nothing in this step.

### What I learned
- Frame index 1 is never used by the gallery: its passes are frames 0, 2, 3, 4, …. The noise-floor measurement uses the gallery's own sequence, so "frame 0 and frame 1" of the brief are passes 0 and 1, frame indices 0 and 2.
- `U(0).z`, which the gallery writes as the frame index, is read into `u0` by `renderPixel` but not used: resolution comes from `u0.x`, `u0.y`, samples per pixel from `u0.w` (`kernel.typed:2601–2626`). The `frame` argument is what seeds the random sequence.

### What was tricky to build
- Nothing built.

### What warrants a second pair of eyes
- The ds-js-os firmware sources were read, not run, and are cited for the gallery's accumulation rule only.

### What should be done in the future
- Measure the noise floor (next step).

### Code review instructions
- `src/typed/candela-render.ts`, `corpus/candela-gallery/kernel.typed:2599–2640`.

### Technical details
- The vault report is deferred to the implementation milestone (coordinator's correction); none was written.

## Step 2: The Monte Carlo noise floor of eight scenes

This step measures the scale any image-level tolerance must be compared with: how much two renders of the same program differ when only the frame index, and so the random sequence, differs. Eight scenes were rendered on the reference emulator (the reference compiler's `kernel` image), 32 passes each (X-03: 16), every pixel of a 20 × 20 grid, and the passes saved; an analysis script then compares independent accumulations.

The result is that one pass differs from another by 8.0 to 17.4 dB of PSNR on the displayed image, with single pixels differing by 120 to 255 of 255 levels, and that two 16-pass accumulations still differ by 10.8 to 30.5 dB. The scenes differ from each other by more than 10 dB at the same pass count, so a single threshold for all scenes cannot be a principled tolerance.

### Prompt Context
**User prompt (verbatim):** see IRWB-010's diary, Step 1.
**Assistant interpretation:** The brief's "especially valuable" measurement: render frame 0 and frame 1 (the gallery's passes 0 and 1) for a few scenes at stride 8, and compare noise realizations and accumulated passes.
**Inferred user intent:** A tolerance stated in the renderer's own units, not invented.
**Commit (code):** none (ticket scripts only; see the commit after this step).

### What I did
- `scripts/01-render-passes.mjs`: imports `engineFor` and `candelaScenes` from `tools/candela-render.mjs` (its CLI block runs only when it is the main module), builds one `CandelaHost`, binds each scene once, then renders P passes of every stride-th pixel with `host.span(y, x, x + 1, frame)`, frame index `p === 0 ? 0 : p + 1` (the gallery's `cg_frame_index`). Saves the four colour floats per pixel per pass (`various/01-passes/<scene>.f32`, 1.5 MB in all) and metadata (`<scene>.json`).
- Smoke test: `systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 node --max-old-space-size=10240 scripts/01-render-passes.mjs --scenes B-01 --passes 2 --out-dir <scratchpad>/smoke` gave `{"stepsPass0":3430936,…}` in 4.9 s. 3,430,936 is exactly IRWB-001's emulator count for B-01 at stride 8 (`various/experiments/06-candela-per-scene.json`), so the harness renders the same frame.
- The run, sequentially, both under the cap: `--scenes B-01,R-01,L-03,G-01,V-02,S-02,V-04 --passes 32` (8 min 37 s, peak RSS 355,484 KB, exit 0), then `--scenes X-03 --passes 16` (5 min 25 s, peak 218,796 KB, exit 0). Logs: `various/01-render-passes.log`, `various/01-render-passes-X03.log`; rows in `various/01-render-passes.jsonl`.
- Scenes: 160 × 160 scenes at stride 8, 80 × 80 scenes at stride 4, so every scene is a 20 × 20 grid of 400 pixels. (The brief said stride 8; for the 80 × 80 scenes that would be 100 pixels, too few for a stable PSNR.)
- `scripts/02-noise-floor.mjs` wrote `various/02-noise-floor.txt` and `various/02-noise-floor.json`. Definitions are in the script header: one exposure per scene from the mean of all passes (viewImage's automatic exposure, fixed so that every image of the scene maps alike), display value `round(255 · srgb(kx / (1 + kx)))`, pairs of independent accumulations A = mean of passes [0, n), B = mean of [n, 2n).

### Why
- Two passes of one program are two independent samples of the same estimator; their difference is the error a correct compiler already "makes" by changing nothing but the seed. That is the natural unit for a tolerance.

### What worked
- Single pass against single pass (n = 1), display domain, and the per-pixel relative spread of one pass:

  | scene | instructions per pass | PSNR (dB) | max diff (levels) | z > 3 at n = P/2 | mean z² | relative std, median / p90 |
  |---|---:|---:|---:|---:|---:|---:|
  | B-01 | 3,430,936 | 15.2 | 188 | 0.33 % | 1.10 | 0.78 / 1.45 |
  | R-01 | 6,564,752 | 16.7 | 205 | 0.30 % | 1.14 | 0.68 / 1.71 |
  | L-03 | 2,657,652 | 17.4 | 120 | 0.58 % | 1.09 | 0.48 / 0.70 |
  | G-01 | 5,253,890 | 15.9 | 154 | 0.33 % | 1.02 | 0.59 / 0.75 |
  | V-02 | 9,146,151 | 11.6 | 254 | 0.00 % | 1.08 | 2.23 / 4.02 |
  | S-02 (spectral) | 10,400,281 | 8.4 | 254 | 0.00 % | 0.99 | 2.23 / 3.52 |
  | V-04 | 33,997,576 | 16.2 | 158 | 0.25 % | 1.02 | 0.15 / 1.45 |
  | X-03 | 121,148,536 | 8.0 | 255 | 1.09 % | 1.27 | 0.91 / 2.23 |

  (Instructions per pass are pass 0's; z statistics at n = P/2, which is 16, and 8 for X-03.)
- Accumulation, PSNR of A against B by n (dB):

  | scene | n=1 | 2 | 4 | 8 | 16 |
  |---|---:|---:|---:|---:|---:|
  | B-01 | 15.2 | 16.7 | 20.2 | 22.1 | 24.5 |
  | R-01 | 16.7 | 18.8 | 20.6 | 24.4 | 27.0 |
  | L-03 | 17.4 | 21.1 | 24.7 | 27.3 | 30.5 |
  | G-01 | 15.9 | 19.1 | 22.0 | 25.7 | 27.9 |
  | V-02 | 11.6 | 11.3 | 11.5 | 12.8 | 15.0 |
  | S-02 | 8.4 | 8.3 | 8.8 | 9.4 | 10.8 |
  | V-04 | 16.2 | 17.6 | 19.8 | 23.0 | 25.9 |
  | X-03 | 8.0 | 9.3 | 14.0 | 17.6 | |

  B-01, R-01, L-03, G-01 and V-04 gain 9.3–13.1 dB over four doublings (2.3–3.3 dB per doubling), close to the 3.01 dB per doubling that variance ∝ 1/n predicts. V-02 and S-02 gain 3.4 and 2.4 dB.
- The z statistic between the halves behaves like a standard normal on the well-behaved scenes: 0.25–0.58 % of channel values beyond |z| = 3 against 0.27 % for a normal distribution, mean z² 1.02–1.14 (a t-like statistic with variances estimated from 15 + 15 passes is expected slightly above 1).

### What didn't work
- The first `02-noise-floor.mjs` run, on the 2-pass smoke output, printed `NaN` for the z statistics: a half of one pass has no sample variance (division by n − 1 = 0). Not a defect for P ≥ 4; recorded so that nobody reads the smoke numbers.
- A long shell heredoc appending this step to the diary was refused by the worktree isolation check ("this command is too complex to verify that it stays inside the worktree"); appended with the editor.

### What I learned
- **Linear-domain metrics are dominated by single samples.** In S-02, pass 30 has one pixel at luminance 7.39 × 10⁵, while the frame's mean luminance is 5.8–11.2 in the other passes shown by the inspection command. That one sample makes the relative RMS of the 16-pass pair 2.4, larger than at n = 1 (0.021). The top 1 % of squared differences carry 87 % of the total at n = 1 in B-01 and S-02. A tolerance on linear radiance (MSE, maximum absolute error) would be decided by fireflies; the display-domain PSNR is bounded and behaves.
- **Spectral scenes carry negative colour channels.** In S-02 about 380 of the 400 pixels have a negative r, g or b in every pass (single-wavelength samples converted to RGB). The display map clamps them to 0, which is one reason S-02's display PSNR improves slowly.
- **The noise floor is a per-scene property.** At n = 16 the PSNR ranges from 10.8 dB (S-02) to 30.5 dB (L-03).
- The z statistic is conservative where samples are heavy-tailed (V-02, S-02: 0.00 % beyond 3), because the variance estimate itself is inflated by the rare large samples.

### What was tricky to build
- Binding once per scene: `renderScene` re-binds (and rebuilds the sky table) on every call, so the script drives `host.span` directly to render many passes for one bind.

### What warrants a second pair of eyes
- The exposure is fixed per scene from the mean of all passes. PSNR depends on it; another display mapping (the scene's own tone map, which `viewImage` does not apply) would give other numbers.
- 400 pixels per scene is a sample of 1.6 % (160 × 160) or 6.25 % (80 × 80) of the frame.

### What should be done in the future
- The same measurement on all 18 scenes and at 64 passes (the gallery's `TARGET_PASSES`) before a budget is set from it; 64-pass values in the guide are only an extrapolation at about 3 dB per doubling.

### Code review instructions
- `scripts/02-noise-floor.mjs` (`compare`, `analyse`); re-run `node scripts/02-noise-floor.mjs` (under a second, no Candela).

### Technical details
- Frame indices per scene: `[0, 2, 3, …, P]` (in each `<scene>.json`). Layout of `<scene>.f32`: Float32 little-endian, `[pass][pixel row-major][r, g, b, a]`.
- The per-pass luminance inspection was a `node -e` one-liner over `NF.load` (not kept as a script); its output for S-02: pass 30 mean 1.85e3, max 7.39e5; other passes' means 5.82–11.2.

## Step 3: Three float transformations against the exact frames and the noise floor

This step measured what the noise floor is for: three transformations the bit-exact contract forbids, applied to Candela's r0 outside the pass system, lowered by this compiler, rendered on the emulator, and judged against the exact frame (same frame index) and against the reference passes of Step 2 (different frame indices). The transformations are contraction into fused multiply-adds (an image patch), reciprocal of constant divisors, and constant reassociation (both store edits before lowering).

Contraction saves 1.62 % to 4.17 % of executed instructions. In six of eight scenes it changes no displayed 8-bit level, although it changes 151 to 895 output floats per scene. In G-01 and S-02 a few pixels follow different paths. The budget of the guide's section 14, applied to the RMS of the paired difference, rejected contraction on S-02 at 16 passes by 1.2 dB, while the independent test saw no difference. That separated two quantities the draft had merged (bias and divergence) and changed the design of the paired test.

### Prompt Context
**User prompt (verbatim):** see IRWB-010's diary, Step 1.
**Assistant interpretation:** The brief's "which RV32F instructions make which transformations pay (`fmadd.s`)" and "compile-time error against Monte Carlo noise, with statistical tests across seeds", measured rather than argued.
**Inferred user intent:** Know whether float freedom is worth a contract before designing one.
**Commit (code):** none (ticket scripts only; see the commit after this step).

### What I did
- `scripts/03-float-candidates.mjs` (header documents every rule). Variants: `exact` (r0 lowered, default options), `fma` (image patch: fusable `fmul.s` + `fadd.s`/`fsub.s` → `fmadd.s` (0x43) / `fmsub.s` (0x47) / `fnmsub.s` (0x4b) plus a `nop` (0x00000013); conditions: the add covers a value whose operand is the product, one function, no control flow or branch target between, no writes to the product's operands, no other use of its result register), `recip` (`fdiv(x, c)` → `fmul(x, fl(1/c))`, c finite, non-zero, not a power of two), `reassoc` (`fadd(fadd(x, c1), c2)` → `fadd(x, fl(c1 + c2))`, likewise `fmul`). Static sites: fma 834, recip 23, reassoc 9.
- Smoke test on B-01 alone, before the full run: images ready in 53.5 s; harness 0 differing floats; the same B-01 numbers as the full run.
- The runs, sequential, each under the cap, as one background command:
  - `systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 /usr/bin/time -v node --max-old-space-size=10240 scripts/03-float-candidates.mjs --scenes B-01,R-01,L-03,G-01,V-02,S-02,V-04 --zpasses 16 --json various/03-float-candidates.json > various/03-float-candidates.jsonl 2> various/03-float-candidates.log` → 16 min 25 s, peak RSS 2,466,336 KB, exit 0.
  - the same with `--scenes X-03 --zpasses 8` into `various/03-float-candidates-X03.{json,jsonl,log}` → 5 min 30 s, peak RSS 2,453,540 KB, exit 0.
- `scripts/05-summarize-candidates.mjs`: one line per scene and variant, with the section 14 budget at f = 0.1 (`PSNR_noise(n) + 20 + 3.01 dB`, from `various/02-noise-floor.json`) and the margin. Run with `node scripts/05-summarize-candidates.mjs various/03-float-candidates.jsonl various/03-float-candidates-X03.jsonl` (no Candela, under a second).
- Wrote the guide's section 11 and revised sections 14, 15, 19, E2, the summary box, the risks and open question 8.

### Why
- r0, not the O2 head: the image patch and the store edits are measurement devices; r0 is the reference every frame is compared with, and lowering it needs no pipeline run (IRWB-010's O2 head took 2.97 GB and 1 min 53 s).
- The `nop` patch keeps every address, so no relocation pass is needed, and it makes the saving exactly countable as the `nop`s' executions.

### What worked
- The harness: 0 of 4,800 floats differ between this compiler's exact image and the reference engine's pass 0, in all eight scenes.
- Contraction (display domain; budget at f = 0.1; margin = paired PSNR − budget):

  | scene | floats / pixels changed | pass 0 paired PSNR, max | budget, margin | N-pass means paired PSNR, max | budget, margin | saved per pixel |
  |---|---|---|---|---|---|---:|
  | B-01 | 801 / 356 | ∞, 0 | 38.2, ∞ | ∞, 0 | 47.5, ∞ | 253.2 (2.24 %) |
  | R-01 | 406 / 155 | ∞, 0 | 39.7, ∞ | ∞, 0 | 50.0, ∞ | 416.5 (1.65 %) |
  | L-03 | 700 / 350 | ∞, 0 | 40.4, ∞ | ∞, 0 | 53.5, ∞ | 175.6 (2.11 %) |
  | G-01 | 680 / 329 | 44.0, 43 | 38.9, +5.2 | 61.7, 4 | 50.9, +10.8 | 414.7 (2.15 %) |
  | V-02 | 151 / 53 | ∞, 0 | 34.6, ∞ | ∞, 0 | 38.0, ∞ | 535.4 (1.62 %) |
  | S-02 | 895 / 362 | 39.8, 81 | 31.5, +8.3 | 32.6, 179 | 33.8, **−1.2** | 880.4 (2.44 %) |
  | V-04 | 813 / 360 | ∞, 0 | 39.2, ∞ | ∞, 0 | 48.9, ∞ | 3,650.9 (3.35 %) |
  | X-03 | 358 / 126 | ∞, 0 | 31.0, ∞ | ∞, 0 (N = 8) | 40.6, ∞ | 15,292.5 (4.17 %) |

- Reciprocal: floats changed only in S-02 (755 in 366 pixels), V-04 (11 in 6) and X-03 (1 in 1); no display change; instructions per pixel unchanged or up by 2 (V-02), 15 (V-04), 1 (X-03).
- Reassociation: 77 / 92 / 46 / 87 floats changed in B-01 / L-03 / G-01 / V-04, none elsewhere; no display change; 5 to 22 instructions per pixel saved.
- The independent test: for every variant and scene, the share of |z| > 3 equals the exact null's; mean z² equal to three decimals except fma in G-01 (1.0141 against 1.0163) and S-02 (0.9869 against 0.9867).

### What didn't work
- The budget formula as drafted: it rejects contraction on S-02 at 16 passes (32.6 dB against 33.8 dB) where the independent test finds nothing. Not a defect of the measurement but of the draft design: the RMS of the paired difference includes divergence, which is noise. The guide's section 15 now proposes a bias estimate (signed mean with standard error), a diverged-pixel count, and the independent test on the diverged pixels.
- A `node -e` summary one-liner with a heredoc into the scratchpad was refused by the worktree isolation check ("too complex to verify that it stays inside the worktree"); kept as `scripts/05-summarize-candidates.mjs` instead, which is better anyway because the guide's tables come from it.

### What I learned
- A last-bit change inside a path tracer is invisible unless it flips a decision; where it flips one, the pixel becomes a fresh sample, and in a firefly-prone scene (S-02) a fresh sample can be 179 levels after 16 passes.
- Path divergence also shows in the instruction counts: G-01's fma variant executes 19,483 instructions per pixel against 19,293, S-02's 36,004 against 36,038, X-03's 367,067 against 367,086.
- The reciprocal is not merely free of gain on the emulator; it can cost an instruction per execution (likely `fl(1/c)` needing `addi` where `c` needed only `lui`; not attributed).

### What was tricky to build
- Fusion legality on finished machine code: the script uses `covers` to pair the add with its product and scans the instructions between them for control flow, branch targets and register conflicts. A wrong fusion would show as a large paired difference with no divergence explanation; none appeared, but the check is a measurement, not a proof.

### What warrants a second pair of eyes
- The fusion conditions in `03-float-candidates.mjs` (the scan between the pair). Fused register reads were checked by the harness only indirectly.
- The classification of the S-02 and G-01 differences as divergence rests on their concentration (top 1 % of squared differences carry over 99.9 %) and on the changed instruction counts, not on per-pixel path traces.

### What should be done in the future
- E2 with the separated paired test; the signed-mean bias estimate needs the variant's passes saved, which this script does not do.
- The vault report is deferred to the implementation milestone (see Step 1).

### Code review instructions
- `scripts/03-float-candidates.mjs` (the `fma` patch and the two store edits); `scripts/05-summarize-candidates.mjs`; re-run the summary over the committed JSONL.

### Technical details
- Exact instructions per pixel (pass 0, this compiler's r0 image): B-01 11,300; R-01 25,308; L-03 8,307; G-01 19,293; V-02 33,054; S-02 36,038; V-04 108,839; X-03 367,086.
- JSON numbers: an infinite PSNR is serialized as `null` (identical display).

## Step 4: Second reading, revisions, and the upload

This step reread the guide whole as its reader, recorded the problems before revising, fixed them, and uploaded it. The guide is 534 lines in six parts, with section 11 written from Step 3.

### Prompt Context
**User prompt (verbatim):** see IRWB-010's diary, Step 1.
**Assistant interpretation:** A second pass as the reader, then the upload with the given name and directory, verified by a listing.
**Inferred user intent:** The idea preserved in a form someone else can start from.
**Commit (code):** d0e6415 (second pass, tasks, relations), d502f9a (section 11, Step 3); this step's diary entry is in the next commit.

### What I did
- Notes from the reading, before revising:
  1. The budget formula compared a paired PSNR with the PSNR of two *independent* means without the factor √2 between them. It is now `PSNR_noise(n) + 20 log10(1/f) + 3.01 dB`, which is 23 dB at f = 0.1.
  2. Section 16's arithmetic: a bias at 1 % of one pass's noise is 8 % of the noise at 64 passes (the draft said "far below"), and at 10 % it is 80 %. Corrected.
  3. Three cross-references said "section 9" for the noise floor, which is section 10.
  4. Section 10 claimed the reference image is bit-identical with the evaluator, citing one IRWB-001 step. It now cites steps 17 and 26 and this ticket's own harness check.
  5. V-02's and S-02's spread was "three times the others'"; it is now the measured ranges.
  6. After Step 3, the RMS budget rejects contraction on S-02 while the independent test does not. Sections 14 and 15 now bound the bias by the signed mean and send diverged pixels to the independent test. A risk row and open question 8 were added. The summary box, section 19's status column and E2's predicted saving now use the measured figures.
- `docmgr`:
  - tasks E0 and E0b (checked), E1–E5, and the guide task (checked);
  - seven files related to the guide, and the guide and diary related to the index;
  - WhatFor and WhenToUse; the index overview and summary; the changelog;
  - `docmgr doctor --ticket IRWB-011` → "All checks passed".
- Upload: `remarquee upload bundle …/design-doc/01-sketch-guide-image-level-contracts-for-float-freedom.md --name "IRWB-011 Sketch: Image-Level Contracts for Float Freedom" --remote-dir "/ai/2026/11/26/IRWB-011" --toc-depth 2 --non-interactive` → `OK: uploaded IRWB-011 Sketch: Image-Level Contracts for Float Freedom.pdf -> /ai/2026/11/26/IRWB-011`. `remarquee cloud ls /ai/2026/11/26/IRWB-011 --long --non-interactive` → `[f]	IRWB-011 Sketch: Image-Level Contracts for Float Freedom`.

### What worked
- The upload and the listing above.

### What didn't work
- A shell heredoc appending this step was again refused by the worktree isolation check ("too complex to verify that it stays inside the worktree"). I appended it with the editor.

### What I learned
- The measurement corrected the design. Without the S-02 run, the draft's paired test would have rejected a transformation that the independent test accepts.

### What warrants a second pair of eyes
- An author's second reading is not an independent review.
- The proposed separation of bias and divergence (section 15) is untested: no script yet computes the signed mean with its standard error.

### What should be done in the future
- Experiments E1–E5 (tasks). The vault report is deferred to the implementation milestone.
