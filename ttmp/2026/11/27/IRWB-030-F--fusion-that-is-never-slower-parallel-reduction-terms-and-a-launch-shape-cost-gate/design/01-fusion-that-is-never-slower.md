---
Title: Fusion that is never slower
Ticket: IRWB-030-F
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
      Note: Staged reductions in the plan and the launch-shape cost gate (gatedPlan)
    - Path: repo://src/tensor/cuda-source.ts
      Note: Fill-and-fold emitter for staged reductions, template on Shared and Staged
    - Path: repo://src/tensor/index.ts
      Note: runTixCuda lowers through the gated plan from the input shapes
    - Path: repo://src/tensor/cuda-contract.ts
      Note: The gated source is checkable as a candidate through the same transformation
ExternalSources: []
Summary: Stage 3b: compute a row reduction's terms in parallel and fold them in order on one thread; gate block-mode fusion on the launch shapes so fusion is never slower than stage 2.
LastUpdated: 2026-11-27T00:00:00-05:00
WhatFor: Design of stage 3b before implementation
WhenToUse: Reviewing the parallel-term staging, the cost gate and their exactness argument
---

# Fusion that is never slower (stage 3b)

## Problem and domain

Stage 3 (IRWB-029-D) fuses every legal producer-consumer chain. In block mode a row-scalar
member (`mu[i] = sum(d) x[i, d] / D`) is computed by thread 0 of its row's block with the
reduction's whole body inlined into a serial loop: when the body is costly (a division per
term) the fused kernel loses the concurrency that stage 2 had, one thread per row. On the
"inside" placements this costs up to 3x (fused layernorm-inside 0.569 ms against 0.191 ms
for the outside placement), and the margin over the unfused lowering (0.577 ms) is inside
run-to-run noise. This stage makes the fused lowering take that concurrency back and adds a
decision that keeps a group unfused when fusing would still be slower.

The domain is stage 3's, unchanged: the checked core (affine shapes and addresses, shadowed
binders, generated split bounds, zero extents, direct parameter returns) and the same launch
domain. Nothing outside the fixed API changes.

## Part 1 - parallel terms, serial fold

**Claim:** in this IR a reduction's body cannot mention the accumulator, so *every*
reduction's terms are pure functions of loads. Any thread can compute a term; one thread then
folds the computed terms in the meaning's order. Each term is rounded exactly as the serial
loop rounds it (the same tree walk, the same intrinsics), the terms are moved as bit copies,
and the fold performs the same additions, in the same lexicographic order, on the same
accumulator chain. The result is bit-identical; this is an argument, and the exact GPU check
and differential tests are the evidence.

**Where it applies:** a row-scalar member (`rank == depth`) of a block-mode group - the one
whose reduction currently runs entirely on thread 0. Row members (`rank > depth`) are refused:
their elements are already computed by different threads of the block (one element per
`e mod blockDim`), so a costly body is already concurrent across the row; staging a row
member's terms would need the whole row's terms in memory (65,536 floats for attention's
`score`), which lands in global scratch and adds more traffic than it saves. Thread-mode
groups keep stage 2's mapping exactly (one thread per element); their per-element reductions
run on as many threads as stage 2, so nothing is staged there.

**Which reductions are refused, decided from the IR and recorded in the plan with reasons:**

- **Bare-load bodies** (`sum(j) e[i,j]`, `max(j) x[i,j]`): the serial chain is the fold
  itself (shared-memory loads pipeline behind the dependent adds); staging would copy each
  term through shared memory a second time and add a barrier, for no term computation off the
  chain. Softmax's `m` and `s`, attention's `shift` and `z`, layernorm's `mean` (outside
  placement) are refused.
- **Reductions nested inside another reduction**: only the outermost reduction of a member
  expression is staged. A nested reduction (the tail sum of a split) is part of its term's
  value and is computed serially by the filling thread; staging the leaves would reassociate
  the split sum and change the bits.
- **Non-flat axes**: staging enumerates terms by a flat index whose row-major decomposition
  is the lexicographic order. Plain `dim` extents and `blocks` extents (a constant count)
  decompose exactly; a `tail` axis on an outermost reduction (never produced by the checked
  passes) is refused and keeps the serial loop.
- **Reductions inside row members**, above.
- **Memory budget (launch values, not a refusal)**: the term buffers are staged in shared
  memory only while they fit beside the row buffers; otherwise the kernel falls back to the
  serial fold through the same `template <bool Staged>` switch the host picks at launch, the
  same code path that already chooses shared rows against global scratch.

