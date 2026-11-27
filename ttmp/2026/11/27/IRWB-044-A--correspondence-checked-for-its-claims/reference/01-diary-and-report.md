---
Title: Diary and report
Ticket: IRWB-044-A
Status: active
---

# Diary

- Inspected contract validation, IR diff and F35 test. The honest mapping covers only a subset, so the default must allow partial mappings but reject a vacuous one.
- Implemented coverage and diff-based survival checks at the manager boundary; added focused tests and enabled F35.
- The first broad run exposed a legitimate empty CUDA lowering correspondence. Added explicit `partial` to that requirement, retained `nonempty` as default, and reran after rebuilding.
- The default applies to four lab requirements and other undeclared requirements; CUDA lowering declares `partial`. Cross-IR mappings do not use same-ID survival checks.

# Report

The manager now validates declared coverage and rejects empty-side claims for surviving IDs on same-type revisions. `partial` permits no groups, `nonempty` is the default, and `source`, `target`, and `both` cover their named universes. CUDA lowering explicitly uses `partial` because empty lowering groups are legitimate. The four lab requirements use the default `nonempty`. The F35 fixture also uses that default.

The structural diff operates on a minimal entity-universe projection: it can establish whether an ID survives, but cannot prove the semantic meaning of a nonempty merge or split. Different IR types can reuse IDs independently, so their mappings are not checked for same-ID survival. This reuses the framework diff; no domain-specific analysis or pass machinery was added.

Validation on the final implementation: F35 and focused coverage tests pass; the baseline script printed `no differences` (its separate timing sample was 0.527 -> 1.548 ms per inline application under shared load). The requested suites reported 501 tests: 491 pass, 0 fail, 3 skipped, 7 todo. `npm run build`, `npm run check`, the site build, and Prettier checks for changed formatted files passed. No probe scripts were needed. No assertions were weakened. Semantic validation of nonempty mapping groups is outside this step because structural diff cannot establish it.
