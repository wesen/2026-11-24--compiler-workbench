---
Title: Research diary
Ticket: IRWB-023-F
Status: active
Topics:
    - compiler
    - ir
    - verification
    - gpu
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-023-F--what-compiler-work-would-make-tix-best-in-class/prototypes/01-schedule/main.cu
      Note: |-
        Tiled, fused and reassociated kernels with exact bit comparisons
        Exact and reassociated kernels
    - Path: repo://ttmp/2026/11/26/IRWB-023-F--what-compiler-work-would-make-tix-best-in-class/prototypes/02-transcendental/main.cu
      Note: Double, expf and Ziv-guarded exp plus the f32 word-space sweep
    - Path: repo://ttmp/2026/11/26/IRWB-023-F--what-compiler-work-would-make-tix-best-in-class/scripts/01-schedule-probe.mjs
      Note: Experiment 1 driver
    - Path: repo://ttmp/2026/11/26/IRWB-023-F--what-compiler-work-would-make-tix-best-in-class/scripts/03-tolerance-and-coverage.mjs
      Note: Budget fraction versus reduction length, and gate cost
    - Path: repo://ttmp/2026/11/26/IRWB-023-F--what-compiler-work-would-make-tix-best-in-class/scripts/04-gate-evasion.mjs
      Note: |-
        A lowering defect the shipped check accepts
        Experiment 4, a defect the gate accepts
ExternalSources: []
Summary: Chronological record of the IRWB-023-F research round, including the four experiments and the five failures.
LastUpdated: 2026-11-26T22:20:00-05:00
WhatFor: ""
WhenToUse: ""
---

# Research diary

Worktree `r2b-ds-x-irwb-023-f`, branch at entry `12bc661`. The round was a research
round: nothing under `src/`, `tests/`, `corpus/` or `tools/` was modified. All
probes live in `prototypes/` and `scripts/` inside this ticket, and import from
`dist/` after `npm run build`.

## Step 1. Reading the two prior stages and forming the question

I read the stage-1 design and report (IRWB-020-B) and the stage-2 design and report
(IRWB-022-I), then the tensor sources (`model.ts`, `ir.ts`, `passes.ts`,
`evaluate.ts`, `contract.ts`, `cuda-source.ts`, `cuda-runtime.ts`) and
`tools/cuda-remote.mjs`.

Three facts from those documents shaped everything afterwards.

1. The stage-1 meaning is *total and exact*: `evaluate.ts` rounds at every operator,
   folds sums left to right in increasing lexicographic index order, and defines
   `exp/log/tanh` as `Math.fround(Math.<fn>(x))`. That is a specification, not an
   approximation.
2. The stage-2 lowering emits one kernel per statement, one thread per output
   element, and reproduces those rounding sites with explicit intrinsics. It is
   bit-identical to the f32 meaning on every case the coordinator measured.
3. The two checked relations are sampled: `inline` uses exact comparison on the
   gate's cases; `split-sum` and the CUDA lowering use
   `|c − r| ≤ 2e-6 + 2e-5|r|` against the origin in f64 on cases generated from
   extents 1, 3, 4, 7 and a mixed 3/5/7 assignment, with tensors capped at 4,096
   elements.

The question I set myself: *what is the smallest set of changes that turns
"bit-identical, but 6× off cuBLAS and verified by sampling" into "fast, and
verified by argument"?* My first hypothesis was that the exact f32 meaning is a
performance *constraint* whose cost could be measured, so I set out to measure its
price before proposing anything.

## Step 2. Experiment 1 design: compare schedules on the same inputs

The measurement problem is that the interesting quantity is "the same program,
scheduled differently". So the probe had to compare against the *shipped* lowering
on identical input bytes, not against a rewrite of it.

`scripts/01-schedule-probe.mjs` therefore does four things: builds `inputs-*.bin`
in the tool's request format with a seeded LCG; emits `cudaSource()` for the real
corpus program into `work/matmul-tix/` and `work/softmax-tix/`; runs both through
`tools/cuda-remote.mjs --timed --runtime-input inputs.bin`; and runs one hand-
written `main.cu` that reads the same two files and writes every variant's output
for comparison. The probe's `v0` and `s0` kernels are transliterations of the
emitted kernels, which gives a cross-check: if the transliteration is not
bit-identical to the emitted program, the comparison is meaningless.

