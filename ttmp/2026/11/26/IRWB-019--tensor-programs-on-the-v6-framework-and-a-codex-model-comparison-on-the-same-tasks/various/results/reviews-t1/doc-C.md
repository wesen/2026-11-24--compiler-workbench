# Review of doc-C

## Must change

1. **Layernorm always fails tolerance.** The design combines "`layernorm` with gamma, beta and `eps[0]`", the inputs "signed zeros, seeded signed values in `[-1,1]`", and the rule "Nonfinite observations reject the tolerant check". Zero inputs give `0/sqrt(0)`, which is NaN, and a negative eps gives NaN too. So the correct `split-sum` on a corpus program is always rejected. Constrain eps, or define how a non-finite origin reference is handled.
2. **Undefined invariant.** "an interface/shape-obligation invariant" is never specified. Say what it checks and on which ports, or drop it.
3. **Budget.** "Reject a changed candidate if … an evaluation exceeds the check budget". Cases are screened on the origin, and `split-sum` adds fold steps, so a correct candidate near the cap is rejected. Say how the candidate's budget is set.
4. **Case selection.** "seeded mixed choices from the same set … Include unequal axes, zero/one extents and lengths around block boundaries where legal". No rule says how the shapes are chosen or how many there are.

## Cut

1. "whether an approximate change has been accepted" and inline's extra origin checks ("it also uses the origin as the exact baseline … additionally checks the origin in f64"). Exact agreement with the input on the same origin-derived cases already implies both.
2. "a full-column-rank system handles `N`, `2*N+1`, and coupled equations", "retain any remaining shape-dependent conditions for call preflight" and "Keep source shape obligations across rewrites". These add a solver and a call-time error contract.

## Framework changes

- **Native-only `definePass` mode:** needed. `applyPass` opens an edit eagerly, and your sync/async parity tests use a read-only adapter. Minimal and correctly placed.
- **`applyNativePassSync`:** needed and correctly placed.
- **`verifyPureTransformationSync` in `contracts/`:** not needed. A differential invariant without `decide` already checks synchronously, and `runDifferential(differentialSpec(inv), ports)` gives the verdict, so a `CheckResult` gate suffices. A second contract evaluator would have to track the manager's semantics.

## Keep

Keep the nine-element witness in the domain (`0x3f900000` against `0x3f900002`, verified). Keep the rule that mutants must reach the real contract on valid IR.
