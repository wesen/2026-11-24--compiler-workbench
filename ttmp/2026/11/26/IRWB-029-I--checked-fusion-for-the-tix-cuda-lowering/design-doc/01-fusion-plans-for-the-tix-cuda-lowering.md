---
Title: Fusion plans for the Tix CUDA lowering
Ticket: IRWB-029-I
Status: active
Topics:
    - compiler
    - tensor
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-source.ts
      Note: Emitter that consumes the plan
    - Path: repo://src/tensor/fusion.ts
      Note: New fusion analysis producing kernel plans
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Cross-kind lowering check the fused plan must pass
ExternalSources: []
Summary: Fusion as a kernel plan computed from the Tix IR inside the lowering; flat and row kernel forms; legality decided from the IR before emission.
LastUpdated: 2026-11-26T23:15:40.891560037-05:00
WhatFor: ""
WhenToUse: ""
---

# Fusion plans for the Tix CUDA lowering

## Problem statement

Stage 2 launches one kernel per statement. Every intermediate tensor makes a full round trip through
global memory, and a row reduction runs one thread per row over uncoalesced global reads. Stage 3 fuses
statements into fewer kernels **without changing any result bit**. The fused lowering must remain checked:
`checkLowering` judges it under the exact relation (bit-identical to the current revision's f32 meaning,
NaN compared as a class), and `fuse: false` must keep stage 2's lowering byte for byte.

## Where fusion lives

**Fusion lives in the lowering, as an explicit kernel-plan analysis beside the emitter.** A new module
`src/tensor/fusion.ts` reads the selected function of the current Tix revision and returns an ordered list
of kernel plans; the emitter prints one kernel per plan. `cudaSource`/`runTixCuda`/`checkLowering` take
`options.fuse` (default `true`); `fuse: false` bypasses the analysis and reproduces today's one-kernel-per-
statement emission.

Why not the two alternatives:

- **A pass on the Tix IR.** A Tix statement is one tensor assignment whose value per element is a scalar
  tree. Fusing softmax's `max`/`exp`/`sum`/`divide` into one kernel needs the row staged through shared
  memory and a thread mapping that the Tix IR cannot express: inlining `e` into `s`'s sum would recompute
  the exponential per accumulated term (O(C²) work per row), and no Tix program text describes "one block
  per row". A pass could only express the elementwise subset, which would split the fusion logic and its
  legality analysis across two layers.
- **A second v6 artifact (kernel IR) between Tix and CUDA.** Stage 2 rejected a kernel IR because the
  resolved statement list already determines every kernel and loop; fusion adds grouping and a thread
  mapping, not a new kind of node. A kernel IR would need its own validator, adapter and emitter for
  information the plan already records. If a later stage wants rewriting *on* kernel structure, the plan
  can grow into that artifact; it does not need to exist now.

**Correspondence finding.** Because fusion lives in the lowering, no Tix revision is produced and no
entity correspondence is required — many statements become one kernel inside the opaque CUDA artifact.
The framework could express the merge (`makeCorrespondence` supports merge entries between statement
entities of two Tix revisions), but the merged revision would still not carry the thread mapping, so the
correspondence would describe less than the fusion does. The plan is therefore recorded in the CUDA
artifact payload (`kernels`, with the statements each kernel covers and its form), which makes the fusion
decision inspectable and versioned without inventing an IR layer the framework would have to validate.

## Kernel forms

The plan groups a maximal run of statements into one kernel only when the IR shows the fusion preserves
every element's evaluation order. Two forms cover the corpus:

### Flat form (elementwise chains and epilogues)

All members have the same shape (componentwise affine equality). The kernel keeps stage 2's mapping:
one thread per element of the common domain, 256 threads per block, early-out guard. Each thread walks
the members in definition order, computing each member's value once into a local. A load of an earlier
member must be **identity-indexed**: every index component is exactly the consumer's own binder for that
axis. Then the local is exactly the element any load needs, and no recompute or reorder happens. Members
consumed outside the group (or returned) are written to global; internal members are never stored. This
fuses `mlp`'s contraction+GELU (`h` into `g`) and leaves `y` a separate contraction kernel.

### Row form (row reductions with their producers and consumers)

One statement (the driver) defines the grid: **one block per row**, where a row is all axes except the
last, and threads cover the last axis. Members are classified by shape:

- **row-element member**: shape equals the driver's. Its elements are staged in a dynamic shared array,
  computed cooperatively (thread `t` takes `j = t, t + blockDim, …`, each element's own tree, sequential
  inner loops preserved per element, e.g. `attention`'s `score` contraction).
- **row-scalar member**: shape equals the driver's minus the last axis. Computed by thread 0 alone. If
  its expression contains a reduction, thread 0 folds sequentially in the reduction's own axis order with
  the meaning's initializer and one rounding per step — the exact order and grouping of the tree, only
  executed once per row instead of per thread. Non-reduction row-scalars (pointwise over the row) are
  thread 0 as well. Results land in a shared scalar slot when another member reads them.

Phases run in definition order with a `__syncthreads()` between consecutive phases; there is no early
`return` (all threads reach every barrier). Loads of group members obey locality rules (next section);
loads of parameters and of statements outside the group are unconstrained affine reads of global memory.

This form fuses `softmax` (`m`, `e`, `s`, `y` → 1 kernel), `layernorm` (`mean`, `centered`, `variance`,
`y` → 1 kernel) and `attention`'s first five statements (`score`, `shift`, `e`, `z`, `weight` → 1 kernel;
`out` stays a contraction kernel).

