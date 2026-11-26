# Review of doc-F

## Must change

1. **Case selection is not defined.** "Try uniform shape-name assignments, single-name perturbations and bounded mixed assignments from `{1,2,3,4,5,6,8,9}`, in a fixed order … reserve half for nonuniform assignments if there are multiple names and feasible choices. … Prioritize block-boundary values". The design never states the order, the perturbation rule or the reservation rule, so the implementer must invent the domain. Write it down.
2. **Budget.** "If any function has no cases, or an evaluated case exhausts its budget, the changed candidate cannot be accepted." Cases are screened on r0, and `split-sum` adds outer accumulation steps. A correct candidate near the 250K-step cap is therefore rejected. Say how the candidate's budget is set.

## Cut

1. Inline's extra checks: "check exact against the immediate predecessor and against r0 if still in exact mode. After an accepted tolerant edit, additionally require the r0 tolerance check". Exact agreement with the predecessor, on the same r0-derived cases, already implies both.
2. "At invocation, solve the fixed system exactly … uniquely determined over the rationals (full column rank)", "carry residual obligations on symbolic dimensions into shape binding" and "keep the original invocation-domain obligations". No corpus program needs this solver. It adds a call-time error contract beyond compile errors with `line:col`.

## Framework changes

- **`applyNativePassSync` with shared native-candidate preparation:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It is minimal and in the right file.
- **`contracts/`: "an explicit context-free, synchronous invariant definition and a `verifyPostconditionsSync` runner":** not needed. Without `decide`, a differential invariant's `check` is already synchronous, and `runDifferential(differentialSpec(inv), ports)` returns the verdict. A `CheckResult` gate in the pass entry suffices. A new invariant kind plus a second postcondition evaluator is more than the gap requires.
- No missed change.

## Keep

Keep the length-six reassociation witness (`0x3f800001` against `0x3f800000`, verified) inside the domain, and the shape-valid mutants whose rejection is asserted as semantic rather than structural. Also keep the tolerance anchored at r0's f64.
