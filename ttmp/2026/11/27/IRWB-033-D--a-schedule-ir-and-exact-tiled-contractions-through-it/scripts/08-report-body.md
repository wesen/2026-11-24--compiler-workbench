## The schedule IR

`tensor.schedule` (version 1, `src/tensor/schedule.ts`) is a v6 artifact made with `defineIR` and a v6 adapter, so the framework's pass machinery applies to it. A schedule holds the algorithm (the Tix function, unchanged) and one schedule kernel per CUDA kernel:

| Construct | What it is | Printed by |
| --- | --- | --- |
| `pointwise` kernel | a fusion group in thread mode: one thread per element, members in registers | stage 2's and stage 3's printers, unchanged |
| `rows` kernel | a stage 3/3b block-mode group, its `FusionGroup` (staged terms, in-place rows, gate) unchanged | stage 3b's printer, unchanged |
| `contraction` kernel | a thread-mode group whose one reduction is a tileable contraction, with `dims`, `operands`, `variants` and `select` | the new printer (`cuda-contraction.ts`) |
| `dims` | the output axes only the first operand reads (`m`), only the second reads (`n`), the rest (`b`), and the reduction axes in the meaning's order (`r`); each flattened row-major | |
| variant | a loop nest over b, m, n, r: loops with `dim`, `level`, `factor` (null = the rest) and `bind`; and the operand tiles it stages | |
| `stage` | copy an operand's tile to shared memory at an r loop; `fast` = the dim consecutive threads copy along | |
| `select` | the launch rule: the first variant whose grid has at least `minBlocks` blocks per SM | the host |

A **tileable contraction** is a statement with exactly one reduction, outermost, a `sum` over `dim` extents, whose body is `X[...] * Y[...]` with X and Y computed elsewhere, and where each operand reads an output axis the other does not. The rest of the statement is its epilogue (attention's `/ sqrt(D)`, mlp's `+ bias[j]`, and mlp's `g`, which joins `h`'s kernel as a pointwise member). All five corpus contractions are tileable; conv2d gets m = (n, y, xpos), n = (o), r = (c, dy, dx).

The adapter's entities are kernels, variants (`k0/v1`), loops (`k0/v1/m.1`) and stages (`k0/v1/stage.m`); `entities(value)` on the IR lists the same IDs, so the contracts manager's F23 check applies to schedule correspondences.

**Printable form.** The printer accepts variant 0 (every output loop bound to `thread`: one thread per output, stage 3's thread-mode code) and one tiled form: `b.0 block.z; m.0, n.0 on block.x/y; m.1 thread.y; n.1 thread.x; r.0 serial; r.1, m.2, n.2 unroll`, both operands staged at `r.0`. It reads every number from the schedule (tile extents, threads, which dim each copy walks, which grid axis numbers which tiles, the launch bound and the rule) and decides nothing. Anything else is valid IR that it rejects ("schedule not printable: expected loop 1 to be m.0 ..."; tested). The strategy's intermediate revisions are therefore not printable; they are checked at the IR level only.

*Considered instead:* (a) no schedule IR, the tile sizes as plan fields, which is what the brief rejects and would leave nothing for a step check to look at; (b) a general loop-nest printer for any nest. The single printable form is the simplest that lets every step be a separate pass; a general printer is Later.

## The passes

Each is a `definePass` on the schedule IR, with its legality decided from the IR before it runs (the framework's new `legal` hook) and a correspondence to the revision before (the framework's `makeCorrespondence`, with explicit entries where entities split or are renamed).

| Pass | Legality (refused before `run`) | Correspondence |
| --- | --- | --- |
| `isolate` | some rows kernel computes a tileable contraction; the new groups are `planFusion(fn, { noBlock })` | old kernels to new kernels, grouped by shared statements (`refused-fusion`) |
| `contraction` | a pointwise kernel; exactly one member has a reduction; it is tileable | kernel retained, variant 0 and its loops inserted |
| `variant` | a contraction kernel | new variant and loops inserted |
| `split` | the loop is serial; the factor is a positive integer dividing a fixed factor | loop to (outer, inner) `split`; deeper levels `renamed` |
| `reorder` | a permutation; r loops keep their relative order | retained |
| `bind` | r loops only `serial` or `unroll` (else a reassociation); a hardware index once per variant; `thread.*` and `unroll` need fixed factors | retained |
| `stage` | `at` is an r loop; the tile's loops are fixed; tile under 24 KiB | stage inserted |
| `select` | the variants exist; the last entry takes every grid | retained |

**Every application is gated by the order analysis** (`accumulationOrder`, passed as the gate of `applyNativePassSync`). For each statement with a reduction it gives the order in which each output receives its terms. A rows or pointwise kernel has the meaning's order by construction (stage 2's scalar code; stages 3 and 3b). For a contraction kernel the analysis checks every variant:

