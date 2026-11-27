Done. IRWB-021-Q is written up as a research design, committed on `r1b-gf-max/irwb-021-q`.

**Paths**
- Ticket: `ttmp/2026/11/26/IRWB-021-Q--deriving-streaming-attention-by-checked-rewrites/` (index, tasks, changelog, diary)
- Design: `ttmp/2026/11/26/IRWB-021-Q--deriving-streaming-attention-by-checked-rewrites/design-doc/01-design-deriving-flashattention-from-plain-tix-by-checked-rewrites.md`
- Diary: `.../diary.md` (investigation format: framework mapping, the ten load-bearing design decisions, bookkeeping)

**The rule set** (one line each; full statements, side conditions, lemmas and f32-delta sources in design §3–§4):
- **R1 `scale-in`** — a shape-constant divisor of a reduction body moves into a product operand (`k[j,d]/√D` precomputed), licensed by distributivity over finite sums; f32 delta: regrouped per-term rounding; checked syntactically + tolerance.
- **R2 `div-hoist`** — a reduction-index-independent divisor (`l[i]`) leaves the `o`-sum (`p = Σ e·v; o = p/l`), licensed by the same distributivity; f32 delta: N per-term divisions → one final division; syntactic + tolerance.
- **R3 `flash-fuse`** — the `{max, exp, Σ, Σ·v}` softmax pipeline becomes one `fold` with state `(m, l, o)` and the FLASH combine, licensed by the streaming-rescale lemma (induction: exp-additivity + distributivity, with `−∞` conventions); f32 delta: rescaled accumulation, exp at the running max, deferred division — while `m` stays **bit-identical** (exact probe check); structural side conditions + tolerance.
- **R4 `tile`** — the fold over `j` becomes a fold over tiles of folds, licensed **only** by the combine's checked associativity certificate; f32 delta: reassociated accumulation, `m` still bit-exact; syntactic tile-bound checks + tolerance.
- **R5 `fuse-folds`** (generic sibling) — uncoupled `sum`/`max` reductions over the same index fuse into a record-state fold that is **f32 bit-identical** by construction; checked with the exact relation (this is what makes layernorm statistics one-pass).
- **R6 `normalize-in-fold`** (variant) — the FlashAttention-2 per-step division placement, licensed by a corollary lemma; tolerance.

**Checking** maps onto the framework as-is: each rule is a versioned rewrite transaction whose syntactic guards are registered predicates; lemmas are audited induction dossiers attached as versioned proof records (honestly labeled — the framework has no prover); every step is gated by `tix.meaning-within` (sampled tolerance vs an f64 reference interpreter of the same schedule, NaN-aware, calibrated by a step-0 gate and a mutation suite) and the derivation ends with the exact `tix.streaming-shape` property — the compile-time certificate that no N×N tensor escapes a fold.

**Commit:** `ed46e3bf64229096a2a95c85eadf8a216c4f2b98`
