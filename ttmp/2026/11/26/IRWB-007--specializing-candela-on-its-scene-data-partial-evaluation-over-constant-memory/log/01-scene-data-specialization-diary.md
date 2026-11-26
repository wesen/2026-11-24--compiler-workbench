---
Title: Scene-data specialization diary (IRWB-007)
Ticket: IRWB-007
Status: active
Topics:
    - compiler
    - ir
    - candela
    - performance
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological record of the IRWB-007 guide round: the sources read, the measurements made to ground the intern guide on specializing Candela on its scene data, the drafting, the second reading and the upload.
LastUpdated: 2026-11-26T09:50:46.682152146-05:00
WhatFor: Reconstructing what was read, measured and decided for the IRWB-007 guide, and why.
WhenToUse: Before resuming IRWB-007, or before implementing any of its phases.
---

# Scene-data specialization diary (IRWB-007)

Entries are in chronological order, oldest first. This round writes a guide and makes only the measurements the guide needs; nothing under `src/`, `tests/` or `tools/` changes.

## Step 1: Read the brief, the system guide, the per-scene history and the code

This step gathered the evidence the guide rests on. I read the IRWB-002 guide's Part 1 and its agenda item E4, the IRWB-001 implementation diary's steps on rendering, field bindings, entries, `dfe`, per-scene images and O2+ (17–19, 25–28), design-doc 05 §7 and §9, the code of the specializer and its host (`specialize.ts`, `program.ts`), the passes `dfe` and `bcm`, the Candela host protocol (`candela-render.ts`, `tools/candela.mjs`), the evaluator's memory semantics, the SSA view and SCCP of IRWB-006, and the Candela source itself, which is generated Typed. I also read IRWB-003's diary on its unmerged branch, read-only.

The main finding of the reading is that the gallery's generator has already done part of the job by hand: each scene's materials, user SDFs, height fields and densities are emitted as Typed code (`s<k>_mat_<m>`, `s<k>_sdUser`, …) with their constants written in, while the object table, the lights, the BVH, the camera and the per-scene flags stay in five row buffers that the fixed kernel interprets. So "fold materials to constants" is largely done already, by the generator; what remains interpreted is geometry, lights, BVH and uniforms.

### Prompt Context
**User prompt (verbatim):** "For each, Create a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
**Assistant interpretation:** For IRWB-007 (the coordinator delegated one ticket per agent): an intern guide on specializing Candela on its scene buffers, as a docmgr design-doc in the ticket, grounded by small measurements, then uploaded to reMarkable. No implementation.
**Inferred user intent:** A self-contained, evidence-based starting point for whoever implements partial evaluation over constant memory, with the research framing (first Futamura projection) and a falsifiable hypothesis.
**Commit (code):** none (no code changes in this round).

