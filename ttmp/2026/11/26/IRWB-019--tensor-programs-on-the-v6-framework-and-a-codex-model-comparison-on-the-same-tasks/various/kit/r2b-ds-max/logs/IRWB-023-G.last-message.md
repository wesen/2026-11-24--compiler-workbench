Work is committed and the tree is clean.

**Design document:** `ttmp/2026/11/26/IRWB-023-G--what-compiler-work-would-make-tix-best-in-class-speed-at-a-fixed-f32-meaning/design-doc/01-speed-at-a-fixed-meaning.md` (9,069 words, 2 Mermaid diagrams; raw evidence in `scripts/00-results.md`, diary in `reference/01-research-diary.md`)

**Thesis:** best in class = fastest program *at a stated meaning*, on a frontier of throughput / guarantee strength / evidence cost. The meaning is a per-value rounding trace, so materialization (Prop. 1: f32→F32Array→f32 rounds nothing) and recomputation (Prop. 2: Tix is pure) are trace-neutral — the whole schedule space is sound by construction, and stage 2's gap was an unrepresented schedule, not the meaning.

**Top three proposals**
1. **P1 — the schedule as a checked artifact**: separate plan (kernel partition, storage class, thread mapping, fold order) from emitter, then search it; every plan is bit-neutral by theorem, so autotuning has no numerical risk. Measured 2.06× matmul, 3.79× layernorm, 1.34× softmax, all with 0 differing words.
2. **P2 — a measured price list and a parameterized meaning**: contraction 1.87× issue rate (84.7% of output words change), double transcendental 122× (45% of softmax), reduction order 1.0× and *negatively* priced in accuracy; gate the delta, not the total error.
3. **P3 — check the check**: translation-validate the emitted tree (complete, GPU-free) and certify the toolchain exhaustively — a full 2³² f32 sweep of one intrinsic costs 0.90 s, and two independent double formulas for `exp`/`log` agree on all but 1 input in 4.29e9.

**Experiments (each in `scripts/`)**
- `01-gate-on-identity`: real tolerance gate on the *identity* transformation — agrees everywhere, but the program's own rounding already consumes 0.5–25% of the budget vs 2.3e-2 attributable to `split-sum`; the gate cannot separate the two.
- `02-reduction-length`: identity budget stays 8e-3…1.4e-1 from 7 to 448 terms — never rejected, confirming the sensitivity critique.
- `08-correctly-rounded`: BigInt exact-sum oracle — the half-ULP witness's *correctly rounded* value is the `split-sum` result, not the specified fold's; at n=1024 sequential is correct in 3/60 trials vs 47/60 for a tree.
- `04-gemm-cost`: MAC issue rate 25.62 vs 13.73 TFLOP/s (ratio 1.866); tiled SGEMM exact 10.51 TFLOP/s at 4096³ vs cuBLAS 17.87 (1.70× = 1.40× meaning × 1.21× schedule); exact vs FMA differs on 84.7% of words at 512³.
- `05-check-gemm-bits`: the tiled kernel vs the Tix f32 interpreter at 128³ — 0 of 16,384 words differ, max ULP 0.
- `06-fusion`: layernorm materialized 0.511 ms, per-row fused 0.760 (0.67×, refuted), block-staged **0.135 ms = 3.79× at 248.6 GB/s** (streaming bound 244), 0 words differ; softmax 0.804 / 2.358 (0.34×, refuted) / 0.601 ms (1.34×), 0 words differ; `texp` 1.152e10/s vs `expf` 1.403e12/s.
- `07-exp-sweep`: all 2³² f32 inputs × 3 intrinsics × 2 formulas in 2.71 s (0.90 s/intrinsic); `exp` and `log` differ on 1 word each; my naive `tanh` alternative overflows and differs on 1.6e9 (kept as a detector demonstration).

**Commit:** `5e73dc5` (branch `r2b-ds-max/irwb-023-g`, not pushed).
