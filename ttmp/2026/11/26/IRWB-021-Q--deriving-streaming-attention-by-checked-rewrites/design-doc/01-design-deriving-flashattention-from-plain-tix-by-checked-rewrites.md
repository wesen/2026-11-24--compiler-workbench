---
Title: 'Design: deriving FlashAttention from plain Tix by checked rewrites'
Ticket: IRWB-021-Q
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: >
  A research design for deriving a FlashAttention-style streaming kernel from the plain
  N×N-materializing Tix attention program, as a fixed sequence of rewrite rules whose every
  application is checked (syntactic side conditions + a real-arithmetic lemma certificate +
  a sampled tolerance check against an f64 reference), plus the Tix `fold` extension the
  streaming form needs, the generality and failure bounds of the rule set, and the GB10
  experiment that would confirm or refute the claim.
LastUpdated: 2026-11-26T21:50:00-05:00
---

# Design: deriving FlashAttention from plain Tix by checked rewrites (IRWB-021-Q)

## Executive summary

Single-head attention written the plain way in Tix materializes an N×N score matrix. FlashAttention computes the same function by streaming over blocks of `j`, keeping a running maximum, normalizer and output, and never storing `s` or `e`. This design specifies the research that answers: **can a compiler derive the streaming form from the plain program as a sequence of rewrites, each of which is checked, with a local and mechanical correctness argument per step?**

The answer is designed, not yet built: a rule set of four derivation rules (plus one generic sibling and one variant), an extension of Tix with a `fold` construct (a reduction with a record-valued state, a pure per-element `step`, and a user-supplied `combine` whose **associativity over the reals is a checked certificate**), and a checking architecture that uses the framework's existing contract layer: every rewrite application is one transaction, its side conditions are decided syntactically at compile time, its real-arithmetic license is a lemma proved once per rule (not per application), and its f32 behaviour is gated after every step by a sampled tolerance check against an f64 reference interpreter of the same schedule. The derivation from the plain program to the streaming form is given as an explicit sequence, each intermediate program shown. Generality (softmax, log-sum-exp, softmax-then-contraction, layernorm statistics, multi-head, causal masking under the `-inf` extension) and the failure cases (index-domain mismatch, self-referential normalization, exact-f32 contracts, cross-row coupling) are stated with reasons. The experiment on the GB10 measures DRAM bytes and kernel time of the derived lowering against the unfused lowering and a hand-written streaming kernel, with falsifiable scaling and margin conditions, plus a mutation arm that measures the checking layer's own strength.

**Scope.** This ticket designs only: the rule set, the `fold` extension, the per-step checking scheme, the generality/failure analysis, and the experiment. It does not implement anything. The Tix front end, its evaluators, its f32 meaning and its meaning contract are parallel work and are treated as given interfaces; the CUDA lowering for Tix is assumed to exist with a tile-shaped allocation rule (see *Later*).

## 1. The question, restated as a claim