### What I did
- Loaded the skills `ticket-research-docmgr-remarkable`, `docmgr`, `diary`, `textbook-authoring`, `remarkable-upload`, and their writing-style, investigation-entry and deliverable-checklist references.
- Read `ttmp/2026/11/24/IRWB-002--*/design-doc/01-*.md` lines 1–745 (Part 1) and 1382–1490 (workstream E, E4 at 1443–1466), and 1630–1685 (G3 unrolling).
- Read `ttmp/2026/11/24/IRWB-001--ir-workbench/log/02-implementation-diary.md` steps 17–19 (lines 953–1094) and 25–28 (lines 1241–1391); design-doc 05 lines 156–228 (§7, §9).
- Read code: `src/typed/specialize.ts` (all 143 lines); `src/typed/program.ts` lines 55–290 (`entries`, `inputs`, `assume`, `specialize`, `apply`); `src/typed/passes.ts` lines 640–975 (`bcm`, `dfe`); `src/typed/candela-render.ts` (all); `tools/candela.mjs` (all); `src/typed/evaluate.ts` lines 36–265 and 316–635 (`Memory`, `makeValue`, `casesFrom`, `evaluate`, `agrees`, `meaningKept`); `src/typed/lift.ts` lines 560–610 (how `load`, `store` and `text.checked_address` lift); `src/typed/sccp.ts` (all); `src/typed/ssa.ts` lines 1–80.
- Read Candela source: `corpus/candela-gallery/types.typed` (record `K` at lines 148–166), `glue.typed` (the four entries), `kernel.typed` (`oRow`, `poseQ`, `xfP`, `hitMesh`, `finishHit`, `traceAll`, `lRow`, `mRow`, `renderPixel`, `evalMaterial`), `scenes.typed` lines 1–130 (scene 0's sections), and the head of `candela_gallery_scenes.c` (B-01's rows, as data).
- IRWB-003 (read-only): `git log worktree-agent-a5888d4d3c671b653` (head `90fed9c`), its diary `ttmp/2026/11/25/IRWB-003--*/log/01-speed-gap-diary.md` steps 8–14 in the worktree `.claude/worktrees/agent-a5888d4d3c671b653`.
- Built this worktree: `node /home/manuel/code/wesen/2026-11-24--compiler-workbench/node_modules/typescript/bin/tsc -p tsconfig.json` (8.5 s, no output; `dist/` is git-ignored), so that ticket scripts can import `dist/`.

### Why
- The guide must describe the system as it is in the code, not as earlier documents say it is; every number in it must have a source.

### What worked
- IRWB-003's claim is verified in its diary, Step 13 (commit `47ba752`): B-01 under `speed` with `dfe` after each `inline` and the options `chains`, `coalesce`, `homes`: **8,267.7** instructions per pixel against `kernel`'s 8,501, 0 differing floats. Step 14 (commit `90fed9c`): R-01 18,186.7 against 15,655.9.
- The host protocol, read from `CandelaHost` (`candela-render.ts:74–144`) and `cdlLayout` (`glue.typed:5–20`): K is 17 words at ARENA = 4096; K's words 0–4 point to the five scene buffers, word 5 to the GGX table (256 f32, header at arena word 17), word 6 to the sky table (12,288 f32, header at arena word 274); arena 12,563 words; scene buffers after the output buffer; K.scene word 7, spectral 8, skyOn 9.
- B-01's rows, decoded by hand from the scene table: U 41, O 12, LI 6, BV 2, SD 1 rows (248 words). U row 19 (words 76–79) = (2, 0, 2, 1): `nObj` 2, `nB` 2, `nNodes` 1. The single BVH node is a leaf with first object 0 and count 2, box (−15, −0.001, −15)–(15, 2, 15).

### What didn't work
- `git -C ../../.. log` was refused by the worktree guard (a runtime-computed path); the same information came from `git worktree list` run in this worktree.

### What I learned
- Materials are hand-staged per scene by the generator (`s0_mat_0` has the albedo `0.57758045, 0.09084171, 0.046665087` as literals); the material *choice* per hit (`h.mat`, from O row 0) is data.
- `traceAll` (`kernel.typed:962–1029`) has two loops whose shape comes from U and BV: the linear loop `for i in [nB, nObj)` over unbounded objects, and a stack-based BVH walk that runs only if `nNodes > 0`.
- The BVH walk's stack pointer is static by data but changes under a dynamic test (`hitAABB` on the ray): the classic case where a monovariant binding-time analysis makes it dynamic, and polyvariant program-point specialization keeps it static.
- IEEE semantics limit what folding constant operands buys: `0·x` is not `0` and `x + 0` is not `x` for all `x`; a constant transform row folds loads, not arithmetic.

### What was tricky to build
- Nothing built yet.

### What warrants a second pair of eyes
- IRWB-003 is not merged; its numbers are cited from its diary at commit `90fed9c` and may change before merge.

### What should be done in the future
- Measure, before writing the design, how much of the per-pixel work is static once the scene buffers are constant: that number decides the hypothesis.

