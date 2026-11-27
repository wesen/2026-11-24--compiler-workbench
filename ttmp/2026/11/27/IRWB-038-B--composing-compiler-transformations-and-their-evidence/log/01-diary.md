---
Title: Diary
Ticket: IRWB-038-B
Status: active
Topics:
    - compiler
    - research
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:55:25.705992437-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## 1. Fix the comparison boundary

I started at merged revision 93ec5fc. The review asks which repeated compiler mechanisms belong in the framework, what to keep, and how to migrate in independently testable steps. The requested deliverables are a ticket design, committed probes, a diary, and a final summary. I read the framework guides, coordinator report and backlog first. The historical design treats transformations, IR projections and measurements as separate levels. The current pass bridge raised a narrower question about how a native pass carries its gate. See src/framework/passes/bridge.ts:39 and src/tensor/contract.ts:125.

I compared each named sibling with t6-base and checked working-tree status separately. A clean committed diff alone misses work in D1-D, D1-C, A0-C and B1-D. The inventory will label working-copy evidence explicitly. All execution will use the review checkout or standalone, read-only input. No remote device measurements are needed to test a pass boundary.

## 2. Reproduce the boundaries before designing the interface

Checkpoint 1e16b53 established the ticket. I built this checkout with the TypeScript compiler and Node type declarations already installed in the A0-B sibling (read-only). Run the scripts below from the repository root. Node was v24.18.0. A normal installation can use npm run build.

- scripts/01-pass-boundary.mjs:17 exercised one genuine split with the same exact gate on both outputs. The ordinary strategy succeeded and returned a changed revision without a contract. A managed correspondence-only inline failed on the entity universe. Complete declared statement lists with zero mapping groups passed the manager. The inline trace retained f/y and removed f/p. The assurance helper labelled missing evidence exact.
- scripts/02-binding-times.mjs:25 compared B1-G's source directly with the merged solver. Both schedules returned local 3 as the only static local. Worklist took six visits, round-robin ten. This establishes expressibility for a cycle of copies only.
- scripts/03-merged-fixtures.sh:4 exercises core policy, rewrite, strategy, contract, lowering, Tix pass/fusion, and Typed attribution fixtures on CPU.
- scripts/04-cell-survey.py:45 pairs a committed diff against t6-base with a working-copy locator per cell. First run stopped at a report without a Markdown H1 (StopIteration). The script now falls back to the first line. The snapshot includes all 31 rows.
- scripts/05-reduction-order.mjs:12 tested T6-D's checker on a loop permutation. At R=17 the helper allowed an order whose f32 fold gives zero instead of one. The actual reorder precondition refused that permutation. The experiment distinguishes the strength of those two checks.

The first git add failed with “Read-only file system” on the shared index.lock. Authorized staging and commits use the Git metadata permission. Only ticket files are staged.

## 3. Separate acceptance from construction, then test a migration

After 3d7d916 I followed the output view into IRStore.retain. Adding a store to the original pass probe changed the result: preparation refused a new revision of the same ID, while a fresh output ID survived a failed correspondence contract as a visible head. I revised the recommendation to put publication before all later API migrations in priority order. See src/framework/ir/view.ts:190, src/framework/ir/store.ts:52 and scripts/01-pass-boundary.mjs:58.

I exercised A0-G’s rule re-derivation on a two-rule expression. It accepted the pair in an unchanged context and refused a sibling change (scripts/06-rewrite-scope.mjs:14). I then ran both Tix transformations with a shared origin-f64 tolerance under the existing fork/chooseBest interpreter. The one-statement output won, and both arms reported sampled acceptance (scripts/07-checked-choice.mjs:37). This is a small positive control for the proposed bridge. Neither result establishes whole-program equivalence. The reduction-order counterexample targets the T6-D validator; the same branch’s reorder precondition refused it (scripts/05-reduction-order.mjs:26).

I compared A0-B and G’s reports using their stated units. They recover the same verified-rule numerator and differ on what counts as local. That changed the proposed ledger: store the witness and its premises, compute the class as a query. Earlier designs on rule evidence and per-function analysis already anticipate parts of the proposal. The review distinguishes these antecedents from the new publication and projection findings.

Validation used Node 24.18.0. All nine selected merged CPU test files passed. The branch census captured 31 named worktrees. The first docmgr doctor run reported missing frontmatter on the survey; adding a reference header and numbering the filename fixed the metadata. The survey is a point-in-time snapshot, since the sibling branches can advance independently. No GPU timing or full-corpus census was repeated.

## Authored brief

The assignment reproduced below is the original user task.

