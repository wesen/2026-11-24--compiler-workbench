---
Title: 'Framework structure review: composable parts, layer assessment and migration'
Ticket: IRWB-038-C
Status: active
Topics:
    - framework
    - design-review
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/framework/passes/define-pass.ts
      Note: the two runners; PassSpec is an endomorphism S -> S
    - Path: src/framework/contracts/analysis-manager.ts
      Note: every invariant check is recorded as assurance 'checked' (line 1177)
    - Path: src/tensor/fusion.ts
      Note: planFusion, the monolithic schedule decision every T6 cell had to wrap or re-run
    - Path: src/typed/tx.ts
      Note: Typed's own transaction layer, edit log and provenance
    - Path: src/typed/passes.ts
      Note: typedPass, a domain pass DSL over definePass; correspondence rebuilt from origins
    - Path: src/framework/dataflow/solver.ts
      Note: a generic monotone solver hidden behind a CFG-shaped interface
ExternalSources: []
Summary: >-
  Design-level review of src/framework against two domains, four merged tensor stages, one merged Typed stage and
  about forty unmerged cells (T6, D1, A0, B1). Inventory of domain-built machinery, layer assessment, eight
  proposed framework concepts, a standard library of compiler building blocks, five fundamental changes, and an
  ordered migration.
LastUpdated: 2026-11-27T15:30:00-05:00
WhatFor: Deciding what the framework's next structure is, and in what order to get there.
WhenToUse: Before merging T6, before any framework fix in the F27-F32 range, and before starting a stdlib module.
---

# Framework structure review: composable parts, layer assessment and migration

## 0. Summary

**The question.** Where does complexity live that the framework should absorb, how good is the core structure,
and what should change? The evidence is the merged code (framework, Typed, Tix), four probes in this ticket's
`scripts/`, and the code and reports of 31 unmerged cells: ten T6, seven D1, seven A0 and seven B1.

**The answer, in one paragraph.** The framework's unit of transformation is an *endomorphism* `S -> S`. Its
acceptance protocol is wrapped around it *asynchronously*, and that protocol is the only place "checked" is
decided. The material contradicts all three choices:

- Both domains' most important steps are *translations* `S -> T`: Tix to CUDA, Typed to RV32, Tix to a schedule IR.
- Most of their checks are *synchronous and structural*: legality, order preservation, "only the layout changed".
- What "checked" means varies from a sampled test to a recorded proof, and the framework erases that difference.

Every recurring workaround in the material is a local patch over one of these three mismatches. The domains
also rebuilt, outside the framework, a whole layer the framework does not have: a provenance-carrying edit log
and verified rules as data. Typed did it in `src/typed/tx.ts` and `src/typed/rules/`. The cells then mined that
layer by hand seven times (D1) and seven times again (A0).

**Five most important findings.**

1. **Eight of ten T6 cells changed `src/framework/passes` or `src/framework/strategy`, and every change has one of
   four shapes.** The shapes are a precondition, a synchronous postcondition or preservation check, a cross-IR
   input, and a synchronous strategy executor. Independent agents converged on the same four holes (§2.1).
2. **The framework records a sampled differential check as `assurance: 'checked'`, the same word as an exact
   check.** Probe 02 shows a check that agrees on every sampled case while the subject is wrong on every even
   input, recorded as `checked` (`src/framework/contracts/analysis-manager.ts:1177`). The sampled/exact distinction
   exists only in an uncalled helper (`src/framework/contracts/differential.ts:377-380`). The rule proofs Typed
   already has (`src/typed/rules/evidence.ts`) never reach a pass's assurance.
3. **Correspondence is not only coarse, it is wrong where it matters.** Tix `inline` records the inlined producer
   as `removed` rather than merged into its consumer (probe 01). Typed records in-place edits as `retained`, which
   `whyEntity` skips. So six of seven D1 cells and every A0 cell rebuilt lineage from Typed's private edit log.
4. **Two framework layers have no domain user.** The rewrite engine (`ir/rewrites.ts`, 856 lines) is one; the core
   task runtime with queries and records (`core/runtime.ts`, `query.ts`, `records.ts`, 1,240 lines) is the other
   (probe 03). Typed built a second rewrite system instead: rules as data, a matcher and a verifier with graded
   evidence. That is what a verifiable rewrite engine needs, and the framework's callback rewrites cannot give it.
5. **The generic algorithms the cells re-wrote are already half-present but mis-shaped.** Two B1 binding-time
   analyses and one edge-constant analysis bypass a solver that can already express them (probe 04). Dominators,
   natural loops, SSA and SCCP live in `src/typed` on top of the framework's `FlowGraph`. Four D1 cells re-merged
   natural loops; four or five T6 cells wrote a contraction recogniser and five an accumulation-order normal form.

**Fundamental changes recommended** (§4):

- **(R1)** passes become typed arrows `S -> T` between IR types;
- **(R2)** a transform is separated from its proof obligations, with one runner and one strategy interpreter, and
  the sync/async decision moves from the runner to each obligation;
- **(R3)** "checked" becomes a graded evidence term with a meet along pipelines;
- **(R4)** a structured derivation log is the primary record, and correspondence is derived from it;
- **(R5)** rules become data with pluggable verifiers, replacing callback rewrites, and the unused core runtime is
  either adopted for incremental checking or moved out of the core.

## 1. Method and evidence classes

- **Merged code, read by me.** This covers `src/framework/**`, `src/tensor/*.ts` and the Typed modules cited
  below. Every repository claim cites `path:line` in this worktree (`r3-op/irwb-038-c`, at `93ec5fc` plus this
  ticket).
- **Probes, run by me** (`scripts/01`–`04`, each with its `.out.txt`):
  - 01: the correspondence a Tix pass records, and what each runner accepts;
  - 02: the assurance recorded for a sampled check;
  - 03: a census of which framework module each domain imports, by symbol;
  - 04: a binding-time analysis on the unmodified solver.
- **Unmerged cells.** Five read-only survey agents read the cells, one each for T6 (two halves), D1, A0 and B1.
  Each reported per-cell `path:line` evidence. I spot-checked at least one load-bearing citation per report by
  reading the file at that line, and all matched (diary steps 3 and 4). Cell paths are given as
  `<worktree>/<path>:<line>` under `.claude/worktrees/`. Uncommitted work is marked; it counts as evidence of
  intent, not of a working result.
- **Status of each proposal.** Each one is marked **[E]** where the material shows the need directly, and
  **[C]** where it is conjecture: a generalisation I argue for but the material does not yet exercise.
- **Sources.** Theories are named with their standard attributions (Cytron et al., Wegman–Zadeck, and so on). I
  did not fetch bibliographic sources in this session. The only citations treated as verified are those the
  repository's report already verified (`ttmp/2026/11/26/IRWB-019-.../various/report-artifact/index.html`, "Further
  reading": Pnueli–Siegel–Singerman, Necula, Alive, Alive2, MLIR, Salsa, Adapton).

### 1.1 The coordinator's starting points, verified

| Starting point | Verdict | Evidence |
|---|---|---|
| Most B1 cells wrote their own BTA in `src/typed` | **True, and more.** Two offline BTAs, near-identical; three online specialisers with near-identical memo keys; none uses `framework/dataflow` | `b1-op-irwb-036-f/src/typed/pe.ts:76`, `b1-fa-irwb-036-g/src/typed/bta.ts:65`; `b1-sm-irwb-036-a/src/typed/specialize-memory.ts:57`, `b1-am-irwb-036-b/src/typed/residualize.ts:61` |
| A0 and D1 cells built near-identical classifiers and attribution tools | **True.** Tree equality modulo ids in 7 of 7 A0 cells; a backward lineage walk in 4 D1 cells and a per-step replay attributor in 4 | A0 survey (e)1, D1 survey (d) |
| T6 schedule IRs partly copy `planFusion` decisions | **Half true.** Five cells re-run `planFusion` inside passes or gates (D, A, E, I, C); five seed from it once (B, G, H, F, J) | `t6-op-irwb-033-d/src/tensor/schedule.ts:441`, `t6-sm-irwb-033-a/src/tensor/schedule.ts:268`, `t6-fa-irwb-033-e/src/tensor/schedule-passes.ts:121` |
| One T6 cell added a synchronous strategy interpreter | **Two did,** with different node subsets, plus two near-identical `syncPassAlgorithm`s and a gate mode in the bridge | `t6-ds-x-irwb-033-h/src/framework/strategy/sync.ts:94`, `t6-fa-irwb-033-e/src/framework/strategy/sync.ts:37`, `t6-g-max-irwb-033-j/src/framework/passes/bridge.ts:56-57` |
| Another added `PassSpec.legal` | **True,** and three other cells added a sibling field | `t6-op-irwb-033-d/.../define-pass.ts:101`; `postcondition` `t6-am-irwb-033-b/.../define-pass.ts:89-90`; `source` `t6-ds-h-irwb-033-g/.../define-pass.ts:90`; gate with correspondence `t6-sm-irwb-033-a/.../define-pass.ts:228` |
| Dataflow and the rewrite engine are unused by Tix | **True, and the rewrite engine is unused by Typed too** | probe 03; `ir/rewrites.ts` has no domain importer |
| Two pass runners with different powers | **True, but F27 misstates the blocker** | probe 01(c): `passAlgorithm` runs Tix passes in a plan; what is lost is the meaning check, which is a closure, not a contract (§3.4) |
| Tix passes record correspondence only coarsely | **Worse: incorrectly** for inlining | probe 01(a) |
| Checks are sampled and never proven | **True, and the record does not say so** | probe 02 |

