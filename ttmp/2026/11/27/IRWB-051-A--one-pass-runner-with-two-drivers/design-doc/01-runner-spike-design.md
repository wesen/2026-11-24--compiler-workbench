---
Title: Runner spike design
Ticket: IRWB-051-A
Status: active
Topics:
    - framework
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/analysis-manager.ts
      Note: Shared analysis and transfer lifecycle
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Pass preparation and acceptance boundary
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T20:20:09.481110684-05:00
WhatFor: ""
WhenToUse: ""
---

# Runner spike design

The experiment covers single-input, same-IR Tix modules and Typed blocks, with synchronous native kernels. Typed constant propagation reads reaching definitions and preserves CFG, dominators and loops. The suggested LICM and BCE definitions currently have empty preservation lists. Tix inline already has a synchronous meaning gate. Typed uses the existing sampled differential specification with the local evaluator on both drivers, with the existing manager contract as its legacy reference.

The specification carries the IR and adapter, identity, write set, relation, eligibility, preparation, and obligations. Requires names input analysis queries, ensures checks the declared relation against the candidate and origin, and preserves declares facts to check when present or when explicitly auditing. Exact and tolerance describe the comparison paired with the gate. A sampled check retains its sampled evidence. Eligibility uses today's legal check before analysis or preparation. Reuse the pass layer's native candidate preparation, correspondence, writes check and publication. For unchanged candidates, skip acceptance checks as today's runners do. A failed gate reports candidate rejection at the check site.

Try a generator with deferred effect calls. Both drivers return results to the same lifecycle and throw effect failures back into it so its cleanup remains in one place. The simpler alternative is to share the specification and write two entry points around the current lifecycle helpers. That still requires a synchronous manager query and exposes the order of acceptance checks twice. Compare the size and duplication of the manager changes and measure application costs before recommending a migration.

Share manager query and transfer bookkeeping with the existing asynchronous APIs. The synchronous driver supports pure definitions and pure transfer rules, with synchronous callbacks that ignore the contract context. Cache keys, validation, records, history, invalidation, and snapshot events remain manager responsibilities. A separate cache would obscure the answer to the experiment. Test bidirectional reuse across APIs and check preservation under audit, then compare each driver's revision and correspondence with the incumbent.

Record warm per-application timings over the same input and report the measurements with scope and sample spread. Run the coordinator's baselines separately.

## Later

- Move existing pass callers and the strategy bridge to the selected lifecycle after review. A synchronous plan interpreter would be a separate experiment.
- Extend the synchronous manager to dependencies and manager contract transactions if a caller needs them.
- Extend the transformation type to cross-IR and multi-port preparation when a lowering migrates.
