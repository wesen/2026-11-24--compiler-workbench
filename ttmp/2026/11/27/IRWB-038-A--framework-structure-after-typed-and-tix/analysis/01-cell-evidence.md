---
Title: Cell evidence
Ticket: IRWB-038-A
Status: review
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Frozen cell HEADs, source anchors, and the merged and earlier design records used in the review.
LastUpdated: 2026-11-27T13:12:27.864817274-05:00
WhatFor: ""
WhenToUse: ""
---
# Cell evidence

## Reading the evidence

The merged review baseline is `93ec5fc`. The cell comparison uses `git -C <worktree> diff t6-base HEAD` with base `0f45d04`, then reads source and records from the named HEAD. The brief enumerates 31 worktrees. IRWB-034-G is included as a comparison cell and is also represented in the merged review baseline. Short labels in the design qualify file paths by worktree.

The [inventory script](../scripts/01-cell-inventory.py) locates committed code and ticket records, and can print line anchors. Resolve a table entry by reading `git -C <worktree> show <head>:<path>`. Diffs and implementations are correlated responses to common briefs. They show redundant engineering or divergent boundaries and are a weak basis for claims about comparative implementation quality. Reported timings and coverage are authors' measurements. The review ran CPU probes on chosen code paths.

## Committed cell heads

### T6

| Cell and worktree | HEAD | Evidence of architecture |
| --- | --- | --- |
| A · t6-sm-irwb-033-a | `0f41a93` | Seed imports the planner. Partitioning calls it again on fragments. Schedule steps have their own checks. `src/tensor/schedule.ts:150`, `src/tensor/schedule.ts:258`, `src/tensor/schedule.ts:324`. |
| B · t6-am-irwb-033-b | `a6acedc` | Converts a fusion group into native kernel schedule and seeds from the chosen planner. An order check and named rewrite helper sit beside the schedule model. `src/tensor/schedule.ts:63`, `src/tensor/schedule.ts:349`, `src/tensor/schedule.ts:477`, `src/tensor/schedule.ts:497`. |
| C · t6-tl-irwb-033-c | `1f28a18` | Thin native schedule with a named fusion pass and an acceptance check that reruns the planner. Interim report explicitly marks the stage incomplete. `src/tensor/schedule.ts:25`, `src/tensor/schedule.ts:41`, `src/tensor/schedule.ts:61`, `ttmp/2026/11/27/IRWB-033-C--schedule-ir-and-exact-tiled-contractions/reference/02-interim-implementation-report.md:42`. |
| D · t6-op-irwb-033-d | `f0aa20e` | Named isolate, split, reorder, bind, stage and select operations. Isolation feeds the existing planner with an exclusion set. The shared runner has an eligibility hook, followed by a separate output order check. `src/tensor/schedule.ts:355`, `src/tensor/schedule.ts:433`, `src/tensor/schedule.ts:441`, `src/tensor/schedule.ts:539`, `src/tensor/schedule.ts:580`, `src/tensor/schedule.ts:601`, `src/tensor/schedule.ts:633`, `src/tensor/schedule.ts:658`, `src/framework/passes/define-pass.ts:162`. |
| E · t6-fa-irwb-033-e | `e38d48b` | Named operations repeatedly consult the planner. It introduces a schedule evaluator, explicit schedule correspondence entries and a five-operator synchronous strategy interpreter. `src/tensor/schedule-passes.ts:48`, `src/tensor/schedule-passes.ts:53`, `src/tensor/schedule-passes.ts:121`, `src/tensor/schedule-eval.ts:57`, `src/framework/passes/bridge.ts:77`, `src/framework/strategy/sync.ts:37`. |
| F · t6-g-h-irwb-033-f | `2201c13` | Seed adapts the fusion plan. The cell represents fold order as a declared analysis and uses it in tile and double-buffer preservation claims. `src/tensor/schedule.ts:353`, `src/tensor/schedule.ts:368`, `src/tensor/schedule.ts:424`, `src/tensor/schedule.ts:479`, `src/tensor/schedule.ts:521`. |
| G · t6-ds-h-irwb-033-g | `46a4091` | Declares accumulation order as an analysis and calls the existing planner inside the build pass. Has named domain and reduction tiling, operand staging, and a local step driver. `src/tensor/schedule-passes.ts:42`, `src/tensor/schedule-passes.ts:92`, `src/tensor/schedule-passes.ts:117`, `src/tensor/schedule-passes.ts:183`, `src/tensor/schedule-passes.ts:223`, `src/tensor/schedule-passes.ts:291`. |
| H · t6-ds-x-irwb-033-h | `177f5f6` | Imports a fusion plan, defines order analysis and a domain legality hook, and implements a second synchronous strategy interpreter with sequence/apply and template handling. `src/tensor/cuda-source.ts:963`, `src/tensor/schedule.ts:254`, `src/tensor/schedule.ts:399`, `src/tensor/schedule.ts:453`, `src/framework/strategy/sync.ts:51`, `src/framework/strategy/sync.ts:94`. |
| I · t6-gf-h-irwb-033-i | `a1c2098` | Builds a schedule from planner groups and defines Tile, Bind, and Unroll passes. Contract code represents membership at the schedule boundary. `src/tensor/schedule-passes.ts:340`, `src/tensor/schedule-passes.ts:352`, `src/tensor/schedule-passes.ts:361`, `src/tensor/schedule-passes.ts:375`, `src/tensor/cuda-contract.ts:114`, `src/tensor/cuda-contract.ts:153`. |
| J · t6-g-max-irwb-033-j | `a8aa128` | Declared order property and an async schedule plan. A named fuse pass invokes the old planner. `src/tensor/schedule.ts:309`, `src/tensor/schedule.ts:451`, `src/tensor/schedule.ts:469`, `src/tensor/schedule.ts:620`, `src/tensor/schedule-plan.ts:44`, `src/tensor/schedule-plan.ts:67`. |

