# Things we can work on: the v6 framework and the workbench

A worklist of research tasks and fixes for `src/framework/` (the v6 IR framework), the Typed → RV32 domain, the tensor domain, and the workbench. Each entry records:
- **what we know:** measured facts, with where they come from;
- **what we don't know:** the research the item needs;
- **approach:** the first steps;
- **measure:** how success is decided;
- **depends on:** what must come first.

Keep it current: update an entry when a round finishes, move items between statuses, and link the ticket when one is opened.

**Status:** *running* (agents are on it), *ready* (it can be briefed now), *prep* (the coordinator must build something first, such as a benchmark or a held-out set), *decision* (it needs the user's call), *idea* (not yet sized).

**Size:** S = one agent-session; M = a design plus an implementation round; L = several stages.

## Index

| ID | Item | Status | Size |
|---|---|---|---|
| T1 | Tix front end, IR, evaluators, contract, two passes | done (IRWB-020-B merged, `98b04da`) | M |
| R1 | research: derive streaming attention by checked rewrites | done (design only; a ceiling) | M |
| T2 | CUDA lowering, one kernel per statement, run on the GB10 | ready | M |
| T3 | checked fusion | idea | M |
| T4 | tolerance calibration with mutants | idea | M |
| T5 | implement the streaming-attention derivation | idea | L |
| T6 | tiled contractions against cuBLAS | idea | M |
| T7 | autotuning under noisy GPU cost | idea | M |
| T8 | ONNX importer into Tix | idea | M |
| D1 | why `speed` slows the bytecode VM | ready | S–M |
| D2 | missed optimizations from provenance | ready | M |
| B1 | specialize the VM on its bytecode | ready | M–L |
| B2 | specialize Candela on its scene buffers | idea | L |
| A0 | measure: share of edits that are local value rewrites | ready | S |
| A1 | e-graph over value trees with verified rules | decision | L |
| C1 | calibrated gate | prep | M |
| E1 | incremental checking per function | prep | L |
| F1–F16 | framework and workbench fixes found by agents | mostly ready | S each |
| M1–M5 | agent methodology | running / ready | — |

---

## 1. Tensor track (IRWB-019)

The question behind the track: `src/framework/` has carried one domain, Typed, and its generality is untested. Tensor programs differ in every way that should stress it: values are shaped arrays, legitimate optimizations change floating-point results, the fast engine is a remote GPU, and the cost (GPU time) is noisy. The primary result of every stage is the list of changes `src/framework` needs, each with its reason.

Shared facts:
- **The GPU machine:** `ssh manuel@bling` (Tailscale; `bling.local` resolves only on the home LAN), an NVIDIA GB10 (sm_121, 121 GB unified memory, aarch64) with CUDA 13.0 `nvcc`, and no torch. The laptop has no NVIDIA GPU.
- **The runner:** `tools/cuda-remote.mjs <dir> [--timed]` copies a directory holding `main.cu` to the machine, keyed by content, so identical inputs compile once (about 0.5 s). It brings `out/` back. `--timed` runs under a GPU lock.
  - A sandboxed Codex agent needs `-c sandbox_workspace_write.network_access=true` to reach the machine.
- **The language,** Tix, fixed in the T1 brief: five constructs (shaped parameters, pointwise expressions, `sum` and `max` over named indices, single assignment, affine indices). Its f32 meaning is exact: every operation is rounded, and reductions accumulate in lexicographic index order.
- **The structure Tix exposes:** `torch.export` of a transformer block gives 40 Core ATen nodes, 26 of which are `view`, `permute` or `expand`. In Tix these are index renamings and do not appear.

### T1: Tix front end, IR as a v6 artifact, evaluators, contract, `inline` and `split-sum` *(done: IRWB-020)*
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

### R1: deriving streaming attention by checked rewrites *(done: IRWB-021, design only)*
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

### T2: lowering to CUDA, one kernel per statement, run on the GB10 *(ready; base `98b04da`)*
- **What we know:** the remote path works end to end, with a 0.5 s compile, cached reruns, correct outputs and the lock. Context start-up dominates a small run (about 370 ms, against 1.3 ms of kernel time).
- **What we know (from T1):** the base's tolerance is a fixed bound chosen without an error argument (F15). The host is `manuel@bling` over Tailscale. Codex agents need `--network` so that their `ssh` runs inside the sandbox; without it they escalate, and the approval sidecar grants it.
- **A sharper question:** CUDA's `+ − * /` and `sqrt` are correctly rounded in IEEE mode. With contraction off (`-fmad=false`) and the transcendentals computed in double, a one-thread-per-element backend could be bit-exact with the f32 meaning, and its lowering could be checked under the *exact* relation. Is that true on the GB10, and what does it cost?
- **What we don't know:**
  - How a contract should consume an expensive, remote, asynchronous engine: caching evidence by content hash, batching cases into one launch.
  - What tolerance GPU math (`expf`, fused multiply-add contraction, a different reduction order) needs against the f64 reference.
  - What framework changes a remote engine forces.
- **Approach:** a kernel IR as a second v6 artifact, a CUDA C emitter, a GPU-vs-f64 invariant, the same 12-cell matrix (or the best cells from T1).
- **Measure:** GPU results within tolerance on the corpus; cost per checked pass; the framework changes.
- **Depends on:** T1.

### T3: checked fusion *(idea)*
- **What we know:** fusion legality is visible in index notation (shared iteration domains, reductions that separate statements). The framework's correspondence must then express many-to-one mappings.
- **What we don't know:** whether correspondence handles many-to-one as is; how much the kernel count and GPU time fall on the corpus.
- **Approach:** elementwise and epilogue fusion first, then reductions (softmax, layernorm); every fusion checked by the T1/T2 contract.
- **Measure:** kernels and GPU time against T2.
- **Depends on:** T2.

### T4: tolerance calibration with mutants *(idea)*
- **What we know:** C1's question in floating point. A tolerance accepts reassociation, and must still reject real bugs.
- **What we don't know:** which bug classes hide inside any tolerance loose enough to accept legal reassociation.
- **Approach:** mutants of the Tix passes; miss rate against the tolerance and the number of cases.
- **Measure:** miss rate per mutant class.
- **Depends on:** T1.

### T5: implement R1's derivation *(idea)*
- **What we know:** depends on R1's results.
- **What we don't know:** whether a derived streaming kernel comes close to a hand-written one on the GB10.
- **Approach:** the rules as checked passes, plus the tuple-state reduction construct in the IR.
- **Measure:** GPU time and bytes moved against T2's unfused attention and a hand-written streaming kernel.
- **Depends on:** R1, T2, T3.

### T6: tiled contractions against cuBLAS *(idea)*
- **What we know:** cuBLAS ships with the CUDA toolkit on bling, so a strong baseline exists.
- **What we don't know:** how close strategy-driven tiling (shared memory, thread mapping as checked data) gets on the GB10.
- **Approach:** tiling as a strategy in `src/framework/strategy`.
- **Measure:** matmul GFLOP/s against cuBLAS.
- **Depends on:** T2.

### T7: autotuning under noisy cost *(idea)*
- **What we know:** GPU timings vary between runs. The lock removes interference from other agents, but not the noise itself.
- **What we don't know:** how the strategy search should treat a noisy objective (repeats, confidence, early stopping).
- **Measure:** regret against an exhaustive search; repeatability of the chosen schedule.
- **Depends on:** T6.

### T8: ONNX importer into Tix *(idea, optional)*
- **What we know:** ONNX is a protobuf file that can be read without Python. Its operator set is large (about 190).
- **What we don't know:** how many operators real models need once views and broadcasts disappear into indices.
- **Depends on:** T1.

---

## 2. Research programmes on the Typed → RV32 domain

The six programs added in IRWB-012 to 017 (bytecode VM, SHA-256/ChaCha20, LZ, regex, f32 DSP, chess) gave the earlier programmes (A to E, reports 8 to 10) concrete targets.

### D1: why `speed` slows the bytecode VM *(ready)*
- **What we know:**
  - At `n = 12, seed = 8`, `speed` takes Fibonacci from 7,678 to 9,286 RV32 instructions and checksum from 6,874 to 8,218. It is the only one of the six programs the optimizer makes worse (IRWB-012 final report).
  - Every executed instruction maps back through correspondence to passes and rules.
- **What we don't know:** which decision causes the extra 1,608 instructions (an inline, an unroll, register pressure from a hoist), and whether one guard fixes it without losing gains elsewhere.
- **Approach:** credit executed instructions to decisions through correspondence (programme D's method at its smallest); then a guard or a cost check.
- **Measure:** VM instructions at or below r0; corpus totals with no regression; parity clean.
- **Depends on:** nothing.

### D2: missed optimizations from provenance *(ready)*
- **What we know:**
  - Regex after `speed`: 8,040 instructions, against the reference compiler's 6,628.
  - LZ: 157,682 against 156,405. Chess: 10.08M, below the reference's 10.83M.
  - 18 of simplify's 27 rules never fire on the corpus.
- **What we don't know:**
  - Which code shapes account for the regex gap.
  - Whether the closed loop works: hot instructions with no rule in their provenance, candidate rules, verification, a larger table.
- **Measure:** instructions on the six programs and the corpus; every added rule verified.
- **Depends on:** nothing. It shares its attribution method with D1.

### B1: specialize the VM on its bytecode, a first Futamura projection *(ready)*
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

### B2: specialize Candela on its scene buffers *(idea)*
- **What we know:** specializing on the scene index gave −58% code size but only 5–6% fewer instructions per pixel, because what remains is interpreting the buffers. The gallery's per-scene `s<k>_` sections are hand staging of the same idea.
- **What we don't know:**
  - termination and generalization on BVH recursion;
  - polyvariance (how many specialized copies to make);
  - code growth against what the device can hold.
- **Measure:** instructions per pixel; frames bit-identical; automatic specialization against the gallery's hand staging.
- **Depends on:** B1.

### A0: what share of edits are local value rewrites *(ready, measurement only)*
- **What we know:** programme A's founding hypothesis, which is not yet measured: if most O2/`speed` value edits are local rewrites, a function's equivalence can be assembled from per-rule proofs.
- **What we don't know:** the share, per pass and per program.
- **Approach:** classify every edit in O2 and `speed` runs on the corpus, using correspondence: local rewrite, structural (cfg, licm, inline), other.
- **Measure:** the share, as a table.
- **Depends on:** nothing.

### A1: an e-graph over value trees, with verified rules *(decision)*
- **What we know:**
  - The 8 comparison-flip rules are verified "exhaustively at 8 bits plus an argument". The other rules carry sampled evidence.
  - Provenance already records every derivation step, which is what an equality-saturation explanation needs.
- **What we don't know:** whether extraction by RV32 cost beats today's simplify/fold, and what share of executed instructions gets proof-backed derivations.
- **Decision needed:** bit-vector reasoning. Either write a small decision procedure, or vendor z3 compiled to Wasm. The latter is downloaded code, so it is the user's call.
- **Measure:** instructions against today's simplify/fold; the share of value edits with proofs.
- **Depends on:** A0 (whether it is worth it) and the decision.

### C1: a calibrated gate *(prep)*
- **What we know:**
  - The gate accepts a pass after 40 sampled cases, by convention.
  - IRWB-005 produced mutants whose equivalence to the original is known.
  - The new programs have narrow valid domains: regex is checked with one fixed pattern, and LZ only at maximum size. That probably lowers how often a bug is exposed.
- **What we don't know:** the fraction of inputs that exposes each bug class, and how the miss probability falls with the number of cases.
- **Approach:** measure exposure per mutant class; case counts that adapt; boundary and coverage inputs; send the classes that sampling cannot catch (such as NaN payloads) to A.
- **Prep:** the coordinator builds a held-out mutant set first.
- **Measure:** miss rate on held-out mutants at a fixed case budget.
- **Depends on:** the prep. F9 (input grammar) interacts with it.

### E1: incremental checking per function *(prep)*
- **What we know:** function parts are content-addressed, so an edit to one function should not require checking the others.
- **What we don't know:** the cost per edit today, as a function of program size, and how much queries with early cutoff (salsa-style), lazy projection and analyses keyed by function part reduce it.
- **Prep:** the coordinator writes an edit-stream benchmark (chess, Candela), which the workbench can record.
- **Measure:** cost per edit against program size; all suites green.
- **Depends on:** the prep.

---

## 3. Framework and workbench fixes found by agents

Each of these came from evidence in the IRWB-012..018 rounds. Most are small.

- **F1: one cross-engine check** *(ready, S–M)*.
  - *Known:* five of six implementers each wrote the same private harness (evaluator, RV32 image, `speed`, reference compiler, compare), with 4 to 17 helper functions per test file. P2.6 left out the calling signatures, so an f32 entry looked 100% wrong (IRWB-018 step 10).
  - *Needed:* one framework call that handles signatures. Then delete the copies.
  - *Measure:* test lines removed; suites green.
- **F2: make `imageFromCode` signatures impossible to omit** *(ready, S)*.
  - *Known:* `dot3`'s 100 "disagreements" came from the missing `signatures` (fixed in `d2e198f`).
  - *Needed:* require them, or carry them with the compile result.
- **F3: `tools/reference-check.mjs` ignores its project argument** *(ready, S)*.
  - *Known:* four of six implementers worked around it.
- **F4: `wrapProse` mis-wraps already-wrapped list items** *(ready, S)*.
  - *Known:* it drops the continuation indent and splits the item, so `tools/format-corpus.mjs` refuses the file (chess `notes.md`).
- **F5: corpus-wide tests hard-code totals** *(ready, S)*.
  - *Known:* five tests broke when six projects were added (44 projects, 70 functions, 6,986 cases), while every per-function assertion passed.
  - *Needed:* assert per-project properties, or derive the totals.
- **F6: one parser for `project.json`** *(ready, S)*.
  - *Known:* `projectSource` and the workbench's `metaOf` each read it, so `ingest` and `entries` had to be wired twice (`6ad38d0`).
- **F7: focus links by label, not by line** *(idea, S)*.
  - *Known:* the chess focus line moved when its files were reformatted.
- **F8: the meaning check's assumptions** *(idea, M)*.
  - *Known:* `agrees` treats any two traps as agreeing, every guest byte is compared, and every function is checked on independent random inputs. Report 10 §4.4 showed the programs absorbing these as defensive contracts.
  - *Needed:* the contract built from domain × observation × relation. T1 forces it for tensors; bringing it back to Typed is this item.
- **F9: an input grammar** *(ready, M)*.
  - *Known:* `casesFrom` draws parameters independently, and `oneOf` picks only scalars. Regex is checked with one fixed pattern, and there is no way to generate a valid chess position.
  - *Needed:* the smallest extension of `inputs` (correlated parameters, `oneOf` over records and buffers, structured generators), measured with C1.
- **F10: IR and language features the designs asked for** *(idea, M each)*.
  - Read-only static tables; `match` on integers; `requires(...)`; `rot` and `fma` IR ops; guarded rules over interval × known-bits facts.
  - Each should come with the program that needs it.
- **F11: a repository `AGENTS.md`** *(decision, S)*.
  - *Known:* three classes of integration failure in IRWB-018 came from conventions agents could not see: tile widths, the formatter, and what the corpus-wide tests already check. Also worth stating: the sandbox EPERM note and Candela's memory limits.
  - *Decision:* it changes every agent session in this repository.
- **F12: the meaning check's statement limit (2e4)** *(idea, S)*.
  - *Known:* chess search and Candela approach or hit it.
  - *Needed:* per-project limits, or a case budget that accounts for cost.

---
- **F13: `applyPass` opens its edit eagerly** *(ready, S)*.
  - *Known:* `beginEdit()` runs for every pass and throws `ir.capability` for an adapter without `rebuild`, even when the pass returns a native value. All sixteen T1 designs found it, but only four implementations fixed it; the merged base (B) did not, because its synchronous path avoids it.
  - *Needed:* open the edit on the first read of `ctx.edit` (I, K, N and P show the change).
- **F14: `optimizeTix` steps carry no reason and no "changed" flag** *(ready, S)*.
  - *Known:* an unchanged pass reports `accepted: true`, so acceptance counts overstate coverage (`split-sum` applies to 32 of the 60 cross-check programs, `inline` to 15). Rejection reasons exist inside the contracts but are not returned.
  - *Needed:* `{pass, accepted, changed, reason?}` in each step.
- **F15: the base's tolerance is a fixed bound** *(ready, M; before or with T2)*.
  - *Known:* B checks |c − r| ≤ 2e-6 + 2e-5·|r| against the origin's f64 on its own sampled cases, "without a worst-case error derivation" (its report). The same rule falsely rejected correct passes in K. E and H rejected on ill-conditioned sampled cases where the origin itself fails the bound. Two designs handle this: P's running first-order error bound accepted every correct pass, and N's "inconclusive when the origin fails".
  - *Needed:* a bound derived from the computation, or the inconclusive rule; treat identical non-finite values as agreeing.
- **F16: unspecified rules in the Tix core** *(ready, S; brief)*.
  - *Known:* fourteen implementations divided on whether an index may share a tensor's name (the Claude cells said no). The brief is also silent on shadowing (`sum(j) a[i, j] + sum(j) b[i, j]` parses as a nested reduction rebinding `j`) and on zero-size extents.
  - *Needed:* state all three in the T2 brief's fixed core, and test them.

## 4. Agent methodology

The experiments around the work. The playbooks are in the go-go-parc vault under `Research/playbooks/agents/`, with scripts in `agent-design-review/`.

- **M1: the harness × model × effort matrix** *(running)*.
  - *Known:* Codex or Pi × Sol or Astra × medium, high or xhigh, 12 cells, on T1 and R1.
  - Pi's own system-prompt text is about 2.3K characters, against Codex's 27.7K. Pi lacks the coding and writing rules that report 10 tied to over-engineering.
  - *Result (T1):*
    - designs: Codex over-engineered less than Pi at the same policy (excess 6.3 against 12.0), and Sol was weaker than Astra in both harnesses;
    - implementations: all correct; size follows the model (Astra 805–1,086 lines, Sol 1,278–1,380, Claude about 1,700).
  - The earlier "Astra reads no skill file" note was an extractor artifact: Astra batches commands, and all twelve Codex cells read docmgr and diary.
- **M2: repeat the cells that differ most** *(idea)*. One run per cell is suggestive, not conclusive.
- **M3: the effect of the review loop** *(running from T1)*.
  - *Unknown:* which review content changes designs and implementations, and whether it does so the same way for every configuration.
- **M4: Claude models in the same matrix** *(ran on T1: Opus and Fable, medium and xhigh designs; medium implementations)*. About 2.97M subagent tokens in all for IRWB-019's Claude cells, judges and reviewer.
- **M6: policy wording for Sol** *(ran on T1: v1, v2, v3)*.
  - *Known:* v3 cuts excess by 1–2 items per cell and over-engineering by about one rubric point, at a fitness cost of 0.5 on average; v2's narrowing rule overrode the brief.
  - *Unknown:* whether v3 should replace v1 in `~/.codex/config.toml` (the user's call), and whether its effect holds over repeated runs (M2).
- **M5: tell designers what is already checked** *(ready)*.
  - *Known:* in IRWB-018, half of each project's test matrix repeated corpus-wide checks, because the designs prescribed it and nothing said what was covered.
