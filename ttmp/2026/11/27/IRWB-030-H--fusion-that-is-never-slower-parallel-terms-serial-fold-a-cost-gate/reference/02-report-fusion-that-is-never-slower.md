---
Title: 'Report: fusion that is never slower'
Ticket: IRWB-030-H
Status: active
Topics:
  - tensor
  - gpu
  - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
  - Path: repo://src/tensor/fusion.ts
    Note: stageTerms, terms and serial in the plan, fusionGate and groupRow
  - Path: repo://src/tensor/cuda-source.ts
    Note: staged-term prologue and order-preserving fold in block mode
  - Path: repo://src/tensor/index.ts
    Note: shapes option, launchShapes, loweredTix
  - Path: repo://src/tensor/cuda-contract.ts
    Note: the artifact records each kernel's staged reductions
  - Path: repo://tests/tensor/fusion-terms.test.mjs
    Note: plan, source and gate tests (no GPU)
  - Path: repo://tests/tensor/fusion-terms-gpu.test.mjs
    Note: GB10 exactness of staged terms, mutants, the gate's launch
ExternalSources: []
Summary: Stage 3b of Tix. A row reduction's terms are computed by the whole block and folded in the meaning's order by one thread (layernorm-inside 0.216 against 0.561 ms); a launch-time gate keeps stage 2's lowering when a block-mode row is shorter than a warp. Bit-identical everywhere, one kernel per corpus program, no framework change.
LastUpdated: 2026-11-27T04:10:00-05:00
WhatFor: Final report of stage 3b (IRWB-030-H)
WhenToUse: Reviewing how terms are staged, what the gate costs, what was measured and what was only argued
---

# Report: fusion that is never slower

Stage 3 fuses every legal producer-consumer chain, and on one program family it was not faster: when a row
reduction divides *inside* the sum, block mode made thread 0 of each row's block run the whole reduction, one
serial division chain per row, where stage 2 had one thread per row across the grid. Measured on the merged stage
3, `layernorm-inside` was 0.573 ms fused against 0.569 unfused.

Stage 3b does two things. It computes a row reduction's **terms in parallel** and accumulates them **in the
meaning's order**, which is bit-identical by construction. And it **gates fusion** on a measured rule, so that a
program whose block-mode rows are too short to keep a warp busy runs stage 2's lowering instead.

All six corpus programs still lower to one kernel and remain bit-identical to the f32 meaning. `layernorm-inside` is
now 0.216 ms fused against 0.561 ms unfused (2.6×). No framework source and no tool changed; the finding is that a
profitability decision has no place in a semantic contract, so it lives in the driver and is measured, not checked.

The code is at the last commit of branch `t3b-ds-x/irwb-030-h`. Every script named below is in `scripts/`, numbered in
the order it was written, with its output committed beside it.

## Results

Sizes are the brief's (`scripts/01-programs.mjs`). Kernel count is the number of `__global__` definitions in the
source that the call actually runs, gate included. GPU time is `runTixCuda(..., { benchmark: true })` — one warm-up
launch and the median of three CUDA-event intervals, under the runner's `--timed` lock — and the table gives the
**median of three such calls**, with the three call medians in brackets (script 02, output
`scripts/07-final.out.jsonl`). Inputs are seed 20, f32 values in [−0.1, 0.1], layernorm's eps = 1e-5.

