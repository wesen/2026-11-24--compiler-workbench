Done. Ticket created, design written, diary kept, committed.

## Paths

- **Ticket**: `ttmp/2026/11/26/IRWB-021--deriving-streaming-attention-by-checked-rewrites/`
- **Design**: `ttmp/2026/11/26/IRWB-021--deriving-streaming-attention-by-checked-rewrites/design-doc/01-deriving-streaming-attention-by-checked-rewrites.md`
- **Diary**: `.../reference/01-irwb-021-diary.md`; probes in `.../scripts/`, outputs in `.../various/`

## The rule set, one line per rule

| rule | what it does | real argument | f32 status |
| --- | --- | --- | --- |
| **R1 `R-hoist`** | lift a divisor/factor free of the reduction index out of a `sum`/`max` | linearity of the finite sum | `rounding` (bit-exact if the factor is a power of two) |
| **R2 `R-fold-form`** | bundle co-indexed reductions sharing a body into one fold with a tuple state | definitional (product of reductions) | `bit-exact` |
| **R3 `R-name`** | substitute a single-consumer tensor into its consumer (and delete it) | substitution | `bit-exact` |
| **R4 `R-recanon`** | replace a shift that is the max over the fold's own index set by a running max carried in the state | representation lemma + gauge-invariant observation (state ends up *equal*, not just up to scale) | `rounding` |
| **R5 `R-reassoc`** | split a fold into a fold over blocks with inner folds | associativity + order preservation (not commutativity) | `rounding` |
| **R6 `R-drop-max`** *(optional)* | drop the shift entirely | gauge invariance at μ ≡ 0, no side condition over ℝ | `range-bounded` (needs `α²√D ≤ 87` proved; 8192/8192 outputs non-finite outside it) |

The forced chain is P0 → R1 → R2/R3 → **R4** → R3 (s de-materialised) → R5; R4 must precede the inlining of `s` because `s` has two consumers (the max and the fold) until the max moves into the state — which is the structural reason the N×N tensor exists at all. Tix lacks one construct: a reduction whose state is a tuple of tensors with an explicit combine expression, left-folded in index order so `sum`/`max` are instances and the core's meaning is unchanged.

Three f32 probes shaped it: fusion/de-materialisation measured **0.00 u (bit-identical)**, so the memory win is numerically free; R4's deviation is 2.2–2.6 u and is **not** proportional to the rescale count (my hypothesis, refuted: worst rescale case 0.5–1.0 u, no-rescale case exactly 0), so the tolerance relation is `u·(4 + max|s|)`, not a constant.

## Commit

`692f663` (design commit `e3a5409`), on branch `r1b-ds-x/irwb-021-n`, not pushed.
