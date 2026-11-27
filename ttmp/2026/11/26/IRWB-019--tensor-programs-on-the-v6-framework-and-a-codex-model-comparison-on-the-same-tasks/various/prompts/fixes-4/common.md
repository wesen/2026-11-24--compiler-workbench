You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It holds a reusable IR framework (`src/framework/`) in which every pass is checked, with two domains on it. One is Typed, a small statically typed language compiled to 32-bit RISC-V (`src/typed/`). The other is Tix, a tensor language compiled to CUDA (`src/tensor/`).

Your ticket is <ID>. Make three small fixes, each with regression tests. Create the ticket with docmgr ("F24 to F26: kernel entities, the gate's choice, the baseline-key contract"), keep a short diary, and commit each fix separately, with messages starting `<ID>: F<n>`. Do not push.

## The fixes

**F24: the CUDA lowering's correspondence is not checked against its kernels.** An IR type declared with `defineIR` may now provide `entities(value)`, and the contracts manager then compares a correspondence's declared `sourceEntities`, `targetEntities` and entry IDs with that artifact's entities (`src/framework/contracts/analysis-manager.ts`, `validateCorrespondence`). The tensor domain does not use it yet: `CudaIR` in `src/tensor/cuda-contract.ts` enumerates nothing, and the lowering's correspondence maps Tix statements (`fn/statement`) to kernel names.
- Needed: `CudaIR` enumerates its kernels, and `TixIR` (`src/tensor/ir.ts`) its statements, with the same IDs the lowering's correspondence uses, so the manager checks both sides of every lowering.
- Tests: a lowering whose correspondence names a kernel that is not in the source, or leaves one out, is rejected; every corpus program's lowering, fused and unfused, is still accepted (local tests only; the GPU is not needed to build and validate a correspondence, if you find otherwise, say so).

**F25: a run does not say which side of the fusion gate it took.** The fused CUDA source decides at launch, per gated kernel, whether to run it fused or as stage 2's per-statement kernels (`--gate`, `takesGate` in `src/tensor/cuda-runtime.ts`). `checkLowering` checks both sides, but `runTixCuda` does not report which side ran, so a benchmark cannot say what it timed.
- Needed: `runTixCuda`'s result carries, for a source with gated kernels, the side each gated kernel took, as reported by the program itself. Results of sources without a gate are unchanged. Keep the existing fields and their meaning.
- Test: a GPU test (in a file whose name contains `gpu`) that runs one gated program at a shape on each side of the rule and checks the reported side. Keep it short: other agents may share the GPU machine.

**F26: the differential's `baselineKey` contract is unchecked.** In `src/framework/contracts/differential.ts`, a spec's `baselineKey` promises that the generated cases are a function of the key alone; the cases and baseline outcomes are then computed once per key and reused. Nothing checks the promise: a spec whose cases also depend on something outside the key silently reuses stale cases.
- Needed: on a reuse hit, detect that the cases the spec would generate now differ from the stored ones, and reject the check with an error that names the key. Measure what the detection costs on the tensor and Typed checks; if it is significant, say so and propose the cheaper alternative rather than building two.
- Test: a spec whose cases depend on a value outside its key is rejected on the second check; a correct spec is unaffected.

## How

- **Read before changing:** the code in question and its tests (`tests/framework/`).
- **Tests first:** write the regression tests first, run them on the unfixed code, and record in the diary how they fail. Then make the smallest change that passes them.
- **Do not change** any behaviour the fix does not need.
- **Build:** `npm run build` (`tsc`, into `dist/`).
- **Tests:** `node --test tests/<dir>/<name>.test.mjs`; on Node 24, pass files, not a bare directory. Run `tests/framework/*.test.mjs`, `tests/typed/*.test.mjs` and `tests/tensor/*.test.mjs` except files whose names contain `gpu`, plus your own new GPU test file, before your last commit. The GPU machine is reached only through `tools/cuda-remote.mjs`, and needs network access, which your sandbox has. Do not run the full suite (`npm test`): other agents share this machine.
- **Formatting:** TypeScript sources keep the repository's Prettier settings. Run Prettier only on files that were formatted before you changed them.
- **Scripts:** put every probe, scratch test and temporary program you write in your ticket's `scripts/` directory, numbered in the order you write them (`01-name.mjs`), and commit them. Nothing you ran should exist only in a scratch directory or a one-off command.
- **Sandboxed sessions:** a test that spawns `node` can fail with EPERM. Request escalation for that command.
- **Outside your worktree,** use only the GPU machine.

## Your final message

For each fix:
- the commit hash;
- the test that failed before the fix, and how it failed;
- the files changed.

Then the test counts from your last run, and the cost F26's detection adds.
