Stage 3 is complete. Final summary:

## Ticket, design, report

- **Ticket:** `ttmp/2026/11/26/IRWB-029-F--stage-3-checked-statement-fusion-for-the-tix-cuda-lowering/`
- **Design:** `design-doc/01-checked-statement-fusion.md` (updated to as-built after the mapping measurements)
- **Final report:** `reference/02-report.md`; diary at `reference/01-implementation-diary.md`; all probes and measurements in `scripts/01..06-*.mjs`

## Where fusion lives, and why

A **pure planner on the Tix IR (`src/tensor/fusion.ts`) plus the stage 2 emitter**. Groups are consecutive statements sharing a row dimension D, with every load classified row-local or row-free from the IR; refusals carry reasons. Not a Tix IR pass (a fused group is not a Tix statement — it computes several differently-shaped tensors — and `cudaSource`/`checkLowering` must stay pure); not a kernel-IR artifact (the plan is a deterministic function of the revision, and the versioned CUDA source artifact already distinguishes fused from unfused candidates). **The framework's correspondence did not need to express "many statements become one kernel"** — the checked transformation is artifact-level, as in stage 2; that is a recorded non-finding, not a gap.

Two mappings, both order-preserving: **one warp per row** (per-warp shared slices, `__syncwarp`, global-staging fallback above the 12,288-float shared cap) and **register chains** (one thread per output element, producer values in registers, reductions as the element's own loops — covers mlp's bias+GELU epilogue).

## Kernel counts and benchmark medians (GB10, `benchmark: true`)

| Program | Kernels | GPU ms | Speedup |
|---|---|---|---|
| matmul | 1 → 1 | 0.217 → 0.210 | — |
| softmax | 4 → 1 | 0.796 → 0.723 | 1.10× |
| layernorm | 4 → 1 | 0.475 → 0.233 | 2.04× |
| attention | 6 → 2 | 1.048 → 0.924 | 1.13× |
| mlp | 3 → 2 | 0.944 → 0.851 | 1.11× |
| conv2d | 1 → 1 | 0.166 → 0.164 | — |

Fused ≡ unfused output bits on every measured input; `checkLowering` accepts fused as **exact** everywhere (cold 2.3–3.2 s, warm ~1 ms). Two refusals were made from measurement, not just legality: the first block-per-row mapping made softmax 2× slower (idle threads + shared-capacity occupancy), and fusing contractions over row-free matrix operands (mlp's `y`, attention's `out`) serialized 1024-long dots per lane (mlp 2.5× slower) — such statements now keep the per-element mapping and the refusal is IR-decidable. Softmax's honest ceiling: 4.2M double-`exp` calls alone cost 0.369 ms under the exact relation, so the prototype's 4.25× is unreachable bit-identically on this toolchain; a parallel max tree would be bit-exact but reassociation is out of scope — recorded as the main later headroom.

## Framework and tool changes

**None required** — no file under `src/framework/` or `tools/` changed; each candidate (kernel-IR artifact, multi-output Tix statement, benchmark exposure) is argued in the report. All changes live in `src/tensor/` and `tests/tensor/`.

**Last commit: `9749841`** (branch `t3-g-h/irwb-029-f`, not pushed; working tree clean).
