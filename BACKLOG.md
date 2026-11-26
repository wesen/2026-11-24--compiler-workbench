# Things we can work on: the v6 framework and the workbench

A worklist of research tasks and fixes for `src/framework/` (the v6 IR framework), the Typed → RV32 domain, the tensor domain, and the workbench. Each item says why it is worth doing (with the evidence), how success is measured, and what it depends on. Keep it current: move items between sections, and link the ticket when one is opened.

**Status:**
- **running:** agents are on it;
- **ready:** it can be briefed now;
- **prep:** the coordinator must build something first (a benchmark, a held-out set);
- **decision:** it needs the user's call;
- **idea:** not yet sized.

**Size:** S = one agent-session, M = a design plus an implementation round, L = several stages.

## 1. Tensor track (IRWB-019): a second domain on the same framework

Tix (index notation) → `tensor` IR → CUDA on the GB10 (`ssh manuel@bling.local`, `tools/cuda-remote.mjs`). The primary result of every stage is the list of changes `src/framework` needs.

| Item | Status | Size | Measure | Depends on |
|---|---|---|---|---|
| **T1** Tix front end, IR as a v6 artifact, f32/f64 evaluators, contract with exact and tolerance relations, `inline` and `split-sum` passes, six-program corpus (IRWB-020, 12 configurations) | running | M | hidden acceptance suite (bit-exact f32, f64, errors, passes); framework changes needed | — |
| **R1** research design: derive streaming attention (online softmax, FlashAttention form) by checked rewrites (IRWB-021, 12 configurations) | running | M | blind rubric: mathematical correctness, derivation completeness, the new reduction construct, checking, experiment | — |
| **T2** lowering to a kernel IR, CUDA C, one kernel per statement, run on bling, GPU-vs-f64 contract with tolerance | ready after T1 | M | GPU outputs within tolerance on the corpus; compile and run cost per check; framework changes for a remote engine | T1 |
| **T3** checked fusion: elementwise, epilogue, reductions (softmax, layernorm), with many-to-one correspondence | idea | M | kernel count and GPU time against T2; every fusion accepted by the contract | T2 |
| **T4** tolerance calibration with mutants: the floating-point version of C1 | idea | M | miss rate of the tolerance relation against mutant class and case count | T1 |
| **T5** implement R1's derivation: the streaming attention kernel derived, not hand-written | idea | L | GPU time and bytes moved against T2's unfused attention and a hand-written streaming kernel | R1, T2, T3 |
| **T6** tiled contractions (shared memory) as strategies, against cuBLAS | idea | M | matmul GFLOP/s against cuBLAS on the GB10 | T2 |
| **T7** autotuning under noisy cost (GPU timings), with the strategy layer | idea | M | regret against an exhaustive search; repeatability | T6 |
| **T8** ONNX importer into Tix (optional, for real models; no Python) | idea | M | the operators covered; models imported | T1 |

## 2. Research programmes on the Typed → RV32 domain

The six programs added in IRWB-012 to 017 (bytecode VM, SHA-256/ChaCha20, LZ, regex, f32 DSP, chess) turned several of the earlier programmes into tasks with objective metrics.

| Item | Programme | Status | Size | What and why | Measure |
|---|---|---|---|---|---|
| **D1** why `speed` slows the bytecode VM | D (cost attribution) | ready | S–M | `speed` takes Fibonacci from 7,678 to 9,286 RV32 instructions and checksum from 6,874 to 8,218 (IRWB-012). Credit the extra instructions to a decision through correspondence, then fix it. | VM instructions at or below r0; corpus totals with no regression; parity clean |
| **D2** missed optimizations from provenance | D | ready | M | Regex after `speed`: 8,040 instructions, against the reference compiler's 6,628. 18 of simplify's 27 rules never fire on the corpus. Find hot instructions that no rule touched, propose rules, verify them, add them. | instructions on the six programs and the corpus; every rule verified |
| **B1** specialize the VM on its bytecode (a first Futamura projection) | B | ready | M–L | The hand-specialized loops take 75 and 74 instructions, against 7,678 for the general VM. Scalar specialization does almost nothing: FFT length 4,065 → 4,064; LZ chain limit −0.06%. Constant-memory partial evaluation of the dispatch loop. | VM instructions against 75 and 7,678; code size; meaning check passes |
| **B2** the same on Candela: specialize the renderer on its scene buffers | B | idea | L | Scene-index specialization gave −58% code but only 5–6% fewer instructions per pixel, because the buffers are still interpreted. | instructions per pixel; frames bit-identical |
| **A1** e-graph over value trees, with only verified rules merging classes, and RV32-cost extraction | A | decision | L | If most value-level edits are local rewrites, a whole function's equivalence can be assembled from per-rule proofs. Needs bit-vector reasoning: a small decision procedure, or z3 compiled to Wasm (downloaded code: the user's call). | instructions against today's simplify/fold; share of value edits with proofs |
| **A0** measurement first: what share of O2/`speed` edits are local value rewrites | A | ready | S | Tests A1's founding hypothesis before building anything. | the share per pass and per program |
| **C1** calibrated gate | C | prep | M | The gate uses 40 cases by convention. Measure, per mutant class, how often inputs expose each bug on the six programs; adaptive case counts; boundary and coverage inputs. The coordinator must prepare a held-out mutant set. | miss rate on held-out mutants at a fixed case budget |
| **E1** incremental checking per function | E | prep | L | With content-addressed function parts, the cost of checking one edit should not grow with program size. The coordinator must write an edit-stream benchmark (chess, Candela). | cost per edit against program size; suites green |

