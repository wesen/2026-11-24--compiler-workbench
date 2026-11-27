---
Title: Report
Ticket: IRWB-029-E
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-contract.ts
      Note: fuse input, plan output, correspondence, spilled run
    - Path: repo://src/tensor/cuda-source.ts
      Note: emitPlan, emitRow, rowThreads
    - Path: repo://src/tensor/kernels.ts
      Note: Plan IR, legality rules, planner
    - Path: repo://tests/tensor/fusion-gpu.test.mjs
      Note: GPU checks, mutants, random programs
    - Path: repo://tests/tensor/fusion.test.mjs
      Note: Plan, legality and stage-2 text tests
ExternalSources: []
Summary: 'Stage 3 result: every corpus program is one kernel when fused, bit-identical to the f32 meaning; softmax 2.1x, layernorm 2.2x, attention 1.4x, mlp within noise. No framework or tool change was needed; six findings about the framework.'
LastUpdated: 2026-11-26T23:13:20.81421151-05:00
WhatFor: ""
WhenToUse: ""
---

# Report

## Result

- **Every corpus program is one kernel when fused,** and `checkLowering` accepts each fused lowering as `exact`, as compiled and after `inline` + `split-sum`.
- **Fused, unfused and the f32 meaning agree bit for bit.** At the brief's sizes the fused and unfused GPU outputs have the same sha256 for all six programs; for softmax and layernorm the meaning evaluated in JS has it too.
- **Speed:** softmax 2.1×, layernorm 2.2×, attention 1.4×, mlp 1.05× (inside the run-to-run spread). matmul and conv2d have one statement: their fused source is stage 2's.
- **No change to `src/framework/` or `tools/cuda-remote.mjs`** was needed. Six framework findings are below.

## Where fusion lives

In a **kernel plan**, a second v6 artifact (`tensor.kernels`, `src/tensor/kernels.ts`) between the Tix artifact and the CUDA source:

```ts
interface KernelPlan { fn: Fn; inlined: string[]; kernels: Kernel[] }
type Kernel = { mapping: 'element'; statement: string }
            | { mapping: 'row'; outer: number; statements: string[] }
```

- The plan IR's validator is the legality check, so an illegal plan cannot be made into an artifact. The planner uses the same two functions.
- The emitter prints a plan. `fuse: false` is the plan with one element kernel per statement; its text is stage 2's byte for byte (sha256 of 16 sources recorded from the base, compared in `tests/tensor/fusion.test.mjs`).
- A pass on the Tix IR cannot say "these statements share a block and `m[i]` is computed once in it". The emitter alone could, but then nothing validates the decision or relates statements to kernels.

## The fusions, and why each keeps the bits

Argued, then measured: every element's expression tree is evaluated by one thread with the same rounded operations in the same order as in stage 2. Only which thread evaluates it, and where an f32 intermediate is kept (a register or shared memory instead of global memory), change. Moving an f32 is exact.

