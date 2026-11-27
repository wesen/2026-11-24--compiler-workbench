Stage 3 is complete. Everything is committed on the branch, with working code at every commit.

## Paths
- **Ticket:** `ttmp/2026/11/26/IRWB-029-I--checked-fusion-for-the-tix-cuda-lowering/`
- **Design:** `design-doc/01-fusion-plans-for-the-tix-cuda-lowering.md` (with "As built" deltas)
- **Report:** `reference/02-report.md`; **diary:** `reference/01-implementation-diary.md`; benchmark runs in `reference/benchmark-run-{1,2,3}.json`; scripts `scripts/01…04-*.mjs` all committed.

## Where fusion lives, and why
**In the lowering** — a kernel-plan analysis (`src/tensor/fusion.ts`) that reads the current Tix revision and returns ordered kernel plans the emitter prints. A Tix IR pass can't express softmax's block-per-row shared-memory staging (inlining `exp` into the row sum would be O(C²) per row, and no Tix text describes a thread mapping); a second kernel-IR artifact would restate what the plan records. **Correspondence finding:** fusion produces no Tix revision, so the framework's correspondence isn't exercised — it *could* express the statement merge, but a merged IR revision would still not carry the thread mapping, so the plan is recorded in the CUDA artifact (payload v2: per-kernel form, statements, reads, writes) instead.

## Results (GB10, median-of-3 CUDA events, 3 invocations, ≤2% spread)
| Program | kernels u→f | unfused ms | fused ms | bytes u→f | floor (244 GB/s) |
|---|---|---:|---:|---:|---:|
| matmul | 1→1 | 0.216 | 0.214 | 3.1→3.1 MB | 0.013 |
| softmax | 4→**1** | 0.793 | **0.388** | 100.7→33.6 MB | 0.138 |
| layernorm | 4→**1** | 0.470 | **0.152** | 100.7→33.6 MB | 0.138 |
| attention | 6→**2** | 1.050 | **0.782** | 34.6→9.4 MB | 0.039 |
| mlp | 3→**2** | 0.989 | **0.862** | 21.0→12.6 MB | 0.052 |
| conv2d | 1→1 | 0.164 | 0.165 | 6.1→6.1 MB | 0.025 |

All fused outputs **bit-identical** (fused vs unfused at full size, and vs the f32 meaning via `checkLowering`'s exact relation + 12 random programs, empty rows/outputs included). Layernorm runs 1.1× over its memory floor; softmax's residual is the meaning's double-precision `exp` (~0.25 ms measured by phase probe) — the prototype's 4.25× wasn't bit-exact under our meaning. Attention/mlp are dominated by contraction reads (tiling — not mine).

## Framework and tool changes
- **No `src/framework/` change needed** (227/227 framework tests untouched) — the fusion is a lowering decision; the framework's heterogeneous transformation + differential batching already carried the `fuse` port and shared the baseline evidence across fuse modes.
- `src/tensor/fusion.ts` (new): IR-decided legality; `cuda-source.ts`: flat/row emitters, host buffers only for consumed outputs, dynamic shared memory with an opt-in attribute guard, row kernels at 128 threads; branchless `minmax` (equivalent on every input — certified by a 160,256-pair GPU probe against `Math.fround(Math.max/min)`, zero mismatches); `cuda-contract.ts`: `fuse` port, artifact payload v2; `index.ts`: `fuse`/`benchmark` options; `tools/cuda-remote.mjs`: unchanged.

## Last commit
`02b4e03` — "IRWB-029-I: diary, final report, benchmark runs and as-built design notes"
