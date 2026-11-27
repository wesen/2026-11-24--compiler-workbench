---
Title: Checked fusion of Tix statements into CUDA kernels
Ticket: IRWB-029-D
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/analysis-manager.ts
      Note: Validates the correspondence records a transformation returns
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Lowering transformation; gains the fuse port and a statements-to-kernels correspondence
    - Path: repo://src/tensor/cuda-source.ts
      Note: Stage-2 emitter; gains a group emitter for fused kernels
    - Path: repo://src/tensor/fusion.ts
      Note: Legality analysis (planFusion)
    - Path: repo://src/tensor/model.ts
      Note: Tix IR the legality analysis reads
ExternalSources: []
Summary: Fusion as a legality analysis on the Tix IR plus a group emitter; thread and block mappings; exact GPU check; a many-to-one correspondence.
LastUpdated: 2026-11-26T23:30:00-05:00
WhatFor: Design of stage 3 before implementation
WhenToUse: Reviewing the fused lowering, its legality rule and its contract
---

# Checked fusion of Tix statements into CUDA kernels

## Goal and domain

Lower a Tix function to fewer CUDA kernels than statements, with every output bit equal to the current revision's f32 meaning (NaN compared as a class). The supported domain is stage 2's: any function of the checked core (affine shapes and addresses, shadowed binders, generated split bounds, zero extents, direct parameter returns), with the same call domain (consistent shapes, finite inputs, in-bounds reads, sizes the GB10 can allocate and launch). Fusion adds no restriction on that domain: a row that does not fit in shared memory falls back to global scratch inside the same kernel (below).

Probe 01 (`scripts/01-device-limits/main.cu`) on the GB10: compute capability 12.1, 48 SMs, 1,536 threads and 24 blocks per SM, 48 KiB dynamic shared memory per block by default, 99 KiB (101,376 bytes) with opt-in, 100 KiB per SM, 24 MiB L2.

## Where fusion lives

Fusion is a **legality analysis on the Tix IR** (`planFusion(fn)`, pure, in a new `src/tensor/fusion.ts`) whose result, a list of kernel groups, the **emitter applies**. The plan is recorded in the CUDA artifact, and the lowering transformation returns a correspondence from Tix statement entities to kernels.

| Alternative | Why not |
| --- | --- |
| A pass on the Tix IR (the simplest place: the pass machinery and meaning gate exist) | Tix's meaning materializes every statement. The only way to merge two statements in Tix is to inline one into the other, which recomputes a reduction per consumer element: inlining softmax's `m[i]` into `e[i,j]` does C times the max work. What fusion changes (where an intermediate lives, which threads compute a row) is not expressible in Tix. |
| A second v6 artifact, a kernel IR between Tix and CUDA | Its content would be the plan plus a copy of the Tix function. Nothing would edit it between planning and emission, and its meaning is the Tix meaning, so it would need an IR definition, validator and adapter with no consumer and no separate check. It becomes worthwhile when a later stage rewrites schedules with checked passes (Later). |
| **Analysis plus emitter (chosen)** | Legality is decided from the Tix IR before any code is generated; the emitter only follows the plan; the GPU check judges the result end to end. |

The correspondence is the framework test the brief asks for. `defineTransformation` accepts a `correspondence` requirement between an IR input and an IR output of different kinds, and a `Correspondence` record's entity groups are lists, so `{ from: ['softmax/m', 'softmax/e', 'softmax/s', 'softmax/y'], to: ['k0'] }` states "four statements became one kernel". The manager checks that the record names the exact input and output revisions and the declared relation. It does not check the entity IDs, because a plain `defineIR` artifact has no entity projection; that is a finding, reported with the results. No framework change is planned.

## Legality, decided from the Tix IR

Groups are contiguous runs of statements in source order. A group has a **block depth** k ≥ 1: its members share their first k axes (equal affine extents), the *block domain*. Statement s joins the current group G when

1. s reads at least one member of G (producer-consumer fusion only), and
2. the largest k' ≤ min(k_G, rank s) is at least 1, where k' is the longest prefix such that s's first k' extents equal G's and **every read of a member of G inside s** (including reads inside reductions) has, at each position p < k', exactly the plain index `s.axes[p]`.

Otherwise G closes and s starts a new group with k = rank s. Each refusal records its reason (no member read; a member read at a leading index that is not the block index, e.g. `y[j,i]` or `m[i+1]`; different leading extents). Both conditions are prefix-closed, so lowering k when s joins keeps earlier members legal.

A member is **stored** to global memory if it is the function's result or a later group reads it. A non-member tensor (parameter or earlier group's output) is **staged** in a block-mode group when a member reads it with plain block indices in its first k positions and its first k extents equal the block domain's. (The checker unifies extents only for plain source occurrences, so `t[i+0,k]` is plain in the IR without having unified; staging therefore compares extents itself.)

## Two mappings

- **Thread mode** (every member has rank k): one thread per point of the block domain, as in stage 2. Members are computed in order in the same thread; a member read at identity indices is the register holding its value. This covers elementwise chains and epilogues.
- **Block mode** (some member has rank > k): one block per point of the block domain. The block copies each staged row with coalesced loads, then computes the members in order, with `__syncthreads()` between them. Element e of a member's row (row-major over its trailing axes) is computed by thread e mod blockDim, so stores are coalesced. A member of rank k has one element per block point, so thread 0 computes it, with its reductions in the meaning's order. Members read later in the group are kept in row buffers. This covers softmax (max, exp, sum, divide), layernorm (mean, variance, normalization) and contraction producers whose row a later reduction reads.

