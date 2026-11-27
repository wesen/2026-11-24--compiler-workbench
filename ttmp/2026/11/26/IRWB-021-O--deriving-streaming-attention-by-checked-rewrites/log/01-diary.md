---
Title: 'Diary: deriving streaming attention by checked rewrites'
Ticket: IRWB-021-O
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-021-O--deriving-streaming-attention-by-checked-rewrites/design/01-deriving-streaming-attention-by-checked-rewrites.md
      Note: the design this diary records the production of
    - Path: repo://ttmp/2026/11/26/IRWB-021-O--deriving-streaming-attention-by-checked-rewrites/reference/01-ticket-brief.md
      Note: the verbatim brief every step cites
    - Path: repo://ttmp/2026/11/26/IRWB-021-O--deriving-streaming-attention-by-checked-rewrites/scripts/02-derivation-stages-probe.mjs
      Note: the probe that checks each intermediate program of the derivation, not just the endpoints
    - Path: repo://ttmp/2026/11/26/IRWB-021-O--deriving-streaming-attention-by-checked-rewrites/various/02-derivation-stages-probe.txt
      Note: the probe output the design's section 6.3 numbers come from
ExternalSources: []
Summary: 'Chronological record of a research-design ticket: reading the framework''s meaning-check and rule-evidence machinery, choosing a four-rule set and one new IR construct, probing the algebra and the f32 drift before writing any of it down, and correcting two numeric claims the probes refuted.'
LastUpdated: 2026-11-26T00:00:00-05:00
WhatFor: How the IRWB-021-O design was arrived at, what was measured and what had to be corrected.
WhenToUse: When resuming IRWB-021-O, or when asking why the rule set has four rules and why the tolerance relation is scaled.
---

# Diary: IRWB-021-O

## Step 1: Read the framework machinery the design has to fit, before designing anything

The ticket is a research design — no implementation — but a design that names the wrong framework
objects, or invents a contract shape the framework does not have, is worthless. So the first step was to
read the parts of the worktree the design must attach to: the pass gate, the shape of a meaning check, and the
rule-evidence vocabulary that IRWB-006 built.

### Prompt Context
**User prompt (verbatim):** see `reference/01-ticket-brief.md`, where the authored request is reproduced in full
(the question, the five things the design must settle, the fixed Tix core with its f32 meaning, and the
constraints). It is not re-quoted here.

**Assistant interpretation:** Produce a design document (not code) that answers whether FlashAttention can be
*derived* from the plain Tix attention program by checked rewrites, settling: the rules with side conditions and
real-algebra arguments, the derivation itself, the missing IR construct with its semantics and f32 meaning, the
checking story per rule, generality, and a falsifiable experiment on the GB10.
**Inferred user intent:** A design that could be implemented and falsified by someone else, grounded in what this
framework actually provides — and honest about what it does not.
**Commit (code):** n/a at this step.

### What I did
- `src/framework/contracts/types.ts` — the v6 definition kinds (`AnalysisDefinition`, `PropertyDefinition`,
  `InvariantDefinition`, `TransformationDefinition`), `Assurance`, `CheckEvidence`, `PropertyFact`.
- `src/framework/contracts/differential.ts` — `differential(spec)`, `DifferentialSpec` (`inputs`, `baseline`,
  `subject`, `count`, `seed`, `cases`, `run`, `compare`, `inconclusive`, `decide`) and `DifferentialEvidence`.
- `src/framework/passes/define-pass.ts` — `applyPass`, `undeclaredWrites`, `semanticCorrespondence`.
- `src/typed/evaluate.ts` — `meaningKept` (`typed.meaning-kept`) and the `agrees` verdict.
- `src/typed/rules/verify.ts`, `src/typed/rules/form.ts` — `MethodName`, `Strength`, `RuleEvidence`, and `Rule` as
  frozen data (`lhs`/`where`/`rhs`/`because`/`note`).
