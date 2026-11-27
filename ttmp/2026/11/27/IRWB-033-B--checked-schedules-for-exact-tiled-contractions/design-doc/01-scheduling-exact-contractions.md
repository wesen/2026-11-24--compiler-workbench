---
Title: Scheduling exact contractions
Ticket: IRWB-033-B
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Pass-owned structural postconditions
    - Path: repo://src/tensor/schedule.ts
      Note: Schedule vocabulary, validation and pass strategy
    - Path: repo://src/tensor/tile-source.ts
      Note: CUDA interpretation of tiled iteration
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:04:06.443492115-05:00
WhatFor: ""
WhenToUse: ""
---

# Scheduling exact contractions

The input is a checked Tix function at its current revision, on the same consistent, in-bounds shapes and finite f32 buffers supported by stage 3b. Empty extents and transformed reduction trees are part of this domain.

Represent the initial schedule as the function plus one kernel record per fusion group. Import the stage 3b plan including its term buffers, aliases and gate. Re-deriving fusion with new passes would duplicate a tested legality analysis. Carry block width policy into the schedule. Singleton schedules start with one thread per element. Stage 2 selects all singleton schedules and omits subsequent optimizations.

Recognize contractions from bound index identities, operand layout and the expression tree. Tile independent output axes, strip-mine K in increasing order, cooperatively stage input panels, and assign a register rectangle to each lane. Test a 64 by 64 output block (64 blocks at 512 square for 48 SMs), depth 16 (each half warp can fetch a contiguous left-panel row) and a 4 by 4 register patch (256 threads per tile). Compare against the original mapping. Small, skinny, affine convolution and unsupported addressing patterns retain the existing schedule. For fused chains investigate reusing tiling for contraction members while keeping the row schedule available. Only adopt changes that preserve performance in the paired experiment.

Use native v6 schedule passes and projection diff/correspondence. Each pass checks eligibility on the input and validates the resulting layout. Check that the arithmetic tree and original fold bounds survive and that the block and register partition covers the tile exactly. The K loop may be split only as contiguous increasing intervals with a clipped final interval. This check concerns the schedule. GPU comparison still exercises emitted addresses, barriers, machine arithmetic and the epilogue. For a shape switch, exercise the optimized path on small cases as well.

Use a deterministic sequence of legal passes, with shape tests represented in the resulting schedule because cudaSource receives symbolic shapes. The general strategy interpreter is asynchronous whereas the fixed source API is synchronous. Use the native pass driver directly if a sequential strategy suffices. Avoid maintaining a second interpreter.

Yang et al. characterize GEMM arithmetic separately from layout and check equivalence of compiled instructions. Here the known f32 tree is the reference. A schedule-level check needs no binary reconstruction, but cannot certify the printer or nvcc. [Paper](https://arxiv.org/html/2609.11356)

Measure each side five times interleaved. Compare exact words on representative boundaries and run the existing lowering contract. Use the unchanged row schedule as the control for attention and MLP. Compare a contraction-only numerator with whole-function time explicitly when launches fuse other operations. Check clock behaviour on the large shape.

## Later

- Split-K and tensor core schedules require a different arithmetic contract.
- Measured search is outside this strategy.
