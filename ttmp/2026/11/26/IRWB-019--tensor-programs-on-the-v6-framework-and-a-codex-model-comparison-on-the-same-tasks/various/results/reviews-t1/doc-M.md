# Review of doc-M

## Must change

1. **The eps rule is keyed to the corpus.** The design says "For the corpus epsilon parameter `eps: f32[1]`, supply positive `2^-10`" and "Fail a tolerance check on any nonfinite observation". The generator cannot depend on a corpus parameter's name. Without a defined rule, a signed eps makes `sqrt` produce NaN and rejects a correct `split-sum`. State, in terms of the signature, which parameters receive positive values.
2. **Budget.** The design says "Cap samples at … 2M scalar evaluation steps per call; record a failed check if … a required execution cannot finish". The cap is applied when shapes are admitted, and `split-sum` adds outer-loop steps. A correct candidate on a case near the cap is therefore rejected. Say how the candidate's budget is set.

## Cut

1. The composition table rows "`exact(origin, output)`" for `inline` and "Also `tolerance(origin, output)`" after a split, together with "the accepted-history flag". Exact agreement with `input`, checked on the same origin-derived cases, already implies both.
2. "linear implication (eliminate shape variables from constraints plus the negated bound) for dependent dimensions" and "At call time solve `A·s = actual - constant` and recheck *all* axes". No corpus program needs this solver. It also adds a call-time error contract beyond compile errors with `line:col`.
3. "Measure max error on the six programs, record any false rejection". This is a measurement plan.

## Framework changes

- **`applySampledPassSync` in `passes/sampled-sync.ts`:** needed, because the fixed `optimizeTix` is synchronous, and correctly placed. Driving an edit-based pass through `beginEdit()` and `prepare()` (which I confirmed is synchronous) reuses the existing graph-edit path, and your adapter has `rebuild`, so no lazy-edit change is needed. Preflighting the supported `TransformationDefinition` subset costs some code, but it keeps unsupported clauses from being silently satisfied.
- No missed change.

## Keep

Keep the index graph as native storage with a real `rebuild`. It is the one design that exercises the framework's edit, prepare and diff path end to end. Also keep the deterministic shape schedule and value profiles, including the K = 7 witness (`0x3f800002`, verified).
