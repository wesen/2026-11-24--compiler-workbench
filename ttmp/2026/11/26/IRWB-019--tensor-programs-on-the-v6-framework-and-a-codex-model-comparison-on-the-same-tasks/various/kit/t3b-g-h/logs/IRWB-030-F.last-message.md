The stage is complete. Everything is committed on `t3b-g-h-irwb-030-f` with a clean tree, all suites green (35 CPU tests, 21 GPU tests on the GB10, including stage 3's unchanged suites and digest pins).

## Final message

**Paths** (ticket `IRWB-030-F`):
- Ticket index: `ttmp/2026/11/27/IRWB-030-F--fusion-that-is-never-slower-parallel-reduction-terms-and-a-launch-shape-cost-gate/index.md`
- Design: `.../design/01-fusion-that-is-never-slower.md` (with an "As built" addendum)
- Final report: `.../reference/02-report-fusion-that-is-never-slower.md`; diary: `.../reference/01-implementation-diary.md`
- Scripts 01–07 with outputs in `.../scripts/`

**How terms are staged.** A reduction's body cannot mention the accumulator in this IR, so every term is pure. For each row-scalar member of a block-mode group, the plan (`parallelTerms`) records its outermost reductions; the emitter has all block threads compute strided shares of a flat term index (whose row-major decomposition is the meaning's lexicographic order) into a shared term buffer, then thread 0 folds the buffer in order with the same accumulator chain — bit-identical by construction. The kernel is `template <bool Shared, bool Staged>`; the host takes the serial-fold instantiation when the term buffer doesn't fit beside the rows. Refused, with reasons recorded: bare-load bodies (measured: staging one buys nothing, ratio 0.996), nested reductions (would reassociate a split sum), tail axes on outermost reduces, row members (already thread-parallel; a term buffer would be the whole row's terms — argued), term buffers beyond shared memory (argued by traffic, fallback checked exact).

**The gate.** `runTixCuda` lowers through `gatedPlan(fn, shapeValues)`; `cudaSource`/`checkLowering` keep the fully fused plan (so a gated source is checkable as a transformation candidate — the tests do). Rule, from the IR plus launch values: a block-mode group fuses iff `points × threads ≥ 16384` (mlp's measured crossover: 1.78 at 8,192, 1.19 at 12,288, 0.99 at 16,384 fused threads) **or** a row-scalar reduction's serial terms span the row (softmax/layernorm/attention measured never slower fused, down to 512 fused threads, because stage 2 pays the same serial fold on one thread per row) **or** the row fits in its block's threads. The rows cap moved 128→256 (re-measured with staging; 512 worse again).

**Kernel counts and GPU ms** (fused/unfused, median of 3 `benchmark` calls; all outputs bit-identical):

| Program | Kernels | Fused | Unfused | Speed-up |
|---|---|---|---|---|
| matmul | 1/1 | 0.214 | 0.219 | 1.0 |
| softmax | 1/4 | 0.382 | 0.812 | 2.1 |
| layernorm | 1/4 | 0.186 | 0.469 | 2.5 |
| **layernorm-inside** | 1/4 | **0.202** | 0.545 | 2.7 (stage 3: 0.569 vs 0.577) |
| attention | 1/6 | 0.754 | 1.052 | 1.4 |
| **attention-inside** | 1/5 | 1.412 | 1.470 | 1.04 |
| mlp | 1/3 | 0.726 | 0.944 | 1.3 |
| conv2d | 1/1 | 0.166 | 0.166 | 1.0 |

**Framework and tool changes: none** — reported as a result with reasons: the candidate path checks the gated source, the `fuse` port/correspondence/revision-keyed memo already separate gated and ungated evidence; the known correspondence entity-list gap was left to its ticket.

**Last commit:** `aa94b83`
