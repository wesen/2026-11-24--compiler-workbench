---
Title: Research diary: experiments, decisions and failures
Ticket: IRWB-023-I
Status: active
Topics:
    - compiler
    - verification
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-023-I--best-in-class-for-tix-certified-numerics-performance-and-priced-relaxation/scripts/05-gpu-bench.mjs
      Note: GB10 bench generator, correctness and timing driver
    - Path: repo://ttmp/2026/11/26/IRWB-023-I--best-in-class-for-tix-certified-numerics-performance-and-priced-relaxation/prototype/bench/main.cu
      Note: Generated translation unit with stage-2 baselines and prototype kernels
    - Path: repo://ttmp/2026/11/26/IRWB-023-I--best-in-class-for-tix-certified-numerics-performance-and-priced-relaxation/results/bench-correctness.json
      Note: Word-comparison results per config
ExternalSources: []
Summary: Research loop for IRWB-023-I with experiment evidence, GPU trips and failures.
LastUpdated: 2026-11-26T23:10:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Research diary

## Step 1. Ticket opened; design v1 committed

I read the Stage 1 (IRWB-020-B) and Stage 2 (IRWB-022-I) designs and reports, the tensor sources (`model.ts`, `evaluate.ts`, `passes.ts`, `cuda-source.ts`, `contract.ts`, `cuda-contract.ts`, `cuda-runtime.ts`), the corpus fixtures, and the `cuda-remote.mjs` header. I created ticket IRWB-023-I with `docmgr`, wrote the design document v1 (definition of best in class as *certified throughput*, three ranked proposals, the exactness-calculus table, staged plan) and committed it as `d227f21`.

### Prompt context

<details>
<summary>User prompt, verbatim (abridged to the operative parts; full text in the session)</summary>

You are working in a git worktree of the IR Workbench repository … Your ticket is IRWB-023-I. This is a **research round: design and experiment, no changes to the product code.** … What compiler work would make Tix best in class? "Best in class" is yours to define and defend. … Proposals ranked; theory; what is new; evidence from experiments I design and run, including ones that refute the idea; risks; success measures; what it needs from `src/framework`; a staged plan; what did not work. Deliverables: ticket with `design-doc/01-….md`, a diary, commits starting `IRWB-023-I:`. Do not push. Do not change `src/`, `tests/`, `corpus/`, `tools/`.
</details>

## Step 2. E1: exact-f32 references and interpreter cross-validation

`scripts/01-references.mjs` builds purpose-built exact-f32 references for matmul 512³, softmax 4096×1024, layernorm 4096×1024 (+f64 variants for matmul/softmax for budget checks) and attention 1024/64/64, mirroring the meaning per operator (every node `Math.fround`, sequential folds, +0/−∞ inits, double-path exp). It cross-validates each reference against the real `runTix` f32 interpreter at interpreter-feasible sizes: 0 word mismatches for all four (matmul 64×80×48, softmax 128×64, layernorm 64×32, attention 16/24/8/12). Reference generation at full size: 0.3–1.1 s each — the interpreter is not needed at production size.

Failure recorded: I first passed a file *path* to `compileTix` (it takes source text); the parser error `1:1 Expected fn` and a wrong relative-import depth cost two debug rounds. Both fixed; lesson recorded.

## Step 3. E5: where the check cost goes

`scripts/02-check-cost.mjs`, per corpus program: parse 0.6–4.0 ms; `optimizeTix(['inline'])` 0.5–16.9 ms; `optimizeTix(['inline','split-sum'])` 3.4–23.0 ms; the sampled exact gate alone 2.3–10.8 ms — except **conv2d: 629.3 ms exact gate, 470.8 ms tolerance gate** (interpreter-dominated: 4-deep loop nests per case). A bare pass with a stub gate is ~1 ms. Conclusion: local sampled gates are cheap except for deep-nest programs; the dominant check cost is the remote CUDA check (≈2.5 s average, per Stage 2). A structural certificate would replace the *interpreter and round-trip*, and for conv2d also the 0.6 s local gate. Results in `results/check-cost.json`.

## Step 4. E7: the sampled gate's blind spot — refuted my first hypothesis, then refined

