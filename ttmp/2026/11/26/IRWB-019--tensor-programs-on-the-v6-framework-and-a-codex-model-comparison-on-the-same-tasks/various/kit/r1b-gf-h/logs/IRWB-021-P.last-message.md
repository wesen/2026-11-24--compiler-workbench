Done. Everything is committed on `r1b-gf-h/irwb-021-p` (not pushed).

**Paths**
- Ticket: `ttmp/2026/11/26/IRWB-021-P--deriving-streaming-attention-by-checked-rewrites-research-design/` (index, tasks, changelog)
- Design: `ttmp/2026/11/26/IRWB-021-P--deriving-streaming-attention-by-checked-rewrites-research-design/design/deriving-streaming-attention-by-checked-rewrites.md`
- Diary: `.../various/diary.md`

**Rule set (one line each)**
- **R1 reduce→fold** — replace every `sum`/`max` with a `fold` (init 0/−∞, per-element step); definitional, bitwise f32-exact.
- **R2 division hoisting** — `sum(j) a(j)/c → (sum(j) a(j))/c` when `j∉c` and `c≠0` (for attention: `l[i] ≥ 1` since the max term is `exp(0)=1`); exact over reals, tolerance in f32.
- **R3 producer fusion** — inline a single-assignment tensor into fold steps that read it at the current index (no stencils/lookahead); bitwise f32-exact; intentionally re-computes the d-contraction per j (the FLOPs-for-bytes trade).
- **R4 fold merge** — merge folds over the same index with disjoint states into one tuple-state fold; bitwise f32-exact.
- **R5 running-max rescale** — rewrite the two-pass pattern (max-fold; normalized-product folds `acc ⊕ exp(s−m_final)⊙w`) into one running fold with per-step rescale `acc' = acc·exp(m−m') + exp(s−m')⊙w`; exact over reals via the canonical-form induction on `exp(a−c)=exp(a−b)·exp(b−c)` (also proves the flash combine's associativity); tolerance in f32 (rescale events ≤ N, no overflow since factors ≤ 1, first-step −∞ case exact).
- **R6 blocking** — per-element fold → fold over blocks with a block-local sub-fold and a certified combine at boundaries; exact over reals by combine associativity (`B | N` side condition); tolerance in f32 (error typically *smaller* than plain, hence two-sided tolerance).
- **R7 block-body re-expression** — restate the block-local sub-fold as plain Tix statements/reduces (inverse of R1); bitwise f32-exact.

**Key design points** — the missing construct is a `fold` with tuple state, sequential-override step semantics, `neg_inf` literal, and certified combine families (Plus / Max / flash / log-domain) since arbitrary-combine associativity is undecidable; only R5 and R6 leave f32-exactness; checking maps onto `defineTransformation` + `PatternPredicateRegistry` + correspondence records, with a two-sided tolerance invariant against the f64 reference. Refusals (final-mean variance, non-associative combines, non-multiplicative normalizer use) are checked non-applications, never wrong kernels. Experiment: H1 O(N·D) traffic, H2 within 2× of hand-written FA on GB10, H3 100% mutation rejection — H3 falsifies the research question without needing the CUDA backend.

**Commit:** `fe977306932fa050ac42f57d40b0e3155bae608a` — `IRWB-021-P: research design — deriving streaming attention by checked rewrites (ticket, design doc, diary)`
