Commit `e1c1ff5e8e49d4519e9d348cc0236d2f7f373508`. Only IRWB-017 changed. The diary is up to date and the commit is local.

- Removed the search wrapper, extra Typed file, and validation API. The host can drive the existing start and slice functions directly.
- Moved slice width out of the options buffer. Depth, budget, and mode are the specialization inputs.
- Replaced per-helper arena sizing and fixture-generation machinery with one small arena size and shared snapshots.
- Removed the second override pipeline and extra coverage accounting. The explicit advanced-search regressions cover that mode.
- Removed Kiwipete, the duplicate perft table, and dedicated divide tooling. The reference fixtures already cover special moves and supply expected counts.
- Removed standalone make/unmake, slice-width invariance, and upstream tuple suites. The remaining checks verify position restoration, chess outcomes, and guest memory.
- Consolidated correctness checks and RV32 instruction measurements into one Node harness with a smaller benchmark matrix.
- Removed custom browser scripts, extra UI prompts, and the prescribed hand-optimized design. The existing workbench views and Node harness support the experiment.