Row buffers and staged rows live in dynamic shared memory when their total fits in the opt-in limit queried at run time; otherwise the host allocates a global scratch area (one row-set per block) and passes it, and the kernel uses `scratch ? scratch + blockIdx.x * row : shared` as the base. One kernel, one code path, the same values. `__syncthreads()` makes a block's global writes visible to the block, so the fallback keeps the order. Blocks above 48 KiB call `cudaFuncSetAttribute` before timing.

Threads per block in block mode: the smallest multiple of 32 covering the longest row, capped at a maximum chosen by measurement (64, 128 and 256 are measured on softmax, layernorm, attention and mlp before fixing it). Thread mode keeps stage 2's 256.

**Thread-mapping changes, recorded per kernel** in the plan and as comments in `cudaSource`: block mode replaces one thread per element with one block per row; a row-scalar member moves from one thread per row across the grid to thread 0 of its row's block; staged rows are read through shared memory.

### Why the bits do not change

Every element of every statement is computed by one thread running the scalar code stage 2 emits for it (the same tree walk, explicit round-to-nearest intrinsics, double `exp`/`log`/`tanh` rounded once, the same min/max helper, the same loop order). Each value it reads equals the meaning's value: parameters and earlier groups' outputs as in stage 2; a member value from a register written earlier in the same thread, or from a row buffer written by a thread of the same block before a barrier, at the row the legality rule guarantees; a staged value as a bit copy. Loads and stores move f32 words unchanged. So the fused kernel's outputs equal stage 2's element by element, and stage 2 is exact.

### Profitability

The rule fuses every legal producer-consumer chain; it has no cost model. Block mode assumes enough rows to fill the GPU: with very few rows and long ones (softmax over [1, 10^6]) one block does the whole parallel phase and is slower than stage 2. The corpus has 1,024 to 4,096 rows. The report measures, and Later lists a run-time choice.

## Contract

The relation stays exact against the current revision's f32 meaning, on stage 2's case recipe (`cudaCases`). The lowering transformation (`tensor.lower-cuda`, version 2) gains a boolean `fuse` input port; its body plans (if fusing) and emits; its required correspondence `kernels` (relation `statements-to-kernels`) is built from the plan, and for a supplied candidate from the plan recorded in the candidate's artifact. The CUDA artifact payload gains `kernels: { name, mapping, statements }[]`. Fused and unfused sources are different subjects with separate evidence; they share the baseline key, so the cases and reference values are generated once. The cases are small (at most 4,096 elements per tensor), so they exercise block mode with short rows, zero extents and empty grids, not the scratch fallback; a GPU test covers the fallback with a row too large for shared memory.

## API

As fixed by the brief: `cudaSource(program, fn, { fuse })`, `runTixCuda(..., { host, fuse, benchmark })`, `checkLowering(program, fn, { fuse })`, with `fuse` defaulting to `true`. `benchmark` passes the existing `--timed -- --benchmark` path of `runCudaBatch`. `fuse: false` emits exactly stage 2's bytes: `scripts/02-stage2-source-digests.json` holds the base build's SHA-256 for the corpus (original and inline+split) and three test programs, and a test compares them. A plan of singleton groups reuses the stage-2 kernel emitter, so a one-statement program's fused and unfused sources are equal.

## Measurements

For each corpus program at the brief's sizes, fused and unfused: kernel count (regex over `cudaSource`), `benchmark` GPU time, bytes per kernel by a stated count (each distinct global tensor a kernel reads counted once at full size, plus each tensor it stores: compulsory traffic with perfect caching) and those bytes at 244 GB/s. Fused and unfused outputs are compared bit for bit at full size. The report also gives the contract's case count and the wall time of a cold and a repeated `checkLowering`.

## Refused, and why

- **Parallel tree max.** Tix's max (NaN propagates, +0 above −0) is order-independent bit for bit, so a tree max would pass the exact check; the brief requires sequential accumulation for every reduction.
- **Staging attention's `k` through shared memory.** `score[i,j]` reads `k[j,d]` with `j` across threads, which is uncoalesced; transposed tiles of `k` would fix it, but that is contraction tiling.
- **Recomputation** (inlining a reduction into its consumers) and **horizontal fusion** of statements that do not read each other: neither keeps work equal or is in the brief's categories.
- **Reordering statements** to make non-adjacent producers and consumers contiguous.

## Framework

No change is planned: the transformation contract already takes a cross-kind output, a typed scalar port and a required correspondence, and the differential memo keys subjects by revision. If implementation shows otherwise, the change and its reason go in the report.

## Later

- A kernel IR artifact, when schedules are rewritten by checked passes (tiling, tensor cores).
- Checking correspondence entity IDs against the artifacts (needs an entity projection for CUDA units, or a domain check).
- A run-time choice between block and thread mode for few, long rows; several rows per block.
- Reusing dead row buffers to raise occupancy; horizontal fusion; statement reordering.

## As built

The implementation follows this design. It differs in four points, each measured (diary steps 3 and 4) and described in the report:

- Block-mode kernels are `template <bool Shared>`, so that rows in shared memory are addressed as shared memory. Going through the generic pointer to shared memory or scratch cost 25% on a row max. The host launches the instantiation that fits.
- Fused kernels fold max with PTX `max.NaN.f32` rather than `minmax`. Probe 07 found the two equal on 324 pairs of special words. The block mapping makes the fold's latency the critical path.
- Threads per block in block mode are capped at 128, or at 64 when a member's reduction reads a tensor from global memory (measured at 64, 128 and 256).
- `createCudaLowering(...)` returns `(baseline, fn, candidate?, { fuse, manager }?)`; the `manager` option lets tests read the recorded correspondence.