## 2. Inventory of domain-built machinery

Each row names the machinery, where it lives, which framework concept it duplicates or which gap it fills, and
where it should go: a framework concept (K-number, §5) or a standard-library primitive (L-number, §6).

### 2.1 The four shapes of T6's framework changes [E]

| Shape | Cells and lines | Concept |
|---|---|---|
| Precondition before `run` | D `PassSpec.legal`, `PassError('illegal')` (`t6-op-irwb-033-d/src/framework/passes/define-pass.ts:101`); H's domain `layoutPass({legal})` (`t6-ds-x-irwb-033-h/src/tensor/schedule.ts:449`); G's `ScheduleRefusal` thrown before a revision exists (`t6-ds-h-irwb-033-g/src/tensor/schedule-passes.ts:27`) | K3: `requires` clause, with *refusal* as a first-class outcome |
| Synchronous postcondition or preservation check | B `postcondition` (`t6-am-irwb-033-b/.../define-pass.ts:89-90`); F sync `preserves` by recompute (`t6-g-h-irwb-033-f/.../define-pass.ts:259-265`); H `claims` and `enforceClaims` (`t6-ds-x-irwb-033-h/.../define-pass.ts:236-251`); A's gate receives the correspondence (`t6-sm-irwb-033-a/.../define-pass.ts:228`) | K2 + K3: obligations with a sync evaluation mode |
| Cross-IR input | G `PassSpec.source` (`t6-ds-h-irwb-033-g/.../define-pass.ts:90`); E and I use `defineTransformation`; B uses a hand-built `makeCorrespondence`; H embeds the schedule as data in the CUDA artifact | K1: arrows `S -> T` |
| Synchronous strategy execution | H `runPlanSync` (`t6-ds-x-irwb-033-h/src/framework/strategy/sync.ts:94`); E `executeSync` (`t6-fa-irwb-033-e/src/framework/strategy/sync.ts:37`); J's bridge gate mode (`t6-g-max-irwb-033-j/src/framework/passes/bridge.ts:56-57`); hand loops in B, G, D, A, F, I | K2: one interpreter, synchronous over synchronous algorithms |

Cells I and C changed nothing in the framework; both are unfinished. Every finished cell needed at least one of
the four shapes.

### 2.2 Machinery in the merged code

| # | Machinery | Where | Duplicates / fills | Home |
|---|---|---|---|---|
| M1 | Typed's transaction layer: write kinds, `origin`/`because` provenance, edit records, its own `undeclaredWrite` | `src/typed/tx.ts:1-9`, `:27-28`, `:47-54` (531 lines) | Framework `IREdit` (`src/framework/ir/transactions.ts`) with its `Reason` (`src/framework/ir/types.ts:210`). Writes are enforced twice, by `Tx` and by `definePass` (`src/framework/passes/define-pass.ts:216-222`) | K5 |
| M2 | `typedPass`: a per-function loop over a domain `Tx`, fact views, correspondence rebuilt from origins | `src/typed/passes.ts:119-162`, `:168-220` | Missing framework *scoped edit* (per-function) and *correspondence from the edit log* | K5, K1 |
| M3 | A second rewrite system: rules as data (`Pat`, `Guard`, `Tpl`), a matcher, compilation to a `Tx.rewrite` visitor | `src/typed/rules/form.ts:1-20`, `src/typed/rules/compile.ts:24` | `ir/patterns.ts` and `ir/rewrites.ts`, whose rewrite bodies are callbacks (`src/framework/ir/README.md:60`) and cannot be verified. Typed converts its rules to framework patterns only to list them and to search a projection (`src/typed/rules/form.ts:268-284`) | L6, R5 |
| M4 | A rule verifier with eight methods and graded strengths (proof, complete at 8 bits, sampled) | `src/typed/rules/verify.ts:1-20`; recorded evidence `src/typed/rules/evidence.ts` (2,086 lines) | The framework's `Assurance` has no grades (`src/framework/contracts/types.ts:164`) | K4, L7 |
| M5 | Dominators (Cooper–Harvey–Kennedy), natural loops, CFG | `src/typed/analyses.ts:140`, `:215-260` | Generic over the framework's `FlowGraph` (`src/framework/dataflow/solver.ts:17-22`). The solver's own `depthFirst` computes loop heads separately (`solver.ts:64`) | L1 |
| M6 | SSA construction (Cytron et al.) as a view | `src/typed/ssa.ts:60` | Generic, given "variables defined in blocks" | L2 |
| M7 | SCCP: its own flat lattice and its own worklist; calls `ssaOf` directly instead of declaring `needs` | `src/typed/sccp.ts:23-34`, `:47`, `:148-149` | `flatLattice` (`src/framework/dataflow/lattices.ts:45`); the analysis manager's caching (`ssaAnalysis` exists, `src/typed/ssa.ts:219`, but is not used) | L3, L4 |
| M8 | Tix driver loop over passes | `src/tensor/index.ts:32-60` | Strategy IR | K2 |
| M9 | Tix passes as whole-module functions with coarse writes and no correspondence entries | `src/tensor/passes.ts:177-186` (writes `['tensor']`, `:184`; native module, `:185`) | Correspondence through transactions or K5 | K5 |
| M10 | `planFusion`: grouping, thread/block mapping, storage (stored, buffered, staged), reduction staging (`terms`), buffer reuse (`inPlace`), a launch-time gate | `src/tensor/fusion.ts:142-279`; gate `:135-140`; staging threshold `:113` | Missing schedule IR (T6), dependence analysis (`joinDepth`, `:83-105`, is an ad hoc zero-distance test), and choice points | K7, K8, L9 |
| M11 | Three ways to define a checked step in one domain: `definePass` + `applyNativePassSync` (`src/tensor/index.ts:39`); `defineTransformation` + `manager.execute` for the lowering (`src/tensor/cuda-contract.ts:203-249`); a plain function for fusion (`src/tensor/index.ts:66-69`) | as cited | One arrow concept | K1 |
| M12 | Typed's lowering to RV32: a plain function returning `{image, correspondence}` | `src/typed/backend/compile.ts:442-453` | Arrow `typed.blocks -> rv32.image` | K1 |
| M13 | Case generators: shape assignments with distinct sizes, empty extents, value streams; Typed's stronger generator | `src/tensor/contract.ts:24-85`; `src/typed/cases-strong.ts:1-8` | No case-domain combinators in `contracts/differential.ts` | L13 |
| M14 | Exact f32: bit-level semantics; word comparison with NaN as a class, three copies | `src/typed/f32.ts:1-6`; `src/tensor/contract.ts:100-117`; `src/tensor/cuda-contract.ts:105-121` | none | L8 |
| M15 | Instruction attribution: per-step replay and site grouping by `origin` | `src/typed/attribute.ts:1-14`, `:81-98`; base `heat()` `src/typed/backend/run.ts:175` (unused by every D1 cell) | `traceEntity`/`whyEntity` (`src/framework/ir/correspondence.ts:226`, `:306`), which are too lossy (finding 3) | K6, L14 |
| M16 | Static block frequencies and a backend cost estimate | `src/typed/backend/frequency.ts:1-6` | No IR-level cost concept. D1-fa measured it as a gate: "rejects about as many improvements as regressions" (`d1-fa-irwb-034-g/ttmp/.../reference/02-report...md:284-303`) | L16 |

### 2.3 Machinery in the unmerged cells, by recurrence