Plain attention (P0, exactly as given; note that by Tix's maximal-munch rule the divisions sit **inside** the reductions):

```
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
  m[i] = max(j) s[i, j];
  e[i, j] = exp(s[i, j] - m[i]);
  l[i] = sum(j) e[i, j];
  o[i, x] = sum(j) e[i, j] * v[j, x] / l[i];
  return o;
}
```

Read precisely: `s[i,j] = Σ_d fl(fl(q[i,d]·k[j,d]) / c)` with `c = fl(√D)` (every op fround); `m[i] = max_j s[i,j]` (exact — max does not round); `e[i,j] = fl(exp(fl(s[i,j] − m[i])))`; `l[i] = Σ_j^fl e[i,j]` in increasing `j`; `o[i,x] = Σ_j^fl fl(fl(e[i,j]·v[j,x]) / l[i])` — the division by the **final** `l[i]` happens per term, because `l[i]` contains no `j`.

The claim the research must establish has two separable parts:

- **C1 (derivability, semantic).** There is a sequence of rewrite rules, each with syntactically decidable side conditions and a real-arithmetic lemma as its license, that rewrites P0 into a streaming form (the flash form) such that every intermediate program is accepted by the checking layer. "Checked" per step = side conditions decided exactly + the step's lemma + a sampled tolerance relation against the f64 reference. No step may require human ingenuity beyond choosing which rule to apply; a fixed priority order over the rules' patterns must find the sequence.
- **C2 (value, empirical).** The derived program, lowered to CUDA on the GB10, moves O(N·D) DRAM bytes (not O(N²)) and is competitive in time with a hand-written streaming kernel, while the checking layer is strong enough to reject deliberately broken variants of the streaming form.

C1 is answered by the rule set and checking architecture of this document (design); C2 by the experiment (§8). The two are kept separate on purpose: a derivation can be sound and useless, or fast and unchecked. The ticket's question is C1; C2 is the evidence that the answer matters.

## 2. What Tix lacks, and what the IR adds

The streaming form cannot be said in the Tix core. Pinpointing what is missing is part of the design; each gap below is closed by exactly one construct in the extension, and each construct earns its place by a rule that needs it.

**(a) A reduction whose state is not a single number.** `l[i]` needs the running maximum at the time each `j` is consumed, and `o` needs the rescale that the growing maximum forces. In the core, each `sum`/`max` statement is an independent fold with a scalar state, and the coupling (max → exp → sums) is expressed only through *materialized tensors*, which is precisely what forces the N×N round trip: `e` depends on the *completed* `m`, so `s` must be fully computed before any `e` exists, and `s` and `e` have consumers in two different reduction loops, so a lowering must spill them. The IR needs a reduction whose state is a **record** with several components of different shapes (`m: f32`, `l: f32`, `o: f32[D]`), updated together per element.

**(b) Reassociation that is licensed, not guessed.** The streaming form is only correct because a specific combine is associative over the reals. If the IR had a built-in "fused softmax reduction", its correctness would be a hardcoded fact about one construct. Instead the IR takes a **reduction over a user-supplied associative combine**: `fold` with an explicit `combine` between two states. Associativity is then a *property of the supplied combine*, checked once as a certificate (§6), and every regrouping of the fold (element-wise → tiled) is licensed by that one certificate. This is the construct that makes the derivation's steps local: R4 (tiling) is justified by nothing but "the combine is associative", a fact attached to the combine, not to the program.

**(c) The max identity element.** Tix has no literal for −∞; the fold's `m` state must start there. The extension adds the literal `-inf` (f32 bits `0xff800000`) with the IEEE conventions `max(−∞, x) = x`, `exp(−∞) = +0`, and the empty-state convention of §3.

**(d) Explicit fold ranges (for tiles).** Tix infers extents from plain index uses and has no way to iterate `j` over `[t·T, min(t·T+T, N))`. The extension lets a `fold` header carry an explicit range whose bounds are integer expressions over outer indices and shape names, with `min`/`max`/integer division/`ceil` allowed in bounds. Index arithmetic is integer and exact; f32 rounding never touches indices.

**(e) Record projection.** The fold's result is a record; plain statements consume its fields (`st[i].o[x]`, `st[i].l`). Projection is naming, not arithmetic — it introduces no rounding.

### The `fold` construct

Syntax (extension of Tix; everything else of the core unchanged):

```
NAME [ outer-indices ] : ( field : type , ... ) = fold NAME in [ lo , hi )
  init    ( f = expr , ... )
  step    stmt*  yield ( expr , ... ) ;
  combine NAME-or-block        -- optional; required for tiled forms
;
```

- **Real semantics.** The fold evaluates `step` for `j = lo, lo+1, …, hi−1` in increasing order, starting from `init`. `step` is a pure function of (state, element): its assignments are **parallel** (every read of a state field sees the state at step entry; the `yield` tuple is the next state), so the fold is the unique left-fold of a pure step. If `combine` is given, the fold is equivalently: map each element to a singleton state via `step`, then left-fold those states with `combine` starting from `init`. Over the reals, with an associative `combine`, any bracketing of that fold yields the same value — this is the only reassociation license the IR grants, and it is conditional on the combine's certificate.
- **f32 semantics.** Same order, and every arithmetic op, `exp`/`log`/`sqrt` call and comparison in `step` and `combine` bodies is rounded to f32 (`Math.fround` of the double result), in the body's syntactic left-to-right evaluation order — the same rule the core gives to statements. Reductions *inside* a step or combine body (e.g. the `d`-sum of a score) follow the core's `sum`/`max` order and rounding rules exactly, so a nested `sum(d) …` computes bit-identically to the same expression written as a plain statement. Scalar subexpressions of a step body are evaluated once per step and shared across the elements of tensor-valued state fields (`o`); each tensor field's element expression is evaluated per element. The `-inf` literal has f32 value −∞; `exp(−∞) = +0`; `max(−∞, x) = x`; `min`/`max` do not round.
- **Empty-state convention.** In the flash combine (§4, R3), when both argument states are empty (`m₁ = m₂ = −∞`) the combine yields `init` rather than evaluating `−∞ − −∞` (which would be NaN). This convention is part of the combine's definition, guarded syntactically, and is consistent with the extended-exp reading over the reals.
- **Type inference.** Field extents are inferred from the step body's plain uses, exactly as statement extents are in the core; a field extent not inferable is a check error at compile time (same policy as the core).

Why not smaller? A scalar-state `fold` alone (no record, no combine) cannot express the coupled state; a built-in "online softmax" op would hardcode one algorithm and make every later pipeline (log-sum-exp, layernorm) a new builtin. `step` + `combine` is the smallest construct under which the flash derivation's steps are each justified by one named lemma.

## 3. The rule set

Rules are stated at the Tix level (over statements and their reduction bodies), as the Tix IR adapter will see them: a statement graph whose nodes are statements and whose edges are operand uses. Every rule is **directed** and applied by the framework's rewrite machinery as its own transaction; `preserves` declares the meaning invariant the host's acceptance gate runs. Notation: `Ī` is a tuple of indices not containing the reduction index under discussion; `c` ranges over **shape-constant expressions** (built from shape names, integer literals, `+ − * / ceil`, no index names, no tensor refs — decidable syntactically); `fl(·)` marks one f32 rounding.

---

**R1 — `scale-in`** (a shape-constant factor moves between a reduction body and a product operand).

- *Statement.* From `t[Ī] = sum(j) A / c` (the maximal-munch reading: every term divided by `c`) derive `b'[…] = b[…] / c` for one tensor operand `b` of a product in `A`, and `t[Ī] = sum(j) A[b ← b']`. For P0: `s[i,j] = sum(d) q[i,d]*k[j,d]/sqrt(D)` becomes `k1[j,d] = k[j,d]/sqrt(D); s[i,j] = sum(d) q[i,d]*k1[j,d]`.
- *Side conditions (syntactic, compile-time).* `c` contains no index names (in particular not the bound index `d`, nor `i`, `j`); `c ≠ 0` (here `c = fl(√D) > 0` because extents are ≥ 1); `b` is a tensor operand whose every use in `A` is indexed by the bound index; the new statement `b'` is placed before the first use of `b'` (statement-order check). Positivity is **not** required by this rule — it is required only if the factor is later moved across a `max`, which this derivation never does (the scaled `k1` never meets a `max`).
- *Exact algebraic argument (over the reals).* Lemma 1 (product/division form): for finite index sets, `Σ_j (a_j·g) = g·Σ_j a_j` and `Σ_j (a_j/g) = (Σ_j a_j)/g` for `g ≠ 0`; proof by induction on the index set with distributivity only. Here the regrouping `(q·k)/c → q·(k/c)` uses associativity/commutativity of real multiplication. Applied at real values of the *rounded* constant `c`, so the argument needs no property of `√D` beyond being a nonzero real.
- *f32 delta and its source.* Per-term rounding regrouped: P0 computes `fl(fl(q·k)/c)` per term; the derived form computes `fl(q·fl(k/c))`. Each term's relative error stays ≤ ~2ε (ε = 2⁻²³ ≈ 1.19e−7) instead of ~1ε; the sum of N·D such terms keeps relative error O(N·D·ε) against the real value in the worst case, in practice √(N·D)·ε. No new rounding of `c` itself (same `c` both sides).
- *How the application is checked.* Side conditions exactly (syntactic). Lemma 1 attached to the rule as a real-arithmetic certificate. After the step: tolerance check vs the f64 reference (`tix.meaning-within`, §6). Not exactly checkable in f32 (the bits change) — tolerance only.

---

**R2 — `div-hoist`** (a reduction-index-independent divisor leaves the reduction).

- *Statement.* From `t[Ī, x…] = sum(j) E / g` derive `p[Ī, x…] = sum(j) E; t[Ī, x…] = p[Ī, x…] / g`. For P0's `o`: `p[i,x] = sum(j) e[i,j]*v[j,x]; o[i,x] = p[i,x]/l[i]`.
- *Side conditions (syntactic).* `g`'s free names exclude the bound index `j` (in P0, `l[i]` — `i` is fine, `j` is not); `g ≠ 0` on the domain — over the reals `l[i] = Σ_j exp(·) > 0` whenever at least one `s[i,j]` is finite, which the domain guarantees (§6); over f32 `l[i]` can underflow to 0 (total underflow of every `e`), where **both** forms produce `0/0`; the contract's NaN-aware relation covers that case (§6), so the rule does not need to prove f32 non-zeroness.
- *Exact algebraic argument.* Lemma 1 (division form) with `g` independent of `j`: `(Σ_j a_j)/g = Σ_j (a_j/g)`.
- *f32 delta and its source.* P0 rounds a division per term (`fl(fl(e·v)/l)`, N divisions) and sums those; the derived form sums `fl(e·v)` and rounds one final division. The per-term divisions' roundings vanish; one rounding is added; the addends' magnitudes change by the factor `l[i]`. Relative drift ~ (N+1)·ε worst case.
- *How the application is checked.* Side conditions exactly. Lemma 1 certificate. Tolerance check after the step.

---

**R3 — `flash-fuse`** (the softmax pipeline becomes one fold with the flash state).

- *Statement (pattern over the statement graph).* A set of statements, all over the same bound index `j` with the same inferred extent:

  ```
  m[Ī]     = max(j) A;
  e[Ī, j]  = exp(A' - m[Ī]);
  l[Ī]     = sum(j) e[Ī, j];
  p[Ī, x…] = sum(j) e[Ī, j] * v[j, x…]     (or more generally sum(j) e[Ī,j] * w[…])
  ```

  is replaced by

  ```
  st[Ī] : (m: f32, l: f32, o: f32[X…]) = fold j in [0, N_j)
    init   (m = -inf, l = 0, o[x…] = 0)
    step   m2 = max(m, s_j);            // s_j ≡ A with the statement's index names substituted
           a  = exp(m - m2);
           e2 = exp(s_j - m2);
           yield (m2, a*l + e2, a*o + e2*v[j, x…]);
    combine FLASH
  o[Ī, x…] = st[Ī].o[x…] / st[Ī].l;
  ```

  where `FLASH` is the combine of §2 and the epilogue division is the hoisted form R2 produced. (`X…` are `p`'s non-`j` extents, inherited by the `o` field.)
- *Side conditions (syntactic, compile-time — this is what makes the step mechanical).*
  1. `A'` (the exp's argument minus `m`) is **the same expression** as `A` (m's reduction body), compared structurally after index-name substitution. This is the load-bearing condition: it says the exp's offset is the max of the *same* streamed quantity.
  2. `m`, `e`, `l`, `p` are all over the same bound index `j` and their extents are inferred identically (the front end's inference must agree; a mismatch is a check error).
  3. Consumer conditions: every consumer of `e` is one of the fused statements (`l`, `p`); every consumer of `m` and `l` outside the fused set is served by state projection (`st.m`, `st.l`) — i.e., reads the whole-tensor value, which the fold reproduces. A consumer of `e` that is not in the fused set makes the rule **decline** (with one sanctioned escape: an epilogue re-derivation pattern, `exp(A − m)·h/l`-shaped, used by plain softmax — see §7).
  4. The reductions' bodies contain no other use of `e` than the ones fused (no self-feeding).
- *Exact algebraic argument (the certificate: Lemma 3, the streaming-rescale lemma).* With `s_j` the real value of `A` at `(Ī, j)` and `v_j` the real vector, define the state recursion as in the step. **Claim:** after processing `j = 0..k`, `m_k = max_{j≤k} s_j`, `l_k = Σ_{j≤k} exp(s_j − m_k)`, `o_k = Σ_{j≤k} exp(s_j − m_k)·v_j`. *Proof* by induction on `k`. Empty state: `(−∞, 0, 0)` satisfies the claim vacuously (empty sums are 0; the conventions make `α·l = exp(−∞)·0 = 0`). Step: `m' = max(m_k, s_{k+1}) = max_{≤k+1}` ✓. Then, using `exp(x)·exp(y) = exp(x+y)` and distributivity, `α·l_k + e₂ = exp(m_k − m')·Σ_{j≤k} exp(s_j − m_k) + exp(s_{k+1} − m') = Σ_{j≤k} exp(s_j − m') + exp(s_{k+1} − m') = l'-form` ✓; identically for `o'` with the vectors. The `m_k = −∞` case is the base case already covered. □ The lemma uses only: field distributivity, exp-additivity, and the `−∞` conventions — a finite symbolic derivation, auditable line by line, and **independent of the program**: it is proved once per rule, not once per application. The epilogue then gives `o = (Σ_j exp(s_j − m)·v_j)/l`, whose real value equals P0's `o` by Lemma 1 (R2's identity, read backwards).
- *f32 delta and its source.* Four sources, all stated: (i) `l` and `o` accumulate through rescale multiplications (`a·l`, `a·o`) — T rescale-roundings along the way instead of none; each rescale's discarded mass is `exp(m − m')·|state|`, which when `m' − m ≥ ~104` underflows `α` to 0 — **benign**, because the discarded true contribution is ≤ e⁻¹⁰⁴·|state|, far below the tolerance floor (the f64 reference carries it at ~1e−46 and the atol floor absorbs it); (ii) the per-element exp uses the **running** max (`s_j − m₂`) rather than the final one (`s_j − m_final`) — different exp values per element, corrected by the rescales over the reals, differing by roundings over f32; (iii) the deferred division (R2's delta, already counted); (iv) **no new delta on `s`** — the step computes `s_j` with the same expression, same op order, same roundings as the materialized statement would, and **`m` is bit-identical** to P0's `m` (max is rounding-free and the `s` values are the same). Both forms keep every exp argument ≤ 0 (the max subtraction), so neither can overflow in `exp`; the deltas are all small relative drifts, not structural failures.
- *How the application is checked.* Side conditions exactly (structural expression equality, consumer sets, extent agreement). Lemma 3 as the certificate (recorded once per rule version; see §6 on proof records). Tolerance check after the step. **Plus one exact spot-check:** a probe run (§6) that returns the fold's `m` component and compares bit-for-bit against P0's `m` — cheap, and it pins the one component the derivation does *not* perturb.

