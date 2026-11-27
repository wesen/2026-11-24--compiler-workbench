---
Title: Implementation diary
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
    Note: stageTerms, terms/serial in the plan, fusionGate
  - Path: repo://src/tensor/cuda-source.ts
    Note: staged-term prologue and fold, term region layout
  - Path: repo://src/tensor/index.ts
    Note: shapes option, launchShapes, loweredTix
ExternalSources: []
Summary: Chronological record of stage 3b — measurements first, then term staging, the gate, tests, and the failures found on the way.
LastUpdated: 2026-11-27T03:20:00-05:00
WhatFor: Reproducing and auditing the decisions of IRWB-030-H
WhenToUse: Reviewing why the price list, the warp boundary and the gate's placement are what they are
---

# Implementation diary — IRWB-030-H

Branch `t3b-ds-x/irwb-030-h`, worktree `.claude/worktrees/t3b-ds-x-irwb-030-h`. Every script named here is in
`scripts/` and committed.

## Step 1 — Context: stage 3's design and report, stage 2's report, then the code

Read, in this order: `IRWB-029-D/design-doc/01`, `IRWB-029-D/reference/02-report`,
`IRWB-022-I/reference/02-report`, `src/framework/contracts/README.md`, `src/framework/ir/README.md`,
`src/framework/passes/define-pass.ts`, then `src/tensor/*.ts` and the six corpus programs.