- `src/typed/f32.ts` — the doc comment on f32 rounding ("one `Math.fround` of the exact double result", "never fuses
  a product and a sum"), `toBits`, `minmax`.
- `src/framework/ir/patterns.ts` — `NodePattern`/`PatternCondition`, i.e. what a framework rule can match.
- `grep -rn "tolerance\|f64\|relative error\|epsilon" src/` → one unrelated hit in `src/typed/rules/evidence.ts`
  (a fingerprint), no tolerance relation anywhere.

### Why
- The brief says the Tix meaning contract is being built in parallel, so the design must state the *requirement* on
  its relation rather than assume one. Reading `differential()` first showed that "domain / observation / relation"
  maps onto `cases` / `run` / `compare` with no new concepts, which let the design be concrete.
- Reading `verify.ts`'s `Strength` vocabulary before writing the checking section avoided inventing a parallel
  vocabulary: `proof | exhaustive | reduced-width+argument | sampled | by-construction` covers every case the four
  rules need.

### What worked
- The mapping is clean: `applyPass` → the gate; `DifferentialSpec` → domain/observation/relation; `Strength` →
  per-rule verdicts. Two of the design's five questions were answered by *pointing* at existing code.
- `src/typed/f32.ts` supplied the exact sentence the f32 meaning rests on for `+ - * / sqrt` ("53 ≥ 2·24 + 2"), and
  by omission the gap for `exp` (Step 4).

### What didn't work
- Nothing failed here; this was reading. (Recorded because the next step's first probe did fail.)

### What I learned
- The framework has no tensor domain and no tolerance relation; the design cannot cite either. It can cite the
  *shape* they will have.
- Rules in the existing workbench match value trees (`NodePattern` over an IR projection). Tensor rules match
  *statements* over an index space, so a tensor-rule form is new work, and the design says so (§11) instead of
  pretending the existing matcher fits.

### What was tricky to build
- Nothing yet.

### What warrants a second pair of eyes
- Whether the Tix meaning contract being built in parallel can take a *per-element scale* in its relation (§6.1).
  The design's fallback is stated, but it is weaker.

### What should be done in the future
- Re-read `differential.ts` and the Tix contract when the parallel build lands, and reconcile §6.1 with it.

### Code review instructions
- Start at `src/framework/contracts/differential.ts:1-60` (the `DifferentialSpec`) and `src/typed/rules/verify.ts:1-60`
  (the `Strength` vocabulary), then read the design's §2 (`grep -n "## 2\." design/01-*.md`).

### Technical details
- `applyPass` runs: diff, `undeclaredWrites`, meaning check, preservation of declared analyses, then publish.
- `differential()` fails a run with no decided case (`status: 'inconclusive'` → `ok: false`), which matters for the
  design's "the whole-program check is only a safety net" argument.

---

## Step 2: Derive the rule set on paper, choose four rules, and justify each omission

The mathematical core had to be settled before any probe, because the probe can only check a derivation that
exists. Two candidate rule sets were considered: a five-rule set with a separate `Join` (pairing several
aggregations over one index set) and a four-rule set with pairing folded into `Rebase`.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Same as Step 1.
**Inferred user intent:** Same as Step 1.
**Commit (code):** n/a.

### What I did
- Wrote the derivation as P0 → P1 (`Factor`) → P2 (`Fuse` ×2) → P3 (`Rebase`) → P4 (`Split`), and then checked what
  each arrow needed as a *premise*.
- Found that `Join`'s premise (two aggregations over one index set, in the extended language) only exists *after*
  `Rebase` has produced the fold, so a separate `Join` rule would apply only to a form `Rebase` already produces,
  and contributes one line of argument (`product of monoids`) and no independent evidence.
- Decided on four rules: `Split`, `Factor`, `Fuse`, `Rebase`.

### Why
- The brief asks for rules whose correctness argument is "local and mechanical". A rule whose premise is another
  rule's conclusion is neither: the check would have nothing of its own to verify.
- The alternative (five rules) is more orthogonal in appearance but weaker in substance; the design records the
  trade-off in §4.4/§7.1 rather than silently dropping the rule.

### What worked
- The two-set lemma (summary of a union = summary(K₁) ⊕ summary(K₂)) turned out to be the only non-trivial
  mathematics in the whole design, and it also gives associativity of the combine *for free* (the summary is a
  function of the index set). This is the argument that makes `Split` legal on a `fold`, so one lemma carried two
  rules.

### What didn't work
- First attempt at `Split`'s f32 verdict claimed bit-identity by "the order is preserved". Step 3's probe refuted
  it: preserving the *order of operands* is not preserving the *rounding sequence* when the reduce groups them.
  The claim in §4.1 is now the corrected one (max exact, sum and fold not).

### What I learned
- Associativity in ℝ does not transfer to f32 for anything that rounds. Every re-grouping rule must therefore state
  *which* of the two claims (real equality, bit equality) it makes, and they are different rules of evidence.

### What was tricky to build
- `Fuse` had to be given a *quality* side condition separate from its *correctness* claim: fusing a multi-use
  definition duplicates work, which is fine for an intermediate program of a derivation and would be wrong for a
  final one. The design says so explicitly (§4.3) because otherwise the derivation looks like it depends on a
  pessimation.

### What warrants a second pair of eyes
- The decision to fold `Join` into `Rebase` (§4.4, §7.1 last row). A reader may reasonably want the fifth rule.

### What should be done in the future
- If the rule engine is implemented, measure whether the `Join`-less `Rebase` premise is really decidable as one
  match, or whether an explicit `Join` makes the matcher simpler.

### Code review instructions
- The argument is §4.4's "two-set lemma" block; the decision record is §4.4 side condition (i)–(iv) plus §8.6.

### Technical details
- The lemma: for disjoint `K₁, K₂`, `M = max(M₁, M₂)`, `L_{K₁∪K₂} = L₁e^{M₁−M} + L₂e^{M₂−M}`, and the same for
  `T` componentwise; `exp(x+y) = exp(x)exp(y)` is the only property of `exp` used.

---

## Step 3: Probe the algebra and the f32 drift *before* writing them down — and get refuted twice

The design's numeric claims had to come from measurement, not from memory. Two probes were written:
`scripts/01-f32-and-exact-algebra-probe.mjs` (endpoints and conditioning) and
`scripts/02-derivation-stages-probe.mjs` (every intermediate program, over an abstract field, in exact rationals
and in f32).

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Same as Step 1, plus the brief's "Treat the Tix core below and its f32 meaning as
given" — so the probes must implement that meaning exactly (`Math.fround` per operation, `sum` from 0 in
increasing lexicographic order).
**Inferred user intent:** Same as Step 1.
**Commit (code):** n/a.

### What I did
- Probe 1: exact `BigInt` rationals with `exp` replaced by the multiplicative surrogate `3^x`; f32 attention
  (plain and streaming at several block widths) against an f64 reference; conditioning of the output contraction;
  the `Factor` rule in isolation; how often the rescale is the identity.
- Probe 2: five Tix programs P0…P4 written once over an abstract field `K` (`add`/`sub`/`mul`/`div`/`E`/`max`/`lt`),
  run in exact rationals (all must equal P0) and in f32 (per-stage drift, pairwise bit identity); `Split` in
  isolation on a plain 1024-term sum and a max.
- Ran both, saved outputs to `various/01-*.txt` and `various/02-*.txt`.

### Why
- Exact rationals with a surrogate exponential is the only way in this worktree to check *algebra* rather than
  *arithmetic*: the derivation uses exactly one property of `exp` (multiplicativity), so a multiplicative surrogate
  is a faithful test and `3^x` is exact on integers.
- Writing each intermediate program rather than only the endpoints is what makes the derivation checkable: a
  wrong middle step (e.g. dividing too early) would hide behind two endpoint programs that happen to agree.

### What worked
- **All intermediates are exact** vs P0, for B ∈ {1, 2, 3, N}. The derivation chain is real-algebra-correct.
- **`Fuse` and one-block `Rebase` are bit-identical** in f32 (`identical`, not "close") — which turned into the
  design's H4 control and into `Fuse`'s `proof` strength.
- **`Factor` and blocked `Split` are not bit-identical**, measured per stage.

### What didn't work
- Probe 1 crashed on its first run: `Error: exact probe feeds E only integers` at `E()` for N=6, D=3. Cause: with
  D=3, `sqrt(D)` is not an integer, so the scores were not integers and `3^x` was undefined. Fixed by choosing
  D ∈ {4, 9} (perfect squares) and making `q,k` multiples of `sqrt(D)` so `sum(d) q*k/sqrt(D)` stays integral.
- The f32 numbers that first came out were *raw relative* differences of 3.8e-2 … 7.5e-2, which looked like the
  derivation was destroying accuracy. Adding the conditioning measurement (`cond = Σ|terms|/|Σ terms|` up to 4.2e6
  for random `v`) showed the metric was measuring the data. The design was rewritten around a term-scaled error,
  and the raw numbers are now quoted *with* the warning (§6.3).
- A first draft of §6.3 cited "1.2e-7 scaled" for `Factor` alone, which I had not measured — it came from a
  different probe with different data. Replaced by the measured 3.08e-7 = 5.2·ε after extending probe 2 to
  compute the per-stage scaled error against the same reference.

### What I learned
- The unconditional f32 story is: **regrouping a rounding operation is never exact**, and the only exact rule in
  the set is the substitution rule. `max` is exact under regrouping only because it does no arithmetic.
- The derived program is *not* more accurate than the plain one: 5.0·ε vs 4.2·ε against f64 at N=1024, D=64.
  It is more *robust* (bounded state, no overflow). This is now stated in §6.3 as a finding, not glossed.
- Node 24.18.0 is fine for all of this (`Math.fround`, `BigInt` rationals); no library was needed.

### What was tricky to build
- The exact field had to be threaded through the *same* program text as the f32 field, otherwise the two runs are
  two different programs and the check proves nothing. Hence the `K` object with `of/add/sub/mul/div/E/max/lt/zero/
  one/negInf/sqrt`.
- `-∞` had to be representable in the exact field (`Symbol('-inf')` used only as the initial running max, never
  added to), while `alpha = 0` for the first block has to agree with `exp(-∞ - m) = 0`.

### What warrants a second pair of eyes
- The conditioning claim (that the raw relative metric is dominated by the contraction) rests on one measurement of
  `cond` per shape; a second draw would strengthen it (the design notes the instability, 3.8e-2 vs 1.3e-2).
- Whether `exact rationals + 3^x` really is a faithful proxy: it is faithful for *this* derivation, and only
  because the design states that multiplicativity is the only property used.

### What should be done in the future
- Add a probe for the mean/variance monoid instance of §7.1, which is "claimed, not checked".

### Code review instructions
- Run both scripts from the repository root:
  `node ttmp/2026/11/26/IRWB-021-O--*/scripts/01-f32-and-exact-algebra-probe.mjs` and `.../02-derivation-stages-probe.mjs`;
  compare to `various/01-*.txt`, `various/02-*.txt`. The exact-chain lines must read `EXACT` and the pairwise
  identity lines must read `identical` for P1==P2 and P1==P3.

### Technical details
- Probe 2's `K` fields: `exactK` (Frac + `3^x`) and `f32K` (`Math.fround`, `Math.exp`). P3 is `P5(..., B=N)`,
  P4 is `P5(..., B)`, P5 of the design is the lowering and is not a separate program (design §5.4).

---

## Step 4: Check the environment for GPU tooling, and state the experiment's measurements as predictions

The experiment section must not claim measurements that cannot be taken here. The worktree was checked for a CUDA
toolchain and the result written into the design.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Same as Step 1.
**Inferred user intent:** Same as Step 1.
**Commit (code):** n/a.

### What I did
- `nvidia-smi --query-gpu=...` → `command not found`; `nvcc --version` → `command not found`; `which ncu nsys` →
  nothing.
- Wrote §9.5 to say so, and §9.3 to record `compute_cap`/driver rather than assume the GB10's architecture.

### Why
- The brief names "an NVIDIA GB10 GPU" but says nothing about its compute capability, and the addendum for design
  work says to describe only what can be built/measured with the current setup. Guessing an SM number would be a
  fabricated fact in a measurement section.

### What worked
- The absence of a toolchain turned into a *useful* design point rather than a gap: the hand-written CUDA arm (c)
  becomes the measured noise floor for `expf` vs `exp` and for FMA contraction, which the design names as the
  platform-level f32 differences no rule is responsible for (`--fmad=false` is a stated backend requirement).

### What didn't work
- No GPU arms could be run at all. Recorded, not worked around.

### What I learned
- `src/typed/f32.ts` justifies `fround(double result)` only for `+ - * / sqrt`; `exp` is outside that argument, so
  the Tix meaning's `exp` is a *specified double-rounded* definition rather than a correctly-rounded f32 `exp`.
  This is a real semantic gap between the CPU meaning and any CUDA kernel and it belongs in the checking section,
  not in a footnote.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- H2's thresholds (≤ 5% of the unfused bytes, ≤ 1.5× the hand-written time) are chosen, not derived. They are
  falsifiable, which is what the brief asked for, but a reviewer should sanity-check them against real FlashAttention
  numbers on GB10 before the experiment runs.

### What should be done in the future
- Record the device facts and the arm (c) noise floor before running arms (a), (b), (d), (e), (f).

### Code review instructions
- §9.1–§9.6, in particular that §9.5 separates "measured here" from "to be measured on the host".

### Technical details
- `ncu --metrics dram__bytes_read.sum,dram__bytes_write.sum,gpu__time_duration.sum --kernel-name-base demangled
  --csv` is the metric set the design commits to (§9.3).

---

## Step 5: Write the design, then correct the numbers it got wrong

The document was written in one pass (~990 lines, twelve sections) and then re-read against the probe outputs,
which changed five numeric statements.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Same as Step 1.
**Inferred user intent:** Same as Step 1.
**Commit (code):** `15ee696` — "IRWB-021-O: research design - deriving streaming attention by checked rewrites".

### What I did
- Wrote `design/01-deriving-streaming-attention-by-checked-rewrites.md`: executive summary, the program and what
  "materialises N×N" means, what the framework already provides, the `fold`/`monoid` extension with its semantics
  and f32 meaning, the four rules, the derivation P0…P5 with an application table, the checking story (contract,
  per-rule strengths, measured drift, what is *not* checked), generality (reached / fails), alternatives, the
  experiment, risks, Later, evidence.
- Re-ran both probes with consistent rule labels (the scripts originally used an older R-numbering: R5 for `Fuse`,
  R4 for `Rebase`) and regenerated `various/*.txt`.
- Corrected: exec-summary drift numbers, `Factor`'s scaled error (5.2·ε measured, not the invented 1.2e-7), the
  per-stage scaled table, the `Split` argument's justification line (`e⊕f = f` is what licenses dropping each
  block's identity), and `Rebase`'s one-block sentence (there is exactly one rescale factor, not "0 then 1").

### Why
- A design document's numbers are its only falsifiable content; an unmeasured or mis-transcribed number is worse
  than none.
- Keeping the probe labels aligned with the document's rule names matters because the evidence files are meant to
  be read *against* the document.

### What worked
- `docmgr validate frontmatter --doc …` → `Frontmatter OK`.
- The final scaled table is the strongest single piece of evidence in the document: P1, P2, P3 all at 5.2/5.0·ε,
  P4 at 4.8/5.0·ε, plain P0 at 4.2·ε against f64 — i.e. the whole chain adds about one rounding and the stages
  after `Factor` add nothing measurable.

### What didn't work
- The first version of the per-stage table used raw relative numbers only, which made `Fuse` and `Rebase` look
  like they cost 3.8e-2 of accuracy when they are bit-identical. Fixed by adding the scaled column.

### What I learned
- "Bit-identical" and "same drift" are different claims and the document must print both columns, or a reader
  will conclude that a no-op rule costs accuracy.

### What was tricky to build
- Naming: the probe's `P4`/`P5` are the design's `P3`/`P4` (the design's `P5` is the lowering). Renamed the probe's
  *labels* rather than its functions and documented the mapping in the script header and in §12, so the evidence
  files read correctly next to the design.

### What warrants a second pair of eyes
- §6.1's relation (a per-element σ from the reference) is the design's most load-bearing proposal and the least
  verified: it is a requirement on a contract that does not exist in this worktree.
- §7.1's two "claimed, not checked" rows.

### What should be done in the future
- Verify the mean/variance instance; re-run the probes against the real Tix evaluator when it lands.

### Code review instructions
- Read §4 (rules), §5 (derivation), §6 (checking) in that order, with `various/02-*.txt` open beside §6.3.

### Technical details
- Evidence: `various/01-f32-and-exact-algebra-probe.txt` (45 lines), `various/02-derivation-stages-probe.txt`
  (34 lines), both regenerable from `scripts/`.

---

## Step 6: Ticket bookkeeping and commit

The ticket workspace was created with `docmgr ticket create-ticket`, the design and this diary were added, and the
work was committed on the current branch.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Same as Step 1 ("Create the ticket, write the design document, keep a diary, and
commit").
**Inferred user intent:** Same as Step 1.
**Commit (code):** `15ee696` — "IRWB-021-O: research design - deriving streaming attention by checked rewrites"
(the ticket's content, ten files; this step's own bookkeeping follows in a second `IRWB-021-O:` commit).

### What I did
- `docmgr ticket create-ticket --ticket IRWB-021-O --title "Deriving streaming attention by checked rewrites"
  --topics compiler,ir,verification,research,performance` (created under
  `ttmp/2026/11/26/IRWB-021-O--deriving-streaming-attention-by-checked-rewrites`).
- `docmgr doc relate` for the design's framework files; `docmgr task` entries for the design's open items;
  `docmgr changelog update`.
- Committed the ticket with `IRWB-021-O: …` messages. Not pushed.

### Why
- The docmgr conventions in this repository put file relations in the subdocument, not the index; the design doc
  therefore carries the six framework `RelatedFiles` and the diary carries the design and the probe script.

### What worked
- `docmgr doc search --query "tolerance"` finds nothing before this ticket and the design after it, which is the
  intended state.
- `docmgr doctor` reports no unknown topics (all five were already in `ttmp/vocabulary.yaml`).

### What didn't work
- Nothing.

### What I learned
- n/a.

### What was tricky to build
- n/a.

### What warrants a second pair of eyes
- The ticket's task list proposes follow-ups (the fold's type checker, the tensor rule form, the tolerance
  relation). Those are implementation tickets, not this one; they should not be counted as IRWB-021-O work.

### What should be done in the future
- Split the follow-ups into their own tickets when the Tix front end lands.

### Code review instructions
- `docmgr ticket list --ticket IRWB-021-O`, `docmgr doc list --ticket IRWB-021-O`,
  `docmgr doctor --ticket IRWB-021-O`.

### Technical details
- Ticket path: `ttmp/2026/11/26/IRWB-021-O--deriving-streaming-attention-by-checked-rewrites/`.