---

**R4 — `tile`** (the fold over `j` becomes a fold over tiles of folds).

- *Statement.* From a fold with step `σ` and combine `⊕` over `[0, N)` derive, for a tile size `T ≥ 1`:

  ```
  st[Ī] = fold t in [0, ceil(N / T))
    init   init
    step   inner : state = fold j in [t*T, min(t*T + T, N))
             init   init
             step   σ
             (no combine: the inner fold is a plain left fold)
           yield ⊕(state_outer, inner)
    combine ⊕
  ```

- *Side conditions (syntactic).* Tile bounds are integer expressions over `t`, shape names and literals, with `min`/`ceil` allowed (integer-exact); the inner range covers `[0, N)` exactly, in order, without overlap (checked on the bound expressions: `t·T ≥ 0`, `min(t·T+T, N) ≤ N`, union = `[0, N)` — decidable on the affine forms).
- *Exact algebraic argument.* Lemma 4: the flash combine is associative over the reals (case analysis on empty/nonempty states; the nonempty case shows both bracketings evaluate to the canonical `(max, Σexp(s−M), Σexp(s−M)·v)` of the union of the two index sets, using only exp-additivity and distributivity). Associativity is exactly the license for `fold(tiles of fold(within tile)) = fold(all j)`. The same certificate covers every tile size and every nesting depth.
- *f32 delta and its source.* Reassociation of the accumulation: per-tile partials (each starting from the empty state with a tile-local max) then combined left-to-right, versus one sequential accumulation. Extra relative drift ~ ⌈N/T⌉·ε. The `m` component remains **bit-identical** (max over tile maxes of the same `s` values = max over all; max never rounds) — the same exact spot-check as R3 applies here, and this is worth having as a *second* exact anchor deep in the derivation.
- *How the application is checked.* Side conditions exactly; Lemma 4 certificate; tolerance check after the step; exact spot-check on `m`.
- *Why this rule is where "streaming" appears.* After R4, every consumer of the score expression `A` and of the exp sits **inside the inner fold's body**; nothing with an `N`-sized `j` extent escapes the fold. The lowering may therefore evaluate `A` tile-by-tile into tile-shaped buffers — the property `tix.streaming-shape` (§6) checks exactly that, structurally, and it is the compile-time certificate of the O(N·D) memory claim.