A row kernel's shared memory is `Σ staged arrays × row length + Σ shared scalars` floats, allocated
dynamically at launch. The host computes the row length from the shape values, requests
`cudaFuncAttributeMaxDynamicSharedMemorySize` up to the device's opt-in maximum once per run, and fails
with a clear error if a row does not fit. Rows in the checked domain are at most 4,096 elements, so every
checked case fits; an extreme uncheckcased shape can set `fuse: false`, which stays exactly stage 2.

## Legality, decided from the IR

Fusion is applied only where the analysis can show order preservation; everything else keeps stage 2's
per-statement kernels. Because stage 2's kernels store and reload exact f32 words, and the fused kernel
computes each needed element with the producer's own tree and fold order, any legal grouping is
bit-identical; an illegal one is simply not formed, never approximated.

**Classification** (per group, driver `d`, rank `r ≥ 2`, row axis = last):

- row-element: the member's shape is componentwise affine-equal to the driver's shape.
- row-scalar: rank `r − 1` and componentwise affine-equal to the driver's shape prefix.
- anything else cannot join, and the run closes.

**Load rules** for a load, inside any member's expression, of a group member `P`:

- `P` row-element: every non-row index component must be exactly `plain` of the consumer's own binder for
  that axis (the load stays inside the current row); the row component may be any affine form over the
  binders in scope (neighbour elements and staged folds are allowed, and in-bounds addresses are a
  calling-domain guarantee the IR already makes).
- `P` row-scalar: every component must be exactly the consumer's own binder for that axis.
- `P` not in the group (parameter or an earlier statement outside the run): unconstrained — it reads the
  materialized global buffer.

**Flat form** is the row form's degenerate case with no row-scalar member and identity loads only.

**Formation** is a left-to-right greedy scan: at statement `i`, try row groups first (each candidate
driver `p ≥ i` whose prefix statements are all row-scalars), then flat runs; accept the first group with
at least two members; otherwise emit `s_i` alone. Closing a run early is always safe because external
consumers read written buffers. Statements that no later member reads and that nothing outside consumes
are left as singleton kernels (stage 2 would launch them; the fused plan skips a member only when the
whole group makes it dead code).

**Known refusals** (legal-looking, deliberately not applied in this stage):

- non-identity elementwise loads in a flat group without staging (transposes, neighbour reads along a
  vector) — a staged form exists but flat recompute would duplicate trees;
- reductions whose members would need cross-row data (a member loaded at a different row coordinate);
- fusing a contraction into its consumer's contraction (`mlp`'s `g` into `y`, streaming attention) — that
  is reassociation/tiling territory reserved for later stages;
- anything that reassociates a fold (parallel tree reductions, split-K) — out of scope by the brief.

## Thread-mapping changes and their reasons

| Change | Reason |
| --- | --- |
| One block per row, threads across the row axis (row form) | Lets the whole row be staged in shared memory so the reduction's single sequential fold reads shared rather than strided global memory, and gives element phases coalesced reads and writes. |
| Sequential folds executed by one thread | Any parallel accumulation reassociates the fold and changes bits; out of scope. The redundancy is bounded by the row length and hidden by occupancy at the brief's sizes. |
| Intermediates never touch global memory | Removes the stage-2 round trip; the only global traffic left is inputs once and consumed outputs once. |

## Checked relation and API

The lowering transformation gains a `fuse` input port; the emitter prints the planned kernels. The
existing exact differential invariant (current revision's f32 meaning, NaN as a class, the same seeded
case recipe with zero-extent and mixed-size assignments) judges the fused source with no tolerance to
justify — the base is bit-exact, so order-preserving fusion must be too. The artifact payload records the
plan, so the checked subject carries its own kernel structure. `runTixCuda` also exposes the existing
`benchmark` mode of `runCudaBatch` (warm-up + median of three under the tool's `--timed` lock).

## Measurement plan

For each corpus program at the brief's sizes, fused and unfused: kernel count (from `cudaSource`), one
`--timed` benchmark per mode, and a byte count per kernel computed from the plan (distinct tensors read,
outputs written, at 4 bytes per element, with the 244 GB/s floor). Fused and unfused full-size outputs are
also compared bit for bit on the GPU (the unfused lowering is already checked against the meaning), which
avoids multi-minute interpreter runs at full size.

## Implementation plan

1. `src/tensor/fusion.ts`: classification, load rules, greedy formation, unit-testable plan.
2. Emitter: consume plans; keep singleton emission byte-identical; add flat and row emitters and the host
   changes (buffer allocation for consumed outputs only, dynamic shared memory, launch arguments).
3. API plumbing: `fuse` and `benchmark` options through `cudaSource`/`runTixCuda`/`checkLowering`;
   artifact payload v2 carrying the plan.
4. Local tests (plans, refusals, source text, protocol) and GPU tests (corpus checks fused, fused-vs-meaning
   on crafted and random programs, fused-vs-unfused bit equality at full size).
5. Benchmarks and byte accounting; final report.

## Open questions

- Whether the greedy maximal-run formation ever splits a group that a smarter order would fuse (perf only,
  never correctness). Measured on the corpus; revisited only if a corpus program stays unfused.
- Whether attention's fused first kernel should stage parameters (`q`, `k` rows) in shared memory; measured
  both ways only if the first number is far from the prototype's ratio.