Carried over from stage 3, because stage 3b must not change them: one kernel per fused group; block mode is one
block per block-domain point, template on `<bool Shared>`, rows in shared memory or global scratch; thread caps 128
(rows only) and 64 (a contraction operand in a reduction); `max_nan` for a max fold; `fuse: false` byte-identical to
stage 2 (`scripts/02-stage2-source-digests.json` of stage 3 is the test's fixture); the exact relation with NaN as a
class; the correspondence `statements-to-kernels`.

The regression to fix is in stage 3's design, under "Profitability", and in the brief's table: in block mode a
row-scalar member is computed by thread 0, so a per-term division inside a reduction is a serial division chain.
Stage 2 ran one thread per row across the grid, so it had that concurrency.

## Step 2 — Baseline: the merged stage 3, measured again (script 02, `02-baseline.out.jsonl`)

`node scripts/02-bench.mjs` (one benchmark call per lowering, so one warm-up and three event intervals each):

| Program | Kernels fused/unfused | Fused ms | Unfused ms |
| --- | --- | --- | --- |
| matmul | 1 / 1 | 0.211 | 0.216 |
| softmax | 1 / 4 | 0.388 | 0.810 |
| layernorm | 1 / 4 | 0.185 | 0.478 |
| attention | 1 / 6 | 0.752 | 1.048 |
| mlp | 1 / 3 | 0.728 | 0.955 |
| conv2d | 1 / 1 | 0.166 | 0.166 |

and for variants (`02-baseline-variants.out.jsonl`): `layernorm-inside` fused 0.573 against unfused 0.569 — fusion
buys nothing, as the brief says; `attention-inside` 1.412 against 1.497; `softmax-short-rows` (N = 262144, C = 16)
fused **0.738 against unfused 0.669: 10% slower**; `layernorm-short-rows` (N = 262144, D = 16) fused 0.301 against
0.417 (fusion wins); `softmax-1row` fused 196 against 390 (fusion wins).

Two things to chase: the inside placement of a division, and a short-row loss.

## Step 3 — Row-length sweep, to find the boundary (script 03, `03-row-lengths.out.jsonl`)

Same element count (4 Mi) at row lengths 8…1024, for a row program with a double `exp` (`softmax`) and one without
(`normalize`). Ratio unfused ÷ fused (> 1 means fusion wins):

| Row length | 8 | 16 | 32 | 64 | 128 | 256 | 1024 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| softmax | 0.39 | 0.91 | 1.76 | 1.85 | 1.82 | 1.88 | 2.13 |
| normalize | 0.48 | 1.53 | 2.26 | 2.69 | 2.57 | 2.84 | 2.99 |

Block mode covers a row of `L` with `ceil(L/32)*32` lane slots, so `L = 8` wastes 4 of 4 warp widths and `L = 16`
half of every warp. The measured boundary is exactly there: fusion loses at `L = 8` for both programs, is
program-dependent at `L = 16`, and wins from `L = 32` on. Decision: the gate refuses a block-mode group whose
longest row is shorter than one warp (32). It is deliberately conservative at `L = 16`, where the traffic-bound
programs still won 1.4–1.5× — recorded in the design and the report.

## Step 4 — Design committed (commit `9e3e78a`)

`design-doc/01`. Parallel terms (whole block computes the terms, one thread folds them in the meaning's order) and
the fuse gate (warp boundary, decided from the IR plus the launch's shape values). Alternatives weighed and
rejected: warp-shuffle staging (only ≤ 32 terms, needs shared memory anyway), `atomicAdd` and parallel trees
(reassociate — refused by the brief), a full analytic cost model (every constant would be calibrated on this one
GPU; the measured boundary is one hardware constant).

## Step 5 — The plan (`src/tensor/fusion.ts`)

Added, all pure over the IR:

- `topLevelReductions(expr)`: the member's reductions that are not inside another reduction, in expression order.
  Indexing by position is what lets the plan and the emitter agree without a second IR.
- `termCount(reduction, dim)`: the term count as an expression over the shape values, shared by the device prologue,
  the device fold and the host's row size.
- `stageTerms(body, local)`: the price predicate. It stages when a term divides, takes a square root, takes a
  double transcendental, or reads a tensor that is **not** in a row buffer (a global read moves into the block's
  parallel phase). Everything else stays in the folding thread's loop, with that reason recorded.
- `FusionGroup.terms` / `.serial`: staged and refused reductions with their reasons. Refusals: a reduction in a
  member with trailing axes (per-element, each thread has its own accumulator — attention's `score`), a nested
  reduction (not top level), a split (`blocks`/`tail`) bound (the row buffer is sized from shape values alone), and
  any reduction of a thread-mode group.
- `warpSize`, `groupRow(group, fn, dims)` and `fusionGate(plan, fn, dims)`: the gate, with the row length it saw.

## Step 6 — The emitter (`src/tensor/cuda-source.ts`)

`kernelWriter` takes an optional `staged: Map<Expr, string>`; a staged `reduce` node emits the fold over that region
instead of the loop that computes the terms:

```
float v1 = 0.0f;
for (U t = 0; t < (d1); ++t) v1 = __fadd_rn(v1, terms0[t]);
```

and `emitGroup` emits, before the member's loop and after the previous member's barrier:

```
// t's sum over 1 axis: the block computes the terms, thread 0 folds them in order
for (U t = threadIdx.x; t < (d1); t += blockDim.x) {
  U rest = t;
  const I i2 = rest % (d1);
  float v0 = __fdiv_rn(r0[(i2)], __ll2float_rn(d1));
  terms0[t] = v0;
}
__syncthreads();
```

Term `t` is decoded in the same lexicographic order the serial loop used (first axis outermost), with the same
scalar code, so slot `t` holds the term the serial fold would have had at step `t`; the fold starts at `+0`/`−∞` and
rounds after each step exactly as before.

Four bugs found here, each caught by a test or a source inspection:

1. **No `U rest = t;` for a single-axis reduction**: the emitted prologue used an undeclared identifier. Found by
   reading the generated source of `layernorm-inside` (`const I i4 = rest % (d1);` with no `rest`). Fixed: always
   declare `rest`.
2. **One region reused by two staged reductions of the same member.** The first layout sized the term region to the
   maximum staged reduction and let members reuse it. That is safe *across* members (a barrier separates them) but
   wrong *within* one member: both prologues run before the member's fold, so the second overwrote the first. Found
   by writing the `twice` program (`scripts/06`). Fixed: the region is laid out per member — each staged reduction
   of a member gets its own slots, and the region is reused from member to member.
3. **Deduplicated counts.** `sumOf` deduplicated identical length expressions, so two `(d1)`-long regions summed to
   `(d1)` instead of `(d1 + d1)` — the same bug as 2, one level down. Caught by the local test that asserts
   `const U nterms = ((d1) + (d1));`.
4. **`maxOf([])` threw** for programs with no staged terms, which broke every fused corpus lowering. Caught by the
   existing `cuda.test.mjs` and `fusion.test.mjs` runs (`Reduce of empty array with no initial value`).

## Step 7 — Nothing else moved (script 05, `05-before.json` / `05-after.json`)

SHA-256 of the corpus source, before and after the change, at the same revision of everything else:

- all six `+unfused` digests are unchanged — stage 2's lowering is still byte-identical;
- `matmul+fused` and `conv2d+fused` are unchanged (thread mode, single statement);
- `softmax`, `layernorm`, `attention` and `mlp` fused digests changed **only in the plan comment**: `diff` of
  `softmax-before.cu` and `softmax-after.cu` shows one line, the `// k0: …` comment listing the serial reductions'
  reasons. No instruction of those kernels changed.

## Step 8 — The inside placement, measured again (script 02, one run)

`layernorm-inside` fused **0.573 → 0.216 ms** (unfused 0.569), with the same output digest as before the change and
as the unfused lowering. `attention-inside` 1.412 ms, unchanged: its reductions are per-element (a rank-2 member), so
no term is staged, and its cost is the 67 million divisions of `sum(d) q*k/sqrt(D)`.

## Step 9 — The price list (script 06, `06-term-price.out.jsonl`)

Same program, staged against serial, row length 1024, 4096 rows. "Serial" is the same plan with `terms` cleared,
i.e. stage 3's block mode:

| Term body | Serial ms | Staged ms | Serial ÷ staged | Plan |
| --- | --- | --- | --- | --- |
| load of a staged row | 0.1475 | 0.1474 | 1.00 | serial |
| product of two staged rows | 0.2227 | 0.2282 | 0.98 | serial |
| load / C | 0.2531 | 0.1292 | **1.96** | staged |
| exp | 12.04 | 0.3813 | **31.6** | staged |
| staged row × global vector | 0.1620 | 0.1572 | 1.03 | staged |
| `(sum x/C) + (sum x*x/C)` | 209.6 | 4.82 | **43.5** | staged |
| max fold over a row buffer | 0.1468 | 0.1457 | 1.01 | serial |

Every output was bit-identical between the two lowerings. The prices are why `stageTerms` lists those four op
classes: a staged term costs a shared store, its share of a barrier and a shared load, and only those bodies pay for
it. The two staged rows that lose nothing (1.00, 1.03) are staged because their *term* is not the whole story — the
global read becomes parallel; the pure-product case stays serial, since it measured 2% worse.

(`twice` is 209.6 ms serial because the two divisions chains run on thread 0; staged they run on 128 threads per
row. Its 4.82 ms staged is not the floor — that program's second reduction is inside the first's body, which the
plan refuses to stage, so each staged term still runs a nested 1024-step loop. That is the documented refusal, not a
bug.)

## Step 10 — The gate in the API (`src/tensor/index.ts`)

`LoweringOptions` gains `shapes?: Record<string, number>`; `runTixCuda` fills it from the launch's inputs
(`launchShapes`), so the lowering a call runs is chosen from the sizes it was given. `cudaSource` applies the same
gate when `shapes` is passed and otherwise emits the plan-time lowering, which is what `checkLowering` verifies.
New export `loweredTix(program, fn, options)` returns what `runTixCuda` would run (`source`, `plan`, `gate`), so
scripts and tests can see the decision instead of guessing it. `fuse: false` still bypasses the gate.

## Step 11 — Tests

- `tests/tensor/fusion-terms.test.mjs` (7 tests, no GPU): the price predicate per body shape; the corpus programs
  stage nothing; refusals for per-element, nested and split-bound reductions and for thread mode; the emitted
  prologue-then-fold shape and the shared region layout; the gate at rows 8, 16, 32 and 1024, on thread-mode and
  one-statement programs; and that `cudaSource({shapes})` reports the lowering `runTixCuda` runs.
- `tests/tensor/fusion-terms-gpu.test.mjs` (4 tests, GB10): the two inside placements exact against the f32 meaning
  and bit-equal to stage 2, in one kernel; seven staged bodies exact and accepted; two mutants of the staged kernel
  (terms written in reverse, terms folded in reverse) rejected by the exact check with a coordinate; and a launch
  with 8-element rows running stage 2's lowering and matching the meaning.
- Existing GPU suites re-run unchanged and passing: `fusion-gpu.test.mjs` (5 tests) and `cuda-gpu.test.mjs`
  (11 tests), including the stage-2 byte-identity of `fuse: false` and the shared-memory fallback.

## Step 12 — Final measurement (script 02, `--runs=3`)

Two probe outputs were deleted after use rather than committed, because they were misleading rather than evidence: a
post-change full sweep whose `gated` field the probe overwrote with the unfused iteration's answer (its valid
successor is the corrected three-point run in `03-row-lengths-gate.out.jsonl`), and a first benchmark run that
aborted on a probe bug (a variant's function name is not the variant's key).

See the report. Measured, for each corpus program and the two inside variants at the brief's sizes, fused and
unfused: kernel count of the lowering that ran, benchmark GPU time (median of three `benchmark` calls), and whether
the gate fired and which reductions staged their terms.