1. no r loop is bound to a block or thread index;
2. **simulating the nest** at small extents that are not multiples of any factor (b, m, n, r = 2, 5, 3, 11; 1, 7, 2, 1; 3, 1, 1, 0), the r loops alone, in nest order, enumerate r = 0, 1, …, R − 1, and each output dim's loops reach each value exactly once.

Simulating per dim is exact for this IR, not an approximation: the accumulator is indexed by the output point, so loops of other dims cannot change the sequence of terms one output receives. If every variant passes, the value is `lexicographic(<r axes>)`, the same string a scalar kernel gets; otherwise it names the variant and the first wrong sequence. The gate requires equal values before and after, so a step that changed any output's order is rejected (`contractRejected`) and not published.

**What this covers.** The test `schedule.test.mjs` applies a rogue pass that swaps the factors of r.0 and r.1, so that no loop moves and `reorder`'s legality could not see it; the gate rejects it with "r in the order 0 4 8 1 5 9 …". Legality refuses a reorder of r loops, a reduction loop bound to `thread.x` and the others above. **What it does not cover:** the printer. Two printer mutants (terms in reverse inside a tile; tiles padded with 1 instead of 0) pass every IR check and are rejected by the GPU check, with the variant and a coordinate (`schedule-gpu.test.mjs`). The GPU check is also what covers the padding argument (below) at run time.

**Padding is exact (argued).** Tiles are zero beyond the extents. A padded term is `__fmul_rn(0, 0) = +0`, and `acc + (+0) = acc` unless acc is −0; acc starts at +0, and in round-to-nearest `x + y = −0` only when both are −0, so acc is never −0. Loads and stores through shared memory move words unchanged.

## The strategy, and where `src/framework/strategy` does not fit

`scheduleFunction(fn, plan, fuse)` (`src/tensor/strategy.ts`) applies, for the fused lowering:

1. `isolate` (skipped when illegal: no block group holds a tileable contraction);
2. for each pointwise kernel: `contraction` (skipped when illegal); then for each of three tile configurations: `variant`, `split` ×5 (m by TM then BM/TM, n likewise, r by BK), `reorder` to the printable order, `bind` ×8, `stage` ×2 with `fast` read from the operand's last index (the dim whose innermost axis it steps by 1);
3. `select`.

That is 53 applications per contraction kernel, each through `applyNativePassSync`. A function's schedule is memoized; the first scheduling takes 0.5 to 2.9 s of CPU on this (shared, loaded) machine for the corpus (script 05), mostly the framework's per-step projection, diff, correspondence and hashing.

The framework's strategy module would express this as a plan of `apply` and `forEach` nodes, and I planned to use it. **It does not fit:** its interpreter's `execute` is asynchronous, and `cudaSource` is synchronous by the fixed API, so a plan cannot produce the source `cudaSource` returns. *Proposed (not made):* an `executeSync` for plans whose algorithms are all synchronous. With it, the function above is a plan over the same passes, and the trace records each step.

