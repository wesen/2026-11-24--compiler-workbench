---
Title: Research diary
Ticket: IRWB-038-A
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological research and probe evidence for IRWB-038-A.
LastUpdated: 2026-11-27T13:12:28.713030001-05:00
WhatFor: ""
WhenToUse: ""
---

# Research diary

## 1. Merged baseline and experiment setup

I opened the ticket on `93ec5fc`, the review brief, and followed the framework entry points in the merged tree before comparing the cell heads. Typed and Tix share artifact and pass declarations, but bring different preparation and validation paths to those declarations. The first experiments test whether the differences depend on scheduling and whether the existing evidence APIs can be trusted as general interfaces.

### Prompt context

The authored request is recorded verbatim below. I interpreted the listed worktrees as a fixed comparison set and used committed HEADs as the unit of source evidence.

<details>
<summary>Authored request</summary>

You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It is an ongoing research artifact: an environment for building compilers, IRs, passes and optimizations, and for measuring and studying them. Its core is an IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), imported from a prototype called v6 and adapted at every stage since. v6 was one iteration, not a fixed design. Two very different domains run on it:
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`, corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA and run on an NVIDIA GB10 (`src/tensor/`).

Your ticket is IRWB-038-A. This is a **design-level research review**, in one session of up to three hours. You write no production code. Probes and small prototypes that test a claim go in your ticket's `scripts/` directory.

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
- **Keep a diary.** Commit as you go, with messages starting `IRWB-038-A:`. Do not push.
- **Every claim about the code cites `path:line`.** Run a probe before you rely on a behaviour you have not seen work.

## Final message
- your ticket and design document paths;
- your five most important findings, one line each;
- the framework concepts you propose, one line each;
- the fundamental changes you recommend;
- the last commit hash.

</details>

### Investigation

- Read the framework's documented layer boundaries alongside the merged entry points. The shared pass descriptor and its runner split are in `src/framework/passes/define-pass.ts:79`, `:225`, and `:267`. Tix keeps origin and current in `src/tensor/index.ts:16` and supplies its own gate at `:39`. Typed's transaction wrapper is in `src/typed/passes.ts:168`.
- Compared all 31 named HEADs to `t6-base` with `scripts/01-cell-inventory.py`. The comparison also covers unfinished submissions because source changes and ticket documents are listed independently.
- The strip-only invocation of `scripts/03-pass-and-evidence.mjs` failed with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at `src/framework/ir/common.ts:5`. Running with `--experimental-transform-types` reached the probes. The first store assertion expected `ir.revision` and actually received `ir.unpublished` from `src/framework/ir/store.ts:53`. I updated the assertion to the observed error. The distinction matters because the store is enforcing its retention contract.
- Review entry points are `scripts/03-pass-and-evidence.mjs`, `src/framework/passes/bridge.ts:29`, and the case/outcome key boundary in `src/framework/contracts/differential.ts:200`. Review the probe's synthetic key as a deliberately invalid caller key and assess what the generic API should enforce about that trust boundary.

## 2. Compare the cells and test the architecture seams

The checkpoint is `b580637`. The scope and authored brief are in Step 1. I compared candidate construction, checks, and records first, then used the differences to select runnable entry points. The repeated need is a place to put a particular fact, decision, or witness. Matching counts alone would have missed some of the disagreement about what constitutes one edit.

### Evidence and probes

- P1, run with Node 24.18.0, shows that the stock async pass path has no gate for the Tix native definition and that the explicit store refuses a fresh revision. It also confirms that identical cases can leave an aliased baseline key undetected and that missing evidence is labeled exact. See `scripts/03-pass-and-evidence.mjs`, `src/tensor/passes.ts:82`, `src/framework/passes/define-pass.ts:201`, `src/framework/ir/store.ts:53`, and `src/framework/contracts/differential.ts:377`.
- P2 uses the coordinator's Tix fork/choice idea with native callbacks and their actual gates. The merged interpreter chose inline. T6-E and H rejected `chooseBest`. The same probe ran the merged Typed two-latch O2 case, found one loop with two latches and an external preheader, and reconciled an instruction count change of 248 → 130, with −36 on the LICM edge. See `scripts/04-strategy-and-attribution.mjs`, `src/framework/strategy/interpreter.ts:134`, `T6-E/src/framework/strategy/sync.ts:113`, `T6-H/src/framework/strategy/sync.ts:145`, and `src/typed/attribute.ts:185`.
- P3 exercises eligibility and postvalidation in T6-D. My first mutant reassigned the outer loop's ID before looking up the inner loop. The second lookup found the outer loop again, so the test ended with `AssertionError [ERR_ASSERTION]: Missing expected exception` in `scripts/05-schedule-obligations.mjs`. Capturing both loop objects first made the mutation real. The illegal reorder then stopped before either pass kernel invocation, and an eligible but incorrect candidate was rejected by the order check. That checker combines structural tests and three finite extent simulations. See `T6-D/src/framework/passes/define-pass.ts:162` and `T6-D/src/tensor/schedule.ts:303`.
- I inspected working copies without modifying them. Uncommitted code pointers include `A0-C/tools/edit-census.mjs:21`, `D1-C/src/typed/backend/attribution.ts:6`, `D1-D/src/typed/attribution.ts:56`, `B1-D/src/typed/dispatch.ts:76`, and `B1-D/src/typed/futamura.ts:56`. T6-F/I/J also had local changes. Committed HEADs are the denominator in the cell matrix. The matrix names unfinished or thin stages explicitly and treats draft status as observation rather than a completed result.

### Decisions and review points

- A pass receipt should preserve what ran, what was refused, what was checked, and which artifact pointer was advanced. Typed and Tix should use the same lifecycle. Keep the pre-kernel must-hold condition and the post-kernel evidence distinct, especially for GPU jobs.
- The migration pairs each concept with a deletion, a correctness gate and a measurement. The high-risk decisions are visited in order: assurance and cache identities, candidate publication and branching, meaning-bearing edit units, and finally broader partial evaluation and affine analysis. Review the root alternatives in the design and compare them to the retained implementation boundaries.
- The review used local CPU executions and source inspection. GPU timings and full-corpus data cited in the design and evidence matrix come from the stage reports. The probes did not retest the GPU and do not rank cells.

- P4 used the published injection point to compare CUDA contract metadata and case scheduling independently of a GPU. Softmax requested both forced variants. The same generated unfused source was accepted with an incorrect mapping to a valid source statement, while an unknown source entity caused rejection. Membership and semantic correctness of provenance are different obligations. See `scripts/06-cross-ir-metadata.mjs`, `src/tensor/cuda-contract.ts:82`, and `src/framework/contracts/analysis-manager.ts:1110`.
- P5 put two A0 classifiers on the exact same `blend` constant-propagation edit. A classified it as other and G as local/fact. The same probe exercised a one-variant bound in B1. A refused and retained the original revision and assumptions. G accepted a residual region with the general loop as fallback and a `40/40` differential result. See `scripts/07-cell-policy-differences.mjs`, `A0-A/src/typed/edit-classification.ts:251`, `A0-G/tests/typed/edit-classes.test.mjs:54`, `B1-A/src/typed/specialize-memory.ts:69`, and `B1-G/tests/typed/specialize-buffer.test.mjs:120`. Use this case when reviewing the design's proposed policy parameters.

## 3. Validate the handoff

P6 confirmed that the contract manager's accepted execution and output fact survive a later `preserveViolated` error from the enclosing pass. A separate deferred preparation let the probe roll back before exposing the fact. This changes the recommendation from aligning two runners to defining one acceptance boundary spanning pass-level checks and contract publication. See `scripts/09-acceptance-atomicity.mjs`, `src/framework/passes/define-pass.ts:347`, `src/framework/passes/define-pass.ts:367`, and `src/framework/contracts/analysis-manager.ts:1577`.

The first mechanical citation audit found two unqualified paths to the T6 synchronous interpreters. I prefixed each path with its cell ID and reran the check. The citation check validates local links and full line anchors against the merged tree and frozen cell objects. It leaves interpretation of those lines to the reader. The ticket uses docmgr's `review` status and closes the research tasks while keeping the migration as design work.
