---
Title: Research diary - measuring the cost of Tix's f32 meaning
Ticket: IRWB-023-G
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-source.ts
      Note: The emitter whose fixed schedule the experiments measure
    - Path: repo://src/tensor/contract.ts
      Note: The tolerance relation tested against the identity transformation
ExternalSources: []
Summary: Chronological record of the research round, including the three experiments that refuted my hypotheses.
LastUpdated: 2026-11-26T22:20:00-05:00
WhatFor: ""
WhenToUse: ""
---

# Research diary, IRWB-023-G

A research round: design and experiment, no product changes. Everything below happened in one session.

## 1. Reading the two prior tickets

Read `IRWB-020-B/design-doc/01` and `reference/02-report.md`, then `IRWB-022-I/design-doc/01` and
`reference/02-report.md`. The facts I carried forward:

- The f32 evaluator rounds at every operator, intrinsic, fold step, literal and shape conversion
  (`src/tensor/evaluate.ts`). `exact` compares f32 words; `tolerance` compares candidate f32 to origin f64
  with `2e-6 + 2e-5|r|`.
- Stage 1's seven-element witness separates the two relations: sequential fold gives 1, the `split-sum`
  rewrite gives 1.000000238418579, f64 gives 1.0000001788139343.
- Stage 2 emits one kernel per statement, one thread per output element, and checks the lowering against the
  current revision in f64 with a tolerance. Its own "what I would do differently" already says the relation
  should be f32 equality with NaNs compared by class.
- Stage 2's numbers: matmul 512³ 0.197 ms, softmax 0.785 ms, layernorm 0.563 ms, attention 1.81 ms,
  mlp 1.05 ms, conv2d 0.341 ms, single runs with up to 2× variance.

First hypothesis: the stage-2 gap to cuBLAS (6×) is mostly *not* arithmetic, it is memory traffic and launch
structure. I decided to test that instead of assuming it, and to test the meaning's price separately.

## 2. The first experiment went sideways, and that became a result

I wanted to prove the tolerance relation unsound by finding an input where `split-sum` exceeds the budget.
Reading `src/tensor/contract.ts` gave a better lever: `meaningGate` is exported, so I could run the real
gate with the **origin as its own candidate**. Any error it reports is then the program's own f32 rounding,
not a rewrite's.

`scripts/01-gate-on-identity.mjs` (built with `npm run build`, run time 0.94 s) gave identity budget
fractions of 2.9e-2 (matmul), 4.6e-3 (softmax), 1.3e-2 (layernorm), 1.5e-2 (attention), 3.2e-2 (mlp),
2.5e-1 (conv2d), with `split-sum` fractions of the same size (max 2.3e-2 for a rewrite-attributable change on
layernorm). Then `scripts/02-reduction-length.mjs` pushed reduction length from 7 to 448 terms using a legal
program `fn longred(x: f32[N,C], w: f32[N,k*C])` — the identity fraction stayed in 8e-3…1.35e-1 and was
never rejected.

So the falsification failed: the gate accepts the identity even at 448 terms. I recorded instead what the
numbers do say, which is a sensitivity critique: the program's own rounding consumes 1.3e-2…2.5e-1 of the
budget, and the largest rewrite-attributable signal I could find is 2.3e-2, i.e. the same order. The relation
gates the total error, which mixes a rewrite property with a program property.

Decision: keep this as a result, state it as a limitation of the relation rather than a soundness bug, and
turn it into proposal P2's "gate the delta, not the total".

## 3. The exact-sum oracle, which inverted the accuracy story

Cheap idea with a big payoff: every f32 is a dyadic rational, so a sum of f32 values is exact in `BigInt`
scaled by 2⁻¹⁴⁹, and the correctly rounded f32 sum is then one round-half-even step.
`scripts/08-correctly-rounded.mjs` implements it (decode, exact accumulate, round to 24 bits, encode).

On the Stage 1 witness the correctly rounded value is 1.000000238418579 — **the value the `split-sum`
rewrite produces**, not the value the specified sequential fold produces. The rewrite Tix labels a
relaxation is the accurate one.

Random study (400 trials per small cell, 60 at n=1024): sequential equals the correctly rounded sum in
144/400 at n=16 and 3/60 at n=1024 (positive stream), against 47/60 for a pairwise tree; worst relative
error 1.1e-6 sequential versus 6.8e-8 tree. The order Tix pays the most to preserve is the least accurate.

Decisions: this becomes P4 (order-independence by exactness) as a research bet, and it sharpens P2 — the
"price list" needs a row for reduction order, whose price is *negative* in accuracy terms.

## 4. The GPU work

`tools/cuda-remote.mjs` round trips are 2–7 s, so I wrote three self-contained `main.cu` programs rather than
iterate. Two compile errors in the first (`cudaDeviceProp::clockRate` is gone in CUDA 13; a wrong index for
the B-tile float4 staging, `f>>2` where 32 float4s per row require `f>>5`). Both fixed in one round trip each.

