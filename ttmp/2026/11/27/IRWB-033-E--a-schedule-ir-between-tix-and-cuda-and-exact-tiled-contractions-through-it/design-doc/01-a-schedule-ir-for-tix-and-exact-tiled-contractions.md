---
Title: A schedule IR for Tix and exact tiled contractions
Ticket: IRWB-033-E
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:09:12.896533939-05:00
WhatFor: ""
WhenToUse: ""
---

# A schedule IR for Tix and exact tiled contractions

Stage 6 puts a schedule IR between Tix and the CUDA source and uses it to lower contractions as tiled kernels that keep every result bit. This document says what is built in this session, in which order, and why.

## Supported input domain

Every Tix function the language accepts, at any shape (zero extents included). A statement is scheduled as a **tiled contraction** when all of these hold; every other statement keeps its stage 3b schedule:

- its expression has exactly one outermost reduction, a `sum` over axes with plain extents (not the `blocks` and `tail` extents that `split-sum` produces);
- the reduction's body is `L * R`, with no reduction inside;
- at least one output axis is read only by `L` (a *row* axis) and at least one only by `R` (a *column* axis). Output axes read by both or neither are *batch* axes.

`L` and `R` may be any expressions (a load with affine indices, `a[i,k] - 1`), and the reduction may sit inside an epilogue (`+ bias[j]`, `/ sqrt(D)`). Matmul, both contractions of attention and mlp, and conv2d (rows n, y, xpos; column o; 144 terms) match. A matrix-vector product (no column axis) and a reduction after `split-sum` do not; they are under Later.

## What decided the kernel (probes 01 and 02, measured before designing)

Hand-written exact kernels for `c[i,j] = sum(k) a[i,k] * b[k,j]`, each compared bit for bit with the stage 2 kernel (`scripts/01-…`, `02-…`, median of 5 launches):

| Schedule | 512³ ms | 1024×256×1024 | 1024×1024×64 | 4096³ TFLOP/s |
| --- | ---: | ---: | ---: | ---: |
| stage 2: thread per output, global loads | 0.213 | 0.451 | 0.096 | 1.02 |
| tile 16×16, patch 1×1, operands in shared memory | 0.219 | 0.412 | 0.138 | |
| tile 64×64, patch 4×4, operands from global memory | 0.121 | 0.148 | 0.226 | 3.05 |
| tile 64×64, patch 4×4, chunk 16, shared | **0.076** | **0.099** | 0.109 | 6.34 |
| tile 32×32, patch 2×2, chunk 32, shared | 0.097 | 0.170 | **0.072** | |
| tile 64×64, patch 8×4, chunk 16, shared | 0.100 | 0.094 | 0.164 | 7.20 |

- Neither shared-memory staging nor register tiling gains alone; together they give 2.8× at 512³ and 6× at 4096³. So the IR needs both as separate steps, and the final schedule has both.
- A tile needs enough blocks: 64×64 tiles lose to stage 2 at 200³ (16 blocks: 0.027 against 0.018 ms) and at 1024×1024×64 (16 blocks), where 32×32 tiles with 2×2 patches (64 blocks) win. So the tile size is chosen at launch from the number of tiles, and stage 2's mapping stays as the last choice.

## The schedule IR

`tensor.schedule` is a v6 IR (`defineIR` with `entities`, an adapter with kernel and statement entities). Its value is the Tix function (the algorithm) and an ordered list of kernels (the schedule), in Halide's split. Three kernel kinds:

