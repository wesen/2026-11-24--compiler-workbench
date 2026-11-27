---
Title: Fusion that is never slower (parallel terms and a cost gate)
Ticket: IRWB-030-G
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
      Note: planFusion gains parallel-term planning and the cost gate
    - Path: repo://src/tensor/cuda-source.ts
      Note: block-mode emitter gains term arrays; kernelWriter gains a staged-term fold
    - Path: repo://src/tensor/index.ts
      Note: the lowering is planned with the launch's shape values when they are known
ExternalSources: []
Summary: Stage 3b. A row-scalar reduction's terms are computed by the whole block and folded by one thread in the meaning's order; a block-mode group stays unfused when its rows do not fill a warp.
LastUpdated: 2026-11-27T02:10:00-05:00
WhatFor: Design of stage 3b before implementation
WhenToUse: Reviewing the parallel-term staging and the cost gate
---

# Fusion that is never slower

## Goal and domain

Stage 3 (IRWB-029-D) fuses a Tix function's statements into one CUDA kernel per group and keeps every result bit.
This stage keeps that and removes two ways in which fusing can cost time instead of saving it.

The domain is unchanged: stage 2's call domain (any function of the checked Tix core, consistent shapes, finite
inputs, in-bounds reads, sizes the GB10 can allocate and launch). `checkLowering` stays exact against the current
revision's f32 meaning, with NaN compared as a class.

## Where the time went

In block mode one block owns one block-domain point (one row), and a member with no trailing axes — a *row-scalar*
such as `mean[i] = sum(j) x[i,j] / D` — has one element per row, so **thread 0 computes it**. That includes every
term of its reductions. Stage 2 gave each row its own thread across the grid, so all rows reduced at once.

Two measured consequences on the merged stage 3 (script 02, medians of three `benchmark` calls):

| Program | Stage 3 fused | Stage 2 | Why |
| --- | --- | --- | --- |
| layernorm, division inside the reduction | 0.578 ms | 0.542 ms | 8M divisions run on one thread per row |
| softmax with `s[i] = sum(j) exp(x[i,j] - m[i])` | 12.41 ms | 1.62 ms | 4M double `exp` calls run on one thread per row |
| softmax with 4-element rows (2^21 elements) | 1.469 ms | 0.298 ms | a row under a warp leaves the block's lanes idle |

## Parallel terms

A term of a reduction never reads the accumulator — Tix has no name for it — so every term is a pure function of
the reduction's indices and the surrounding row. Any thread can compute any term; only the fold has an order.

So a block-mode kernel stages the terms of a reduction into a **term array** in the same row buffer that holds the
rows (shared memory, or the global scratch area when the row set does not fit):

```
for (q = threadIdx.x; q < na0; q += blockDim.x)      // the whole block, one term per thread
  a0[q] = <body with the reduction's axes taken from q>;
__syncthreads();
for (e = threadIdx.x; e < n_m; e += blockDim.x) {    // thread 0 for a row-scalar member
  float acc = 0.0f; U f0 = 0;
  for (i = 0; i < end; ++i) { acc = __fadd_rn(acc, a0[f0]); ++f0; }
  ...
}
```

Each term is computed by the same scalar code stage 2 emits, so it rounds identically, and the fold visits the terms
in increasing lexicographic order of the reduction's indices, as the meaning does (`f0` counts the fold's own
iterations, so the order is right for one axis or several). The value is therefore bit-identical, by the same
argument as stage 3's block mode: no arithmetic changed, only which thread computed which term.

### Which reductions, and what is refused

Decided from the Tix IR alone, by `planTerms(member, depth)`:

- **Staged** when the member has no axes beyond the block domain (one element per block point), the reduction is
  not nested inside another reduction, every axis of it is a plain dimension (so a term's position in the fold is a
  product of known extents), and its body costs more than the fold — a division, `exp`/`log`/`tanh`/`sqrt`, or a
  nested reduction.
- **Refused, with the reason recorded** in `FusionGroup.serial`, otherwise:
  - a reduction in a member with trailing axes: its terms are per row element, so the array would need one slot per
    (element, term) pair (1024 × 64 floats for the corpus attention) and each element's fold would still have to run
    in its own order;
  - a reduction of several axes where split-sum generated one of them, because a term's position in the fold is then
    not a product of known extents. A single generated axis is fine and is staged: after `split-sum`,
    `sum(j) x[i,j] / D` is `sum(b) sum(i) x[4*b + i] / D`, whose terms are the blocks of the split and whose count
    is `ceil(D/4)`;
  - a body with no costly operation: the block computes such a term no slower than it can write and read it, and
    measured, staging such a body loses (softmax's `s`, attention's `z`, layernorm's `mean` and `variance` as the
    corpus writes them, whose bodies are a load or a product).

