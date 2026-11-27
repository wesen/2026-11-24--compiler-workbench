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

- **Matmul:** 512³ in 0.080 ms (stage 2 and the base: 0.211), 4096³ in 20.4 ms, 6.7 TFLOP/s (stage 2: 133.8 ms).
- **Attention:** 0.222 ms (base 0.746, unfused 1.052). **Mlp:** 0.341 ms (base 0.624). **Conv2d:** 0.128 ms (base 0.166).
- **Softmax and layernorm** have no contraction; their schedules and times are the base's (1.00 and 1.02 of it, inside the 5% noise band).
- Every result is bit-identical to the f32 meaning: `checkLowering` accepts every corpus program as `exact` with every tile configuration and gate side forced.
- **The price:** attention and mlp are 3 kernel definitions and 3 launches where 3b had 1, and below the tile threshold they are slower than 3b's single kernel by launch overhead (the section "Small shapes").
- **Framework:** two additions (`executeSync`, `syncPassAlgorithm`); no existing framework code changed.

The code is at the last commit of branch `t6-fa/irwb-033-e`.

## Results

`runTixCuda(..., { benchmark: true })` (a warm-up and the median of three launches), **median of 5 calls** per variant, interleaved fused, base, unfused (`scripts/05-benchmark.mjs`, values in `05-benchmark.out.jsonl`). *Base* is stage 3b's fused lowering: `planFusion`'s plan printed by the same printer. Inputs are seed 20 in [−0.1, 0.1]. In every row all variants returned the same bits (SHA-256 of the output).

| Program | Definitions | Fused ms | Base (3b) ms | Unfused ms | Fused / base | Fused / unfused | Chosen at launch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| matmul-512 | 1 | **0.0798** | 0.2114 | 0.2114 | 0.38 | 0.38 | k0: 64 × 64 / 4 × 4 / 16 |
| matmul-4096 | 1 | **20.4** | 133.8 | 133.8 | 0.15 | 0.15 | k0: 64 × 64 / 4 × 4 / 16 |
| softmax | 1 | **0.3855** | 0.3857 | 0.8017 | 1.00 | 0.48 | k0: block mode |
| layernorm | 1 | **0.1722** | 0.1691 | 0.4745 | 1.02 | 0.36 | k0: block mode |
| attention | 3 | **0.2215** | 0.7461 | 1.052 | 0.30 | 0.21 | k0: 64 × 64 / 4 × 4 / 16; k2: 32 × 32 / 2 × 2 / 32; k1: block mode |
| mlp | 3 | **0.3412** | 0.6238 | 1.042 | 0.55 | 0.33 | k0: 64 × 64 / 4 × 4 / 16; k2: 64 × 64 / 4 × 4 / 16 |
| conv2d | 1 | **0.1283** | 0.1663 | 0.1663 | 0.77 | 0.77 | k0: 64 × 64 / 4 × 4 / 16 |

"Definitions" is the kernel count by the brief's rule (`__global__` definitions in `cudaSource`). **Attention and mlp went from 1 to 3**: each contraction is a kernel of its own. A tile kernel is one template definition; its instantiations are the configurations and stage 2's mapping.

**After `inline` + `split-sum`** a one-axis sum is a nested reduction and no longer has the contraction form, so matmul, attention and mlp then keep stage 3b's schedule and speed (script 06: one definition each, accepted as exact). Conv2d's three-axis sum is not split and stays tiled.

**4096³** was timed with 3 calls per variant (20.37, 20.64, 20.40 ms fused); I did not read the SM clock during it.

### The contractions

TFLOP/s is 2·M·N·K over the time. The contractions inside attention and mlp were timed alone, as one-statement functions at the shapes they have inside (the epilogue included); conv2d is one statement.