---

**R5 — `fuse-folds`** (generic, uncoupled; the weaker sibling, in the rule set for generality).

- *Statement.* Any set of core reductions (`sum` or `max`) over the **same** bound index `j`, with bodies indexed by `j` and no data dependence *between* the reduced results, fuse into one `fold` with a record state whose combine is the componentwise tuple of the components' combines (`max` and `+`); each component's `init` and per-step rounding replicate the core's `sum`/`max` semantics exactly (init 0 / −∞, increasing order, fround per step).
- *Exact argument.* Trivial componentwise: the fused fold performs, per component, the very sequence of rounded operations the original statement's semantics prescribes.
- *f32 delta.* **None — the fused program is bit-identical.** This is the rule set's one exactly-checkable fusion, and it is checked with the *exact* relation (`tix.meaning-exact`, bit equality), not the tolerance.
- *Role.* Not needed for attention (R3 subsumes it there, because R3 also carries the max-exp coupling). It is what makes layernorm statistics and any independent-statistics pipeline one-pass (§7). Keeping it in the set makes the boundary of the flash rule's extra power visible: R5 fuses what is independent; R3 is needed exactly when the running maximum must be carried *into* the accumulation.

---

**R6 — `normalize-in-fold`** (variant; the FlashAttention-2 placement, optional).