The transitions that expose real new operations should be separated from schedule imports and checks of the legacy result. In particular, the order checker in D simulates three concrete extent vectors and checks a structural restriction on reduction bindings. Its result has the scope of those simulations and invariants. H has a separate declared order analysis, and E has a schedule evaluator. These are distinct ways of checking a schedule, and the table provides no validation of full emitted CUDA behavior. `T6-D/src/tensor/schedule.ts:295`, `T6-H/src/tensor/schedule.ts:399`, `T6-E/src/tensor/schedule-eval.ts:57`.

### D1

| Cell and worktree | HEAD | Evidence of architecture |
| --- | --- | --- |
| A · d1-sm-irwb-034-a | `c719081` | Native backend attribution entry point. `src/typed/backend/attribution.ts:75`. |
| B · d1-am-irwb-034-b | `6d0e876` | Independent attribution entry point at Typed level. `src/typed/attribution.ts:13`. |
| C · d1-tl-irwb-034-c | `83b1522` | Report and design committed. No listed source/test/tool delta at HEAD. Draft work is reported below. |
| D · d1-ds-x-irwb-034-d | `88fc3f8` | Design committed. No listed source/test/tool delta at HEAD. Draft work is reported below. |
| E · d1-g-h-irwb-034-e | `4def57e` | Exposes revision-transition attribution and an origins view. `src/typed/attribute.ts:82`, `src/typed/attribute.ts:126`, `src/typed/attribute.ts:217`. |
| F · d1-op-irwb-034-f | `0e2ebb0` | Separate instruction and revision-step attribution APIs. `src/typed/attribution.ts:165`, `src/typed/attribution.ts:336`. |
| G · d1-fa-irwb-034-g | `067e496` | PC counts joined to covers and adjacent revisions. Explicit decision/delta reporting and corrected natural-loop analysis. `src/typed/attribute.ts:81`, `src/typed/attribute.ts:103`, `src/typed/attribute.ts:185`, `src/typed/analyses.ts:215`. |

These implementations support extracting a shared attribution query without imposing one attribution policy. The G algorithm chooses the first covered statement and first origin link, whereas E explicitly exposes different transition/origin aggregation queries. Derive one common observation identity and let measure-specific allocation be visible. `D1-G/src/typed/attribute.ts:89`, `D1-G/src/typed/attribute.ts:103`, `D1-E/src/typed/attribute.ts:126`, `D1-E/src/typed/attribute.ts:217`.

### A0