| Contraction (M × N outputs, K terms) | Fused ms | Unfused ms | Fused TFLOP/s | Unfused TFLOP/s | cuBLAS ms | cuBLAS / fused | Configuration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| matmul-512 | **0.0798** | 0.2114 | 3.36 | 1.27 | 0.0329 | 0.41 | k0: 64 × 64 / 4 × 4 / 16 |
| matmul-4096 | **20.4** | 133.8 | 6.74 | 1.03 |  | 0.35 (19.2 TFLOP/s) | k0: 64 × 64 / 4 × 4 / 16 |
| attention.score | **0.0462** | 0.6177 | 2.91 | 0.22 | 0.0177 | 0.38 | k0: 64 × 64 / 4 × 4 / 16 |
| attention.out | **0.0707** | 0.0958 | 1.90 | 1.40 | 0.0216 | 0.31 | k0: 32 × 32 / 2 × 2 / 32 |
| mlp.h | **0.0996** | 0.4743 | 5.39 | 1.13 | 0.0423 | 0.42 | k0: 64 × 64 / 4 × 4 / 16 |
| mlp.y | **0.154** | 0.3857 | 3.49 | 1.39 | 0.0475 | 0.31 | k0: 64 × 64 / 4 × 4 / 16 |
| conv2d | **0.1283** | 0.1663 | 2.21 | 1.70 |  |  | k0: 64 × 64 / 4 × 4 / 16 |

### The schedule chosen, and why

Every contraction has the same two configurations; the host picks by the number of tiles:

| Configuration | Tile | Patch per thread | Threads | Chunk | Staging | Chosen when |
| --- | --- | --- | ---: | ---: | --- | --- |
| 0 | 64 × 64 | 4 × 4 | 256 | 16 terms | both factors in shared memory, 8 KiB | at least 64 tiles of 64 × 64 and 64 terms |
| 1 | 32 × 32 | 2 × 2 | 256 | 32 terms | both factors in shared memory, 8 KiB | otherwise, at least 64 tiles of 32 × 32 and 64 terms |
| stage 2 | | 1 thread per output | 256 | | global loads | otherwise, or when a space reaches 2³¹ |

- **Mapping.** One block computes a tile of the (row, column) space of one batch point. Rows are the output axes only the left factor reads, columns those only the right factor reads; several axes of one role are linearised row-major (conv2d: rows n, y, xpos; column o). The reduction's axes are linearised the same way, which is the meaning's order.
- **Register tiling.** A thread holds RM × RN accumulators and, per term, loads RM left and RN right values for RM·RN multiply-adds (8 loads for 16 at 4 × 4, against 2 for 1 in stage 2).
- **Shared-memory staging.** Before each chunk every thread copies part of the chunk's left factors as [term][row] and right factors as [term][column], so a patch's values are adjacent. A factor is computed by the scalar code stage 2 would run, so `a[i,k] - 1` or conv2d's `x[n,c,y+dy,xpos+dx]` is staged like a plain load.
- **Why these sizes** (probes 01 and 02, hand-written kernels, then script 07 through the compiler): 4 × 4 patches with 64 × 64 tiles were fastest at 512³ and at mlp's shapes; neither staging nor register tiling gained alone (0.219 and 0.121 ms at 512³ against 0.076 together; stage 2: 0.213). Chunks of 16 beat 8, 32 and 64 with 64 × 64 tiles; 32 beat 16 with 32 × 32 tiles.
- **Why two configurations and a threshold:** see "The threshold" below.

### The threshold

Script 07 runs matmul through the compiler with each configuration forced (`--tile=0`, `--tile=1`) and with stage 2's mapping (`--tile=2`), median of 3 benchmark calls each, interleaved. "The final rule picks" is the rule as committed (tiles and terms), computed from the shape; the times are the forced runs.