- *Statement.* From the R3 form's epilogue `o = st.o/st.l`, derive the per-step normalized step `yield (m2, l', (a*o + e2*v)/l')` (divide the freshly updated state by the freshly updated `l` inside the step) and drop the epilogue.
- *Exact argument.* Lemma 3b (corollary of Lemma 3): the per-step normalized recurrence maintains `o_k/l_k = (Σ_{≤k} exp(s−m_k)·v)/(Σ_{≤k} exp(s−m_k))` — the quotient is invariant under the common rescale `α` because the same `α` multiplies numerator and denominator and `exp(m_k − m')·exp(s_j − m_k) = exp(s_j − m')`. Requires `l' ≠ 0` (real: positive once any element is processed; f32: NaN-aware relation as in R2).
- *f32 delta.* A division per step (rounding per element per step) replaces the single final division; slightly larger drift than the deferred form; tolerance.
- *Why optional.* The derived kernel of the experiment uses the deferred form (R2's placement), which needs no per-step division in the inner loop. R6 is stated because it is reachable by the same lemmas and is the placement production FlashAttention-2 kernels use; measuring both placements is one flag in the experiment, not a separate design.

---

### The derivation, as a sequence

Each line is one rule application; the program after each step is shown in full. The priority order `R1 → R2 → R3 → R4` finds this path with no search; at each point the next applicable rule's pattern matches at most one way up to index renaming.

**P0** — the given program (§1).

**P1 = P0 after R1 (scale-in, c = √D, operand `k`):**

```
k1[j, d] = k[j, d] / sqrt(D);
s[i, j]  = sum(d) q[i, d] * k1[j, d];
m[i]     = max(j) s[i, j];
e[i, j]  = exp(s[i, j] - m[i]);
l[i]     = sum(j) e[i, j];
o[i, x]  = sum(j) e[i, j] * v[j, x] / l[i];
```

**P2 = P1 after R2 (div-hoist on `o`'s `l[i]`):**

```
k1[j, d] = k[j, d] / sqrt(D);
s[i, j]  = sum(d) q[i, d] * k1[j, d];
m[i]     = max(j) s[i, j];
e[i, j]  = exp(s[i, j] - m[i]);
l[i]     = sum(j) e[i, j];
p[i, x]  = sum(j) e[i, j] * v[j, x];
o[i, x]  = p[i, x] / l[i];
```

**P3 = P2 after R3 (flash-fuse of `{m, e, l, p}`):**

```
k1[j, d] = k[j, d] / sqrt(D);
s[i, j]  = sum(d) q[i, d] * k1[j, d];          // consumed only inside the fold
st[i] : (m: f32, l: f32, o: f32[D]) = fold j in [0, N)
  init   (m = -inf, l = 0, o[x] = 0)
  step   m2 = max(m, s[i, j]);
         a  = exp(m - m2);
         e2 = exp(s[i, j] - m2);
         yield (m2, a*l + e2, a*o + e2*v[j, x]);
  combine FLASH
o[i, x] = st[i].o[x] / st[i].l;
```

**P4 = P3 after R4 (tile, size T) — the streaming form the derivation targets:**

```
k1[j, d] = k[j, d] / sqrt(D);
st[i] : (m: f32, l: f32, o: f32[D]) = fold t in [0, ceil(N / T))
  init   (m = -inf, l = 0, o[x] = 0)
  step   inner : (m: f32, l: f32, o: f32[D]) = fold j in [t*T, min(t*T + T, N))
           init   (m = -inf, l = 0, o[x] = 0)
           step   sij = sum(d) q[i, d] * k1[j, d];
                  m2 = max(m, sij);
                  a  = exp(m - m2);
                  e2 = exp(sij - m2);
                  yield (m2, a*l + e2, a*o + e2*v[j, x]);
         yield FLASH(st, inner)
  combine FLASH
o[i, x] = st[i].o[x] / st[i].l;
```

P4 is FlashAttention's structure: one pass over tiles of `j`; running maximum `m`, normalizer `l` and output `o` in the state; `s` and `e` never escape a tile. The `sij` line is the tile's score block (a `T×D` by `D` contraction per row), the `a`-rescaling is the flash correction, and the final `o = st.o/st.l` is the deferred normalization.

## 4. The FLASH combine, in full

```
FLASH((m1, l1, o1), (m2, l2, o2)):
  M = max(m1, m2);
  if M = -inf: yield init;                       // both sides empty
  yield (M, exp(m1 - M)*l1 + exp(m2 - M)*l2, exp(m1 - M)*o1 + exp(m2 - M)*o2);
```

- Real semantics: as written, over the reals, with `exp(−∞) = 0`.
- f32 semantics: each op frounded in syntactic order; the empty-empty branch is taken before any subtraction (so `−∞ − −∞` is never evaluated).
- Certificate: **Lemma 4 (associativity over the reals)**, proved once, attached to the combine's definition. Sketch: if either side is empty the other passes through (the `exp(−∞ − M) = 0` factors kill the empty side's terms — `init` is the identity); if both are nonempty, each side's state equals the canonical form of its index set (Lemma 3's invariant), and both bracketings of `x⊕y⊕z` evaluate to the canonical form of the union — `max` and `+` reassociate, and `exp(m_i − M)·Σ exp(s − m_i) = Σ exp(s − M)` by exp-additivity and distributivity. □
- What the certificate does *not* claim: associativity **in f32**. The combine is not f32-associative (each `exp`/multiply rounds), which is exactly why R4's applications are gated by the tolerance relation and not by the exact one.

## 5. Checking: the contracts, rule by rule

The framework's contract layer already provides everything needed: versioned invariants, the sampled `differential()` mechanism with cached, worker-decidable cases and counterexample evidence, versioned rewrite rules with guards and per-step transactional evidence, and proof records with an explicit external-verifier trust boundary. The Tix domain adds three definitions; nothing in the framework changes.

**The domain** (shapes and input values). A case is `(N, D, q, k, v)`. Shapes: `N ∈ {17, 32, 64, 129, 256, 333, 512}` for checking (non-multiples of every candidate T exercise the remainder tile), `D ∈ {16, 32, 64}`; large shapes appear only in the performance arm. Values: `q, k ~ U(−a, a)` with `a ∈ {0.25, 1, 4}`, `v ~ U(−1, 1)`, deterministic (seeded generator, as the Typed contract does), plus a targeted adversarial suite: (i) a case with aligned `q`/`k` rows producing score spread > 100 (partial f32 underflow inside a row); (ii) constant rows (all scores equal — the `α = 1` path, `m` never grows); (iii) `N = 1`, `D = 1`; (iv) a total-underflow case (every `exp` argument < −104 in f32 — both forms yield `l = 0`, `o = 0/0`); (v) `N`, `D` at the inference boundaries. The generator keeps `|q|, |k| ≤ 4`, so `s` is finite in f32 for any realistic `N·D` (`|s| ≤ 4·N·D` ≪ 3.4e38) and no exp argument exceeds 0 in either form (the max subtraction), so neither form can overflow inside `exp`. Behaviour outside the domain (non-inferable extents, inconsistent shapes) is a compile-time check error, per the Tix core's own policy.