````markdown
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It is an ongoing research artifact: an environment for building compilers, IRs, passes and optimizations, and for measuring and studying them. Its core is an IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), imported from a prototype called v6 and adapted at every stage since. v6 was one iteration, not a fixed design. Two very different domains run on it:
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`, corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA and run on an NVIDIA GB10 (`src/tensor/`).

Your ticket is IRWB-038-B. This is a **design-level research review**, in one session of up to three hours. You write no production code. Probes and small prototypes that test a claim go in your ticket's `scripts/` directory.

## The question
We now have a lot of material: the framework, two domains, four merged tensor stages, a merged Typed stage, and some forty unmerged implementations of the same tasks by different agents. Take a step back and work out what it means for the framework's structure.

- **Where does complexity live that the framework's composability should absorb?** Find the machinery that domains and implementations build for themselves: duplicated across cells or domains, reimplementing a framework concept, or filling a gap the framework leaves. For each, say which framework concept (existing, extended or new) would turn it into a reusable composable part, so that the domain code becomes a short instance of it.
- **How good is the core structure?** Judge each layer on what the material shows: what held under two domains, what was bypassed and why, what leaked. Name what should be kept as it is.
- **Be creative, and consider fundamental changes.** If the evidence suggests that the layering, the pass model, the contract model, the sync/async split, how IRs relate to each other, or the meaning of "checked" should change at the root, argue for it. Ground every framework concept you propose in standard theory: compiler theory, program analysis, rewriting, partial evaluation, polyhedral scheduling, translation validation, abstract interpretation, category-theoretic composition or anything else that applies. Name its domain-independent form and at least two uses in the material.
- **Give a path:** an ordered migration, each step small and checkable, what it deletes, and what you would measure to decide between alternatives.

## The material
Read the merged code first, then the unmerged work as evidence. You may read every path below, read-only; change files only in your own worktree.
- **Framework:** `src/framework/*/README.md`, `src/framework/ir/PATTERNS-AND-REWRITES.md`, and the code.
- **Coordinator's records:** `BACKLOG.md` (note "Framework first, grounded in theory" and F1–F32), and `ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/` (its `log/01-diary.md`; `various/report-artifact/index.html`, a report on the framework and every stage, including "Where the framework's promises have not held up").
- **Earlier design work:** `ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/`, `ttmp/2026/11/24/IRWB-002--*`, and the intern guides of `ttmp/2026/11/25/IRWB-003` to `IRWB-011`.
- **Merged stages:** the tickets of IRWB-020-B (Tix), IRWB-022-I (CUDA lowering), IRWB-029-D (fusion), IRWB-030-E (fusion never slower), IRWB-031 and IRWB-032 (framework fixes), IRWB-034-G (D1: instruction attribution and a loop-analysis fix).
- **Unmerged implementations,** one worktree each; every one has its ticket (design, report, diary) under `ttmp/2026/11/27/` and its code on its branch. Compare with `git -C <worktree> diff t6-base HEAD`. Some are unfinished, which is evidence too.
  - **T6, a schedule IR between Tix and CUDA with checked scheduling passes** (ten implementations):
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-am-irwb-033-b`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-ds-h-irwb-033-g`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-ds-x-irwb-033-h`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-fa-irwb-033-e`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-gf-h-irwb-033-i`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-g-h-irwb-033-f`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-g-max-irwb-033-j`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-op-irwb-033-d`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-sm-irwb-033-a`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-tl-irwb-033-c`
  - **D1, attributing executed instructions to compiler decisions, and fixing a regression** (seven):
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-am-irwb-034-b`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-ds-x-irwb-034-d`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-fa-irwb-034-g`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-g-h-irwb-034-e`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-op-irwb-034-f`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-sm-irwb-034-a`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-tl-irwb-034-c`
  - **A0, classifying every optimizer edit as a local rewrite, structural, or other** (seven):
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-am-irwb-035-b`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-ds-x-irwb-035-d`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-fa-irwb-035-g`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-g-h-irwb-035-e`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-op-irwb-035-f`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-sm-irwb-035-a`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-tl-irwb-035-c`
  - **B1, partial evaluation of the bytecode VM on its bytecode, with a binding-time analysis** (seven):
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-am-irwb-036-b`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-ds-x-irwb-036-d`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-fa-irwb-036-g`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-g-h-irwb-036-e`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-op-irwb-036-f`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-sm-irwb-036-a`
    - `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-tl-irwb-036-c`
- **Starting points, not conclusions.** The coordinator has noticed these; verify each, and go beyond them:
  - most B1 cells wrote their own binding-time analysis inside `src/typed/`;
  - several A0 and D1 cells built near-identical edit classifiers and attribution tools;
  - T6 cells built schedule IRs whose passes partly copy decisions made by `planFusion`;
  - one T6 cell added a synchronous strategy interpreter beside the asynchronous one;
  - another added `PassSpec.legal`;
  - the dataflow layer and the rewrite engine are unused by Tix;
  - two pass runners with different powers;
  - correspondence that Tix passes record only coarsely;
  - checks that are sampled and never proven.

## Write
- **A design document in your ticket,** with your docmgr skill. Structure it as you see fit, but include:
  - the inventory of domain-built machinery, with file and line evidence;
  - the proposed framework concepts, each with its theory, its domain-independent interface sketch and its uses;
  - your assessment of each layer;
  - the fundamental changes you would make, if any, and the ones you considered and rejected;
  - the migration path;
  - open questions.
- **Keep a diary.** Commit as you go, with messages starting `IRWB-038-B:`. Do not push.
- **Every claim about the code cites `path:line`.** Run a probe before you rely on a behaviour you have not seen work.

## Final message
- your ticket and design document paths;
- your five most important findings, one line each;
- the framework concepts you propose, one line each;
- the fundamental changes you recommend;
- the last commit hash.
````
