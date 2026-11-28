---
Title: E1 measurement design
Ticket: IRWB-066
Status: active
Topics:
    - framework
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/passes/transformation.ts
      Note: The shared runner still obtains a generic IR transaction.
    - Path: repo://ttmp/2026/11/28/IRWB-066--e1-benchmark-and-unused-engines/scripts/01-e1.mjs
      Note: Reproduces the E1 edit stream and checks matching facts and verdicts.
ExternalSources: []
Summary: Paired Typed edit-stream benchmark and R3 adoption gate.
LastUpdated: 2026-11-28T03:39:32.594958463-05:00
WhatFor: ""
WhenToUse: ""
---

# E1 measurement design

## Benchmark

Input is valid Typed r0 blocks from the named corpus programs. Apply distinct cumulative swaps of the two operands of an integer add whose operands are local reads or constants. These operands have no effects or traps, and i32 addition is commutative. Verify the changed part set for each edit. Exclude loading, editing, and artifact construction from both clocks.

Check the same CFG, dominators and loops and the same generated meaning cases in each configuration. Today's manager receives the whole artifact. The runtime asks for one task per function per analysis and one meaning task per entry function. Analysis tasks read the function-part hash and project that part only when needed. Meaning tasks read the existing closure key so caller checks are invalidated too. Use the current evaluator and differential replay on both sides. Measure the cost of supplying dependency keys and collecting all requested results. Compare facts and case totals outside the clock.

A whole-program runtime task would need fewer registrations but would invalidate on every edit. Per-function tasks directly exercise the proposed cache boundary. Reusing the Typed closure key also includes frame-array mode and avoids implementing another dependence analysis. Single-part projections feed local analysis algorithms directly because whole-program IR validation requires call targets. Matching the manager's outputs checks this projection.

Alternate measurement order and use distinct case seeds per repetition to avoid reusing differential verdicts across campaigns. Retain the ordinary default 40 cases per root. Report all samples and medians. Interpret R3's gate as requiring per-edit work to stay approximately flat as programs grow, with a growing advantage over the existing path. Merely lowering the constant cost of a size-dependent sweep is insufficient. Evaluate the recorded spread and same-edit comparisons when judging the trend.

## Engine disposition

Move the runtime if the gate fails. Moving preserves the conformance usage, unlike deletion. Move the graph pattern and rewrite scheduler and use the existing stdlib term shape as Typed's rule listing pattern. Keeping the graph conversion would retain an approximate representation of structural repeats.

Keep the transaction implementation where the shared transformation runner can use it. Its lazy `ctx.edit` is backed by `View.beginEdit`. Keep traversal's shared implementation while the in-scope view changes leave its other public queries in place. Moving either module wholesale would create a framework-to-labs dependency.

## Matched chess sizes

The intact programs expose actual whole-project costs, but the edited function and number of affected roots differ. Add a controlled chess comparison as well. Pick an eligible chess function without callers, preferring the smallest call closure, and hold its two edits fixed. Compare its closed subprogram, a closed subset near the midpoint of function counts, and full chess. Preserve the global frame-array flag across sizes. In each, check all the functions present. This holds the edited work and invalidated meaning roots constant while adding unaffected functions. Repeating the intact-project comparison alone would confound size with evaluation cost.