| # | Recurring machinery | Occurrences (cell: file:line) | Domain-independent concept | Home |
|---|---|---|---|---|
| U1 | Schedule IR = a copy of the Tix `Fn` + `FusionGroup` fields + layout; hand-written entity/relation generators | in all ten T6 cells; for example B `t6-am-irwb-033-b/src/tensor/schedule.ts:47`, `:328`; D `t6-op-irwb-033-d/src/tensor/schedule.ts:246`; F `t6-g-h-irwb-033-f/src/tensor/schedule.ts:271`, `:343` | An *overlay*: a base IR plus annotations, edits restricted to the annotations | K7 |
| U2 | Accumulation-order normal form compared before and after every step | G `t6-ds-h-irwb-033-g/src/tensor/schedule.ts:399-436`; H `t6-ds-x-irwb-033-h/src/tensor/schedule.ts:367`; B `t6-am-irwb-033-b/src/tensor/schedule.ts:477`; F `t6-g-h-irwb-033-f/src/tensor/schedule.ts:231`; D `t6-op-irwb-033-d/src/tensor/schedule.ts:339`; J `t6-g-max-irwb-033-j/src/tensor/schedule.ts:309` (an allowed-move *refinement*, `:415`) | An abstraction (abstract interpretation) whose value a pass must preserve or refine; in polyhedral terms, the order of each reduction's iteration domain | K3, L10 |
| U3 | Contraction recogniser `sum(k) load*load` with index constraints | B `:101`, G `:344`, H `:489`, E `:114`, I `:65-138`, J `:232`, D `:116`, A `:161`, F `tileLegality :429` (each the cell's `schedule.ts` or `schedule-passes.ts`) | A pattern match with capture plus an affine access test | L6, L9 |
| U4 | Thread caps and the "operand streamed from global" test moved from the emitter into the IR | B, G, H, E, I, J, A; base `src/tensor/cuda-source.ts:358`, `:404` | Lowering by annotation; an emitter must only print | K7 |
| U5 | Device limits in passes, with different constants (101376, 99·1024, 48K, 49152) | F, J, D `:623`, A `:370` | A target model consulted by legality | L17 |
| U6 | Launch-variant *sides* multiplied into the differential's cases, and hand-folded into `baselineKey` | B `cuda-contract.ts:180`, G `:137`, E `:167`, D `modesOf`, A `'scheduled'` | Differential testing over the product (inputs × enumerated runtime choices) | L13, K8 |
| U7 | Per-application cost worked around by memoisation (10 ms and 30 ms per application; 53 steps per kernel; 19.6 s to 51 s before memoising) | D `t6-op-irwb-033-d/src/tensor/strategy.ts:79`; E report `:202`, `:236` | The runner must be cheap for many small steps: lazy projection and lazy diff | K2 |
| U8 | Backward lineage walk to r0 over correspondence + `origin` + edits | sm `d1-sm-irwb-034-a/src/typed/backend/attribution.ts:112-125`; tl `d1-tl-irwb-034-c/src/typed/backend/attribution.ts:17-27` (uncommitted); ds-x `d1-ds-x-irwb-034-d/src/typed/attribution.ts:126-145` (uncommitted); op `d1-op-irwb-034-f/src/typed/attribution.ts:177-203` (copies `whyEntity`'s skip rule, `:127`). Only am calls `whyEntity` (`d1-am-irwb-034-b/src/typed/attribution.ts:40`) | Relational composition of the revision chain, *with in-place modifications visible* | K5, K6 |
| U9 | Per-revision replay delta ("measure rev k-1 and k, diff per site") | fa (merged, `src/typed/attribute.ts:185`); g-h `d1-g-h-irwb-034-e/src/typed/attribute.ts:82`, `:126`; op `:336`; am `:13`; plus one `01-*` script per cell | A metric evaluated along the revision timeline, attributed by correspondence | K6, L14 |
| U10 | Natural loops merged per header, or guarded | analysis: g-h `d1-g-h-irwb-034-e/src/typed/analyses.ts:216`, fa (merged, `src/typed/analyses.ts:216-226`); consumer: sm `d1-sm-irwb-034-a/src/typed/passes.ts:434`, op `d1-op-irwb-034-f/src/typed/passes.ts:430`; guards: am, ds-x, tl | The natural-loop forest (one loop per header, a latch set) over a generic graph | L1 |
| U11 | Tree equality modulo ids | in all seven A0 cells (for example `a0-g-h-irwb-035-e/src/typed/edit-class.ts:91-96`); D1-fa's hash-consed `keyOf` in LICM (merged `src/typed/passes.ts:479-497`) | Structural hashing / value numbering of terms | L5 |
| U12 | A second copy of the rule matcher, or a fake `ValueHandle` to run the production matcher without a `Tx` | twins C `a0-tl-irwb-035-c/tools/edit-census.mjs:21-61` (uncommitted) and E `a0-g-h-irwb-035-e/src/typed/edit-class.ts:107-175`; fake handles D `:102-175`, F `:104-157`, G `:116-158` | Running rules on a read-only projection: "does rule set R derive B from A" | L6 |
| U13 | Weakest-evidence reduction over a strength order | `a0-g-h-irwb-035-e/src/typed/edit-class.ts:178-183`, `a0-op-irwb-035-f/src/typed/edit-classes.ts:159-173`, `a0-fa-irwb-035-g/src/typed/edit-classes.ts:162,175-178` | The meet of an evidence lattice | K4 |
| U14 | Pass-name → class tables; rule citations re-derived because no edit cites its rule (0 citations in every cell) | `a0-sm-irwb-035-a/src/typed/edit-classification.ts:32`; `a0-am-irwb-035-b/src/typed/edit-census.ts:78`; F report `:285` (`Tx.cite` never built) | A derivation log entry that names its rule and premises | K5 |
| U15 | Net effect of a transaction log per slot (chains of `replace` on one field; intermediate trees exist only in the working store) | `a0-ds-x-irwb-035-d/src/typed/edit-classes.ts:321-339`; E `:300-333`; F; G | Log compaction: the derivation's net step per site | K5 |
| U16 | Flow-insensitive greatest-fixpoint BTA (static/dynamic per local) | `b1-op-irwb-036-f/src/typed/pe.ts:76-110`, `b1-fa-irwb-036-g/src/typed/bta.ts:65-115`, again for frame locals in `b1-fa-irwb-036-g/src/typed/specialize-buffer.ts:81-89` | A two-point lattice solved over the def-use graph; probe 04 runs it on the existing solver | L4, L11 |
| U17 | Polyvariant program-point specialiser with memo and budget, keyed on (block, static live-ins) | `b1-sm-irwb-036-a/src/typed/specialize-memory.ts:19-189`, `b1-am-irwb-036-b/src/typed/residualize.ts:18-175`, `b1-op-irwb-036-f/src/typed/pe.ts:184-369`, `b1-fa-irwb-036-g/src/typed/specialize-buffer.ts:98-385`, `b1-g-h-irwb-036-e/src/typed/peval.ts:209-711` | The online partial-evaluation driver (worklist over block × abstract state) | L11 |
| U18 | "Promise holds" no-write / alias checks on a constant buffer | six cells; F and G's `frameRooted` near-identical (`b1-op-irwb-036-f/src/typed/specialize.ts:89`, `b1-fa-irwb-036-g/src/typed/specialize-buffer.ts:41`) | A may-write effect summary per region | L12 |
| U19 | `Binding` extended with a buffer form, so that `assume` restricts the meaning check's case domain | six independent edits of `src/typed/specialize.ts` (for example `b1-sm-irwb-036-a/src/typed/specialize.ts:42-44`) | A *contract under assumptions*: a precondition that narrows the differential's domain | K3, L13 |
| U20 | Frame-array → locals promotion; live-range splitting afterwards; an identical `WriteKind 'frame'` added twice | promotion A, B, E, F, G; splitting `b1-am-irwb-036-b/src/typed/split-ranges.ts`, `b1-op-irwb-036-f/src/typed/webs.ts`, `b1-fa-irwb-036-g/src/typed/copyprop.ts`; `'frame'` `b1-op-irwb-036-f/src/typed/tx.ts:28`, `b1-sm-irwb-036-a/src/typed/tx.ts:27-28` | Scalar replacement (mem2reg) and SSA renaming / out-of-SSA | L2, L18 |
| U21 | Hand-built pipeline drivers because a strategy node cannot carry an artifact parameter | `b1-ds-x-irwb-036-d/src/typed/futamura.ts:56` (uncommitted, design `:251`); `b1-fa-irwb-036-g/src/typed/specialize-buffer.ts:387`; `b1-op-irwb-036-f/src/typed/pe.ts:170-182` | Strategy values that are artifacts, and named artifact bindings | K2 |
| U22 | Corpus before/after sweep scripts | one per D1 cell (for example `d1-am-irwb-034-b/.../scripts/02-corpus.mjs`) and per A0 cell | A corpus metric-diff runner | L16 |

**What this inventory says, taken together.** About a third of the cells' new code is machinery of three kinds:
- *recording* what a pass did and why (U8, U9, U11–U15);
- *deciding* whether a step is allowed (U2, U3, U5, U16, U18);
- *driving* passes (U7, U21, and §2.1's executors).

The framework has a concept for each of the three, but none in the form the cells needed.

## 3. Assessment of each layer

### 3.1 `core` (types, data, sha256, runtime, query, records)

- **Held.** `data.ts` (`canonical`, `fingerprint`, `immutable`) and `sha256.ts` are used everywhere they could be
  (probe 03: seven Typed files). Content-addressed artifacts with revisions are the base of every later layer, and
  F26's reuse check rests on `fingerprint`. **Keep as is.**
- **Bypassed.** The task runtime (`Compiler`), queries and records (1,240 lines) have no domain importer
  (probe 03). Only `src/labs/lab.ts:340` and `src/conformance/01-runtime.ts:8` construct a `Compiler`. IRWB-001
  planned the opposite: "**Taken.** The lowering stages ... are compiler tasks"
  (`ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/01-...md:96`). The lowerings became plain functions instead
  (M11, M12).
- **Leaked.** `core/types.ts` has its own `Pass` (`:80`), a *third* notion of a pass beside `definePass` and
  `defineTransformation`. It also has a `Decision` type with `alternatives[{accepted, reason}]` (`:46-51`).
  That is exactly the record D1-ds-x invented as a `skip` edit, and that T6 cells store as `refusals` inside IR
  values. No domain uses either.
- **Verdict.** Keep `data`, `sha256` and `Artifact`. Either adopt the query engine as the base of E1 (incremental
  checking per function, `BACKLOG.md` E1) or move it to `labs/`. Do not keep 1,240 unused lines in the core with a
  competing `Pass` type.

### 3.2 `ir` (adapters, view, transactions, patterns, rewrites, diff, correspondence, store)

- **Held.** The adapter, the finite logical projection and revision-qualified references held under both domains.
  So did entity enumeration for checked correspondence (F23 and F24, `src/tensor/cuda-contract.ts:36-41`). They
  are what lets `diff` and `undeclaredWrites` (`src/framework/passes/define-pass.ts:152-164`) work for any IR.
  `composeCorrespondence` is correct and usable: T6-I composed Tix → schedule → CUDA with it
  (`t6-gf-h-irwb-033-i/src/tensor/cuda-contract.ts:215`). **Keep** adapters, the projection, references, diff and
  the correspondence algebra.
- **Bypassed.**
  - Transactions (`IREdit`) and the rewrite engine. Typed passes edit through their own `Tx` (M1). Tix passes
    return whole modules (M9). The rewrite engine's only callers are labs and conformance tests (probe 03).
  - The projection is too expensive to run per small step. T6-D measured about 10 ms per application ("projection,
    diff, correspondence, `immutable` and fingerprints", `t6-op-irwb-033-d/ttmp/.../reference/02-report...md:224`);
    T6-E measured 30 ms (U7).
- **Leaked.**
  - Correspondence derived from projections cannot see *what a pass did*, only *what differs*. A merge becomes a
    removal plus a retention (probe 01), and an in-place edit is `retained` (D1).
  - The derived correspondence has relations `retained`/`removed`/`added`, while the domain's intent (merge,
    split, modified, because) lives in the domain's log.
  - Two correspondence types do not meet: contracts' `Correspondence` and ir's `EntityCorrespondence`. T6-I had
    to write `asEntityCorrespondence` (`t6-gf-h-irwb-033-i/src/tensor/cuda-contract.ts:130`).
- **Verdict.**
  - The *projection* half of the layer is sound.
  - The *editing* half (transactions, rewrites) was designed for a generic logical edit. The domains needed
    something else: native edits with intent (scoped, cited, with premises), and rules that can be verified.
  - Rebuild the editing half around a derivation log (K5) and rules as data (L6). Unify the two correspondence
    types.

### 3.3 `contracts` (definitions, analysis manager, differential, effects, registry)

- **Held.**
  - `defineIR`, `defineAnalysis` and `defineTransformation`, revision-exact analysis caching, and the
    `requires/ensures/preserves` vocabulary. These are the best-founded part of the framework.
  - The lowering contract (`src/tensor/cuda-contract.ts:203-233`) shows that the vocabulary expresses a cross-IR,
    GPU-checked step cleanly.
  - `differential()` with batch `decide` and F26's key check carried the GPU checking.
  - **Keep** the definitions, the analysis manager's caching semantics and the differential.
- **Bypassed.**
  - The manager's asynchrony. Every T6 cell needed a synchronous check, and four built one (§2.1).
  - `effects.ts` has no domain user (probe 03).
  - `preserves` with checked transfer is used by Typed. It is effectively unavailable to Tix, because the sync
    runner refuses it (`src/framework/passes/define-pass.ts:231-232`, probe 01(b)).
- **Leaked.**
  - The assurance vocabulary is too poor. `Assurance = 'declared' | 'checked' | 'transferred' | 'proof'`
    (`src/framework/contracts/types.ts:164`).
  - Every invariant check is stamped `checked` (`src/framework/contracts/analysis-manager.ts:1177`), so a sampled
    check and an exact one are indistinguishable in the fact record (probe 02).
  - IRWB-001 had planned `checked-sampled` and `checked-exact`
    (`ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/01-...md:66`). Only the dead helper `assuranceOf`
    survives (`src/framework/contracts/differential.ts:377-380`).
  - Meanwhile Typed's rule evidence distinguishes proof, complete-at-8-bits and sampled
    (`src/typed/rules/verify.ts:8-15`), and nothing carries it into a pass's evidence.
- **Verdict.** Keep the vocabulary. Make evidence graded (K4) and make clause evaluation synchronous wherever the
  checker is (K2).

### 3.4 `passes` (definePass, the two runners, the bridge)

- **Held.**
  - Declared `writes`, enforced against the actual diff, caught real cases. B1-F could not delete `arrayBytes`
    without a write kind (`b1-op-irwb-036-f/ttmp/.../diary:51`). That is the declaration doing its job.
  - `preserves` checked by transfer or recompute, and the native-result path with explicit correspondence entries.
  - **Keep** `writes` and `preserves`, and the native-result path.
- **Bypassed.**
  - *Every* cross-IR step: the Tix lowering, the Typed lowering, and Tix → schedule in five different ways.
    `PassSpec` has exactly one `ir` and one `adapter` (`src/framework/passes/define-pass.ts:83-84`), and the output
    is built with the input's adapter (`:201`).
  - Every T6 driver. Everyone wrote a loop around `applyNativePassSync` because nothing else is synchronous.
- **Leaked.**
  - **Two runners with different powers** (`applyNativePassSync`, `:225-265`; `applyPass`, `:267-402`). The sync
    one refuses `needs`, `preserves` and `contract` (`:231`), so a domain must choose between simplicity and
    checking.
  - **F27 is misdiagnosed.** Probe 01(c) runs Tix's passes through `passAlgorithm` and the async interpreter
    successfully. The real loss is that Tix's meaning check is a *synchronous closure passed to the runner*
    (`src/tensor/contract.ts:121`, used at `src/tensor/index.ts:39-43`), not a contract. So it cannot travel with
    the pass into a plan.
  - The framework learns only an edit *count* from a native pass (`NativeResult.edits`, `:73-74`); its report is
    opaque (`:76`).
- **Verdict.** This layer is the root of most findings. Replace it with K1 (arrows), K2 (one runner, obligations)
  and K3 (clauses).

### 3.5 `dataflow` (lattices, solver, `dataflow()`)

- **Held.** Liveness, reaching definitions and ranges with widening run through it
  (`src/typed/analyses.ts:296`, `:352`, `:486`) and reproduce Compiler Workbench's facts. Refusing infinite-height
  lattices without widening (`src/framework/dataflow/solver.ts:94-98`) is right. **Keep** the solver and the
  lattices.
- **Bypassed.**
  - SCCP (M7), two B1 BTAs and one edge-constant analysis (U16), and every T6 order analysis (U2). Tix uses
    nothing from the layer (probe 03).
  - Probe 04 shows the solver *can* express a flow-insensitive BTA over a def-use graph.
- **Why it was bypassed.**
  - The layer is named and shaped as a CFG analysis: `dataflow()` takes a spec over blocks and regions
    (`src/framework/dataflow/analysis.ts:24-56`, `:110`).
  - There is no sparse (SSA def-use) mode and no conditional "executable edge" mode, which SCCP needs.
  - It offers no graph builders beyond `flowGraphOf` (`:204`).
  - It has no concept for tensor iteration spaces at all.
- **Verdict.**
  - Keep the solver. Generalise its input from "a CFG" to "a dependence graph with a transfer per node".
  - Add a sparse, conditional mode.
  - Move CFG-specific algorithms (dominators, loops, SSA) beside it into the standard library (L1–L4).
  - Iteration-space dependence (F29) is a different theory (§6, L9) and does not belong in this solver.

### 3.6 `strategy` (Strategy IR, interpreter, validation, editing, serialisation)

- **Held.** Plans as versioned data, `fork`/`chooseBest` with recorded decisions, pinned algorithm versions
  (`src/framework/strategy/README.md:42`). Typed's pipelines and per-project choice run on it
  (`src/typed/strategies.ts:187`). **Keep** the operator set, plan-as-data and decision evidence.
- **Bypassed.**
  - By every Tix path and every T6 cell but J. All five cells of one survey say the asynchronous interpreter
    (`src/framework/strategy/interpreter.ts:134`) cannot serve the synchronous `cudaSource`.
  - By B1 drivers that need an artifact parameter in a node (U21).
  - `strategy/editing.ts` has no domain user (probe 03).
- **Leaked.**
  - Algorithms exchange finite JSON (`src/framework/strategy/README.md:44`). An artifact is therefore an opaque
    JSON value inside a plan, and a pass cannot receive a second artifact (bindings, an origin) except through
    closure capture.
  - `chooseBest` decides at compile time. The gate (`src/tensor/fusion.ts:135-140`) is a choice that must be
    *residualised* into the artifact and taken at launch. The strategy layer cannot express that (T6-E report
    `:234`).
- **Verdict.** Keep the plan language. Make the interpreter's execution mode a property of the algorithms it
  calls (K2). Add artifact-valued bindings and a staged choice (K8).

### 3.7 What should be kept exactly as it is

- `core/data.ts` and `core/sha256.ts`;
- the adapter/projection/reference model (`ir/adapters.ts`, `ir/view.ts`, `ir/types.ts` minus the edit types);
- `ir/diff.ts` and the correspondence algebra (`ir/correspondence.ts`);
- the contract definition vocabulary (`contracts/definitions.ts`);
- analysis caching per exact revision;
- `differential()` and its batch protocol;
- the dataflow solver;
- the Strategy IR's operators and its plan-as-data validation.

These held under two very different domains without workarounds.

## 4. Fundamental changes

### 4.1 Recommended

**R1. Passes are typed arrows between IR types** [E]

- **Change.** A pass is `Arrow<S, T>` with `from: IRType<S>` and `to: IRType<T>`; an endomorphic pass is the case
  `S = T`. Its result carries a correspondence from `from`'s entities to `to`'s.
- **Composition.** Arrows compose (`a.then(b)`) when the types meet. The composite's correspondence is the
  relational composition of the parts (`composeCorrespondence`, `src/framework/ir/correspondence.ts:149`). Its
  evidence is the meet of the parts' evidence (R3).
- **Theory.** IR types and checked translations form a category: objects are IR types, morphisms are (function,
  correspondence) pairs. Correspondence composes in the category of relations (**Rel**). Translation validation
  (Pnueli–Siegel–Singerman; Necula) is a property of one morphism, and a pipeline's guarantee is built by
  composing them.
- **Evidence.** Every lowering in the repository is outside `definePass`:
  - Tix → CUDA (`src/tensor/cuda-contract.ts:203`);
  - Typed → RV32 (`src/typed/backend/compile.ts:442`);
  - fusion (`src/tensor/index.ts:68`);
  - Tix → schedule in five T6 mechanisms (§2.1).
- **Deletes.** `PassSpec.source` (G), the B and H workarounds, and the lowering's special shape.

**R2. Separate the transform from its proof obligations; one runner, one interpreter; sync/async per
obligation** [E]

- **The transform.** It is a synchronous, pure function from an input revision to a candidate. It returns the
  candidate, a derivation (R4) and possibly a *refusal*.
- **The obligations.** They are declared clauses (K3). Each has an evaluation mode: synchronous (a structural
  check, a pure analysis compared or transferred) or deferred (a differential that needs a GPU batch).
- **The runner.** It returns `Accepted | Refused | Rejected | Pending(obligations)`. It is synchronous when every
  obligation is, and otherwise yields the pending obligations to a checker that can batch them.
- **The strategy interpreter.** It is one interpreter, parameterised by this mode. It runs synchronously over
  synchronous algorithms and awaits only at deferred obligations.
- **Theory.** The proof-obligation discipline of translation validation: the transformer is untrusted and fast,
  the validator is trusted and separately scheduled. In programming-language terms, the transform lives in the
  identity effect and the checks in a batching effect; batching applicative checks is the standard way to group
  remote work.
- **Deletes.** `applyNativePassSync`'s restrictions (`src/framework/passes/define-pass.ts:231`), both
  `strategy/sync.ts` files, both `syncPassAlgorithm`s, the bridge gate mode, the Tix driver loop
  (`src/tensor/index.ts:32-60`), and the six T6 hand loops.
- **Pays for.** The cheap mode U7 needs: projection, diff and fingerprint become lazy. They are computed only if an
  obligation or a record asks for them.

**R3. "Checked" becomes a graded evidence term** [E]

- **Change.** Replace `'checked'` by an evidence term. Its *method* is one of:
  - `structural`;
  - `recomputed-equal`;
  - `sampled{cases, generator@version, seed, coverage}`;
  - `bounded{domain}` (for example "every 8-bit assignment");
  - `exhaustive{domain}`;
  - `proof{verifier@version, certificate}`;
  - `transferred{from, rule}`.

  Methods are partially ordered by strength. A pipeline's evidence is the meet of its steps'. A clause may require
  a minimum, and an acceptance policy states which grade it accepts per relation.
- **Theory.** A lattice of evidence, as an assurance case reads it. The repository's rule verifier already
  implements the grades (`src/typed/rules/verify.ts:8-15`). Three A0 cells computed the meet by hand (U13).
- **Deletes.** `assuranceOf` and the A0 copies of "weakest".
- **Makes visible.** The share of a pipeline that rests on samples. That is the thing that has been wrong twice
  (F21, F22), and programme A wants to drive it down.

**R4. A structured derivation log is the primary record; correspondence is derived from it** [E]

- **The record.** Every edit is a *derivation step* with:
  - the rule or decision it applies (id@version, or a pass-local decision code);
  - the site (entities matched);
  - its premises (facts cited, `because`);
  - the local before/after;
  - the relation it induces (merge, split, modified, inserted, removed).
- **Derived from it.** The correspondence is computed from the log, so it records intent, not a diff. The diff
  remains as an *audit* that the log covers every actual change (the `writes` check, generalised).
- **Theory.** Derivations in term rewriting (a derivation is the proof term of the rewrite) and provenance
  semirings: annotating facts with how they were derived, so that counting, why-provenance and lineage are
  instances of one structure.
- **Absorbs.**
  - Typed's `Edit`/`origin`/`because` (M1);
  - F31's rule citation;
  - F30's "new entry" edit;
  - D1-ds-x's `skip` record;
  - T6's refusal records, which become log entries rather than IR fields, so a refusal no longer changes the
    revision;
  - A0's chain compaction (U15).
- **Turns into queries over the log.** Edit classification (A0) and attribution (D1) become short queries (L14,
  L15).

**R5. Rules as data with pluggable verifiers replace callback rewrites; the unused core runtime is adopted or
moved** [E for rules, C for the runtime]

- **Rules.**
  - A rule is `{lhs: Term pattern, guard: Guard data, rhs: Template, premises?: FactPattern[]}` over a term
    signature the domain supplies. The framework matches it and records the derivation step (R4); a verifier
    attaches evidence (R3).
  - The current callback rewrites (`src/framework/ir/README.md:60`) cannot be verified because their right-hand
    side is code. Typed abandoned them for exactly this form (M3, M4).
  - The seven rewrite schedules are kept only if a domain uses them after the port. Otherwise move them to labs.
- **The runtime.** The core runtime becomes the base of incremental, per-function checking (E1), or leaves the
  core. Today it is a 1,240-line second pass model nobody calls.

### 4.2 Considered and rejected

- **An e-graph as the core IR representation.**
  - A0's census shows local value rewrites are 10–20% of O2 edits and 4–10% of `speed` edits; structural edits
    dominate (A0 survey (c)).
  - An e-graph addresses the minority. It belongs to A1 as one stdlib algorithm over L6's rules, not to the core.
- **Dropping the logical projection and going native-only.**
  - F23/F24's checked correspondences, generic `diff`, `writes` enforcement and the workbench's generic views all
    depend on it. The cost problem (U7) is solved by laziness (R2), not by removal.
- **Making everything asynchronous.**
  - `cudaSource` is a fixed synchronous API. Most checks are structural, and the cost of awaiting per step is
    measured (U7).
  - Async must be a property of the obligation that needs it, not of the framework.
- **A universal multi-level IR with dialects (MLIR-style) now.**
  - Two domains and one emerging middle IR do not justify a dialect system.
  - Overlays (K7) and arrows (R1) cover the schedule IR. Revisit when a third IR kind needs to share operations
    across levels.
- **Moving SCCP, SSA and loops into the generic core.**
  - They presuppose control flow and variables. The core must stay representation-free. They belong in the
    standard library (§6).
- **A theorem prover or SMT solver in the core.**
  - The `proof` slot with an external certificate verifier is the right boundary
    (`src/framework/contracts/README.md:117`).
  - Verifiers (bit-vector exhaustion, linear normal forms, an SMT bridge if the user approves one) are stdlib
    plug-ins that produce R3 evidence.

## 5. Proposed framework concepts (generic core)

Each concept has its theory, a domain-independent interface sketch and its uses. Sketches are TypeScript-shaped
types, not code to merge.

### K1. Arrow (typed translation) [E]

- **Theory.** A morphism in the category of IR types; correspondence as a relation in **Rel**; translation
  validation per morphism.

```ts
interface Arrow<S, T, P = unknown> {
  id: string; version: string;
  from: IRType<S> & { adapter: IRAdapter<S> };
  to: IRType<T> & { adapter: IRAdapter<T> };
  obligations: Obligation[];                 // K3
  transform(input: Revision<S>, params: P, log: DerivationLog): Candidate<T> | Refusal;
}
type Endo<S, P = unknown> = Arrow<S, S, P>;
function then<A, B, C>(f: Arrow<A, B>, g: Arrow<B, C>): Arrow<A, C>;   // correspondence: relational composition
```

- **Uses.**
  - Tix → CUDA (`src/tensor/cuda-contract.ts:203`), Typed → RV32 (`src/typed/backend/compile.ts:442`);
  - Tix → schedule and schedule → CUDA (all T6 cells);
  - the B1 specialiser, which is an arrow from (`typed.blocks` × `typed.bindings`) (`src/typed/specialize.ts:49`)
    to `typed.blocks`;
  - Typed's SSA *view* as an arrow into an SSA IR, if SSA becomes a transform (U20).

### K2. One runner with obligations, and one strategy interpreter [E]

- **Theory.** Proof obligations separated from transformations (translation validation). Evaluation mode as an
  effect: synchronous identity, or deferred and batched.

```ts
type Outcome<T> =
  | { kind: 'accepted'; revision: Revision<T>; evidence: Evidence; derivation: Derivation }
  | { kind: 'refused'; reason: Reason }                    // not applicable: a normal outcome, not an error
  | { kind: 'rejected'; obligation: string; evidence: Evidence }
  | { kind: 'pending'; obligations: DeferredObligation[]; resume(results): Outcome<T> };
function apply<S, T>(a: Arrow<S, T>, input: Revision<S>, ctx: RunContext): Outcome<T>;  // never a Promise
function settle<T>(o: Outcome<T>, checker: BatchChecker): Promise<Outcome<T>>;          // only for 'pending'
// The strategy interpreter: execute(plan, registry, input, { mode: 'sync' | 'batched' }).
// 'sync' rejects a plan that reaches a deferred obligation.
```

- **Uses.**
  - all T6 drivers;
  - `optimizeTix` (`src/tensor/index.ts:32`);
  - Typed's `applyPass`, `program.ts` and `strategies.ts`;
  - the B1 drivers (U21), once bindings can hold artifacts.

### K3. Clauses: requires, ensures, preserves, refines; refusal as an outcome [E]

- **Theory.** Hoare triples `{P} pass {Q}`, where a precondition is an analysis fact on the input. `preserves A`
  means `A(out) = A(in)` under the correspondence. `refines A` generalises it: `A(out) ⊑ A(in)` in a declared
  order. T6-J's allowed moves (`t6-g-max-irwb-033-j/src/tensor/schedule.ts:415`) are a refinement order, not an
  equality.

```ts
type Obligation =
  | { requires: AnalysisDefinition<any, CheckResult> | PropertyDefinition }      // legality, applicability
  | { ensures: InvariantDefinition<any> }                                        // postcondition, meaning check
  | { preserves: AnalysisDefinition<any, any>; via?: 'transfer' | 'recompute' }
  | { refines: AnalysisDefinition<any, any>; order: (after, before) => boolean };
// Each definition declares its mode (sync if pure and local, deferred if it needs a resource such as the GPU).
// An `assumes` clause narrows the case domain of a differential invariant (U19).
```

- **Uses.**
  - `PassSpec.legal`, `postcondition`, sync `preserves`, `claims`, and the gate with correspondence (§2.1);
  - `planFusion`'s refusals (`src/tensor/fusion.ts:48-52`);
  - the LICM guards of D1 (am, ds-x, tl);
  - B1's buffer assumptions (U19).

### K4. Graded evidence [E]

- **Theory.** A meet-semilattice of evidence methods, with a monotone `meet` along composition.

```ts
type Method =
  | { m: 'declared' } | { m: 'structural' } | { m: 'recomputed-equal' }
  | { m: 'sampled'; cases: number; generator: Ref; seed: number; coverage?: Coverage }
  | { m: 'bounded'; domain: string } | { m: 'exhaustive'; domain: string }
  | { m: 'proof'; verifier: Ref; certificate: Ref } | { m: 'transferred'; from: Ref; rule: Ref };
interface Evidence { method: Method; checker: Ref; subject: RevisionRef; detail?: Json }
function meet(a: Evidence, b: Evidence): Evidence;   // the weaker, with both retained in detail
function atLeast(e: Evidence, grade: Grade): boolean;
```

- **Uses.**
  - every fact recorded by the manager;
  - Typed's rule evidence (`src/typed/rules/evidence.ts`);
  - A0's "weakest" (U13);
  - T6's mixture of order proofs on the IR and sampled GPU checks. T6-D found printer mutants that pass every IR
    check and fail only on the GPU (`t6-op-irwb-033-d/ttmp/.../reference/02-report...md:161`). That is precisely a
    per-arrow grade difference.

### K5. Derivation log [E]

- **Theory.** Rewriting derivations (proof terms) and provenance annotations (why-provenance, counting
  provenance as instances of one semiring-annotated record).

```ts
interface Step {
  id: string; arrow: Ref; scope?: EntityRef;           // e.g. a function: per-function transactions (M2)
  apply: { rule: Ref } | { decision: string };         // a verified rule, or a pass-local decision code
  site: EntityRef[];                                   // what matched
  premises: (FactRef | EntityRef)[];                   // `because`
  relation: 'modified' | 'merged' | 'split' | 'inserted' | 'removed' | 'refused';
  before?: Json; after?: Json;                         // local terms, for replay and classification
  alternatives?: { name: string; accepted: boolean; reason: string }[];   // core/types.ts Decision, finally used
}
interface DerivationLog { record(step: Omit<Step, 'id'>): StepRef; compact(): Step[]; correspondence(): EntityCorrespondence }
```

- **Uses.**
  - Typed's `Tx` becomes a domain façade over it (M1, M2);
  - Tix passes record merges for `inline` (probe 01);
  - D1 (U8), A0 (U11–U15), F30 and F31;
  - T6 refusals (U2, §2.1).

### K6. Measures along correspondence [E]

- **Theory.** Pushforward of a measure (counts, time) along a relation, with a declared splitting policy; a
  telescoping sum over a chain gives exact per-step accounting. With counting provenance this is the semiring
  `(ℕ, +, ×)`.

```ts
function pushforward(measure: Map<EntityId, number>, c: EntityCorrespondence,
                     policy: 'owner' | 'even' | 'first'): { credited: Map<EntityId, number>; residual: number };
function telescope(chain: Revision[], measure: (r: Revision) => Map<EntityId, number>,
                   log: DerivationLog): { rows: { step: StepRef; delta: number }[]; check: 'exact' | string };
```

- **Uses.**
  - D1's seven tools;
  - A0's six instruction weightings;
  - Tix GPU time per kernel pushed to statements through `kernelCorrespondence` (`src/tensor/cuda-contract.ts:83-98`),
    with gate sides from F25;
  - compile-time cost per pass (U7).

### K7. Overlay IR (algorithm plus annotations) [E for T6, C beyond]

- **Theory.** The Halide/TVM separation of algorithm and schedule; decorated syntax trees (attribute grammars). An
  overlay is a product IR whose base part is frozen by construction.

```ts
function overlay<B, A>(base: IRType<B>, annotations: AnnotationSchema<A>): IRType<Overlay<B, A>>;
// entities = base entities (read-only) + annotation entities attached to them; writes may touch only annotations,
// so "only the layout changed" (U2's equality half, B's erase-and-compare) is a writes check, not a domain check.
```

- **Uses.**
  - all ten schedule IRs (U1), with the emitter's decisions as annotations (U4);
  - `typed.bindings` (`src/typed/specialize.ts:49`) as an overlay of assumptions on a program [C];
  - backend variant choices (`src/typed/backend/compile.ts:455`) as annotations of `typed.blocks` [C].

### K8. Choice points and staged choice [E for the need, C for the unification]

- **Theory.** A strategy specialised on its static inputs (shapes known at compile time or not) leaves a residual
  choice: binding-time analysis applied to the strategy itself. The residual is compiled into the artifact as a
  guarded multi-version (multi-versioning).

```ts
// A choice is recorded as a decision with alternatives (K5). A strategy node may be staged:
S.select(id, candidates, rule, { stage: 'compile' | 'launch' });
// 'launch' keeps every candidate in the artifact and records the rule as a guard; the differential's cases are
// then the product of samples and guard outcomes (U6), derived, not hand-built.
```

- **Uses.**
  - the fusion gate (`src/tensor/fusion.ts:135-140`);
  - T6-D's variant `select` and T6-F's dispatch;
  - B1-G's runtime `oneOf` guard (`b1-fa-irwb-036-g/src/typed/specialize-buffer.ts:300-370`);
  - Typed's backend variant choice (`src/typed/backend/compile.ts:455`).

## 6. The proposed standard library: its layering criteria and its primitives

### 6.1 Layering criteria

A part belongs to the **generic core** when all of these hold:
- it is needed to *define, compose, check or record* a transformation on any IR;
- it can be stated without reference to control flow, values, numbers, memory or a target;
- both domains use it in the same form.

Examples: artifacts, adapters, arrows, obligations, evidence, the derivation log, correspondence, strategies.

A part belongs to the **standard library** when all of these hold:
- it is an algorithm over a *named, generic structure*: a graph, a CFG interface, an SSA interface, terms, affine
  expressions, f32 bit patterns, measurements;
- it is parameterised by an interface smaller than its implementation, which the domain implements;
- it has at least two uses, in the material or in a queued stage;
- it depends only on the core and other stdlib modules, never on a domain;
- it produces core records (analyses, obligations, evidence, derivation steps), so it composes through the core
  rather than with its caller.

A part **stays in the domain** when it states the semantics of one language or target. Examples: operator tables,
evaluators, the emitters, rule-table *contents*, device constants, the corpus.

Two operational tests:
- *Can the module's tests be written with a toy IR?* If yes, it is not domain code.
- *Would a second domain have to copy it?* If yes, it is not domain code either.

Layout: `src/stdlib/<area>/`. Each module exports `defineAnalysis`/`Obligation`/verifier values, so a domain
consumes it through `needs`, clauses and evidence rather than by calling helpers.

### 6.2 The primitives

Each entry has four parts: the interface, the theory it implements, what it replaces, and how it composes.

**L1. Graph analyses** [E]
- *Interface.*
  - `dominators(g: FlowGraph)`, `postdominators(g)`;
  - `loopForest(g, dom)`, returning `{head, latches[], body, exits, preheader?, parent}` with one loop per header;
  - `reversePostorder(g)`.
- *Theory.* Cooper–Harvey–Kennedy dominators; natural loops from back edges (a back edge is an edge whose target
  dominates its source); the loop nesting forest.
- *Replaces.* `src/typed/analyses.ts:140`, `:215-260`; the solver's `depthFirst` loop heads
  (`src/framework/dataflow/solver.ts:64`); four D1 loop merges and three guards (U10).
- *Composes.* Typed's `typed.loops` becomes `defineAnalysis` around `loopForest(flowGraph(f))`. It feeds L2, LICM's
  `requires`, and a later Tix loop-nest IR.

**L2. SSA construction and destruction** [E]
- *Interface.* `ssa(g, defsUses: VarInterface)` producing names, phis and an idom view; `webs(reaching)` for
  live-range splitting; `outOfSsa(ssa, coalesce)`.
- *Theory.* Cytron et al. minimal SSA; webs by union-find over reaching definitions; out-of-SSA with copy
  coalescing.
- *Replaces.* `src/typed/ssa.ts:60`; `b1-am-irwb-036-b/src/typed/split-ranges.ts`; `b1-op-irwb-036-f/src/typed/webs.ts`;
  `b1-fa-irwb-036-g/src/typed/copyprop.ts`.
- *Composes.* Requires L1; feeds L3 and L11.

**L3. Sparse and conditional propagation** [E]
- *Interface.* `sparse({ graph: DefUseGraph, lattice, transfer, executable?: EdgeTransfer })`.
- *Theory.* Wegman–Zadeck sparse conditional constant propagation, generalised to any lattice. It is the sparse
  counterpart of the monotone framework.
- *Replaces.* `src/typed/sccp.ts:47`; `b1-ds-x-irwb-036-d/src/typed/dispatch.ts:76-112` (uncommitted); the online
  parts of the B1 BTAs.
- *Composes.* Uses L4's lattices and the core solver's convergence and widening rules. Yields `defineAnalysis`
  facts.

**L4. Lattice kit** [E]
- *Interface.* Flat, set, interval, map, product, lifted and two-point binding-time lattices, each with `meet`,
  `join`, `widen`.
- *Theory.* Complete lattices for abstract interpretation (Cousot–Cousot); widening for infinite height.
- *Replaces.* `src/typed/sccp.ts:23-34`'s `Lat`; the B1 abstract domains (`b1-g-h-irwb-036-e/src/typed/peval.ts:106-130`);
  probe 04's two-point lattice.
- *Composes.* It is `src/framework/dataflow/lattices.ts` moved and extended.

**L5. Terms and structural hashing** [E]
- *Interface.* `structuralKey(term, signature)`, `equalModuloIds`, `hashCons(table)`.
- *Theory.* Hash-consing; value numbering as congruence on terms.
- *Replaces.* Seven A0 `sameTree`s (U11); LICM's `keyOf` (`src/typed/passes.ts:479-497`); Typed LVN's key.
- *Composes.* Basis for L6 and for an e-graph (A1).

**L6. Rules as data: matching, compiling, re-deriving, differencing** [E]
- *Interface.*
  - `Rule = {lhs: Pattern, guard: Guard[], rhs: Template, premises?}` over a domain `Signature`;
  - `match(rule, term)`;
  - `compile(rules)`, a first-match visitor that records K5 steps;
  - `derives(rules, before, after)`;
  - `windows(before, after)`, the minimal differing subterms.
- *Theory.* First-order term rewriting; rule application as a derivation step.
- *Replaces.*
  - `src/typed/rules/compile.ts:24` and following;
  - the A0 matcher copies and fake handles (U12);
  - the eight or nine T6 contraction recognisers (U3), as patterns with affine guards from L9;
  - `ir/rewrites.ts`'s callback form (R5).
- *Composes.* Steps go to K5; verifiers (L7) attach K4 evidence; the guards call L4/L3 facts as premises.

**L7. Rule verifiers** [E]
- *Interface.* `verify(rule, evaluator: Signature->Semantics, methods[])`, returning K4 evidence.
- *Theory.* Translation validation at rule granularity (the Alive approach); bounded exhaustive checking;
  symbolic normal forms over ℤ/2ⁿ.
- *Replaces.* The domain binding of `src/typed/rules/verify.ts`. The methods become generic; the operator semantics
  stay in Typed.
- *Composes.* Feeds K4; a cited rule step (K5) inherits the rule's evidence. That is programme A's "assemble a
  function's equivalence from per-rule proofs".

**L8. Exact f32** [E]
- *Interface.*
  - round-to-nearest-even `add`, `sub`, `mul`, `div`, `sqrt` on bits;
  - `equalWords(a, b, {nan: 'class'})`;
  - special-value generators;
  - per-function rounding tables.
- *Theory.* IEEE 754 binary32 semantics.
- *Replaces.* `src/typed/f32.ts`; the comparisons at `src/tensor/contract.ts:100-117` and
  `src/tensor/cuda-contract.ts:105-121`; the evaluator's `Math.fround` discipline (`src/tensor/evaluate.ts:26`).
- *Composes.* Used by both evaluators, by L13's value streams and by L7's f32 methods.

**L9. Affine expressions and dependence** [E]
- *Interface.*
  - `Affine` and `substitute` (now in `src/tensor/model.ts:2`, `:19`);
  - access relations `{statement, tensor, indices: Affine[]}`;
  - `dependences(accesses)` with distance and direction vectors;
  - `legal(schedule, deps)`, which holds when every dependence remains lexicographically positive.
- *Theory.* Polyhedral dependence analysis (GCD and Banerjee tests for the small cases, exact for affine accesses
  over rectangular domains); schedule legality as preservation of the dependence order (F29).
- *Replaces.* `joinDepth`'s zero-distance test (`src/tensor/fusion.ts:83-105`); the index constraints of the T6
  contraction recognisers (U3); part of every T6 order check.
- *Composes.* Supplies `requires` clauses (K3) to schedule arrows and guards for L6 patterns. Later Typed loop nests
  are a second use [C].

**L10. Reduction-order abstraction** [E]
- *Interface.* `foldOrder(scheduleOrNest): Map<OutputRef, OrderSig>`; `refinesOrder(after, before)`, which allows
  serial → tiled-serial and the like.
- *Theory.* A reduction is a fold over a totally ordered index set. An exact (non-reassociating) schedule must
  induce an order-isomorphism on each fold's index set. The abstraction is an abstract interpretation of the loop
  nest to its term sequence.
- *Replaces.* The five or six T6 order normal forms (U2).
- *Composes.* A `preserves`/`refines` clause (K3) on every schedule arrow, with evidence `structural` or `proof`
  (K4). T10 (split-K) declares the reassociation it introduces against it.

**L11. Binding-time analysis and a partial-evaluation core** [E]
- *Interface.*
  - `division(defUse, sources)`, flow-insensitive or polyvariant over L3, giving static/dynamic per variable;
  - `specialise({ cfg, state: AbstractDomain, transfer, key, budget, generalise })`, a worklist over
    (block × static state) that returns residual blocks plus K5 steps.
- *Theory.* Offline and online partial evaluation (Jones–Gomard–Sestoft); polyvariant program-point
  specialisation; memoisation on static live-ins; generalisation for termination.
- *Replaces.* The five B1 specialisers (U17), two BTAs (U16) and base `specialize.ts:71`.
- *Composes.* Uses L3/L4 for the division, L12 for the promise check, and K3 `assumes` for the contract.
  B2 (Candela) is the second use; shape specialisation of Tix kernels is a third [C].

**L12. Effect and alias summaries** [E]
- *Interface.* `mayWrite(region, program)`, `frameRooted(local)`, written as an analysis with a region lattice.
- *Theory.* Mod/ref analysis; region-based effect summaries.
- *Replaces.* The six B1 promise checks (U18).
- *Composes.* Supplies `requires` for K3 assumptions and is consumed by L11.

**L13. Case-domain combinators** [E]
- *Interface.*
  - `shapes({distinct, zeros, sizes})`, `streams(['signed', 'positive', 'half-ulp', 'zero'])`, `boundaries(spec)`;
  - `product(domains, modes)`, where modes are the guard sides from K8;
  - `restrict(domain, assumptions)`;
  - `coverage(cases)`.
- *Theory.* Combinatorial test generation; boundary-value analysis. The coverage measure feeds K4's `sampled`
  grade.
- *Replaces.* `src/tensor/contract.ts:24-85`; `src/typed/cases-strong.ts`; the four T6 `sides()` (U6); the six B1
  assumption edits (U19).
- *Composes.* Plugs into `differential()`'s `cases`; its id@version becomes the evidence's `generator`.

**L14. Attribution** [E]
- *Interface.* `attribute(chain, measure, log)` = K6's `telescope` plus `pushforward` through the target
  correspondence (instructions → entities), with residual buckets and an exactness check (Σ credits = total).
- *Theory.* Measure pushforward; counting provenance.
- *Replaces.* The seven D1 tools (U8, U9); `src/typed/attribute.ts`; base `heat()` (`src/typed/backend/run.ts:175`);
  A0's weightings.
- *Composes.* Reads K5 and the K1 arrows' correspondences. The domain supplies only `measure` (the emulator's counts,
  GPU kernel times).

**L15. Edit classification** [E]
- *Interface.* `classify(step: Step) -> 'local' | 'structural' | 'other'`, as a query on K5: local iff the step
  cites a rule whose `lhs` is a term pattern, and its premises are facts.
- *Theory.* Locality of a rewrite (a derivation step confined to one redex).
- *Replaces.* The seven A0 classifiers. Their headline disagreement (10.0% to 19.5% local in O2, A0 survey (c))
  comes only from how constprop, subst, lvn and dce are binned. With citations and premises recorded, that becomes
  a policy, not a reconstruction.
- *Composes.* Reads K5 only.

**L16. Measurement** [E]
- *Interface.*
  - `timed(run, {warmup, k, interleave: [A, B]})`, returning the median and dispersion, with a noise threshold;
  - `corpusDiff(projects, pipelineA, pipelineB, metric)`;
  - static cost estimates as named, versioned `defineAnalysis` objectives.
- *Theory.* Robust statistics for noisy timing (medians, interleaving); static frequency estimation (Ball–Larus
  heuristics, as `src/typed/backend/frequency.ts:1-6` already states).
- *Replaces.* The T6 timing protocol in prose (`.../prompts/t6/common.md`); the corpus sweep scripts (U22).
- *Composes.* Its objectives feed `chooseBest`; its results are evidence for cost claims.

**L17. Target model** [E]
- *Interface.* `Target {sharedBytes, sharedOptIn, maxThreads, warp, ...}` as a resource port read by legality
  clauses.
- *Theory.* Machine descriptions (resource constraints as data).
- *Replaces.* The four different T6 constants (U5).
- *Composes.* Read by L9/L10 clauses and by L16's measurements. The interface is stdlib; the values are domain data.

**L18. Scalar replacement (mem2reg)** [E]
- *Interface.* `promote(slots: FixedSlotInterface)`, returning K5 steps.
- *Theory.* Scalar replacement of aggregates / mem2reg.
- *Replaces.* Five B1 promotions (U20) and the twice-added `WriteKind 'frame'`.
- *Composes.* Precondition from L12; followed by L2.

## 7. Migration path

Each step is small and checkable, and leaves the suites green. A step names what it deletes and what to measure.
The order follows evidence strength and dependency: records first (they are cheap and make later steps
measurable), then the runner, then arrows, then the stdlib.

| Step | Change | Check | Deletes | Measure |
|---|---|---|---|---|
| S0 | Baseline: run probe 03, a per-application cost probe (projection, diff, fingerprint), and the assurance census of accepted steps | numbers recorded in this ticket | — | per-application ms; share of steps by assurance |
| S1 | K4 graded evidence: the manager records `method` from evidence; `'checked'` becomes `{m:'sampled'}` or `{m:'structural'}`, etc. | probe 02 prints `sampled`; existing tests unchanged except evidence fields | `assuranceOf` (`src/framework/contracts/differential.ts:377-380`) | share of pipeline steps that are sampled-only |
| S2 | K3 clauses on `PassSpec` (`requires`, `ensures`, `preserves`, `refines`), with sync evaluation for pure analyses; `refused` outcome | T6-D, B, F and H behaviours expressible without their field additions; their tests port mechanically | the four §2.1 field shapes (on merge of T6); the restriction at `src/framework/passes/define-pass.ts:231` | number of `PassSpec` fields added by future cells (target 0) |
| S3 | K2 one runner, sync unless an obligation is deferred; lazy projection and diff | Typed and Tix suites; parity 8286/8286; GPU tests | `applyNativePassSync` (after a release as an alias); Tix's `meaningGate` closure becomes an `ensures` invariant | ms per application before and after (targets: T6-D's 10 ms, T6-E's 30 ms) |
| S4 | One strategy interpreter with `mode: 'sync' \| 'batched'`; artifact-valued bindings | F27's test (fork/chooseBest over `inline` and `split-sum`) runs synchronously; one T6 plan runs inside `cudaSource` | both `strategy/sync.ts` candidates, both `syncPassAlgorithm`s, the bridge gate mode, `src/tensor/index.ts:32-60` | plans that run sync vs batched; wall-clock of the corpus pipeline |
| S5 | K1 arrows; port the Tix lowering and `lowerToImage` | the composed Tix → CUDA correspondence equals `kernelCorrespondence` on every corpus program; the image correspondence unchanged | `PassSpec.source`; the lowering's special shape; `asEntityCorrespondence` | count of cross-IR mechanisms (today: 2 merged, 5 in T6; target 1) |
| S6 | K5 derivation log; Typed's `Tx` writes it; correspondence derived from it, with `modified` and `merged`; Tix `inline` records `merged` | `whyEntity` explains in-place edits; probe 01 shows `f/a -> merged -> f/b`; `rules.test.mjs`'s pinned edit lists updated once | Typed's `revisionCorrespondence` (`src/typed/passes.ts:119-162`); D1's lineage walks and A0's chain compaction when they are rebased | share of executed instructions attributed to a cited decision by `whyEntity` alone (target 100%) |
| S7 | Stdlib, in order: L1 → L4 → L3 → L2 → L5 → L6/L7 → L13 → L8 → L14/L15 → L16 → L9/L10 → L11/L12/L18 → L17 | per module: a toy-IR test plus the domain's existing tests with byte-identical outputs (facts, images, CUDA source) | per module, the domain copy (§6.2 "Replaces") | lines of domain code per stdlib module; copies of matchers, lattices and solvers in domains (target 0) |
| S8 | R5: retire callback rewrites unless a user appears after L6; adopt `core/runtime` + `query` for E1, or move them to `labs/` | conformance tests moved with them | `ir/rewrites.ts` (or its callback part); `core/types.ts` `Pass` if the runtime leaves | lines of framework code without a domain importer (probe 03; today about 2,350 in `rewrites`, `runtime`, `query`, `records`, `effects`, `editing`, some used inside the framework) |
| S9 | K7 overlays and K8 staged choice, as part of merging T6 | the merged T6 cell's schedule IR is an overlay; the gate is a staged `select`; differential sides derived | each schedule IR's hand-written entity generators; `sides()` | cases per program; GPU check time |

### 7.1 Deciding between alternatives

- **Lazy projection vs a native-only fast path in the runner (S3).** Measure ms per application on T6-D's 53-step
  kernels and on Typed's `speed` pipeline (9,736 edits).
  - Choose lazy projection if it brings the cost under about 1 ms per application.
  - Otherwise, allow arrows to declare `diffAudit: 'sample'`.
- **The log as the source of correspondence vs the diff as the source (S6).** Run both on the corpus and compare
  attribution coverage. D1-am shows what `whyEntity` on derived correspondence yields today; D1-op shows edit-log
  lineage. Choose the log if it attributes strictly more and the diff audit never finds an unlogged change.
- **Staged choice as an IR construct vs as a strategy residual (S9).** Compare the two on the gate and on T6-D's
  variant select. The criterion is whether the differential's sides can be derived without domain code.
- **Adopt vs move the core runtime (S8).** Prototype E1's edit-stream benchmark on the query engine. Adopt it only
  if per-edit checking cost falls with program size. Otherwise move it.

## 8. Open questions

1. **Correspondence granularity for tensors.** Statement-to-kernel (today) or per output element and per
   reduction term (T6's "Later" lists, for example `t6-ds-x-irwb-033-h/ttmp/.../report:292`)? L10's order
   abstraction may make element-level correspondence unnecessary for exactness, but attribution of time inside a
   fused kernel may still want it.
2. **The cost of a full derivation log.** `speed` makes 9,736 edits per corpus run. Should local before/after terms
   be stored, or recomputable on demand from a replay?
3. **Which steps can be retired from GPU checking by a proof on the IR?** T6-D's printer mutants show that the
   emitter needs its own check. Does that require translation validation of the printer against the schedule (a
   second arrow with its own grade)?
4. **A pass versioning policy.** D1-ds-x notes that Typed passes never bump their version, because pinned plans
   would break (`d1-ds-x-irwb-034-d/ttmp/.../reference/01...md` §8). Should a change in decisions require a version
   bump? Should a plan pin a version range?
5. **The pass catalogue as data.** Several B1 cells broke a frozen pass-count test by registering a pass (B1
   survey (d)13). Should catalogues be registries with ids, like algorithms?
6. **Is `refines` with a declared order enough for T10 (split-K) and T11 (FMA)?** These steps change the order on
   purpose and must state the new relation (tolerance) as a weakening of evidence, not as a preservation.
7. **Where does `assumes` live?** It is a contract precondition that narrows a differential's domain. Is it an
   obligation of the arrow (K3), or a property of the input artifact (an overlay, K7)?

## 9. References used

- Verified by the repository's own report (`ttmp/2026/11/26/IRWB-019-.../various/report-artifact/index.html`,
  "Further reading"):
  - Pnueli, Siegel, Singerman, *Translation Validation* (TACAS 1998);
  - Necula, *Translation Validation for an Optimizing Compiler* (PLDI 2000);
  - *Provably Correct Peephole Optimizations with Alive* (PLDI 2015);
  - *Alive2* (PLDI 2021);
  - *MLIR* (CGO 2021);
  - Salsa;
  - Adapton (PLDI 2014).
- Named with standard attribution, not fetched in this session:
  - Cytron, Ferrante, Rosen, Wegman, Zadeck (SSA);
  - Wegman and Zadeck (SCCP);
  - Cooper, Harvey, Kennedy (dominators);
  - Cousot and Cousot (abstract interpretation);
  - Jones, Gomard, Sestoft (partial evaluation);
  - Ball and Larus (static branch prediction);
  - Green, Karvounarakis, Tannen (provenance semirings);
  - the Halide and TVM papers (algorithm/schedule separation);
  - the GCD and Banerjee dependence tests;
  - IEEE 754.

  Several of these are already named in the code's comments (`src/typed/ssa.ts:4`, `src/typed/sccp.ts:2-3`,
  `src/typed/analyses.ts:6`, `src/typed/backend/frequency.ts:3-4`).