**Mechanics.** For each staged reduction the kernel gains a fill loop
(`for (f = threadIdx.x; f < nterms; f += blockDim.x)`, the flat index decomposed into the
reduction's axes) writing the term values to a shared term buffer, one `__syncthreads()`, and
a fold by thread 0 (`acc = 0; for (t = 0; t < nterms; ++t) acc = __fadd_rn(acc, terms[t])`,
or the PTX `max_nan` fold in order for max). Term buffers of different members reuse one
region (members are barrier-separated); buffers of reductions in the same member coexist.
Zero-extent reductions fill and fold nothing and return the initializer, as now. The group's
kernels become `template <bool Shared, bool Staged>`; a group with no staged reduction keeps
stage 3's single `Shared` parameter and its emitted source is unchanged.

## Part 2 - fuse only where fusion is not slower

With staged terms, the one place a fused block-mode group still runs with less concurrency
than stage 2 is the row-member phase: stage 2 gives it `points x row-length` threads, the
fused kernel `points x threads-per-block`, each thread computing `row-length / threads`
elements. When `points x threads` already saturates the GPU the total work decides and fusion
wins (it also saves global traffic); when it does not, and the unfused mapping would saturate,
fusion is slower.

**Gate:** `gatedPlan(fn, shapeValues)` runs stage 3's legality analysis and then, per
block-mode group, compares the fused parallelism against a measured saturation threshold; a
group below it is replaced by singleton (stage 2) kernels, with the refusal and the numbers
recorded in the plan. The threshold's constant is fitted from measured crossovers, not
chosen: sweeps of fused against unfused at fixed problem sizes over the number of rows on
(a) streaming-bound row members (softmax- and layernorm-like, elementwise bodies) and
(b) compute-bound row members (attention- and mlp-like, per-element contractions). If the two
families cross at different fused-thread counts beyond noise, the rule takes the row
members' per-element work (reduction term counts at the launch values) into account, again
with the constant measured. Thread-mode groups are always fused: their mapping is stage 2's,
with fewer launches and less global traffic.

**Where the gate runs.** `cudaSource(program, fn)` has no shapes and keeps stage 3's fully
fused plan; it is what `checkLowering` checks and what the kernel count counts. `runTixCuda`
knows the launch shapes and lowers through the gated plan, so the program it runs is never
slower than `fuse: false` at those shapes. At the corpus sizes the gate passes and the run
source equals `cudaSource`'s. A gated (refused) source is itself checkable through the
existing candidate path of the same transformation (`createCudaLowering(baseline, fn,
candidate, ...)`), which the GPU tests use; the refusal path *is* stage 2's lowering, whose
bytes the digest test pins.

| Alternative | Why not |
| --- | --- |
| Emit both fused and fallback kernels and branch at launch | Doubles the kernel count of every gated program; the count is a compared result |
| Decide the gate from the IR only | "Few rows" is a shape value; no IR-only rule can see it |
| Raise the thread cap when rows are few (a different launch mode) | Keeps the serial fold on the critical path and does not reach stage 2's concurrency for long rows; the caps 64/128 are stage 3 measurements |
| Specialize `cudaSource` on shapes everywhere | The contract checks one source over many shape assignments; a shape-specialized checked lowering needs a per-shape evidence scheme for no gain |

## What stays guaranteed

- Bit-identical results under the exact relation, on the contract's cases, at full size and
  on random programs; staged and serial paths are both exact by the same construction, and
  the GPU differential exercises both, plus the scratch and serial-fold fallbacks.
- Legality is decided from the Tix IR before emission (stage 3's `planFusion` is unchanged in
  its legality rule); the gate only removes fusions.
- `fuse: false` prints stage 2's lowering byte for byte (digest test unchanged).

## Framework and tools

No framework change is required by the design: the transformation already takes a candidate
artifact (which is how a gated source is checked), the typed `fuse` port and the
statements-to-kernels correspondence carry the gated plan, and the differential memo keys
evidence by subject revision, so differently gated sources get separate evidence through the
same definitions. The known correspondence gap (entity lists declared by the caller) is
another ticket and is not touched. If implementation finds a place the framework cannot
express, the change and its reason go in the report; that is a primary result of this stage.

## Measurements

1. Gate calibration: fused against unfused over rows (families a and b above), the fitted
   constant, and the gate's decision at the corpus sizes.
2. Staging refusals: bare-load staging against serial (softmax's `s`-like reduction), and
   term buffers beyond the shared limit (serial fold against staged terms in scratch).
3. Report table: per corpus program and the two inside variants, at the brief's sizes, kernel
   count, benchmark GPU time (median of 3 `benchmark` calls), and per block-mode kernel
   which reductions use parallel terms; fused against unfused outputs compared bit for bit.
4. The contract's cost on the staged source (case count, cold and repeated `checkLowering`),
   and exact acceptance on the corpus, the inside variants and random programs.

## Later

- Staging row members' per-element reductions (needs per-element term buffers or a different
  mapping; the flat term space of attention's `score` is 256 KB per row).
- An adaptive thread cap for few-row launches; several rows per block.
- Reassociating reductions (tree folds, split-K) - excluded by this stage's brief.

## As built

The implementation follows this design. Four points differ, each measured (diary steps 3 and 4, scripts 02,
03, 06):

- **The gate's rule has two clauses, not one.** The calibration sweeps found only one family that crosses
  (mlp: every row member a contraction, no row-scalar member; 1.78 at 8,192 fused threads, 0.99 at 16,384),
  while the streaming families and attention win fused down to 512 fused threads, because their row-scalar
  reductions span the row and stage 2 pays the same serial fold on one thread per row. So the group fuses
  when `points x threads >= 16384` **or** a row-scalar member's serial term count spans the longest row
  **or** the row fits in its block's threads. A single threshold would have forfeited measured wins.
- **The rows-only thread cap is 256, not stage 3's 128.** With the terms staged across the block, bigger
  blocks pay (layernorm 0.189 against 0.209 ms at 128; 512 is worse again); stage 3's 128 was measured with
  the serial reduction on thread 0.
- **A group without staged reductions keeps stage 3's kernel body**, but its host lines (the shared-memory
  size and the instantiation choice) are shared with the staged path and read differently; the `fuse: false`
  bytes are pinned by the digest test and unchanged.
- **The staging refusals are measured where cheap to do so**: staging a bare load buys nothing (0.996), and
  the serial instantiation of a staged kernel reproduces stage 3's time. The memory-budget fallback (term
  buffers beyond the shared limit take the serial fold) is argued by traffic, not measured.