1. **Inline** (thread mapping unchanged). `p` is substituted into its readers when every read is outside any reduction and reads one element of `p` per element of the reader (its indices are a permutation of the reader's axes), and, if `p` contains a reduction, there is one reader and one index tuple. Equal subtrees outside loops share a temporary.
2. **Rows** (one block per row). A run of consecutive statements whose first `outer` axes are the same, each of rank `outer` (computed by thread 0) or `outer + 1` (computed by all threads of the block), each reading the others only in its own row. Values that later statements read stay in the block's staged area. `__syncthreads()` follows every step.

| Program | Fusions applied | Thread mapping |
|---|---|---|
| softmax | rows: `m e s y` | block per `i`. Reason: `m[i]` and `s[i]` are computed once and read by every element of the row. `x`'s row is staged (thread 0 folds it from shared memory); `e` overwrites it. |
| layernorm | rows: `mean centered variance y` | block per `i`, same reason. `centered` overwrites the staged `x`. |
| attention | rows: `score shift e z weight out` | block per `i`. One slot: `score`, then `e`, then `weight`. `out[i,c]` is 64 threads folding `weight`'s row from shared memory. |
| mlp | inline `h` into `g` (the epilogue: bias and GELU after the contraction); rows: `g y` | block per `i`. `y[i,j]` folds `g`'s row from shared memory. |
| matmul, conv2d | none (one statement) | unchanged |

**Other choices in the lowering, each measured:**
- **64 threads per block.** Fastest on softmax and attention, within 8% of the fastest on layernorm and mlp (table in the diary, step 5; 256 threads cost softmax 60%).
- **The max fold uses a select form of `minmax`** in row kernels: same value for every input, 0.49 → 0.41 ms on softmax at 128 threads (probe 05). `minmax` itself is unchanged.
- **Rows whose staged bytes exceed 48 KB** (the launch limit without opting in; probe 03) are staged in a global scratch buffer by the same kernel. Probe 02: 0.52 ms against 0.43 ms for softmax if forced.
- **One row per block:** 2, 4, 8 and 11 rows per block were not faster (probe 03).

## Refused

In the corpus, nothing that was refused stays unfused. The refusals that decide the shape of the plans:

| Looks fusable | Refused because |
|---|---|
| Substituting `e` into `s = sum(j) e[i,j]` (softmax), `weight` into `out` (attention), `g` into `y` (mlp) | The read is inside a reduction: the producer would be evaluated once per term (`exp` in a serial fold; for `out`, 64 times as often). Rows fuse them instead. |
| Substituting `m[i]` into `e[i,j]` (softmax), `mean` and `variance` (layernorm), `shift` and `z` (attention) | A reduction read by every element of a row would be repeated per element. Rows fuse them instead. |
| A broadcast pointwise producer, `z[k] = exp(x[k]); y[i,k] = w[i,k] * z[k]` | `z` would be evaluated N times as often, and `k` is not `y`'s leading axis, so no row kernel either. Two kernels. |
| A column normalisation, `s[k] = sum(i) x[i,k]; y[i,k] = x[i,k] / s[k]` | Rows are keyed by the leading axes only. Two kernels. |
| A read of another row (`y[i,j] = e[j,i] * m[i]` with `m`, `e` in a row kernel) | A block holds one row. |
| Statements that share rows but pass nothing to each other; an unrelated statement between two related ones | The planner wants a run connected by reads, and does not reorder statements. |
| A lone row reduction (`y[i] = sum(j) x[i,j]`) | Nothing to fuse; it keeps stage 2's mapping (and its solitary walk through global memory). |
| Anything that reorders a fold (a parallel max, several rows' folds interleaved) | Not this stage's. |

`kernelPlan(program, fn)` returns the plan and these reasons for any program.

## Measurements

Sizes are the brief's. Times are `benchmark` times (a warm-up, then the median of three launches, under the GPU lock), from three invocations of `scripts/08-benchmark-fusion.mjs` (`scripts/08-results.jsonl`): median, and range in brackets. Bytes are counted from the plan by `scripts/11-global-bytes.mjs`: a kernel reads each tensor it loads from global memory once, whole, and writes each tensor it stores once; repeated loads of an element are not counted again, and shared memory is not global traffic.

| Program | | Kernels | GPU time, ms | Global bytes read + written | At 244 GB/s, ms |
|---|---|---|---|---|---|
| matmul | both | 1 | 0.213 [0.213, 0.215] | 2.10 MB + 1.05 MB | 0.013 |
| softmax | unfused | 4 | 0.798 [0.774, 0.813] | 67.1 MB + 33.6 MB | 0.413 |
| softmax | fused | 1 | 0.387 [0.383, 0.396] | 16.8 MB + 16.8 MB | 0.138 |
| layernorm | unfused | 4 | 0.471 [0.469, 0.603] | 67.2 MB + 33.6 MB | 0.413 |
| layernorm | fused | 1 | 0.215 [0.211, 0.253] | 16.8 MB + 16.8 MB | 0.138 |
| attention | unfused | 6 | 1.053 [1.049, 1.164] | 21.8 MB + 12.9 MB | 0.142 |
| attention | fused | 1 | 0.768 [0.767, 0.836] | 0.79 MB + 0.26 MB | 0.004 |
| mlp | unfused | 3 | 0.948 [0.948, 1.048] | 11.5 MB + 9.4 MB | 0.086 |
| mlp | fused | 1 | 0.903 [0.869, 1.103] | 3.15 MB + 1.05 MB | 0.017 |
| conv2d | both | 1 | 0.165 [0.165, 0.166] | 2.12 MB + 3.94 MB | 0.025 |

Per kernel, unfused (bytes read + written, ms at 244 GB/s):
- **softmax:** `m` 16.8 MB + 16 KB, 0.069; `e` 16.8 + 16.8 MB, 0.138; `s` 16.8 MB + 16 KB, 0.069; `y` 16.8 + 16.8 MB, 0.138.
- **layernorm:** `mean` 0.069; `centered` 0.138; `variance` 0.069; `y` 0.138 (same sizes as softmax, plus 8 KB of `gamma`, `beta`, `eps`).
- **attention:** `score` 0.52 + 4.19 MB, 0.019; `shift` 4.19 MB + 4 KB, 0.017; `e` 4.20 + 4.19 MB, 0.034; `z` 0.017; `weight` 0.034; `out` 4.46 + 0.26 MB, 0.019.
- **mlp:** `h` 2.10 + 4.19 MB, 0.026; `g` 4.19 + 4.19 MB, 0.034; `y` 5.24 + 1.05 MB, 0.026.

Reading the table:
- **layernorm fused is at 1.6 times its streaming bound.**
- **softmax fused is bound by `exp`,** which must be computed in double and rounded to match the meaning: stage 2's `e` kernel alone takes 0.37 ms against 0.14 ms of traffic (probe 04). The brief's prototype figure (4.25×) is not reached; 2.1× is.
- **attention and mlp are bound by their contractions, not by memory.** Unfused they already spend 0.14 and 0.09 ms' worth of traffic in 1.05 and 0.95 ms. attention's `score` alone is 0.62 ms (`scripts/12`): each thread walks its own row of `k`, so the loads of a warp are 256 bytes apart. Fusion removes attention's intermediate traffic and gains 0.29 ms; it does not change `score`. mlp's two contractions run at matmul's rate (268 M multiply-adds in about 0.44 ms each); what fusion can save is 0.07 ms of traffic, the size of the spread.

## The contract

**What it checks.** `checkLowering(program, fn, { fuse })` executes `tensor.lower-cuda`: it builds the plan (the IR validator checks legality), emits the source, and its `ensures` compares the GPU's result with the current revision's f32 meaning on every case, bit for bit, NaN as a class. Cases are the stage-2 recipe (sizes 1, 3, 4, 7, all-distinct, zeros; four input streams), plus:
- **long rows:** per shape symbol, that symbol at 67 (= 64 + 3) and the others at 2, so that a thread of a row kernel takes a second element and the last stride is partial;
- **spilled rows:** when the source has a row kernel, the same batch runs a second time with `--spill`, which forces the staged rows into global scratch; a case agrees only if both runs agree.

Mutants of fused softmax show each addition is needed (measured, `fusion-gpu.test.mjs`): reversing the order of the sum fold is rejected by the ordinary cases; a thread that computes only its first element is rejected only by a long-row case (`C = 67, N = 2`); every block using the first row's scratch is rejected only by the spilled run.

**What it does not check.** It compares the function's result only, so a rejection names an output element, not a kernel. The spill run forces the path; the host's own decision (bytes > 48 KB) is covered by a GPU test with 13000-element rows, not by the contract. A long-row case is dropped when a parameter would exceed the recipe's 4096 elements (a square `f32[N,N]` at 67). The barrier after a step that stores nothing was found by reading the code, not by a failing case (diary, step 7).

**What it costs** (`scripts/13-results.jsonl`, wall time, measured):

| | cases | references in JS | nvcc | whole check, build cached |
|---|---|---|---|---|
| softmax unfused / fused | 40 | 4 ms | 1.0 / 0.9 s | 2.7 / 2.8 s |
| layernorm | 40 | 4 ms | 1.1 / 1.0 s | 3.4 / 3.1 s |
| attention | 56 | 10 ms | 1.1 / 1.0 s | 2.3 / 2.5 s |
| mlp | 56 | 11 ms | 1.0 / 1.0 s | 2.4 / 3.2 s |
| matmul, conv2d | 48 | 7, 562 ms | 0.9 to 1.0 s | 2.2, 2.8 s (the fused check replays the verdict: same source) |

The check is ssh round trips and process start: the batch itself runs in 0.3 to 0.6 s. The second (spilled) run goes in parallel with the first; the fused check took between 0.25 s less and 0.8 s more than the unfused one. Running several checks at once has a limit that is not the GPU: six concurrent checks had ssh connections reset; three pass.

## Framework and tool changes

**None.** `tools/cuda-remote.mjs` already passes program arguments (`-- --spill`). In the framework, `defineIR`, `defineType`, `defineTransformation` with a correspondence requirement, `makeCorrespondence` and `semanticCorrespondence` were enough to add a second artifact kind and a many-to-one relation. That it took no change is the first finding; the others are where the fit is loose.

1. **Many statements becoming one kernel is expressible.** One correspondence entry `{from: [mlp/g, mlp/h, mlp/y], to: [mlp/k0], relation: 'fused'}`; parameters and functions that are not lowered go to an entry with no target. The manager accepts it across IR kinds (it checks the two revisions and the relation name).
2. **Nothing consumes the correspondence.** The invariant sees the function's result, so a counterexample cannot be attributed to a kernel through it. To use it, the differential would need per-statement outputs from the GPU (the materialized ones) and the relation to pick which to compare.
3. **`semanticCorrespondence` drops each entry's `note`** (only relation names reach the evidence). The thread mapping and its reason, which I attach per kernel, do not reach the checked record; they are in the plan artifact instead.
4. **A pass cannot produce another IR kind.** `definePass` (declared `writes`, diffing, preservation) is same-adapter. Fusion's decision changes kind, so it is a transformation, and the pass layer's write discipline has no counterpart for it.
5. **An IR validator sees only its value.** Legality is a relation between a plan and a Tix function. To make it a validator the plan embeds the function. Whether that function is the baseline's is not checked by the validator; the exact GPU check covers it. A relational legality check would be an invariant over two ports.
6. **`decide` returns one verdict per case.** Two executions of the subject (normal and spilled) are folded into one verdict with a reason prefix; the evidence does not show two runs.

## Measured and argued

- **Measured on the GB10:** every time; bit equality of fused, unfused and (softmax, layernorm) the meaning at full size; acceptance of the corpus (compiled and optimized, both lowerings), of 24 random programs in the test and 60 more in a sweep (120 checks, none rejected; 246 kernels became 137); rejection of the three mutants; rows of 327 and 13000 elements; the shared-memory limit; the probes' phase costs.
- **Counted, not measured:** global bytes per kernel (from the plan; the profiler was not used).
- **Argued:** that the two fusions preserve bits for every program (the argument above; the cases are samples); that `fold_max` equals `minmax(a, b, true)` for all inputs (by reading the two; probe 05 compared rows with NaN, ±0 and infinities); that `exp` is softmax's floor (inferred from stage 2's `e` kernel time against its traffic).

## Left out, and later

- A row mapping for a lone row reduction; staging reduction bodies other than a plain row read; row keys other than the leading axes; reordering independent statements: no corpus program needs them.
- Threads per block chosen per kernel from runtime sizes (mlp prefers 512, softmax 64).
- attention's `score`: a mapping in which a warp's loads of `k` are adjacent. It is a single statement's thread mapping, not fusion.

## Files

- `src/tensor/kernels.ts` (new): plan IR, legality, planner.
- `src/tensor/cuda-source.ts`: `emitPlan`, row kernels, `kernelTraffic`, `rowThreads`.
- `src/tensor/cuda-contract.ts`, `contract.ts`, `cuda-runtime.ts`, `index.ts`: `fuse`, `benchmark`, `kernelPlan`, the correspondence, long-row cases, the spilled run.
- `tests/tensor/fusion.test.mjs`, `tests/tensor/fusion-gpu.test.mjs` (new); `tests/tensor/cuda.test.mjs` (one assertion now passes `fuse: false`).
- `ttmp/2026/11/26/IRWB-029-E--…/scripts/01` to `13`.
