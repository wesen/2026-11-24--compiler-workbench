The research round is complete. Here is the summary:

**Design document:** `ttmp/2026/11/26/IRWB-023-K--research-round-what-compiler-work-would-make-tix-best-in-class/design-doc/01-best-in-class-for-tix-certified-numerics-at-competitive-speed.md` (5,321 words, 2 Mermaid diagrams, 12 cited sources)

**Definition defended:** best in class for Tix = the strongest *verifiable* numeric guarantee among index-notation tensor compilers, at a defensible fraction of vendor speed — certified budgets, bit-exact schedules, a portable f32 anchor, and checks at running scale.

**Top three proposals:**
1. **P1 — Certified error budgets as pass gates:** a γ-arithmetic `(value, bound)` analyzer over the real IR gates every reassociation with per-case certified bounds plus an exact f64 semantic-difference term, replacing sampled tolerance with stored evidence.
2. **P2 — Exactness-preserving scheduling behind an exact-f32 (NaN-class) lowering gate:** tiling, register blocking, fusion and tree evaluation that provably cannot change bits, with schedules checked bit-exact on the GPU rather than trusted.
3. **P3 — GPU-resident references and the f32 anchor:** compile the f64/f32 reference itself to CUDA and run it in the same remote batch, making full-size and bit-level checking routine while anchoring portability on the f32 meaning.

**Experiments ran (all results in the ticket's `scripts/` + diary):**
1. Certified-bound analyzer over all six corpus programs on the Stage-1 case recipe — sound on all 5,788 elements (23,648 assertions, 0 violations), ~30× loose; gate simulation shows the Stage-1 budget can't serve certified bounds, strict per-element monotonicity is wrong (2× slack fixes it), and drop-tail/transpose mutants are caught exactly.
2. GB10 bit-exact shared-memory tiling vs the Stage-2 replica at 512³ — 0 of 262,144 words differ, 0.214→0.195 ms.
3. GB10 2×2 register-blocked tiling — still bit-exact (0 words differ) and 2.0× faster (0.105 ms), while `fmaf` changed 85% of words for 0.2%: bit-exactness's current price vs cuBLAS is 3.2×, and the standard FMA "optimization" is all cost, no benefit here.
4. GB10 fused softmax/layernorm (one block per row, parallel order-free max, split-sum width-4 trees) — bit-identical to the real `optimizeTix(['split-sum'])` IR, 2.1× (0.378 ms) and 4.3× (0.131 ms) faster than Stage 2.
5. GB10 f64 matmul reference — bit-identical to Node's f64 meaning and 1.6 ms vs 781 s at 512³ (≈488,000×), making full-size checking feasible.
6. Double-transcendental portability probe — CUDA vs Node disagree at double resolution on 10.3% (exp), 5.8% (tanh), 3.2% (log) of inputs, confirming f64 references are measurements while the f32 meaning is the portable contract.
7. Failed experiments recorded: width-32 trees inexpressible in today's IR, strict monotone gate rejecting split-sum on 5/6 programs, a shift-invariant softmax mutant that correctly passes output-based gates, and my own three debugging failures (UB lambda, empty input files, pooled-Buffer reads).

**Final commit:** `1b59d85` (branch `r2b-g-max/irwb-023-k`, not pushed)