| Program | Kernels fused / unfused | Fused ms (3 calls) | Unfused ms (3 calls) | Unfused ÷ fused |
| --- | ---: | --- | --- | ---: |
| matmul, M = K = N = 512 | 1 / 1 | 0.218 (0.216, 0.218, 0.223) | 0.213 (0.211, 0.213, 0.215) | 0.98 † |
| softmax, N = 4096, C = 1024 | 1 / 4 | **0.387** (0.381, 0.387, 0.389) | 0.822 (0.819, 0.822, 0.822) | 2.12 |
| layernorm, N = 4096, D = 1024 | 1 / 4 | **0.198** (0.175, 0.198, 0.213) | 0.474 (0.467, 0.474, 0.474) | 2.39 |
| attention, Q = K = 1024, D = V = 64 | 1 / 6 | **0.753** (0.751, 0.753, 0.779) | 1.186 (1.052, 1.186, 1.244) | 1.58 |
| mlp, N = 1024, D = 256, H = 1024, O = 256 | 1 / 3 | **0.727** (0.725, 0.727, 0.728) | 0.956 (0.937, 0.956, 1.027) | 1.31 |
| conv2d, N = 8, C = 16, H = W = 64, O = 32 | 1 / 1 | 0.166 (0.166, 0.166, 0.169) | 0.182 (0.179, 0.182, 0.185) | 1.10 † |
| **layernorm-inside** | 1 / 4 | **0.216** (0.212, 0.216, 0.223) | 0.561 (0.559, 0.561, 0.577) | 2.59 |
| **attention-inside** | 1 / 5 | **1.413** (1.412, 1.413, 1.414) | 1.486 (1.477, 1.486, 1.542) | 1.05 |

† matmul and conv2d have one statement each, so the fused and unfused lowerings are **the same bytes**: `cudaSource`
with `fuse: true` and `fuse: false` are byte-identical (checked in `fusion.test.mjs`, and digests equal in script
05). The difference in those two rows is measurement noise. Repeating the measurement of the same source: conv2d
0.1651, 0.1661, 0.1656, 0.1664 and 0.1822 in five separate calls, matmul 0.2074…0.2231 — so this shared machine's
noise is 2–10% on these 0.2 ms kernels, above the brief's 2%. Every fused and unfused output had the same SHA-256.

**Which reductions use parallel terms** (script 08, `scripts/08-plan-report.mjs`), for every block-mode kernel:

| Program | Kernel | Mapping, block domain | Reductions with parallel terms | Reductions kept serial |
| --- | --- | --- | --- | --- |
| softmax | m, e, s, y | block, [N] | — | `m` (max over a row buffer), `s` (load plus add) |
| layernorm | mean, centered, variance, y | block, [N] | — | `mean` (load plus add), `variance` (one product) |
| **layernorm-inside** | mean, centered, variance, y | block, [N] | **`mean` (division per term), `variance` (product and division per term)** | — |
| attention | score, shift, e, z, weight, out | block, [Q] | — | `score`, `out` (per-element), `shift`, `z` (row-buffer loads) |
| attention-inside | score, shift, e, z, out | block, [Q] | — | as above |
| mlp | h, g, y | block, [N] | — | `h`, `y` (per-element), none of rank 1 |
| matmul, conv2d | y / out | thread, stage 2 | — | (thread mode) |

So the price list changes exactly one corpus variant, which is the one the brief names, and leaves the six corpus
programs' kernels' instructions unchanged: script 05's before/after digests differ only in the plan comment line for
softmax, layernorm, attention and mlp, and not at all for matmul and conv2d; the six `fuse: false` digests are
unchanged, i.e. stage 2's lowering is still byte-for-byte what it was.

**Stress variants** (script 02, `scripts/11-stress.out.jsonl`, one call each — these are here to test the gate, not as
headline timings; the few-block ones are unstable):

| Variant | Size | Gate | Kernels fused / unfused | Fused ms | Unfused ms |
| --- | --- | --- | ---: | --- | --- |
| softmax, many short rows | N = 262144, C = 16 | **unfused** | 4 / 4 | 0.760 | 0.663 |
| layernorm, many short rows | N = 262144, D = 16 | **unfused** | 4 / 4 | 0.410 | 0.410 |
| softmax, wide rows, 8 rows | N = 8, C = 524288 | fuse | 1 / 4 | 29.8 | 52.0 |
| softmax, one row | N = 1, C = 4194304 | fuse | 1 / 4 | 212 | 395 |
| layernorm, many long rows | N = 65536, D = 256 | fuse | 1 / 4 | **0.601** | 2.278 |
| row-mul (product of two rows) | N = 4096, C = 1024 | fuse | 2 / 3 | 0.337 | 0.339 |
| row-exp (exp in a rank-1 group) | N = 4096, C = 1024 | fuse | 1 / 2 | 1.104 | 1.108 |

