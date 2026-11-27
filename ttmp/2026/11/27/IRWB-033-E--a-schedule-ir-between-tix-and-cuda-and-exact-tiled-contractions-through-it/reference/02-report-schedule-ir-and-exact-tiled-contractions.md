---
Title: 'Report: schedule IR and exact tiled contractions'
Ticket: IRWB-033-E
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/strategy/sync.ts
      Note: executeSync (framework change)
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Sides forced by the check; tensor.schedule-tix
    - Path: repo://src/tensor/cuda-source.ts
      Note: emitSchedule and emitTile (the printer)
    - Path: repo://src/tensor/schedule-eval.ts
      Note: The schedule interpreter with order assertions; scheduleGate
    - Path: repo://src/tensor/schedule-passes.ts
      Note: The passes, the strategy plan and buildSchedule
    - Path: repo://src/tensor/schedule.ts
      Note: The schedule IR, its validator (legality) and adapter
    - Path: repo://tests/tensor/schedule-gpu.test.mjs
      Note: GB10 checks of tiled contractions and a mutant
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:09:23.672095333-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: a schedule IR and exact tiled contractions

Stage 6 puts a schedule IR, `tensor.schedule`, between Tix and the CUDA source. The lowering is now Tix → schedule → CUDA: a Strategy IR plan applies passes to the schedule, each a revision with a correspondence, a legality check from the IR and (in `checkLowering`) an exact check by a schedule interpreter; the emitter prints the final schedule. Contractions are lowered as tiled kernels that keep every result bit.

@@SUMMARY@@

## Results

`runTixCuda(..., { benchmark: true })` (a warm-up and the median of three launches), **median of 5 calls** per variant, interleaved fused, base, unfused (`scripts/05-benchmark.mjs`, values in `05-benchmark.out.jsonl`). *Base* is stage 3b's fused lowering: `planFusion`'s plan printed by the same printer. Inputs are seed 20 in [−0.1, 0.1]. In every row all variants returned the same bits (SHA-256 of the output).

@@TABLE@@

"Definitions" is the kernel count by the brief's rule (`__global__` definitions in `cudaSource`). **Attention and mlp went from 1 to 3**: each contraction is a kernel of its own. A tile kernel is one template definition; its instantiations are the configurations and stage 2's mapping.

### The contractions

TFLOP/s is 2·M·N·K over the time. The contractions inside attention and mlp were timed alone, as one-statement functions at the shapes they have inside (the epilogue included); conv2d is one statement.

@@CONTRACTIONS@@

### The schedule chosen, and why

Every contraction has the same two configurations; the host picks by the number of tiles:

| Configuration | Tile | Patch per thread | Threads | Chunk | Staging | Chosen when |
| --- | --- | --- | ---: | ---: | --- | --- |
| 0 | 64 × 64 | 4 × 4 | 256 | 16 terms | both factors in shared memory, 8 KiB | at least 64 tiles of 64 × 64 |
| 1 | 32 × 32 | 2 × 2 | 256 | 32 terms | both factors in shared memory, 8 KiB | otherwise, at least 64 tiles of 32 × 32 |
| stage 2 | | 1 thread per output | 256 | | global loads | otherwise, or when a space reaches 2³¹ |

- **Mapping.** One block computes a tile of the (row, column) space of one batch point. Rows are the output axes only the left factor reads, columns those only the right factor reads; several axes of one role are linearised row-major (conv2d: rows n, y, xpos; column o). The reduction's axes are linearised the same way, which is the meaning's order.
- **Register tiling.** A thread holds RM × RN accumulators and, per term, loads RM left and RN right values for RM·RN multiply-adds (8 loads for 16 at 4 × 4, against 2 for 1 in stage 2).
- **Shared-memory staging.** Before each chunk every thread copies part of the chunk's left factors as [term][row] and right factors as [term][column], so a patch's values are adjacent. A factor is computed by the scalar code stage 2 would run, so `a[i,k] - 1` or conv2d's `x[n,c,y+dy,xpos+dx]` is staged like a plain load.
- **Why these sizes** (probes 01 and 02, hand-written kernels, then script 07 through the compiler): 4 × 4 patches with 64 × 64 tiles were fastest at 512³ and at mlp's shapes; neither staging nor register tiling gained alone (0.219 and 0.121 ms at 512³ against 0.076 together; stage 2: 0.213). Chunks of 16 beat 8, 32 and 64 with 64 × 64 tiles; 32 beat 16 with 32 × 32 tiles.
- **Why two configurations and a threshold:** see "The threshold" below.

