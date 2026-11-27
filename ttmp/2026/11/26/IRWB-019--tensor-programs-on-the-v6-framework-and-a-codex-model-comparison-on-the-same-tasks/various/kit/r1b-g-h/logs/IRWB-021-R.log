Done. The ticket is created, the research design written, the diary kept, and everything committed on `r1b-g-h/irwb-021-r` (not pushed). `docmgr doctor` passes, all tasks checked, working tree clean.

**Ticket:** `ttmp/2026/11/26/IRWB-021-R--deriving-streaming-attention-from-plain-tix-by-checked-rewrites`
**Design:** `ttmp/2026/11/26/IRWB-021-R--deriving-streaming-attention-from-plain-tix-by-checked-rewrites/design-doc/01-deriving-flashattention-from-the-plain-tix-attention-program-a-checked-rewrite-research-design.md`

The design adds one construct — a **state reduction**: `reduce(j)` over a tuple state with a user-supplied combine, with sequential / `blocked(B)` / `blocked(B) twopass` f32 meanings (a left fold in increasing j, rounding per operation, the same convention as Tix's `sum`/`max`) — and derives the streaming form in six steps / eight applications, ending in a program whose blocked two-pass meaning is FlashAttention-2 statement for statement, with no N×N tensor.

**The rule set:**
- **R1 FACTOR-OUT** — move a j-free divisor out of a `sum` body; distributivity over ℝ; f32 rounding points move → tolerance.
- **R2 INLINE** — substitute a definition for its references; identical op sequence → bit-exact, exact relation.
- **R3 PAIR** — fuse `m = max(j) S` with `l = sum(j) exp(S − m)` into a streaming (max, normalizer) state with the rescaling combine; rescaling lemma; tolerance (max component bit-exact).
- **R4 PAYLOAD** — extend the pair with an output accumulator consuming the same weights; payload lemma; tolerance.
- **R5 BLOCK** — re-associate the fold into consecutive blocks; associativity of the combine (proof-backed for the rescaling family); tolerance.
- **R6 TWOPASS** — per block, block-max then one accumulating pass; lemma restricted to the block; tolerance; produces the literal FA2 inner loop.
- **R7 MAXSHIFT** — introduce the stabilizing maximum into `sum(j) exp(E)`; Σe^E = e^M·Σe^(E−M); tolerance (reaches log-sum-exp).
- **R8 LOGRESOLVE** — `log(exp(a)·b) = a + log(b)`, b > 0; tolerance.
- **R9 FUSESUMS** — fuse independent sums over a shared index into a componentwise-add tuple state; bit-exact per component (layernorm statistics).

Checking is per rule in the framework contract: domain (bounded shapes, seeded uniform [−1,1] inputs, N multiples of B when blocked), observation (the returned tensor), exact relation for R2/R9, tolerance vs the f64 reference of P0 plus a no-regression clause for the rest, with a pre-registered f32 error model (τ_rel = 2⁻¹⁰, convex-combination conditioning, headroom itself hypothesis H1b). Generality: softmax, any softmax-then-contraction, log-sum-exp, fused moments, and the safe-softmax (b = N corner) are reached; weight-mismatch, causal masking (surface-language gap), variance-from-moments, backward pass, and scans are not, with reasons. The GB10 experiment pre-registers H1–H5 with refutation conditions (derived ≤ 1.25× hand-written; no N²-term DRAM bytes, ≤ 0.5× unfused; which failures convict the derivation vs the lowering).

**Commits:** `bb331d8` (ticket scaffold + design document), `54f5b96` (diary + bookkeeping), `8cd7cb5` (diary frontmatter fix).
