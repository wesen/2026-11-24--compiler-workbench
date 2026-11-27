The ticket is complete: research design written, diary kept (5 steps), probe evidence saved, all work committed on `r1b-g-max/irwb-021-s` (not pushed), `docmgr doctor` clean, all 6 tasks checked.

**Ticket:** `ttmp/2026/11/26/IRWB-021-S--deriving-streaming-attention-by-checked-rewrites-flashattention-from-plain-tix/`
**Design document:** `.../design-doc/01-research-design-deriving-streaming-attention-by-checked-rewrites.md`
**Diary:** `.../log/01-research-diary.md` · **Probe:** `.../scripts/01-numeric-probe.mjs` → `.../various/01-probe-results.txt` (80 configurations, 8 sanity checks pass, 3 negative controls rejected)

**The rule set** (13 applications deriving `P0` → streaming `P8`; each rule: exact argument over ℝ, recorded once + per-application gate — `≡` bit-exact or `≈` tolerance vs the f64 reference of `P0`):

- `inline` — expand a tensor use into its defining expression, drop dead definitions; referential transparency; gate `≡` (×2)
- `factor-const` — hoist a reduction-index-free factor out of a sum (`Σ c·x = c·Σx`, `Σ x/c = (Σx)/c`, `c ≠ 0`); distributivity; gate `≈` (×4)
- `split-index` — replace index `j` by `B·jt + jj`, `B | N`; order-preserving affine bijection on the iteration domain; gate `≡` (×1, probe: bit-identical in 80/80 rows)
- `nest-max` — `max(jt,jj) X` → `max(jt) (max(jj) X)`; max over a product = iterated max; gate `≡` (×1)
- `exp-shift` — `exp(S − m)` → `exp(S − mb) · exp(mb − m)`; exponent law (any shift `c`); **guard:** `mb` = block max keeps `exp` arguments ≤ 0 (finiteness, not algebra); gate `≈` (×2)
- `nest-sum` — `sum(jt,jj) X` → `sum(jt) (sum(jj) X)`; finite-sum associativity; gate `≈` (×2)
- `fold-intro` — the **streaming lemma** as a rewrite: the `(max, rescaled sums)` combine is a commutative monoid with identity `(−inf, 0, 0)`, so the two-level form equals the left fold of the combine over blocks; consumes the 4-statement pattern `m/g/l/ov`, replaces it with `fold(jt; sc_combine) (mb, lb, ob)`; gate `≈` (×1)

**What Tix lacks:** `fold` — a reduction over a user-supplied associative combine on a tuple state (sequential left fold per free-index instance as reference meaning; f32: state in f32, rounding per operation, block-order iteration), plus scalar-tuple combine functions, `monoid … identity` declarations with a `-inf` literal, and per-shape specialization for `B, T` (since `T = N/B` is not an affine dim expression).

**Checking:** every rule carries a recorded exact ℝ-argument; exact gates for `inline`/`split-index`/`nest-max`, tolerance for the rest; ε calibrated to 10× `P0`'s measured f32 noise floor (probe: derived form within 2.87× of `P0`'s own error, worst observed; `factor-const` is the dominant mover at 2.6×; combine verified once by 6-case max split + exact rational points).

**Commits** (branch `r1b-g-max/irwb-021-s`, not pushed): `ececfbd` (ticket, diary, probe), `7313a6e` (design document), **`c5478ea`** (close-out, final hash).
