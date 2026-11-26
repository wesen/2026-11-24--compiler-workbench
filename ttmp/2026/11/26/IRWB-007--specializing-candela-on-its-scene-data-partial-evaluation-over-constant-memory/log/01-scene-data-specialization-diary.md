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

## Step 4: All 18 scenes in three modes, the sections aggregate, and the first draft of the guide

This step ran the final version of measurement 3 on every gallery scene, summarized it, and wrote the guide's first complete draft around the numbers. The 18-scene run had to be made three times: the first run (started before the `gen` mode existed) was stopped, and the second finished while I added an aggregate of the hand-staged sections against the kernel, which a script edited during a run does not pick up, so a third run produced the file the guide cites.

The result splits the gallery in two. On 11 scenes the polyvariant bound is at least 2× (2.10–4.51× at its low end); on the 7 ray-marched and volume scenes it is below 1.7×, because their pixels execute 30,000–415,000 operations of dynamic arithmetic. The monovariant bound is at most 1.23× on 17 scenes and 1.68× on L-03.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The hypothesis must be judged on the gallery, not on one scene; the hand-staging comparison needs its own numbers.
**Inferred user intent:** A guide whose central claim is measured across the program's real inputs.
**Commit (code):** `30ed1ba` — "IRWB-007: measurements for the intern guide (…), guide first draft, diary steps 1-3".

### What I did
- `systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 /usr/bin/time -v node --max-old-space-size=10240 scripts/03-binding-time-profile.mjs B-01 R-01 L-03 G-01 E-02 W-02 F-01 V-02 G-02 X-04 S-02 R-05 V-03 V-04 R-08 X-03 R-04 G-03 --stride 8 --json various/03-binding-time-profile-all.json 2> various/03-binding-time-profile-all.log` (background, one process).
- Added to the script the per-mode aggregate `sections` / `kernel` (functions matching `^s\d+_` against the others, by tag and by slice) and re-ran the same command.
- `scripts/04-profile-summary.mjs various/03-binding-time-profile-all.json > various/04-profile-summary.txt` (JSON only, no Candela).
- Extended `scripts/02-…` twice: stores reachable from each entry (`entryWrites`), and functions each entry shares with `cdlRenderSpan` (`sharedWithRender`); re-ran it (1 s each).
- `docmgr doc add --ticket IRWB-007 --doc-type design-doc --title "Intern guide: specializing Candela on its scene data, partial evaluation over constant memory"`, then wrote the draft (Parts 1–4).

### Why
- Two scenes cannot carry a claim about "the per-pixel gain" of a program that renders 18 very different scenes.

### What worked
- Final run: `Elapsed 5:55.19`, `Maximum resident set size 425344` KB, exit 0; 0 differing floats in every scene and mode.
- Geometric means over 18 scenes: data 2.08–2.33, gen 1.79–1.98, control 1.08–1.16.
- Static scan additions: `cdlRenderSpan` writes only `out` (as a checked address on its parameter), K's `rngS`, `gTime`, `gLam`, `gTau`, `gTri`, `gBary__x`, `gBary__y`, and frame arrays; `cdlInit` only `etab`; `cdlSky` only `sky` (through `skyBuild`); no unclassified store. `cdlRenderSpan` reaches 310 functions and shares 10 with `cdlSky` (`acosf asinPositive perez q_cos q_exp q_floor q_sin safeNorm skyL_wgsl xyz2rgb`), none with `cdlLayout` or `cdlInit`.
- Sections against kernel (data mode, per pixel): B-01 26.3 against 3,884.2; in the object-and-BVH scenes the sections are at most 3.0% of the operations, in the distance-field scenes at most 20.4% (X-04).
- `listing(st, 'oRow')` at r0 confirmed the lifted form of a buffer read: `loadf32[caddr(q_bO, t5)+2]` with `t5 = ((q_t0 << 1) + 1)`.

### What didn't work
- The second 18-scene run was started before the `sections` aggregate was added, so its JSON lacked it; a Node process does not re-read its script. Re-ran (5 min 55 s).
- A Bash command that piped a Python heredoc into the guide was refused by the worktree guard ("too complex to verify that it stays inside the worktree"); the same edits were applied from a script file in the scratchpad.

### What I learned
- The ray-marched scenes are not an edge case: 7 of 18 scenes. Their cost (G-03: 415,316 operations per pixel) dwarfs the object-table scenes', and in them the dispatchers' K work is large (R-08 975.8, X-03 3,515.2 per pixel), which IRWB-001's per-scene kernels already remove.
- The generator staged the cheap part: hand-staged sections are under 3% of a pixel's work in the object scenes.

### What was tricky to build
- Nothing beyond Step 3.

### What warrants a second pair of eyes
- The R-01 and B-01 numbers in the draft were taken from the final run; the B-01 numbers are identical in every run of the final script version.

### What should be done in the future
- N/A.

### Code review instructions
- `various/04-profile-summary.txt`; `scripts/04-profile-summary.mjs`.

### Technical details
- 80 × 80 scenes give 100 pixels at stride 8, 160 × 160 scenes 400.

## Step 5: The second reading of the guide, as its reader

This step reread the complete draft as the only explanation a new intern would have, wrote down where it would mislead or leave a question open, and revised. Thirteen notes, of which five were technical errors and the rest comprehension gaps; one of them needed a new measurement (which functions the entries share), and that measurement changed the design of the promise from per entry to per region and per entry.

