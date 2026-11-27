Done. Last commit: **`177f5f6`** (branch as given, not pushed).

## Ticket and documents
- Ticket: `ttmp/2026/11/27/IRWB-033-H--a-schedule-ir-and-exact-tiled-contractions-through-it/` (`index.md`, `tasks.md`, `changelog.md`)
- Design: `…/design-doc/01-a-schedule-ir-between-tix-and-cuda-and-exact-tiled-contractions.md` (+ an "As built" section)
- Diary: `…/reference/01-implementation-diary.md`
- Report: `…/reference/02-report-a-schedule-ir-and-exact-tiled-contractions.md`
- Scripts (committed): `…/scripts/01-exact-tiled-gemm-probe`, `02-tile-sweep`, `03-attribute-probe`, `04-bench.mjs` (+ `04-final-table.out.{txt,jsonl}`), `05-schedules.mjs`, `06-contract-cost.mjs` (+ `.out.txt`)

## The schedule IR, its passes, the strategy
- `src/tensor/schedule.ts`: `ScheduleIR` (`tensor.schedule` v1, v6 artifact with entities `k0`, `k0/y` and a `computes` relation) holding the Tix algorithm verbatim plus one `KernelSchedule` per kernel; `Contraction` carries the reduction axis, its two loop levels' **order** (as IR data), tile/patch/block splits, unrolling, the printed `variants` and a `fallback`.
- Passes (each a `definePass` on the schedule, applied through `applyNativePassSync` with an order claim and gate; legality decided from the IR before running, refusal names its reason): `schedule.tile-reduction`, `schedule.bind-thread-patch`, `schedule.bind-block-tile`, `schedule.unroll`, `schedule.launch-variants`, and `schedule.double-buffer` (in the IR, never emitted — the printer refuses rather than ignore it).
- Check: `orderOf(schedule)` — the accumulation order of every statement's reduction, derived from *both* algorithm and layout. Ascending/ascending normalises to the meaning's `0..K-1`; a reversed level or an unknown layout key is rejected with `preserveViolated` and no GPU run (two mutant passes in `tests/tensor/schedule.test.mjs`).
- Strategy: `src/tensor/strategy.ts` emits a **Strategy IR plan** (`sequence` of five `apply` nodes), executed by the new `runPlanSync`; the shape-dependent tile choice is made at launch by a cost model over the variants (`waves·2MNK/(rate·issue·fill)`), plus `tiled = blocks ≥ SM count` which sends small grids to stage 2's form printed as one more instantiation.
- Fusion (stage 3 groups, 3b staged terms / in-place / gate) feeds the schedule from the plan and is unchanged; the emitter now reads every decision from the schedule.

## New approaches, and what they gave
Order analysis as the pass's *claim* (proved without a GPU; separates order from value); launch-time cost model over printed variants (11% at 512³ vs a compile-time constant, and no loss at small shapes); stage-2 form as an extra instantiation (removed 2.0–2.7× losses at three small shapes); peeled remainder (shipped, exact at `K=0`, `K=37`); not done: per-element correspondence, timing-based choice, double buffering, vector loads.

## Contractions
| | fused ms | unfused ms | fused/unfused | TFLOP/s | vs cuBLAS |
|---|---:|---:|---:|---:|---:|
| matmul 512³ | **0.0628** | 0.2122 | 0.296 | 4.28 | 1.91× its time (8.15 TFLOP/s) |
| matmul 4096³ | **17.19** | 134.46 | 0.128 | 7.99 | 2.40× its time (19.2 TFLOP/s) |
| matmul 1024³ | 0.3180 | 2.0082 | 0.158 | 6.75 | — |
| conv2d (program) | 0.1662 | 0.1662 | 1.00 | 1.71 | — |
| attention (program) | 0.7447 | 1.0505 | 0.71 | — | cuBLAS's two GEMMs 0.0393 ms, not comparable |
| mlp (program) | 0.6250 | 0.9427 | 0.66 | — | cuBLAS's two GEMMs 0.0898 ms, not comparable |

matmul 300×200×100 / 128³ / 17×4096×33: 0.0135 / 0.0106 / 0.1671 (ratios 1.05 / 0.99 / 0.99 — the fallback). Corpus, fused vs base stage 3b: softmax 0.384 (1.00), layernorm 0.179 (1.05, noise), attention 0.745 (1.00), mlp 0.625 (1.00), conv2d 0.166 (1.01) — nothing slower; kernel count 1 fused everywhere, `fuse:false` still byte-identical to stage 2.

## Framework and tool changes
1. `applyNativePassSync` gained an optional `claims` list (synchronous analogue of `preserves`; rejects with `preserveViolated`) — a sync lowering otherwise could not state a claim.
2. `src/framework/strategy/sync.ts`: `runPlanSync` (sequence/apply plans over the shared registry and validation; refuses other node kinds) — the interpreter is async and `cudaSource` is not.
3. `syncPassAlgorithm` in `passes/bridge.ts` — sync twin of `passAlgorithm`.
4. `CudaIR` v2→v3: `mapping: 'gemm'` and the schedule carried in the unit. No change to `tools/cuda-remote.mjs`.