| Cell and worktree | HEAD | Evidence of architecture |
| --- | --- | --- |
| A · a0-sm-irwb-035-a | `b7cd2ae` | Native edit classifier. `src/typed/edit-classification.ts:214`. |
| B · a0-am-irwb-035-b | `0989c2d` | Census classifies edits at adjacent revisions. `src/typed/edit-census.ts:84`. |
| C · a0-tl-irwb-035-c | `9adde9e` | Report and design committed. No listed source/test/tool delta at HEAD. Draft work is reported below. |
| D · a0-ds-x-irwb-035-d | `6e42f9a` | Classifies edit chains and exposes pass/step census methods. `src/typed/edit-classes.ts:342`, `src/typed/edit-classes.ts:374`, `src/typed/edit-classes.ts:497`. |
| E · a0-g-h-irwb-035-e | `8eef7bf` | Classification over an application and edit context. `src/typed/edit-class.ts:221`, `src/typed/edit-class.ts:262`. |
| F · a0-op-irwb-035-f | `5453d5f` | Classification for an application and revision history. `src/typed/edit-classes.ts:264`, `src/typed/edit-classes.ts:418`. |
| G · a0-fa-irwb-035-g | `e23c171` | Independent application classifier. `src/typed/edit-classes.ts:283`. |

A and B report 203 local edits out of 2,021 for O2 and 408 out of 9,736 for speed. D/E/G report 395 and 997 local edits, with 183 and 362 respectively re-derived by verified rule tables. A reports those same numerator values with different denominators and zero citations. This is more than duplicated code. It shows how the definition of a rule occurrence and the edit unit govern the answer. The report fraction, the instruction-weighted fraction, and the share that could avoid sampling require explicit denominators and evidence policy. `A0-A/ttmp/2026/11/27/IRWB-035-A--local-value-rewrite-census-for-o2-and-speed/analysis/01-corpus-edit-census-report.md:35`, `A0-A/ttmp/2026/11/27/IRWB-035-A--local-value-rewrite-census-for-o2-and-speed/analysis/01-corpus-edit-census-report.md:89`, `A0-B/ttmp/2026/11/27/IRWB-035-B--local-value-rewrites-in-o2-and-speed/analysis/01-corpus-results.md:29`, `A0-D/ttmp/2026/11/27/IRWB-035-D--what-share-of-the-optimizer-s-edits-are-local-value-rewrites-a-classifier-and-a-corpus-measurement-for-programme-a/design-doc/02-report-what-share-of-o2-and-speed-s-edits-are-local-value-rewrites.md:58`, `A0-E/ttmp/2026/11/27/IRWB-035-E--a0-what-share-of-the-optimizer-s-edits-are-local-value-rewrites/design-doc/02-final-report-a0-edit-shares.md:116`, `A0-G/ttmp/2026/11/27/IRWB-035-G--what-share-of-the-optimizer-s-edits-are-local-value-rewrites/reference/01-diary.md:98`.

### B1

| Cell and worktree | HEAD | Evidence of architecture |
| --- | --- | --- |
| A · b1-sm-irwb-036-a | `852139f` | Uses live locals and known values to key residual blocks. Direct block-array entry installation. `src/typed/specialize-memory.ts:54`, `src/typed/specialize-memory.ts:188`. |
| B · b1-am-irwb-036-b | `b9153bc` | Tracks static scalars, buffer aliases and entry-initialized frame words. Liveness projects the cache key and a native queue drives residualization. `src/typed/residualize.ts:18`, `src/typed/residualize.ts:45`, `src/typed/residualize.ts:55`. |
| C · b1-tl-irwb-036-c | `7303f46` | Design/diary/report committed. No listed source/test/tool delta at HEAD. |
| D · b1-ds-x-irwb-036-d | `54ea54d` | Design/diary committed. No listed source/test/tool delta at HEAD. Draft work is reported below. |
| E · b1-g-h-irwb-036-e | `b8b4498` | A tracer packages memoization, worklist and residual emission. `src/typed/peval.ts:208`, `src/typed/peval.ts:504`, `src/typed/peval.ts:843`. |
| F · b1-op-irwb-036-f | `74b9a76` | Named binding-time analysis, residual pipeline and queue. `src/typed/pe.ts:76`, `src/typed/pe.ts:170`, `src/typed/pe.ts:358`. |
| G · b1-fa-irwb-036-g | `ff07c2d` | Named binding-time division, bounded residual pass, and directly installed entry. `src/typed/bta.ts:65`, `src/typed/specialize-buffer.ts:38`, `src/typed/specialize-buffer.ts:98`, `src/typed/specialize-buffer.ts:294`. |