**Fusion feeds the schedule from its plan.** `planFusion` decides groups from Tix reads; the schedule holds rows kernels as one construct, and changes fusion decisions with one kernel-level pass, `isolate`, which re-plans with `noBlock`. Re-expressing 3b's term staging, in-place rows and gate as loop-level passes would re-implement them without adding a check, because their argument (one thread per element, stage 2's scalar code) is unchanged.

**Why isolate.** Block mode computes a contraction with one block per output row, so each block re-reads the other operand from L2; the tiled kernel reads an operand tile once per tile of outputs. Isolation costs kernels: attention has 3 (`score`; `shift, e, z, weight`; `out`), mlp 2 (`h, g`; `y`). Its effect is in the corpus table: attention fused went from 0.75 to about 0.16 ms. *Refused alternative:* tiling inside block mode (several query rows per block, the scores of those rows in shared memory). It needs a multi-row form of 3b's emitter and is Later.

## Launch-time variants

The tile size depends on the shapes, which `cudaSource` does not know, so a contraction kernel has four variants in one `template <int V>` definition (one `__global__`), and the host picks one at launch:

| Variant | Tile m × n × r | Outputs per thread | Threads | Chosen when |
| --- | --- | --- | ---: | --- |
| 0 | one output per thread | 1 | 256 | the tiled grids exceed CUDA's grid limits |
| 1 | 128 × 64 × 8 | 8 × 4 | 256 | its grid has at least 16 blocks per SM |
| 2 | 32 × 32 × 8 | 4 × 4 | 64 | else, its grid has at least 2 blocks per SM |
| 3 | 32 × 32 × 8 | 2 × 2 | 256 | otherwise |

Choices, each with its reason:

- **Separate `__fmul_rn` and `__fadd_rn`, one accumulator per output, r ascending:** the meaning (fixed).
- **Register tiles** (8×4, 4×4, 2×2) and **shared-memory tiles of both operands**, BK = 8: probe 01's fastest at the brief's shapes.
- **Transposed tiles** (`As[BK][BM + 4]`, `Bs[BK][BN + 4]`): the inner loop reads TM consecutive m values for one k; the 4-float padding keeps the transposed copy free of bank conflicts and rows 16-byte aligned.
- **Vector reads from shared memory** (float4) when the per-thread extent is a multiple of 4; they need nothing at launch.
- **Coalesced copies:** consecutive threads copy along the dim that is contiguous in global memory (`fast`), read from the IR: r for `a[i,k]` and for attention's `k[j,d]` (the transposed operand), n for `b[k,j]`, m for conv2d's `x` (xpos).
- **`__launch_bounds__` per variant** (probe 04: without it, variants 1 and 2 ran 1.7 and 2.2 times slower at 512³).
- **n tiles on `blockIdx.x`** (probe 04: 0.050 to 0.044 ms for variant 2 at 512³; one measurement each, near the noise).

Refused: vector loads from global memory (alignment and divisibility are known only at launch: another variant axis); double buffering (not attempted in this session); larger BK (64×64×16 was 5 to 10% faster than ×8 in probe 01 at three shapes, but no variant uses 64×64); everything the brief excludes (split-K, tree reductions, FMA, tensor cores, timing candidates).

## New approaches tried

- **Order preservation from the IR, checked at every step.** Worked as far as it reaches: the analysis rejects a pass that changes any output's term order even when no loop moves (the rogue pass in `schedule.test.mjs`), and legality refuses the obvious ones before they run. It is cheap (a few hundred simulated points per variant, memoized). It does **not** remove the GPU check, because the printer is not verified against the nest: the two printer mutants pass every IR check. So the GPU check still covers the printer, the padding argument and the scalar code of epilogues; the IR check covers every scheduling step.
- **A correspondence through every step.** Each application yields a framework correspondence (split, renamed, inserted, refused-fusion entries). I did not compose them into one record from Tix statements to the final loops; the order analysis already follows each output's terms, and composition would need every step's entity universe kept. Not tried.
- **Shared rewrites between contractions and row kernels.** Not tried: rows kernels stay one construct (above).
- **An IR-level cost model.** Not tried; the launch rule is two thresholds read from measurements.
- **Framework legality hook.** Worked; it is the one framework change.

