Clean tree, two commits, two Mermaid diagrams, 7,256-word design doc. Done.

**Design's path:** `ttmp/2026/11/26/IRWB-023-E--making-tix-best-in-class-a-semantics-first-performance-program/design-doc/01-numerics-as-a-resource.md` (diary in `reference/01-implementation-diary.md`, experiments in `scripts/`).

**Top three proposals:**
1. **P1 — split the meaning into a value layer and a schedule layer, and judge schedules by bit identity.** Schedule changes (tiling, register blocking, unrolling, pointwise fusion) touch no rounding site, so the exact relation stage 2 discarded is exactly the right, cheap, sound gate for them — and it is where the money is.
2. **P2 — make the value layer's contract a per-element certified bound computed by a *shadow Tix program*** (abs-values summed over the same index domain give γ_k·Σ|a|), replacing the constant 2e-6+2e-5|r| that is at once too loose and too tight.
3. **P3 — order-free reduction semantics (exact/compensated sums)** to make reductions mapping-independent, unblocking the 9.2× currently spent on a fold order that the measurements show is also 17.7× *less* accurate than a tree.

**Experiments (all run, results in the doc):**
- `probe/main.cu` microbenchmarks: streaming 246.8 GB/s; double-`exp` 2.7× and double-`tanh` 6.0× `expf`/`tanhf` (which sit at the streaming floor); sequential row-sum 0.115 ms vs warp tree 0.0125 ms (9.2×) but 2.14e-6 vs 1.21e-7 relative error (17.7× *worse*); 3824/4096 rows differ in bits between the two mappings.
- `probe` matmul: no-contraction discipline costs **1.0%** (refuted my premise), yet changes 221 934/262 144 output words.
- `03-fast-lowering.mjs`: real emitted CUDA rewritten to fast single-precision transcendentals — softmax 1.47×, mlp 1.22×, attention 1.08×, matmul/layernorm/conv2d ~1.00×; **the merged contract accepted all six**, softmax's deviation using 0.000 of its own budget, matmul/mlp/conv2d overrunning it by 2.3/26.8/1.03.
- `probe2`: the *specified* f32 matmul at 512³ is **4.36× outside that budget** (334/262 144 elements); a 1024-sum is inside at 0.095.
- `02-contract-audit.mjs`: gate cases are ≤49 elements, extents {0,1,3,4,5,7}, residues mod 4 {0,1,3}, |values| ≤ 1; a correct f32 fold on an ill-conditioned 1024-sum uses 106 743% of the budget; γ₄₀₉₅Σ|a| = 0.50 vs observed 4.0e-5.
- `probe3`: register-blocked schedule is **bit-identical (0/262 144 differ)** and 1.54–1.85× faster; a plain shared-memory tile disagreed on *every* word for a reason I could not isolate — reported as an unexplained negative result, and the best argument in the document for always running the bit check.
- `probe -- exhaustive`: all 2³² f32 words × two functions in **848 ms**; `__expf` differs from the specified path on 5.07% of input words, `tanhf` on 0.92%.

**Commit:** `7fb8fde` (work in `3741f06`).