A/B suggest extracting memoized residual graph construction even if an offline BTA API is premature. F/G justify prototyping a reusable binding-time lattice or configured division for comparable IRs. Name the dynamic value cases, static-memory ownership and trap policy explicitly. Those are part of the soundness argument and can vary while the memoization machinery stays fixed. `B1-A/src/typed/specialize-memory.ts:57`, `B1-B/src/typed/residualize.ts:35`, `B1-B/src/typed/residualize.ts:55`, `B1-F/src/typed/pe.ts:76`, `B1-G/src/typed/bta.ts:65`.

## Merged and earlier records

Paths in this register are relative to the merged worktree. Earlier documents are design evidence. Their interfaces and research goals do not certify features of the merged code.

- **Coordinator.** Framework-first criteria and fix history in `BACKLOG.md:77`, `BACKLOG.md:416`, and `BACKLOG.md:452`–`492`. The assumptions about divergence, GPU evidence, timing noise and experiment comparability are documented in `ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/log/01-diary.md:1068`, `:1159`, `:1193`, and `:1207`. The merged report's gap assessment starts at `ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/report-artifact/index.html:297`.
- **IRWB-001/002.** Original integration at `ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/01-combining-ir-workbench-v6-and-compiler-workbench.md:50` and `:101`, plus the worked Typed dependencies in `ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/02-typed-to-rv32-compiler-on-the-v6-framework-worked-examples.md:143` and `:210`. The later research agenda puts artifacts, projections, dataflow and transactions in context. `ttmp/2026/11/24/IRWB-002--research-agenda-compiler-techniques-and-frameworks-for-the-ir-workbench/design-doc/01-intern-guide-and-research-agenda-the-ir-workbench-as-it-is-and-the-compiler-techniques-and-frameworks-to-build-next.md:150`, `:182`, `:320`, `:366`.
- **IRWB-003/004/005.** The speed-gap guide frames the relationship between optimizer, backend and measurement. The other guides identify repeated work in checks, and use stronger case generation and mutation scores to judge observational evidence. `ttmp/2026/11/25/IRWB-003--closing-the-speed-gap-inlining-copy-coalescing-float-constants-in-registers-loop-rotation/design-doc/01-intern-guide-closing-the-speed-gap-with-inlining-copy-coalescing-constants-in-registers-and-loop-rotation.md:55`, `ttmp/2026/11/25/IRWB-004--cheap-experiments-cached-origin-outcomes-functions-as-the-unit-of-change-workers-and-a-worker-for-the-workbench/design-doc/01-intern-guide-cheap-experiments-in-the-ir-workbench.md:33`, `ttmp/2026/11/25/IRWB-005--gate-strength-a-mutation-score-for-the-meaning-contract-and-stronger-case-generation/design-doc/01-intern-guide-how-strong-is-the-meaning-contract-and-how-to-make-it-stronger.md:28`.
- **IRWB-006/007/008.** Rule data and SSA views, static scene assumptions, and validated rule applications motivate witnessed edits and a common specialization interface. `ttmp/2026/11/25/IRWB-006--rewrite-rules-as-verified-data-and-a-single-assignment-view-of-typed-blocks/design-doc/01-intern-guide-rewrite-rules-as-verified-data-and-a-single-assignment-view-of-typed-blocks.md:34`, `ttmp/2026/11/26/IRWB-007--specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory/design-doc/01-intern-guide-specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory.md:45`, `ttmp/2026/11/26/IRWB-008--exact-checking-for-edits-that-cite-verified-rules-and-version-2-of-the-meaning-check-as-the-standard-for-new-pipelines/design-doc/01-intern-guide-exact-checking-for-edits-that-cite-verified-rules-and-version-2-of-the-meaning-check-for-new-pipelines.md:34`.
- **IRWB-009/010/011.** Locality, alternative candidate generators and image-level observations are independent extension axes. `ttmp/2026/11/26/IRWB-009--a-function-incremental-framework-analyses-per-function-part-a-lazy-projection-a-persistent-store-and-demand-driven-queries/design-doc/01-intern-guide-a-function-incremental-framework-for-the-ir-workbench.md:33`, `ttmp/2026/11/26/IRWB-010--sketch-rewrite-search-on-ssa-and-verified-rules-rule-discovery-equality-saturation-a-window-superoptimizer/design-doc/01-sketch-guide-rewrite-search-on-ssa-and-verified-rules.md:35`, `ttmp/2026/11/26/IRWB-011--sketch-image-level-contracts-for-float-freedom-tolerance-contracts-judged-on-rendered-frames/design-doc/01-sketch-guide-image-level-contracts-for-float-freedom.md:36`.
- **Merged stages.** T1 introduces native checks. T2 describes the measured CUDA relation and execution. T3 describes legality, two mappings and the exactness argument. T3b distinguishes the gate's observed regions from the remaining shape space. `ttmp/2026/11/26/IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/02-report.md:30`, `ttmp/2026/11/26/IRWB-022-I--lowering-tix-to-cuda-with-checked-execution-on-the-gpu-machine/reference/02-report.md:83`, `ttmp/2026/11/26/IRWB-029-D--checked-fusion-of-tix-kernels-on-the-gpu/reference/02-report-checked-fusion-of-tix-kernels.md:59`, `ttmp/2026/11/27/IRWB-030-E--fusion-that-is-never-slower-parallel-terms-serial-fold-and-a-cost-gate/reference/02-report-fusion-that-is-never-slower.md:236`.
- **Merged fixes and D1.** IRWB-031 tests declared versus actual entity lists. IRWB-032 tightens correspondence/observability and reuse. The measured D1 sequence revised its explanation and included both LICM-sharing and coalescer effects. `ttmp/2026/11/27/IRWB-031--f23-check-correspondence-entity-lists-against-the-artifacts/reference/01-implementation-diary.md:39`, `ttmp/2026/11/27/IRWB-032--f24-to-f26-kernel-entities-the-gate-s-choice-the-baseline-key-contract/diary/01-implementation-diary.md:22`, `ttmp/2026/11/27/IRWB-034-G--why-speed-makes-the-bytecode-vm-slower-instruction-attribution-and-a-fix/reference/01-implementation-diary.md:82`, `:95`, and `:108`.