**The observation.** The returned tensor, compared elementwise over its full extent (shape agreement exact). A **probe mode** checks any named statement tensor instead of the return, by rewriting `return NAME` on a throwaway copy — this is how the `m`-component spot-checks work without changing the invariant machinery.

**The relations.**

- `tix.meaning-exact` — sampled differential, baseline = origin on the f32 interpreter, subject = candidate on the f32 interpreter, compare = bit equality of every output element (and no trap on either side). Used by R5, by the `m` spot-checks, and by pure-plumbing steps.
- `tix.meaning-within(rtol, atol)` — sampled differential, **baseline = the f64 reference interpreter of the origin** (the same schedule — same index orders, same maximal munch, same fold order — with no fround; f64 is the finite stand-in for the reals), subject = candidate on the f32 interpreter. Element relation: `ok ⇔ (isNaN(s) ∧ isNaN(r)) ∨ (s = r = +∞) ∨ (s = r = −∞) ∨ |s − r| ≤ rtol·|r| + atol`. Initial parameters `rtol = 1e-4, atol = 1e-6`; the step-0 gate and the mutation arm calibrate them (below). NaN agreement is admitted because within the domain the only NaN source is total underflow of `l` (case iv), where both forms fail the same way and the f64 reference NaNs with them; a NaN against a finite reference is a counterexample.

**The step-0 gate.** Before any rule is applied, P0 itself is checked: `tix.meaning-within` with P0's f32 interpreter as subject. This measures the plain program's own f32-vs-f64 drift (dominated by the exp-argument rounding: relative exp error ≈ ε·|argument|, and score spreads in the generator keep that ≲ 1e−5). The final `rtol` must be ≥ 4× the step-0 observed maximum — the derivation's budget is the tolerance *minus* what the baseline already spends. If step 0 cannot pass at any sane tolerance, the domain's value ranges are recalibrated first; no derivation claim is made on a baseline that already fails.

**Per-rule check matrix.**

| Rule | Exact at application time | Certificate (real arithmetic) | Empirical gate after the step | f32 delta source |
| --- | --- | --- | --- | --- |
| R1 `scale-in` | divisor index-free; operand structure; statement order | Lemma 1 (product form) | `tix.meaning-within` | regrouped per-term rounding: `fl(fl(q·k)/c)` → `fl(q·fl(k/c))` |
| R2 `div-hoist` | divisor lacks the bound index; domain `l > 0` (real) | Lemma 1 (division form) | `tix.meaning-within` | N per-term divisions → one final division; re-summed addends |
| R3 `flash-fuse` | structural exp-argument identity; extent agreement; consumer conditions | Lemma 3 | `tix.meaning-within` + exact probe on `m` | rescaled accumulation of `l`, `o`; exp at running-max offset; deferred division |
| R4 `tile` | affine tile bounds cover `[0, N)` exactly | Lemma 4 (associativity) | `tix.meaning-within` + exact probe on `m` | reassociated accumulation (per-tile partials, combined) |
| R5 `fuse-folds` | same bound index; no inter-component dependence | trivial (componentwise) | `tix.meaning-exact` (bit equality) | none — f32-exact by construction |
| R6 `normalize-in-fold` | syntactic | Lemma 3b | `tix.meaning-within` | per-step division by the running `l` |

**Where each check runs.** Each rule application is one framework rewrite transaction: `match` on the Tix statement graph, `guard` = the syntactic side conditions (registered pattern predicates — compile-time, no floats), `replace` = the fused form, `preserves` = the applicable meaning invariant. The host's semantic acceptance gate runs the invariant on the step's output revision and records, alongside the step's `TransformationResult`, the observed maximum relative deviation — so the derivation log is a per-step delta table, and each step's correctness argument is local: *this* match, *these* side conditions, *this* lemma, *this* measured delta.

**Lemma certificates.** Lemmas 1, 3, 4, 3b are recorded per rule version through the framework's proof-record path (external verifier + certificate). The honest statement of what these are: **audited induction dossiers** — each a finite symbolic derivation in the two identities (exp-additivity, distributivity) plus the `−∞` conventions, written to be checkable line by line by a reviewer in minutes. The framework contains no theorem prover and the proof assurance is an explicit trust boundary; the dossier records make that boundary visible (which lemma version backs which rule version), and the *executable* safety net remains the sampled tolerance check plus the adversarial suite. A machine-checked version of the dossiers (Lean/Coq) is a Later item, not a dependency of this design.

**The final gates** (on P4): the `tix.meaning-within` check at final parameters on the full case set including the adversarial suite; the `tix.streaming-shape` property — an exact, compile-time structural analysis: every statement whose index set includes a fold-bound (inner) index is defined and consumed within that fold's body, i.e. no tensor with an `N`-sized `j` extent escapes an enclosing fold — which is the compile-time certificate behind "never stores `s` or `e`" and the O(N·D) traffic claim; and the combine's certificate present and version-matched.

**Where the f32 differences come from — the complete list.** (1) R1 regroups the per-term rounding of the score; (2) R2 replaces N per-term divisions by one final division; (3) R3 accumulates `l` and `o` through rescale multiplications and evaluates each exp at the running rather than the final max — corrected over the reals by Lemma 3, drifted over f32; rescale-underflow discards only exponentially small mass (≤ e⁻¹⁰⁴·|state|), absorbed by the atol floor; (4) R4 reassociates the accumulation over tiles. Nothing else: `m` is bit-identical throughout; `s`'s rounding path is untouched unless R1 fires; every exp argument is ≤ 0 in every form, so no overflow appears anywhere; and the plain form's own drift (step 0) is shared by both sides of every comparison.

## 6. Generality

**Reached by the same rule set, no new lemmas:**

