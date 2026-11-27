Stage 6 is complete and committed. The final summary:

## Ticket and documents
- **Ticket:** `ttmp/2026/11/27/IRWB-033-F--a-schedule-ir-and-exact-tiled-contractions-through-it/`
- **Design:** `design/01-schedule-ir-and-tiled-contractions.md` · **Report:** `reference/02-report-schedule-ir-and-tiled-contractions.md` · **Diary:** `reference/01-implementation-diary.md` · **Scripts 01–06** with all outputs
- **Last commit:** `81de2a4` (branch `t6-g-h/irwb-033-f`, not pushed)

## The schedule IR, its passes, the strategy
- **`tensor.schedule`** (`src/tensor/schedule.ts`): a v6 artifact between Tix and CUDA holding the algorithm (statements verbatim) plus per-kernel schedule constructs. Fusion decisions **feed** it from `planFusion`'s plan (grouping is Tix dataflow; re-deriving it as passes would add revisions without a check). `ScheduleIR` enumerates kernel entities, so the new `statements-to-schedule` correspondence is entity-checked against both artifacts (F23).
- **Passes** on the schedule IR (v6 `definePass`, `writes: kernel`, each applied with legality decided first): **`tensor.tile-contraction`** (two-operand GEMM-shaped contractions: matmul, transposed operands, k-vector operands, epilogues; conv2d/multi-statement groups/rank-1/split-sum refused with recorded reasons) and **`tensor.double-buffer`** (legal, checked, but **not picked by the strategy** — measured to halve residency and lose beyond noise). Each pass **preserves the `tensor.schedule-order` analysis** (per-reduction fold order as data, chunk partition validated as an exact ascending cover), and the **`tensor.schedule-ordered` property** checks the final schedule against the algorithm. The emitter only prints: one templated kernel per tiled contraction, Mode 0 = tiles (register patch, shared A/B tiles, ascending k-chunks, masks), Mode 1 = stage 2's mapping behind the launch gate.
- **Strategy:** a pure rule (`scheduleStrategy`) with recorded reasons and refusals. `src/framework/strategy` does not fit — async interpreter vs the fixed synchronous `cudaSource`, static JSON plans, JSON-value algorithms — reported with what would make it fit.

## New approaches tried
- IR-proven order preservation per step (sync `preserves`): a lying pass and an op-swapped schedule are both rejected — works.
- Statement-following schedule correspondence with entity checking — works (invented kernels rejected).
- Double buffering — negative result, quantified (1.4–2.1× worse at 4096³).
- Wide-j/8×8-patch configs — the shipped table; one-wave 48-block shapes — no gain; 1024-thread blocks — refused (one failed to launch).

## Per contraction (fused / unfused, ms; TFLOP/s; cuBLAS ratio where given)
| | fused | unfused | TFLOP/s | vs cuBLAS |
|---|---:|---:|---:|---:|
| matmul 512³ | **0.076** | 0.214 | 3.5 | 2.3× slower (was 6.6×) |
| matmul 4096³ | **19.0** | 133.8 | 7.2 | 2.7× slower (19.2 TF/s) |
| attention `score`+`out` (whole program) | 0.749 | 1.050 | ≥0.36 | — |
| mlp `h`+`y` (whole program) | 0.625 | 0.945 | ≥1.7 | — |
| conv2d `out` | 0.165 | 0.166 | 1.7 | — |

All outputs bit-identical on both gate sides; softmax/layernorm/attention/mlp/conv2d fused sources **byte-identical to the base** (digest against `0f45d04`'s emitter); no clock drift (2418 MHz).

## Framework and tool changes
**One:** `applyNativePassSync` (`src/framework/passes/define-pass.ts`) now checks `preserves` by synchronous recomputation for effect-free analyses — because `cudaSource` is a fixed synchronous API that must run checked passes. No tool changes.
