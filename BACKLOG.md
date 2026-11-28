# Things we can work on: the v6 framework and the workbench

A worklist of research tasks and fixes for `src/framework/` (the v6 IR framework), the Typed → RV32 domain, the tensor domain, and the workbench. Each entry records:

- **what we know:** measured facts, with where they come from;
- **what we don't know:** the research the item needs;
- **approach:** the first steps;
- **measure:** how success is decided;
- **depends on:** what must come first.

Keep it current: update an entry when a round finishes, move items between statuses, and link the ticket when one is opened.

**Status:** _running_ (agents are on it), _ready_ (it can be briefed now), _prep_ (the coordinator must build something first, such as a benchmark or a held-out set), _decision_ (it needs the user's call), _idea_ (not yet sized).

**Size:** S = one agent-session; M = a design plus an implementation round; L = several stages.

## Index

| ID     | Item                                                                        | Status                                                                | Size   |
| ------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| T1     | Tix front end, IR, evaluators, contract, two passes                         | done (IRWB-020-B merged, `98b04da`)                                   | M      |
| R1     | research: derive streaming attention by checked rewrites                    | done (design only; a ceiling)                                         | M      |
| T2     | CUDA lowering, one kernel per statement, run on the GB10                    | done (IRWB-022-I merged, `2e035c6`)                                   | M      |
| T3     | checked fusion                                                              | done (IRWB-029-D merged, `b53cded`..`e9c6ba2`; nine cells, all exact) | M      |
| T3b    | parallel terms, serial fold, and a cost gate for fusion                     | done (IRWB-030-E merged, `49cb9c7`; all exact, nine never slower)     | S–M    |
| T4     | tolerance calibration with mutants                                          | queued 4th (before the tolerance-checked stages)                      | M      |
| T5     | implement the streaming-attention derivation                                | queued 8th                                                            | L      |
| T6     | exact tiled contractions with a schedule IR, against cuBLAS                 | done (IRWB-033, ten cells); hidden evaluation running, merge pending  | M–L    |
| T7     | autotuning under noisy GPU cost                                             | queued 7th                                                            | M      |
| T8     | ONNX importer into Tix                                                      | idea                                                                  | M      |
| T9     | a GPU timing protocol                                                       | prep, queued 2nd (coordinator, during T3)                             | S      |
| T10    | parallel reductions and split-K, by lowering split-sum programs             | queued 5th                                                            | M      |
| T11    | checked FMA contraction                                                     | queued 6th                                                            | M      |
| T12    | tensor cores as a checked precision change                                  | queued 9th (last)                                                     | L      |
| R2     | research round: what would make Tix best in class (Sol, Astra, Opus, Fable) | done (IRWB-023; ideas below)                                          | M      |
| T13    | exhaustively verified fast intrinsics (`exp`, `tanh`)                       | idea, from R2                                                         | M      |
| T14    | a parallel fold that is bit-identical to the sequential one                 | idea, from R2                                                         | M      |
| T15    | acceptance by proof: normal-form equivalence and symbolic fingerprints      | idea, from R2; with F21                                               | M      |
| D1     | why `speed` slows the bytecode VM                                           | done (IRWB-034; Fable merged)                                         | S–M    |
| D2     | missed optimizations from provenance                                        | done (IRWB-037; Fable merged, `speed` corpus −9.0%)                    | M      |
| B1     | specialize the VM on its bytecode                                           | done (IRWB-036, seven cells); merge pending (Opus the candidate)      | M–L    |
| B2     | specialize Candela on its scene buffers                                     | idea                                                                  | L      |
| A0     | measure: share of edits that are local value rewrites                       | done (IRWB-035, seven cells); merge pending                           | S      |
| A1     | e-graph over value trees with verified rules                                | decision                                                              | L      |
| C1     | calibrated gate                                                             | prep                                                                  | M      |
| E1     | incremental checking per function                                           | prep                                                                  | L      |
| F1–F39 | framework and workbench fixes found by agents                               | 16 open (F1, F7–F12, F15, F18, F22, F28–F32, F39); F27, F33–F38 done (v7-p1) | S each |
| M1–M5  | agent methodology                                                           | running / ready                                                       | —      |

---

## 1. Tensor track (IRWB-019)

The question behind the track: `src/framework/` has carried one domain, Typed, and its generality is untested. Tensor programs differ in every way that should stress it: values are shaped arrays, legitimate optimizations change floating-point results, the fast engine is a remote GPU, and the cost (GPU time) is noisy. The primary result of every stage is the list of changes `src/framework` needs, each with its reason.

Shared facts:

- **The GPU machine:** `ssh manuel@bling` (Tailscale; `bling.local` resolves only on the home LAN), an NVIDIA GB10 (sm_121, 121 GB unified memory, aarch64) with CUDA 13.0 `nvcc`, and no torch. The laptop has no NVIDIA GPU.
- **The runner:** `tools/cuda-remote.mjs <dir> [--timed]` copies a directory holding `main.cu` to the machine, keyed by content, so identical inputs compile once (about 0.5 s). It brings `out/` back. `--timed` runs under a GPU lock.
  - A sandboxed Codex agent needs `-c sandbox_workspace_write.network_access=true` to reach the machine.
- **The language,** Tix, fixed in the T1 brief: five constructs (shaped parameters, pointwise expressions, `sum` and `max` over named indices, single assignment, affine indices). Its f32 meaning is exact: every operation is rounded, and reductions accumulate in lexicographic index order.
- **The structure Tix exposes:** `torch.export` of a transformer block gives 40 Core ATen nodes, 26 of which are `view`, `permute` or `expand`. In Tix these are index renamings and do not appear.
- **Reference speeds on the GB10** (IRWB-019 diary step 26, `various/eff-probe/main.cu`; median of 20 event-timed runs under the lock):
  - cuBLAS SGEMM in FP32 math (pedantic, so no TF32): 0.0329 ms at 512³ (8.15 TFLOP/s), and 19.2 TFLOP/s at 4096³;
  - streaming bandwidth: 244 GB/s.

### Direction from T6 on (the user, 2026-11-27)

The user asked for "T6 level work, and working on additional IRs and innovative approaches". T3 and T3b put every lowering decision in a plan and an emitter: nineteen cells changed nothing in `src/framework`, and only one built a second IR. From T6 on, the stages ask for compiler structure, not only speed:

- new IRs as v6 artifacts, with each lowering step a checked pass;
- legality from the IR;
- new approaches tried and reported, including negative results.

The cells run under policy v3r (`prompts/developer-instructions-v3r.md`). It is v3 with two rules changed: try the invited approaches instead of preferring the smallest deliverable, and describe new IRs and passes built in the session. The IR-level items are T6 (schedule IR), T14 (a parallel fold bit-identical to the sequential one), T5 (a fold construct with a tuple state, from R1), T10 (reassociation as an IR rewrite), T15 (acceptance by proof), and on the Typed side A1 (an e-graph with verified rules).

### Framework first, grounded in theory (the user, 2026-11-27)

"allow tix to make use as much as possible of existing framework concepts, buildng machinery on its own is a smell that needs bringing to the surface. and the framework should be based on fundamental theory (compiler theory, etc...) such that its machinery is as domain independent and can be reused in many different cases."

- **A domain uses framework concepts wherever they exist:** analyses through `defineAnalysis` and pass `needs`, edits through IR transactions and correspondence, rewrites through patterns and schedules, pipelines through strategy plans. Machinery a domain builds for itself is a finding, reported as such, never an unremarked convenience.
- **Where the framework lacks a concept, the fix goes in the framework,** stated in its standard theory (lattices and fixpoints, dependence analysis, rewriting and confluence, translation validation, abstract interpretation), domain-independent, with a second use named or planned.
- **Evaluation counts it:** from T6 on, each implementation's review lists the mechanisms it built inside the domain that duplicate or should be framework concepts (F28's method), next to correctness and speed.
- Items: F27 (sync passes in strategies), F28 (the reuse audit of `src/tensor`), F29 (affine dependence analysis in the framework).
- **Policy v4** (`prompts/developer-instructions-v4.md`) is v3r plus three rules saying this, for every stage launched after T6 and the first Typed round (which were already running under v3r).

