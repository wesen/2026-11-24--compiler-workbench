---
Title: 'What the framework should absorb: inventory, concepts, a standard library and a migration path'
Ticket: IRWB-038-D
Status: active
Topics:
    - framework
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/dataflow/solver.ts
      Note: the solver probe 03 runs over a non-CFG graph
    - Path: repo://src/framework/ir/rewrites.ts
      Note: the rewrite engine no domain uses
    - Path: repo://src/framework/passes/define-pass.ts
      Note: the two pass runners and the endomorphism-only PassSpec
    - Path: repo://src/tensor/fusion.ts
      Note: the planner whose decisions ten T6 cells copied
    - Path: repo://src/typed/tx.ts
      Note: the domain transaction whose edit records the framework treats as opaque
ExternalSources: []
Summary: 'A review of the framework against two domains and thirty-one unmerged implementations: an inventory of machinery domains built for themselves, eight framework concepts, a standard library of thirty-four primitives, eight fundamental changes and a twelve-step migration, with six probes.'
LastUpdated: 2026-11-27T13:02:13.495396011-05:00
WhatFor: ""
WhenToUse: ""
---

# What the framework should absorb: inventory, concepts, a standard library and a migration path

IRWB-038-D, a design-level review. No production code was written. Six probes and prototypes are in this ticket's `scripts/`; their output is quoted where a claim rests on it.

**Reading conventions**

- A path without a prefix is in this worktree (`main` at `93ec5fc`).
- `t6-op-d:src/tensor/schedule.ts:271` is a path in the worktree of that cell (`.claude/worktrees/t6-op-irwb-033-d`), at its `HEAD`. The cells are named by task, configuration and ticket letter: `am` Astra, `sm` Sol, `tl` Terra low, `op` Opus, `fa` Fable, `ds-h`/`ds-x` DeepSeek, `g-h`/`g-max`/`gf-h` GLM.
- **Evidenced** means the material shows it and I cite it. **Conjecture** means I argue it and say what would test it.
- Citations into the forty unmerged worktrees were collected by three read-only survey agents. I opened the ones every conclusion rests on myself; those are marked ✓. The rest are as reported.

## 1. Summary

The framework's outer shell held under two domains: content-addressed artifacts, IR types with adapters, the analysis manager, differential contracts, correspondence records and strategy plans. All thirty-one unmerged cells built on them, and none of the twenty-one Typed cells (D1, A0, B1) changed `src/framework/` at all. Eight of the ten T6 cells did.

That last fact is the finding, and it is not good news. The cells did not change the framework because they did not need it for the hard part. The work went into the domain, and the same machinery was built again and again:

- **Six of seven B1 cells** wrote a binding-time analysis, a polyvariant specializer with its memo table and block cloner, a termination budget and a promise check, all inside `src/typed/`. None used the dataflow layer.
- **Seven A0 cells** each rebuilt a rule matcher over published value trees to find out which rewrite rule had fired, because no edit record says so. All seven arrive at the same 183 re-derived edits.
- **Seven D1 cells** each wrote a backward walk over correspondences joined with the edit log, because 98.5 % of correspondence entries are `retained` with no reason (probe 06) and in-place edits are invisible in them.
- **Ten T6 cells** each wrote a hand-made adapter and validator for a plain-object schedule, copied `planFusion`'s decisions into it, and wrote a private accumulation-order analysis. Eight changed the framework, and every one of those changes works around the split between the synchronous and the asynchronous pass runner.

Five findings carry the rest of the document:

1. **The framework's own editing and rewriting layer is used by no domain.** `ir/rewrites.ts` (855 lines), `ir/transactions.ts` (429) and `ir/traversal.ts` (252) are imported by name from neither `src/typed` nor `src/tensor` (probe 01). Typed has its own transaction (`src/typed/tx.ts`, 531 lines) and its own rule engine (`src/typed/rules/`), and Tix rewrites whole modules with `mapExpr`. A Tix artifact cannot even open an edit: `view.beginEdit()` throws `Adapter tensor.adapter is not Rewritable` (probe 02).
2. **What a pass decided is recorded twice in Typed and not at all in Tix, and neither record is the framework's.** Typed's edit log is opaque to the framework (`report?: unknown`, `src/framework/passes/define-pass.ts:75-76`). The framework's correspondence for the same change is 107 times larger than the edit log and says less (probe 06: 190,716 entries for 1,774 edits). Tix's `inline` is recorded as `layernorm/centered: removed`, with no link to the statement that absorbed it (probe 02).
3. **Decisions are entangled with the code that carries them out.** `planFusion` decides and the emitter obeys (`src/tensor/index.ts:66-68`), so ten T6 cells could only wrap its output. Six B1 cells fused their binding-time analysis into the specializer. D1's regression was one decision of `licm` that nothing could inspect. A0 found that half the local rewrites are "a rule plus a dataflow fact", with the fact left implicit.
4. **"Checked" has one meaning, sampled agreement, and no algebra.** A pass is either sampled against the origin or not checked. T6 cells built seven order analyses to argue exactness from the IR, and had no place to record that this evidence is stronger than forty cases. The relation (exact or tolerance) is chosen by a pass's name in `src/tensor/index.ts:42`.
5. **The synchronous/asynchronous split is the largest single source of framework changes.** `applyNativePassSync` refuses `needs`, `preserves` and contracts (`src/framework/passes/define-pass.ts:231-232`). Two cells wrote a second strategy interpreter, three a synchronous bridge, two synchronous preservation. Probe 04 shows one runner, written once, can serve both.

**I propose eight framework concepts** (§5) and **a standard library of thirty-four primitives in ten groups** (§6). The fundamental changes (§7) are:

- **A. Derivations become the spine.** A pass returns its result with a typed derivation: steps that say what was replaced by what, by which rule or decision, because of which facts. Correspondence, `why`, edit classification, attribution and by-construction evidence are all computed from it. The projection-level `IREdit` stops being the one sanctioned editing path.
- **B. A transformation is `decide → justify → apply`.** The decision is data (a plan), legality is a predicate over the plan and analysis facts, and applying is mechanical. Fusion plans, schedules, binding-time divisions, inlining choices and rule applications are instances.
- **C. Passes go between IRs.** `Pass<S, T>` replaces the endomorphism-only `PassSpec`; lowerings stop being second-class `defineTransformation` calls.
- **D. One runner, two drivers.** The pass runner and the strategy interpreter are each written once as effect-requesting code; `applyNativePassSync` and any `executeSync` are deleted.
- **E. Evidence has a relation and a strength, and both compose.**
- **F. The dataflow layer becomes an equation solver** over any node set, with nodes discovered on demand.
- **G. A standard-library tier** between the framework and the domains, with promotion by second use.
- **H. The unused v6 task runtime (`core/runtime.ts`, `core/query.ts`, `core/records.ts`: 1,237 lines) is removed or adopted for incremental checking, decided by one measurement.**

## 2. Method

1. I read the framework's four READMEs and its code, then both domains, before any unmerged work.
2. Three survey agents read the forty worktrees (T6; D1 and A0; B1) with one question: what did this cell build that the framework should have provided? They returned `path:line` tables. I opened the load-bearing ones.
3. I ran six probes. Each tests one claim this document relies on:

| Probe | Claim tested | Result |
| --- | --- | --- |
| `scripts/01-framework-import-census.mjs` | Which framework modules do domains import by name? | `ir/rewrites.ts`, `ir/transactions.ts`, `ir/traversal.ts`, `ir/diff.ts`, `ir/store.ts`, `core/runtime.ts`, `core/query.ts`, `core/records.ts`: 0 names imported by Typed, Tix or the workbench. Tix imports nothing from `dataflow/` or `strategy/`. |
| `scripts/02-tix-against-the-edit-layer.mjs` | Can Tix use the generic edit and pattern machinery? | `beginEdit()` throws (not Rewritable); `op(...)` patterns throw (no Operations capability); the projection has 5 entities for a 3-statement function, none an expression node; `applyNativePassSync` refuses a pass with `needs`; `inline`'s correspondence is `{retained: 4, removed: 1}`. |
| `scripts/03-binding-times-on-the-dataflow-layer.mjs` | Can the dataflow layer solve a problem that is not over a control-flow graph? | Yes. A binding-time analysis of a Tix function over its read graph, 20 lines, registered and cached by the analysis manager. One workaround: a virtual entry node. |
| `scripts/04-one-runner-two-drivers.mjs` | Must there be two pass runners? | No. One generator-based runner, a 9-line synchronous driver and a 4-line asynchronous one produce the same revision; a Tix pass with `needs` runs synchronously. |
| `scripts/05-fusion-legality-as-dependence-distance.mjs` | Is `planFusion`'s join test an instance of a domain-independent dependence test? | Yes. A 20-line distance-vector test over affine accesses reproduces `planFusion`'s groups and depths on 10 of 10 functions (the corpus and four written to make it refuse). |
| `scripts/06-what-edit-records-carry.mjs` | What do edit records and correspondences carry? | Over the corpus under O2: 1,774 edit records, 0 naming a rule; 190,716 correspondence entries, 98.5 % `retained` with no reason; 481 `retarget` edits that the correspondence shows as unchanged. |

The A0 cells count 2,021 edit records under O2 on `t6-base`; probe 06 counts 1,774 on `main`, which has D1's loop fix merged and checks with fewer cases. I did not reconcile the two numbers; neither conclusion depends on the difference.

## 3. Inventory of domain-built machinery

Each row names the machinery, where it is, and the concept that would absorb it. **C1–C8** are the framework concepts of §5; **L-…** are the standard-library primitives of §6.

### 3.1 Merged code, Typed

