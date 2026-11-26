## 1

I’ll reread the design and the worktree’s checker code, then trim anything that doesn’t help establish chess correctness or measure compiler gains. I’ll use the docmgr and diary skills to validate and record the revision.

## 2

The existing start and slice functions can drive the whole experiment. I’ll pass depth, budget, and mode to the start function in a buffer and use one Node harness for chess assertions, compiler parity, and instruction counts. The standard corpus loaders still check every function, so the design will keep a small set of valid helper inputs.

## 3

Commit `e1c1ff5e8e49d4519e9d348cc0236d2f7f373508`. Only IRWB-017 changed. The diary is up to date and the commit is local.

- Removed the search wrapper, extra Typed file, and validation API. The host can drive the existing start and slice functions directly.
- Moved slice width out of the options buffer. Depth, budget, and mode are the specialization inputs.
- Replaced per-helper arena sizing and fixture-generation machinery with one small arena size and shared snapshots.
- Removed the second override pipeline and extra coverage accounting. The explicit advanced-search regressions cover that mode.
- Removed Kiwipete, the duplicate perft table, and dedicated divide tooling. The reference fixtures already cover special moves and supply expected counts.
- Removed standalone make/unmake, slice-width invariance, and upstream tuple suites. The remaining checks verify position restoration, chess outcomes, and guest memory.
- Consolidated correctness checks and RV32 instruction measurements into one Node harness with a smaller benchmark matrix.
- Removed custom browser scripts, extra UI prompts, and the prescribed hand-optimized design. The existing workbench views and Node harness support the experiment.