| M × K × N | Tiles 64 × 64 | Tiles 32 × 32 | Config 0 ms | Config 1 ms | Stage 2 ms | The final rule picks | Fastest |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 128 × 256 × 128 | 4 | 16 | 0.0309 | 0.0148 | 0.0162 | stage2 (1.00 of stage 2) | tile32 |
| 192 × 256 × 192 | 9 | 36 | 0.0311 | 0.0156 | 0.0158 | stage2 (1.00 of stage 2) | tile32 |
| 256 × 256 × 256 | 16 | 64 | 0.0307 | 0.0209 | 0.0294 | tile32 (0.71 of stage 2) | tile32 |
| 320 × 256 × 320 | 25 | 100 | 0.0311 | 0.0282 | 0.0401 | tile32 (0.70 of stage 2) | tile32 |
| 384 × 256 × 384 | 36 | 144 | 0.0353 | 0.0291 | 0.0565 | tile32 (0.52 of stage 2) | tile32 |
| 512 × 256 × 512 | 64 | 256 | 0.0442 | 0.0504 | 0.1067 | tile64 (0.41 of stage 2) | tile64 |
| 256 × 16 × 256 | 16 | 64 | 0.0066 | 0.0105 | 0.0051 | stage2 (1.00 of stage 2) | stage2 |
| 512 × 16 × 512 | 64 | 256 | 0.0106 | 0.0075 | 0.0094 | stage2 (1.00 of stage 2) | tile32 |
| 512 × 4 × 512 | 64 | 256 | 0.0089 | 0.0068 | 0.0067 | stage2 (1.00 of stage 2) | stage2 |
| 2048 × 1 × 2048 | 1024 | 4096 | 0.0907 | 0.0762 | 0.0691 | stage2 (1.00 of stage 2) | stage2 |
| 2048 × 4 × 2048 | 1024 | 4096 | 0.0905 | 0.0791 | 0.0735 | stage2 (1.00 of stage 2) | stage2 |
| 1024 × 1024 × 32 | 16 | 32 | 0.1068 | 0.0519 | 0.0498 | stage2 (1.00 of stage 2) | stage2 |

