---
Title: E1 results and engine disposition
Ticket: IRWB-066
Status: active
Topics:
    - framework
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/ir/view.ts
      Note: The traversal and edit dependencies retained in the framework.
    - Path: repo://src/labs/runtime.ts
      Note: Final home of the runtime.
    - Path: repo://ttmp/2026/11/28/IRWB-066--e1-benchmark-and-unused-engines/scripts/01-e1.mjs
      Note: Reproduces the paired measurements.
ExternalSources: []
Summary: Per-edit cost measurements, engine disposition, and acceptance results.
LastUpdated: 2026-11-28T03:39:34.292551252-05:00
WhatFor: ""
WhenToUse: ""
---

# E1 results and engine disposition

The runtime stays available in labs. It reused analysis and meaning results, and it was faster on the larger inputs. Its median cost still grew from 138.27 to 222.67 ms per edit when the same chess work ran against more unaffected functions. That fails the R3 gate for adopting it on the checking path.

## Measurement

The benchmark compares Typed's current revision-keyed `AnalysisManager` with runtime tasks keyed by function part and transitive call closure. Both paths compute CFG, dominators, and natural loops, and use Typed's real evaluator and differential verdict replay at the standard 40 cases per root. Every pair asserts equality of all analysis facts and sampled case totals. The script validates each edit as Typed blocks and verifies that it changed only the selected value record. Each edit swaps distinct trivial operands of an i32 addition. Two distinct sites per seed lets the smallest sample share the same stream length. Three seeds provide repeated paired timings with an observable spread and avoid reusing verdicts across repetitions. Artifact construction and the initial warm check are outside the clock. Deriving the dependency keys, looking up tasks, computing facts, and checking meaning are inside the clock. Measurement order alternates within each seed.

The intact runs exercise real program sizes, with different edited functions and affected entry counts. The controlled runs edit the same two sites in `chessPerft` across three nested call-closed chess subsets with the same frame-array flag. It has no other callers. Every reported controlled edit reran exactly three analysis tasks and one meaning task. All 42 paired edits matched, with zero disagreements. Candela loaded in 4.99 s, checked 13,280 cases per revision, and reported 18–28 inconclusive cases depending on seed in both arms.

| Program | Functions | Statements | Values | Edits | Today ms/edit, median (range) | Runtime ms/edit, median (range) | Runtime / today |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| call-chain | 3 | 7 | 25 | 6 | 45.84 (29.50–81.42) | 43.20 (28.83–65.02) | 0.942 |
| bytecode-vm | 1 | 123 | 247 | 6 | 75.30 (44.59–97.28) | 67.08 (48.02–136.02) | 0.891 |
| chess-search | 50 | 1647 | 3520 | 6 | 2370.38 (1497.27–3051.76) | 1061.38 (930.13–1464.34) | 0.448 |
| candela | 332 | 12358 | 37220 | 6 | 18454.00 (11872.17–32374.10) | 683.90 (569.94–1193.09) | 0.037 |
| chess-controlled | 29 | 936 | 1937 | 6 | 389.81 (292.45–637.98) | 138.27 (109.80–216.94) | 0.355 |
| chess-controlled | 40 | 1183 | 2472 | 6 | 492.85 (330.56–696.09) | 200.96 (127.55–353.94) | 0.408 |
| chess-controlled | 50 | 1647 | 3520 | 6 | 817.26 (426.77–1297.34) | 222.67 (120.74–341.44) | 0.272 |

Bytecode-vm has one function with 123 statements. Call-chain has three functions with seven statements, so function count alone understates the size of the former. The intact chess edit changes five reachable-root verdicts, while the Candela edit changes one. That difference helps explain why the Candela runtime was faster than the chess runtime despite the larger program. The controlled chess comparison holds that work fixed. From 29 to 50 functions, the current median roughly doubled and the runtime median grew by 61%. The last column shows a relative benefit with the extra unaffected code. It does not show flat or falling absolute checking cost. Sample ranges overlap, so this is an engineering decision for the measured path, not a tight estimate of the growth rate. The controlled run overlapped the end of the Candela campaign on the shared host.

The runtime still enumerates requested tasks and derives closure keys over the revision. An invalidated root also goes through the existing invariant manager on the whole artifact. These costs remain after unaffected analysis and meaning bodies hit the cache. The benchmark probes the measured CFG and meaning workload, not every Typed analysis or a complete optimization pipeline.

Raw samples are in [intact-corpus JSONL](../various/01-e1-output.jsonl) and [controlled chess JSONL](../various/02-e1-controlled-chess.jsonl). To reproduce, build with `npm run build` and run from the ticket's `scripts/` directory.

```sh
node 01-e1.mjs
node 01-e1.mjs chess-controlled
node 02-summarize.mjs
```

The summary command reads the checked-in samples. The runtime had already been probed before the move. Its relocated entry point also passed the call-chain smoke run.

## Engine disposition

| Module | Decision and reason |
| --- | --- |
| `core/{runtime,query,records}.ts` | Moved to labs with the runtime tutorial and tests. Labs retain the working query example, so deletion would drop coverage and a working use. |
| `ir/{patterns,rewrites}.ts` | Moved to labs with both graph tutorials and lab tests. Typed lists its existing stdlib term pattern directly. The old conversion's shape approximation was the only Typed dependency on the graph engine. |
| `ir/transactions.ts` | Kept in the framework. The shared runner's lazy `ctx.edit` uses `view.beginEdit()`. Relocating it would either add a framework dependency on labs or require changing that transformation API. |
| `ir/traversal.ts`, `ir/view.ts` | Kept in the framework. The view delegates all its traversal queries to this module. `IRReader` binds those queries, and `IRView` declares them. The scope covers three view methods, not the declarations and readers needed to extract the shared implementation. |

Framework TypeScript fell from **12,732 to 9,714 lines** across `src/framework/`, a reduction of **3,018 lines (23.7%)**. The moves account for 1,237 runtime lines and 1,776 pattern and rewrite lines. The two barrel files lost five export lines. No engine behavior was deleted. The obsolete `toNodePattern` conversion was removed. The corresponding test now checks stdlib repeat bindings and the listing of the formerly approximate `sub-self` rule. Two data-only assertions from the runtime test files remain in the framework suite.

## Later

- If E1 is revisited, measure invalidation by function part in the existing analysis manager, and avoid rebuilding or sweeping the complete task frontier for each known edit.
- Revisit graph traversal API ownership together with `IRView` and `IRReader` if the scope expands. The framework's historical pattern documentation still names the former module locations.
