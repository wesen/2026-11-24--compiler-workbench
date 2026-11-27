import sys
p = sys.argv[1]
s = open(p).read()
def rep(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b)
# §1 function count
rep("- **The fixed kernel** (`kernel.typed`, 155 functions with `math.typed`):",
    "- **The fixed kernel** (`kernel.typed`, with `math.typed` and the entries in `glue.typed`: 155 functions):")
# §4 U readers
rep("| U (`bU`) | 174 | all constant | 31, from `renderPixel` to `traceAll` and 8 scene sections |",
    "| U (`bU`) | 174 | all constant | 31, among them `renderPixel`, `cameraRay`, `tracePath`, `traceAll` and 10 scene sections |")
# §4 stores: out buffer and shared functions
rep("None writes a scene buffer, the GGX table or the sky table, and no store has an unclassified address. `cdlInit` writes only the GGX table and `cdlSky` only the sky table. This is the fact the host promise of §13 checks statically.",
    "None writes a scene buffer, the GGX table or the sky table, and no store has an unclassified address. `cdlInit` writes only the GGX table and `cdlSky` only the sky table. This is the fact the host promise of §13 checks statically. One caveat: the output buffer is a parameter, `out`, so nothing in the program shows that it does not overlap a scene buffer; that has to be part of what the host promises.\n\n**What the entries share.** `cdlRenderSpan` reaches 310 of the 332 functions at r0 (every scene section, through the dispatchers). It shares 10 of them with `cdlSky`: `skyL_wgsl`, which reads U, and nine math functions (`acosf`, `asinPositive`, `perez`, `q_cos`, `q_exp`, `q_floor`, `q_sin`, `safeNorm`, `xyz2rgb`). It shares none with `cdlLayout` or `cdlInit`. A fact that holds while `cdlRenderSpan` runs may be used inside a shared function only if it also holds while `cdlSky` runs (§13).")
# §9 calls bullet
rep("- **Calls.** 200.1 calls per pixel. 102.9 of them have only static arguments (C 25.6, M 77.3) and would disappear entirely.",
    "- **Calls.** 200.1 calls per pixel. 102.9 of them have only static arguments (C 25.6, M 77.3). Those whose callee reads no dynamic memory (`oRow`, `lRow`, `mBase`, …) disappear with their call sequences; those that read the RNG state do not (`rnd(q_k)` has a static argument, the K pointer, and runs 10.7 times per pixel).")
# §10.2 termination wording
rep("The walk terminates because every state is a proper suffix of the traversal, and the specializer terminates because the memo table on states is finite.",
    "The walk terminates because each node is pushed at most once (a tree has no cycles), and the specializer terminates because the memo table holds at most one entry per state and there are finitely many states.")
# §10.4 calls
rep("Calls with static arguments (102.9 per pixel) disappear with their call sequences.",
    "Calls with only static arguments to callees that read no dynamic memory disappear with their call sequences, and calls are not counted as operations.")
# §12 per-region entries
rep("""  /** 'data': copied from the scene table. 'computed': the program computed it (cdlSky), at that revision. */
  readonly origin: { readonly kind: 'data' } | { readonly kind: 'computed'; readonly fn: string; readonly rev: string };
}""", """  /** 'data': copied from the scene table. 'computed': the program computed it (cdlSky), at that revision. */
  readonly origin: { readonly kind: 'data' } | { readonly kind: 'computed'; readonly fn: string; readonly rev: string };
  /** The entries during whose calls the region holds these words (the scene rows: cdlSky and cdlRenderSpan). */
  readonly entries: readonly string[];
}""")
rep("""  /** The entries the promise holds for: the host calls them only with memory as described. */
  readonly entries: readonly string[];             // ['cdlRenderSpan']""", """  /** The entries the promise is made for (each region lists the subset during which it holds). */
  readonly entries: readonly string[];             // ['cdlSky', 'cdlRenderSpan']""")
rep("The GGX table is computed by `cdlInit` and the sky table by `cdlSky`, so they are `kind: 'computed'` with the function and the revision.",
    "The GGX table is computed by `cdlInit` and the sky table by `cdlSky`, so they are `kind: 'computed'` with the function and the revision. Each region lists the entries during which it holds: the five scene buffers and the GGX table are fixed before `cdlSky` and stay fixed through every `cdlRenderSpan`; the sky table holds only during `cdlRenderSpan`, because `cdlSky` writes it.")
# §13 promise text
rep("> During every call of an entry in `facts.entries`, the K record passed to it has, in each region's path field, a pointer to a buffer holding exactly the region's capacity and words, and each scalar field holds its value; and no code the entry runs writes them.",
    "> During every call of an entry in a region's `entries`, the K record passed to it has, in the region's path field, a pointer to a buffer holding exactly the region's capacity and words; each scalar field holds its value; the regions, K and the output buffer do not overlap; and no code the entry runs writes the regions.")