## Uncommitted observations

A read-only status pass found unpublished work in A0-C, B1-D, D1-C and D, and T6-F/I/J. Treat the absence of a committed source delta as a property of the nominated snapshot. In A0-C, D1-C/D and B1-D the working directories had additional candidate code. No observations from those drafts enter the implementation counts. Their paths and selected line anchors are reported in the diary.

### Connection to the F-series

| Backlog | Consequence for the proposed boundary |
| --- | --- |
| F1–F6 | F1 gives independent evidence for a configurable cross-engine observation job. F2's signature failure identifies an explicit input to its semantic model. F3–F6 describe practical test and workbench boundary repairs. Use per-project acceptance and stable project metadata for migration. `BACKLOG.md:416`, `BACKLOG.md:420`, `BACKLOG.md:423`, `BACKLOG.md:425`, `BACKLOG.md:427`, `BACKLOG.md:430`. |
| F7–F12 | Stable focus IDs are a consumer of entity scopes. Input grammar, observation semantics and resource-bounded runs belong in separate parts of a contract. Domain feature requests and agent instructions supply workload context. `BACKLOG.md:432`, `BACKLOG.md:434`, `BACKLOG.md:437`, `BACKLOG.md:440`, `BACKLOG.md:443`, `BACKLOG.md:446`. |
| F13–F18 | Preserve lazy editing, refusal reasons and changed flags. Fix the experimental assumptions explicitly. Structured cases, a declared FP model and batch-only validation can share one evidence protocol. `BACKLOG.md:452`, `BACKLOG.md:455`, `BACKLOG.md:458`, `BACKLOG.md:461`, `BACKLOG.md:464`, `BACKLOG.md:467`. |
| F19–F26 | In-flight deduplication, kernel and statement universes, and executed-side observations are useful precedents. Backend link order belongs in reproducible build identity. Shape-symbol mutants and small-scale numerical cases test different parts of a meaning claim. F26 is a case-identity check. `BACKLOG.md:470`, `BACKLOG.md:473`, `BACKLOG.md:476`, `BACKLOG.md:480`, `BACKLOG.md:483`–`486`. |
| F27–F32 | Use one transformation protocol and one strategy semantics. Extend analyses with affine regions, edit roots with a role, and evidence with checked rule applications. The T6-D probe gives a reason to keep both preconditions and postconditions. `BACKLOG.md:487`–`492`, `T6-D/src/framework/passes/define-pass.ts:162`, `T6-D/src/tensor/schedule.ts:355`. |
