Everything is committed and passing. Here is the summary.

## Ticket, design, report
- Ticket: `ttmp/2026/11/27/IRWB-033-G--a-schedule-ir-and-exact-tiled-contractions-through-it/`
- Design: `.../design-doc/01-schedule-ir-and-exact-tiled-contractions.md` (committed first, at `1bfcc95`)
- Report: `.../reference/01-report-schedule-ir-and-exact-tiled-contractions.md`, diary `.../reference/02-implementation-diary.md`
- Scripts (all with `*.out.jsonl`): `01-hand-tiled-gemm.mjs` (probe before the design), `02-gpu-matmul.mjs`, `03-benchmark.mjs` (corpus / gemm / big), `04-contract-cost.mjs`; GPU logs in `various/`.

## The schedule IR, its passes, the strategy
- **`tensor.schedule` v1** (`src/tensor/schedule.ts`): a validated v6 artifact with an adapter; per kernel it holds `mapping`, `depth`, `members`, `stored`/`buffered`/`staged`, `terms`, `inPlace`, `heavy`, `gated`, the thread-width **rule**, the optional `contraction` (block tile, lane patch, `kTile`, staged operands) and `orders` (each outermost reduction's visit order). It names the Tix revision it schedules; the fusion plan of stages 3/3b feeds it.
- **Passes** (`schedule-passes.ts`): `tensor.schedule-build` (Tix → schedule, the framework's first cross-kind pass), `tensor.schedule-tile-domain`, `tensor.schedule-tile-reduction` (the order-preserving strip-mine), `tensor.schedule-stage-operand`. Each has legality decided from the IR before it is applied, its refusals recorded, and a framework-derived correspondence.
- **Strategy** (`schedule-strategy.ts`): build → for every kernel `contractionOf` accepts: tile 64×64/4×4 → `kTile 32` → stage both operands. A rule over the IR, no timing. `fuse: false` schedules nothing.

## New approaches and what they gave
- **An accumulation-order analysis as the gate**: every step is checked by recomputing the reduction visit order on the output and comparing it with the input's; a reversed nest or a split-K is structurally rejected, no GPU involved (4–20 ms/program). Tested both through the synchronous gate and through the framework's `preserves`.
- **One `template <bool Tiled>` kernel definition** with the host choosing the tiled or the per-element body from the shapes (`M·N·K ≥ 1.5·10⁷` and ≥ one block per SM) — kernel count unchanged, and `checkLowering` forces both bodies (`--tile=tiled|plain`).
- **Copying each tile along the operand's own innermost index**, which made the transposed operand (`sum(k) q[i,d]*k[j,d]`) fast: 0.617 → 0.0375 ms.
- Refused with measurements: vector loads (0.0756 vs 0.0637 ms), double buffering, split-K, tiling inside block-mode groups.

## Measurements (median of 5 alternating `benchmark` calls)
| Contraction | fused ms | unfused ms | TFLOP/s | /cuBLAS |
|---|---:|---:|---:|---:|
| matmul 512³ | 0.070 | 0.210 | 3.84 | 2.13 |
| matmul 4096³ | 21.6 | 134.0 | 6.37 | 3.01 |
| attention score | 0.0375 | 0.618 | 3.58 | 2.12 |
| attention out | 0.0955 | 0.0968 | 1.41 | 4.42 |
| mlp h | 0.101 | 0.466 | 5.32 | 2.38 |
| mlp y | 0.132 | 0.383 | 4.06 | 2.78 |
| conv2d | 0.166 | 0.166 | 1.71 | – |

Corpus, fused now vs stage 3b: matmul 0.070 (was 0.217), softmax 0.387 (0.385), layernorm 0.159 (0.170), attention 0.745 (0.746), mlp 0.631 (0.627), conv2d 0.166 (0.165) — nothing slower, and those five emit stage 3b's bytes.

## Framework and tool changes
- `src/framework/passes/define-pass.ts`: `PassSpec.source` (a pass may read an artifact of another IR kind) and an optional output artifact id for `applyNativePassSync` — reason: the Tix → schedule step could not be written as a pass, because the input was opened with the pass's own adapter and failed kind validation.
- No tool change; no other framework change.

## Last commit
`46a4091` (`IRWB-033-G: tests, measurements and the final report`) — working tree clean, build clean, 15 new non-GPU tests + 7 new GPU tests + all pre-existing tensor and framework tests pass (one assertion in `tests/tensor/fusion.test.mjs` updated because matmul is deliberately no longer byte-identical fused vs unfused).
