---
Title: Fusion that is never slower - parallel terms, serial fold, a cost gate
Ticket: IRWB-030-H
Status: active
Topics:
  - tensor
  - gpu
  - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
  - Path: repo://src/tensor/fusion.ts
    Note: Plans term staging and decides the fuse gate (planFusion, fusionGate)
  - Path: repo://src/tensor/cuda-source.ts
    Note: Block-mode emitter; gains the staged-term prologue and fold
  - Path: src/tensor/index.ts
    Note: cudaSource/runTixCuda publish the gate's choice with the launch shapes
  - Path: repo://tests/tensor/
    Note: Plan/source tests and a separate GPU test file
ExternalSources: []
Summary: Stage 3b of Tix. A row reduction's terms are computed by the block in parallel and folded in the meaning's order by one thread; a launch-time cost gate keeps a program on stage 2's lowering when block mode would leave lanes idle.
LastUpdated: 2026-11-27T02:10:00-05:00
WhatFor: Design of stage 3b before implementation
WhenToUse: Reviewing parallel term staging and the fuse gate
---

# Fusion that is never slower — parallel terms, serial fold, a cost gate

## Goal and domain

Stage 3 fuses every legal producer-consumer chain. On a program whose row reduction divides
inside the sum (`mu[i] = sum(d) x[i,d] / D`), the fused kernel is no faster than stage 2, because
in block mode thread 0 of each row's block runs the whole reduction: every division, serially, on
one thread, while stage 2 ran one thread per row across the grid.

Two changes, each measured:

1. **Parallel terms, serial fold.** In block mode, a row-scalar member's reduction computes its
   terms with the whole block (into the row buffer) and folds them with one thread in the
   meaning's order. Each term is rounded as before and the fold order is unchanged, so the result
   is bit-identical.
2. **A fuse gate.** Where block mode would be slower than stage 2, the program keeps stage 2's
   lowering. The gate is decided from the Tix IR and the launch's shape values.

The supported domain is unchanged from stage 3: stage 2's checked core, with the same call domain
(consistent shapes, finite inputs, in-bounds reads, sizes the GB10 can allocate and launch). Both
changes only pick *where* work runs; no expression is rewritten, nothing is reassociated.

Out of scope, as the brief says: reassociating reductions (trees, split-K), contraction tiling,
FMA, tensor cores, fast intrinsics, streaming attention, autotuning. Multi-row blocks (several
rows per block, which would remove the cause of the gate's firing rather than gate it) are Later.

## Parallel terms

### What a staged term is

In block mode each member is computed by a loop `for (e = tid; e < n; e += blockDim)`, so a member
of rank equal to the block depth has `n = 1`: only thread 0 executes it. A `reduce` node inside
such a member becomes, in the emitted kernel,

```
for (U t = threadIdx.x; t < nTerms; t += blockDim.x) {      // whole block
  <decode t into the reduction's axes>
  terms[t] = <body>;                                        // same scalar code as before
}
__syncthreads();
... thread 0: acc = 0; for (U t = 0; t < nTerms; ++t) acc = __fadd_rn(acc, terms[t]);
```

`terms` is one region of the block's row buffer (shared memory, or the global scratch area when
the rows do not fit), sized to the largest staged reduction in the group and reused across members
because a barrier separates them. The fold is the meaning's fold: start at `+0` (`sum`) or `−∞`
(`max`), add/max in increasing lexicographic order of the reduction's indices, rounding after each
step, and the same `max_nan`/`minmax` instruction as before. Term `t` is decoded from `t` in that
same order, so the term in slot `t` is the term the serial loop had at step `t`.

### Why the bits do not change

- Each term is computed by one thread from the same values, with the same tree walk, the same
  explicit `__fadd_rn`/`__fmul_rn`/`__fdiv_rn`/`__fsqrt_rn`/double-transcendental code. A term is
  an expression with no accumulator in it (Tix has no accumulator variable), so moving it to
  another thread changes nothing about its value.
- The fold visits the terms in the same order and rounds after each step in the same way.
- Loads, shared stores and shared loads move f32 words unchanged, and `__syncthreads()` orders the
  writes before the fold.
- Therefore the reduction's value equals the meaning's value bit for bit, and the rest of the
  member (the part outside the reduction) is unchanged code.

### Which bodies are staged, and which are refused

A reduction is staged only when all of these hold, and every refusal is recorded in the plan:

- **Its member is row-scalar** (rank equal to the block depth, in a block-mode group). A reduction
  inside a member with trailing axes is per-element: each thread has its own accumulator for its
  own element, so nothing can be shared. Attention's `score[i,j] = sum(d) q*k/sqrt(D)` and the
  "inside" form of its `out[i,c]` stay per-element.
- **It is top-level in the member's expression** (not inside another reduction's body). A nested
  reduction would need one term buffer per outer term; that body is refused with its reason.
- **The group is in block mode** — thread mode has one thread per element and no block to share.
- **The body is worth staging**: its per-term cost exceeds a shared store, a barrier share and a
  shared load. The predicate is a per-op price list, calibrated by script 04 (staged against
  serial for the same program): a division, a square root or a transcendental (`exp`, `log`,
  `tanh`, all of which run in double) is staged; a load of a row buffer, a product, a sum or a
  `max`/`min` fold is not; a load of a tensor from global memory is staged, since the loads then
  run in parallel. The rule is one function, `stageTerms(body)`, and the plan records the answer
  and the reason for each reduction.

The region is shared, not summed: a group's term region is the size of its largest staged
reduction, because members are separated by barriers. Legality never enters the predicate: any
thread can read any tensor and compute any term, so the only question is cost.