**04-gemm-cost** measured three things in one process: the MAC issue rate, a tiled SGEMM in two MAC forms,
and cuBLAS through `dlopen` (I could not add `-lcublas` to the fixed nvcc command line, so `dlsym` was the
way to get a vendor reference on the same machine).

First run printed 204.9 TFLOP/s for FFMA. That is 8× too high: the flop count multiplied by eight twice
(`2 * blocks * 256 * 8 * 8 * iterations`). Corrected to 25.62 TFLOP/s FFMA and 13.73 TFLOP/s mul+add,
ratio 1.866 — which matches 48 SMs × 128 FP32 lanes × 2 × ~2.08 GHz, so the microbenchmark is calibrated.
**Lesson: sanity-check flop counts against the machine's known peak before reporting a ratio.**

**05-check-gemm-bits** closed the loop: the 128³ input and output dumped from the GB10, re-evaluated by the
Stage 1 f32 interpreter, 0 of 16,384 words differ. The interpreter took 521 ms, i.e. ~40× faster than my
estimate from stage 1's 512³ wall time, which is why a 512³ check would also have been affordable. I did not
run one (time).

**06-fusion** was the riskiest to write and the most informative to read. I implemented six schedules. Two of
them refuted my hypotheses:

- layernorm fused with one thread per row: 0.76 ms, **0.67×** the materialised version (I predicted 1.5×
  from a bytes argument). Cause: uncoalesced rows and only 4,096 threads.
- softmax fused with recomputed exponentials: 2.36 ms, **0.34×**. Cause: the exponential is 122× more
  expensive in Tix's meaning than `expf`, so recomputation costs more than all the memory the fusion saves.

Both losses pointed at the same missing term in my cost reasoning — transactions and transcendental count,
not bytes. I then wrote the schedule the model actually recommends (block stages 8 rows in shared memory,
coalesced I/O, the row owner still folding sequentially) and got layernorm 0.135 ms = 3.79× at 248.6 GB/s
(the machine streams at 244 GB/s, so this is the memory bound) and softmax 0.601 ms = 1.34×, with 0
differing words in both. Time spent on that second iteration: about ten minutes. Worth it: it converted a
refutation into a design principle.

**07-exp-sweep** came from a throwaway question — if a whole f32-domain sweep of an intrinsic is cheap, the
sampled case list is a choice, not a necessity. It is cheap: 2.71 s for 2³² inputs × 3 intrinsics × 2
formulas, i.e. 0.90 s per intrinsic, and `exp`/`log` agree between two independent double formulas on all but
**one** input out of 4.29e9. The `tanh` row (1.6e9 disagreements) is my own alternative overflowing for
|x| > 355; I kept it in the write-up because it shows the sweep detects a bad formula and because it proves
the tanh clause needs a *specified* formula.

## 5. Turning measurements into proposals

The spine came late and was the most valuable half hour: state the meaning as a per-value **rounding trace**,
prove that materialisation (Prop. 1) and recomputation (Prop. 2) are trace-neutral *because* the value is
already f32, and conclude that the entire schedule space is sound by construction. That reframes the round:
the stage-2 slowness was never the meaning, it was an unscheduled graph plus a hard-coded plan. It also
explains why the naive fusion *is* semantically free and *still* slow — the propositions say nothing about
cost.

Ranking followed from the definitions: P1 (schedule, measured 2.06×/3.79×/1.34×) first because it moves two
axes and needs no semantic change; P2 (price list, 1.87×/1.40×/122×/1.0×) second because it turns the
meaning from a monolith into a budget; P3 (check the check, 0.90 s exhaustive) third because it upgrades the
evidence without changing what is compiled; P4 (exact sums) last because I did not measure its cost, and I
said so in the document.

## 6. What I would do next, in order

1. Run the SASS check (does `nvcc -O3` keep two FP32 instructions for `__fadd_rn(acc,__fmul_rn(a,b))`?). It is
   fifteen minutes and it bounds both P1 and P3.
2. Measure an exact accumulator's ns per term on the GB10, the number P4 lives or dies on.
3. Sweep one candidate compensated f32 `exp` over 2³² inputs. If it matches `fround(exp(x))` everywhere, the
   transcendental clause can be replaced and softmax gets 45% of its time back (P2's biggest prize).
4. Add conv2d implicit GEMM and attention two-pass to the plan zoo and test the cost model's ranking.

## 7. Time used

Roughly: 25 min reading the two prior tickets and the source, 20 min on the gate and reduction-length
experiments, 15 min on the exact-sum oracle, 45 min writing and debugging the three CUDA programs across six
remote runs, 20 min on the proposals and diagrams, 40 min on the design document, 10 min on this diary.
