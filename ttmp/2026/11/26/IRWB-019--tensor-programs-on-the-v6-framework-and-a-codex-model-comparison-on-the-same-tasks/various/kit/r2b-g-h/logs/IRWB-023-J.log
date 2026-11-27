The research round is complete. Working tree is clean, all deliverables committed.

**Design doc:** `ttmp/2026/11/26/IRWB-023-J--best-in-class-for-tix-a-research-round-on-checked-performance-passes/design-doc/01-best-in-class-for-tix-checked-performance-and-derived-budgets.md` (diary beside it in `reference/01-research-diary.md`, all probes in `scripts/`)

**Top three proposals:**
1. **P1 — Exact-locality scheduling** (shared-memory tiling + register blocking under the *exact* gate): measured bit-identical (0/262,144 words) and 2.5× faster at 512³ — the biggest safe win, zero budget spent, no IR/framework change.
2. **P2 — Fixed-tree fusion with *derived* budgets**: 3.44× on layernorm (98.6% of the 244 GB/s roofline) and 2.15× on softmax, with the tree's error bound computed from Higham's γ-bounds instead of a magic tolerance — and the gate extended to *reward* accuracy, since the fused trees measured 4–9× more accurate than the sequential meaning they replace.
3. **P3 — Full-scale certificate kernels**: the gate checks at corpus size on the GB10 via compensated-f32 shadows riding inside the kernel (+1.5%/+0.6% overhead), replacing a sampled verdict that is provably blind at scale.

**Experiments run:**
- **E1** (GB10, matmul 512³, 6 kernel variants): tiled and register-blocked kernels are bit-exact vs Stage 2 (0 mismatches) at 0.123/0.086 ms vs 0.214 ms; split-K bought no speed but 2.5× smaller error; Kahan shadow +1.5%, f64 shadow 12.9×.
- **E2** (local, exact f32): blocked/pairwise orders at K=1024 measured 2–4× more accurate than sequential; on the 1+1023·2⁻²⁴ witness the sequential meaning itself violates the 2e-5 tolerance while all blocked orders pass.
- **E5** (local, real framework gate): width-B splits are *inexpressible* in the v1 extent schema (width is the global constant 4); the differential gate rejected every corrupt candidate with counterexamples — the round's key IR finding (proposal P4).
- **E3** (GB10, fused layernorm): 3.44× at the memory roofline; tree consumes 0.135 of the f64 tolerance vs Stage 2's 0.572; Stage 2 output re-confirmed bit-identical to the interpreter.
- **E4** (GB10, fused softmax): the parallel **max** tree is bit-exact (0/4096 rows) — max parallelization needs no budget; the sum tree differs but is 9× more accurate; fusion is bound by 4.2M double `exp` calls.
- **E7** (local): sampled gate costs 0.6–15 ms/function but can't see K; a single full-scale CPU f64 reference costs ≥1 s — the case for GPU-resident checking.

**Final commit:** `03e8880` (branch `r2b-g-h/irwb-023-j`, not pushed)