The two gated rows show identical sources on both sides (4 kernels), which is the gate working; their measured
difference is noise, and on this short-row program that noise is the largest I saw: the same bytes measured twice
differed by up to 15% (0.760 against 0.663 in one session, 0.696 against 0.730 in another).

## How terms are staged

In block mode a member is computed by `for (e = threadIdx.x; e < n; e += blockDim.x)`, so a member of rank equal to
the block depth has `n = 1` and only thread 0 runs it. For such a *row-scalar* member, a `reduce` node chosen by the
plan emits a term loop **before** the member's loop, with the whole block, and the folding thread then reads it:

```cpp
// t's sum over 1 axis: the block computes the terms, thread 0 folds them in order
for (U t = threadIdx.x; t < (d1); t += blockDim.x) {
  U rest = t;
  const I i2 = rest % (d1);
  float v0 = __fdiv_rn(r0[(i2)], __ll2float_rn(d1));   // the same scalar code stage 2 emits
  terms0[t] = v0;
}
__syncthreads();
for (U e = threadIdx.x; e < n1; e += blockDim.x) {
  float v1 = 0.0f;
  for (U t = 0; t < (d1); ++t) v1 = __fadd_rn(v1, terms0[t]);   // the meaning's fold, one thread
  r1[e] = v1;
}
```

Term `t` is decoded in the same lexicographic order the serial loop used (first axis outermost), by the same tree
walk, with the same explicit round-to-nearest intrinsics and the same double `exp`/`log`/`tanh` rounded once. Slot
`t` therefore holds the term the serial fold would have had at step `t`; the fold starts at `+0` (`sum`) or `−∞`
(`max`), adds or `max_nan`s in increasing order and rounds after each step, exactly as before. A term is an
expression with no accumulator in it (Tix has no accumulator variable), so moving it to another thread cannot change
its value; loads, shared stores and shared loads move f32 words unchanged, and the barrier orders the writes before
the fold. So the reduction's value is the meaning's word, and everything outside the reduction is untouched code.

**The region.** A block's row buffer gains one term region, sized on the device and on the host from the same shape
values. Each staged reduction of a member gets its own slots, because all of a member's prologues run before its
fold; members are separated by barriers, so the region is reused from member to member and its size is the largest
member's total. For `layernorm-inside` the block buffer goes from 2,050 to 3,074 floats (8.2 KiB to 12.3 KiB), which
costs resident blocks — and the kernel is still 2.6× faster than unfused, so the trade is measured, not assumed.

**Which bodies stage, from the IR** (`stageTerms` in `src/tensor/fusion.ts`): a term is staged when it has a
division, a square root, a double transcendental (`exp`, `log`, `tanh`), or a read of a tensor that is not in a row
buffer (a global read, which then runs in parallel). Everything else keeps the folding thread's loop, with the
reason recorded in `plan.groups[i].serial`. The prices come from script 06 (below).

**Refused term stagings**, each with a reason in the plan:

- **A reduction inside a member with trailing axes** — `attention`'s `score[i,j] = sum(d) q*k/sqrt(D)` and its
  `out[i,c] = sum(j) e*v/z[i]`. Every element has its own accumulator in its own thread; there is nothing to share.
  This is why `attention-inside` stays at 1.41 ms: its cost is 67 million divisions (1 Mi scores × 64 terms plus
  65 Ki outputs × 1024 terms) that no term staging can spread out.