### R3: what forty implementations say about the framework _(done: IRWB-038 A–D and a synthesis, 2026-11-27)_

Four design-level reviews (Sol, Astra, Opus, Fable), verified and merged by an Opus synthesis: the vault report "What Forty Implementations Say About the Framework – R3 Synthesis", and the page https://claude.ai/artifact/GJoGirJU2XaKCR83mvcQAQ. 24 claims probed, 19 held. The outer shell held (revisions, adapters, contracts, caching, the batched differential, strategy plans); the inner model of a transformation did not. The target ("v7"):

- one typed transformation `eligible → prepare → obligations → publish`;
- a derivation written by the pass;
- evidence as relation × method × scope;
- staged publication;
- one runner with two drivers;
- decisions as data.

Below the core, a standard library of about twenty primitives, each admitted with two clients. Its first moves are F34, F33, F27 (restated) and F32, then the migration in `various/r3-synthesis/`.

### Queue (tensor track, in order)

The path from T2's naive kernels toward library speed. Each step is a stage for the agent matrix unless marked as coordinator work. Every transformation that changes results is an explicit IR pass checked under tolerance, so the lowering stays exact against the program it receives. Speed and the strength of the claim are both measured.

1. **T3, checked fusion** (done, with T3b).
2. **T9, a GPU timing protocol** (the coordinator, while T3 runs): needed before any speed comparison is trusted.
3. **T6, a schedule IR with checked scheduling passes, and exact tiled contractions through it:** tile, split, reorder, bind, stage, vectorize and double-buffer as passes; order-preserving, so bit-exact; against cuBLAS. Brief: `prompts/t6/common.md`.
4. **T4, tolerance calibration with mutants,** with F15's derived bound: T10–T12 all rest on tolerance, which must still reject real bugs.
5. **T10, parallel reductions and split-K:** lowering `split-sum` programs to block- and warp-parallel sums.
6. **T11, checked FMA contraction:** the last factor of about 2 to cuBLAS on large matrices.
7. **T7, autotuning** of T6's tile sizes under noisy cost.
8. **T5, streaming attention** (R1's derivation), on T3's fusion and T6's tiles.
9. **T12, tensor cores** (TF32, BF16) as a checked precision change.

T8 (ONNX) is not queued.

### R2: what compiler work would make Tix best in class _(done: IRWB-023 A–D; IRWB-019 diary steps 27–31)_

- **Result:**
  - The judges' family effect (+1.5 and +1.75 of 10) exceeds every model difference (≤ 1.0 on the cross-family mean: Astra 8.0, Opus 7.5, Fable 7.25, Sol 7.0).
  - Both judges find more errors in the Claude designs, and rate Sol least creative.
  - Every load-bearing experiment I reran reproduced.
- **Ideas for the queue,** with their evidence:
  - **Exact row fusion (feeds T3):**
    - Sol emitted certificate-checked rows (softmax 1.98×, layernorm 2.48×).
    - Opus generated rows from the IR (softmax 4.44×, layernorm 2.46×; a planner at 3.19× geometric mean on five programs).
    - Astra's softmax with a fitted `exp` is 4.25×.

    All are bit-identical to stage 2.

  - **Exact tiling (feeds T6):** 0.054–0.058 ms at 512³ in three cells; 1.6–1.75× cuBLAS.
  - **T13, exhaustively verified fast intrinsics:**
    - Opus's `exp` and `tanh` fast paths have a rounding test and a double fallback: 0 mismatches over all 2³² inputs, reproduced; 2.4× and 4.9× faster.
    - Astra fits one binary64 table coefficient by interval intersection, with refutation witnesses, and certifies the deployed binary by digest against Node.
  - **T14, a parallel fold identical to the sequential one:**
    - Fable's parity transducer: inside one binade, a rounded add depends on the accumulator only through its parity, so a chunk has a two-entry summary.
    - Astra's even-translation certificate.

    Neither judge found a published version. It wins on long rows and loses at the corpus's 4096 × 1024.

  - **T15, acceptance by proof:**
    - Fable's normal-form equivalence for exact passes: 60 lines, rejecting the F21 mutant.
    - Opus's symbolic fingerprints: the same kernel source at a hash type, with residue-complete shapes.
  - **For T11:** Opus's exact FMA reference for the interpreter. `Math.fround(a*b + c)` fails all 65,536 constructed near-midpoint cases.

### T1: Tix front end, IR as a v6 artifact, evaluators, contract, `inline` and `split-sum` _(done: IRWB-020)_

- **Result:** fourteen independent implementations (twelve Codex and Pi cells, two Claude cells), all correct.
  - All agree bit for bit with an independent tree-walking reference on 180 random cases, and with f64.
  - Every `inline` result is bit-identical, and every accepted `split-sum` is correct.
  - Twelve pass the frozen hidden suite 25/25. The two Claude cells pass 22/25: they forbid an index named like a tensor, a rule the brief leaves open. They pass 25/25 on the variant that renames that index.
- **Merged:** IRWB-020-B (Codex, Astra, medium) at `98b04da`, chosen by: every check passes, then the smallest framework change (+85/−27), then the smallest source (917 lines). Full suite after the merge: 411 pass, 0 fail, 3 skipped. Its report is vault report 12.
- **What separates the implementations is the tolerance.** Some reject a correct `split-sum` on random programs where it applies: K 5/32, E 1/32, H 1/32. There are two causes:
  - a fixed abs+rel bound compared against the origin's f64, with no allowance for the origin's own f32 error on ill-conditioned sampled cases (E, H);
  - zero-size sampled extents producing matching infinities that the gate treats as a mismatch (K).

  The merged base uses the same fixed bound (2e-6 + 2e-5·|r|) and accepted everything only because its sampled domain avoided those cases. See F15.

- **Framework changes:** every implementation adds a synchronous checked application for native-result passes (B: `applyNativePassSync` in `passes/define-pass.ts`). Only four of fourteen also made `applyPass`'s edit lazy (F13). The differential contract needed no change.
- **Material:** IRWB-019 diary steps 8–18, `various/hidden-t1/`, `various/results/`; report 11 §5–§7.

### R1: deriving streaming attention by checked rewrites _(done: IRWB-021, design only)_

- **What we know:**
  - Plain attention in Tix materializes N×N scores. The streaming form (FlashAttention) keeps a running maximum, normalizer and output per row, rescaled when the maximum grows, and moves O(N·D) bytes instead of O(N²).
  - Tix's `sum` and `max` have scalar state. The streaming form needs a reduction whose state is a tuple, combined associatively.
  - **Result:** all twelve configurations derived it correctly. The first four rubric criteria scored 5/5 for every design, so the question measured recall, not design (report 11 §4). The best designs split the merge into two lemmas, rebase-then-fold, and one abstracts a scale-transport law. The objective version is T5.
- **What we don't know:**
  - Whether the derivation can be a sequence of local, mechanically checkable rules.
  - What their side conditions are (the empty prefix, −∞, the rescaling factor).
  - Which steps can be checked exactly and which only within a tolerance.
  - Which other programs the rules reach: softmax followed by a contraction, log-sum-exp, layernorm statistics in one pass.
- **Approach:** blind scoring with a rubric that checks the mathematics; the best design feeds T5.
- **Measure:** the rubric (mathematical correctness, derivation completeness, the new construct, checking, generality, experiment, insight).
- **Depends on:** nothing.

### T2: lowering to CUDA, one kernel per statement, run on the GB10 _(done: IRWB-022; I merged at `2e035c6`)_

- **Result:** all twelve lowerings are correct, and every `checkLowering` accepts all 16 test programs (2.5–6 s per check, remote).
  - **Three are bit-exact with the f32 meaning on every measured case:** C, I and J, all Sol. They use round-to-nearest intrinsics, so nothing contracts, and compute `exp`, `log` and `tanh` in double, rounded. An exhaustive check over all 2³² inputs confirmed that construction (`various/exact-probe/`).
  - **The other nine are about 1 ulp off** where `expf` or `tanhf` appear.
  - **Every implementation checks under tolerance.** In the report turn, the three exact ones said the exact relation (NaN compared as a class) is the stronger one their evidence supports (F17).
- **Framework:** ten of twelve changed nothing. K and G added a batch-only differential spec (F18). Eleven changed `tools/cuda-remote.mjs` (private run directories, a locked compile cache); I's version is merged.
- **Efficiency of the merged base,** against the reference speeds above:
  - matmul: 0.197 ms, 6.0× cuBLAS and 7% of FP32 peak;
  - mlp: 11.7× cuBLAS's two GEMMs;
  - softmax: 0.785 ms and layernorm 0.563 ms, against 0.41 ms for one kernel per statement (about 100 MB moved) and 0.143 ms for one fused pass (32 MB).
  - The double transcendentals cost about 1.65× on softmax and 7–15% on mlp and attention. matmul, conv and layernorm show no consistent difference.
- **Reports:** vault report 11, §9 (the comparison); report 13 (I's own).

### Cells for implementation tasks _(from T3 on; set by the user on 2026-11-27)_

- **Codex:** Sol medium and Astra medium, and Terra low (`gpt-6.1-terra`; the account cannot run `gpt-6.2-terra`).
- **Claude subagents** (few): Opus and Fable, default effort.
- **Pi with only the LunaRoute extension:** GLM 5.3 high; DeepSeek 4.1 Flash high and xhigh; GLM 5.3 Flash high and max.
  - The user asked for GLM 5.3 Flash at xhigh, but Pi's catalogue maps its `xhigh` to `high`. Asked, they chose max instead.
- **Small specified fixes** (such as F2–F6) go to one cheap Codex agent (Terra low), not all eleven cells (the user's choice, 2026-11-27).
- **Ten cells per task.** Only Opus and Fable use Claude tokens.

### T3: checked fusion _(done: IRWB-029-D, Opus, merged `b53cded`..`e9c6ba2`; nine cells, all exact)_

- **What we know:**
  - **Fusion legality is visible in index notation** (shared iteration domains, reductions that separate statements). The framework's correspondence must then express many-to-one mappings.
  - **The base is bit-exact,** so a fusion that keeps each output's evaluation order can be checked under the exact relation: bits are compared, with no tolerance to justify.
  - **The gap it targets** (diary step 26): softmax at 0.785 ms and layernorm at 0.563 ms, against 0.41 ms for one kernel per statement and 0.143 ms for a fused single pass.
  - **The row reductions run one thread per row:** only 4,096 threads, and a warp's reads are 4 KB apart, so they are not coalesced. Staging rows through shared memory coalesces the loads and keeps each thread's order.
  - **mlp's bias and GELU** can fuse into the second contraction's epilogue.
- **What we don't know:**
  - whether correspondence handles many-to-one as is;
  - how close exact fusion gets to the bandwidth bound;
  - whether legality and exactness can be decided from the IR alone, or need the GPU check.
- **Approach:** elementwise and epilogue fusion first, then reductions (softmax, layernorm). Check every fusion with the T2 contract, under the exact relation where order is kept. The thread mapping may change where fusion needs it, with each change recorded with its reason.
- **Measure:** kernel count, bytes moved and GPU time (T9's protocol) against T2 and the bandwidth bound; the relation achieved per fused program.
- **Depends on:** T2 (done); T9 for timing.
- **Result (diary step 40):**
  - All nine cells are bit-exact on the hidden evaluation. Opus's geomean speed-up over softmax, layernorm, attention and mlp is the best (1.26×; worst program 0.95×), and every program fuses to one kernel.
  - Correspondence handles many-to-one as is, but its entity lists are self-declared (F23).
  - Legality is decided from the IR; the GPU check confirms exactness.
  - Softmax reaches about 2×. Exact double `exp` bounds it, measured independently by four cells.
  - **Finding:** the hidden programs divide inside reductions (`sum(d) x / D`). There fused layernorm and attention lose to unfused, because the whole term, division included, runs in one thread's serial fold. With the division outside, the same code gains 2.1–3.2× (layernorm) and 1.3–1.4× (attention).

### T3b: parallel terms, serial fold, and a cost gate for fusion _(done: IRWB-030-E, Fable, merged at `49cb9c7`; ten cells, all exact, nine never slower)_

- **What we know:**
  - In block mode a row reduction runs on thread 0 with its whole body inlined.
  - Each term, such as `x[i, d] / D`, can be computed by any thread into shared memory. Thread 0 then accumulates in the meaning's order, so the result is bit-identical: each term is rounded the same way and the sum keeps its order.
  - No T3 cell fuses by cost, so fusion is applied even where it is slower.
- **What we don't know:** how much of the division-inside gap the staged terms close; whether a simple cost rule (fold body cost × rows / resident blocks) predicts when to refuse fusion.
- **Measure:** the hidden T3 evaluation and `scripts/43-probe-division-placement.mjs`, aiming for no program slower than unfused, and the geomean.
- **Depends on:** T3 (merged).
- **Result (diary step 42):**
  - Fable's implementation has a geomean speed-up of 1.86× over nine programs (the four hidden ones, the two "outside" variants and three held-out ones), and its worst program is 1.31×. Main's T3 code had 1.04×, with log-softmax 6.6× slower.
  - Terms are staged for costly bodies. A launch-time gate checks both sides. Rows are written in place, so more blocks fit per SM.
  - **Follow-ups:**
    - declare the CUDA artifact's kernels through F23's `entities`;
    - two framework findings, both unaddressed: recording a launch-time choice between checked artifacts (Opus), and the unchecked `baselineKey` contract (Fable).

### T4: tolerance calibration with mutants _(queued fourth; with F15)_

- **What we know:** C1's question in floating point. A tolerance accepts reassociation, and must still reject real bugs.
- **What we don't know:** which bug classes hide inside any tolerance loose enough to accept legal reassociation.
- **Approach:** mutants of the Tix passes; miss rate against the tolerance and the number of cases.
- **Measure:** miss rate per mutant class.
- **Depends on:** T1.

### T5: implement R1's derivation _(queued eighth)_

- **What we know:** depends on R1's results.
- **What we don't know:** whether a derived streaming kernel comes close to a hand-written one on the GB10.
- **Approach:** the rules as checked passes, plus the tuple-state reduction construct in the IR.
- **Measure:** GPU time and bytes moved against T2's unfused attention and a hand-written streaming kernel.
- **Depends on:** R1, T3, T6.

### T6: exact tiled contractions with a schedule IR, against cuBLAS _(queued third)_

- **What we know:**
  - **The gap:** cuBLAS SGEMM takes 0.0329 ms at 512³. T2's naive matmul takes 0.197 ms (6.0×), and mlp's two contractions are 11.7× slower.
  - **The cause is mostly data reuse:** the naive kernel loads two floats per multiply-add, so memory, not arithmetic, limits it.
  - **The order-preserving steps:** shared-memory tiling, register tiling (each thread an 8×8 patch), vector and coalesced loads, a transposed A tile, double buffering, and per-shape tile sizes. All keep each output's additions in the order k = 0, 1, … and so stay bit-exact. Expert hand-written SGEMMs reach 80–95% of cuBLAS with these steps alone.
  - **The ceiling:** the f32 meaning rounds the product and the sum separately, so an exact kernel issues two instructions per multiply-add. Its ceiling is about half of cuBLAS on large matrices, around 9.6 TFLOP/s; T11 covers the rest.
  - **What cuBLAS adds beyond these steps:** a kernel chosen per shape from many variants, plus low-level tuning (register allocation, instruction scheduling, software pipelining). CUTLASS shows the approach in the open: templates over tile shapes and pipeline depth.
- **Hypothesis, refuted by R2:** that an exact tiled kernel matches cuBLAS at 512³.
  - Three R2 cells measured an exact tiled 512³ matmul independently, all bit-identical: Sol 0.0537 ms (reproduced), Fable 0.0576 ms, Opus 1.8–2.2× cuBLAS from 512³ to 4096³. That is 3.9× faster than stage 2, but 1.6–1.75× slower than cuBLAS (0.033 ms).
  - The arithmetic ceiling, measured by Opus: FFMA 26.98 TFLOP/s; FMUL+FADD (the Tix meaning) 14.39.
  - Opus's tuned GEMM reached 10.32 TFLOP/s exact, against 14.92 for the same code with an FMA fold.
  - Fable and Opus found independently that cuBLAS at 4096³ equals a sequential FMA fold bit for bit, and that cuBLAS is not batch invariant (Opus).
- **What we don't know:**
  - how close a _generated_ exact kernel gets;
  - what the schedule IR must express;
  - whether `src/framework/strategy` fits schedule search.
- **Approach:** a schedule (kernel) IR as a v6 artifact, following the Halide/TVM split between algorithm and schedule: tile, split, reorder, bind to block or thread, stage in shared memory. Check order-preserving schedule changes under the exact relation; reassociating ones belong to T10.
- **Measure:** TFLOP/s against cuBLAS at matmul 512³, the attention and mlp shapes, and 4096³; bit-exactness; the framework changes.
- **Depends on:** T2, T9; T3 for the epilogue.
- **Prior art to read first:** Yang, Riasanovsky, Deng and Sarkar, arXiv 2609.11356 (2026), "Taming Bitwise Behavior in GPU Kernels with Tensor Core". It reconstructs cuBLAS's GEMM reduction order black-box (including split-K), enforces a fixed reduction tree in Triton lowering, and checks bitwise equivalence of compiled kernels statically (PTX and GCN), restricting Triton's autotuner to one bit-equivalence class. It is the closest prior art to Tix's exact checked lowering and to T7. Five R2 tickets claimed a version of it as new. _(Found by the R2 Claude judge; abstract checked on arXiv.)_

### T7: autotuning under noisy cost _(queued seventh)_

- **What we know:** GPU timings vary between runs. The lock removes interference from other agents, but not the noise itself.
- **What we know (T2):** a remote check costs 2.5 s, most of it the round trip, so a search over many tile configurations must batch candidates into one compile and one run, with checked evidence cached by content. The differential contract's `decide` hook already batches cases.
- **What we don't know:** how the strategy search should treat a noisy objective (repeats, confidence, early stopping).
- **Measure:** regret against an exhaustive search; repeatability of the chosen schedule.
- **Depends on:** T6, T9.

### T8: ONNX importer into Tix _(idea, optional)_

- **What we know:** ONNX is a protobuf file that can be read without Python. Its operator set is large (about 190).
- **What we don't know:** how many operators real models need once views and broadcasts disappear into indices.
- **Depends on:** T1.

### T9: a GPU timing protocol _(prep, S; the coordinator, during T3)_

- **What we know:**
  - T2's `gpuMs` is one event interval per process. The evaluator's single runs and I's warm medians differ by up to 2× (attention 1.81 against 1.05 ms; conv 0.341 against 0.164).
  - Lazy module loading inflates the first launch (0.06 against 0.004 ms) unless kernels are preloaded.
  - The SM clock reads 2.4 GHz at idle, against a 3.0 GHz maximum.
- **What we don't know:** the run-to-run spread with warmup and repeats, and how many repeats give a stable median at these kernel lengths (0.03–2 ms).
- **Approach:** a mode in the runner or the generated host code that warms up, runs N timed repeats in one process, reports every interval, and records the clock state.
- **Measure:** coefficient of variation per corpus program; agreement between two sessions.
- **Depends on:** nothing.

### T10: parallel reductions and split-K, by lowering split-sum programs _(queued fifth)_

- **What we know:** `split-sum` already reassociates a sum explicitly, checked under tolerance.
  - A split-K GEMM is a split-sum program lowered with one block per partial sum. A warp-parallel tree reduction is a nested split.
  - The lowering of a split program can stay exact against that program.
- **What we don't know:**
  - whether the lowering can choose the mapping from the split structure alone;
  - how much the skinny GEMMs (attention's 1024×64×1024) and the row reductions gain.
- **Approach:** lower split programs to block- and warp-level parallel reductions. Check the lowering as exact against the split program, and the split against the origin under tolerance.
- **Measure:** GPU time on the skinny GEMMs and the reductions; whether both relations hold.
- **Depends on:** T6; T4 and F15 (the tolerance must still reject real bugs).

### T11: checked FMA contraction _(queued sixth)_

- **What we know:** fused multiply-add halves the instruction count of a multiply-add, and is the last factor of about 2 between an exact kernel and cuBLAS on large matrices. It rounds once where the f32 meaning rounds twice, so it changes results.
- **What we don't know:**
  - the error it introduces on the corpus;
  - how the f32 reference computes a fused multiply-add exactly in JavaScript. The product of two f32 values is exact in double, but adding a third value rounds to double and then to f32, which can round twice. An exact emulation needs an error-free transformation.
- **Approach:**
  - a `contract` pass in the IR that marks multiply-add pairs as fused, checked under tolerance;
  - an f32 meaning for the fused operation;
  - a lowering that emits `__fmaf_rn` exactly where marked, so it stays exact against the contracted program.
- **Measure:** TFLOP/s gained on T6's kernels; error against f64 and against the uncontracted f32 meaning.
- **Depends on:** T6, T4.

### T12: tensor cores as a checked precision change _(queued ninth, last; L)_

- **What we know:** TF32 or BF16 tensor cores are 4× or more beyond CUDA-core FP32. The cuBLAS reference speeds above use none (pedantic FP32 math). Inputs lose mantissa bits, so only a tolerance relation can hold.
- **What we don't know:** which warp-level matrix instructions sm_121 offers and through which CUDA interface; the error on the corpus.
- **Approach:** a precision-change pass in the IR (inputs rounded to TF32 or BF16, accumulation in f32), checked under tolerance, and a lowering to warp-level matrix instructions.
- **Measure:** TFLOP/s against cuBLAS with tensor cores enabled; error against f64.
- **Depends on:** T6, T11, T4.

---

## 2. Research programmes on the Typed → RV32 domain

The six programs added in IRWB-012 to 017 (bytecode VM, SHA-256/ChaCha20, LZ, regex, f32 DSP, chess) gave the earlier programmes (A to E, reports 8 to 10) concrete targets.

### D1: why `speed` slows the bytecode VM _(done: IRWB-034, Fable merged)_

- **What we know:**
  - At `n = 12, seed = 8`, `speed` takes Fibonacci from 7,678 to 9,286 RV32 instructions and checksum from 6,874 to 8,218. It is the only one of the six programs the optimizer makes worse (IRWB-012 final report).
  - Every executed instruction maps back through correspondence to passes and rules.
- **What we don't know:** which decision causes the extra 1,608 instructions (an inline, an unroll, register pressure from a hoist), and whether one guard fixes it without losing gains elsewhere.
- **Approach:** credit executed instructions to decisions through correspondence (programme D's method at its smallest); then a guard or a cost check.
- **Measure:** VM instructions at or below r0; corpus totals with no regression; parity clean.
- **Depends on:** nothing.

### D2: missed optimizations from provenance _(done: IRWB-037; Fable merged `badf42a`..`a2fae5b` as cherry-picks)_

- **What we know:**
  - Regex after `speed`: 8,040 instructions, against the reference compiler's 6,628.
  - LZ: 157,682 against 156,405. Chess: 10.08M, below the reference's 10.83M.
  - 18 of simplify's 27 rules never fire on the corpus.
- **What we don't know:**
  - Which code shapes account for the regex gap.
  - Whether the closed loop works: hot instructions with no rule in their provenance, candidate rules, verification, a larger table.
- **Measure:** instructions on the six programs and the corpus; every added rule verified.
- **Depends on:** nothing. It shares its attribution method with D1.

### B1: specialize the VM on its bytecode, a first Futamura projection _(done: IRWB-036, seven cells; merge pending)_

- **What we know:**
  - Hand-specialized loops take 75 and 74 instructions, against 7,678 and 6,874 for the general VM.
  - Specializing on scalars does almost nothing: binding the FFT length takes 4,065 to 4,064 instructions; binding LZ's chain limit saves 0.06%.
  - The existing field and scalar specialization (IRWB-009/010) binds values, not memory.
- **What we don't know:**
  - How a binding-time analysis over a constant buffer (the bytecode) should work with the checked buffer capacities.
  - When to unroll the dispatch loop on a known program counter, and how to stop.
  - How much of the gap automatic specialization closes.
- **Approach:** a host promise that a buffer is constant, checked like the field binding; specialize the dispatch loop over it.
- **Measure:** instructions against 75 and 7,678; code size; the meaning check passes.
- **Depends on:** nothing. B2 builds on it.

### B2: specialize Candela on its scene buffers _(idea)_

- **What we know:** specializing on the scene index gave −58% code size but only 5–6% fewer instructions per pixel, because what remains is interpreting the buffers. The gallery's per-scene `s<k>_` sections are hand staging of the same idea.
- **What we don't know:**
  - termination and generalization on BVH recursion;
  - polyvariance (how many specialized copies to make);
  - code growth against what the device can hold.
- **Measure:** instructions per pixel; frames bit-identical; automatic specialization against the gallery's hand staging.
- **Depends on:** B1.

### A0: what share of edits are local value rewrites _(done: IRWB-035, seven cells; merge pending)_

- **What we know:** programme A's founding hypothesis, which is not yet measured: if most O2/`speed` value edits are local rewrites, a function's equivalence can be assembled from per-rule proofs.
- **What we don't know:** the share, per pass and per program.
- **Approach:** classify every edit in O2 and `speed` runs on the corpus, using correspondence: local rewrite, structural (cfg, licm, inline), other.
- **Measure:** the share, as a table.
- **Depends on:** nothing.

### A1: an e-graph over value trees, with verified rules _(decision)_

- **What we know:**
  - The 8 comparison-flip rules are verified "exhaustively at 8 bits plus an argument". The other rules carry sampled evidence.
  - Provenance already records every derivation step, which is what an equality-saturation explanation needs.
- **What we don't know:** whether extraction by RV32 cost beats today's simplify/fold, and what share of executed instructions gets proof-backed derivations.
- **Decision needed:** bit-vector reasoning. Either write a small decision procedure, or vendor z3 compiled to Wasm. The latter is downloaded code, so it is the user's call.
- **Measure:** instructions against today's simplify/fold; the share of value edits with proofs.
- **Depends on:** A0 (whether it is worth it) and the decision.

### C1: a calibrated gate _(prep)_

- **What we know:**
  - The gate accepts a pass after 40 sampled cases, by convention.
  - IRWB-005 produced mutants whose equivalence to the original is known.
  - The new programs have narrow valid domains: regex is checked with one fixed pattern, and LZ only at maximum size. That probably lowers how often a bug is exposed.
- **What we don't know:** the fraction of inputs that exposes each bug class, and how the miss probability falls with the number of cases.
- **Approach:** measure exposure per mutant class; case counts that adapt; boundary and coverage inputs; send the classes that sampling cannot catch (such as NaN payloads) to A.
- **Prep:** the coordinator builds a held-out mutant set first.
- **Measure:** miss rate on held-out mutants at a fixed case budget.
- **Depends on:** the prep. F9 (input grammar) interacts with it.

### E1: incremental checking per function _(prep)_

- **What we know:** function parts are content-addressed, so an edit to one function should not require checking the others.
- **What we don't know:** the cost per edit today, as a function of program size, and how much queries with early cutoff (salsa-style), lazy projection and analyses keyed by function part reduce it.
- **Prep:** the coordinator writes an edit-stream benchmark (chess, Candela), which the workbench can record.
- **Measure:** cost per edit against program size; all suites green.
- **Depends on:** the prep.

---

## 3. Framework and workbench fixes found by agents

Each of these came from evidence in the IRWB-012..018 rounds. Most are small.

- **F1: one cross-engine check** _(ready, S–M)_.
  - _Known:_ five of six implementers each wrote the same private harness (evaluator, RV32 image, `speed`, reference compiler, compare), with 4 to 17 helper functions per test file. P2.6 left out the calling signatures, so an f32 entry looked 100% wrong (IRWB-018 step 10).
  - _Needed:_ one framework call that handles signatures. Then delete the copies.
  - _Measure:_ test lines removed; suites green.
- **F2: make `imageFromCode` signatures impossible to omit** _(done: IRWB-028 `8905642`, `17ac408`; signatures required, every caller passes them)_.
  - _Known:_ `dot3`'s 100 "disagreements" came from the missing `signatures` (fixed in `d2e198f`).
  - _Needed:_ require them, or carry them with the compile result.
- **F3: `tools/reference-check.mjs` ignores its project argument** _(done: IRWB-028 `33b22f9`; ids on the command line select projects, unknown ids are an error)_.
  - _Known:_ four of six implementers worked around it.
- **F4: `wrapProse` mis-wraps already-wrapped list items** _(done: IRWB-028 `8e1d519`; continuation indent kept, wrapping idempotent)_.
  - _Known:_ it drops the continuation indent and splits the item, so `tools/format-corpus.mjs` refuses the file (chess `notes.md`).
- **F5: corpus-wide tests hard-code totals** _(done: IRWB-028 `6361db5`, `5921f4e` after review; per-project expectation tables (`tests/typed/corpus-expectations.mjs`), the book's figures over its 44 projects)_.
  - _Known:_ five tests broke when six projects were added (44 projects, 70 functions, 6,986 cases), while every per-function assertion passed.
  - _Needed:_ assert per-project properties, or derive the totals.
- **F6: one parser for `project.json`** _(done: IRWB-028 `c94107d`; one `parseProjectMeta` for `projectSource` and the workbench)_.
  - _Known:_ `projectSource` and the workbench's `metaOf` each read it, so `ingest` and `entries` had to be wired twice (`6ad38d0`).
- **F7: focus links by label, not by line** _(idea, S)_.
  - _Known:_ the chess focus line moved when its files were reformatted.
- **F8: the meaning check's assumptions** _(idea, M)_.
  - _Known:_ `agrees` treats any two traps as agreeing, every guest byte is compared, and every function is checked on independent random inputs. Report 10 §4.4 showed the programs absorbing these as defensive contracts.
  - _Needed:_ the contract built from domain × observation × relation. T1 forces it for tensors; bringing it back to Typed is this item.
- **F9: an input grammar** _(ready, M)_.
  - _Known:_ `casesFrom` draws parameters independently, and `oneOf` picks only scalars. Regex is checked with one fixed pattern, and there is no way to generate a valid chess position.
  - _Needed:_ the smallest extension of `inputs` (correlated parameters, `oneOf` over records and buffers, structured generators), measured with C1.
- **F10: IR and language features the designs asked for** _(idea, M each)_.
  - Read-only static tables; `match` on integers; `requires(...)`; `rot` and `fma` IR ops; guarded rules over interval × known-bits facts.
  - Each should come with the program that needs it.
- **F11: a repository `AGENTS.md`** _(decision, S)_.
  - _Known:_ three classes of integration failure in IRWB-018 came from conventions agents could not see: tile widths, the formatter, and what the corpus-wide tests already check. Also worth stating: the sandbox EPERM note and Candela's memory limits.
  - _Decision:_ it changes every agent session in this repository.
- **F12: the meaning check's statement limit (2e4)** _(idea, S)_.
  - _Known:_ chess search and Candela approach or hit it.
  - _Needed:_ per-project limits, or a case budget that accounts for cost.

---

- **F13: `applyPass` opens its edit eagerly** _(done: `bc7702c`; the edit opens on the first read of `ctx.edit`; regression test)_.
  - _Known:_ `beginEdit()` runs for every pass and throws `ir.capability` for an adapter without `rebuild`, even when the pass returns a native value. All sixteen T1 designs found it, but only four implementations fixed it; the merged base (B) did not, because its synchronous path avoids it.
  - _Needed:_ open the edit on the first read of `ctx.edit` (I, K, N and P show the change).
- **F14: `optimizeTix` steps carry no reason and no "changed" flag** _(done: IRWB-024 `7499416`; steps are `{pass, accepted, changed, reason?}`, `accepted` unchanged)_.
  - _Known:_ an unchanged pass reports `accepted: true`, so acceptance counts overstate coverage (`split-sum` applies to 32 of the 60 cross-check programs, `inline` to 15). Rejection reasons exist inside the contracts but are not returned.
  - _Needed:_ `{pass, accepted, changed, reason?}` in each step.
- **F15: the base's tolerance is a fixed bound** _(ready, M; before or with T2)_.
  - _Known:_ B checks |c − r| ≤ 2e-6 + 2e-5·|r| against the origin's f64 on its own sampled cases, "without a worst-case error derivation" (its report). The same rule falsely rejected correct passes in K. E and H rejected on ill-conditioned sampled cases where the origin itself fails the bound. Two designs handle this: P's running first-order error bound accepted every correct pass, and N's "inconclusive when the origin fails".
  - _Needed:_ a bound derived from the computation, or the inconclusive rule; treat identical non-finite values as agreeing.
- **F16: unspecified rules in the Tix core** _(done: stated in the T2 brief)_.
  - _Known:_ fourteen implementations divided on whether an index may share a tensor's name (the Claude cells said no). The brief is also silent on shadowing (`sum(j) a[i, j] + sum(j) b[i, j]` parses as a nested reduction rebinding `j`) and on zero-size extents.
  - _Needed:_ state all three in the T2 brief's fixed core, and test them. _(Done in the T2 brief; all twelve T2 implementations implement them.)_
- **F17: the lowering's relation should be exact for an exact emitter** _(done: `885601f`; `checkLowering` reports `exact`, NaN as a class; GPU tests 10/10)_.
  - _Known:_ the merged base (I) is bit-exact by construction but checks under tolerance against f64. NaN words differ between the GPU and Node: `__fsqrt_rn(-2⁻¹⁴⁹)` gives `0x7fffffff` on the GB10 and `0xffc00000` in Node (I's report).
  - _Needed:_ compare f32 words exactly against the current revision, with NaN as a class. Keep the f64 tolerance as a separate numerical check. This makes T3's exact fusion checks direct.
- **F18: a batch-only differential spec** _(idea, S)_.
  - _Known:_ K and G each added one to `src/framework/contracts`. Ten others batched through `decide` without a framework change.
  - _Needed:_ decide whether the framework should offer it.
- **F19: concurrent cold checks both issue a batch** _(done: IRWB-024 `9244bd8`; one in-flight batch per key, outside the bounded memo; failures not cached)_.
  - _Known:_ the differential memo records verdicts only after a batch completes (I's report).
  - _Needed:_ share an in-flight batch per key.
- **F20: `tools/cuda-remote.mjs` cannot link libraries** _(done: IRWB-024 `c219cd9`; `--link <lib>`, ordered, in the build key; cuBLAS fixture test)_.
  - _Known:_ the cuBLAS baseline needed `-lcublas`, so I ran it over `ssh` directly, outside the tool's lock and cache.
  - _Needed:_ a `--link` option that is part of the build key, so baselines go through the tool.
- **F21: the stage-1 meaning gate cannot tell some shape symbols apart** _(done: `250626e`; distinct sizes, empty extents checked but not counted as coverage; regression test)_.
  - _Known:_ `cases()` in `src/tensor/contract.ts:25-36` sorts the shape symbols. Its assignments are all-equal (1, 3, 4, 7) or "mixed", which cycles `[3, 5, 7][i % 3]`, so symbols three apart in sorted order are always equal. The zero cases that would separate them are added only for the CUDA contract.
    - For `mlp` ([D, H, N, O]), D = O in every case. A mutant that sums the first contraction over O instead of D passes `meaningGate` (reproduced with `IRWB-023-D/scripts/05-normal-form-proof.mjs`).
  - _Needed:_ pairwise-distinct sizes in at least one assignment, and the zero cases in the meaning gate too, plus a test with this mutant.
- **F22: the tolerance's absolute term accepts anything at small scale** _(ready, S; found by R2's Opus cell)_.
  - _Known:_ |c − r| ≤ 2e-6 + 2e-5·|r| accepts an all-zero output whenever the results are below about 2e-6 (shown at an input scale of 1e-7). It is also vacuous for inputs scaled by 2⁻²⁰.
  - _Needed:_ a scale-covariant relation, part of F15.
- **F23: a correspondence's entity lists are self-declared** _(done: IRWB-031, Terra low, `fc39478`, `fab6334`, after one review; an IR type may declare `entities(value)`, and the manager then checks the declared lists and every entry ID against both revisions. Next: the tensor CUDA artifact should declare its kernels, after T3b)_.
- **F24: Tix statements and CUDA kernels are not enumerated** _(done: IRWB-032, Terra low; `TixIR` enumerates `fn/stmt`, `CudaIR` its kernels, so every lowering's correspondence is checked)_.
- **F25: `runTixCuda` does not say which side of the gate ran** _(done: IRWB-032; `gates: Record<kernel, 'fused' | 'unfused'>`, written by the CUDA program)_.
- **F26: differential reuse trusts the spec's `baselineKey`** _(done: IRWB-032, after one review; on a reuse hit the cases are regenerated and compared by a canonical `fingerprint` digest, browser-safe; a mismatch throws `ContractError`)_.
- **F27: a Tix pass in a strategy plan loses its meaning gate** _(done: IRWB-039 phase 1, tag `v7-p1`; was ready, S)_. The first statement ("no Tix pass can appear in a strategy plan", blaming `passAlgorithm`'s async `applyPass` and `AnalysisManager`) was wrong: Tix passes already run in plans through the stock bridge, and the test below passes there. What is lost is the gate: `meaningGate` is a closure handed to `applyNativePassSync`, so the bridge applies the pass unchecked (a deliberately wrong pass is rejected by the sync runner and accepted by the bridge). Fix without a framework change: wrap `meaningGate` as an `ensures` invariant and pass it as the bridge's existing `contract` and `contractInputs` (the gate's evidence needs a JSON round trip, because it contains an `undefined` the manager refuses). Then `optimizeTix` runs a plan. Test: a plan with `fork` and `chooseBest` over `inline` and `split-sum`, and a wrong pass rejected inside a plan.
- **F28: a reuse audit of `src/tensor`: domain machinery that duplicates or should be framework concepts** _(ready, M; after T6 merges, because T6 rewrites the lowering; the user, 2026-11-27)_. List every mechanism the tensor domain builds itself, and for each, the framework concept it duplicates or the domain-independent concept the framework lacks. Known candidates: `planFusion`'s facts are plain TypeScript, not `defineAnalysis` results cached per revision and declared as pass `needs`; Tix passes return whole modules instead of using the IR layer's transactions, patterns and rewrite schedules, so their correspondence is no finer than "the module changed"; fusion, staging and gate decisions are not passes; no strategy plans (F27). Each finding is either moved onto the framework or recorded with the reason it cannot be.
- **F29: affine dependence analysis as a framework analysis** _(idea, M–L; the user, 2026-11-27)_. The dataflow layer solves fixpoints over control-flow graphs; tensor scheduling needs dependence analysis over affine iteration spaces (which iterations read what another writes; whether a reordering preserves every dependence). Build it domain-independently in the framework, on the standard theory (dependence polyhedra, legality of a schedule as preservation of every dependence's lexicographic positivity), so Tix's schedule IR and any later loop-nest IR, Typed's loops included, can use it.
- **F30: edit transactions cannot install a new entry block** _(idea, S; from IRWB-036-G, Fable's B1)_. `Tx.block` only appends, so the B1 specializer reorders `f.blocks` itself to install a residual entry. `tx.block({ entry: true })` (or an entry relation in the IR layer) would make that an ordinary edit.
- **F31: edit records cannot cite the rule they apply** _(idea, S–M; from IRWB-035-F and -G, the A0 cells)_. No edit record names a verified rule, so A0 had to re-derive each local rewrite from the rule tables (183 of 395 in O2). `Tx.cite(rule)`, or a `rule` field on replace records, would let a checker accept a cited, verified rewrite without sampling (programme A).
- **F32: one pass runner, and pass eligibility** _(decision; restated after R3)_. Do not merge a second strategy interpreter (IRWB-033-E's `executeSync`): its motivating case is gone with F27. Merge the two pass runners instead (one runner with a sync and an async driver; R3's K5), and treat IRWB-033-D's `PassSpec.legal` as the transformation's eligibility step rather than a separate field.
- **F33: publication before acceptance** _(done: IRWB-039 phase 1, tag `v7-p1`; was ready, M)_. A rejected candidate stays the head of a caller-supplied store (the retain at `src/framework/ir/view.ts:190` during preparation), and the manager records an accepted fact before the enclosing pass rejects a false preservation claim. Latent today, since no domain passes a store. Fix: prepare on a private view and publish every output or none (start from the manager's `deferCommit`).
- **F34: one word, `'checked'`, for every assurance** _(done: IRWB-039 phase 1, tag `v7-p1`; was ready, S)_. Sampled and exact checks both record `assurance: 'checked'` (`src/framework/contracts/analysis-manager.ts:1177`); `evidence.method` differs and nothing reads it, and `assuranceOf` defaults missing or misspelled evidence to `checked-exact`. Records should carry method and scope, and unknown evidence must never count as exact (R3's K3).
- **F35: correspondence validation checks membership only** _(done: IRWB-039 phase 1, tag `v7-p1`; was ready, S–M)_. Complete endpoint lists with zero mapping groups are accepted, and so is a false group. Add a coverage policy, and audit declared correspondence against the structural diff (R3's K2).
  - _Known:_ `makeCorrespondence` (`src/framework/ir/correspondence.ts:50`) checks each entry against the `sourceEntities` and `targetEntities` lists, but the caller supplies those lists. Nothing compares them with the entities of the two artifacts.
    - DeepSeek xhigh passed no target list, and `{from: [m, s], to: [k0]}` was rejected ("Unknown target entity k0").
    - Opus passed lists with made-up IDs (or no kernels at all), and they were accepted.
    - The two findings looked contradictory, but they are one gap: the check is only as good as the declared lists. For a heterogeneous lowering, such as Tix statements into CUDA kernels, nothing derives the target list. T3's emitters produce an artifact without entities (`defineIR<{fn, source}>`).
  - _Needed:_ an optional entity enumeration on `defineIR`, as Opus proposed, so the manager can check the declared lists against both revisions.
  - _Measure:_ a probe with a made-up ID is rejected, and the existing correspondences still pass.
- **F36: bce is unsound without its meaning gate** _(done: IRWB-039 phase 1, tag `v7-p1`; was ready, S)_. bce accepts a dominating `i < buf.length` when the index has the same *set* of reaching definitions at the branch and at the check. In IRWB-037-G's `scripts/13-probe-bce-same-defs.mjs` the only assignment to `i` lies between the two and reaches both: bce removes the check, and only the meaning check rejects the pass (16 of 40 cases disagree). Fix: compare SSA names (values), not definition sets.
- **F37: `typed.ranges` loses a loop counter's lower bound under an inner loop** _(done: IRWB-039 phase 1, tag `v7-p1`; was ready, S–M)_. When an inner loop's head widens, an outer counter's interval loses its lower bound (IRWB-037-G `scripts/14-probe-chess-shapes.mjs`: `dense` in [-2^31, 63]), so `strength` keeps `dense / 8`. D2's `guards` has its own rule meanwhile; one range analysis with a correct widening (and narrowing) should serve both (R3's `lattice` primitive).
- **F38: `lvn` throws `absent` when run a second time** _(done: IRWB-039 phase 1, tag `v7-p1`; was ready, S)_. On regex-nfa, a second `lvn` before rotate throws. Where it runs, a second `lvn` saves 1,324 instructions over the 49 projects, so a pass that is not idempotent also blocks a measured gain.
- **F39: intermittent exactness rejection of the batched tiled variant on the GPU** _(ready, S–M; IRWB-039 step 4)_. `tests/tensor/schedule-gpu.test.mjs:35` ("every tiled variant of the feature contractions is exact on every case") failed once in four runs on main at `v7-p2`, with the batched variant `accepted: false`; it passed in the other three, once serially. A nondeterministic exactness result points at a race in the batched kernel (IRWB-033-D's code), which would undercut the bit-exactness claims. Reproduce in a loop, capture the disagreeing case, and check the kernel's synchronization.

## 4. Agent methodology

The experiments around the work. The playbooks are in the go-go-parc vault under `Research/playbooks/agents/`, with scripts in `agent-design-review/`.

- **M1: the harness × model × effort matrix** _(running)_.
  - _Known:_ Codex or Pi × Sol or Astra × medium, high or xhigh, 12 cells, on T1 and R1.
  - Pi's own system-prompt text is about 2.3K characters, against Codex's 27.7K. Pi lacks the coding and writing rules that report 10 tied to over-engineering.
  - _Result (T1):_
    - designs: Codex over-engineered less than Pi at the same policy (excess 6.3 against 12.0), and Sol was weaker than Astra in both harnesses;
    - implementations: all correct; size follows the model (Astra 805–1,086 lines, Sol 1,278–1,380, Claude about 1,700).
  - The earlier "Astra reads no skill file" note was an extractor artifact: Astra batches commands, and all twelve Codex cells read docmgr and diary.
- **M2: repeat the cells that differ most** _(idea)_. One run per cell is suggestive, not conclusive.
- **M3: the effect of the review loop** _(running from T1)_.
  - _Unknown:_ which review content changes designs and implementations, and whether it does so the same way for every configuration.
- **M4: Claude models in the same matrix** _(ran on T1: Opus and Fable, medium and xhigh designs; medium implementations)_. About 2.97M subagent tokens in all for IRWB-019's Claude cells, judges and reviewer.
- **M6: policy wording for Sol** _(ran on T1: v1, v2, v3; v3 is the global Codex default since 2026-11-26, without the experiment's isolation rule; backup `~/.codex/config.toml.bak-2026-11-26-before-v3`)_.
  - _Known:_ v3 cuts excess by 1–2 items per cell and over-engineering by about one rubric point, at a fitness cost of 0.5 on average; v2's narrowing rule overrode the brief.
  - _Unknown:_ whether its effect holds over repeated runs (M2). (Whether v3 should replace v1 globally was decided: yes, 2026-11-26.)
- **M5: tell designers what is already checked** _(ready)_.
  - _Known:_ in IRWB-018, half of each project's test matrix repeated corpus-wide checks, because the designs prescribed it and nothing said what was covered.
