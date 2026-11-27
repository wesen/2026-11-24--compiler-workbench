**IRWB-022-K is complete.** The built tensor API exports `cudaSource`, `runTixCuda` and `checkLowering`. All six corpus functions passed the GPU postcondition against the original f64 reference, both before and after optimization. The split-sum test reproduced the expected f32 words, and the postcondition rejected a compiled CUDA mutant that dropped the reduction tail. [Public API](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-ah-irwb-022-k/src/tensor/index.ts) · [Revised design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-ah-irwb-022-k/ttmp/2026/11/26/IRWB-022-K--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/design-doc/01-checked-cuda-lowering-for-tix.md) · [Results and raw measurements](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-ah-irwb-022-k/ttmp/2026/11/26/IRWB-022-K--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/reference/02-cuda-lowering-results-and-framework-findings.md)

| Program | GB10 kernels, ms | Local f32 interpreter, s |
|---|---:|---:|
| matmul | 0.2497 | 128.819 |
| softmax | 0.4528 | 15.317 |
| layernorm | 0.4354 | 24.689 |
| attention | 0.9828 | 195.979 |
| mlp | 0.9924 | 812.828 |
| conv2d | 0.1700 | 405.719 |

GPU times are medians of three CUDA-event intervals after a warm-up in the same process. `runTixCuda` also preloads every kernel before its first event. Interpreter times are single full-size calls after a small warm-up.

**Framework and runner changes.** The sole framework edit lets remote checkers decide a batch without implementing synchronous callbacks. It preserves per-case evidence reuse and guards synchronous and worker-side evaluation. The only design deviation was expressing the planned overload as a TypeScript union parameter. The runner now isolates each invocation’s files and locks compilation per cache key. Two simultaneous cold jobs compiled once and returned identical output hashes. [Framework change](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-ah-irwb-022-k/src/framework/contracts/differential.ts) · [CUDA postcondition](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-ah-irwb-022-k/src/tensor/cuda-contract.ts) · [Remote runner](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-ah-irwb-022-k/tools/cuda-remote.mjs)

**Validation**

| Command | Result |
|---|---|
| `npm run build` | Passed |
| `node --test tests/tensor/*.test.mjs` | 29 passed |
| `node --test tests/framework/*.test.mjs` | 227 passed |
| `node --test tests/typed/{meaning-memo,parallel,passes,program,mutate,strategies}.test.mjs` | 37 passed |
| `node --test tests/typed/{evaluate-analyses,tape,specialize,f32,bytecode-vm,candela}.test.mjs` | 22 passed, one opt-in Candela O2 test skipped |

**Commits:** `160f768` initial design and probe · `7b3dc67` review revisions · `c7824d4` CUDA emission and execution · `6f94de2` checked lowering and tests · `a441c31` measurements and ticket closure. The worktree is clean.