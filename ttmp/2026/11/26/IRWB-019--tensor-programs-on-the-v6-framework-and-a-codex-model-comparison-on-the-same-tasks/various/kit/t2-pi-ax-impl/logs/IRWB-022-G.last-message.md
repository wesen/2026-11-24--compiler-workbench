Implemented IRWB-022-G. `dist/tensor/index.js` now exports `cudaSource`, `runTixCuda`, and `checkLowering`. The backend in `src/tensor/cuda-{source,runtime,run,check}.ts` lowers the current Tix revision, including programs changed by `inline` or `split-sum`.

**All six corpus programs passed the GB10 lowering contract.** Across 86 sampled cases, the largest error used 24.7% of the unchanged f64 tolerance budget, on `conv2d`. The contract rejected a compilable mutant that dropped a reduction tail.

| Full-size program | GB10 kernels, median ms | Local f32 interpreter, ms |
|---|---:|---:|
| matmul | 0.230 | 120,606 |
| softmax | 0.454 | 18,581 |
| layernorm | 0.435 | 32,522 |
| attention | 0.889 | 860,698 |
| mlp | 0.852 | 1,655,120 |
| conv2d | 0.161 | 456,591 |

GPU times exclude startup and transfers. Interpreter times are measured wall times on the shared local machine, not extrapolations.

**Framework and tool changes**
- `src/framework/contracts/differential.ts`: added a batch-only asynchronous specification so a remote evaluator can reuse existing evidence without supplying a dummy synchronous implementation. `src/framework/contracts/README.md` documents it. No other framework code changed.
- `tools/cuda-remote.mjs`: isolated each invocation’s outputs and locked compilation per full-input, compiler-build, and flags key. Evidence replay requires no remote identity lookup.

**Validation:** `npm run build` passed; `node --test tests/tensor/*.test.mjs` passed 31/31, including GPU tests; `node --test tests/framework/*.test.mjs` passed 227/227; `node --test tests/typed/{meaning-memo,parallel,evaluate-analyses,passes,mutate,strategies}.test.mjs` passed 36/36.

No production deviations from the [revised design](ttmp/2026/11/26/IRWB-022-G--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/design-doc/01-lowering-tix-statements-to-cuda-with-a-batched-gpu-meaning-check.md). The [measurement report](ttmp/2026/11/26/IRWB-022-G--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/reference/02-cuda-lowering-results-and-timing-protocol.md) includes individual GPU intervals, output comparisons, and reproduction commands.

**Commits:** `35e01c4` initial design; `bdc6f1c` review revision; `de9177a` framework; `abcbdfd` backend and tool; `9d5130b` tests; `252af7a` measurements. Worktree clean; nothing pushed.