- **Softmax** (the brief's example): R3 with state `(m, l)`; the output `y[i,j] = exp(s[i,j] − m[i])/l[i]` is *not* a contraction, so R3's consumer condition meets the sanctioned epilogue escape: `y` is re-derived per element from `(s, m, l)` — the exp is recomputed in a tile-streaming epilogue. Real-exact (the same expression); f32: the recomputed exp matches the fused one's rounding path only if the epilogue's `s` is the same f32 value — with `s` materialization declined, the epilogue recomputes `s` per tile (bit-identical, same expression and order) — so `y` is bit-identical to plain softmax's `y` given the same `m`, `l`... except `l` itself drifted in the fold. Tolerance on `y`; exact on nothing new.
- **Log-sum-exp**: the `(m, l)` fold; `lse[i] = m[i] + log(l[i])` as an epilogue op. One extra op, no new rule.
- **Softmax followed by a contraction**: attention is the case; any `p = softmax(A)`, `p·w` contraction matches with `w` in `v`'s rôle.
- **Layernorm statistics in one pass**: `s1[i] = sum(j) x[i,j]`, `s2[i] = sum(j) x[i,j]*x[i,j]` fuse by **R5** (f32-exact!) into one fold; `mu = s1/C`, `var = s2/C − mu²` in the epilogue. Honest caveat: the one-pass variance form (`E[x²] − E[x]²`) has larger f32 error when the mean is large relative to the spread (catastrophic cancellation); the tolerance relation will *decline* the derivation on such inputs rather than silently accept it — the right behaviour, and a designed-in demonstration that the checking layer can stop a derivation that is algebraically right but numerically unacceptable for the contract at hand.
- **Multi-head attention**: `H` is an extra outer index; every statement and fold gains `[h, …]`; the rules' side conditions are per-reduction and unchanged.
- **Causal masking**, given the `-inf` extension: masked entries contribute `s_j = −∞`; Lemma 3 extends verbatim (`max` no-ops, `exp(−∞ − m) = 0`), so the elementwise rules carry over unchanged. Per-tile *skipping* of fully-masked tiles is an optimization, not a semantics step — Later.
- **Entropy/KL-style rows** (`Σ p·log p` with `p = softmax(s)`): the epilogue re-derives `p` per element (the softmax escape) and a fresh R5 fold consumes it; the rules compose on their own output.

**Plausible programs the rule set fails on, and why:**

- **Max over a different index domain than the exp's sum** (`m[i] = max(j') …` with a different extent, or a max over `d`): the exp's offset is not the running max of the streamed values; Lemma 3's induction hypothesis cannot even be stated. The pattern's side condition 1 declines it mechanically — and correctly: no streaming form with this real value exists in this vocabulary.
- **Self-referential normalization inside the loop** (e.g. `e_j = exp(s_j − m)/l_running`): the per-element contribution depends on the position in the order, so no pure `(state, element) → state` step with an associative combine expresses the original schedule; R3's pattern (which requires the exp's argument to be `A − m`) declines.
- **Negative or sign-varying factors crossing the max** (`exp(m − s)` forms — min-stabilized pipelines): the pattern matches only `exp(A − max)`; a mirrored min-stabilized rule family is a different rule set (Later). R1 itself is sign-agnostic, but the derivation stops at R3.
- **Exact-f32 acceptance**: under a bit-equality contract against the plain schedule, R1, R2, R3, R4 all change bits and the derivation is unavailable; only R5 and plumbing survive. The flash derivation exists **only under a tolerance relation** — this is a property of floating-point reassociation, not a defect of the rules, and the design says so rather than hiding it behind a loose "exact" gate.
- **Cross-row coupling** (any statement making row `i`'s pipeline depend on other rows — e.g. a global softmax whose max spans all rows): the fold is per-row; the coupling is not row-local. A two-level max over `(i, j)` derivation exists but is a different rule set (Later).
- **Data-dependent sparsity other than `−∞` masking** (top-k, dynamic thresholds): Tix has no control flow to express it; out of scope of the language, not just the rules.

## 7. The experiment

**Hypothesis (falsifiable).** On the GB10, for `D = 64` and `N` swept over `{512, 1024, 2048, 4096, 8192}` (f32, no tensor cores in any arm):

- **H1 (traffic).** The derived kernel's DRAM bytes fit `a·N·D + b` (linear fit, R² ≥ 0.99, and the linear model beats the quadratic model on the sweep), with `a ≤ 8×` the compulsory traffic `4·N·D·4 B` (reads of `q, k1, v`, write of `o`); while the unfused lowering's bytes fit `c·N² + d` (quadratic beats linear). At `N = 4096`: compulsory ≈ 4 MB, predicted derived ≤ 32 MB, unfused ≥ 300 MB (s and e written once and read twice each, plus operands).
- **H2 (time).** `t(derived) ≤ 2 × t(hand-written streaming kernel)` for `N ≥ 2048`, and `t(derived) < t(unfused)` for `N ≥ 512`, the gap growing with `N`.
- **H3 (checking).** Every step's tolerance gate passes on the full case set; the streaming-shape property holds on P4; and **every mutant in the mutation suite is rejected** at the final tolerance parameters.

**Arms.** K0 = unfused lowering of P0 (materializes `s`, `e` as global tensors); K1 = lowering of P4 (tile `T` autotuned over `{16, 32, 64, 128}`, best reported, choice recorded); K2 = a hand-written streaming kernel, same algorithm and tiling space, written directly in CUDA — the derivation must not lose to the thing people write by hand by more than the stated factor, or the derivation's *value* claim fails. All three arms are scalar-f32 SIMT so the comparison isolates the derivation, not ISA features.

**Measurement.** CUDA events around the function (inputs resident; H2D excluded), 50 warmup + 200 timed iterations, median and minimum of 3 repetitions; DRAM bytes from Nsight Compute's memory workload analysis (`dram__bytes.sum`) per launch, cross-checked against the analytic model; clocks locked where permitted, otherwise variance reported. The correctness arm re-runs the full case suite through `tix.meaning-within` on the *compiled* kernels' outputs where the harness can capture them, and on the f32 interpreter otherwise.

**Mutation suite (H3's strength measurement).** Deliberately wrong variants that the gates must reject: (a) combine without the `α` rescale of `l`; (b) rescale `l` but not `o`; (c) combine using `exp(m1 − m2)` instead of `exp(m1 − M)`/`exp(m2 − M)`; (d) `m` not carried (stuck at init); (e) tile bounds off by one (overlap or gap); (f) the epilogue dividing by the wrong field; (g) R1 folding the constant into `q` *and* leaving it in the body (double scaling). Each mutant is a hand-written variant of P4; the gates must produce a counterexample or a side-condition failure for each. The reported number is the smallest `rtol` at which any mutant survives — the margin between the working tolerance and the accepting one is the checking layer's measured strength (the IRWB-005 pattern, applied to this domain).

**Refutation conditions, explicitly.** H1 refuted if the quadratic fit beats the linear fit for K1's bytes, or `a > 8×` compulsory persistently. H2 refuted if `t(K1) > 2·t(K2)` at `N ≥ 2048` across all tile choices. H3 refuted if any step gate fails on the domain, or any mutant is accepted. Separately reported (a value refutation, not a soundness one): if K1 is slower than K0 at every `N`, the derivation is semantically sound but practically useless on this lowering — the honest outcome the experiment must be able to produce.

**Secondary signal.** The per-step delta table (each step's max relative deviation from the f64 reference, across the derivation sequence) should stay within tolerance and grow smoothly; a step whose delta jumps by an order of magnitude flags review of that step's delta analysis — a drift-localization aid, not a gate.

## 8. Alternatives considered

- **Equality saturation / e-graph over the fold algebra.** Rejected for C1: the coupled rescale is not a local rewrite (the exp's offset must equal the running max of the *same* stream — a global, order-sensitive property), and the framework's `saturate` is explicitly not an e-graph. Directed rules with a priority order keep every step's evidence attributable to one match — which is the ticket's requirement.
- **A built-in online-softmax IR op** instead of `step` + `combine`. Rejected: it hardcodes one algorithm's correctness into the IR; log-sum-exp, layernorm and future pipelines would each need new builtins with new certificates, and the derivation would degenerate to "recognize softmax, emit flash" — one pattern match, no derivation.
- **A scan formulation** (flash as an associative scan over blocks). Equivalent in power; needs a scan primitive plus the same associativity certificate. The fold-with-combine is the smaller construct and covers the elementwise step directly; a scan-based lowering (persistent kernels, warp-scan) is a Later lowering choice, not a different semantics.
- **Scaling into the exp argument** (`exp(c·(s̃ − m̃))`, keeping `s` unscaled) instead of into `k`. Real-exact by the same lemmas; costs one multiply per (i, j) in the inner loop instead of one per (j, d) once. R1's placement is the one production kernels use and the one tensor-core-style lowerings want; the alternative is reachable by the same rule with a different operand choice — noted, not chased.
- **Checking only the endpoints** (P0 and P4) instead of every step. Rejected: per-step checking is what makes each correctness argument local and each delta attributable; endpoint-only checking would blend all four rules' deltas into one number and make a failing step indistinguishable from a wrong lemma.
- **Machine-checked lemma dossiers** (Lean/Coq via `recordProof`). Strengthening, not a dependency: the framework's proof records make the trust boundary explicit either way. Later.
- **Writing the streaming form by hand and differential-testing it.** Rejected as *the answer*: it is exactly what people do today; the ticket asks whether the compiler can *derive* it with local checks, which is a different (and stronger) claim.

## 9. Implementation plan (each item is Later — this ticket ships the design only)

- Tix front end + statement-graph IR adapter for patterns and rewrites (parallel ticket owns the front end; this one consumes it).
- f64 reference interpreter for Tix (same schedule, no rounding) — the baseline port of `tix.meaning-within`.
- `tix.meaning-exact` and `tix.meaning-within(rtol, atol)` differential invariants, with probe-return observation and the step-0 gate.
- R1–R6 as versioned rewrites with registered syntactic guards; priority order R1 → R2 → R3 → R4.
- Lemma dossiers 1, 3, 3b, 4 as proof records attached to the rule/combine versions.
- The `tix.streaming-shape` property analysis (exact, compile-time).
- Fold lowering to CUDA with tile-shaped allocation, autotuned `T` (depends on the parallel CUDA lowering work).
- Benchmark harness (events, Nsight capture, fit script) and the mutation suite.
- Machine-checked lemma dossiers.

## 10. Open questions

- Should the epilogue exp-recompute (softmax's `y`) be a sanctioned R3 escape or a separate rule? (Currently: sanctioned escape inside R3's consumer condition; a separate rule is cleaner if more escapes appear.)
- Does `rtol` need to scale with `N·D`, or does the observed drift curve stay flat? (The step-delta table answers this empirically before the parameters are frozen.)
- Is the empty-empty combine branch better as a step-side guard or a combine-side case? (Currently: combine-side, because the invariant "empty ⊕ x = x" is a property of the combine, checked with its certificate.)
- Multi-head and causal variants are stated but not exercised by the design's case suite; the suite should grow one head/mask case each before those claims are treated as checked.

## References

- `src/framework/contracts/differential.ts` — the sampled differential invariant mechanism this design's contracts are built on (cases, seeds, counterexamples, baseline/subject keys, worker decision).
- `src/framework/contracts/definitions.ts` — `defineInvariant`, `defineTransformation`, proof records and the assurance taxonomy the certificates ride on.
- `src/framework/ir/PATTERNS-AND-REWRITES.md` — the rewrite API and schedule semantics the rules apply through; per-step transactional evidence.
- `src/framework/ir/rewrites.ts`, `src/framework/ir/patterns.ts` — the matcher/guard/replace machinery and registered predicates the syntactic side conditions use.
- `src/typed/evaluate.ts` — the Typed domain's meaning contract (deterministic cases, `roots`, cached baseline/subject keys), the model `tix.meaning-*` follows.
- `src/typed/f32.ts` — the f32-on-bits op semantics that the Tix f32 meaning parallels (RNE per op, `Math.fround` of the double result).