## 3. Framework and workbench fixes found by agents (small, concrete)

| Item | Status | Size | Evidence | Fix |
|---|---|---|---|---|
| **F1** one cross-engine check (evaluator × RV32 image × reference compiler, calling signatures handled) | ready | S–M | Five of six IRWB-012..017 test files wrote the same private harness; P2.6 omitted `signatures` and an f32 entry looked 100% wrong (IRWB-018 step 10) | a framework call; delete the copies; measure test lines removed |
| **F2** `imageFromCode` signatures: required, or carried with the compile result | ready | S | P2.6 / `dot3` (fixed in `d2e198f` by passing them) | make the omission impossible |
| **F3** `tools/reference-check.mjs` ignores its project argument | ready | S | four of six implementers worked around it | honour the argument |
| **F4** `wrapProse` mis-wraps already-wrapped list items, so `tools/format-corpus.mjs` refuses the file | ready | S | chess `notes.md` (IRWB-018 step 10) | wrap list items as units |
| **F5** corpus-wide tests hard-code totals (44 projects, 70 functions, 6,986 cases) | ready | S | five tests broke when six projects were added; every per-function assertion passed | assert per-project properties, or derive the totals from the corpus |
| **F6** one manifest parser for `project.json` (`projectSource` and the workbench's `metaOf` each read it) | ready | S | `ingest`/`entries` had to be wired in both (`6ad38d0`) | a single parser and type |
| **F7** focus links by label, not by source line | idea | S | the chess focus moved when its files were reformatted | label-based focus |
| **F8** the meaning check: `agrees` treats any two traps as agreeing; every guest byte is compared; every function is checked on independent random inputs | idea | M | report 10 §4.4: the programs absorbed these properties as defensive contracts | the contract from domain × observation × relation (the tensor track's T1 forces it) |
| **F9** input grammar: correlated parameters, `oneOf` over records and buffers, generators for valid structured inputs | ready | M | regex checked with one fixed pattern; LZ only at maximum size; no way to generate chess positions | the smallest extension of `inputs`; measured with C1 |
| **F10** IR and language features the designs asked for: read-only static tables, `match` on integers, `requires(...)`, `rot`/`fma` IR ops, guarded rules over interval × known-bits facts | idea | M each | IRWB-018 design reviews | one at a time, each with the program that needs it |
| **F11** a repository `AGENTS.md`: tile widths, the formatter, what the corpus-wide tests already check, the sandbox EPERM note, Candela memory limits | decision | S | IRWB-018: three classes of integration failure came from conventions agents could not see | write it (it changes every agent session in this repository) |
| **F12** the statement limit (2e4) of the meaning check | idea | S | chess search and Candela runs hit or approach it | per-project limits, or a cost-aware case budget |

## 4. Agent methodology (the experiments around the work)

| Item | Status | Measure |
|---|---|---|
| **M1** the harness × model × effort matrix (Codex/Pi × sol/astra × medium/high/xhigh) on T1 and R1 | running | blind design scores; hidden-suite results; behaviour from transcripts |
| **M2** repeat the cells that differ most (single runs are not conclusive) | idea | variance per cell |
| **M3** the effect of the review loop: what review content changes designs and implementations | running (from T1) | design score before and after revision; hidden-suite results |
| **M4** Claude models in the same matrix | idea | the same measures |
| **M5** implementers' over-testing: tell designers what is already checked | ready | test lines and duplicated layers per project (IRWB-018: half of each test matrix repeated corpus-wide checks) |

The playbooks for running these are in the go-go-parc vault, under `Research/playbooks/agents/`, with scripts in `agent-design-review/`.