rep("At r0 the check passes: `cdlRenderSpan` reaches stores into the output buffer, K's scratch fields and frame arrays only.",
    "At r0 the check passes: `cdlRenderSpan` reaches stores into the output buffer, K's scratch fields and frame arrays only, and `cdlSky` writes only the sky table, which is not promised during its calls. A store into the output buffer is safe because the promise says the output buffer overlaps no region; the static check cannot show that, so the sampled check's cases lay the buffers out disjointly (the evaluator's `Memory.alloc` does by construction, `evaluate.ts:66`) and the runtime guard, if used, compares addresses too.")
rep("Whether the guard is worth its code is a decision for the device integration (§23).",
    "Whether the guard is worth its code is a decision for the device integration (§25).")
rep("**Scope.** The promise is per entry, unlike the field binding, which applies to every function with a K parameter. `cdlInit` and `cdlSky` write the GGX and sky tables, so the promise cannot hold for them; they stay general (they run once per bind). This is a deliberate difference from `Binding`'s field form (decision D2).",
    "**Scope.** The promise is per region and per entry, unlike the field binding, which applies to every function with a K parameter. The scene rows and the GGX table are promised during `cdlSky` and `cdlRenderSpan`; the sky table only during `cdlRenderSpan`; nothing during `cdlInit`, which runs before the scene is bound. A fold inside a function may use a region only if the region is promised during every entry that reaches the function. At r0 that matters for one function: `skyL_wgsl`, shared by `cdlSky` and `cdlRenderSpan`, reads U, which is promised during both, so it may fold. A function that read the sky table and were reached from `cdlSky` would need a clone for `cdlRenderSpan` before folding. This is a deliberate difference from `Binding`'s field form (decision D2).")
# §14 branches wording
rep("On B-01, Phase 1 should remove the branches `renderPixel` takes on U (mode, spectral, motion), the U reads of `cameraRay`, `tracePath`'s settings and `traceAll`'s counts. That is the control mode's static share: about 10% of the operations (`memoryShare` 10.3 in the control mode). Phase 1 is necessary groundwork, and by itself it is a percent result.",
    "On B-01, Phase 1 should remove the branches `renderPixel` takes on U and on K's flags (integrator mode, `K.spectral`, motion keys), the U reads of `cameraRay`, `tracePath`'s settings and `traceAll`'s counts. That is roughly the control mode's static share: 10.3% of the operations are M in the control mode. Phase 1 is necessary groundwork, and by itself it is a percent result.")
rep("The rewrite then replaces each folded `load` by its constant and each folded `caddr` by nothing (its users read the folded load).",
    "The rewrite then replaces each folded `load` by its constant; the folded `caddr` under it disappears with it. A `ptr` value is never materialized: `get q_bO` stays where it is not folded away, and `dce` removes the assignment once nothing reads it.")
# §20 success criterion
rep("1. **Measure the two parts separately** after each phase, with the profile of §9 on the specialized revision: operations, static and residual, in `s<k>_` functions and in kernel functions. Automatic specialization succeeds where the kernel's residual fraction approaches the sections'.",
    "1. **Measure the two parts separately** after each phase, with the profile of §9 on the specialized revision: operations, static and residual, in `s<k>_` functions and in kernel functions. Automatic specialization has matched the hand staging when the kernel's remaining work is as little static as the sections' is: at r0 on B-01, 2.8 of the sections' 26.3 operations per pixel are M (11%), against 1,999 of the kernel's 3,884.2 (51%).")
# D2, D3
rep("| D3 | an online specializer (SCCP extended with memory, then versions) rather than an offline BTA first | offline BTA with annotations | measurement 3: a monovariant offline division is worth 1.1–1.2×, the polyvariant one up to 2.7–3.0× on B-01 | proposed |",
    "| D3 | an online specializer (SCCP extended with memory, then versions) rather than an offline BTA first | offline BTA with annotations | measurement 3: a monovariant division is worth at most 1.68× on any scene (1.12–1.21× on B-01), the polyvariant one up to 2.66–3.04× on B-01 and 4.51–4.94× on R-01 | proposed |")
rep("| D2 | the promise holds per entry (`cdlRenderSpan`), not for every function | every function with a K parameter, as the field binding does | `cdlInit` and `cdlSky` write the tables; a promise for them would be false | proposed |",
    "| D2 | the promise holds per region and per entry, not for every function | every function with a K parameter, as the field binding does | `cdlInit` runs before the scene is bound and `cdlSky` writes the sky table; a promise for every function would be false | proposed |")
open(p, 'w').write(s)
print('ok')