### Code review instructions
- N/A (reading step).

### Technical details
- `getF32(i)` on a buffer lifts to `load f32 [caddr(r, p) + imm]`; IRWB-001 Step 13 records positions `2i + 1` for the four reads of `oRow`.
- `specialize`'s field form matches `load32[p + offset]` where `p` is a K parameter whose only reaching definition is itself (`specialize.ts:110–124`); the static write check refuses a `store` at that offset through such a parameter (`:99–109`).

## Step 2: Measurements 1 and 2 — what the scene buffers hold, and who reads them at r0

This step made the two static measurements. The first reads the vendored scene table as data and decodes, per scene, the rows of each buffer, the object table, the light count and the BVH, using the meaning of each word as the kernel that consumes it defines it. The second lifts Candela to r0 (0.7 s, 190 MB) and scans it without executing anything: which functions read which fields of K, every checked address into a K buffer with its position constant or not, and every natural loop with what its exit conditions depend on.

The scene data is small everywhere: 224 to 916 words per scene, at most 24 objects, at most 2 lights, at most 15 BVH nodes and a BVH depth of at most 4. No gallery scene contains a triangle mesh (type 13), so `hitMesh` and its BVH never run. At r0 the uniforms buffer U is read at 174 sites, every one at a constant position, while every read of O, LI, BV and SD has a variable position (a row index times a stride plus a constant): folding U needs only a constant-address rule, folding the others needs the row index to be static first.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Ground the guide with pure-data and static measurements before any execution.
**Inferred user intent:** Numbers with sources, at the lowest cost and risk to the shared machine.
**Commit (code):** none.

### What I did
- `scripts/01-scene-table-inventory.mjs`: digest-checks `candela_gallery_scenes.c` against `VENDOR.json`, parses it with `parseSceneTable` (`dist/typed/candela-render.js`), decodes U row 0 (res, spp), U 76–79 (`nObj`, `nLights`, first unbounded object, `nNodes`), U 31/32 (sun, environment mode), U 87 (integrator mode), U 95, U 97, the six O rows per object, and walks the BVH as `traceAll` does.
  - `node scripts/01-scene-table-inventory.mjs --json various/01-scene-table-inventory.json --text various/01-scene-table-inventory.txt`
- `scripts/02-r0-buffer-reads-and-loops.mjs`: `ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE })`, then per function: K-field loads through K parameters (`st.frontEnd.records.K` offsets), locals holding a K buffer, `caddr` sites with their receiver's buffer and a constant-resolution of the position (single-assignment chains, as IRWB-001's script 09 did), the call graph, and `loopsOf` with flow-insensitive sources of each exit condition.
  - `systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 /usr/bin/time -v node --max-old-space-size=10240 scripts/02-r0-buffer-reads-and-loops.mjs --json various/02-r0-buffer-reads-and-loops.json --text various/02-r0-buffer-reads-and-loops.txt` → `Elapsed 0:01.05`, `Maximum resident set size 189520` KB, exit 0.

### Why
- The scene table answers "how much code can unrolling create" before anyone writes a specializer; the static scan answers "which reads fold without polyvariance".