| Machinery | Where | Why it is there | Absorbed by |
| --- | --- | --- | --- |
| A transaction with origins, `because`, edit records and write-kind enforcement | `src/typed/tx.ts:47-54` (the record), `:187-198` (origins), `:431-481` (`rewrite`) | "its edits do not allocate through `Tx` (no Typed origins, ids outside the counters), it publishes one artifact per application, and its repeat semantics differ" (IRWB-006 diary, `ttmp/2026/11/25/IRWB-006--…/log/01-implementation-diary.md:483`) | C1 |
| A second answer to "why is this here": origin chains beside correspondence chains | `src/typed/program.ts:463-488` (`why`), `:490-496` (`whyChain`, the framework's) | the framework's answer skips in-place edits (`src/framework/ir/correspondence.ts:321-324`) | C1 |
| Correspondence rebuilt from origins and removal edits | `src/typed/passes.ts:119-162` | the pass edits natively, so the framework sees only two projections | C1 |
| Rules as data, a matcher with structural repeat, a compiler into a `Tx.rewrite` visitor | `src/typed/rules/form.ts`, `src/typed/rules/compile.ts:93-136` | the framework's `sameAs` is identity, not structural equality, so the converted pattern "matches a superset" (`src/typed/rules/form.ts:266-288`) | C7, L-term |
| A rule verifier with eight methods (structural, by construction, symbolic-linear, bitwise, exhaustive at 8 and 32 bits, random, f32 specials) | `src/typed/rules/verify.ts:1-20`, `:179` | the framework's `preserves` on a rewrite "does not verify itself" (`src/framework/ir/PATTERNS-AND-REWRITES.md`, Rewrite API) | C4, L-check |
| Sparse conditional constant propagation with its own lattice and two worklists | `src/typed/sccp.ts:47`, `:88`, `:126` | the dataflow layer solves per block over a fixed graph; SCCP is per SSA name and per edge | C6, L-ssa |
| CFG, dominators, natural loops, SSA construction and its checker | `src/typed/analyses.ts:75`, `:140`, `:215`; `src/typed/ssa.ts:60`, `:325` | no library; each is tied to `WorkFn` and `Store` | L-graph, L-ssa |
| Liveness, twice: on blocks through `dataflow()`, on machine code by hand | `src/typed/analyses.ts:296`; `src/typed/backend/regalloc.ts:85-100` | the machine code is not an artifact, so `dataflow()` (which needs an adapter) does not apply | C6, L-flow |
| Static block frequencies and a cost estimate | `src/typed/backend/frequency.ts:105`, `:174` | nothing in the framework predicts cost from an IR | L-measure |
| Exact f32 on bit patterns | `src/typed/f32.ts:1-20` | domain semantics, but Tix needs the same rounding (`src/tensor/evaluate.ts:26`) | L-num |
| Case generation: the default, boundary pools and coverage-guided selection | `src/typed/evaluate.ts:232`; `src/typed/cases-strong.ts:329` | the differential contract takes cases as a callback | L-check |
| Mutation operators, a mutant pass, finite domains for exhaustive comparison | `src/typed/mutate.ts:401`, `:535`, `:586` | gate strength is measured per domain | C4, L-check |
| Testing a dataflow fact against executions, and perturbing it | `src/typed/facts-check.ts:39`, `:125` | analyses are trusted code | L-check |
| Instruction attribution | `src/typed/attribute.ts:81-211` | joins counts, `covers`, origins and edit records by hand; uses no correspondence | C8, L-measure |
| Two pipeline runners in one domain: a loop and a strategy plan | `src/typed/program.ts:344-362`; `src/typed/strategy.ts` | the loop came first and stayed | C5 |
| `sameTree` defined twice | `src/typed/tx.ts:95`; `src/typed/mutate.ts:145` | no shared term utilities | L-term |

### 3.2 Merged code, Tix

| Machinery | Where | Why it is there | Absorbed by |
| --- | --- | --- | --- |
| Whole-module passes: `inline` and `split-sum` as functions `Fn → Fn`, with one coarse `writes` | `src/tensor/passes.ts:21-52`, `:53-81`, `:82-92` | expressions are attributes of statement entities, not entities (`src/tensor/ir.ts:102-108`), and the adapter has no `rebuild` or `operation` (`:140-152`) | C1, C7 |
| A fusion planner: join legality, storage classes, term staging, in-place rows, a launch gate, reasons as strings | `src/tensor/fusion.ts:83-105`, `:142-279`, `:113-119`, `:135-140`, `:244-262` | "decided from the Tix IR alone, before code generation" (`:1-2`): a plain function, not an analysis, not a pass | C2, L-affine |
| Refusals as records with a reason | `src/tensor/fusion.ts:48-52`, `:159` | the only decision log Tix has | C1, C2 |
| An emitter that also decides: thread caps, block sizes | `src/tensor/cuda-source.ts:358`, `:404`, `:565-566` | measured constants live where they are printed | C2 |
| Affine forms: add, substitute, evaluate, `plain` | `src/tensor/model.ts:2-30` | none in the framework | L-affine |
| A bounds check of affine indices in the parser | `src/tensor/parser.ts:54`, `:238` | the same range reasoning as Typed's `typed.ranges`, written apart | L-affine, L-lattice |
| A sample generator: distinct shape sizes, empty extents, four value streams | `src/tensor/contract.ts:24-85` | F21 came from this function being wrong | L-check |
| The relation chosen by pass name; the baseline chosen by relation | `src/tensor/index.ts:42`; `src/tensor/contract.ts:125` | the relation is not part of the pass | C4 |
| A fixed tolerance | `src/tensor/contract.ts:107` | F15, F22 | C4, L-num |
| A lowering that is a transformation, not a pass | `src/tensor/cuda-contract.ts:203-247` | `PassSpec` has one `ir` and one `adapter` (`src/framework/passes/define-pass.ts:83-84`) | C3 |
| A hand-sequenced pass loop | `src/tensor/index.ts:32-59` | `passAlgorithm` needs the asynchronous runner (`src/framework/passes/bridge.ts:29-39`) | C5 |

### 3.3 T6: ten schedule IRs

Every cell represents the schedule as a plain object with a hand-written adapter and validator, defines passes with `definePass`, and runs them with `applyNativePassSync`. None uses the IR store, transactions, patterns, rewrites or dataflow.

| Machinery | Cells that built it (lines) | Absorbed by |
| --- | --- | --- |
| Adapter and validator for the schedule | all ten; validators from 10 to 89 lines (`t6-ds-h:src/tensor/schedule.ts:109-197`, `t6-fa-e:…:181-267`) | C3 (an IR declared once, with its entities) |
| Copying `planFusion`'s group into the schedule | all ten (`t6-am-b:…/schedule.ts:63-99`, `t6-ds-x:…:254-299`, `t6-fa-e:…/schedule-passes.ts:48-153`, `t6-g-max:…/schedule.ts:585-637`) | C2 |
| Re-deriving the emitter's thread cap | seven (`t6-sm-a:…:96`, `t6-am-b:…:88-94`, `t6-ds-x:…:255-266`) | C2 |
| Copying the gate's constants | three (`t6-ds-x:…:284`, `t6-fa-e:…/schedule.ts:108`, `t6-g-max:…:609`) | C2 |
| A recognizer of contractions and affine accesses | nine, 18 to 74 lines | L-affine |
| A tile, loop-nest or iteration-domain type | nine; one real loop nest (`t6-op-d:src/tensor/schedule.ts:46-66`) | L-affine |
| An accumulation-order analysis, the core of legality | seven, 20 to 195 lines (`t6-ds-h:…:398-447` ✓ symbolic normal form; `t6-op-d:…:271-366` ✓ simulation on sampled extents; `t6-g-max:…:299-495`) | C2, C4, L-affine |
| A schedule interpreter or simulator | three (`t6-fa-e:src/tensor/schedule-eval.ts:57-379` ✓, 323 lines) | C3 (an IR's meaning is declared with it) |
| A hand-rolled synchronous pass sequencer | eight | C5 |
| A synchronous strategy executor in the framework | two, independently (`t6-ds-x:src/framework/strategy/sync.ts`, 153; `t6-fa-e:src/framework/strategy/sync.ts:37` ✓, 122) | C5 |
| A launch-time shape rule or cost model | eight | C2 (a plan may defer a choice), L-measure |
| A tiled CUDA printer | nine, 98 to 423 lines | stays in the domain |

Framework changes made by T6 cells, with their stated reasons:

| Change | Cell | Reason given |
| --- | --- | --- |
| `PassSpec.legal`, `PassError('illegal')` | `t6-op-d:src/framework/passes/define-pass.ts:96-101` ✓ | "a pass could only throw from `run`, which the caller cannot tell apart from a bug or a rejected contract" |
| `PassSpec.postcondition` | `t6-am-b:…/define-pass.ts:89-90` ✓ | "running an individual schedule pass elsewhere could omit the intended check" |
| `PassSpec.source` for cross-kind passes | `t6-ds-h:…/define-pass.ts:85-90` ✓ | "a pass whose input was of another kind could not be written at all" |
| `executeSync`, `syncPassAlgorithm` | `t6-fa-e`, `t6-ds-x` | "Without this the pass order would be hard-coded and the strategy package unused" (`t6-fa-e:…/02-report-schedule-ir-and-exact-tiled-contractions.md:228` ✓) |
| Synchronous `preserves` / `claims` | `t6-g-h`, `t6-ds-x` | `applyNativePassSync` refuses a pass that declares `preserves` |
| A gate mode for `passAlgorithm` | `t6-g-max` | the bridge needs an asynchronous context |
| The synchronous gate receives the correspondence | `t6-sm-a` | "so the same check can inspect the exact v6 entity correspondence" |

Three measured costs from the reports:

- **About 30 ms per `applyNativePassSync`** for artifact, projection, diff, correspondence and hashing (`t6-fa-e:…/02-report…md:236` ✓); 53 applications and 0.5 to 2.9 s to schedule one function (`t6-op-d:…/02-report…md:173` ✓).
- **A strategy plan cannot defer a choice to launch time:** "Strategy IR's `conditional` and `chooseBest` run at compile time and cannot express 'decide when the shapes are known'" (`t6-fa-e:…:234` ✓).
- **Weak self-checks:** two cells check a pass by running the same derivation again (`t6-sm-a:…/schedule.ts:324-382`; `t6-tl-c:…:59-63`, "a consistency check, not independent proof").

### 3.4 D1: seven attribution tools

All seven implement the same seven steps: lower a revision; run with per-instruction counts; map an instruction to IR entities through `covers`; map an entity to a decision; aggregate; check that the parts sum to the whole; subtract two revisions. They differ only in the fourth step.

| Machinery | Cells | Absorbed by |
| --- | --- | --- |
| A backward walk over correspondences, written by hand | five (`d1-ds-x:src/typed/attribution.ts:88-156` ✓, `d1-op-f:…:177-203`, `d1-sm-a:src/typed/backend/attribution.ts:113-125`) | C1, C8 |
| A join of the edit log onto that walk, because in-place edits look `retained` | five; one by regular expression over field values (`d1-g-h:src/typed/attribute.ts:113-120`) | C1 |
| A conservation check | five | C8 |
| A record of which rule fired | one cell added it at the source (`d1-sm-a:src/typed/tx.ts:47-60` ✓: `AppliedRule`, `Edit.rules`) | C1 |
| A record of a refused decision | one (`d1-ds-x:src/typed/passes.ts:513` ✓: `tx.record('skip', …)`) | C2 |

One cell used the framework's `whyEntity` and needed 43 lines (`d1-am-b:src/typed/attribution.ts:40` ✓). It is the shortest tool and the only one that cannot name an in-place edit.

The regression itself was a library defect. `loopsOf` returned one loop per back edge; the VM's dispatch loop has nine back edges to one header, so `licm` made nine preheaders on the dispatch cycle. Two cells fixed the analysis, five fixed the pass that consumed it, and one report notes that `rotate` "already did" its own deduplication. A primitive with one tested definition of "natural loop" would have had one fix.

### 3.5 A0: seven edit classifiers

All seven implement the same nine steps; the survey's table has `path:line` for each. The step that costs the most is replaying the rule tables against published trees to learn which rule fired.

| Machinery | Cells | Absorbed by |
| --- | --- | --- |
| A value handle over a plain tree, so the domain matcher can run after the fact | three (`a0-ds-x:src/typed/edit-classes.ts:101-157`, `a0-fa-g:…:116-157`, `a0-op-f:…:104-157`) | C1 (cite at the source) |
| A second matcher, written from scratch | two (`a0-g-h:src/typed/edit-class.ts:107-176`, deliberately independent; `a0-tl-c:tools/edit-census.mjs:21-61`) | C1, L-term |
| A replay through a real `Tx` | two (`a0-am-b`, `a0-sm-a`) | C1 |
| "Structural" decided by a set of pass names, by edit kind, by created locals, or a mix | all seven, each differently (`a0-am-b:src/typed/edit-census.ts:78`; `a0-fa-g:src/typed/edit-classes.ts:259`, "never from the pass's name") | C1 (a step has a class) |
| Instruction weight through `covers` | all seven | C8 |

The shares differ between cells (10.0 % to 19.5 % local under O2) because the definitions differ, not the data. Every cell that re-derives finds the same 183 edits under O2 and 362 under `speed`; explicit citations are 0 everywhere.

One result matters for the design. In `a0-fa-g`'s report (✓ `…/02-report-the-share-of-local-value-rewrites….md:30-34`), verified rules re-derive 46.3 % of local rewrites, and "the rest is conditional on a dataflow fact": one rule family, "a `get` becomes what its reaching definitions assign", would raise coverage to 94.9 %. A local rewrite is a rule plus a fact. That is the shape of C2.

### 3.6 B1: six partial evaluators

| Machinery | Cells (lines) | Absorbed by |
| --- | --- | --- |
| A binding-time analysis or a static-state domain | six: three online and fused with the specializer (`b1-sm-a`, `b1-am-b`, `b1-g-h`), two offline flow-insensitive fixpoints (`b1-fa-g:src/typed/bta.ts:65-115` ✓, `b1-op-f:src/typed/pe.ts:76-110` ✓), one abstract interpretation over trees (`b1-ds-x`); 100 to 500 lines each | C6, L-pe |
| A polyvariant memo, a worklist and a block cloner | six, 100 to 500 lines (`b1-g-h:src/typed/peval.ts:209-714` ✓, the `Tracer`) | C6, L-pe |
| A termination budget | six, each with a different policy (refuse, fall back, bound by statements, by cells, by clones) | L-pe |
| A promise check: stores stay in the frame, no calls | six, 35 to 55 lines | C2 (a plan's legality), C4 (a relation under an assumption) |
| A recognizer for loads from a bound buffer | six | L-term |
| An i32 constant evaluator, or a private subset of the existing one | six; one duplicate (`b1-g-h:…/peval.ts:154-198` ✓) | L-num |
| Promotion of a frame array to locals | five, 25 to 130 lines | stays in Typed |
| Copy propagation or live-range splitting to unblock `subst` | three | stays in Typed |
| A reorder of `f.blocks` to install a new entry | four | C1 (F30) |
| A pass sequence driven outside strategies | four | C5 |
| A recomputed natural-loop body; a per-edge constant worklist | `b1-ds-x:src/typed/dispatch.ts:115-136`, `:76-112` | L-graph, C6 |

No cell registered its analysis. One gives a reason: "It is a plain function over the store, not a framework analysis: the only consumer is the specializer, in the same pass run, and no pass claims to preserve it" (`b1-fa-g:…/design-doc/01-specializing-the-bytecode-vm-on-a-constant-buffer.md:72` ✓). The online cells could not have used the solver as it is: the graph of (block, static state) pairs grows while it is explored, and `FlowGraph` is fixed before solving (`src/framework/dataflow/solver.ts:17-22`). That is the survey agent's inference and mine; no cell states it.

One cell asks for something a strategy cannot do: "the fixpoint needs a bindings artifact per program, which a strategy node cannot pass today" (`b1-ds-x`, design `:251`).

### 3.7 What recurs across tasks

| Pattern | Seen in |
| --- | --- |
| A decision made in plain code, then re-derived by whoever needs to inspect it | `planFusion` and ten T6 cells; `licm` and seven D1 cells; rule firings and seven A0 cells; the binding-time division and six B1 cells |
| A justification kept as a string or not kept | `FusionGroup.reasons` (`src/tensor/fusion.ts:45-46`); `Edit.note` (65 of 1,774 records, probe 06); `ScheduleRefusal`; `skip` edits |
| A fixpoint or worklist written by hand | SCCP; machine liveness; block frequencies; six B1 analyses; `b1-ds-x`'s edge constants |
| A sequencer written by hand | `optimizeTix`; `Program.pipeline`; eight T6 cells; four B1 cells |
| A check that is "run it and compare", built per IR | `meaningGate`; `meaningKept`; `scheduleGate`; `simulate` |
| An order or legality argument made from the IR and then thrown away as evidence | seven T6 order analyses; `planFusion`'s comment "its evaluation order is unchanged" (`src/tensor/fusion.ts:11`) |

## 4. Assessment of each layer

### 4.1 `core`

- **Held:** `data.ts` (canonical encoding, fingerprints, immutability) and `types.ts` (`Artifact`). Every artifact in both domains is made through them.
- **Bypassed:** `runtime.ts` (914 lines), `query.ts` (220) and `records.ts` (103), the v6 task compiler with cached, dependency-tracked passes. Only `src/labs` and `src/conformance` reach them (probe 01). The first design planned otherwise: "The reused front end and the backend stages are ordinary v6 passes" registered with `compiler.register` (`ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/02-typed-to-rv32-compiler-on-the-v6-framework-worked-examples.md:143-145`). Typed built `Program` with a revision list instead (`src/typed/program.ts:254-300`), and the analysis manager took over caching by revision.
- **Leaked:** canonical key order. Artifacts store records with sorted keys, so a `JSON.stringify` comparison of a stored and a fresh record fails; two T6 cells lost time to it (`t6-tl-c` diary `:46`; `t6-fa-e:…/02-report…md:235` ✓). `sameCanonical` exists (`src/framework/core/data.ts:262`) and neither found it.
- **Keep:** `data.ts`, `sha256.ts`, `types.ts`. Decide `runtime.ts` by measurement (§8, step 10).

### 4.2 `ir`

- **Held:** adapters and the logical projection as a way to inspect, diff and enforce `writes`; `diff`; `makeCorrespondence` with checked entity lists (after F23); `composeCorrespondence` and `whyEntity` where a cell found them.
- **Bypassed:** `transactions.ts`, `rewrites.ts`, most of `patterns.ts`, `traversal.ts`, `store.ts`. No domain imports a name from four of them (probe 01). Typed uses four names of `patterns.ts`, only to list rules (`src/typed/rules/form.ts:22-23`). The reasons are on record and are structural:
  - the edit layer mutates the projection and rebuilds the native value, so native invariants (id counters, origins) are lost (IRWB-006 diary `:483`);
  - each rewrite is its own transaction, artifact and diff (`src/framework/ir/rewrites.ts:512-524`), which costs a full reprojection per application;
  - pattern identity is entity identity, and a tree IR has no shared entities, so `x - x` cannot be matched (`src/typed/rules/form.ts:269-272`);
  - an IR whose expressions are attributes has nothing to match (probe 02).
- **Leaked:** correspondence granularity. For a native pass the framework derives correspondence by completing the pass's entries with `retained` (`src/framework/passes/define-pass.ts:204-211`), so the record is as fine as the pass chooses and no finer. Typed chooses origins; Tix chooses nothing.
- **Keep:** adapters, views, `diff`, correspondence. The projection is the right tool for inspection and for the write check. It is the wrong place to mutate.

### 4.3 `contracts`

- **Held, and the strongest layer.** `defineIR` with entities, `defineAnalysis`, `defineTransformation` between different IR kinds, the analysis manager's caching by exact revision, `differential()` with batched `decide` (which carried the remote GPU check without a framework change, BACKLOG T2), verdict reuse with a checked key (F26).
- **Bypassed:** `preserve` with transfer rules by Tix (the synchronous runner refuses `preserves`); `recordProof` and the `proof` assurance by everyone (`src/framework/contracts/types.ts:164`); `defineObjective`; `effects`.
- **Leaked:** the meaning of "checked". `Assurance` has four values, and `assuranceOf` splits `checked` in two (`src/framework/contracts/differential.ts:377-379`), but nothing orders them, composes them along a pipeline, or lets a legality argument count. The strength of a sampled check lives in a case generator the framework never sees, and that generator was wrong twice (F21, F22).
- **Leaked:** asynchrony. `analyse` is `async` (`src/framework/contracts/analysis-manager.ts:518`), so everything above it is. `runDifferential` already returns a value or a promise depending on the spec (`src/framework/contracts/differential.ts:125`): the layer is dual-mode in one place and asynchronous everywhere else.
- **Keep:** all definitions, the manager's identity and invalidation rules, `differential`.

### 4.4 `passes`

- **Held:** `definePass` with `writes`; the derived change set; `needs` and `preserves` for Typed.
- **Bypassed:** the edit-returning form of `run` (no domain pass reads `ctx.edit`).
- **Leaked, three ways:**
  - **Two runners with different powers.** `applyPass` and `applyNativePassSync` (`src/framework/passes/define-pass.ts:225`, `:267`). Fourteen T1 cells added a synchronous path (BACKLOG, T1); eight T6 cells then changed the runner or its bridge in seven different ways (§3.3).
  - **Endomorphisms only.** `PassSpec` has one `ir` and one `adapter` (`:83-84`). Tix → schedule, schedule → CUDA, blocks → image and tape → blocks are not passes.
  - **A pass is a black box.** It can declare what kinds it writes and what it preserves. It cannot declare what it decided, whether a refusal is a legality refusal, or which evidence its own construction supplies. Two cells added a pass-owned check under two names (`legal`, `postcondition`).
- **Keep:** `writes` enforcement, `needs`, `preserves` with recompute as the fallback.

### 4.5 `dataflow`

- **Held:** the solver and the lattices for liveness, reaching definitions and ranges in Typed; the checked transfer by read set (`src/framework/dataflow/analysis.ts:160-182`).
- **Bypassed:** by Tix entirely; by SCCP (`src/typed/sccp.ts`); by the backend's liveness (`src/typed/backend/regalloc.ts:85`); by all six B1 analyses.
- **Why, in three parts:**
  - the vocabulary is blocks and regions, though the solver itself only needs a graph (probe 03 runs it over a read graph);
  - the graph is fixed before solving, so problems that discover their nodes cannot be stated (polyvariant specialization, SCCP's executable edges);
  - `dataflow()` requires an artifact and an adapter (`src/framework/dataflow/analysis.ts:39-40`), so a fixpoint inside a pass, on a working copy or on machine code, has to be written by hand.
- **Keep:** `Lattice`, `solve`, widening at loop heads, the read-set transfer.

### 4.6 `strategy`

- **Held:** plans as data, `fork`/`chooseBest`/`attempt` for Typed pipelines, the trace.
- **Bypassed:** by Tix; by four B1 cells' drivers; by eight T6 sequencers.
- **Why:** the interpreter is asynchronous (27 `await`s in `src/framework/strategy/interpreter.ts`); values must be JSON, so a plan cannot pass an artifact of bindings to an algorithm; a choice is made at compile time, so a launch-time gate is outside the plan.
- **Keep:** the thirteen operators and their validation. The plan language is sound; its interpreter's effect discipline and its notion of when a choice is made are not general enough.

### 4.7 The layering as a whole

The six layers are ordered by dependency, and that order is fine. The trouble is a missing layer and a misplaced one.

- **Missing: a layer of reusable algorithms over declared shapes** (graphs, terms, affine spaces, f32). Without it, everything that is not generic infrastructure falls into a domain. §6 proposes it.
- **Misplaced: mutation.** The framework put editing in the projection (`ir`), where no native invariant lives. Both domains moved it back into native code and lost the framework's view of it. §5.1 gives it back as a record, not as an API.

## 5. Proposed framework concepts

Each concept has its theory, a domain-independent interface sketch, at least two uses in the material, and what it deletes. The sketches are TypeScript-shaped and are not designs of record.

### 5.1 C1. Derivation: the typed record of what a pass did

**Evidence:** strong (probes 02 and 06; the D1 and A0 surveys; F23, F30, F31).

**The idea.** A pass returns the new value and a *derivation*: an ordered list of steps. A step states which entities it consumed, which it produced, its class, the rule or decision it instantiates, and the facts it relied on. The domain's own transaction writes the steps while it mutates native data. The framework owns the step format and everything computed from it.

**Theory.**
- In rewriting logic a computation is a proof term: a rewrite sequence is the evidence that its result follows from its start. A derivation is that term, kept.
- Translation validation and its descendants check a compiler run from a witness the compiler emits, without trusting the compiler [TV98, Necula00, Witness13, Credible99].
- Data provenance distinguishes *where* a value came from and *why* it is there. Typed's `from` and `because` are exactly these two (`src/typed/tx.ts:57-59`).

**Interface sketch.**

```ts
interface Step {
  readonly id: string;
  readonly consumes: readonly EntityId[];      // in the input revision
  readonly produces: readonly EntityId[];      // in the output revision
  readonly class: 'rewrite' | 'structural' | 'bookkeeping';
  readonly by: RuleRef | DecisionRef | null;   // a versioned rule (C7) or a plan element (C2)
  readonly because: readonly FactRef[];        // analysis records or entities the step relied on
  readonly inPlace?: true;                     // the entity kept its id and changed
}
interface Derivation { readonly from: RevisionRef; readonly to: RevisionRef; readonly steps: readonly Step[] }

// computed by the framework, never written by a domain:
correspondenceOf(d: Derivation, before: IRView, after: IRView): EntityCorrespondence;
why(entity: IRRef, chain: readonly Derivation[]): WhyNode[];
classify(d: Derivation): Record<Step['class'], number>;
citations(d: Derivation, rules: RuleRegistry): { cited: number; verified: number };
```

A domain implements one small sink, `record(step)`, inside its transaction. Typed's `Tx.record` (`src/typed/tx.ts:202-213`) nearly is one.

**Uses in the material.**
- **A0:** the classifier becomes `classify(d)`. The seven rebuilt matchers (§3.5) go, because a step made by a rule says so. `d1-sm-a` already made this change at the source (`AppliedRule`).
- **D1:** the fourth step of every attribution tool is `why` over derivations. In-place edits are steps with `inPlace`, so the 481 `retarget` edits of probe 06 stop looking unchanged.
- **Tix:** `inline` records `consumes: [centered, y], produces: [y], class: 'rewrite'`. Fusion records which statements a kernel was made from and by which plan element. Probe 02's `removed` becomes a merge.
- **F30, F31:** an entry-block edit and a rule citation are steps, not new transaction methods.
- **Programme A:** a checker accepts a step that cites a verified rule without sampling (C4).

**Deletes.** `revisionCorrespondence` (`src/typed/passes.ts:119-162`); `Program.why`'s separate origin walk (`src/typed/program.ts:463-488`); the opaque `report` and `edits` fields (`src/framework/passes/define-pass.ts:73-76`); most of each A0 classifier and step four of each D1 tool. Correspondence shrinks from 190,716 entries to roughly the 1,774 steps plus an implicit identity.

**What stays in the domain.** The transaction and its native invariants. The framework does not mutate.

### 5.2 C2. Decide, justify, apply

**Evidence:** strong for the split (T6, D1, B1, A0); the unified interface is conjecture until two instances share it.

**The idea.** A transformation has three parts:

1. **`decide`** reads the IR and facts and returns a *plan*: plain data naming what to do. It may search, measure or guess. It is not trusted.
2. **`legal`** takes the IR, the facts and a plan, and says whether applying that plan preserves the pass's relation, with a reason. It is small, and it is the only part whose correctness matters for meaning.
3. **`apply`** carries out a legal plan mechanically and writes the derivation.

**Theory.**
- **Algorithm and schedule** in Halide and TVM: the schedule is data about how to run an algorithm whose meaning it cannot change [Halide13, TVM18].
- **Legality as dependence preservation** in loop transformation theory: a reordering is legal iff every dependence keeps its direction [AK01, Feautrier92]. Probe 05 shows `planFusion`'s join test is this statement for parallel loops.
- **Division and congruence** in partial evaluation: a binding-time division is a plan; it is usable iff it is congruent, meaning nothing static depends on anything dynamic; the specializer then runs mechanically [JGS93].
- **Certifying algorithms:** an untrusted search returns a result with a certificate that a simple checker validates [Cert11].
- **Analysis and transformation composed:** a transformation is a graph replacement licensed by a dataflow fact [LGC02]. A0's "rule plus fact" is this.

**Interface sketch.**

```ts
interface Transformation<S, T, Plan, N extends Needs> {
  readonly id: string; readonly version: string;
  readonly from: IRType<S>; readonly to: IRType<T>;
  readonly needs: N;
  readonly plan: Type<Plan>;                                  // serializable: it can be an artifact, an argument, a search point
  readonly relation: RelationRef;                             // what a legal application guarantees (C4)
  decide(ctx: { view: IRView<S>; facts: FactValues<N> }): Plan;
  legal(ctx: { view: IRView<S>; facts: FactValues<N> }, plan: Plan): Verdict;   // { ok, reason, refused?: PlanElement[] }
  apply(ctx: { value: S; facts: FactValues<N>; sink: StepSink }, plan: Plan): T;
}
```

The runner calls `decide` unless the caller supplies a plan, then `legal`, then `apply`. A refused plan is an ordinary outcome with a reason, distinct from a failed contract and from a bug.

**Uses in the material.**

| Instance | The plan today | The legality today |
| --- | --- | --- |
| Fusion | `FusionPlan` (`src/tensor/fusion.ts:53-59`), already data | `joinDepth` and the storage rules, inside the planner (`:83-105`, `:167-242`) |
| Scheduling (T6) | each cell's schedule object | seven private order analyses (§3.3) |
| Launch gate | `gateRule`, a C++ condition (`src/tensor/fusion.ts:136-140`) | none: both sides are checked artifacts (F25) |
| `licm`, `inline` | implicit in the pass body; `d1-ds-x` records refusals as `skip` edits | loop facts, size thresholds (`src/typed/inline.ts:126-127`) |
| Specialization (B1) | the bindings artifact (`src/typed/specialize.ts`) and each cell's division | six private promise checks (§3.6) |
| A guarded rewrite (A0) | the match | the rule's guard plus a dataflow fact |

- **T6's `legal` and `postcondition`** are this concept's `legal`, added twice under two names.
- **Strategy search becomes search over plans.** `fork` and `chooseBest` range over plan values, not over pass names, which is what T7's autotuning needs. A plan that defers a choice to launch time is a plan with a guarded alternative, which answers `t6-fa-e`'s objection.
- **D1's question becomes a query:** which plan element is this instruction charged to (C8).
- **B1's request** ("a bindings artifact per program, which a strategy node cannot pass") is a plan passed as an artifact.

**Deletes.** The planner-to-schedule copies in ten T6 cells; the re-derived thread caps and gate constants; `PassSpec.legal` and `postcondition` as separate additions; the fused analysis-and-specializer shape of three B1 cells.

**Conjecture to test.** That one `legal` signature fits fusion, scheduling and binding-time congruence. Step 6 of §8 tests it on two.

### 5.3 C3. Passes between IRs

**Evidence:** strong.

**The idea.** A pass has a source IR type and a target IR type. A pass from an IR to itself is the special case. Its derivation relates entities of two kinds. A compiler is a path in the graph of IR types.

**Theory.** Compositional compiler correctness: each pass relates source and target behaviours by a relation, and the relations compose along the chain [CompCert09]. Progressive lowering through several levels of IR is MLIR's organizing idea [MLIR21].

**Interface.** `Transformation<S, T, …>` in C2 already has `from` and `to`. `Pass<S, S>` is today's pass.

**Uses.** Tix → CUDA (`src/tensor/cuda-contract.ts:203-247`); Tix → schedule → CUDA in three T6 cells (`t6-sm-a`, `t6-gf-h`, `t6-g-max`); blocks → image (`src/typed/backend/compile.ts:442-452`); tape → blocks (`src/typed/lift.ts`); `t6-ds-h`'s `PassSpec.source` ✓.

**Deletes.** The parallel vocabulary of "transformation with a hand-built correspondence" for lowerings, and the need for a fixed API such as `cudaSource` to sequence steps itself.

### 5.4 C4. Evidence with a relation and a strength

**Evidence:** the gap is evidenced (the report's "Checks are sampled, not proven"; F15, F17, F21, F22; seven T6 order analyses with nowhere to go). The algebra is a proposal.

**The idea.** A check produces evidence that states two things.

- **The relation** it establishes between input and output behaviour: `exact`, `exact-up-to(class)` (NaN as a class), `within(bound)`, each optionally `under(assumption)`.
- **How strongly:** an ordered scale.

| Strength | Meaning | Today |
| --- | --- | --- |
| `declared` | asserted | `declare` |
| `sampled(n, generator, kill-rate?)` | agreed on n generated cases; optionally with a measured mutant kill rate | `differential` |
| `exhaustive(domain)` | agreed on every input of a stated finite domain | `mutate.ts:535`, rule verifier at 8 bits |
| `by-construction(derivation)` | every step cites a verified rule or a legal plan element | none |
| `certified(verifier)` | an external certificate was accepted | `recordProof`, unused |

**Composition rules.**
- Strength along a pipeline is the minimum of its steps.
- `exact ∘ exact = exact`, so an exact pass needs checking only against its predecessor.
- `within(a) ∘ within(b)` is not `within(a + b)` in floating point without an error analysis, so a tolerance pass is checked against the origin. Tix hand-codes exactly this rule (`src/tensor/contract.ts:125`).
- `R under A` composes with `R' under A'` to `R ∘ R' under A ∧ A'`. Typed's `assume` is this (`src/typed/program.ts:172`), and so is B1's "host promise that a buffer is constant".

**Theory.** Relational program logics for transformations [Benton04]; refinement and simulation composition [CompCert09]; translation validation [TV98, Alive15, Alive2-21]; mutation analysis as a measure of test adequacy [DLS78].

**Interface sketch.**

```ts
type Relation = { kind: 'exact' } | { kind: 'exact-up-to'; class: string } | { kind: 'within'; bound: BoundRef }
              | { kind: 'under'; assumption: AssumptionRef; of: Relation };
interface Evidence { readonly relation: Relation; readonly strength: Strength; readonly detail: unknown }
compose(a: Evidence, b: Evidence): Evidence | 'recheck-against-origin';
```

**Uses.** `optimizeTix` stops choosing the relation by pass name (`src/tensor/index.ts:42`): the pass declares it. A T6 order analysis becomes `by-construction` evidence for `exact`, with the GPU run as a second, sampled witness. A rule application that cites a rule verified `exhaustive-32` needs no sampling. T4 and C1 (the calibrated gate) record a kill rate in the evidence.

**Deletes.** The relation switch in `optimizeTix`; the per-domain convention for when to compare against the origin; `assuranceOf`'s two-way split.

**What "checked" should mean.** A statement of the form "*relation R holds between these two revisions, with strength s*". Today it means "a check ran".

### 5.5 C5. One runner, two drivers

**Evidence:** strong (probe 04; the T6 framework changes of §3.3; fourteen T1 cells).

**The idea.** The pass runner and the strategy interpreter are written once, as code that *requests* its effects: an analysis result, a gate verdict, an algorithm call. A driver answers the requests. The synchronous driver fails only when an answer is actually a promise. The asynchronous driver awaits.

**Theory.** Algebraic effects and handlers: the computation is separate from the interpretation of its operations [Handlers09].

**Interface.** As in `scripts/04-one-runner-two-drivers.mjs`: `function* runPass(...)`, `driveSync(gen, handlers)`, `driveAsync(gen, handlers)`. The public `applyPass` and `applySync` are two one-line wrappers.

**Measured.** With the real Tix `inline` pass and a real analysis as a `need`: the synchronous driver returns revision `04a690a29419`; the asynchronous driver, with the manager and a delayed gate, returns the same revision; the synchronous driver with an asynchronous handler reports `effect 'analysis' answered asynchronously; use the asynchronous driver`.

**Uses.** Tix's synchronous `cudaSource` with `needs` and `preserves`; Typed's asynchronous pipelines with a worker pool; strategy plans over Tix passes (F27); the GPU gate as an asynchronous handler.

**Deletes.** `applyNativePassSync` (`src/framework/passes/define-pass.ts:225-265`); the proposed `executeSync` and `syncPassAlgorithm` (F32); the hand sequencers of §3.3 and `src/tensor/index.ts:32-59`.

### 5.6 C6. A solver for equation systems

**Evidence:** the bypasses are evidenced (§4.5); probe 03 shows the present solver already runs over a non-CFG graph. On-demand node discovery is a proposal.

**The idea.** The solver's subject is a set of unknowns with monotone equations over a lattice, not blocks of a region. A control-flow problem is one instance. The unknowns may be discovered while solving.

**Theory.** Monotone frameworks [Kildall73, KU77]; abstract interpretation [CC77]; chaotic iteration and widening points [Bourdoncle93]; local solvers that explore only the unknowns a query needs [FS99].

**Interface sketch.**

```ts
interface Equations<K, V> {
  readonly lattice: Lattice<V>;
  rhs(unknown: K, get: (other: K) => V): V;   // reading `get` registers a dependency and may create the unknown
  widenAt?(unknown: K): boolean;
}
solveFor<K, V>(eqs: Equations<K, V>, roots: readonly K[], budget: Budget): Solution<K, V>;
```

`dataflow()` stays as the wrapper that builds equations from a region's graph and registers the result as an analysis. `solve` is also usable directly, on any graph, inside a pass.

**Uses.**
- **B1:** the binding-time analysis (unknowns: locals and memory regions; lattice S < D) and the polyvariant unfolding (unknowns: `(block, static state)` pairs, created on demand).
- **SCCP:** unknowns are SSA names and edges (`src/typed/sccp.ts:47`).
- **Tix:** binding times, shapes or ranges over the read graph (probe 03).
- **The backend:** liveness over machine blocks (`src/typed/backend/regalloc.ts:85`) and block frequencies (`src/typed/backend/frequency.ts:105`).
- **`b1-ds-x`'s per-edge constants** (`…/dispatch.ts:76-112`), which the survey notes is "a textbook `flatLattice` + `mapLattice` problem".

**Deletes.** The hand worklists listed in §3.7.

### 5.7 C7. A term signature and rules over it

**Evidence:** the bypass and its reasons are evidenced (§4.2). That one signature serves both domains is conjecture.

**The idea.** A domain that has terms declares a *signature view*: for a native node, its operator, its children and how to rebuild it with new children. Rules are data over that signature. Matching, rule tables, traversal strategies, structural equality, and rule citation into the derivation are the framework's.

**Theory.** Term rewriting with strategies as a separate, composable language (`all`, `one`, `try`, `repeat`, `topdown`, `innermost`) [Stratego98]. Equality saturation is another engine over the same signature and rule format [EqSat09, egg21].

**Interface sketch.**

```ts
interface Signature<Node> {
  op(n: Node): string; children(n: Node): readonly Node[]; attr(n: Node): Json;
  rebuild(n: Node, children: readonly Node[], sink: StepSink): Node;   // through the domain's transaction
  equal(a: Node, b: Node): boolean;                                    // structural: what `same` means
}
interface Rule { id: string; version: string; lhs: Pattern; where?: Guard[]; rhs: Template; needs?: FactGuard[] }
rewriteWith<Node>(sig: Signature<Node>, rules: readonly Rule[], strategy: Strategy, root: Node, sink: StepSink): Node;
```

`needs` on a rule is the dataflow premise A0 found missing (C2).

**Uses.** Typed's `simplify` and `fold` tables (`src/typed/rules/`); Tix's `inline` and `split-sum`, which are two rules applied by `mapExpr` (`src/tensor/passes.ts:44-47`, `:58-78`); T10's reassociation, T11's FMA contraction and T15's normal forms; A1's e-graph.

**Deletes.** `src/typed/rules/compile.ts` and the matcher half of `form.ts` (about 300 lines) as domain code; the graph-projection rewrite engine `src/framework/ir/rewrites.ts` (855 lines) as the sanctioned path, kept only if the labs need it.

**Why not fix the existing engine.** Its unit of work is a transaction on the projection. A rule engine needs to run inside the domain's transaction, many applications per pass, and report steps. That is a different interface, not a faster implementation.

### 5.8 C8. Pulling a measure back along correspondence

**Evidence:** seven D1 tools with one skeleton; all seven A0 cells weight by instructions the same way.

**The idea.** A measure is a number attached to entities of some revision: executed instructions per instruction, milliseconds per kernel, bytes per function. A chain of derivations relates those entities to earlier entities and to steps. Pulling the measure back along the chain charges each unit to a step or to an origin entity. The framework guarantees conservation: the charges sum to the total.

**Theory.** Provenance as annotation propagation: a query's output annotations are computed from its inputs' by a semiring [Prov07]. Here the "query" is the composed correspondence and the semiring is counting. Profile attribution through debug information is the everyday instance.

**Interface sketch.**

```ts
attribute(measure: ReadonlyMap<EntityId, number>, chain: readonly Derivation[], policy: 'earliest' | 'latest' | 'split')
  : { perStep: Map<StepId, number>; perOrigin: Map<EntityId, number>; unattributed: number; total: number };
difference(a: Attribution, b: Attribution): Attribution;
```

**Uses.** D1 and D2 on Typed; A0's weighting; kernel time charged to fusion and scheduling decisions in Tix (the `gates` record of F25 says which side ran; this says what it cost); code size per inlining decision.

**Deletes.** Steps three to seven of each D1 tool; `src/typed/attribute.ts:103-211` reduces to the measurement and the formatting.

**Limit, evidenced.** Ownership is not marginal cost: "Provenance alone cannot establish the marginal cost of an individual edit" (`d1-am-b` analysis `:44`). The merged tool gets marginal cost by measuring each revision (`src/typed/attribute.ts:1-15`). Both modes belong in the primitive.

## 6. The proposed standard library: its layering criteria and its primitives

### 6.1 Three tiers and the criteria that sort them

| Tier | What it knows | Test for membership |
| --- | --- | --- |
| **Core** (`src/framework/`) | Nothing about the shape or meaning of a program. Identity, revisions, projections, derivations, evidence, effects, plans. | It can be specified without saying what a program is, and the framework cannot do its checking unless every domain uses it. |
| **Standard library** (`src/lib/`, proposed) | One *shape*, stated as a small structural interface: a directed graph, a term signature, an affine space, IEEE binary32, a case domain. | (1) It implements a named, published algorithm. (2) Its input is a shape interface, never a domain type. (3) It has two instantiations, existing or named: two domains, or two IR levels of one domain. (4) It ships with its own checker or a certificate for its result. (5) It imports core types only in an optional wrapper. |
| **Domain** (`src/typed/`, `src/tensor/`) | A language. | It states the language's meaning (an evaluator), its native data model, its syntax, its target's printer, or a constant measured on a target. |

Four working rules follow from the criteria.

- **A library primitive is pure and synchronous.** It takes values and returns values. A separate one-line wrapper (`asAnalysis`) registers it with the analysis manager when caching is wanted. This answers `b1-fa-g`'s reason for not registering its analysis: the primitive is usable without registration.
- **A domain adapts by supplying the shape, not by subclassing.** Typed supplies `Digraph` from a `WorkFn`; the backend supplies `Digraph` from machine blocks; Tix supplies one from its read relation.
- **Promotion needs a second use.** Code moves from a domain to the library when a second instantiation exists. Until then it stays where it is, marked as a candidate.
- **Each primitive has one fix site.** D1's `loopsOf` defect was fixed in the analysis by two cells and in its consumer by five (§3.4).

### 6.2 Layering inside the library

```
check   measure        (use everything below)
pe      affine   term  (use graph, lattice, solve)
ssa     flow           (use graph, lattice, solve)
graph   lattice  num   (use nothing)
```

`solve` is core (C6). `lattice` supplies its values. `flow`, `ssa` and `pe` are equation systems for it. `term` and `affine` supply the legality predicates of C2. `check` supplies strengths for C4. `measure` is C8's instances.

### 6.3 The primitives

Each row: the interface, the theory, the code it replaces, and what it composes with.

**L-graph: directed graphs**

| Primitive | Interface | Theory | Replaces | Composes with |
| --- | --- | --- | --- | --- |
| `Digraph`, orders | `{ nodes, succ, pred }`; `postorder`, `reversePostorder`, `retreatingEdges` | depth-first search | `depthFirst` (`src/framework/dataflow/solver.ts:64-88`); `cfgOf` (`src/typed/analyses.ts:75`); `machineBlocks` consumers | everything below |
| `dominators` | `(g, entry) → idom`; checker `isDominatorTree` | the iterative algorithm of Cooper, Harvey and Kennedy [CHK01], named in `src/typed/analyses.ts:6` | `dominatorsOf` (`src/typed/analyses.ts:140`) | `ssa`, `loops` |
| `naturalLoops` | `(g, idom) → { header, latches, body }[]`, one per header | natural loops of back edges | `loopsOf` (`src/typed/analyses.ts:215`); `b1-ds-x:src/typed/dispatch.ts:115-136`; the per-pass deduplication in five D1 cells | `licm`, `rotate`, `pe` (specialization points, as in `b1-op-f:src/typed/pe.ts:210`) |
| `sccs` | `(g) → component[]` | Tarjan's algorithm | cycles in `src/typed/backend/frequency.ts:12`; call-graph cycles in `src/typed/inline.ts:90` | `frequency`, `inline`, the solver's widening points |
| `callGraph` | `(functions, calleesOf) → Digraph` | — | `calleesOf` (`src/typed/parts.ts`); "no internal caller" checks in three B1 cells | `inline`, `pe`, incremental checking (E1) |

**L-lattice: lattices and their combinators**

| Primitive | Interface | Theory | Replaces | Composes with |
| --- | --- | --- | --- | --- |
| `set`, `flat`, `interval`, `map` | existing `Lattice<V>` (`src/framework/dataflow/lattices.ts:10-19`) | lattice theory | moves as is | `solve` |
| `twoPoint`, `product`, `lifted`, `constant` | constructors returning `Lattice` | products and lifts of lattices | `sccp.ts`'s private lattice (`src/typed/sccp.ts:31`); six B1 static-value domains; probe 03's 9 lines | `flow`, `ssa`, `pe` |

**L-flow: classic dataflow problems**

| Primitive | Interface | Theory | Replaces | Composes with |
| --- | --- | --- | --- | --- |
| `liveness`, `reachingDefinitions` | `(g, { use, def }) → Solution` | bit-vector dataflow [Kildall73] | the transfer halves of `src/typed/analyses.ts:296`, `:352`; `intervals`'s liveness (`src/typed/backend/regalloc.ts:85-100`) | register allocation, `dce`, `pe` memo keys (all six B1 cells key on liveness) |
| `ranges` | `(g, transfer, widen) → Solution<Interval map>` | interval analysis with widening [CC77] | `src/typed/analyses.ts:486`; in spirit, the parser's bounds check (`src/tensor/parser.ts:54`) | `bce`, guarded rules (C7 `needs`) |
| `factsHold` | `(solution, trace) → violations` | testing an abstraction against concrete runs | `rangesHold`, `perturbRanges` (`src/typed/facts-check.ts:39`, `:125`) | C4: a strength for analyses |

**L-ssa: single assignment**

| Primitive | Interface | Theory | Replaces | Composes with |
| --- | --- | --- | --- | --- |
| `ssa` | `(g, idom, defsOf, usesOf) → { phis, names }`; checker `checkSsa` | Cytron et al. [Cytron91] | `ssaOf`, `checkSsa` (`src/typed/ssa.ts:60`, `:325`) | `sparsePropagate`, value numbering |
| `sparsePropagate` | `(ssa, lattice, evalOp, branch) → { values, executableEdges }` | sparse conditional constant propagation [WZ91] | `sccpOf` (`src/typed/sccp.ts:47-140`); `b1-ds-x`'s edge constants | C6 (it is an equation system with on-demand unknowns) |

**L-term: terms and rules**

| Primitive | Interface | Theory | Replaces | Composes with |
| --- | --- | --- | --- | --- |
| `match`, `instantiate`, rule tables | over `Signature<Node>` (C7) | first-order matching | `matchPat`, `instantiate`, `indexRules` (`src/typed/rules/compile.ts:79-112`); the matchers of `a0-g-h` and `a0-tl-c` | C1 (citation), C7 |
| `strategies` | `topdown`, `bottomup`, `innermost`, `repeat`, `try` | strategic rewriting [Stratego98] | `Tx.rewrite`'s fixed bottom-up walk (`src/typed/tx.ts:431-481`); `mapExpr` (`src/tensor/model.ts:65`) | C7 |
| `structuralEqual`, `hashCons` | `(sig, a, b) → boolean`; `(sig, n) → key` | hash-consing; value numbering | `sameTree` twice (`src/typed/tx.ts:95`, `src/typed/mutate.ts:145`); the key of `lvn` (`src/typed/passes.ts:516`) | `lvn`, normal-form equality (T15), an e-graph (A1) |
| `verifyRule` | `(rule, semantics, methods) → RuleEvidence` | exhaustive and symbolic checking of a rewrite [Alive15] | `src/typed/rules/verify.ts:179`; the method ladder at `:8-15` | C4 (`exhaustive`, `by-construction`) |

**L-affine: affine index spaces**

| Primitive | Interface | Theory | Replaces | Composes with |
| --- | --- | --- | --- | --- |
| `Affine` | `add`, `scale`, `substitute`, `evaluate`, `equal`, `asVariable` | linear forms over ℤ | `src/tensor/model.ts:2-30`; `same` and `text` in `src/tensor/fusion.ts:68-80`; nine T6 access recognizers | everything in this group |
| `rangeOf` | `(affine, bounds of variables) → interval` | interval arithmetic on linear forms | `checkBounds` (`src/tensor/parser.ts:54`) | `L-flow.ranges` |
| `distance`, `commonParallelDepth` | as in probe 05 | dependence distance vectors [AK01] | `joinDepth` (`src/tensor/fusion.ts:83-105`) | C2 (`legal` for fusion) |
| `orderPreserved` | `(nestBefore, nestAfter, reduction) → Verdict` | legality as preservation of every dependence's direction [AK01, Feautrier92]; a reduction's fold is a chain of dependences on its accumulator | seven T6 order analyses (§3.3), from 20 to 195 lines | C2 (`legal` for scheduling), C4 (`by-construction` for `exact`) |
| `LoopNest` | `{ loops: { var, extent, kind }[], body }`, with `split`, `reorder`, `tile` as plan elements | the loop-transformation vocabulary [Halide13] | nine T6 tile and nest types; `t6-op-d:src/tensor/schedule.ts:46-66` is the nearest to this | C2 (plans), Typed's loops later |

**L-pe: partial evaluation**

| Primitive | Interface | Theory | Replaces | Composes with |
| --- | --- | --- | --- | --- |
| `bindingTimes`, `congruent` | `(dependencyGraph, dynamicSeeds) → Division`; `(division, graph) → Verdict` | binding-time analysis and congruence [JGS93] | six B1 analyses (§3.6); probe 03 is the 20-line version | C6 (it is an equation system), C2 (`congruent` is `legal`) |
| `unfold` | `({ start, step(point, state), key(point, state), budget }) → residual graph` | polyvariant program-point specialization with a pending and a done set [JGS93]; the first Futamura projection [Futamura71] | six memo-worklist-cloner loops, 100 to 500 lines each | C6 (on-demand unknowns), `naturalLoops` (specialization points), `liveness` (keys) |
| `budget` | `{ limit, onExhausted: 'refuse' \| 'generalize' \| 'fall-back' }` | termination of specialization by generalization | six different ad-hoc policies | `unfold`, `solveFor` |

**L-num: exact floating point**

| Primitive | Interface | Theory | Replaces | Composes with |
| --- | --- | --- | --- | --- |
| `f32` on bit patterns | `add`, `mul`, `div`, `sqrt`, `min`, `max`, conversions, with NaN and zero rules stated | IEEE 754 binary32; double rounding is innocuous for `+ − × ÷ √` (`src/typed/f32.ts:9-10`) | `src/typed/f32.ts`; `Math.fround` in `src/tensor/evaluate.ts:26`; `fold()` in `b1-g-h:src/typed/peval.ts:154-198` | both evaluators, rule verification, T11 (an exact FMA), T13 |
| `relations` | `exactBits`, `exactUpToNaN`, `within(bound)` as comparison functions with evidence | — | `compare` (`src/tensor/contract.ts:100-117`, `src/tensor/cuda-contract.ts:105`); `agrees` (`src/typed/evaluate.ts:561`) | C4 |
| `errorBound` | `(expression, inputs) → bound` | running first-order error analysis | the fixed `2e-6 + 2e-5·|r|` (`src/tensor/contract.ts:107`); F15, F22 | C4 (`within`) |

**L-check: the strength of a check**

| Primitive | Interface | Theory | Replaces | Composes with |
| --- | --- | --- | --- | --- |
| `generators` | combinators over a case domain: boundaries, specials, distinct sizes, empty extents, correlated parameters | property-based testing [QuickCheck00] | `casesFrom` (`src/typed/evaluate.ts:232`); `strongCasesFrom` (`src/typed/cases-strong.ts:329`); `cases` (`src/tensor/contract.ts:24-85`); F9 | `differential` |
| `mutants`, `killRate` | `(operators, sites) → mutants`; `(check, mutants) → rate` | mutation analysis [DLS78] | `src/typed/mutate.ts:401` and the operators above it; F21's mutant; T4 | C4 (`sampled` carries a kill rate) |
| `exhaustive` | `(finiteDomain, compare) → Evidence` | bounded exhaustive testing | `finiteDomain`, `compareOn` (`src/typed/mutate.ts:535`, `:586`); the 221- and 442-call replays every B1 cell scripted | C4 (`exhaustive`) |

**L-measure: cost**

| Primitive | Interface | Theory | Replaces | Composes with |
| --- | --- | --- | --- | --- |
| `attribute` | C8 | provenance [Prov07] | seven D1 tools; `src/typed/attribute.ts` | C1 |
| `classifyEdits` | `(derivation) → shares`, with instruction weights from `attribute` | — | seven A0 classifiers | C1, C8 |
| `staticFrequency` | `(g, branchProbability) → frequency per node` | static branch prediction [BL93], named in `src/typed/backend/frequency.ts:4` | `blockFrequencies`, `estimateCost` (`:105`, `:174`) | cost gates in C2's `decide` |
| `timing` | `(run, { warmups, repeats }) → { median, spread }`; "under 5 % is noise" | repeated measurement (the T9 protocol, IRWB-019 diary step 44) | each cell's benchmark loop; eight T6 launch rules compare against it | `chooseBest`, T7 |

### 6.4 What stays in a domain

- **Evaluators** (`src/typed/evaluate.ts`, `src/tensor/evaluate.ts`): they are the meaning.
- **Native stores and transactions** (`src/typed/model.ts`, `src/typed/tx.ts`): they hold the invariants; they implement the step sink.
- **Printers and encoders** (`src/tensor/cuda-source.ts`, `src/typed/backend/encode.ts`).
- **Measured constants and thresholds** (`staging`, `gate`, `blockThreads`: `src/tensor/fusion.ts:113`, `:135`; `src/tensor/cuda-source.ts:358`), as data a plan cites.
- **Language-specific passes** (frame promotion, copy propagation, `bce`).

## 7. Fundamental changes

### 7.1 Recommended

**A. Derivations become the spine (C1).** Today the framework's account of a pass is a diff of two projections plus whatever correspondence entries the pass volunteers. I would make the derivation the primary record and compute the rest from it. The projection stays for inspection and for the `writes` check. `IREdit` and the graph rewrite engine stop being the recommended way to change an IR; they remain for IRs that are graphs of entities by nature (the labs).

*Why at the root:* two domains independently refused to mutate through the projection, for reasons that are properties of the design (§4.2). Keeping it as the official path means every new domain repeats the choice and loses the record.

**B. A transformation is decide, justify, apply (C2).** The pass model gains a plan and a legality predicate. A pass whose plan is trivial needs neither.

*Why at the root:* the largest duplications in the material (ten T6 schedule wrappers, six fused binding-time analyses, seven attribution tools reconstructing a decision) come from decisions that exist only as control flow.

**C. Passes go between IRs (C3).**

**D. One runner, two drivers (C5).** Applied to the pass runner first, then to the strategy interpreter.

**E. Evidence has a relation and a strength (C4).** `Assurance` becomes the scale of §5.4, and a pass declares the relation it establishes.

**F. The dataflow layer becomes an equation solver (C6)** and sits under a standard library that holds the classic problems.

**G. A standard library tier (§6)**, with promotion by second use.

**H. Decide the v6 task runtime by one measurement.** `core/runtime.ts`, `query.ts` and `records.ts` duplicate what the analysis manager does for caching and dependency tracking, and no domain uses them. Either E1 (incremental checking per function) is built on them, or they move out of `src/framework/` with the labs.

### 7.2 Considered and rejected

| Change | Why I reject it |
| --- | --- |
| **One universal IR** (an SSA operation graph for every domain, as in MLIR's operation model) | The adapter approach held under two domains whose native forms differ in kind: value trees with one user each, and index-notation statements. C3 gets the benefit (a tower of IRs with checked steps) without forcing a shape. |
| **Make the generic edit layer fast enough to use** | Speed is one of three stated reasons (IRWB-006 diary `:483`). The other two are about where invariants live. A faster projection edit still allocates outside the domain's counters and still has identity-based matching. |
| **Make the framework synchronous** | The GPU gate is a remote call and Typed's checks run on a worker pool (`src/typed/meaning-exec.ts`). The asynchrony is real; it should be an effect, not a colour of every function. |
| **Make everything asynchronous and change `cudaSource`** | Fourteen T1 cells and eight T6 cells chose a synchronous path. A pure function from a program to a source string should not need an event loop. |
| **An e-graph as the core rewriting engine** | A0 measures local rewrites at 10 % to 20 % of O2's edits and 46 % of those as instances of verified rules. That is a use for an e-graph over value trees (A1), not a reason to route every pass through one. C7's signature lets it be added later. |
| **A polyhedral library for legality** | Tix is single assignment with affine accesses and ordered reductions. Distance vectors and order preservation decide every case in the corpus and in T6 (probe 05). A general integer-set library is a large dependency for questions the material does not ask. Revisit when a program needs a non-uniform dependence. |
| **Move Typed's `Tx` into the framework** | It encodes Typed's store, id counters and write kinds. The framework should own the step format (C1) and let each domain keep its transaction. |
| **Merge `PassSpec.legal` or `postcondition` as it stands (F32)** | Both are the `legal` of C2 without a plan to be legal about. Merging one fixes the name and leaves the decision implicit. |
| **Merge one `executeSync` (F32)** | It would be the third interpreter-shaped thing. C5 removes the need. |

## 8. Migration path

Each step is small, leaves the suites green, and states what it deletes and how to check it. Steps 1 to 4 need no design decision beyond this document. Steps 5 to 9 each start with a measurement that could stop them.

| # | Step | Deletes | Check |
| --- | --- | --- | --- |
| 1 | **One runner, two drivers for passes (C5).** Rewrite `applyPass` as a generator with `driveSync` and `driveAsync`, following probe 04. `applyNativePassSync` becomes a call to `driveSync`, then is removed. | `applyNativePassSync` (41 lines); the reason for six of the seven T6 framework changes | Existing pass tests unchanged. New test: a Tix pass with `needs` and `preserves` applied synchronously. Per-pass time before and after (baseline: about 30 ms). |
| 2 | **The step format and the sink (C1).** Define `Step` and `Derivation` in `src/framework/ir/`. `NativeResult` gains `derivation`. Typed's `Tx.record` writes steps, with `by` filled from `compileRules` (where the rule is in hand, `src/typed/rules/compile.ts:114-124`). | `Edit` as a private type; F31 | Probe 06 rerun: records naming a rule go from 0 to the count the A0 cells re-derived (183 under O2 on their base). |
| 3 | **Correspondence and `why` from derivations.** `correspondenceOf(d)` replaces `revisionCorrespondence`; in-place steps are no longer `retained`. | `revisionCorrespondence` (44 lines); `Program.why`'s origin walk | `whyChain` and `why` agree on every corpus entity; probe 06's "retained with no reason" share is reported again. |
| 4 | **`src/lib/graph`, `lattice`, `flow`, `ssa`: move, do not rewrite.** Lift `dominatorsOf`, `loopsOf`, `ssaOf`, the lattices and the liveness transfer behind `Digraph`. Instantiate liveness a second time on machine blocks. | `intervals`'s hand fixpoint (`src/typed/backend/regalloc.ts:91-100`); `sameTree`'s second copy | Byte-identical images on the corpus; `typed.loops@2` unchanged. |
| 5 | **Tix writes derivations.** `inline` and `split-sum` record steps; the fused lowering records which statements each kernel came from as steps of a `Pass<Tix, Cuda>` (C3). | `kernelCorrespondence` as hand-built data (`src/tensor/cuda-contract.ts:83-97`) | Probe 02, line 6: `inline` reports a merge, not a removal. |
| 6 | **Fusion as decide, justify, apply (C2), and `L-affine`.** `planFusion` becomes `decide`; `joinDepth` becomes `commonParallelDepth` in `src/lib/affine`; the storage and gate choices become plan fields; `emitCuda` becomes `apply`. Then restate one T6 schedule (I would start from `t6-op-d`'s loop nest) with `orderPreserved` as `legal`. | The thread-cap and gate-constant copies; T6's planner-import code | The fused source is byte-identical. Probe 05 becomes a test. **Decision point:** if `legal` for scheduling does not fit the same signature as for fusion, C2 keeps two signatures and the document's unification claim is withdrawn. |
| 7 | **Evidence (C4).** A pass declares its relation; `optimizeTix` stops switching on the pass name; `Assurance` gains `exhaustive` and `by-construction`; a step citing a verified rule is accepted without sampling. | The relation switch (`src/tensor/index.ts:42`); `assuranceOf` | F21's mutant is still rejected. Measure the share of O2 steps accepted `by-construction`, and the checking time saved. |
| 8 | **The solver takes equations (C6); `src/lib/pe`.** Add `solveFor` with on-demand unknowns. Port SCCP to it. Restate one B1 specializer (`b1-op-f` is offline and smallest in concepts) as `bindingTimes` + `congruent` + `unfold`. | `sccpOf`'s two worklists; one B1 cell's analysis, memo and cloner | SCCP's facts identical on the corpus. The restated specializer reaches the cell's 74 instructions. **Decision point:** count lines of the restated specializer against the original 719; if it is not at most half, `unfold` is not earning its place. |
| 9 | **Terms and rules (C7).** `Signature` for Typed values and for Tix expressions; `simplify`/`fold` run through `rewriteWith`; Tix `inline` and `split-sum` become two rules. | `rules/compile.ts`; the matcher in `rules/form.ts` | Identical revisions on the corpus, as IRWB-006 required of the table-driven passes. **Measure:** time per pass against the compiled visitor. |
| 10 | **Strategy interpreter on the same drivers; plans over plans.** `execute` and a synchronous `run` share one generator. Strategy values may be artifacts. | The need for any `executeSync`; `Program.pipeline`'s loop; `optimizeTix`'s loop | F27's test: a plan with `fork` and `chooseBest` over `inline` and `split-sum`, run synchronously. |
| 11 | **Attribution and classification as library calls (C8).** `attribute` and `classifyEdits` over derivations; `src/typed/attribute.ts` keeps measurement and formatting. | Most of `attribute.ts`; nothing to merge from A0 but its definitions | The merged tool's tables for the VM are reproduced exactly. |
| 12 | **The v6 runtime.** Build E1's edit-stream benchmark; try per-function checking on the analysis manager alone. If it suffices, move `core/runtime.ts`, `query.ts`, `records.ts` to `src/labs/`. | 1,237 lines from `src/framework/` | Conformance tests still pass from their new place. |

**What to measure to decide between alternatives**

| Question | Measurement |
| --- | --- |
| Does a derivation cost more than it saves? | Bytes and time per revision for derivation against today's correspondence (probe 06 gives today's 190,716 entries). |
| Generator runner or two hand-kept runners? | Per-pass overhead on Tix (30 ms today) and on Typed's O2 over the corpus. |
| One `legal` signature or one per concept? | Step 6's decision point. |
| Is `unfold` general? | Step 8's line count, and whether a second B1 cell's online specializer restates as easily. |
| Rules through `rewriteWith` or the compiled visitor? | Step 9's timing, and identical revisions. |
| Is `by-construction` evidence worth having? | Share of steps it covers (A0 suggests 46 % of local rewrites now, 95 % with one fact-guarded family) and gate time saved. |
| Does the library earn its tier? | Lines deleted from domains per primitive, and the number of instantiations after steps 4, 6 and 8. |

## 9. Open questions

1. **How fine should a step be?** A rule firing, a statement edit, or a decision instance (one inlining, one hoist)? `a0-op-f` asks for "passes to record instance ids". I would nest: a decision step contains statement steps.
2. **Can `legal` be complete, or only sound?** `planFusion` refuses legal fusions it cannot prove (horizontal fusion, `src/tensor/fusion.ts:86`). A sound, incomplete `legal` is acceptable if refusals are recorded with reasons.
3. **Who verifies `legal` itself?** C2 moves trust from the pass body to a predicate. Mutation analysis of `legal` (L-check) is the cheap answer; a proof per predicate is the expensive one. The sampled gate should stay on as a second witness until the kill rates are known.
4. **Launch-time choice.** A plan with guarded alternatives covers the fusion gate. Does it cover T7's autotuning, where the guard is learned from noisy timings?
5. **Does `Signature` fit Tix reductions?** A reduction binds axes. Matching under binders needs either names treated as attributes or a nominal discipline. T5 (tuple-state folds) will stress this.
6. **Order preservation beyond rectangular tiles.** `orderPreserved` over loop nests decides tiling and reordering. Staging terms and folding them on one thread (IRWB-030-E) is a different argument: the terms commute with nothing, but they are computed, not accumulated, out of order. The primitive must state both.
7. **Evidence for analyses.** C4 grades transformations. An analysis result is also trusted code (`facts-check.ts` tests one). Should every `defineAnalysis` carry a strength?
8. **Where the backend's decisions go.** D1 cells report that "the allocator does not record why it takes a callee-saved register" (`d1-op-f` analysis `:252`). Register allocation as decide, justify, apply is natural (an assignment is a plan; interference-freedom is its legality) and untested here.
9. **The cost of the survey method.** Three agents read forty worktrees; I opened about twenty-five of their citations. A claim marked without ✓ may be off by a few lines.

## 10. References

Every entry below was checked in this session by a subagent against Crossref, the publisher or the author's page, except those marked ‡, which the coordinator's framework report (`ttmp/2026/11/26/IRWB-019--…/various/report-artifact/index.html`, "Further reading") lists as checked. Theory named in the text without a key (rewriting-logic proof terms, where- and why-provenance, Tarjan's algorithm, hash-consing) is named from general knowledge and is not cited.

| Key | Reference |
| --- | --- |
| AK01 | Allen and Kennedy, *Optimizing Compilers for Modern Architectures: A Dependence-Based Approach*, Morgan Kaufmann, 2001. |
| Alive15 ‡ | "Provably Correct Peephole Optimizations with Alive", PLDI 2015. |
| Alive2-21 ‡ | "Alive2: Bounded Translation Validation for LLVM", PLDI 2021. |
| Benton04 | Benton, "Simple Relational Correctness Proofs for Static Analyses and Program Transformations", POPL 2004. |
| BL93 | Ball and Larus, "Branch Prediction for Free", PLDI 1993. |
| Bourdoncle93 | Bourdoncle, "Efficient Chaotic Iteration Strategies with Widenings", in *Formal Methods in Programming and Their Applications*, LNCS, 1993. |
| CC77 | Cousot and Cousot, "Abstract Interpretation: A Unified Lattice Model for Static Analysis of Programs by Construction or Approximation of Fixpoints", POPL 1977. |
| Cert11 | McConnell, Mehlhorn, Näher, Schweitzer, "Certifying Algorithms", Computer Science Review 5, 2011. |
| CHK01 | Cooper, Harvey, Kennedy, "A Simple, Fast Dominance Algorithm". Title and authors confirmed on the paper; the venue and year were **not** verified (it circulates as a Rice technical report). |
| CompCert09 | Leroy, "Formal Verification of a Realistic Compiler", Communications of the ACM 52(7), 2009. |
| Credible99 | Rinard, "Credible Compilation", MIT-LCS-TR-776, 1999 (the MIT archive titles the same report "Credible Compilers"). |
| Cytron91 ‡ | Cytron, Ferrante, Rosen, Wegman, Zadeck, "Efficiently Computing Static Single Assignment Form and the Control Dependence Graph", TOPLAS 1991. |
| DLS78 | DeMillo, Lipton, Sayward, "Hints on Test Data Selection: Help for the Practicing Programmer", IEEE Computer 11(4), 1978. |
| egg21 | Willsey, Nandi, Wang, Flatt, Tatlock, Panchekha, "egg: Fast and Extensible Equality Saturation", POPL 2021. |
| EqSat09 | Tate, Stepp, Tatlock, Lerner, "Equality Saturation: A New Approach to Optimization", POPL 2009. |
| Feautrier92 | Feautrier, "Some Efficient Solutions to the Affine Scheduling Problem. I. One-dimensional Time", International Journal of Parallel Programming 21, 1992. |
| FS99 | Fecht and Seidl, "A Faster Solver for General Systems of Equations", Science of Computer Programming 35, 1999. |
| Futamura71 | Futamura, "Partial Evaluation of Computation Process: An Approach to a Compiler-Compiler", reprinted in Higher-Order and Symbolic Computation 12, 1999 (the 1971 original was not checked). |
| Halide13 | Ragan-Kelley, Barnes, Adams, Paris, Durand, Amarasinghe, "Halide: A Language and Compiler for Optimizing Parallelism, Locality, and Recomputation in Image Processing Pipelines", PLDI 2013. |
| Handlers09 | Plotkin and Pretnar, "Handlers of Algebraic Effects", ESOP 2009. |
| JGS93 | Jones, Gomard, Sestoft, *Partial Evaluation and Automatic Program Generation*, Prentice Hall, 1993. |
| Kildall73 | Kildall, "A Unified Approach to Global Program Optimization", POPL 1973. |
| KU77 | Kam and Ullman, "Monotone Data Flow Analysis Frameworks", Acta Informatica 7, 1977. |
| LGC02 | Lerner, Grove, Chambers, "Composing Dataflow Analyses and Transformations", POPL 2002. |
| MLIR21 ‡ | "MLIR: A Compiler Infrastructure for the End of Moore's Law", CGO 2021. |
| Necula00 ‡ | Necula, "Translation Validation for an Optimizing Compiler", PLDI 2000. |
| Prov07 | Green, Karvounarakis, Tannen, "Provenance Semirings", PODS 2007. |
| QuickCheck00 | Claessen and Hughes, "QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs", ICFP 2000. |
| Stratego98 | Visser, Benaissa, Tolmach, "Building Program Optimizers with Rewriting Strategies", ICFP 1998. |
| TV98 ‡ | Pnueli, Siegel, Singerman, "Translation Validation", TACAS 1998. |
| TVM18 | Chen, Moreau, Jiang et al., "TVM: An Automated End-to-End Optimizing Compiler for Deep Learning", OSDI 2018. |
| Witness13 | Namjoshi and Zuck, "Witnessing Program Transformations", SAS 2013. |
| WZ91 ‡ | Wegman and Zadeck, "Constant Propagation with Conditional Branches", TOPLAS 1991. |

## Appendix: probe output

Run from the worktree root after `npm run build`; `P` is this ticket's `scripts/`.

```
$ node P/02-tix-against-the-edit-layer.mjs
1. entity kinds of the Tix projection {"function":1,"tensor":4} | capabilities ["Traversable","Queryable","Diffable","Verifiable"]
2. view.beginEdit() -> THROWS IRError: Adapter tensor.adapter is not Rewritable
3. matchAll(op('-', capture a, capture b)) -> THROWS Error: Operation patterns require the Operations adapter capability
4. matchAll(entity('tensor')) -> 4 matches
5. applyNativePassSync(pass with needs) -> THROWS PassError: [badResult] This pass requires the asynchronous analysis manager
6. inline: changed true | entity changes removed layernorm/centered, updated layernorm/y | correspondence relations {"retained":4,"removed":1}
   entry for the removed statement: {"from":["layernorm/centered"],"relation":"removed","to":[]}

$ node P/03-binding-times-on-the-dataflow-layer.mjs
binding times with x dynamic, w and b static: {"^":"S","affine/b":"S","affine/norm":"D","affine/scale":"S","affine/shift":"S","affine/w":"S","affine/x":"D","affine/y":"D"}
visits 8 (nodes: 8)
manager: same record reused true | has true
with w dynamic instead: {"^":"S","affine/b":"S","affine/norm":"D","affine/scale":"D","affine/shift":"D","affine/w":"D","affine/x":"S","affine/y":"D"}

$ node P/04-one-runner-two-drivers.mjs
sync driver:  changed true | fact {"f/x":1,"f/c":1} | revision 04a690a29419
async driver: changed true | same revision true
sync driver with an asynchronous answer: effect 'analysis' answered asynchronously; use the asynchronous driver

$ node P/05-fusion-legality-as-dependence-distance.mjs
same   attention                      [score shift e z weight out]@1
same   conv2d                         [out]@4
same   layernorm                      [mean centered variance y]@1
same   matmul                         [y]@2
same   mlp                            [h g y]@1
same   softmax                        [m e s y]@1
same   shifted read across rows       [a]@2 [b]@2
same   transposed read                [a]@2 [b]@2
same   row then column                [m c]@1 [v]@1 [y]@2
same   shifted read in the inner axis [a b]@1
10/10 functions: the dependence-distance test gives planFusion's groups and depths

$ node P/06-what-edit-records-carry.mjs
50 projects, 195 revisions, 1774 edit records (0 projects not run)
edit kinds: replace 492, retarget 481, unreachable 459, remove 183, insert 47, local 45, move 34, replaceStmt 17, merge 14, block 2
fields on edit records: because 1760, stmt 1237, from 1024, to 1024, field 973, block 722, text 609, note 65, at 47, local 45, name 45, into 14
records naming a rule (field rule/rules): 0
correspondence entries: 190716; relations: retained 187889, removed 1618, constprop 374, simplify 214, subst 207, licm 200, fold 85, inserted 56, strength 37, lvn 23, bce 13
entries that are 'retained' with no reason: 187889 (98.5 %)
```

Probe 01 prints one row per framework module; its two summary facts are quoted in §2.

**A limit of probe 05.** Its "shifted read across rows" case is refused because the extents differ, before any distance is examined; the parser's bounds check does not allow a shifted read between equal extents. The distance component is exercised by the transposed and the inner-axis cases.
