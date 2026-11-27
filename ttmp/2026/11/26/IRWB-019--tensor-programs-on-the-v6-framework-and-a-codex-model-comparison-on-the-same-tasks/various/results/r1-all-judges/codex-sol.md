[
  {
    "doc": "doc-A.md",
    "scores": {"M1": 5, "M2": 5, "M3": 5, "M4": 5, "M5": 5, "M6": 5, "M7": 5},
    "errors": [],
    "over_engineering": 1,
    "overall": 10,
    "quotes": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": [], "M6": [], "M7": []},
    "notes": "Five rules derive the blocked loop while preserving the score expression as parsed. The explicit singleton schedule makes the f32 contract reproducible and gives the GB10 experiment a clear test of whether that schedule is competitive."
  },
  {
    "doc": "doc-B.md",
    "scores": {"M1": 5, "M2": 5, "M3": 5, "M4": 5, "M5": 5, "M6": 5, "M7": 5},
    "errors": [],
    "over_engineering": 1,
    "overall": 10,
    "quotes": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": [], "M6": [], "M7": []},
    "notes": "Partitioning, rebasing, and carrying the summary are separate checked edits. The small numerical examples exercise both rescaling directions, and the copy probe gives the traffic measurement an independent validation."
  },
  {
    "doc": "doc-C.md",
    "scores": {"M1": 3, "M2": 2, "M3": 2, "M4": 2, "M5": 2, "M6": 3, "M7": 5},
    "errors": [
      {
        "quote": "Six of the seven tensor definitions in this program either produce or consume an N×N tensor.",
        "problem": "The displayed function has five tensor definitions. Four of them, s, m, e and l, plus the output statement o, either produce or read a square tensor, for a total of five.",
        "severity": "minor"
      },
      {
        "quote": "runs the pass's **meaning check** — a v6 `InvariantDefinition` over the `{origin, candidate}` pair",
        "problem": "The framework's applyPass gates on a transformation only when one is supplied. The origin comparison is a domain-specific contract, and a sampled contract can miss a wrong edit.",
        "severity": "minor"
      },
      {
        "quote": "There is **no tolerance relation anywhere in the tree** (`grep -rn tolerance src/` finds nothing).",
        "problem": "The base contains an explicit tolerance comparison in src/labs/contracts.ts. The missing relation is the Tix-specific one.",
        "severity": "minor"
      },
      {
        "quote": "the combine is associative with `unit` as a two-sided identity",
        "problem": "The shown softmax_state combine computes exp(−∞−(−∞)) on two units. Define that case explicitly as the unit, or use an empty tag with lazy branches, before claiming a monoid.",
        "severity": "major"
      },
      {
        "quote": "The state components' free index names (here `i`, `x`) are bound outside the fold, so the fold is per free-index tuple.",
        "problem": "A per-(i,x) fold does not by itself specify how it yields one m and l per i and a vector for t. Define the vector lift per row or specify and check projection independence.",
        "severity": "major"
      },
      {
        "quote": "The fold's reduction indices range over their inferred extents exactly as `sum`/`max`'s do",
        "problem": "P4 uses jb and jt only in affine subscripts and supplies neither explicit ranges nor declarations that bind their extents. Its outer region also yields bare local tensor names where the specified scalar syntax requires indexed references or defined tensor-value syntax.",
        "severity": "major"
      },
      {
        "quote": "both have consumers in different reductions",
        "problem": "Separate consumers do not by themselves force square storage. The document's own P2 gives a recomputing implementation with separate reductions. An unfused materializing baseline is an implementation choice.",
        "severity": "minor"
      },
      {
        "quote": "the substituted value is bound **once** to a local temporary at the head of that region",
        "problem": "Uses within one region can read different indices, and substitution can capture a bound index. Share only equal indexed expressions in a scope where their dependencies are available, using capture-avoiding substitution.",
        "severity": "major"
      },
      {
        "quote": "the state is bounded in the same way the plain form is, so `Rebase` introduces no overflow the premise did not already have.",
        "problem": "A prefix numerator can overflow before a later maximum suppresses the prefix. For example, a prefix with two tied scores and two maximum-finite positive payloads can overflow, while a much larger final score makes both corresponding plain weights round to zero.",
        "severity": "major"
      },
      {
        "quote": "With one block (`B = N`) the single rescale factor is `exp(-∞ - M_J) = 0`",
        "problem": "P4 still executes the online combine inside its one block. With scores [0,1,2] and values [1,−1,0], the grouped result is −0.15469790995121002 and the online result is −0.15469789505004883 in f32.",
        "severity": "major"
      },
      {
        "quote": "after the global maximum has been seen (45.7% of blocks at B=64) the accumulation carries the plain form's bits.",
        "problem": "A unit scale on the running prefix does not undo prior rounding or restore the source's addition order. The incoming block may also still need a non-unit scale.",
        "severity": "minor"
      },
      {
        "quote": "scaled up so scores span ~60 in log (`exp` underflows for the smallest scores",
        "problem": "exp(−60) is a normal f32 value. Subnormals begin near a shift of −87.34 and rounding to zero begins near −103.97.",
        "severity": "minor"
      },
      {
        "quote": "`ε·√K` is the random-walk bound for a length-`K` f32 sum.",
        "problem": "Square-root growth is a heuristic for suitable rounding-error models, not a bound for an ordered f32 sum. Systematically rounded terms can accumulate error proportional to K, and signed cancellation worsens relative conditioning.",
        "severity": "major"
      },
      {
        "quote": "each of the five applications carries an evidence record that names only its own rule's side conditions",
        "problem": "A rule's proof can be reusable, but checking an application requires concrete program facts such as binder equality, dominance, use counts and the chosen partition. A record that excludes those facts cannot witness the actual application.",
        "severity": "major"
      },
      {
        "quote": "follows — this is attention with `k = I`; the same five applications",
        "problem": "An arbitrary softmax input need not be encoded as an attention dot product. Moreover, an explicit softmax followed by multiplication has the term (e/l)·W, which the stated Factor pattern for a top-level divisor cannot hoist without an additional product rewrite.",
        "severity": "major"
      },
      {
        "quote": "still `O(N·B)` storage instead of `O(N²)`",
        "problem": "For the stated key block width B, a materialized array of per-query block summaries has Θ(N·(N/B)·(D+2)) fields. With fixed B and D that remains quadratic in N.",
        "severity": "minor"
      },
      {
        "quote": "a program is reachable iff its nested aggregation over a common index set can be rebased by a two-set identity for some declared monoid.",
        "problem": "The stated Rebase matcher only handles its specific max-exponential syntax. Other monoids need a rule schema or implementation, and the current matcher has additional scope and use restrictions. The median example likewise establishes a matcher failure rather than a general impossibility of mergeable states.",
        "severity": "major"
      }
    ],
    "over_engineering": 8,
    "overall": 4,
    "quotes": {
      "M1": ["the combine is associative with `unit` as a two-sided identity", "so `Rebase` introduces no overflow the premise did not already have"],
      "M2": ["fold(jb) softmax_state(D)", "fold(jt) softmax_state(D)"],
      "M3": ["the fold is per free-index tuple", "unit     (-inf, 0, zeros[X]);"],
      "M4": ["the outputs are **bit-identical** to the premise's", "a run with no decided case fails"],
      "M5": ["a program is reachable iff its nested aggregation over a common index set can be rebased by a two-set identity for some declared monoid."],
      "M6": ["batch 8, heads 8", "With `B = N` (one block), the derived kernel is **bit-identical** to P1", "**DRAM bytes** per kernel"],
      "M7": []
    },
    "notes": "The reference term-scale tolerance is a substantive response to cancellation. The worked blocked program lacks bound extents under its own IR rules, and the proposed bit-exact GPU control already fails under the host arithmetic."
  },
  {
    "doc": "doc-D.md",
    "scores": {"M1": 5, "M2": 5, "M3": 5, "M4": 5, "M5": 5, "M6": 5, "M7": 5},
    "errors": [],
    "over_engineering": 1,
    "overall": 10,
    "quotes": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": [], "M6": [], "M7": []},
    "notes": "The derivation checks the replacement of each inner online fold by tile-local max and sums, then checks producer placement separately. Its storage and traffic claims are independently testable."
  },
  {
    "doc": "doc-E.md",
    "scores": {"M1": 5, "M2": 5, "M3": 5, "M4": 5, "M5": 5, "M6": 5, "M7": 5},
    "errors": [],
    "over_engineering": 0,
    "overall": 10,
    "quotes": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": [], "M6": [], "M7": []},
    "notes": "The ordered split lemma gives a direct route from the original shared maximum to a streaming block fold. The plan assigns clear evidence to the real identity, candidate f32 execution, and final device execution."
  },
  {
    "doc": "doc-F.md",
    "scores": {"M1": 5, "M2": 5, "M3": 5, "M4": 5, "M5": 5, "M6": 5, "M7": 5},
    "errors": [],
    "over_engineering": 2,
    "overall": 9,
    "quotes": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": [], "M6": [], "M7": []},
    "notes": "The trace proves and checks both division hoists, then makes each inner summary and the final fusion explicit. Moving the score divisor adds a numerical experiment without enabling any later rule."
  },
  {
    "doc": "doc-G.md",
    "scores": {"M1": 5, "M2": 5, "M3": 5, "M4": 5, "M5": 5, "M6": 5, "M7": 5},
    "errors": [],
    "over_engineering": 1,
    "overall": 10,
    "quotes": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": [], "M6": [], "M7": []},
    "notes": "The trace shows exactly when independent block summaries become available and when the global maximum pass disappears. The local proofs, directed checks, and complete-call GB10 comparison fit together."
  },
  {
    "doc": "doc-H.md",
    "scores": {"M1": 2, "M2": 3, "M3": 2, "M4": 2, "M5": 2, "M6": 3, "M7": 4},
    "errors": [
      {
        "quote": "built from shape names, integer literals, `+ − * / ceil`, no index names, no tensor refs",
        "problem": "The R1 divisor grammar excludes sqrt(D), the first claimed application. Either admit the pure sqrt call or omit that application.",
        "severity": "major"
      },
      {
        "quote": "derive `b'[…] = b[…] / c` for one tensor operand `b` of a product in `A`, and `t[Ī] = sum(j) A[b ← b']`",
        "problem": "The side conditions allow b to occur more than once or under other operations. Replacing both factors in b[j]·b[j] divides by c². Match a single multiplicative occurrence in the whole summand.",
        "severity": "major"
      },
      {
        "quote": "Each term's relative error stays ≤ ~2ε",
        "problem": "A small relative bound requires non-underflowing normal arithmetic. The stated inputs can yield subnormal products and quotients; signed products can also cancel in the dot product, so its relative error cannot be bounded from the operation count alone.",
        "severity": "minor"
      },
      {
        "quote": "over f32 `l[i]` can underflow to 0 (total underflow of every `e`)",
        "problem": "For a nonempty row of finite scores the maximizing term has weight exactly 1. The proposed total-underflow case and its NaN agreement path are impossible on that domain.",
        "severity": "major"
      },
      {
        "quote": "Relative drift ~ (N+1)·ε worst case.",
        "problem": "The numerator can cancel. Its normalized output can have arbitrarily poor relative conditioning even when all weights are positive.",
        "severity": "minor"
      },
      {
        "quote": "If `combine` is given, the fold is equivalently: map each element to a singleton state via `step`",
        "problem": "A general state-dependent step is not equivalent to mapping from init and combining. Define one operational form or require the step-to-singleton combine law for the declared pair.",
        "severity": "major"
      },
      {
        "quote": "`m` is bit-identical** to P0's `m` (max is rounding-free and the `s` values are the same)",
        "problem": "R1 changes the score rounding tree, so those scores can differ from P0. The exact maximum comparison is between revisions that use the same scaled score expression.",
        "severity": "major"
      },
      {
        "quote": "After R4, every consumer of the score expression `A` and of the exp sits **inside the inner fold's body**",
        "problem": "R4 only partitions the fold. P3 reads s from a separate definition and P4 inlines and deletes s. That requires a checked producer-substitution and dead-definition step.",
        "severity": "major"
      },
      {
        "quote": "yield (m2, l', (a*o + e2*v)/l')",
        "problem": "Once o is a normalized accumulator, its old contribution is a·l_old·o_old. With three equal scores and values all one, the stated recurrence returns 2/3 instead of 1.",
        "severity": "major"
      },
      {
        "quote": "`|s| ≤ 4·N·D`",
        "problem": "Each input is bounded by 4, so a product can have magnitude 16. The real score bound is 16√D, independent of N; the stated bound is already false at N=D=1.",
        "severity": "minor"
      },
      {
        "quote": "`ok ⇔ (isNaN(s) ∧ isNaN(r)) ∨ (s = r = +∞) ∨ (s = r = −∞) ∨ |s − r| ≤ rtol·|r| + atol`.",
        "problem": "With an infinite reference and positive rtol the last alternative can accept a finite candidate or opposite-sign infinity because both sides of the inequality are infinite. Apply the error formula only to finite pairs.",
        "severity": "major"
      },
      {
        "quote": "any `p = softmax(A)`, `p·w` contraction matches with `w` in `v`'s rôle.",
        "problem": "R2 only matches a divisor at the root of the summand. Substituting p in the stated contraction gives (e/l)·w and requires another rule to move the divisor through multiplication.",
        "severity": "major"
      },
      {
        "quote": "Lemma 3 extends verbatim (`max` no-ops, `exp(−∞ − m) = 0`)",
        "problem": "A leading masked key or an all-masked tile can produce −∞−(−∞) in the singleton step. The guard in FLASH does not guard that step. Skip masked keys before arithmetic and define the empty-row behavior.",
        "severity": "major"
      },
      {
        "quote": "no streaming form with this real value exists in this vocabulary.",
        "problem": "The matcher declines a mismatched maximum domain. A separately computed anchor or separately maintained summaries can still support streaming for some such programs.",
        "severity": "minor"
      },
      {
        "quote": "the compile-time certificate behind \"never stores `s` or `e`\" and the O(N·D) traffic claim",
        "problem": "Scoped lifetime can establish that square intermediates are unnecessary. With fixed query tiles, repeated K/V loads can still make physical traffic quadratic in N at fixed D.",
        "severity": "major"
      },
      {
        "quote": "the linear model beats the quadratic model on the sweep",
        "problem": "A fit on the five measured points can describe scaling over that sweep, but cannot establish an asymptotic traffic bound.",
        "severity": "minor"
      }
    ],
    "over_engineering": 6,
    "overall": 4,
    "quotes": {
      "M1": ["yield (m2, l', (a*o + e2*v)/l')", "for one tensor operand `b` of a product in `A`"],
      "M2": ["s[i, j]  = sum(d) q[i, d] * k1[j, d];          // consumed only inside the fold", "step   sij = sum(d) q[i, d] * k1[j, d];"],
      "M3": ["If `combine` is given, the fold is equivalently: map each element to a singleton state via `step`"],
      "M4": ["a total-underflow case (every `exp` argument < −104 in f32", "and **`m` is bit-identical** to P0's `m`"],
      "M5": ["any `p = softmax(A)`, `p·w` contraction matches", "Lemma 3 extends verbatim"],
      "M6": ["the gap growing with `N`", "if K1 is slower than K0 at every `N`", "on the *compiled* kernels' outputs where the harness can capture them, and on the f32 interpreter otherwise"],
      "M7": ["Four sources, all stated"]
    },
    "notes": "The finite-score recurrence and the idea of probing an unaffected field are useful. The exact probe needs the right predecessor, and the optional normalized recurrence and masked-prefix claim need algebraic fixes before they can be tested."
  },
  {
    "doc": "doc-I.md",
    "scores": {"M1": 5, "M2": 5, "M3": 5, "M4": 5, "M5": 5, "M6": 5, "M7": 5},
    "errors": [],
    "over_engineering": 1,
    "overall": 10,
    "quotes": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": [], "M6": [], "M7": []},
    "notes": "The derivation preserves the literal score and separates ordered tiling, algebraic rebasing, and allocation changes. The checks cover tail cases, actual device math, and matched cold-cache traffic measurements."
  },
  {
    "doc": "doc-J.md",
    "scores": {"M1": 2, "M2": 3, "M3": 2, "M4": 1, "M5": 2, "M6": 2, "M7": 5},
    "errors": [
      {
        "quote": "reductions always accumulate in increasing lexicographic order of their indices, innermost listed first.",
        "problem": "Tix makes the first listed index outermost. The worked split relies on that order and states it correctly elsewhere.",
        "severity": "major"
      },
      {
        "quote": "any change of association order changes bits",
        "problem": "A change of association can change bits. Many inputs and operations, including finite max, retain the same result.",
        "severity": "minor"
      },
      {
        "quote": "For `P0` this holds whenever `s` is finite",
        "problem": "The subtraction of two finite opposite-sign scores can round to −∞. A finite-score premise establishes a unit weight at the maximum, but does not establish that all intermediates are finite or all rounded weights are strictly positive.",
        "severity": "major"
      },
      {
        "quote": "None beyond single-assignment well-formedness",
        "problem": "Inlining a definition into a new scope also requires capture-avoiding substitution and preservation of the original extents. Scope membership alone does not prevent capture.",
        "severity": "major"
      },
      {
        "quote": "The factor may appear on either side of `X`.",
        "problem": "The statement includes division. A constant numerator c in c/X cannot be factored as c/(sum X). Only a constant denominator can be hoisted by that law.",
        "severity": "major"
      },
      {
        "quote": "Steps 11–12 (`factor-const`, applications 11–12).",
        "problem": "In the numerator the factor is inside the left-associated product (eb·g)·v and inside a nested reduction. The stated root-level statement pattern cannot match it. Add a checked product reassociation and a rewrite at the inner reduction, or state a schema that covers both.",
        "severity": "major"
      },
      {
        "quote": "This guarantees `eb ∈ (0, 1]` (argument ≤ 0) and `g ≤ 1`",
        "problem": "A local block maximum ensures nonpositive local shifts, but a rounded exponential can be zero. The g bound additionally requires the original m to dominate each block maximum. R5's stated pattern does not enforce that relation.",
        "severity": "major"
      },
      {
        "quote": "the identity `(−∞, 0, 0⃗)` combines trivially (`exp(−∞ − M) = 0`).",
        "problem": "Combining two identity states gives M=−∞ and the exponent is undefined. Define an explicit empty-empty result or use a tagged identity.",
        "severity": "major"
      },
      {
        "quote": "For each instance `ι` of the free indices (e.g. each `i`, and each `x` for the `ov` component)",
        "problem": "The scalar triple is described per (i,x) while m and l are bound only per i. The generic construct needs either a vector per i or a projection rule with a checked independence condition for the omitted x index.",
        "severity": "major"
      },
      {
        "quote": "a 128-bit-precision zero at 5 sampled points with distinct exponent values is evidence of the identity, not luck.",
        "problem": "An approximation to a transcendental value is not exact rational arithmetic. Finite samples can miss nonidentities, and the stated theorem about distinct algebraic exponents does not turn numerical zeros into a symbolic proof. Normalize symbolically after splitting the max cases, or instantiate the explicit union proof.",
        "severity": "major"
      },
      {
        "quote": "Gate: `≡` (bit-exact; the probe verifies `o`, `l`, `m` bit-identical across all 80 configurations)",
        "problem": "Split-index is bit-exact to its predecessor, but its rule and the global gate specify P0 as the exact baseline. Step 5 follows two rounding-changing hoists, so exact P0 agreement is not justified.",
        "severity": "major"
      },
      {
        "quote": "no cancellation on this program because all `exp`-summands are non-negative",
        "problem": "The mass has nonnegative terms. The numerator terms contain signed v and can cancel, so the same relative error argument does not apply to the output.",
        "severity": "major"
      },
      {
        "quote": "`ε_rel = 2^-10` covers `P0` and `P8` on uniform/normal/hot",
        "problem": "The preceding table gives hot-class maximum loads of 1.063 and 1.048, both above the acceptance threshold of 1.",
        "severity": "minor"
      },
      {
        "quote": "the GPU kernel's outputs against `P8`'s reference meaning",
        "problem": "If lowering uses a tolerance, that comparison cannot compose with P8's tolerance to the source. Qualify the device result directly against the pinned original f64 reference as well.",
        "severity": "major"
      },
      {
        "quote": "Joining (`exp(x)·exp(y) → exp(x+y)`) is the numerically unsafe direction (each factor can overflow)",
        "problem": "Separate factors can overflow or underflow even when the joined exponent is benign. The joining direction avoids that particular hazard, although it still changes f32 values and needs checking.",
        "severity": "minor"
      },
      {
        "quote": "`fold-intro`'s degenerate case with no maximum component",
        "problem": "The stated fold-intro pattern requires a maximum and its exponential rescale. Packing additive moments needs its own rule; packing moments already in the source is bit-exact and does not introduce raw-moment cancellation.",
        "severity": "major"
      },
      {
        "quote": "any Tix expression over the inputs",
        "problem": "The same thirteen applications require structure that the generalized claim does not guarantee, including a score divisor to hoist. An explicit normalized weight multiplied by a payload also does not match the stated top-level division rule.",
        "severity": "major"
      },
      {
        "quote": "the FLOP count is unchanged",
        "problem": "The asymptotic work stays Θ(N²D). Hoisting divisions and adding block scalings change the operation count.",
        "severity": "minor"
      },
      {
        "quote": "measured DRAM bytes and GPU kernel time scale as O(N) in `N`",
        "problem": "At fixed D and fixed hardware throughput the design still performs quadratic arithmetic. A finite sweep can test measured ratios and slopes, but the reformulation supplies neither asymptotically linear execution time nor a general linear traffic bound.",
        "severity": "major"
      }
    ],
    "over_engineering": 7,
    "overall": 4,
    "quotes": {
      "M1": ["The factor may appear on either side of `X`.", "the identity `(−∞, 0, 0⃗)` combines trivially"],
      "M2": ["Steps 11–12 (`factor-const`, applications 11–12).", "P8, transcribed to CUDA"],
      "M3": ["For each instance `ι` of the free indices", "a 128-bit-precision zero at 5 sampled points"],
      "M4": ["a differential invariant against **`P0`** (the original program)", "no cancellation on this program"],
      "M5": ["with the same thirteen steps", "`fold-intro`'s degenerate case with no maximum component"],
      "M6": ["beaten by ≥ 5× in time", "or is ever slower than the unfused lowering", "DRAM bytes moved per launch"],
      "M7": []
    },
    "notes": "Separating affine index splitting from numerical reassociation is valuable, and the min-shift control illustrates why structural range guards matter. The worked chain needs a stronger factor rule, corrected comparison ports, and a device protocol whose refutation thresholds match its hypothesis."
  },
  {
    "doc": "doc-K.md",
    "scores": {"M1": 5, "M2": 5, "M3": 5, "M4": 5, "M5": 5, "M6": 5, "M7": 5},
    "errors": [],
    "over_engineering": 1,
    "overall": 10,
    "quotes": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": [], "M6": [], "M7": []},
    "notes": "The trace makes the canonical tile computation and its f32 changes explicit. The 33-key negative control gives the checker a concrete example where dropping the old scale changes the returned value substantially."
  },
  {
    "doc": "doc-L.md",
    "scores": {"M1": 3, "M2": 3, "M3": 2, "M4": 2, "M5": 3, "M6": 3, "M7": 5},
    "errors": [
      {
        "quote": "the plain program materializes three N×N intermediates",
        "problem": "The square intermediates are s and e. Read traffic is separate from the number of intermediates, and six logical traversals do not guarantee six full DRAM traversals.",
        "severity": "minor"
      },
      {
        "quote": "the combine is associative with identity `(−∞, 0, 0)`",
        "problem": "The emitted combine does not implement the lemma's empty-side convention when both operands are empty. It evaluates exp(−∞−(−∞)). The stated identity law needs a guard or an explicitly restricted composition domain.",
        "severity": "major"
      },
      {
        "quote": "`emit` components reference only the free indices, `j`, parameters and shape names",
        "problem": "P3 and P4 emit s[i,j] before step 5 inlines it. The stated well-formedness rule excludes that earlier tensor definition. Permit pure immutable captures or inline s before introducing the fold.",
        "severity": "major"
      },
      {
        "quote": "scalar components are shared across the indices they do not carry, and an implementation may compute them once per projection",
        "problem": "Purity does not imply independence of an omitted axis. A generic emit or combine could make l[i] depend on x. Check per-component dependencies or use an explicit vector state per i.",
        "severity": "major"
      },
      {
        "quote": "the construct itself is well-formed with any B ≥ 1",
        "problem": "The same section requires B to divide the extent, and the operational semantics provide no tail iteration. Specify one consistent domain.",
        "severity": "minor"
      },
      {
        "quote": "mechanically: `emit = (S, 1.0, V₁, …, V_q)`",
        "problem": "The shape of the emit tuple alone does not imply that the inner fold equals the proposed two-pass summary. R6 must verify the actual rescaling combine and the canonical initializer as well.",
        "severity": "major"
      },
      {
        "quote": "sampled evidence otherwise, recorded as such",
        "problem": "Sampled associativity tests do not establish the exact real law R5 requires. Require a proof for the combiner and use samples only for the additional f32 relation.",
        "severity": "major"
      },
      {
        "quote": "the before-program as baseline, the after-program as subject",
        "problem": "The per-rule wiring says adjacent baseline while the tolerance definition uses the original f64 reference. Bind the original explicitly for lossy rules. Also, the proposed no-regression inequality is implied by the accuracy inequality and adds no check.",
        "severity": "minor"
      },
      {
        "quote": "so there is no cancellation amplification.",
        "problem": "The payloads are signed, so a convex combination can be arbitrarily close to zero. Positive weights only rule out cancellation in the normalizer. The stated relative operation-count bound for the output does not follow.",
        "severity": "major"
      },
      {
        "quote": "All exp arguments stay ≤ 0 — no overflow is possible in the streaming form, on any domain where the scores are finite.",
        "problem": "The exponentials cannot overflow under the shift, but the weighted numerator can overflow on finite large payloads. Two tied scores with maximum-finite values suffice.",
        "severity": "major"
      },
      {
        "quote": "On wider domains (|scores| ≥ ~88) small weights flush to zero in f32",
        "problem": "The shift gap controls underflow, rather than score magnitude. With gradual underflow the shift can be around −88 while a subnormal weight is retained; rounding to zero begins near −103.97.",
        "severity": "minor"
      },
      {
        "quote": "every lemma tolerates `−∞` emit values as long as some score is finite",
        "problem": "A leading masked key or fully masked tile can combine two states whose maxima are −∞ before any finite score is seen. The shown combine then produces NaNs.",
        "severity": "major"
      },
      {
        "quote": "Softmax followed by any contraction",
        "problem": "The rules cover the displayed hoisted form, but INLINE applied to a separately normalized softmax ordinarily gives (e/l)·V. FACTOR-OUT lacks the product variant needed to reach the displayed form, and ragged D also needs a domain representation absent here.",
        "severity": "minor"
      },
      {
        "quote": "R7 introduces the max, R3 pairs, R8 resolves the log",
        "problem": "The sequence can work in a bounded domain with finite intermediate products, but R7 explicitly forms exp(M) times a sum. It cannot generally stabilize an overflowing original log-sum-exp through individually accepted revisions. A checked rewrite at the surrounding log can avoid that intermediate.",
        "severity": "minor"
      },
      {
        "quote": "`≈ 8·N²·D/R + O(N·D)` bytes — `k` and `v` restreamed once per row tile, no N² term",
        "problem": "The displayed model has a quadratic term for fixed R and D. It omits square-intermediate traffic, which is a different claim. The stated unfused formula also gives 36N² at B=64,D=128, and gives a derived/unfused ratio near 0.73 at D=256, rather than the quoted 40N² and 0.57.",
        "severity": "major"
      }
    ],
    "over_engineering": 6,
    "overall": 5,
    "quotes": {
      "M1": ["the combine is associative with identity `(−∞, 0, 0)`", "mechanically: `emit = (S, 1.0, V₁, …, V_q)`"],
      "M2": ["`emit` components reference only the free indices, `j`, parameters and shape names", "emit(s[i, j], 1.0)"],
      "M3": ["scalar components are shared across the indices they do not carry", "sampled evidence otherwise"],
      "M4": ["so there is no cancellation amplification", "the before-program as baseline, the after-program as subject"],
      "M5": ["Softmax followed by any contraction", "every lemma tolerates `−∞` emit values"],
      "M6": ["`N ∈ [1, 1024]`", "`N ∈ {512, 1024, 2048, 4096}`", "no N² term"],
      "M7": []
    },
    "notes": "Introducing the normalizer before extending it with the payload is an informative decomposition. The intermediate programs need a consistent capture rule, and the sampled associativity fallback and traffic-based acceptance model need repair."
  },
  {
    "doc": "doc-M.md",
    "scores": {"M1": 5, "M2": 5, "M3": 5, "M4": 5, "M5": 5, "M6": 5, "M7": 5},
    "errors": [],
    "over_engineering": 1,
    "overall": 10,
    "quotes": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": [], "M6": [], "M7": []},
    "notes": "Using the summary law in reverse inside a tile accounts for the direct tile computation as its own checked edit. The same fixed origin anchors all versions, including the selected CUDA lowering."
  },
  {
    "doc": "doc-N.md",
    "scores": {"M1": 5, "M2": 5, "M3": 5, "M4": 5, "M5": 5, "M6": 5, "M7": 5},
    "errors": [],
    "over_engineering": 1,
    "overall": 10,
    "quotes": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": [], "M6": [], "M7": []},
    "notes": "Four rules suffice because the summary introduction includes the checked producer substitution, and the tile rule directly instantiates the summary definition. Both combined steps state the conditions needed to replay the edits."
  },
  {
    "doc": "doc-O.md",
    "scores": {"M1": 5, "M2": 5, "M3": 5, "M4": 5, "M5": 4, "M6": 5, "M7": 5},
    "errors": [
      {
        "quote": "Reached when the weights share exactly the maximum and normalization and only the contraction is observed.",
        "problem": "An explicit softmax followed by a contraction gives (W_j/L)·P_j after substitution. Rule 1 matches (W_j·P_j)/L, and Rule 5 only localizes tile producers. Add the pure substitution and product form of divisor factoring, or narrow the reach claim to the matched spelling.",
        "severity": "minor"
      }
    ],
    "over_engineering": 0,
    "overall": 9,
    "quotes": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": ["Match `sum(j) (W_j * P_j[x] / L)`", "Reached when the weights share exactly the maximum and normalization and only the contraction is observed."], "M6": [], "M7": []},
    "notes": "The five-rule trace and the device comparison are directly usable for the supplied source. The stated transfer to separately written softmax needs a small additional algebraic pattern."
  },
  {
    "doc": "doc-P.md",
    "scores": {"M1": 5, "M2": 5, "M3": 5, "M4": 5, "M5": 5, "M6": 5, "M7": 5},
    "errors": [],
    "over_engineering": 2,
    "overall": 10,
    "quotes": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": [], "M6": [], "M7": []},
    "notes": "The scale-transport law precisely identifies the operation the compiler can synthesize and verify. The final realization rule makes the storage and scheduling obligations explicit, down to producer lifetime and one writer per output."
  },
  {
    "doc": "doc-Q.md",
    "scores": {"M1": 1, "M2": 1, "M3": 2, "M4": 1, "M5": 2, "M6": 3, "M7": 4},
    "errors": [
      {
        "quote": "only two rules\never leave the f32-exact world",
        "problem": "R2 changes rounding by hoisting division, and the tile rewrite in R7, as applied to R6's online subfold, changes shifts, products and accumulation. Both need tolerance.",
        "severity": "major"
      },
      {
        "quote": "whether as a whole statement RHS or nested in a statement RHS",
        "problem": "Hoisting a nested reduction to statement scope must preserve its enclosing index dependencies and avoid capture. R1 says it needs no such side conditions.",
        "severity": "major"
      },
      {
        "quote": "After applying R2 to\n`o[i,x] = sum(j) e[i,j] * v[j,x] / l[i]`",
        "problem": "The worked order applies R1 first and R2 second, at which point this expression has already become a state update. R2 needs an explicit rule for that state update or must precede R1.",
        "severity": "major"
      },
      {
        "quote": "since inputs are finite,\n`m[i]` is finite",
        "problem": "Finite f32 values can overflow in q·k. For example q=k=2^100 with D=1 gives +∞ and a subsequent +∞−(+∞) shift. The domain needs bounded intermediates or a certificate for them.",
        "severity": "major"
      },
      {
        "quote": "the derived\nform is *more* accurate, but different",
        "problem": "Hoisting changes rounding and may improve or worsen accuracy. It can also introduce an unnormalized overflow that the per-term-divided form avoids.",
        "severity": "minor"
      },
      {
        "quote": "whose `step` bodies do not read each other's state components",
        "problem": "The merge also needs independent initializers and hygienic state names. A pure initializer of the second fold can legally read the final state of the first, in which case merging their traversals changes the result.",
        "severity": "major"
      },
      {
        "quote": "or another family closed under this rescaling",
        "problem": "Closure is insufficient for the proof. The accumulation must distribute over common scaling and have a compatible identity; the emitted update is specifically addition.",
        "severity": "major"
      },
      {
        "quote": "Identity: (−∞, 0⃗).",
        "problem": "The stated combine on two such identities evaluates −∞−(−∞). Give an explicit empty branch or restrict and check every allowed merge.",
        "severity": "major"
      },
      {
        "quote": "l[i]       = l[i] * g[i] + lB[i];\n      u[i, x]    = u[i, x] * g[i] + uB[i, x];",
        "problem": "The incoming tile is summarized at mB and needs its own factor exp(mB−max(m_old,mB)) on both lB and uB. With singleton scores 1 then 0 and values 1 then 0 the displayed loop gives 1/2, while the real answer is 1/(1+exp(−1)).",
        "severity": "major"
      },
      {
        "quote": "k[jb2, d] / sqrt(D)",
        "problem": "The derived code never uses jb to address keys or values. It repeats the first tile if jb2 is locally bounded, or scans all keys if extent inference takes its extent from k and v. It needs b·B+local_j and explicitly defined tile bounds.",
        "severity": "major"
      },
      {
        "quote": "the core's extent inference over affine\n`jb·B + jb2` positions is part of the fold extension's inference rules",
        "problem": "An affine occurrence does not infer those extents from the core. Neither an extent declaration for the two indices nor scoped inner-fold syntax is supplied by the stated grammar.",
        "severity": "major"
      },
      {
        "quote": "a core `sum`/`max`\n*is* the corresponding fold; re-expressing it cannot change a single rounded\noperation.",
        "problem": "R6's inner step uses the running maximum and rescales its prefix. R7's direct block form uses a precomputed block maximum. The real union proof licenses the replacement, while different rounded intermediates require tolerance.",
        "severity": "major"
      },
      {
        "quote": "R6 contributes\n    `log B + N/B`",
        "problem": "The stated local subfold is sequential, so its addition depth is B rather than log B. An operation count also does not by itself bound relative output error through signed cancellation and exponentiation.",
        "severity": "major"
      },
      {
        "quote": "R5's repeated\nrescaling driving `l` and `u` toward underflow together",
        "problem": "For a valid nonempty finite-score summary, l remains at least one because a winning maximum contributes a weight of one. Old mass can underflow and u can cancel; the completed l does not underflow.",
        "severity": "minor"
      },
      {
        "quote": "R5 with `φ = exp` and the log-space combine, R6/R7 with\nthe log-domain block body.",
        "problem": "R5 and R7 specify linear sums and a linear-space block body. They do not derive a log-space state and block reduction. Stable log-sum-exp can use the ordinary (m,l) summary with the finalizer m+log(l).",
        "severity": "major"
      },
      {
        "quote": "This is why the tolerance relation must be two-sided",
        "problem": "A magnitude error bound is already symmetric in the sign of a deviation. Accuracy improvements are accommodated by comparing each revision directly to the fixed f64 reference.",
        "severity": "minor"
      },
      {
        "quote": "with O(N·D) memory traffic",
        "problem": "The absence of square intermediates gives a storage result. On fixed hardware, query tiles may repeatedly fetch K/V and total traffic can be superlinear.",
        "severity": "major"
      }
    ],
    "over_engineering": 6,
    "overall": 3,
    "quotes": {
      "M1": ["l[i]       = l[i] * g[i] + lB[i];", "Identity: (−∞, 0⃗)."],
      "M2": ["| 1 | R1 | the `d`-sum", "k[jb2, d] / sqrt(D)"],
      "M3": ["range over extents inferred exactly\n  like reduction indices in the core", "Identity: (−∞, 0⃗)."],
      "M4": ["R1, R3, R4, R7 | none (bitwise)", "`β ≈ c · ε_f32 · C`"],
      "M5": ["R5 with `φ = exp` and the log-space combine", "plain softmax is the instance with `w = 1`"],
      "M6": ["H2 falls if the derived kernel is > 2× slower than the hand-written\nkernel at the largest config", "or\ncheck is superpolynomial"],
      "M7": ["Blocking before block-body re-expression (R6 then R7)."]
    },
    "notes": "The dependency that prevents merging max and weighted sums is correctly identified. The final program repeats the wrong keys and omits the incoming scale, and its exact gate for tile re-expression would reject legitimate numerical changes."
  },
  {
    "doc": "doc-R.md",
    "scores": {"M1": 3, "M2": 3, "M3": 3, "M4": 2, "M5": 2, "M6": 3, "M7": 5},
    "errors": [
      {
        "quote": "**κ is associative, commutative, with unit Z(∅).**",
        "problem": "The stated expression is undefined for two empty operands. The empty/nonempty proof assumes a finite merged maximum; add a separate empty-empty branch.",
        "severity": "major"
      },
      {
        "quote": "and the same for `max(k)` (monotonicity of division by a positive constant).",
        "problem": "The max variant needs a positive multiplier as well as a positive divisor. The common side conditions allow negative nonzero constants, which reverse the ordering.",
        "severity": "minor"
      },
      {
        "quote": "No algebra, no\nside condition beyond the index agreement.",
        "problem": "Bundled reductions must be independent. If a later reduction reads an earlier completed reduction, a product fold cannot substitute the earlier partial state or refer to its not-yet-produced result.",
        "severity": "major"
      },
      {
        "quote": "`d`'s indices must be a subset of the\nconsumer's fold indices",
        "problem": "The worked fusion of e[i,j] and s[i,j] into fold(j) also needs the enclosing free index i. The guard as written rejects the trace. Include the consumer's free indices and preserve each access map.",
        "severity": "major"
      },
      {
        "quote": "the reduction\nindices range over extents inferred from their plain uses",
        "problem": "The outer J in P5 has no plain use that establishes N/B, and its range is not written in the program. The inner affine bound cannot supply that trip count under the stated inference rule.",
        "severity": "major"
      },
      {
        "quote": "β ≤ 87 (so no `exp` overflows f32",
        "problem": "This bounds individual weights, not their sum. Six tied scores near 87 suffice to overflow an f32 normalizer. A sufficient range proof must bound both the normalizer and absolute weighted sums, accounting for N and the payload magnitudes.",
        "severity": "major"
      },
      {
        "quote": "R6 *removes* roundings (no rescaling at all) and is\nstrictly closer to the original.",
        "problem": "Fewer operations do not impose an accuracy ordering. The unshifted weights can be less accurate or overflow even when the stated score guard holds.",
        "severity": "minor"
      },
      {
        "quote": "For rules not using R6, no bound on α beyond finiteness",
        "problem": "This admits finite f32 inputs that overflow in the score product and produce NaNs after centering. It contradicts the stated finite-origin observation.",
        "severity": "major"
      },
      {
        "quote": "its rounding error is common-mode and cancels in `ν/λ`",
        "problem": "A common scale on the entire final state cancels over the reals. A rounding error in a factor applied to only one child changes its relative mass, and the products in the two fields round independently.",
        "severity": "major"
      },
      {
        "quote": "Bounded by the usual `O(log N · u)`",
        "problem": "The stated within-tile and across-tile accumulations are left folds, not balanced trees. The corresponding depth is on the order of B+N/B for the blocked fold, and signed cancellation can further amplify relative error.",
        "severity": "minor"
      },
      {
        "quote": "one level deep is enough for every obligation here",
        "problem": "The proposed normal form does not handle nested maxima in associativity, rational division in the hoist and quotient obligation, or log in the LSE obligation. A positive parameter alone does not establish a logarithm identity.",
        "severity": "major"
      },
      {
        "quote": "a one-pass softmax with no stored `e` — R4 optional",
        "problem": "The normalizer depends on the completed maximum before R4, so R2 cannot zip them as independent accumulators. Returning every probability also requires retaining or revisiting individual logits after the normalizer is available.",
        "severity": "major"
      },
      {
        "quote": "the running maximum yields `(μ_t, λ_t)` differing by a factor.",
        "problem": "At completion, the running maximum is the global maximum, and the exact normalizer is the same as the two-pass normalizer. The representation-change identity is valid for an arbitrary anchor but unnecessary here. R4's stated guards also forbid the external maximum use needed for this LSE finalizer.",
        "severity": "major"
      },
      {
        "quote": "the observation is not homogeneous of degree zero in `(λ, ν)`: it exposes the shift, so the running maximum is not allowed.",
        "problem": "R4's syntactic guard does refuse this case, but its own representation lemma establishes equality of the final maximum, normalizer and numerator. Exposing l is therefore not a mathematical obstacle.",
        "severity": "minor"
      },
      {
        "quote": "the maximum is not mergeable",
        "problem": "A mean-centered state can merge by carrying the count and mean, then transporting each child's weighted sums to the combined mean. The stated matcher lacks that representation, and the mean fails to bound the exponent arguments.",
        "severity": "minor"
      },
      {
        "quote": "peak allocated bytes plus a copy microbenchmark that fixes the achievable bandwidth",
        "problem": "Allocated bytes and copy bandwidth cannot recover physical traffic for a kernel with different cache behavior, instruction throughput and occupancy. Leave the DRAM endpoint unmeasured when counters are unavailable.",
        "severity": "major"
      }
    ],
    "over_engineering": 8,
    "overall": 5,
    "quotes": {
      "M1": ["with unit Z(∅)", "No algebra, no\nside condition beyond the index agreement."],
      "M2": ["`d`'s indices must be a subset of the\nconsumer's fold indices", "= fold(J) with"],
      "M3": ["one level deep is enough for every obligation here", "the reduction\nindices range over extents inferred from their plain uses"],
      "M4": ["no bound on α beyond finiteness", "its rounding error is common-mode and cancels in `ν/λ`"],
      "M5": ["a one-pass softmax with no stored `e` — R4 optional", "the running maximum yields `(μ_t, λ_t)` differing by a factor."],
      "M6": ["peak allocated bytes plus a copy microbenchmark", "both must be bounded by a constant", "if accepting the whole chain costs more than one sampled check of the final revision"],
      "M7": []
    },
    "notes": "The representation lemma and paired versus independent comparisons are valuable. The proposed general normalizer, shape inference and numeric domain are insufficient to run the stated checked chain, and the traffic surrogate cannot replace the primary measurement."
  },
  {
    "doc": "doc-S.md",
    "scores": {"M1": 2, "M2": 3, "M3": 3, "M4": 2, "M5": 2, "M6": 3, "M7": 5},
    "errors": [
      {
        "quote": "v re-read per row (N²)",
        "problem": "A full V reread per query row costs N²D elements; a reread per query tile of R rows costs about N²D/R before cache reuse. The stated traffic model does not follow from that assumption.",
        "severity": "minor"
      },
      {
        "quote": "`combine` is associative, and `(−∞, 0, 0)` is its two-sided identity",
        "problem": "The arithmetic expression is undefined on two empty states. The later observation that the chosen nonempty schedule avoids that case does not establish a total identity law. Define an explicit empty result or certify the restricted grouping directly.",
        "severity": "major"
      },
      {
        "quote": "`commute` over ℝ holds (max and addition commute), which is why a split-K version is\n*mathematically* available even though §13 does not need it — and, since it is not exact in f32",
        "problem": "For the finite nonempty state carrier, swapping the operands swaps the same separately rounded products and the two operands of each addition. That is commutative under the stated f32 operations. Rebracketing, as opposed to swapping two operands, can change bits.",
        "severity": "minor"
      },
      {
        "quote": "exact in f32 when the offset is at least the largest score minus a margin",
        "problem": "A safe exponent range does not imply bit equality. The order of rounded subtraction, exponentiation, summation and division can change the output when the offset changes, even without overflow or underflow.",
        "severity": "major"
      },
      {
        "quote": "with side condition (i) making `g ≠ 0` a precondition of the *evaluation* (the brief's domain\nexcludes a division by zero",
        "problem": "Index independence does not imply nonzero, and finite inputs can lead to division by zero under Tix's arithmetic. The rule must discharge nonzero explicitly, for example via the attained maximum in the attention normalizer.",
        "severity": "major"
      },
      {
        "quote": "Real: **none** — not even that `u` bounds `s`.",
        "problem": "Arbitrary finite offsets preserve the quotient if the same common factor applies to both sums. They change the sums themselves, so the rule needs a use condition excluding unchanged outside observers and offset-dependent payloads.",
        "severity": "major"
      },
      {
        "quote": "both are implied by `u[i] ≥ max_j s[i,j]`",
        "problem": "An offset far above the maximum can make every weight zero. Scores all zero and u=200 satisfy the inequality and give a zero f32 denominator. Use the attained maximum itself or prove that a term survives, and separately bound weighted sums.",
        "severity": "major"
      },
      {
        "quote": "a block's max is fixed for the whole block, so\neach element is rescaled at most once per block boundary",
        "problem": "A5 uses the online combine inside the block, where the local maximum can grow at every key. A block max fixed before weighting would require a separate checked rewrite to direct tile statistics.",
        "severity": "major"
      },
      {
        "quote": "the last block's `over` masks the tail with `−inf`",
        "problem": "The shown IR has no predicated load. Adding an infinite score cannot prevent out-of-bounds K/V indexing, and a leading −∞ lane can enter an empty-empty numerical combine. Clipped ranges or correctly guarded loads and empty states are required.",
        "severity": "major"
      },
      {
        "quote": "the rules decide the traffic's asymptotics, the lowering decides\nthe constant.",
        "problem": "The lowering's cache and tiling policy can change the observed scaling itself, as the document's two traffic models show. The rule chain establishes removal of square intermediates.",
        "severity": "major"
      },
      {
        "quote": "for N ≤ 2²⁴ a subnormal rescale can never change the\nf32 output.",
        "problem": "A bound on old mass relative to a normalizer of at least one says nothing about bit equality of a tiny output numerator. For scores [0,88,88.125] and values [1,0,0], direct and successive rescaling differ by one subnormal unit in the final output.",
        "severity": "major"
      },
      {
        "quote": "an absolute\n  perturbation `δs` in a score becomes a relative perturbation `≈ |s|·δs`",
        "problem": "The relative change in the weight is exp(δs)−1, approximately δs. The factor |s| enters only when the starting error is relative to the score.",
        "severity": "minor"
      },
      {
        "quote": "`CaseComparison` is `{ok, reason?}`. A tolerance check\n   needs to carry a *distance*",
        "problem": "The existing comparison callback can apply a tolerance and return its verdict. Numeric diagnostics can be recorded by the domain without making a new framework relation or assurance grade a prerequisite.",
        "severity": "minor"
      },
      {
        "quote": "it is stronger than `sampled` (it has a per-element bound and a\nstatus clause)",
        "problem": "Per-element tolerance and status checks define the sampled relation. They do not strengthen the quantifier or the evidence that unsampled inputs satisfy it.",
        "severity": "minor"
      },
      {
        "quote": "the scores are finite",
        "problem": "The fold's identity arguments require finite computed scores, which finite f32 parameters do not guarantee. Prove a bound on the score arithmetic for the supported domain.",
        "severity": "major"
      },
      {
        "quote": "status(cand) = status(ref)   (a non-finite element must be non-finite in both)",
        "problem": "The displayed status is tensor-wide. Equal statuses do not imply matching nonfinite coordinates or matching shapes, and a zero reference row also needs a defined scale floor if the test promises one. Require the expected shape and finite outputs on the selected domain.",
        "severity": "major"
      },
      {
        "quote": "R2 (with a `log`), R3",
        "problem": "R2 matches a quotient whose common scale cancels. It cannot rewrite unstabilized log-sum-exp. This requires a new log-specific identity or a stable source exposing m+log(l).",
        "severity": "major"
      },
      {
        "quote": "R3 with `⊕ = +`",
        "problem": "R3's actual preconditions require the matching maximum and exponential weight group. A plain sum of squares already streams in core Tix; the stated R3 does not derive it.",
        "severity": "minor"
      },
      {
        "quote": "If the normalizer summed over a subset, the\n   offset would no longer bound the summands",
        "problem": "The maximum over a superset does bound every member of the subset. The equal-domain matcher still refuses the case, and a strict gap could make every subset weight underflow.",
        "severity": "major"
      },
      {
        "quote": "`combine((5,2),(5,7))` has two answers depending on the parenthesisation.",
        "problem": "Two inputs have no alternative parenthesization. An ordered left-biased argmax combine is already associative, selecting the first maximum in the concatenated sequence. A consistent index tie-break is needed for a commutative variant.",
        "severity": "minor"
      }
    ],
    "over_engineering": 9,
    "overall": 5,
    "quotes": {
      "M1": ["both are implied by `u[i] ≥ max_j s[i,j]`", "the brief's domain\nexcludes a division by zero"],
      "M2": ["fold blocks(B) t", "the last block's `over` masks the tail with `−inf`"],
      "M3": ["`combine(from, from)` is `(−∞, exp(−∞ − (−∞)), …)`", "`identity` | R5, and any parallel lowering"],
      "M4": ["status(cand) = status(ref)", "a subnormal rescale can never change the\nf32 output"],
      "M5": ["R2 (with a `log`), R3", "`combine((5,2),(5,7))` has two answers depending on the parenthesisation."],
      "M6": ["DRAM bytes   <= 1.25 x", "K2 moves ≥ 2× K3's DRAM bytes", "median time  <= 1.5  x", "K2 is ≥ 2.5× slower than K3 at every shape"],
      "M7": []
    },
    "notes": "The host probes inform a useful choice to preserve the literal score calculation, and the row-scaled numerical test addresses cancellation. The optional offset rule and claimed empty identity need stronger premises, and the GB10 decision table fails to apply the hypothesis's own thresholds."
  }
]