My first hypothesis was that error growth in long sums escapes the 4096-element sampling cap and would make a production-size budget check reject *correct* lowerings. `scripts/03-blind-spot.mjs` tested sequential vs width-4-split f32 sums against f64 on the half-ULP stream `[1,0,0,0,2^-24,2^-24,2^-24]` up to K = 2^20: **the budget holds at every K** (error grows linearly with K, but the relative budget term tracks |r|, which grows faster because the stream's 1s accumulate). The size-cap hypothesis is **refuted for this stream family**.

The refined finding: the check's validity rests on the *stream* choice, not the size cap. Cancellation inputs inside the sampled size class — `[2^24, 1, −2^24]`, K=3 — give f32 = 0 vs f64 = 1: the stage-2 tolerance relation would reject a bit-identical, correctly lowered program. So a production-size check must inherit the stream family (and its exclusions), not just the sizes. Recorded in `results/blind-spot.json`.

## Step 5. E8: max/min reassociation is exact; sum is not

`scripts/04-max-reassoc.mjs`: 2000 random f32 multisets (n = 2..61, with NaN, ±0, ±∞, magnitudes to 1e30), 50 random evaluation trees each, word-compared against the sequential fold under the specified semantics (NaN-propagating; mixed-zero rule AND for max, OR for min). **max: 0 mismatches in 100,000 tree evaluations; min: 0 in 100,000; sum: 80 mismatches in 5,250** (1.5%). This is the empirical basis for the `max-reassoc` exact class: warp-tree max reductions preserve the meaning bit-for-bit; sum reassociations do not and stay budget-tier.

## Step 6. E0/E2/E3/E4/E6: the GB10 prototype bench

`scripts/05-gpu-bench.mjs gen|check|time` assembles `prototype/bench/main.cu`: the **real stage-2 emitted kernels and host code** for matmul, softmax, layernorm and attention are extracted from `cudaSource` (kernel blocks renamed `k<i>` → `<prog>_k<i>`, `run_case` → `run_case_<prog>`, emitted `main` dropped) and driven through the real TIXCUDA1 request format; my prototype kernels are appended with my own driver. One `bench.bin` (112 MB, seeded inputs from E1) is the `--runtime-input`.

Device facts measured this round: **NVIDIA GB10, sm_121, 48 SMs, clock attribute 2418000 kHz, sharedMemPerBlockOptin 101,376 B, regsPerBlock 65536, CUDA 13.0.88.**

Debug trail (each step a remote trip, compile ~2.5 s when sources changed, cached otherwise):

1. `const char magic[8] = "TIXCUDA1"` (9 bytes with NUL) — compile error; → `magic[]`.
2. The emitted `int main` was accidentally included in the support paste → duplicate `main` — fixed by skipping `int main` blocks in the extractor.
3. `prop.clockRate` no longer exists in CUDA 13 — replaced with `cudaDeviceGetAttribute(cudaDevAttrClockRate)`.
4. `fread(dims.data(), 4, rank, f)` packs two u32 into one int64 — reproduced locally with g++ (`dims[0] = 0x20000000200`); fixed by reading u32s and widening.
5. My synthesized TIXCUDA1 request included magic+count+rank, which the emitted `run_case` does not read (its `main` does) — softmax's single parameter masked the layout bug until layernorm; fixed to interleaved shape+data per tensor.
6. `Kd` bound to `shapes[0][1]` (D=64) instead of `shapes[1][0]` — the attention weight buffer was 16× too small → `illegal memory access`; fixed (`Dd`/`Kd` split).

Correctness (word-comparison vs E1 references at production size), `results/bench-correctness.json`:

| config | mismatches / elements | note |
|---|---|---|
| mm_base_rn (stage-2 kernel) | 0 / 262,144 | harness validated against the known-good lowering |
| mm_base_fma (contraction on) | 222,009 / 262,144 (84.7%); maxAbs 9.5e-6; **321 elements (0.12%) exceed the stage-2 budget, worst 4.4×** | FFMA is not the meaning, and at this size even the budget tier would reject plain FFMA |
| mm_smem_rn (shared-staged naive) | 0 / 262,144 | exact |
| mm_rt32_rn (register-tiled 4×4, sequential k, rn) | 0 / 262,144 | **exact** |
| mm_rt32_fma | (fma column above applies) | budget tier |
| sm_base (stage-2, 4 kernels) | 0 / 4,194,304 | |
| **sm_fused_exact** (warp/row, tree max, lane-0 sequential sum, double exp) | 0 / 4,194,304 | **exact** |
| sm_fused_tree (warp-tree sum) | 3,853,915 words differ; maxAbs 3.5e-9; worst 2.0e-4× budget; 0 budget failures | passes budget with ~5000× margin |
| sm_fused_expf | 1,660,895 words differ; maxAbs 9.3e-10; worst 1.7e-3× budget; 0 failures | passes budget with ~600× margin |
| ln_base / **ln_fused** | 0 / 4,194,304 both | fused layernorm **exact** |
| attn_base | 0 / 65,536 | |
| **attn_fused** (fused score+softmax kernel + tiled GEMM) | 0 / 65,536 | **exact** |

Timing (median of 20 event-timed reps under `--timed`; baselines = the real emitted host's median-of-3, best of 5):

| config | median ms | speedup vs stage-2 baseline | certified rate |
|---|---|---|---|
| mm_base_rn 512³ | 0.2131 | 1× | 1.26 TFLOP/s |
| mm_base_fma | 0.2131 | — (memory-bound: contraction is free here) | — |
| mm_smem_rn | 0.1848 | 1.15×, exact | 1.45 TFLOP/s |
| **mm_rt32_rn** | **0.0763** | **2.8×, exact** | **3.52 TFLOP/s** |
| mm_rt32_fma | 0.0662 | 3.2× | 4.05 TFLOP/s (rn price: 15.2%) |
| sm_base | 0.7949 | 1× | 40 GB/s |
| **sm_fused_exact** | **0.3987** | **2.0×, exact** | 80 GB/s |
| sm_fused_tree | 0.3974 | 2.0× (budget tier buys nothing here) | — |
| sm_fused_expf | 0.1334 | **6.0×** (budget tier: expf) | 240 GB/s ≈ streaming |
| ln_base | 0.4836 | 1× | 66 GB/s |
| **ln_fused** | **0.1733** | **2.8×, exact** | 185 GB/s |
| attn_base | 1.0492 | 1× | 0.26 TFLOP/s |
| attn_fused | 0.8329 | 1.26×, exact | 0.32 TFLOP/s |

Big-tile run at 4096³ (timing-only, uninitialized buffers): mm_rt32_rn 34.19 ms (4.02 TFLOP/s), mm_rt32_fma 33.02 ms (4.16 TFLOP/s) — my 32×32 tile schedule is L2-bound at this size; the rn/fma gap shrinks to 3.5%. cuBLAS's 19.2 TFLOP/s FFMA reference stands 4.6× above my *schedule*, not above exactness.

Interpretation written into the design doc: (a) the exact tier is not a small constant factor — tiling + replication + order-free max get 2–2.8× at bit-exactness with **zero** sampled-gate surprises; (b) the double-precision transcendental is the *meaning's* price in softmax (0.27 ms of 0.40), and `expf` is the single most valuable budget-tier relaxation measured (3× more); (c) sum reassociation (tree) bought nothing at these shapes — the first budget-tier candidate I would *not* ship; (d) attention needs k-staging in shared memory (the 268 MB L2 traffic estimate explains the 0.83 ms), which is the next schedule pass to prototype.

## Step 7. Write-up

Design doc updated with the results tables, the certified-throughput table (before/after), risks, staged plan and the refuted hypotheses. Commits stay on `r2b-gf-max/irwb-023-i`; no push.

## Step 8. E5b: the certificate checker, actually built

`scripts/06-certificate.mjs` implements the `substitute`-class certificate for inline: a lockstep walk of the before/after expression trees (modulo a renaming of after-side binder identities to before-side ones), allowing divergence only at load sites of removed single-use pointwise producers and requiring the substituted producer tree there. Measured: holds on the real inline candidates of all six corpus programs in 0.04-0.54 ms; accepts a hand-built correct inline; rejects the identity-order mutant and a duplicated-tree mutant with precise structural reasons.

Failure recorded: the first version compared raw binder identities and rejected the *correct* control — binder ids are assigned per parse (`i0, i1, ...` in statement order), so structural equality must be modulo alpha-renaming. Fixed by pairing binder ids by occurrence during the walk; the lesson generalizes to any structural certificate over this IR.
