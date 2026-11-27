---
Title: Report
Ticket: IRWB-040-A
Status: active
Topics:
    - framework
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/analysis-manager.ts
      Note: Record invariant assurance
    - Path: repo://src/framework/contracts/differential.ts
      Note: Interpret evidence methods
    - Path: repo://src/framework/contracts/types.ts
      Note: Assurance vocabulary
    - Path: repo://tests/framework/r3-defects.test.mjs
      Note: F34 regression
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:27:45.478627099-05:00
WhatFor: ""
WhenToUse: ""
---

# Report

Invariant checks now classify `sampled` evidence as `checked-sampled` and `exhaustive` or `exact` evidence as `checked-exact`. Missing and unrecognized methods retain the generic `checked` assurance. The existing generic label was the smallest alternative for unknown evidence: it states that a check ran without claiming how complete it was. Property and analysis records retain their existing behavior.

The F34 regression passes without its todo, including explicit assertions for both recognized categories. `npm run build`, `npm run check`, and `node tools/build-site.mjs` passed. The prescribed baseline script reported `no differences`. The requested non-GPU suite at concurrency two reported 66 passing files and 4 failing files (70 files total). The four failing files passed when rerun outside the sandbox: the Typed pair had 6 passing tests; the workbench pair had 9 passing tests and one existing skip. The aggregate sandboxed runner reports files, so its counts do not include individual todo tests.

The changed `types.ts` was formatted with Prettier. `differential.ts` already failed Prettier before this change, so it was left in its existing style. No compatibility layer or additional compiler machinery was needed.
