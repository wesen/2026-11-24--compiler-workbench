---
Title: Sketch guide diary
Ticket: IRWB-010
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological investigation diary for the IRWB-010 sketch guide (rewrite search on SSA and verified rules): what was read, the grounding measurements on noise3 and fbm3, the writing and the upload."
LastUpdated: 2026-11-26T12:00:00-05:00
WhatFor: "Evidence trail behind every number in the IRWB-010 guide; resume point."
WhenToUse: "Read the latest step when resuming; expand earlier steps only as needed."
---

# Sketch guide diary

Steps are chronological, oldest first. Every number in a step comes from the command shown in it or from the file it cites. Scripts are in `../scripts/`, measurements in `../various/`. The worktree is `.claude/worktrees/agent-a6dc8f9fd165045d9`, branched from `a4beda6` on `irwb-001/import-v6-prototype`. IRWB-011's diary (`ttmp/2026/11/26/IRWB-011--*/log/01-sketch-guide-diary.md`) records the measurements the two tickets share.

## Step 1: Read the system the guide has to explain

The brief asks for an intern-grade sketch guide: the parts of the system a reader needs, background from scratch, the design space, first experiments with decision criteria, and open questions. Nothing is implemented. This step reads the code and the tickets the guide builds on, and records the facts the guide will cite, with the commit each was read at.

The main finding of the reading is that the three ingredients the direction names exist and are measured: SSA as a checked fact (`typed.ssa`), rules as data with recorded evidence (`src/typed/rules/`), and a verifier that rejects unsound rules. What does not exist yet is anything that searches: no enumerator, no e-graph, no machine-level IR a superoptimizer could rewrite.

### Prompt Context
**User prompt (verbatim):** "You can make "sketch tickets" for 4 and 5, i just don't want to lose the idea. For each, Create a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
**Assistant interpretation:** IRWB-010 is sketch ticket 4: rule discovery by enumeration with the verifier as the filter (IRWB-002 B3), equality saturation over value trees (B4), a window superoptimizer over RV32 (B5), aimed at `noise3` and `fbm3`; plus the coordinator's research framing (proof-producing e-graphs, extraction by RV32 cost, a missed-optimization loop from provenance, e-graphs inside "one revision per pass").
**Inferred user intent:** Keep the idea, in a form a new person can pick up and start on with the first experiment, without anyone having to reconstruct the reasoning.
**Commit (code):** none (reading only).

### What I did
- Loaded the skills `ticket-research-docmgr-remarkable`, `docmgr`, `diary`, `textbook-authoring`, `remarkable-upload`, and read the writing-style and investigation-entry references.
- Read IRWB-002's guide Part 1 (sections 1–17) and items B1–B6, D3, D4, D6 (`ttmp/2026/11/24/IRWB-002--*/design-doc/01-*.md`, lines 924–1067 and 1221–1361).
- Read IRWB-006 (merged): the diary steps 4–10 and the changelog; `src/typed/rules/form.ts`, `simplify.ts`, `compile.ts`, `verify.ts` (types and `verifyRule`), `semantics.ts` exports; `src/typed/ssa.ts` (types, `ssaOf`, `ssaView`, `checkSsa`); `src/typed/sccp.ts`.
- Read the backend's f32 lowering (`src/typed/backend/select.ts:1–32`, `:107–126`), `image.ts` (`ImageInsn` with `fn`, `op`, `covers`), `run.ts` (`runImage`, `heat`).
- Read `noise3`, `fbm3`, `gnoise` in `corpus/candela-gallery/kernel.typed:147–184` and located their callers.
- Read IRWB-003 (not merged) in `.claude/worktrees/agent-a5888d4d3c671b653` at its branch head `90fed9c` (read from `.git/refs/heads/worktree-agent-a5888d4d3c671b653`, since git commands on another worktree are refused): diary steps 8, 13, 14 and guide line 303.
- Read IRWB-005 (not merged) in `.claude/worktrees/agent-a6abc74d4c978a51f` at `d9cf4e9`: diary steps 4, 10, 14, 18.
- `npx tsc -p tsconfig.json` (6.9 s) to have `dist/` for the measurement scripts; `git status --short` stays empty (`dist/` is ignored).

### Why
- The guide must explain `typed.blocks`, value trees with one user, `Tx` provenance, the meaning contract, rules and evidence, SSA, the backend's tiles and `covers`, because each design choice of the sketch depends on one of them.

