---
Title: Schedule IR and ordered CUDA tiles
Ticket: IRWB-033-A
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/schedule.ts
      Note: Schedule artifact and checked strategy
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:04:31.021589723-05:00
WhatFor: ""
WhenToUse: ""
---

# Schedule IR and ordered CUDA tiles

## Domain and entry points

This stage takes the current checked Tix function, including output from the existing Tix rewrites. Its execution domain is consistent, nonnegative shapes, in-bounds affine reads, finite f32 input words and tensors and launches that fit the existing CUDA target. All Tix syntax stays available through the seed schedule. The explicit unfused option keeps stage 2's source and launch behaviour. A symbolic source selects its shape-dependent implementation on the host so source generation, execution and checking share one pipeline.

## Schedule and strategy

The schedule is an immutable v6 artifact for one function. Its seed imports the fusion plan, including ordered group members, register and row storage, term staging, in-place rows and the launch gate. Copying these decisions is simpler than recreating fusion as a sequence of passes and preserves the previously measured non-contraction mappings. Resolve mapping and launch choices into schedule data before emission. CUDA printing dispatches by schedule operation and prints runtime predicates from the schedule.

A recognition pass records a contraction and its operand index maps when a rectangular ordered sum multiplies two loads, with optional expressions outside the sum. Partition the output axes by operand dependence to identify two reuse directions and any independent batch axes. An unsupported expression uses the seed schedule. Pattern matching on a named matmul or conv2d would be simpler to print but would miss equivalent Tix with different binders, affine addresses or shapes.

A mapping pass installs an ordered tiled block schedule for independent contraction grids. Split the two output domains across blocks and registers, cooperatively load each operand tile into shared memory, and visit consecutive tiles of the reduction with a serial inner walk. Output and reduction tails have bounds. Padding may be loaded as zero for lanes outside the domain, but padding terms never enter the fold. A thread-private accumulator starts at positive zero and uses separate round-to-nearest multiply and add. For a contraction inside a fused row, try a thread-private column patch within the existing row phase. It shares the tile recognizer and ordered arithmetic with the independent mapping while preserving the row barriers and gate. Compare with the simpler one-output-per-thread row mapping. Keep each modification only where measurements support its shape rule.

The strategy applies recognition and mapping in order. It chooses from dimensions and access layout, without timing candidates at runtime. The first mapping candidates will use warp-width contiguous output lane assignments, with multiple outputs per thread to reuse operand loads in registers. Measure the additional register patch against the shared-memory-only case. Leave final tile sizes and shape rules to these measurements. The framework strategy interpreter runs asynchronously, while the fixed cudaSource API is synchronous. Use a small synchronous typed composition of v6 native passes unless a smaller existing synchronous framework entry point fits. Run a minimal compiled smoke test before relying on a new API. Keep any framework change small and record why it is needed.

## Checks

Schedule passes decide eligibility from the input artifact before editing. Each changed revision gets a statement-level correspondence and a synchronous check. Preserve the entire seed function and group structure and check that the chosen contraction axes and operand accesses refer to that structure. Validate mapping dimensions and check the ordered split formula. For reduction size K and positive stripe T the range for stripe s is [sT, min((s+1)T,K)). Adjacent stripes meet without overlap, the first starts at zero, and the last stops at K. A lexicographic rectangular reduction becomes a row-major linear term sequence. Register patching carries separate accumulators and leaves each such sequence unchanged. Explore an executable symbolic or small-domain output ownership witness and test it against an intentionally invalid mapping.

The static check covers the schedule rewrite's word-level arithmetic order and ownership argument. CUDA code generation, synchronization, indexing and execution still need the exact differential against the current Tix f32 revision. Force existing gate sides and exercise the new tile path at small odd and empty dimensions so the shape selector cannot hide it from the check. Record cold and warm checker cost separately from GPU event timing.

## Measurements

Capture the base from this checkout before editing. Use alternating benchmark calls and the median of five per side, with the supplied 5% noise band. Report total times, definition counts, internal contraction timing where instrumentable, rates using 2 M N K with batch axes included, and cuBLAS as a speed reference. Check clocks during the large matmul run. Put replay scripts and evidence in the ticket.

## Later

- Reassociated accumulation, FMA and tensor cores each need new arithmetic kinds and contracts.
- A general schedule interpreter or affine dependence solver needs broader consumers.
- Double buffering and vector loads need a measured bottleneck to justify extra layout and tail machinery.

## As built

The row-local register patch failed the numerical and performance experiment. The third pass, `tensor.partition-contractions`, instead adds alternate launch phases to legal row groups, with explicit materialization of cross-phase tensors. It keeps the row schedule available and can include same-element epilogues in the first contraction phase. Each phase uses the ordinary grid coverage rule to decide whether to tile. The GPU check now forces three paths for a group with phases.

The tile covers 32 × 64 outputs in 16-term stripes with 128 lanes and 16 accumulators per lane. Full tiles use an aligned specialization. The strategy requires at least one wave of blocks on the GB10, and the phase selector also accounts for the cost of intermediate traffic and the available device bytes. Measurements and their limits are in the [final report](../reference/02-final-report.md).