### What worked
- Scene table (`various/01-scene-table-inventory.txt`): 18 scenes, 6,496 words in all (25,984 bytes); per scene 224–916 words; objects 1–24; lights 0–2; BVH nodes 1–15, leaves 1–8, at most 3 objects per leaf, depth ≤ 4; the linear (unbounded-object) loop runs 0 or 1 times. B-01: 248 words, a sphere (translated by (0, −1, 0), identity linear part) and a plane, 0 lights, sun on, environment mode 4, one BVH node that is a leaf holding both objects.
- r0 scan (`various/02-r0-buffer-reads-and-loops.txt`): 559 checked addresses; into `bU` 174 (all constant positions, 31 functions), `bO` 4 (variable, only `oRow`), `bL` 4 (variable, only `lRow`), `bB` 8 (variable, only `traceAll`), `bS` 79 (variable, 7 functions), `etab` 256 constant (`cdlInit`'s writes) and 4 variable (`ggxE`), `sky` 6 variable (`skyBuild`, `skyTexel`), 24 into other buffers (the output and layout buffers). 35 functions index a scene buffer directly; 64 reach one through calls.
- 19 natural loops: 8 whose exit conditions read scene data (`traceAll`'s unbounded-object loop and its BVH-leaf loop, `renderPixel`'s sample loop, `tracePath`'s bounce loop and two medium loops, `shadowTr`'s media loop, `hitMesh`'s triangle loop), 7 bounded by constants or frame-array contents (`traceAll`'s and `hitMesh`'s BVH stack loops, `voronoi3`'s three, `skyBuild`'s two), 4 bounded by parameters.

### What didn't work
- No failures. One limit of the scan: exit-condition sources are flow-insensitive (every assignment of a local counts), so "reads scene data" does not mean "is static": `tracePath`'s bounce loop also depends on `rnd`.

### What I learned
- `traceAll`'s BVH loop is bounded only by its own stack pointer (constants and the frame array), which is what makes it specializable once the node rows are constant.
- `oRow` is the only reader of O, `lRow` of LI, `traceAll` of BV: the object, light and node tables each have exactly one interpreter function.

### What was tricky to build
- Resolving which local holds which K buffer: the lifter assigns `q_bU = load32[q_k + 0]` once per function, so "every assignment loads one K buffer field" identifies it.

### What warrants a second pair of eyes
- The U word meanings are read from the kernel's use of them (cited in the script header), not from Candela's own exporter, which this project does not run.

### What should be done in the future
- N/A.

### Code review instructions
- `scripts/01-scene-table-inventory.mjs`, `scripts/02-r0-buffer-reads-and-loops.mjs`; rerun the two commands above.

### Technical details
- Type codes (`hitObj`, `kernel.typed:642–770`): 0 sphere, 1 plane (square of side `pr.x` when `pr.x > 0`), 2 rectangle, 3 disc, 4 box, 5 cylinder, 13 mesh, every other a ray-marched distance field (`sdLocal`).

## Step 3: Measurement 3 — a binding-time profile of the per-pixel work, and four corrections to it

This step built the measurement that decides the hypothesis. A shadow interpreter (a copy of `evaluate`'s loop, in `scripts/03-binding-time-profile.mjs`) runs `cdlRenderSpan` for each pixel of a scene, at stride 8, on the memory the real host protocol produced, and tags every value with its binding time: C (literal constants), K (`K.scene`), M (the frame-constant memory a host promise would cover), X (a load from that memory at a dynamic address) or D (dynamic). It counts every executed operation with its tag, in three modes that model three kinds of specializer, and in the polyvariant modes it computes a dynamic slice so that dynamic work made dead by specialization is not counted as residual. Every pixel's 12 output floats from the shadow run are compared with the evaluator's run of the same call.

Four versions of the script were wrong before the one recorded here. Each error was found by reading its numbers, and each is recorded below, because the first two gave numbers that looked plausible.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** "What would falsify the hypothesis" should be answered by a measurement where one is affordable; one capped process, stride 8.
**Inferred user intent:** Know before building a general specializer whether "multiples, not percents" is possible on this program.
**Commit (code):** none.

### What I did
- Wrote the shadow interpreter: per call frame `L` (values), `LT` (tags), `LP` (producer records); per memory byte a tag, per word a producer; region tracking for dynamic branches from immediate post-dominators computed on the reverse CFG.
- Ran B-01 several times while correcting it (each about 11–17 s under `systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 … node --max-old-space-size=10240`, 360–380 MB resident).
- Added a third mode, `gen` (generalize selected values at function returns), stopped the first 18-scene run by PID (`kill 172889`) so that every scene is measured by one version of the script, and started the 18-scene run in three modes.

### What didn't work
- **Version 1: K-tagged work was 0.** The K pointer argument was tagged M, so `load32[q_k + 28]` (K.scene) took max(M, K) = M. Fix: the addresses of K and of the output buffer are the host's choice and are tagged C; K's contents carry the tags. After it: K 7.3 operations per pixel on B-01.
- **Version 1: the control mode tainted callee locals.** The pixel loop in `cdlRenderSpan` is dynamic (`x < x1`), so every callee ran "under a dynamic region" and every assignment in it became D (control-mode M: 94 per pixel). A monovariant analysis classifies a callee's locals by its own arguments; only memory effects escape. Fix: assignments and returns are tainted by the frame's own regions, stores by any caller's too.
- **Versions 2 and 3: the slice dropped selections.** `traceAll`'s `if (t < r.t) { r.t = t; r.obj = i; }` creates no operation when it assigns, so the branch was never in the slice, and every intersection test that did not win was counted dead (B-01 `xfP`: 92 of 104 operations per pixel dead). Fix: an assignment, store or return under a dynamic branch creates an uncounted selection record that depends on the branch; a static branch whose condition depends on a selection opens a region too (the shadow test's result is static by data but selected by the hit tests).
- **Version 4: the arm not taken.** When `t < r.t` is false nothing is assigned, so the value of `r.t` after the join did not depend on the branch: the omission problem of dynamic slicing. Fix: at a region's post-dominator, every local the region may assign (computed from the blocks between the branch and its post-dominator) gets a selection record (data and gen modes) or becomes D (control mode). After it, B-01's live residual work rose from 854.1 to 1,284.7 operations per pixel, and `hitObj` is live except for a plane-only test.

### What worked
- 0 differing output floats in every run: the shadow interpreter computes what the evaluator computes.
- B-01 (400 pixels, final version): 3,910.4 operations per pixel (the evaluator counts 3,139.4 statements per pixel). Data mode: C 485.2, K 7.3, M 2,001.7, X 38.3, D 1,377.9; live X/D 1,284.7. Gen mode: M 1,656.7; live X/D 1,581.4. Control mode: M 402.4, X 406.8, D 2,814.4.
- `oRow` alone executes 1,374.7 operations per pixel in B-01 (59.8 calls), all M in data mode: 35% of the frame's work is reading the object table.

### What I learned
- The three modes bracket what a specializer can do on B-01: monovariant (control) about 1.1–1.2×, polyvariant with merging at returns (gen) about 2.2–2.5×, fully polyvariant (data) about 2.7–3.0×, as ratios of residual operations.
- The difference comes from polyvariance: at program points under dynamic tests (the BVH walk) and at calls (`oRow`, `hitObj` per object). Constant folding at constant addresses alone is the control mode's few percent.

### What was tricky to build
- Dynamic slicing with control dependence needs both the regions (post-dominators) and the omission rule at joins; without either, branches that select values look dead.

### What warrants a second pair of eyes
- The unit is evaluator operations at r0, not RV32 instructions; calls are counted separately, not as operations. Static work is load- and check-heavy (B-01 data mode: 432.6 static loads and 353.5 static checked addresses per pixel); how the ratio translates to instructions is not measured.
- The data mode bounds specializers that do not change the arithmetic: float identities (`x · 1`, `x + −0`) and algebra the specializer might enable are not counted.

### What should be done in the future
- Phase 0 of the plan: keep this script as the oracle for the bound and re-measure after each phase.

### Code review instructions
- `scripts/03-binding-time-profile.mjs`: `shadow` (tags, regions, selections), `regionLocals`, `ipdoms`, `summarize` (bounds).

### Technical details
- Bounds reported per mode: `noTrick` = (M + X + D) / (X + D) as `lo` (C counted as already removed by today's per-scene kernel) and (C + M + X + D) / (X + D) as `hi`; `withTrick` divides by D; `noTrickWithDce` divides by the live X/D operations of the slice.