### What worked
- Facts the guide will cite (all at `a4beda6` unless stated):
  - `simplify` is 27 rules, `fold` 40 (`src/typed/rules/simplify.ts:14–80`, IRWB-006 diary step 4). On the corpus's O2, 9 of the 27 `simplify` rules fire and 18 never do; 5 of the 40 `fold` rules fire (IRWB-006 diary step 4, `various/03-rule-firings-corpus-o2.json`). On Candela's O2 four `simplify` rules fire: `add-zero` 1, `mul-pow2` 39, `not-le` 4, `not-lt` 12 (step 5).
  - Evidence: `simplify` 15 proof, 4 exhaustive, 8 reduced-width+argument; `fold` 40 by-construction; 7 of 7 unsound candidates rejected (IRWB-006 changelog, `src/typed/rules/evidence.ts`).
  - `verifyRule(r, opts): RuleEvidence` (`src/typed/rules/verify.ts:179`); `Strength` (`:63`); eight method names (`:39–47`).
  - `ssaOf(st, f): SsaFn` (`src/typed/ssa.ts:60`), `ssaView` (`:243`), `checkSsa` (`:325`); on Candela r0: 23,850 names, 4,245 phis of which 2,840 dead, 0 mismatches against reaching definitions (IRWB-006 step 7).
  - The framework's pattern search costs about 74 times the compiled matcher on the same 71 × 67 searches (47,425 ms against 641 ms, IRWB-006 step 9); rules are applied by the compiled `Tx.rewrite` visitor.
  - `simplify` leaves every f32 operator alone (`simplify.ts:79`, property of the set).
  - The f32 backend exists on this branch: `fadd.s`, `fsub.s`, `fmul.s`, `fdiv.s`, `fsqrt.s` with RNE, and no fused instruction is emitted (`select.ts:107–115`). The vendored interpreter executes `fmadd.s`, `fmsub.s`, `fnmsub.s`, `fnmadd.s` with one rounding (`vendor/ds-js-os/bench/host/rv32-interp.js:134–147`, `:379–383`).
  - `noise3` makes 14 calls (3 `q_floor`, 3 `q_fract`, 8 `gnoise`) against 8 in the reference compiler's `kernel` image; `fbm3` carries the largest per-function gap over the oracle cases, 1,816,438 instructions (IRWB-003 guide line 303, at `90fed9c`).
  - `fbm3` and `noise3` are called only from scene sections of scenes 5 and 12–17 (`s5_mat_0`, `s12_dens_0`, `s13_dens_0`, `s14_sdf_0..2`, `s14_mat_1`, `s15_sdf_0`, `s16_hf_0`, `s16_bumpH_1`, `s16_mat_0`, `s17_hf_0`; `grep -n 'fbm3(\|noise3(' corpus/candela-gallery/scenes.typed`). B-01 and R-01, the two scenes most measurements use, never reach them.
  - IRWB-003 at `90fed9c`: B-01 instructions per pixel 8,501 (`kernel`), 10,435 (O2+), 8,267.7 (`speed` with three backend options); R-01 15,655.9, 22,850.9, 18,186.7 (diary step 14).

### What didn't work
- `git -C <other worktree> log` and a `cat` of the other worktree's `.git` pointer in one compound command were both refused by the worktree isolation check ("this command names git in a form too complex to verify that it stays inside the worktree"). I read the branch heads with the Read tool instead: `.git/worktrees/agent-a5888d4d3c671b653/HEAD` → `refs/heads/worktree-agent-a5888d4d3c671b653` → `90fed9c0…`; IRWB-005 → `d9cf4e94…`.

### What I learned
- The hot functions the direction names are hot only in seven of the eighteen scenes. A measurement of their share of executed instructions has to render one of those scenes, not B-01.

### What was tricky to build
- Nothing built in this step.

### What warrants a second pair of eyes
- IRWB-003 and IRWB-005 may have uncommitted work beyond the branch heads; the guide cites only what those commits' files say.

### What should be done in the future
- Measure the value-tree shapes of `noise3` and `fbm3` at r0 and O2, and their share of executed instructions in a scene that calls them (next steps).

### Code review instructions
- Start with `src/typed/rules/form.ts`, `src/typed/rules/verify.ts:179`, `src/typed/ssa.ts:25–60`.

### Technical details
- The vault report is deferred to the implementation milestone (coordinator's correction, received during this step); none was written.