- **thread**: one thread per output element; members after the first are registers (stage 2, and stage 3's thread mode). It may carry a `contraction` annotation: the row, column and batch axes found by the form above.
- **block**: stage 3's block mode with 3b's constructs as fields: staged rows, buffered rows, staged terms, in-place rows, heavy members, the block width caps, and the gate with its constants.
- **tile**: one contraction statement with an ordered list of **configurations**. A configuration is `tile [TM, TN]`, `patch [RM, RN]`, `chunk TK` and `staged`, with the launch-time condition `minTiles`. One block computes a TM × TN tile of the (row, column) space; one thread a RM × RN patch in registers; the terms run in order in chunks of TK, whose `L` and `R` values are staged in shared memory. The host takes the first configuration whose condition holds, otherwise stage 2's mapping.

Row, column and term spaces are linearised row-major, so any index expression (conv2d's `y + dy`) is handled by the staging loop's decode; the inner loop only sees shared memory and registers.

**Alternative considered: a general loop-nest IR** (loops, splits and bindings as a tree, a generic printer). It would express more schedules, and a printer for arbitrary nests is a project of its own; no program here needs a nest outside the three kinds. The kinds are records whose fields are the directives, which a later general IR could be lowered from. **Alternative: keep plan and emitter and add a tiled emitter.** That is the least code and leaves every decision unchecked, which the stage exists to change.

## Passes (each a `definePass` on `tensor.schedule`)

The initial schedule (Tix → schedule) is stage 2: one thread kernel per statement. `fuse: false` prints it, byte for byte stage 2's source.

| Pass | Step | Legality, decided from the IR |
| --- | --- | --- |
| `mark-contractions` | annotate thread kernels with the contraction roles | the form above |
| `fuse` | merge adjacent kernels into thread or block kernels (stage 3) | `planFusion`'s rule: a member reads kernel members only at its own block point; a contraction kernel is not merged |
| `stage-terms` | terms of row reductions on all threads (3b) | outermost reduction of a member with one element per block; body cost rule |
| `in-place` | a row written over the row it reads (3b) | same extents, own-element reads, no later reader |
| `gate` | the launch-time choice between block mode and statements (3b) | every block kernel |
| `tile` | contraction kernel → tile kernel, one thread per element of a TM × TN tile | roles partition the axes |
| `register-tile` | RM × RN patch per thread | RM divides TM, RN divides TN, at most 1,024 threads |
| `stage-operands` | terms in chunks of TK, `L` and `R` in shared memory | TK·(TM + TN) floats within the default 48 KiB |

**Stage 3 and 3b decisions feed the IR from their plan, through passes.** `planFusion` stays the code that decides (its tests and its exported behaviour stay), and four passes each move one of its decisions into the schedule, so each is a revision with a correspondence and a check. Re-deriving the decisions inside each pass would duplicate `planFusion`; a single `from-plan` step would leave them unchecked one at a time.

**Contractions leave their fusion group.** Attention becomes tile(score), block(shift, e, z, weight), tile(out); mlp becomes tile(h), thread(g), tile(y). A tiled contraction inside a row-per-block kernel would need a block that is both a row and a tile. The cost is more kernels and launches (3 for 1), measured in the report.

## Checks

1. **Per pass, on the CPU, exact.** A schedule interpreter executes the schedule's own structure (tiles, patches, chunks, staging buffers, block rows, terms, in-place) with f32 rounding, on the lowering's samples plus shapes that cross tile and chunk boundaries, and its result must equal the Tix f32 meaning bit for bit. While it runs, every reduction fold asserts that the term it adds is the next in lexicographic order and that none is missing: this is the accumulation-order argument, made part of the check. Every configuration and both gate sides are forced in turn.
2. **Structure.** The schedule's validator re-checks each kernel's legality against the embedded function, so a pass cannot publish an illegal schedule; the contracts manager checks the entity lists of the correspondences Tix → schedule → CUDA.
3. **The final lowering on the GPU**, `checkLowering`, exact, with every tile configuration and gate side forced. It covers what the interpreter cannot: the printer, races and barriers, and the compiler (no FMA contraction, no reassociation).

One path per job: the interpreter is the only CPU check, the GPU check is the only check of the printed code.

## Strategy

The rule that picks a schedule is (a) a Strategy IR plan, a sequence of `apply` nodes over the passes with the tile sizes as arguments, and (b) the configurations' launch-time conditions. `src/framework/strategy` runs plans asynchronously only, and `cudaSource` is synchronous, so the framework gets a synchronous executor for the plan subset used (proposed change, below).

Thresholds: tile sizes and the 64-tile minimum come from probes 01 and 02 and are re-measured through the compiler (report).

## Framework changes proposed

- `strategy`: `executeSync` for plans of `sequence`, `apply`, `attempt` and `scope` with synchronous algorithms.
- `passes`: `syncPassAlgorithm`, registering a synchronous native pass with its gate as a strategy transform.
- Others as the implementation finds them (a correspondence between two outputs of one transformation is the likely one).

## Left out, and why

- Epilogue fusion of an elementwise statement into the tile kernel (mlp's `g` into `h`): fewer launches, no change to the contraction; later if time allows.
- A whole-group kernel as an alternative for launch-bound sizes; vector loads, double buffering, per-shape chunk sizes: tried only if time remains, reported either way.

## Later

- Tiled matrix-vector products and reductions after `split-sum`.
- Tiled contractions with a `max` fold or a body other than a product.
- Reassociating schedules (split-K, tree reductions), FMA, tensor cores, measured autotuning: the configuration list and the fold construct are where they attach.
