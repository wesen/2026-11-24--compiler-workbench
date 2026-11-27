---
Title: Implementation diary
Ticket: IRWB-036-C
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:03.150406976-05:00
WhatFor: ""
WhenToUse: ""
---

## 1. Design checkpoint

The request is the user-authored task in this conversation: specialize the bytecode VM on a constant buffer and known entry, measure the two fixtures, commit the design first, and maintain a ticket and diary. The original request is the authoritative verbatim text.

The VM holds two fixed programs in a shared buffer; the loop counter remains dynamic, so a finite straight-line trace cannot represent all calls. The design proposes residual states and generated-case contract restrictions. This is a hypothesis to test, not a measured result.

## 2. Baseline experiment and remaining work

Built with `npm run build`, then ran `scripts/01-measure-entry.mjs`. An initial experiment applied `speed` twice to the scalar variant, yielding 15,114/13,098 steps and 1,304 bytes. That comparison was invalid because the general image received `speed` once. Correcting the script to run each pipeline once yielded 9,287/8,219 steps and 908 bytes for scalar binding, compared with 9,286/8,218 and 904 bytes for general speed. r0 measured 7,678/6,874 and 840 bytes; the two handwritten functions measured 75/74 and 40/36 bytes. Each scalar variant passed 100 generated meaning cases. The experiment does not implement or measure buffer specialization.

`scripts/02-list-vm.mjs` confirms that both loads depend on loop-carried `pc`; frame stores make a blanket store ban unsuitable. The intended buffer analysis and residual control-flow construction remain unimplemented, as stated in the report.

Validation: `npm run build` passed. The combined `node --test tests/typed/*.test.mjs tests/framework/*.test.mjs tests/workbench/*.test.mjs` was interrupted before completion; framework files and Typed audit, backend, bcm and bytecode-vm reported success, but the entire suite is not verified. No implementation files were changed.
