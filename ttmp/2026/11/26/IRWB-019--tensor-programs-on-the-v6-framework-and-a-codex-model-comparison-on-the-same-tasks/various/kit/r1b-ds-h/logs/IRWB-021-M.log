Done. Everything is committed on `r1b-ds-h/irwb-021-m`, `docmgr doctor` passes, nothing pushed.

## Paths

- **Ticket:** `ttmp/2026/11/26/IRWB-021-M--deriving-streaming-attention-by-checked-rewrites/`
- **Design:** `ttmp/2026/11/26/IRWB-021-M--deriving-streaming-attention-by-checked-rewrites/design-doc/01-intern-guide-and-research-design-deriving-streaming-attention-by-checked-rewrites.md` (1 650 lines)
- **Diary:** `…/log/01-design-diary.md` — **Measurements:** `…/scripts/01-f32-probe.mjs` → `…/various/01-f32-probe.{txt,json}`

## Rule set

- **R0 α-renaming / copy propagation** — replace `d[I]` by `d2[σ(I)]` under an index bijection and delete the definition; identity over ℝ, bit-exact in f32; checked structurally.
- **R1 slide** — `sum(j)(f·g)/… → (sum(j) f)·g/…` for `g` free of `j`; distributivity over a finite sum; not bit-exact (the forced output-side slide costs ≤10 ulps of the row scale, the optional score-side one 173); real proof + measured tolerance.
- **R2 offset** — replace the normalizing offset `max(j) s[i,j]` by any `u[i]`, quotient unchanged: `exp(s−u)=e^{m−u}exp(s−m)` cancels, so *no* side condition over ℝ; in f32 it needs `u ≥ max_j s[i,j] − 88.7 + ln E`, discharged structurally when `u` is a fold's running max (dropping the offset is exact over ℝ and 256/256 inf/NaN at scores of 282.8).
- **R3 fold extraction** — `{max(j) s, sum(j) exp(s−m), sum(j) exp(s−m)·y} → fold(j) over (s,1,y) with the union combine from (−∞,0,0)`; proved by induction on the prefix (base = identity, step = the union formula `exp(a−c)=exp(a−b)exp(b−c)` + range split); f32 1.0–2.5× the plain program's error.
- **R4 fusion** — substitute a pointwise definition into its single pointwise-matching use and delete it; substitution, **bit-exact** (0 of 2 048 elements differ), and it is the rule that removes the N×N tensor.
- **R5 re-association** — `fold(j) → fold(b) of fold(t)`, `j = b·B + t`, given `identity` and `assoc` (both from the union formula); exact over ℝ, not in f32 (82.3 % of random triples of states differ), and the blocked form is measurably *closer* to the reference than the flat one.

Derivation: `A0 —R4(e)→ A1 —R1→ A2 —R3→ A3 —R4(s)→ A4` (streaming) `—R5→ A5` (blocked). Over ℝ every step is an identity; only R4 is bit-exact, so the chain is `checked-tolerance`.

## Commit

`4b2fbceb67fb9d0a4c36962b45b921de12d694a0` (`IRWB-021-M: the identity law does not survive combining two empty states; say so`), on top of `73ed5aa` (design) and `0fb6bc9` (table/claim fixes).

Two things worth your attention before anyone builds on this: the budget admits the derived kernel ~2e-6 of the row scale away from the plain program — a consequence of the division slide the one-pass form *forces*, not a slack choice (risk 1); and the design's conclusions are host-`exp` conclusions, so the device-vs-evaluator `exp` gate should run before any timing (risk 4).
