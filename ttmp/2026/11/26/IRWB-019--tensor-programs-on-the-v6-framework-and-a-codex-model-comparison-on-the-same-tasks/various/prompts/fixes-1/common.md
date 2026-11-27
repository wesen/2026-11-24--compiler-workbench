You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24): a reusable IR framework (`src/framework/`) in which every pass is checked, with two domains on it. One is Typed, compiled to RISC-V. The other is Tix, an index-notation tensor language (`src/tensor/`) compiled to CUDA for an NVIDIA GB10 GPU.

Your ticket is <ID>. Make three small fixes, each with a regression test. Create the ticket with docmgr ("framework and tensor fixes F14, F19, F20"), keep a short diary, and commit each fix separately, with messages starting `<ID>:`. Do not push.

## The fixes

**F14: `optimizeTix` steps carry no reason and no "changed" flag.** `optimizeTix` (`src/tensor/index.ts`) returns `steps` of `{pass, accepted}`. A pass that changes nothing reports `accepted: true`, so acceptance counts overstate how often a pass applies. A rejection's reason exists inside the contract error, but it is not returned.
- Needed: each step is `{pass, accepted, changed, reason?}`. `reason` is present when the step was rejected, and it says what disagreed (the first counterexample's reason).
- Keep `accepted`'s meaning exactly as it is. External test suites check `steps.length` and `s.accepted` on programs where a pass may not apply.
- Update the existing assertion in `tests/tensor/passes.test.mjs` that compares a whole step.

**F19: concurrent cold checks both issue a batch.** The CUDA lowering check (`src/tensor/cuda-contract.ts`) runs its cases on the GPU in one batch, through the differential contract's `decide` (`src/framework/contracts/`). Its memo records verdicts only after a batch completes. So two concurrent checks of the same (baseline, function, subject) both send a batch.
- Needed: concurrent checks with the same key share the in-flight batch.
- Put the change where the memo is, and keep it general. Failure must not be cached: a check that follows a failed batch retries, as now.
- `tests/tensor/cuda.test.mjs` has a counting fake engine that you can reuse.

**F20: `tools/cuda-remote.mjs` cannot link libraries.** A cuBLAS baseline needs `-lcublas`, so it had to run over `ssh` directly, outside the tool's lock and compile cache.
- Needed: a repeatable `--link <lib>` option. It is part of the build cache key, and the tool's header documents it.
- Show that it works with a small probe in your ticket's `scripts/` directory: a program that calls `cublasSgemm` on the GPU machine and checks a small product against a CPU computation. Report the result.

## How

- **Read before changing:** the code in question, and the header of `tools/cuda-remote.mjs`.
- **Tests first:** for each fix, write the regression test first, run it on the unfixed code, and record in the diary how it fails. Then make the smallest change that passes it.
- **Do not change** the f32 meaning, the relations the gates use, or any other behaviour the fixes do not need.
- **Build:** `npm run build` (`tsc`, into `dist/`).
- **Tests:** `node --test tests/<dir>/<name>.test.mjs`; on Node 24, pass files, not a bare directory. Run `tests/framework/*.test.mjs` and `tests/tensor/*.test.mjs` before your last commit. Do not run the full suite (`npm test`): other agents share this machine.
- **The GPU machine** is shared with seven other agents. Keep runs short, and do not use `--timed`.
- **Sandboxed sessions:** a test that spawns `node`, or the `ssh` to the GPU machine, can fail with EPERM or a network error. Request escalation for that command.
- **Outside your worktree,** use only the GPU machine.

## Your final message

For each fix:
- the commit hash;
- the test that failed before the fix, and how it failed;
- the files changed.

Then the result of the cuBLAS probe, and the test counts from your last run.