@@THRESHOLD@@

## The schedule IR

**Value.** `{ fn, kernels }`: the Tix function (the algorithm) and an ordered list of kernels (the schedule). `defineIR` with `entities` (the kernel names), and an adapter whose entities are kernels and statements with a `computes` relation.

**Constructs.**

- `thread`: one thread per output element, later members in registers (stage 2; stage 3's thread mode). May carry `contraction: { rows, cols, batch }`.
- `block`: stage 3's block mode. Fields: `depth`, `stored`, `buffered`, `staged` (rows copied to shared memory), `terms` (3b's staged terms), `inPlace`, `heavy`, `width` (the thread caps, formerly constants in the emitter), `gate` (3b's rule with its constants; absent means always block mode).
- `tile`: one contraction statement, its `roles`, and `configs`: `{ tile, patch, chunk, staged, minTiles }` in the order the host tries them.

**Passes** (`definePass` on `tensor.schedule`, `writes: kernel entities and computes relations`; each returns the new kernel list and correspondence entries from the kernels it merged or changed):

| Pass | What it changes | Legality (decided before the step is applied) |
| --- | --- | --- |
| `mark-contractions` | annotates a one-statement thread kernel with its roles | one outermost `sum` with plain extents, body `L * R` without reductions, at least one row and one column axis |
| `fuse` | stage 3's grouping; thread or block kernels with rows staged and buffered | `planFusion`: a member reads members only at its own block point; a marked contraction is not merged |
| `stage-terms` | `terms`, `heavy` | 3b's rule |
| `in-place` | `inPlace` | same extents, own-element reads, no later reader |
| `gate` | `gate` on block kernels | always legal (both sides are schedules of the same statements) |
| `tile { tile, minTiles }` | contraction thread kernel → tile kernel with a configuration of one thread per element; on a tile kernel, appends a configuration | at most 1,024 threads |
| `register-tile { patch }` | the last configuration's patch; the tile grows by the patch | patch divides tile, at most 64 accumulators |
| `stage-operands { chunk }` | chunked terms, factors in shared memory | chunk · (TM + TN) floats within 48 KiB |

The schedule's **validator re-checks legality** against the embedded function for every artifact: kernels hold the statements in order; a tensor read from another kernel is stored there; a tile kernel's roles are the statement's; a configuration is printable; block members read each other at their own block point; an in-place row is not read later. A pass cannot publish an illegal schedule, and a hand-written one is not an artifact (tested with five mutants).

**The existing fusion decisions feed the IR from their plan, one pass per decision.** `planFusion` is still the code that decides (its exported behaviour and its tests stay), and `fuse`, `stage-terms`, `in-place` and `gate` each move one of its decisions into the schedule. I chose this over re-deriving the decisions inside each pass (a second implementation of `planFusion`) and over one `from-plan` step (the decisions would enter unchecked together). The cost: the four passes are not independent pieces of logic; `stage-terms` asks the plan what stage 3b would do with this grouping.

**What I considered instead.** A general loop-nest IR (split, reorder and bind as tree rewrites, a generic printer): it expresses more and needs a printer for arbitrary nests; no program here needs a nest outside the three kinds. Regions with nested alternatives (a whole fused group against its split form): rejected for this session, see "Refused".

## Checks, and what each covers

1. **Per step, on the CPU, exact (`scheduleGate`).** `schedule-eval.ts` executes a schedule by its own structure: for a tile kernel the tiles, the patches, the chunks and the two staging buffers; for a block kernel the row buffers, staged terms and in-place rows; stage 2's mapping otherwise. The result must equal the Tix f32 meaning bit for bit on the lowering's samples, on every side (each tile configuration, stage 2's mapping, both gate sides).
2. **The order argument is part of that check.** Each accumulator of a tile counts the terms it has taken; adding term k asserts that exactly k terms came before, and storing asserts that all were taken. Staged slots are initialised to NaN, so a slot read before it is written shows in the bits. A violation is reported with the output's coordinates.
3. **Structure:** the validator above, and the contracts manager's entity-list check on the correspondence Tix statements → schedule kernels (`tensor.schedule-tix`) and Tix statements → CUDA kernels (`tensor.lower-cuda`).
4. **The final lowering on the GPU:** `checkLowering`, exact, with `--tile=<n>` and `--gate` forced so that every configuration, stage 2's mapping and both gate sides run every sample.

**What 1 and 2 cover:** that the schedule, as the IR defines it, computes the meaning: the tile/patch/chunk arithmetic, the decode of linear rows, columns and terms, edges that are not multiples, zero extents, the grouping, in-place aliasing. On the samples, not for all shapes.

**What only the GPU check covers:** that the printer prints what the interpreter executes (they are two implementations of the IR's semantics); barriers and races (the interpreter runs each phase thread by thread); that nvcc neither contracts `__fmul_rn`/`__fadd_rn` nor reorders; 32-bit index arithmetic; the launch-time rule's choice at large shapes (the samples force every side instead).

**Honest limit of the order assertion.** The IR has no construct that reorders a reduction, so with a correct interpreter the assertion cannot fire for any schedule the passes can build; it guards the interpreter's own loop structure and any later construct (split-K) that would have to declare a different order. I did not build an input-independent proof.

**Samples.** Stage 2's recipe plus two shape assignments added in this stage for the lowering's cases: every symbol 37 (crosses 32-wide tiles and both chunk sizes; a rank-2 tensor stays under the 4,096-element limit) and every symbol 6 (conv2d: 96 rows, 54 terms). The 64-wide tile is crossed only in the GPU test (130 × 45 × 67 and two more shapes, every side, against `runTix`).

@@COST@@

## New approaches tried

| Approach | Result |
| --- | --- |
| **A schedule interpreter as the per-step check** | Works: every step of every corpus schedule is checked exactly on the CPU; it found nothing wrong in the passes, and its cost was the problem (below). |
| **Order assertions inside the interpreter** (each accumulator counts its terms) | Implemented; never fired. See the limit above. Negative as a bug finder, useful as the place a reordering construct would have to answer to. |
| **Legality in the IR's validator** | It refused my first plan: a 64 × 64 tile with one thread per element is 4,096 threads. That changed `register-tile` to grow the tile (unroll and jam), which is the better definition. |
| **One IR for contractions inside fused programs** | Contractions leave their group and get the same tile kernel as matmul; the softmax part of attention stays a block kernel reading the stored `score`. Attention: see the table. |
| **Linearised roles** (rows, columns, terms as products of axes; factors as expressions) | conv2d, a batched matmul, a transposed operand with an epilogue and a two-axis reduction all use the one tile printer, bit-identical. conv2d gains less than matmul (its staging gathers). |
| **Memoising the interpreter by kernel effect and input contents** | Checked build of matmul 19.6 s → 3.3 s, attention 51 s → about 7 s. |
| An IR-level cost model | Not built. The launch-time rule is a threshold on the tile count, fitted by script 07. |

## Refused

- **A 64 × 64 tile with 1 × 1 patches,** by the legality check (4,096 threads).
- **Patches of 8 × 4** (7.2 TFLOP/s at 4096³ against 6.3 for 4 × 4 in the probe): slower at 512³ and at 1024 × 1024 × 64. A third configuration for large outputs is under Later.
- **Tiling a contraction inside a row-per-block kernel:** the block would have to be both a row and a tile.
- **A whole-group alternative for small shapes** (the 3b kernel when launches dominate): it needs nested choices, a covering set of forced runs in the contract, and buffers allocated by condition. Without it attention and mlp make three launches where 3b made one; measured below.
- **One template definition per former group** to keep the kernel count at 1: it needs a dispatching wrapper whose instantiations cannot be named for `cudaFuncGetAttributes`; the count is reported as it is.
- **Matrix-vector products and reductions after `split-sum`:** not contractions by the form; they keep their 3b schedule.
- **Anything that reassociates** (the brief).

@@SMALL@@

## Framework and tool changes

| Change | Reason |
| --- | --- |
| `src/framework/strategy/sync.ts`: `executeSync(plan, registry, input)` | `strategy.execute` is asynchronous; `cudaSource` is a synchronous fixed API. Without this the pass order would be hard-coded and the strategy package unused. It runs `sequence`, `apply`, `scope`, `checkpoint`, `attempt` with synchronous algorithms and plain JSON arguments, validates with the same `assertValid`, and refuses other nodes by name. |
| `src/framework/passes/bridge.ts`: `syncPassAlgorithm(pass, gate, onResult)` | The existing `passAlgorithm` goes through `applyPass` (asynchronous, needs a manager). This registers a native pass with its synchronous gate as a strategy transform; the node's `args` are the pass parameters. |
| `tools/cuda-remote.mjs` | none |

**Where the framework did not fit, without a change:**

- **Strategy values must be JSON, and a schedule choice here is made at launch.** The plan picks the configurations; the choice among them by shape is host code the printer emits from `minTiles`. Strategy IR's `conditional` and `chooseBest` run at compile time and cannot express "decide when the shapes are known". The schedule IR carries that part of the strategy as data.
- **Artifacts store records with sorted keys.** Comparing a stored record with a fresh one by `JSON.stringify` fails; my validator did that once. A `sameValue` helper in `core/data` would have saved the detour; I compare field by field.
- **`applyNativePassSync` costs about 30 ms per pass here** (artifact, projection, diff, correspondence): an unchecked build of a schedule is 0.3 to 0.5 s for eleven passes. I cache the build per function. Not changed.
- **A pass between IR kinds** (Tix → schedule, schedule → CUDA) is a `defineTransformation`, not a `definePass` (which is one IR to itself). That fit: `tensor.schedule-tix` and `tensor.lower-cuda`, each with a statements-to-kernels correspondence that the manager checks against both artifacts' entity lists.
- **Not done:** the two transformations are not chained by a schedule → CUDA correspondence record; the kernel names are equal on both sides and the CUDA artifact's kernel list is built from the schedule.

**Tensor-domain changes:** `planFusion(fn, isolated)`; `gateRule(v, constants)`; `emitSchedule(schedule)` (and `emitCuda(fn, plan)` kept, printing through `scheduleFromPlan`); `emitTile`; `--tile=<n>`; `runCudaBatch(..., { tile })` and `tiles` in its result; `tileModes`, `sidesOf`; `CudaIR` kernels may be `tile`; the lowering's cases gain the two shape assignments.

## Measured, and only argued

**Measured on the GB10:** the tables above; bit-identity of every variant in every benchmark call; `scripts/04-run-forced.out.jsonl` (all six corpus programs at non-multiple shapes, every side, against `runTix`); the checks listed under "Checks run"; probes 01 and 02.

**Argued, not measured:** that a tile kernel keeps the bits for every program and shape in the domain (the construction: each factor by stage 2's scalar code, each accumulator adding term 0, 1, … with `__fadd_rn(acc, __fmul_rn(l, r))`; measurements are samples); that the threshold holds between the measured shapes; that the 32-bit guard is right (no shape near 2³¹ was run).

@@CHECKSRUN@@

## Later

- A whole-group alternative for launch-bound shapes; epilogue fusion of an elementwise statement into a tile kernel (mlp's `g` into `h`), which removes one launch and one round trip through global memory.
- A third configuration for large outputs (8 × 4 patches), vector loads, double buffering.
- Tiled matrix-vector products, reductions after `split-sum`, `max` folds, bodies other than a product.
- A schedule → CUDA correspondence record; a cost model in place of the tile-count threshold.
- Reassociating schedules (split-K, tree reductions), FMA, tensor cores, measured autotuning. The fold is the construct they would change: a reduction-order field on the configuration, which the interpreter's assertion would then check against.