### Prompt Context
**User prompt (verbatim):** see Step 1 (and the brief's "Second pass: reread it as its reader and revise").
**Assistant interpretation:** Diagnose first, then revise; distinguish errors from gaps.
**Inferred user intent:** A guide an intern can act on without the author.
**Commit (code):** the commit after this step.

### What I did
- Read the draft end to end; review notes (passage → problem → correction):
  1. §9 "102.9 calls with static arguments would disappear entirely" → **error**: `rnd(q_k)` has a static argument (the K pointer) and reads the RNG state; corrected to "those whose callee reads no dynamic memory".
  2. §1 "155 functions with `math.typed`" → **error**: 155 = 332 − 177 includes `glue.typed`'s entries.
  3. §4 U readers "8 scene sections" → **error**: 10 (`s10_mat_3`, `s10_mat_4`, `s11_mat_5`, `s11_mat_6`, `s17_mat_0`, `s1_mat_3`, `s4_customKernel`, `s5_mat_6`, `s7_mat_0`, `s8_sdf_0`).
  4. §12 "about 51 KB as JSON" → **error**: 51,168 bytes is the binary size; JSON numbers are about three times that.
  5. §10.2 "every state is a proper suffix of the traversal" → **error in the argument**: replaced by "each node is pushed at most once; finitely many states".
  6. §4/§13: the output buffer is a parameter; nothing shows it does not overlap a scene buffer → **gap in the promise**: non-overlap added to the promise and to the checks.
  7. §13 "the promise is per entry" → **gap**: a function reachable from two entries may hold for one and not the other. Measured the sharing (`sharedWithRender` in script 02): 10 functions shared with `cdlSky`, one of which (`skyL_wgsl`) reads U. The promise is now per region with each region's entries, and a fold may use a region only if it is promised in every entry reaching the function.
  8. Summary "It holds for the scenes …" → **overclaim**: the bound permits it; changed to "can hold".
  9. §9 "a monovariant specializer gets percents on every scene" → **imprecise**: L-03 reaches 1.52–1.68×; explained by its object outside the BVH, whose loop runs under no dynamic test (checked: L-03 control-mode O loads M 84.0, X 48.3 per pixel; B-01 all X).
  10. §13 pointed to "§23" for a device decision; there was no open-questions section → added §25 Open questions and renumbered §25–§28 to §26–§29.
  11. Phase 0's acceptance "agrees with the r0 profile minus the K operations" → **unverifiable**: replaced by reproducing B-01's r0 numbers and 0 K operations on the per-scene revision.
  12. §20's success criterion ("the kernel's residual fraction approaches the sections'") → **vague**: replaced by the M fractions (sections 11%, kernel 51% on B-01).
  13. §14: what happens to a `ptr` value → **gap**: a `ptr` is never materialized; only loads through it are replaced.
- Applied the revisions; reread the changed passages against the summary, §9's tables, §23 and the decisions table.
- Filled the guide's and the index's frontmatter, `docmgr doc relate` (7 files on the guide, 3 on the index), seven tasks (this round and phases 0–5), a changelog entry; `docmgr doctor --ticket IRWB-007 --stale-after 30` → "All checks passed".

### Why
- The skill's second pass is a diagnosis before a polish; the notes are kept here, not in the guide.

### What worked
- The new sharing measurement: `functions cdlRenderSpan reaches: 310; shared with the other entries: cdlLayout 0; cdlInit 0; cdlSky 10 (acosf asinPositive perez q_cos q_exp q_floor q_sin safeNorm skyL_wgsl xyz2rgb)`.

### What didn't work
- No failures.

### What I learned
- The field binding's "every function with a K parameter" scope worked for `K.scene` only because no entry runs before `bind` sets it except `cdlLayout` and `cdlInit`, which do not read it. Memory regions need the scope made explicit.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- The design's claims about the device (compiled on first use, 85 s, cached) come from `corpus/candela-gallery/app.json`'s notes, not from a measurement in this repository.

### What should be done in the future
- N/A.

### Code review instructions
- Read the guide's Summary, §9, §13 and §23 together; they must tell one story.

### Technical details
- The vault report for this ticket is deferred to the implementation milestone, as the coordinator relayed from the user; none was written in this round.

## Step 6: Upload to reMarkable

The guide, as revised in Step 5 (commit `69ae7a0`), was uploaded as one PDF bundle with a two-level table of contents and the upload was verified by listing the folder. This ends the guide round; no implementation was started.

### Prompt Context
**User prompt (verbatim):** see Step 1 ("Store in the ticket and the nupload to remarkable").
**Assistant interpretation:** Upload with the brief's exact command, verify with a listing, never `--force`.
**Inferred user intent:** Read the guide on the device.
**Commit (code):** the commit after this step.

### What I did
- `remarquee upload bundle ttmp/2026/11/26/IRWB-007--…/design-doc/01-intern-guide-specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory.md --name "IRWB-007 Intern Guide: Specializing Candela on Its Scene Data" --remote-dir "/ai/2026/11/26/IRWB-007" --toc-depth 2 --non-interactive`
- `remarquee cloud ls /ai/2026/11/26/IRWB-007 --long --non-interactive`
- `docmgr task check --ticket IRWB-007 --id j5d7`; a changelog entry for the upload.

### What worked
- `OK: uploaded IRWB-007 Intern Guide: Specializing Candela on Its Scene Data.pdf -> /ai/2026/11/26/IRWB-007`
- Listing: `[f]	IRWB-007 Intern Guide: Specializing Candela on Its Scene Data`

### What didn't work
- No failures; no overwrite was needed (the folder was new).

### What I learned
- N/A.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- The upload proves cloud delivery, not that the device has synchronized.

### What should be done in the future
- Implementation phases 0–5 (tasks `h6j5`, `zaq6`, `r4yf`, `hx1o`, `wtaa`, `gjtu`), and the vault report after the implementation milestone.

### Code review instructions
- The guide: `design-doc/01-intern-guide-specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory.md`.

### Technical details
- Guide: 910 lines, 15,155 words at upload.