- **A nested reduction** (inside another reduction's body): it would need one term buffer per outer term. In
  `(sum(j) x/C) + (sum(j) x*x/C)` the second reduction *is* inside the first's body and stays inline.
- **A split (`blocks` or `tail`) bound**: the row buffer is sized on the host from shape values alone, so a
  bound that depends on an outer index cannot size it. The corpus after `split-sum` keeps its serial folds.
- **Any thread-mode group**: one thread per element, each with a private accumulator.
- **A reduction whose body is no dearer than the staging**: measured, see below. Staging a bare row-buffer load
  costs exactly nothing (1.00), a product costs 2% (0.98) and a max fold over a row buffer 1% (1.01). Those stay
  serial.

### The price list (script 06, `scripts/06-term-price.out.jsonl`)

Same program, staged against serial (the same plan with `terms` cleared, i.e. stage 3's block mode), row length
1024, 4096 rows; outputs bit-identical in every row:

| Term body | Serial ms | Staged ms | Serial ÷ staged | Plan |
| --- | ---: | ---: | ---: | --- |
| load of a staged row | 0.1475 | 0.1474 | 1.00 | serial |
| product of two staged rows | 0.2227 | 0.2282 | 0.98 | serial |
| load / C | 0.2531 | 0.1292 | **1.96** | staged |
| `exp` | 12.04 | 0.3813 | **31.6** | staged |
| staged row × global vector | 0.1620 | 0.1572 | 1.03 | staged |
| max fold over a row buffer | 0.1468 | 0.1457 | 1.01 | serial |
| `(sum x/C) + (sum x*x/C)` | 209.6 | 4.82 | **43.5** | staged (outer only) |

A staged term costs a shared store, its share of a barrier and a shared load, so bodies whose terms are arithmetic
steps gain nothing and the two cheapest rows say so. Division and the transcendentals gain 2–32×, and the global
read 3%, which is why it is on the list: the read itself becomes parallel.

## The fuse gate

**The rule.** When a block-mode group's longest row `L` is shorter than one warp (`L < 32`), the launch keeps stage
2's lowering; the plan records the kernel, the row length and the reason. Nothing else gates.

**The measurement behind it** (script 03, `scripts/03-row-lengths.out.jsonl` and
`scripts/03-row-lengths-gate.out.jsonl`): block mode covers a row of `L` elements with `ceil(L/32)*32` lane slots,
so a short row leaves lanes idle on every parallel phase, while stage 2's flattened kernels keep them busy and
simply move more tensors. A fixed 4 Mi elements, swept over the row length:

| Row length `L` | 8 | 16 | 32 | 64 | 128 | 256 | 1024 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| softmax, unfused ÷ fused, before the gate | 0.39 | 0.91 | 1.76 | 1.85 | 1.82 | 1.88 | 2.13 |
| normalize, unfused ÷ fused, before the gate | 0.48 | 1.53 | 2.26 | 2.69 | 2.57 | 2.84 | 2.99 |
| after the gate: softmax, gate / kernels / ratio | unfused, 4/4, 1.00 | unfused, 4/4, 0.99 | fuse, 1/4, 1.77 | — | — | — | — |
| after the gate: normalize, gate / kernels / ratio | unfused, 4/4, 1.00 | unfused, 4/4, 1.04 | fuse, 1/4, 2.37 | — | — | — | — |

Fusion loses at `L = 8` for both programs (4× waste), is program-dependent at `L = 16` (2× waste: the `exp`-bound
program lost 9%, the traffic-bound one won 53%), and wins from `L = 32` on (no waste). The gate sits at the warp
boundary. It is **deliberately conservative**: at `L = 16` it also refuses `normalize` and `layernorm`, where fusion
would have won 1.4–1.5×, because at 2× waste the sign of the outcome depends on how compute-bound the body is, and a
gate that is wrong in the other direction would break this stage's promise. The measured cost of that conservatism
is visible in the stress table: `layernorm-short-rows` (D = 16) ran 0.410 ms gated, where the ungated fused kernel
measured 0.301 ms in the pre-gate session (`scripts/02-baseline-variants.out.jsonl`); gated it is still not slower
than unfused.

**Where it lives, and what that costs.** `fusionGate(plan, fn, dims)` is pure, in `src/tensor/fusion.ts`.
`runTixCuda` calls it with the extents of the launch's own inputs; `cudaSource` applies it when given the optional
`shapes` argument and otherwise emits the plan-time lowering, which is what `checkLowering` verifies; the new
`loweredTix(program, fn, options)` returns exactly what a call would run (source, plan, gate), so scripts and tests
read the decision instead of guessing it.

The cost of that placement: one artifact per program, but the gate is per launch shape, so a call can run a
different artifact than the one that call's `checkLowering` would produce. It is always one of the two exact
lowerings the contract knows, and when the gate fires the source is byte-identical to `fuse: false`'s, which
`checkLowering(program, fn, { fuse: false })` verifies. Making the gate part of the checked artifact would need the
launch's shapes inside the program object, which Tix does not have (see the framework finding below).

**Refused as a gate rule.** Estimating the two lowerings' times from a cost model — compulsory traffic at 244 GB/s
plus a per-op price list — would fire more precisely than one hardware constant, but every coefficient would be
calibrated on this one GPU, and the measured boundary already coincides with the warp size.

## Stage 3's guarantees, and the evidence that they hold

- **Bit-identical, under the exact relation** (NaN as a class, signed zeros and infinities included). The lowering
  keeps `tensor.cuda-meaning` version 2 and stage 2's case recipe; the corpus and the two inside variants were also
  compared at full size, and every pair in the tables above has the same output SHA-256 (`equal: true` in scripts 02,
  07, 09, 10, 11).
- **Legality from the Tix IR before any code is generated**: `planFusion` decides groups, mappings, staged terms and
  the serial reductions with their reasons; the emitter follows the plan.
- **`fuse: false` prints stage 2's lowering unchanged**: the six unfused digests are unchanged from before this
  stage (script 05 `05-before.json` / `05-after.json`) and still equal stage 3's fixture
  (`02-stage2-source-digests.json`), checked by `fusion.test.mjs`.
- **The artifact records the plan's staging**: `CudaKernel.terms` (`member#index`) is part of
  `tensor.cuda-source` version 3 and of the correspondence's evidence; `tensor.lower-cuda` is at version 3.

Tests, all passing:

- `tests/tensor/fusion-terms.test.mjs`, 7 tests, no GPU: the price predicate per body; the corpus stages nothing;
  the refusals for per-element, nested and split-bound reductions and for thread mode; the prologue-then-fold shape
  of the emitted kernel; the term-region layout for two staged reductions in one member and across members; the gate
  at rows 8, 16, 32 and 1024, and its absence for thread-mode and one-statement programs; and that
  `cudaSource({ shapes })` reports the lowering `runTixCuda` runs.
- `tests/tensor/fusion-terms-gpu.test.mjs`, 4 tests on the GB10: the two inside placements exact against the f32
  meaning **and** bit-equal to stage 2 in one kernel; seven staged bodies (divide, twice, rooted, exp, global vector,
  nested, shifted) exact and accepted; two mutants of the staged kernel — terms written in reverse, terms folded in
  reverse — rejected by the exact check with a coordinate, which shows the check exercises the staged path; and a
  launch with 8-element rows running stage 2's lowering and matching the meaning.
- The stage's existing GPU suites, re-run unchanged: `fusion-gpu.test.mjs` (5 tests, including the shared-memory
  opt-in/scratch rows and the reversed-sum mutant) and `cuda-gpu.test.mjs` (11 tests, including the six corpus
  programs before and after `inline`+`split-sum`, and the remote-runner tests). I did not run the whole suite, since
  the machine is shared.
- 12 random programs whose row reductions have costly bodies (`scripts/10-random-programs.out.jsonl`): all accepted
  as exact, 17 staged reductions among them.

## What the contract checks, and what it costs

`checkLowering(program, fn, { fuse })` runs `tensor.lower-cuda` (version 3) through `AnalysisManager.execute`: the
body plans, emits and returns the CUDA artifact plus the statements-to-kernels correspondence; the `ensures`
invariant `tensor.cuda-meaning` compares every case's GPU output with the current revision's f32 meaning, word for
word, NaN as a class. The cases are stage 2's recipe — shape assignments 1, 3, 4, 7, a mixed assignment giving every
symbol a distinct size, all zeros and one zero at a time, times four input streams (signed, positive, half-ulp,
signed zero), with at most 4,096 elements per tensor — so the staged code is exercised by the mixed and small-extent
assignments, and the scratch fallback is covered by a separate GPU test.

Cost (script 09, `scripts/09-contract-cost.out.jsonl`, fused and unfused):

| Program | Cases (assignments × streams) | Cold `checkLowering` | Repeat (memo) |
| --- | ---: | ---: | ---: |
| layernorm | 32 (8) | 2.8 s | 2 ms |
| layernorm-inside | 32 (8) | 2.5 s | 2 ms |
| softmax | 32 (8) | 3.0 s | 1 ms |
| attention | 40 (10) | 2.7 s | 2 ms |
| attention-inside | 40 (10) | 2.5 s | 2 ms |
| mlp | 40 (10) | 2.6 s | 2 ms |

(unfused: 2.3–3.2 s cold, 1–3 ms repeated). The cost is the same as stage 3's: same case recipe, a source no larger
to compile, and one nvcc per artifact on the GPU machine. Staged terms add no cases, because they change the
mapping, not the meaning.

## Framework and tools

**No change to `src/framework/` and none to `tools/cuda-remote.mjs`.** That is a result, not an omission; the
reasons:

- The plan's new decisions are data on the CUDA artifact (`kernels[].terms`), which the existing `defineIR`
  validator covers; no new port, invariant or correspondence kind was needed. `tensor.cuda-source` went to version
  3 and `tensor.lower-cuda` to version 3 for the schema change, which is a domain change.
- The framework's transformation contract takes a cross-kind output, a typed scalar port (used by `fuse`), and a
  required correspondence; all of that already existed, and the differential already keys evidence by subject
  revision, so fused and unfused lowerings get separate evidence over one case set.
- The remote runner needed nothing: the gate picks between two sources per launch, and the runner already keys its
  build cache by source content and uploads a unique directory per job.

**Finding: a profitability decision has no place in the contract.** `requires`/`ensures` express semantic
properties; "fusing is not slower here" is neither, so the gate cannot be a checked clause — it is measured by the
corpus scripts and it can only ever select another *exact* lowering, which is why it cannot break the stage's
guarantee. The related structural limit: a differential contract checks **one subject artifact per case set**,
while a launch-dependent lowering is a family of artifacts; making the gate part of the verified artifact would need
the launch's shapes in the program object (Tix has none) or a subject-per-case hook in `differential`. Both are
bigger than this stage needs, so `loweredTix` makes the decision visible and each member of the family stays
checkable on its own.

## What was measured, and what was only argued

**Measured on the GB10 or locally:** every number above — kernel counts, the benchmark times and their spread,
fused/unfused equality of output digests at full size, the row-length sweep and the gate's boundary, the price list
per body shape, the contract's case counts and wall times, the 12 random programs, and the existing suites.

**Argued, not measured:**

- That staged terms keep the bits for *every* program in the domain: the construction in "How terms are staged", of
  which the measurement is a sample (corpus, two inside variants, seven body shapes, 12 random programs, and mutant
  rejection).
- That `L < 32` is the right boundary for every GPU: it is one hardware constant (the warp width) plus this GB10's
  measurements; the rule reads `warpSize` from one constant, so it would follow the hardware.
- That the `attention-inside` gap (1.05×) is robust: its fused time is stable to 0.1% across calls while its unfused
  time varies by 4%, so the sign holds in every measurement I made, but the margin is inside this machine's noise for
  other programs.
- That the shared-machine noise is 2–15% depending on the kernel: measured for a few programs by repeating identical
  sources, not characterised as a distribution.

## Later

- **Several rows or a warp per row in block mode**, which would remove the cause of the gate's firing instead of
  gating it: short rows pack into full warps, and the gate could then go away.
- A **subject family** in `differential` (or shapes in the program), so a launch-dependent lowering can be checked
  as an artifact of its own.
- Term staging **for the split (`blocks`/`tail`) bounds** of `split-sum`, once the region size can be derived from the
  shape values and the block index.
- An exact and cheaper f32 `exp` — still softmax's floor, and now also the reason the `exp` staging is worth 32×.
- A cost model instead of one hardware constant for the gate, once there is more than one GPU to calibrate on.
- Row-buffer reuse of dead rows (attention's `score` after `e`), which the new term region makes slightly more
  valuable, and contraction tiling for `attention`/`mlp`, which remain far from their counted traffic.