Alternatives considered for the parallel-terms rule:

| Alternative | Why not |
| --- | --- |
| **Staged terms (chosen)** | Keeps the meaning's fold order exactly, needs one shared region and one barrier per staged reduction, and any thread can compute any term. |
| Warp shuffle instead of shared memory | Works only for the terms one warp covers (≤ 32) and needs the fold's thread to hold them; longer rows need shared memory anyway. One path is enough. |
| `atomicAdd` (or any order-free accumulation) | The fold order would depend on scheduling: refused, the relation is exact. |
| A parallel tree reduction | Reassociates: refused by the brief. |
| One thread per term with a cross-thread serial dependency chain | Same serial latency as thread 0 alone. |

## The fuse gate

### What it decides

For each block-mode group, whether the program keeps the fused lowering. It is decided from the
Tix IR *and* the launch's shape values, and it only ever chooses between two lowerings that both
exist and are both contract-checked: the fused plan (`fuse: true`) and stage 2's one kernel per
statement (`fuse: false`, byte-identical).

### The rule (calibrated by script 03)

Block mode runs one block per point of the block domain and covers a member's row with that
block's threads. A row of `L` elements therefore occupies `ceil(L/32)*32` lane slots, and
`L ≤ 16` wastes at least half of them on every parallel phase. Stage 2's flattened kernels have no
such waste; they only move more tensors.

Script 03 sweeps the row length `L ∈ {8, 16, 32, …, 1024}` at a fixed 4 Mi elements for a row
program with a double `exp` (`softmax`) and without one (`normalize`). Fused/unfused time ratios
(unfused ÷ fused, > 1 means fusion wins): 0.39 / 0.48 at `L = 8`, 0.91 / 1.53 at `L = 16`,
1.76 / 2.26 at `L = 32`, and 1.8–3.0 for `L ≥ 32`. So fusion loses as soon as the waste reaches
4, and at `L = 16` it depends on the program (the `exp`-bound one loses 9%, the traffic-bound one
wins 53%).

**Rule:** when a block-mode group's longest row `L` is shorter than one warp (`L < 32`), the
lane waste is at least 2× (at `L = 16`, half of every warp does nothing), and the program keeps
stage 2's lowering; the plan records the group, the row length and the reason. `L < 32` is the
measured boundary: at `L = 32` fusion wins by 1.76×, at `L = 16` it is a wash or a loss. The rule is deliberately conservative: it also refuses
traffic-bound short-row programs where fusion would have won 1.5×, because the sign of the
outcome at `L ≤ 16` depends on the body's cost, and a gate that is wrong in the other direction
would break the stage's promise.

Refused as a rule: estimating the two lowerings' times from a full cost model (traffic at
244 GB/s plus per-op prices). It would fire more precisely, but every constant would have to be
calibrated on this one GPU, and the measured boundary is one hardware constant (the warp size).

### Where the gate lives, and what that costs

`fusionGate(fn, dims)` is a pure function in `src/tensor/fusion.ts`; `dims` maps shape symbols to
their launch values. `runTixCuda` calls it with the extents of the launch inputs, so what runs is
chosen from the actual sizes. `cudaSource` gains an optional `shapes` option and applies the same
gate when it is given; without it, it emits the fused plan (the shape symbols are unknown, so the
gate cannot fire), which is what `checkLowering` verifies.

The cost of this placement: the CUDA artifact of a lowering is per program, while the gate is per
launch shape, so the artifact that a call runs is not always the artifact that the same call would
have checked. It is still one of the two artifacts the contract knows: when the gate fires, the
source is byte-identical to `fuse: false`'s, which `checkLowering(program, fn, {fuse: false})`
checks. Recording both lowerings in one artifact (or gating at plan time) would need the shapes in
the program, which Tix does not have. A "variant" concept in the artifact layer is a possible
framework change; it is listed under Later, not made here.

## Contract and guarantees

- The relation stays exact against the current revision's f32 meaning (NaN as a class), on stage
  2's case recipe. Staged terms change the mapping only, so no new cases are needed; the corpus and
  the inside variants are also compared at full size.
- Legality is still decided from the Tix IR before any code is generated: `planFusion` decides
  groups, mappings *and* term staging; the emitter only follows the plan.
- `fuse: false` prints stage 2's lowering unchanged (the stage-3 digest test keeps this).
- `fusionGate` is a profitability decision, not a legality one: it is measured, not checked, and
  it cannot make a lowering inexact — it only selects the other exact lowering.

## Framework and tools

No framework change is planned. The plan's new decisions (term staging, gate reasons) go into the
CUDA artifact's kernel list as data, which the existing `defineIR` validator covers. The gate has
no place in the contract because it is a cost decision, not a semantic property — a finding, not a
gap to patch in this stage. If a framework change turns out to be needed it will be reported with
its measurement.

## Measurements planned

- Fused and unfused, kernel count, benchmark GPU time (median of 3 `benchmark` calls), the digest
  of each output: the six corpus programs, `layernorm-inside`, `attention-inside`, and the stress
  variants, at the brief's sizes (scripts 02 and the final sweep).
- Each block-mode kernel: which reductions staged their terms, and the row length the gate saw.
- Staged against serial for the same program, per body shape (script 04), to calibrate the price
  list.
- The gate's boundary (script 03, re-run after the change) and the two programs it keeps unfused.
- What the contract checks and what it costs (case count, cold and repeated `checkLowering`).

## As built (filled in after implementation)

See the report.