The variants encode the theory I was testing: `t4`, `t4s`, `t8`, `t8s` keep the
per-output fold chain and only change *where* work happens (Corollary 1 of the
document's Theorem 1), whereas `r4` (four interleaved accumulators) and the
block-per-row softmax reassociate the chain (Corollary 2).

### Failures on the way, part 1

- `mm_shared(I M, I K, I N, const float* A, const float* B, ...)` did not compile:
  the template parameter `B` (k-panel depth) collided with the pointer name. Fixed
  by renaming to `pa`/`pb`. Round trip is ~11 s, so one compile error is a real
  cost at this cadence.
- My shared-memory staging loops were written as
  `for (int kk = ty; kk < B; kk += 16)`, which loads only the rows of the panel
  whose index matches `threadIdx.y` modulo 16 — for `B = 16` only row 0 was ever
  filled. Replaced with a flat `tid`-strided loop over (row, k) pairs.
- The first fused softmax staged each row in a per-block `extern __shared__`
  buffer while 256 threads each owned a different row. Every thread overwrote its
  neighbours' staging area, so all 4,194,304 outputs differed. Fixed by reading the
  row from global memory (4 KiB, cache-resident). This is recorded in the document
  as failure (e) because the bug class — shared state indexed by a block-wide id
  while threads own disjoint work — is exactly what a structural certificate
  catches and a sampled gate catches only by luck.

## Step 3. Experiment 1 results

Matmul 512³: emitted 0.2203 ms (my run of the emitted program) / 0.2068 ms (the
transliteration, which is what the table compares against), `t4` 0.1117, `t4s`
0.1027, `t8` 0.1679, `t8s` 0.1374, `r4` 0.0904. Bit comparisons: `v0`, `t4`, `t8`,
`t4s`, `t8s` all 0 differing words out of 262,144; `r4` 245,020 differing.

Softmax 4096×1024: emitted/`s0` 0.788–0.813, fused-row-double 1.349, fused-row with
256 threads/block 2.376, fused-row with `expf` 0.504, block-per-row tree 0.713,
Ziv-guarded row 1.750. Bit comparisons: fused-row-double 0 differing; `expf` 37.5%
differing; tree 97.3% differing (≤33 ulp).

Two of these were not what I expected. I expected the fused softmax to win on
bandwidth and it lost by 1.7×; the reason is that the specified `exp` is a
double-precision call evaluated twice per element in that kernel. And I expected
the reassociated matmul to be much faster than the exact tile; it was 12% faster.
That 12% is the number the whole document is built on: **at 512³ the price of
exactness is at most 14%**, and the remaining distance to cuBLAS is a schedule
problem (vector loads, deeper panels, double buffering, tile search), not a
meaning problem.

I also learned that the emitted program's own `gpuMs` (0.2203, a median of 3) and my
transliteration (0.2068, a median of 7) differ by 6%, which is inside the run-to-run
variation the coordinator warned about. Both are reported.

## Step 4. Experiment 2: is the transcendental layer the real cost, and can it be proven?

The `expf` result (2.7× faster, 37.5% wrong) framed a question that is specific to
f32: *the meaning only pins the rounded result, and the input space is finite, so
can the transcendental layer be verified exhaustively?*

`prototypes/02-transcendental/main.cu` answers three things in one program: the
softmax kernel with three exponential implementations, and a word-space sweep that
compares `expf`, `tanhf` and a Ziv-guarded version against
`__double2float_rn(exp((double)x))`.

### Failure: the guard was vacuous, then unsound

I picked a 2⁻¹⁸ relative acceptance interval, i.e. ~64 ulps, for the guard. Two
consequences, both measured:

- On real softmax values the guard fires never (100% fallback, 1.750 ms — 30%
  slower than just calling the double routine). The interval is simply too wide for
  the interval to land inside one f32 word.
- In the sweep the guard was wrong in 1,262 of 2.147×10⁹ words, all at the
  under/overflow edges, where `expf` returns 0 or `inf` while the reference returns
  a denormal or a finite value: the assumed *relative* error bound is false there.

So my first attempt at a fast, exact exponential failed, and the failure is the
most useful thing this experiment produced: the guard's interval must be
established per range, and the establishment is exactly the exhaustive sweep. The
sweep itself is the good news: 2.147×10⁹ words in 506 ms, so all 2³² words would
take about one second. **Verifying a transcendental implementation over the entire
f32 input space is a test, not a research programme.**

## Step 5. Experiment 3: is the tolerance verdict a property of the program?

I wanted to know whether the flat budget `2e-6 + 2e-5|r|` is scale-invariant.
`scripts/03-tolerance-and-coverage.mjs` evaluates, for a sweep of shapes, the honest
f32 meaning against the f64 reference and reports the fraction of the budget the
worst element consumes — once for the sequential origin and once for a split-sum
revision built directly (not through the gate).

Result: the fraction grows with reduction length and with cancellation. matmul
64×256×64 uses 1.62 of the budget, 64×512×64 uses 1.70, 64×1024×64 uses 3.65. Above
1.0 the relation cannot admit *any* candidate, including a bit-identical one. The
gate's own domain (extents 1/3/4/7, ≤4096 elements, inputs in [−1,1]) sits between
0.003 and 0.27, so it never sees this.

This reframed the whole round. The problem is not that the tolerance is too loose or
too tight; it is that **its verdict is a property of the sample, not of the
program**, and the sample is unrepresentative of the shapes the compiler is used at.
It also explains why softmax looks so easy (budget fraction under 0.02 at every
length, because its outputs are in [0,1] and cannot cancel) while matmul looks
impossible: one constant is being asked to cover two entirely different error
regimes.

### Failure: a shape-thresholded rewrite cannot be expressed at IR level

My first attempt at the evasion experiment was a stage-1 rewrite: "split into blocks
of four, but take a floor-based block count when the extent is at least 8". It is
inexpressible: at rewrite time the extent is a *symbolic name*, not a number, so my
mutant applied `floor` to every extent and the real gate rejected it correctly. That
failure is itself a finding: shape-dependent specialisation lives in the *lowering*,
where shapes are known — which is exactly where the sampled check looks least.

## Step 6. Experiment 4: a defect the shipped check accepts

I moved the mutation one level down, to the emitted CUDA:
`const I end_i2 = (d1);` became
`const I end_i2 = ((d1) < 8LL ? (d1) : (d1) - 1LL);` — a plausible "peel the last k
step once the reduction is long", with an off-by-one. The unmodified
`checkCudaLowering` returned `accepted: true`. At extent 16 the mutant's error is
4,018× the budget on a hand-checked 2×16 by 16×2 case: reference
`[168, 185, 190, 199]`, mutant `[166, 177, 186, 183]`.

Nothing is broken in the check; it certifies extents 1–7 and says so, in the sense
that the case recipe is in the source. The lesson is that a sampled gate's claim is
about its domain, and a compiler that reports "accepted" invites the reader to
believe more than that. This is what proposals P1 (certificates) and P5
(coverage-directed cases) are for.

I also measured the marginal cost of a wider domain, because the obvious objection
to P5 is runtime: one f32 metered evaluation of an 8×K tensor costs 6.7 µs at K=1,
20.9 µs at 8, 68 µs at 16, 155 µs at 64 and 1.95 ms at 1024. Adding six extents to
the assignment list is cheap compared with the 2.5 s remote round trip a lowering
check already pays (warm compile 3 ms, cold 1.5 s, plus transport, upload and
download).

## Step 6b. Experiment 5: a prediction, only half confirmed

With the time left I tested the prediction that the price of exactness explodes when
the fold is the only parallelism. `prototypes/03-reduction-limited/main.cu` times a
matrix-vector product four ways, 200 launches per timed interval (a single launch is
too close to overhead to measure):

| problem | exact | 2 accumulators | 4 accumulators | warp tree |
| --- | ---: | ---: | ---: | ---: |
| M=1024, K=1024 | 0.0594 ms | 0.0594 ms | 0.0594 ms | 0.00615 ms |
| M=1024, K=8192 | 0.4932 ms | 0.7150 ms | 0.7147 ms | 0.1159 ms |

The warp tree is 9.7× faster and 4.3× faster, and differs on 971–1007 of 1024
outputs. But the experiment does not isolate the fold: the interleaved accumulators
are dynamically indexed (`acc[k & (W-1)]`), spill to local memory, and at K=8192 are
*slower* than the exact kernel, so they are not a valid upper bound; and the warp
variant also fixes the coalescing, since one-thread-per-output with row-major `A`
makes a warp read 32 rows at stride K. I recorded this in the design document as
failure (e) and left the prediction explicitly untested. The experiment I would run
next is an exact kernel that keeps the fold order but stages an `A` tile through
shared memory with coalesced loads — permitted by Theorem 1.

Compile errors in this step: `uint64_t`/`uint32_t` needed `<cstdint>` (951 ms cold
compile, then 2995 ms of measurement).

## Step 7. Decisions about what to propose, and what to leave out

I decided early to define best in class on two axes (guarantee strength and the
*price* of the guarantee) rather than one (raw speed), because a single-axis
definition makes the honest recommendation "delete the exact meaning", which is the
opposite of what the framework exists for. The measurement that makes the two-axis
definition defensible is the 14% price on matmul.

I considered and rejected:

- **Chasing cuBLAS with tensor cores or TF32.** Faster, but it changes the meaning
  and would need a third semantic mode with its own error contract — the same work
  as P3 with a worse guarantee. Left out of the ranking entirely.
- **A kernel IR between Tix IR and CUDA.** Stage 2 considered and rejected it; my
  P1 needs an expression map, not a second IR, and the certificate can be emitted
  from the same traversal that prints the kernel.
- **Presenting reproducible summation (P3) as a change to `sum`.** It cannot be:
  an exact sum has a different meaning from a serial f32 fold, so it must be a
  second mode with a checked refinement, and the document says so.
- **Measuring the price of exactness on a reduction-limited program (matvec).** I
  predict the price explodes when the reduction is the only parallelism available,
  but I ran out of time and did not measure it. It is written into the document as a
  hypothesis with a designed experiment, not as a result.

Ranking: P1 first because it is pure gain and enables the rest; P2 second because it
is the largest measured single win and its verification method is a one-second test;
P3+P4 third because they change the language and need P1's machinery; P5 is folded
into the staged plan as the cheap mend for §6.4.

## Step 8. What I would do with another day

1. Measure the exact tile with vectorised loads and a searched tile shape, to find
   out how much of the 3× to cuBLAS is reachable inside the exact class. My `E(P,s)`
   is a naive upper bound, so `price ≤ 1.14` is pessimistic.
2. Measure a matvec (N outputs, K-fold, N comparable to the thread count) where the
   fold is the only parallelism, to test the prediction that the price of exactness
   is large exactly there.
3. Write the faithful f32 `exp` and re-run the sweep, to convert P2 from "measured
   headroom, failed prototype" into "measured win".
4. Implement the schedule certificate for the matmul emitter only, and count the
   mutants it rejects that the sampled gate accepts.
5. Isolate the tree `max`: my block-per-row softmax changes both the max and the sum,
   so the claim that a tree max is value-exact (`x&y` for mixed zeros, canonical NaN)
   is reasoned, not measured.

## Step 9. Reproduction

```
npm run build
node <ticket>/scripts/01-schedule-probe.mjs        # GB10, ~16 s, both programs
node <ticket>/scripts/02-transcendental-probe.mjs  # GB10, ~25 s, 2.1e9-word sweep
node <ticket>/scripts/03-tolerance-and-coverage.mjs  # CPU only
node <ticket>/scripts/04-gate-evasion.mjs          # GB10, ~15 s
```

Raw results: `reference/experiment-01-schedule.json`,
`reference/experiment-02-transcendental.txt`,
`reference/experiment-03-tolerance.json`,
`reference/experiment-04-gate-evasion.json`. Working directories under
`prototypes/work/` (inputs and fetched outputs, ~137 MB) are regenerated by the
scripts and are not committed.
