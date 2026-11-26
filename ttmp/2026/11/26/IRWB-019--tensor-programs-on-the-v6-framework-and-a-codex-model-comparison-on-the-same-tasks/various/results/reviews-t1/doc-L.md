# Review of doc-L

## Must change

1. **Which origin.** §6.4 says the reference is "the f64 result of the origin (r0, the compiled program)". But "`TixProgram` is the framework artifact `Artifact<TixValue>`", and "`optimizeTix` runs `applyTixPass(cur, PASSES[name], {origin: program})`". So the reference is whatever program was passed in. Decide which you mean. If it is r0, the program handle must carry r0.
2. **Definition identity on the manager path.** "`meaningKept(relation)`" and "`meaningContract(relation)`" are factories, and §11 runs both the sync and the async path in one test. If a call builds a second object with the same id@version, `ContractRegistry.register` throws "cannot be redefined". `applyPass` then reports `contractRejected`. Say that each factory returns one cached object per relation.

## Cut

1. "The implementation will measure, through F3's `worst`, the largest `err` of `split-sum` on every corpus program", and the test that checks "`worst < τ/4`". Both are measurement work. Showing that a pass is accepted or rejected needs neither.
2. "A GPU stage will choose its own block size through the parameter". This is later-stage reasoning. B = 4 needs no justification from it.

## Framework changes

- **F1, lazy `ctx.edit`:** needed. I confirmed that the `Edit` constructor throws `ir.capability` without `rebuild`, and your async parity test runs `applyPass` on a read-only adapter. The change is minimal and in the right file.
- **F2, `applyPassSync`:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It is minimal, refuses `needs`/`preserves` and thenables, and is in the right file.
- **F3, `measure`/`worst` in `differential.ts`:** not needed for stage 1. It changes `Decided` and `DifferentialEvidence`, which Typed's memo replay and worker paths also carry. Drop it.
- No missed change.

## Keep

Keep the normwise tolerance, with the rule that a case is inconclusive when the origin's own f32 result fails it, and τ = 2⁻¹³ backed by the probe. Keep case 1, which sets every shape name to 7 and so guarantees a ragged block. Keep the two mutants, each a realistic class of bug that produces valid IR.