## Framework and tool changes

1. **`PassSpec.legal` and `PassError('illegal')`** (`src/framework/passes/define-pass.ts`; test in `tests/framework/native-pass-sync.test.mjs`). `applyPass` and `applyNativePassSync` call `legal({ before, view, params })` before `run`; a refusal throws `PassError('illegal', reason)` and runs nothing. *Reason:* the brief asks for each step's legality decided from the IR before it is applied. Without the hook a pass could only throw from `run`, which the caller cannot tell apart from a bug or a rejected contract; the strategy needs exactly that distinction to skip a step that does not apply (`isolate` on matmul, `contraction` on a pointwise kernel without a contraction) while still failing on anything else.

No change to `tools/cuda-remote.mjs`.

**Findings, not changed:**

- **`src/framework/strategy` is asynchronous only** and `cudaSource` is synchronous, so the strategy is a TypeScript function (above). Proposed: `executeSync` for plans of synchronous algorithms.
- **`applyNativePassSync` rejects `preserves`** ("This pass requires the asynchronous analysis manager"), so the order analysis cannot be declared as a preserved v6 analysis on a synchronous pass. It is the application's gate instead, which the function already takes. A synchronous preservation check by recomputation (the second half of what `applyPass` does) would let a pass declare it.
- **The framework's per-step cost** dominates scheduling: about 10 ms per application on a schedule of 9 KB (projection, diff, correspondence, `immutable` and fingerprints), 53 applications per contraction kernel. A function's schedule is memoized, so it is paid once per function.
- **Passes between IR kinds.** Tix to schedule and schedule to CUDA are not passes (`definePass` has one IR); the first is a function (`initialSchedule`) and the second is inside `tensor.lower-cuda`, a transformation, as before. That fit; nothing needed changing.

## What the contract checks and what it costs

`checkLowering` runs `tensor.lower-cuda` (now through the schedule) under the exact relation. A program with contraction kernels runs **every sample in every mode**: each of the four variants forced (`--variant=N`), paired alternately with the two gate sides when the program also has a gated kernel. The case list's baseline key is the list of modes. With the recipe's small shapes (sizes 0 to 11) the tiled variants run almost entirely in tails and padding, which is what the padding argument needs checked.

CASES_TABLE

## Measured, and only argued

**Measured on the GB10:** every number in the tables; exact acceptance of the six corpus programs fused and unfused (script 02), of six feature programs with every variant forced (a batched product, a transposed operand with an epilogue, a pointwise member after the contraction, a 2-axis reduction with shifted reads, a contraction reading a row kernel's output in its epilogue, two chained contractions), and of attention and mlp after inline + split-sum (`schedule-gpu.test.mjs`); runs at shapes the rule tiles, including a single and a two-term reduction, a one-row product and a batched product, equal to the interpreter; two printer mutants rejected with a variant and a coordinate; bit-identical outputs of every variant and side at every benchmarked shape.

**Argued, not measured:** that the padding never changes a bit (above; the GPU cases exercise it); that the per-dim simulation covers every output's order for every extent (the argument is the mixed-radix enumeration and the per-output accumulator; the simulation is at three extent sets); that the printer prints what the nest says (only the GPU check covers it); the rule's behaviour between measured thresholds.

## Later

- `executeSync` in `src/framework/strategy`, and the strategy as a plan.
- A general loop-nest printer, so that intermediate schedules run and every step can also be checked on the GPU.
- Vector loads from global memory and double buffering, as variant axes or `stage` parameters.
- Tiling inside block groups (attention without the round trip of `score` and `weight` through global memory).
- A cost model in place of the two thresholds; split-K and tensor cores as passes that the order analysis would mark (they change `r`'s order by design and need a new relation).