The `fuse: false` lowering is untouched: it has no term arrays and is byte-identical to stage 2's.

## The cost gate

Block mode replaces "one thread per element, 256 per block, 1,536 threads per SM" with "one thread per element *of
a row*, in a block of its own". While a row fills a warp that is a gain. Below a warp, every block launches lanes
that do nothing, and the device admits at most 24 blocks per SM (stage 3, probe 01), so the SM can hold at most
`24 × width` lanes of work instead of 1,536.

Rule: **a block-mode group stays fused only when its block puts at least one warp (32 lanes) to work**, where the
width is the wider of its rows and its staged term arrays (a staged reduction spreads its terms over the whole
block). Otherwise the group's statements become stage 2's kernels, one each, and the plan records the decision with
the width it measured.

Justification (script 02, 2^21 elements, medians of three calls; fused / stage 2 in ms): rows of 4 → 1.469 / 0.298,
8 → 0.736 / 0.282, 16 → 0.372 / 0.330, 32 → 0.188 / 0.329, 64 → 0.189 / 0.296. The crossover lies between 16 and 32
elements, and 32 is the warp, the width at which the block's lanes start to pay for themselves.

The width needs shape values, which the IR does not have. The gate is decided:

- from the launch's input shapes in `runTixCuda`, which is the path that times and runs a program;
- from an optional `sizes` option of `cudaSource`;
- not at all when no values are given (as in `checkLowering`, whose case recipe spans many shape assignments and
  whose subject is one artifact): the plan then keeps every group fused, which is stage 3's plan.

Alternatives considered, and why not:

| Alternative | Why not |
| --- | --- |
| Decide at launch among two emitted kernels | The kernel count would double, and the lowering would no longer be what `cudaSource` prints. |
| Several rows per block for short rows (a third mode) | It needs a template over the rows per block, barriers shared by rows, and a tail rule; it is a new mapping, not a gate, and stage 3 already lists it as Later. |
| A threshold below a warp (8 or 16) | Contradicted by the measurement: at 16 the fused kernel is already 13% slower, and at 32 it is 75% faster. |
| Gate thread mode too | Thread mode is stage 2's mapping (one thread per element, 256 threads per block) with registers instead of global round trips; it never has fewer lanes than stage 2. Measured on matmul (0.218 against 0.213) and conv2d (0.166 against 0.166). |

## Guarantees kept

- Bit-identical results under the exact relation: the terms are the same expressions rounded the same way, and the
  fold keeps the meaning's order. Verified by the contract's cases and at full size on the GPU.
- Legality from the Tix IR before any code: `planFusion` decides groups, staging and the gate; the emitter follows.
- `fuse: false` prints stage 2's lowering unchanged (digest test).

One weakening to state plainly: a gated lowering is chosen from shape values, so the artifact `checkLowering` checks
(planned without values) is not always the artifact a benchmark runs. Both come from the same emitter, a gated group
is exactly stage 2's kernel for that statement (checked whenever `fuse: false` is checked), and a GPU test checks a
gated program's output at its short-row sizes word for word against the interpreter.

## As built

The implementation follows this design. Differences and additions, each measured:

- A staged reduction also covers the split-sum form (one `blocks` axis whose body is the `tail` reduction), so
  `optimizeTix(program, ['inline', 'split-sum'])` keeps its parallel terms. Measured: the plan's `terms` entry reads
  `ceil(D/4)`, and the contract accepts the split lowering exactly.
- `bind` in the scalar writer named indices `i${indices.size}`, which collides when a staging loop and a fold bind the
  same axis; it now names them from a counter. Identical output for every kernel that binds an axis once, which is
  every stage-2 kernel and every kernel this stage does not stage.
- Several reductions of one member are staged together: one array each, one barrier after them, one counter each in
  the fold (`scripts/11-two-terms.tix`).
- The ruled-out alternative "decide at launch between two emitted kernels" is what the gate replaces: the plan is
  chosen before emission, from the values, and `cudaSource` without values prints the ungated plan.

## Out of scope (as the brief fixes it)

Reassociation of any kind (tree reductions, split-K, partial sums combined by an operator), contraction tiling,
FMA contraction, tensor cores, fast `exp`, streaming attention, autotuning. Softmax stays bound by the exactly
rounded `exp`.

## Later

- Several rows per block for short rows, which would make the gate unnecessary for them.
- Chunked term arrays, so that a very long reduction does not enlarge the row set (today a 100k-term reduction adds
  400 KiB to every block's row set and pushes the kernel to the global scratch path).
- Entity universes on `defineIR`, so the manager can check correspondence IDs (IRWB-029-D's finding, another
  ticket).