- **64 tiles for the 32 × 32 configuration:** with 16 and 36 tiles it ties with stage 2 (0.91 and 0.99); with 64 it is at 0.71. 64 is the smallest measured count at which it wins by more than the 5% noise band.
- **64 tiles for the 64 × 64 configuration:** with 16, 25 and 36 tiles the 32 × 32 configuration is faster; at 64 the 64 × 64 one is (0.044 against 0.050 ms).
- **64 terms, found by this sweep after the benchmark table was measured.** With the tile count alone the rule chose a tile kernel for 256 × 16 × 256, 512 × 16 × 512 and 512 × 4 × 512, at 2.06, 1.13 and 1.33 of stage 2: with few terms a chunk is mostly staging. I added `minTerms` to the configuration (a second launch-time condition) and set it to 64, the smallest term count I measured winning (attention's `score`, 64 terms: 0.046 against 0.618 ms). Between 16 and 64 terms nothing is measured, so the rule is conservative there. The benchmark table's programs all have at least 64 terms, so their choices are unchanged; the GPU test asserts the choice at 512 × 16 × 512.
- **One and four terms at 2,048 × 2,048, and 32 columns with 1,024 terms:** stage 2's kernel is the fastest of the three, and the final rule picks it.
- **Not reached:** I stopped script 07 after these twelve shapes (the session's GPU queue was slow). Its last four shapes (very few rows or columns with long reductions) and its part b were not measured. Shapes with fewer than 64 tiles of 32 × 32 or fewer than 64 terms run stage 2's kernel, so a single contraction is at stage 2's speed there by construction.
- **What the rule does not cover:** it is fitted to matmul on this device. `attention.out` (1,024 × 64 outputs, 1,024 terms) takes the 32 × 32 configuration at 0.74 of stage 2, the thinnest margin in the table.

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

**Cost** (script 06: wall time of one `checkLowering`, which is the checked schedule build on the CPU plus one GPU run per side; the binary of an unseen source is compiled once, about 10 s of the first call):

| Program | Form | Accepted | Sides (GPU runs) | Definitions | Wall |
| --- | --- | --- | ---: | ---: | ---: |
| matmul | written, fused | exact | 3 | 1 | 12.3 s |
| matmul | inline+split, fused | exact | 1 | 1 | 5.9 s |
| softmax | written, fused | exact | 2 | 1 | 5.5 s |
| softmax | inline+split, fused | exact | 2 | 1 | 5.4 s |
| layernorm | written, fused | exact | 2 | 1 | 5.5 s |
| layernorm | inline+split, fused | exact | 2 | 1 | 6.3 s |
| attention | written, fused | exact | 3 | 3 | 11.4 s |
| attention | inline+split, fused | exact | 2 | 1 | 17.9 s |
| mlp | written, fused | exact | 3 | 3 | 11.5 s |
| mlp | inline+split, fused | exact | 2 | 1 | 12.4 s |
| conv2d | written, fused | exact | 3 | 1 | 13.4 s |
| conv2d | inline+split, fused | exact | 3 | 1 | 1.9 s |
| batched | written, fused | exact | 3 | 1 | 5.5 s |
| transposed | written, fused | exact | 3 | 2 | 7.8 s |
| twoterms | written, fused | exact | 3 | 1 | 5.8 s |
| gram | written, fused | exact | 3 | 1 | 8.1 s |
| chain | written, fused | exact | 3 | 2 | 10.2 s |
| attention_inside | written, fused | exact | 3 | 2 | 12.7 s |
| matvec | written, fused | exact | 1 | 1 | 6.3 s |

The checked build alone (script 03, CPU): matmul 3.3 s, softmax 1.4 s, layernorm 1.3 s, attention 7.1 s, mlp 4.7 s, conv2d 11.7 s (first measurements; most of matmul's is the reference evaluation of the samples, which the GPU check needs too). An unchecked build (`cudaSource`) is 0.3 to 0.5 s per function, cached.

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

### Small shapes (the cost of leaving the group)

Attention and mlp at small shapes, where no contraction reaches 64 tiles: the fused lowering runs each contraction in stage 2's mapping as its own launch (script 07, part b; median of 3 calls).

| Program and shapes | Fused ms | Base (3b) ms | Unfused ms | Fused / base | Chosen |
| --- | ---: | ---: | ---: | ---: | --- |

Part b of script 07 did not run before the session ended, so the table is empty: **the small-shape cost is argued, not measured.** The argument: below the thresholds each contraction runs stage 2's kernel in its own launch, so attention is three launches (stage 2 `score`, the block kernel for the softmax part, stage 2 `out`) against 3b's one and stage 2's six. Stage 3b measured one launch at 0.10 to 0.73 of several for small programs, so attention and mlp at small shapes are expected between 3b's time and stage 2's: **slower than the base, by microseconds.** This is the one place where the stage does not meet "no program slower than it is now", and the whole-group alternative under Later is the fix.

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

### Checks run

- `tests/tensor/schedule.test.mjs` (CPU): schedules of the corpus; the contraction form; a checked build step by step; legality refusals and five invalid hand-made schedules; the interpreter at 70 × 45 × 67; the printed source and the forced sides.
- `tests/tensor/schedule-gpu.test.mjs` (GB10; log in `various/schedule-gpu-test.log`): `checkLowering` exact for matmul, attention, mlp, conv2d, a batched matmul, a transposed operand with a factor expression and an epilogue, and a two-axis reduction; matmul at 130 × 45 × 67, 65 × 1 × 33 and 3 × 70 × 200 on every side against `runTix`; the host's choice at 512, 256 and 100; a mutant that adds each chunk backwards is rejected with the configuration named.
- The existing GPU tests (20, `various/existing-gpu-tests.log`) and the existing CPU tests of `tests/tensor/` pass; three assertions in `fusion.test.mjs` were updated (kernel counts of attention and mlp; fused matmul and conv2d no longer print stage 2's bytes; the in-place assertions read 3b's plan). `tests/framework/strategy-sync.test.mjs` is new.
- Stage 2's source digests (`fuse: false`) are unchanged.
- Not run: the full suite (`npm test`), by the brief; random programs through the new lowering.

## Later

- A whole-group alternative for launch-bound shapes; epilogue fusion of an elementwise statement into a tile kernel (mlp's `g` into `h`), which removes one launch and one round trip through global memory.
- A third configuration for large outputs (8 × 4 patches), vector loads, double buffering.
- Tiled matrix-vector products, reductions after `split-sum`, `max` folds, bodies other than a product.
- A schedule → CUDA correspondence record; a cost model in place of the tile-count threshold.
- Reassociating schedules (split-K, tree reductions), FMA, tensor cores, measured autotuning. The fold is the construct they would change: a reduction-order field on the configuration, which the interpreter's assertion would then check against.
